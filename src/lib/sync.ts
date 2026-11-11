/**
 * Household sync.
 *
 * The local store stays the source of truth for the UI, so the app keeps
 * working offline. This module:
 *   1. watches the store and queues every changed member/project/task/history
 *      entry (persisted, so offline edits survive restarts),
 *   2. pushes the queue to Supabase when online,
 *   3. pulls everything changed since the last pull, and
 *   4. listens for live changes from the other phones in the household.
 * Conflicts resolve as "last write reaches the server wins", per record.
 */
import { create } from "zustand"
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { ensureSession, friendlyError, supabase } from "./supabase"
import { useStore, type Household } from "./store"
import type { Member, Project, Task } from "./types"

type Kind = "member" | "project" | "task" | "history"
interface Row {
  kind: Kind
  id: string
  data: unknown
  deleted: boolean
  updated_at: string
}
interface Change {
  kind: Kind
  id: string
  data: unknown | null // null = deleted
}

export type SyncStatus = "off" | "connecting" | "synced" | "syncing" | "offline" | "error"

export const useSync = create<{ status: SyncStatus; error?: string; lastSyncedAt?: number; pendingCount: number }>(() => ({
  status: "off",
  pendingCount: 0,
}))

const PENDING_KEY = "hearth-sync-pending"
const CURSOR_KEY = "hearth-sync-cursor"
const CHUNK = 200

let pending = new Map<string, Change>()
let applyingRemote = false
let channel: RealtimeChannel | null = null
let currentHouse: string | undefined
let flushTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false

const keyOf = (kind: Kind, id: string) => `${kind}:${id}`
const setStatus = (status: SyncStatus, error?: string) =>
  useSync.setState({ status, error, pendingCount: pending.size, ...(status === "synced" ? { lastSyncedAt: Date.now() } : {}) })

/* ------------------------------------------------------------------ */
/* Snapshot & diff                                                     */
/* ------------------------------------------------------------------ */

type Snap = Record<Kind, Map<string, unknown>>
type StoreState = ReturnType<typeof useStore.getState>

function snapshot(s: Pick<StoreState, "members" | "projects" | "tasks" | "history">): Snap {
  const history = new Map<string, unknown>()
  for (const [day, byMember] of Object.entries(s.history)) {
    for (const [mid, n] of Object.entries(byMember)) history.set(`${day}|${mid}`, n)
  }
  return {
    member: new Map(s.members.map((m) => [m.id, m])),
    project: new Map(s.projects.map((p) => [p.id, p])),
    task: new Map(s.tasks.map((t) => [t.id, t])),
    history,
  }
}

function diff(prev: Snap, next: Snap): Change[] {
  const out: Change[] = []
  for (const kind of Object.keys(next) as Kind[]) {
    const a = prev[kind]
    const b = next[kind]
    for (const [id, v] of b) if (a.get(id) !== v) out.push({ kind, id, data: v })
    for (const id of a.keys()) if (!b.has(id)) out.push({ kind, id, data: null })
  }
  return out
}

function enqueue(changes: Change[]) {
  if (!changes.length) return
  for (const c of changes) pending.set(keyOf(c.kind, c.id), c)
  void savePending()
  useSync.setState({ pendingCount: pending.size })
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flush(), 400)
}

function enqueueEverything() {
  const snap = snapshot(useStore.getState())
  const all: Change[] = []
  for (const kind of Object.keys(snap) as Kind[]) for (const [id, v] of snap[kind]) all.push({ kind, id, data: v })
  enqueue(all)
}

async function savePending() {
  try {
    await idbSet(PENDING_KEY, { house: currentHouse, changes: [...pending.values()] })
  } catch {
    /* storage unavailable: the queue still lives in memory */
  }
}

async function loadPending(house: string) {
  try {
    const saved = await idbGet<{ house?: string; changes: Change[] }>(PENDING_KEY)
    if (saved?.house === house) for (const c of saved.changes) pending.set(keyOf(c.kind, c.id), c)
  } catch {
    /* ignore */
  }
}

// Watch the store for local edits
useStore.subscribe((next, prev) => {
  if (applyingRemote || !next.household || next.household.id !== prev.household?.id) return
  if (next.members === prev.members && next.projects === prev.projects && next.tasks === prev.tasks && next.history === prev.history) return
  enqueue(diff(snapshot(prev), snapshot(next)))
})

/* ------------------------------------------------------------------ */
/* Push / pull / live                                                  */
/* ------------------------------------------------------------------ */

function isRlsError(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === "42501" || /row-level security/i.test(e.message ?? ""))
}

