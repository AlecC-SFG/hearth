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
import type { ListItem, Member, Project, Task } from "./types"

type Kind = "member" | "project" | "task" | "history" | "listitem"
export interface Row {
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

// Per-household keys, so switching households never mixes queues or bookmarks.
const pendingKey = (house: string) => `hearth-sync-pending:${house}`
const cursorKey = (house: string) => `hearth-sync-cursor:${house}`
// Single-household builds (v0.2.0) used these; read once for upgrades.
const LEGACY_PENDING_KEY = "hearth-sync-pending"
const LEGACY_CURSOR_KEY = "hearth-sync-cursor"
const CHUNK = 200

let pending = new Map<string, Change>()
let applyingRemote = false
let channel: RealtimeChannel | null = null
let currentHouse: string | undefined
let flushTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false
/** Set when the server rejected list items (database patch 002 not applied yet) */
let listsBlocked = false

const keyOf = (kind: Kind, id: string) => `${kind}:${id}`
const setStatus = (status: SyncStatus, error?: string) =>
  useSync.setState({ status, error, pendingCount: pending.size, ...(status === "synced" ? { lastSyncedAt: Date.now() } : {}) })

/* ------------------------------------------------------------------ */
/* Snapshot & diff                                                     */
/* ------------------------------------------------------------------ */

type Snap = Record<Kind, Map<string, unknown>>
type StoreState = ReturnType<typeof useStore.getState>

function snapshot(s: Pick<StoreState, "members" | "projects" | "tasks" | "history" | "listItems">): Snap {
  const history = new Map<string, unknown>()
  for (const [day, byMember] of Object.entries(s.history)) {
    for (const [mid, n] of Object.entries(byMember)) history.set(`${day}|${mid}`, n)
  }
  return {
    member: new Map(s.members.map((m) => [m.id, m])),
    project: new Map(s.projects.map((p) => [p.id, p])),
    task: new Map(s.tasks.map((t) => [t.id, t])),
    history,
    listitem: new Map(s.listItems.map((i) => [i.id, i])),
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

export function enqueueEverything() {
  const snap = snapshot(useStore.getState())
  const all: Change[] = []
  for (const kind of Object.keys(snap) as Kind[]) for (const [id, v] of snap[kind]) all.push({ kind, id, data: v })
  enqueue(all)
}

async function savePending() {
  if (!currentHouse) return
  try {
    await idbSet(pendingKey(currentHouse), [...pending.values()])
  } catch {
    /* storage unavailable: the queue still lives in memory */
  }
}

async function loadPending(house: string) {
  try {
    const saved = await idbGet<Change[]>(pendingKey(house))
    for (const c of saved ?? []) pending.set(keyOf(c.kind, c.id), c)
    const legacy = await idbGet<{ house?: string; changes: Change[] }>(LEGACY_PENDING_KEY)
    if (legacy?.house === house) {
      for (const c of legacy.changes) if (!pending.has(keyOf(c.kind, c.id))) pending.set(keyOf(c.kind, c.id), c)
      await idbDel(LEGACY_PENDING_KEY)
    }
  } catch {
    /* ignore */
  }
}

// Watch the store for local edits
useStore.subscribe((next, prev) => {
  if (applyingRemote || !next.household || next.household.id !== prev.household?.id) return
  if (
    next.members === prev.members &&
    next.projects === prev.projects &&
    next.tasks === prev.tasks &&
    next.history === prev.history &&
    next.listItems === prev.listItems
  )
    return
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
  const house = currentHouse
  const queue = pending
  if (!navigator.onLine) return setStatus("offline")
  flushing = true
  listsBlocked = false
  let failed = false
  setStatus("syncing")
  try {
    const batch = [...queue.entries()]
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK)
      const rows = slice.map(([, c]) => ({
        household_id: house,
        kind: c.kind,
        id: c.id,
        data: c.data ?? null,
        deleted: c.data == null,
      }))
      let { error } = await supabase.from("items").upsert(rows, { onConflict: "household_id,kind,id" })
      let sent = slice
      if (error?.code === "23514" && rows.some((r) => r.kind === "listitem")) {
        // Server hasn't been updated for lists yet: send everything else, keep list items queued
        const others = rows.filter((r) => r.kind !== "listitem")
        sent = slice.filter(([, c]) => c.kind !== "listitem")
        error = others.length ? (await supabase.from("items").upsert(others, { onConflict: "household_id,kind,id" })).error : null
        if (!error) listsBlocked = true
      }
      if (error) {
        if (isRlsError(error)) throw new Error("This phone is no longer part of the household. Join again from Settings.")
        throw error
      }
      // Only drop entries that weren't edited again while we were uploading
      for (const [k, c] of sent) if (queue.get(k) === c) queue.delete(k)
      if (house !== currentHouse) {
        // Switched households mid-upload: save what is left of the old queue under its own key
        await idbSet(pendingKey(house), [...queue.values()]).catch(() => {})
        return
      }
    }
    await savePending()
    if (listsBlocked) {
      setStatus("error", "Lists can't sync until the Hearth server is updated. Everything else is syncing.")
      scheduleRetry()
    } else setStatus("synced")
  } catch (e) {
    failed = true
    setStatus(navigator.onLine ? "error" : "offline", friendlyError(e))
    scheduleRetry()
  } finally {
    flushing = false
  }
  // New edits arrived during a successful upload: send them too. After a failure,
  // or with list items held back, wait for the 20-second retry instead of hammering.
  if (pending.size && !failed && !listsBlocked) {
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

/** The synced parts of one household's data */
export interface Lists {
  members: Member[]
  projects: Project[]
  tasks: Task[]
  listItems: ListItem[]
  history: Record<string, Record<string, number>>
}

/** Pure: apply server rows to a household's lists. skip() lets newer local edits win. */
export function mergeRows(base: Lists, rows: Row[], skip?: (key: string) => boolean): Lists {
  let { members, projects, tasks, history, listItems } = base
  for (const row of rows) {
    if (skip?.(keyOf(row.kind, row.id))) continue
    if (row.kind === "member") members = upsertIn<Member>(members, row, false)
    else if (row.kind === "project") projects = upsertIn<Project>(projects, row, false)
    else if (row.kind === "task") tasks = upsertIn<Task>(tasks, row, true)
    else if (row.kind === "listitem") listItems = upsertIn<ListItem>(listItems, row, false)
    else if (row.kind === "history") {
      const [day, mid] = row.id.split("|")
      const dayMap = { ...history[day] }
      if (row.deleted) delete dayMap[mid]
      else dayMap[mid] = Number(row.data) || 0
      history = { ...history, [day]: dayMap }
    }
  }
  return { members, projects, tasks, history, listItems }
}

function applyRows(rows: Row[]) {
  if (!rows.length) return
  applyingRemote = true
  try {
    // our newer local edit wins until pushed
    useStore.setState((s) => mergeRows(s, rows, (k) => pending.has(k)))
  } finally {
    applyingRemote = false
  }
}

async function readCursor(house: string): Promise<string | undefined> {
  let at = await idbGet<string>(cursorKey(house)).catch(() => undefined)
  if (!at) {
    const legacy = await idbGet<{ house: string; at: string }>(LEGACY_CURSOR_KEY).catch(() => undefined)
    if (legacy?.house === house) at = legacy.at
  }
  return at
}

/** Everything that changed in a household since this phone last looked (with a 30 s overlap). */
export async function fetchChanges(house: string): Promise<{ rows: Row[]; last?: string }> {
  if (!supabase) return { rows: [] }
  const at = await readCursor(house)
  let since = at ? new Date(new Date(at).getTime() - 30_000).toISOString() : undefined
  let last = at
  const all: Row[] = []
  for (;;) {
    let q = supabase.from("items").select("kind,id,data,deleted,updated_at").eq("household_id", house).order("updated_at").limit(1000)
    if (since) q = q.gte("updated_at", since)
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []) as Row[]
    all.push(...rows)
    if (rows.length) last = rows[rows.length - 1].updated_at
    if (rows.length < 1000) break
    since = last
  }
  return { rows: all, last }
}

export async function saveCursor(house: string, at: string) {
  await idbSet(cursorKey(house), at).catch(() => {})
}

/** Upload a background household's leftover queue (e.g. after switching mid-upload). */
export async function uploadQueued(house: string): Promise<Set<string>> {
  const queued = (await idbGet<Change[]>(pendingKey(house)).catch(() => undefined)) ?? []
  const keys = new Set(queued.map((c) => keyOf(c.kind, c.id)))
  if (!supabase || !queued.length || !navigator.onLine) return keys
  const rows = queued.map((c) => ({ household_id: house, kind: c.kind, id: c.id, data: c.data ?? null, deleted: c.data == null }))
  const { error } = await supabase.from("items").upsert(rows, { onConflict: "household_id,kind,id" })
  if (error) return keys
  await idbDel(pendingKey(house)).catch(() => {})
  return new Set()
}

async function pull() {
  if (!supabase || !currentHouse) return
  const house = currentHouse
  const { rows, last } = await fetchChanges(house)
  if (house !== currentHouse) return
  applyRows(rows)
  if (last && house === currentHouse) await saveCursor(house, last)
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

export function stopSync() {
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
/* Helpers for households.ts                                           */
/* ------------------------------------------------------------------ */

/** Push queued changes now (best effort, gives up after a few seconds). */
export async function flushNow(timeoutMs = 4000) {
  if (flushTimer) clearTimeout(flushTimer)
  await Promise.race([flush(), new Promise((r) => setTimeout(r, timeoutMs))])
}

/** Remove a household's queue and bookmark from this phone. */
export async function forgetSyncState(house: string) {
  await idbDel(pendingKey(house)).catch(() => {})
  await idbDel(cursorKey(house)).catch(() => {})
}

/** Run a store update without it being queued for upload. */
export function withoutSync(fn: () => void) {
  applyingRemote = true
  try {
    fn()
  } finally {
    applyingRemote = false
  }
}

/** Test hook: lets the test suite inspect the queue. */
export const __syncInternals = { diff, snapshot, pendingSize: () => pending.size }