async function flush() {
  if (!supabase || !currentHouse || flushing || pending.size === 0) return
  if (!navigator.onLine) return setStatus("offline")
  flushing = true
  setStatus("syncing")
  try {
    const batch = [...pending.entries()]
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK)
      const rows = slice.map(([, c]) => ({
        household_id: currentHouse,
        kind: c.kind,
        id: c.id,
        data: c.data ?? null,
        deleted: c.data == null,
      }))
      const { error } = await supabase.from("items").upsert(rows, { onConflict: "household_id,kind,id" })
      if (error) {
        if (isRlsError(error)) throw new Error("This phone is no longer part of the household. Join again from Settings.")
        throw error
      }
      // Only drop entries that weren't edited again while we were uploading
      for (const [k, c] of slice) if (pending.get(k) === c) pending.delete(k)
    }
    await savePending()
    setStatus("synced")
  } catch (e) {
    setStatus(navigator.onLine ? "error" : "offline", friendlyError(e))
    scheduleRetry()
  } finally {
    flushing = false
  }
  if (pending.size) {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => void flush(), 400)
  }
}

function upsertIn<T extends { id: string }>(list: T[], row: Row, prepend: boolean): T[] {
  const i = list.findIndex((x) => x.id === row.id)
  if (row.deleted) return i === -1 ? list : list.filter((x) => x.id !== row.id)
  const obj = row.data as T
  if (i === -1) return prepend ? [obj, ...list] : [...list, obj]
  if (JSON.stringify(list[i]) === JSON.stringify(obj)) return list
  const copy = list.slice()
  copy[i] = obj
  return copy
}

function applyRows(rows: Row[]) {
  if (!rows.length) return
  applyingRemote = true
  try {
    useStore.setState((s) => {
      let { members, projects, tasks, history } = s
      for (const row of rows) {
        if (pending.has(keyOf(row.kind, row.id))) continue // our newer local edit wins until pushed
        if (row.kind === "member") members = upsertIn<Member>(members, row, false)
        else if (row.kind === "project") projects = upsertIn<Project>(projects, row, false)
        else if (row.kind === "task") tasks = upsertIn<Task>(tasks, row, true)
        else if (row.kind === "history") {
          const [day, mid] = row.id.split("|")
          const dayMap = { ...history[day] }
          if (row.deleted) delete dayMap[mid]
          else dayMap[mid] = Number(row.data) || 0
          history = { ...history, [day]: dayMap }
        }
      }
      return { members, projects, tasks, history }
    })
  } finally {
    applyingRemote = false
  }
}

async function pull() {
  if (!supabase || !currentHouse) return
  const house = currentHouse
  const saved = await idbGet<{ house: string; at: string }>(CURSOR_KEY).catch(() => undefined)
  // Re-read a 30 s overlap so rows committed slightly out of order aren't missed
  let since = saved?.house === house ? new Date(new Date(saved.at).getTime() - 30_000).toISOString() : undefined
  let last = saved?.house === house ? saved.at : undefined
  for (;;) {
    let q = supabase.from("items").select("kind,id,data,deleted,updated_at").eq("household_id", house).order("updated_at").limit(1000)
    if (since) q = q.gte("updated_at", since)
    const { data, error } = await q
    if (error) throw error
    if (house !== currentHouse) return
    const rows = (data ?? []) as Row[]
    applyRows(rows)
    if (rows.length) last = rows[rows.length - 1].updated_at
    if (rows.length < 1000) break
    since = last
  }
  if (last) await idbSet(CURSOR_KEY, { house, at: last }).catch(() => {})
  await refreshHousehold()
}

async function refreshHousehold() {
  const h = useStore.getState().household
  if (!supabase || !h) return
  const { data } = await supabase.from("households").select("name,join_code").eq("id", h.id).maybeSingle()
  if (data && (data.name !== h.name || data.join_code !== h.joinCode)) {
    useStore.getState().setHousehold({ ...h, name: data.name, joinCode: data.join_code })
  }
}

function subscribeLive(house: string) {
  if (!supabase) return
  const name = `hearth-items-${house}`
  for (const c of supabase.getChannels()) if (c.topic === `realtime:${name}`) void supabase.removeChannel(c)
  channel = supabase
    .channel(name)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `household_id=eq.${house}` }, (payload) => {
      const row = payload.new as Row | undefined
      if (row?.kind) applyRows([row])
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") void pull().catch(() => {})
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") scheduleRetry()
    })
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    void resync()
  }, 20_000)
}

async function resync() {
  if (!currentHouse) return
  try {
    await flush()
    await pull()
    if (!pending.size) setStatus("synced")
  } catch (e) {
    setStatus(navigator.onLine ? "error" : "offline", friendlyError(e))
    scheduleRetry()
  }
}

function stopSync() {
  if (channel) void supabase?.removeChannel(channel)
  channel = null
  currentHouse = undefined
  pending = new Map()
  if (flushTimer) clearTimeout(flushTimer)
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
  setStatus("off")
}

let starting: { house: string; promise: Promise<void> } | null = null

/** Start (or restart) syncing the household this device belongs to. Safe to call repeatedly. */
export function startSync(): Promise<void> {
  const house = useStore.getState().household
  if (!supabase || !house) {
    stopSync()
    return Promise.resolve()
  }
  if (starting?.house === house.id) return starting.promise
  if (currentHouse === house.id && channel) return Promise.resolve()
  const promise = doStart(house).finally(() => {
    if (starting?.promise === promise) starting = null
  })
  starting = { house: house.id, promise }
  return promise
}

async function doStart(house: Household) {
  stopSync()
  currentHouse = house.id
  await loadPending(house.id)
  setStatus("connecting")
  try {
    await ensureSession()
    await flush()
    await pull()
    subscribeLive(house.id)
    setStatus(pending.size ? "syncing" : "synced")
  } catch (e) {
    setStatus(navigator.onLine ? "error" : "offline", friendlyError(e))
    scheduleRetry()
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void resync())
  window.addEventListener("offline", () => currentHouse && setStatus("offline"))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void resync()
  })
}

/* ------------------------------------------------------------------ */
/* Household actions                                                   */
/* ------------------------------------------------------------------ */

interface HouseRow {
  id: string
  name: string
  join_code: string
}
const toHousehold = (r: HouseRow): Household => ({ id: r.id, name: r.name, joinCode: r.join_code })

/** Create a household and upload everything currently on this device into it. */
export async function createHousehold(name: string): Promise<Household> {
  if (!supabase) throw new Error("Sync isn't available in this version.")
  await ensureSession()
  const { data, error } = await supabase.rpc("create_household", { p_name: name })
  if (error) throw new Error(friendlyError(error))
  const h = toHousehold(data as HouseRow)
  await idbDel(CURSOR_KEY).catch(() => {})
  useStore.getState().setHousehold(h)
  await startSync()
  enqueueEverything()
  return h
}

/** Join a household by code. This device's current lists are replaced by the household's. */
export async function joinHousehold(code: string): Promise<Household> {
  if (!supabase) throw new Error("Sync isn't available in this version.")
  await ensureSession()
  const { data, error } = await supabase.rpc("join_household", { p_code: code })
  if (error) throw new Error(friendlyError(error))
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  const h = toHousehold(data as HouseRow)
  stopSync()
  await idbDel(PENDING_KEY).catch(() => {})
  await idbDel(CURSOR_KEY).catch(() => {})
  applyingRemote = true
  try {
    const s = useStore.getState()
    useStore.setState({
      onboarded: true,
      household: h,
      members: [],
      projects: [],
      tasks: [],
      history: {},
      focus: undefined,
      settings: { ...s.settings, currentMemberId: undefined },
    })
  } finally {
    applyingRemote = false
  }
  await startSync()
  return h
}

/** Stop syncing on this phone. Its current lists stay on the phone. */
export async function leaveHousehold() {
  const h = useStore.getState().household
  stopSync()
  await idbDel(PENDING_KEY).catch(() => {})
  await idbDel(CURSOR_KEY).catch(() => {})
  useStore.getState().setHousehold(undefined)
  if (supabase && h) {
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user.id
    if (uid) await supabase.from("household_members").delete().eq("household_id", h.id).eq("user_id", uid)
  }
}

export async function newJoinCode(): Promise<string> {
  const h = useStore.getState().household
  if (!supabase || !h) throw new Error("Not in a household")
  const { data, error } = await supabase.rpc("rotate_join_code", { p_household: h.id })
  if (error) throw new Error(friendlyError(error))
  useStore.getState().setHousehold({ ...h, joinCode: data as string })
  return data as string
}

export async function renameHousehold(name: string) {
  const h = useStore.getState().household
  if (!supabase || !h) return
  const { error } = await supabase.from("households").update({ name }).eq("id", h.id)
  if (error) throw new Error(friendlyError(error))
  useStore.getState().setHousehold({ ...h, name })
}

export function joinLink(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(code)}`
}

/** Test hook: lets the test suite inspect the queue. */
export const __syncInternals = { diff, snapshot, pendingSize: () => pending.size }
