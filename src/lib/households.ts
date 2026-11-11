/**
 * Multiple households per phone.
 *
 * The store always holds ONE household's lists (the one on screen). Every other
 * household this phone belongs to — plus an optional "this phone only" list — is
 * parked in IndexedDB under its own key. Switching parks the current lists and
 * brings the chosen ones forward, then points sync at that household.
 * Server-side privacy is unchanged: a phone only reaches households it joined.
 */
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval"
import { ensureSession, friendlyError, supabase } from "./supabase"
import { useStore, type Household } from "./store"
import { create } from "zustand"
import { enqueueEverything, fetchChanges, flushNow, forgetSyncState, mergeRows, saveCursor, startSync, stopSync, uploadQueued, withoutSync } from "./sync"
import type { ListItem, Member, Project, Task } from "./types"

export const LOCAL = "local"

export interface Slot {
  members: Member[]
  projects: Project[]
  tasks: Task[]
  listItems?: ListItem[]
  history: Record<string, Record<string, number>>
  currentMemberId?: string
}

const EMPTY: Slot = { members: [], projects: [], tasks: [], listItems: [], history: {} }
const slotKey = (id: string) => `hearth-space:${id}`
const hasData = (s: Slot) => s.members.length + s.projects.length + s.tasks.length > 0

export function activeSpaceId(): string {
  return useStore.getState().household?.id ?? LOCAL
}

function currentSlot(): Slot {
  const s = useStore.getState()
  return {
    members: s.members,
    projects: s.projects,
    tasks: s.tasks,
    listItems: s.listItems,
    history: s.history,
    currentMemberId: s.settings.currentMemberId,
  }
}

/* ------------------------------------------------------------------ */
/* Parked households, kept in memory for the combined Now view         */
/* ------------------------------------------------------------------ */

/** Every household (and "this phone only") that is NOT on screen, keyed by id */
export const useParked = create<{ spaces: Record<string, Slot>; refreshedAt?: number }>(() => ({ spaces: {} }))

function cacheSlot(id: string, slot: Slot | undefined) {
  useParked.setState((p) => {
    const spaces = { ...p.spaces }
    if (slot) spaces[id] = slot
    else delete spaces[id]
    return { spaces }
  })
}

let switching = 0
let refreshing: Promise<void> | null = null

/** Load every parked household from this phone's storage (no network). */
export async function loadParked() {
  const st = useStore.getState()
  const active = activeSpaceId()
  const ids = [...st.households.map((h) => h.id), ...(st.hasLocalSpace ? [LOCAL] : [])].filter((id) => id !== active)
  const spaces: Record<string, Slot> = {}
  for (const id of ids) {
    const slot = await idbGet<Slot>(slotKey(id)).catch(() => undefined)
    if (slot) spaces[id] = slot
  }
  useParked.setState({ spaces })
}

/**
 * Bring parked households up to date from the server, so the combined Now view
 * sees what other households assigned to you. Skips anything mid-switch.
 */
export function refreshParked(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      // Pick up renames and new codes for every household, including parked ones
      await refreshMemberships().catch(() => {})
      const st = useStore.getState()
      for (const h of st.households) {
        if (switching || h.id === activeSpaceId()) continue
        try {
          const stillQueued = await uploadQueued(h.id)
          const { rows, last } = await fetchChanges(h.id)
          if (switching || h.id === activeSpaceId()) continue
          const slot = (await idbGet<Slot>(slotKey(h.id)).catch(() => undefined)) ?? { ...EMPTY }
          const merged = mergeRows({ ...EMPTY, ...slot, listItems: slot.listItems ?? [] }, rows, (k) => stillQueued.has(k))
          const next: Slot = { ...slot, ...merged }
          if (switching || h.id === activeSpaceId()) continue
          await idbSet(slotKey(h.id), next)
          if (last) await saveCursor(h.id, last)
          cacheSlot(h.id, next)
        } catch {
          /* offline or not a member any more: keep what we have */
        }
      }
      useParked.setState({ refreshedAt: Date.now() })
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Keep parked households fresh: now, whenever the app returns, and every 3 minutes. */
export function startParkedRefresher() {
  void loadParked().then(() => refreshParked())
  const tick = () => {
    if (document.visibilityState === "visible" && useStore.getState().households.length > 1) void refreshParked()
  }
  document.addEventListener("visibilitychange", tick)
  const id = setInterval(tick, 3 * 60 * 1000)
  return () => {
    document.removeEventListener("visibilitychange", tick)
    clearInterval(id)
  }
}

/** Park the lists on screen so another household can be shown. */
async function park() {
  const s = useStore.getState()
  if (s.focus) s.endFocus()
  const id = activeSpaceId()
  if (id !== LOCAL) await flushNow()
  stopSync() // no stray live updates may land in the next household's lists
  const slot = currentSlot()
  await idbSet(slotKey(id), slot)
  if (id === LOCAL) useStore.setState({ hasLocalSpace: hasData(slot) })
  if (id !== LOCAL || hasData(slot)) cacheSlot(id, slot)
}

/** Bring a parked household (or the phone-only list) onto the screen and start syncing it. */
async function show(id: string, household: Household | undefined) {
  const slot = (await idbGet<Slot>(slotKey(id)).catch(() => undefined)) ?? EMPTY
  cacheSlot(id, undefined) // it's on screen now, not parked
  withoutSync(() =>
    useStore.setState((s) => ({
      onboarded: true,
      household,
      members: slot.members,
      projects: slot.projects,
      tasks: slot.tasks,
      listItems: slot.listItems ?? [],
      history: slot.history,
      focus: undefined,
      settings: { ...s.settings, currentMemberId: slot.currentMemberId },
    })),
  )
  await startSync()
}

/** Switch the screen to another household this phone belongs to (or LOCAL). */
export async function switchHousehold(id: string) {
  if (id === activeSpaceId()) return
  const household = id === LOCAL ? undefined : useStore.getState().households.find((h) => h.id === id)
  if (id !== LOCAL && !household) throw new Error("This phone isn't part of that household.")
  await guarded(async () => {
    await park()
    await show(id, household)
  })
}

/** Run something that swaps what's on screen, never overlapping a background refresh. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  switching++
  try {
    await refreshing
    return await fn()
  } finally {
    switching--
  }
}

interface HouseRow {
  id: string
  name: string
  join_code: string
  error?: string
}
const toHousehold = (r: HouseRow): Household => ({ id: r.id, name: r.name, joinCode: r.join_code })

/**
 * Create a household.
 * - Viewing "this phone only": those lists become the new household's starting lists.
 * - Viewing another household: the new one starts empty except for you.
 */
export function createHousehold(name: string): Promise<Household> {
  return guarded(() => createHouseholdInner(name))
}
async function createHouseholdInner(name: string): Promise<Household> {
  if (!supabase) throw new Error("Sync isn't available in this version.")
  await ensureSession()
  const { data, error } = await supabase.rpc("create_household", { p_name: name })
  if (error) throw new Error(friendlyError(error))
  const h = toHousehold(data as HouseRow)
  const s = useStore.getState()
  await forgetSyncState(h.id)

  if (!s.household) {
    useStore.setState((st) => ({ households: [...st.households, h], hasLocalSpace: false }))
    useStore.getState().setHousehold(h) // the lists on screen now belong to the household
    await idbDel(slotKey(LOCAL)).catch(() => {})
    await startSync()
    enqueueEverything()
    return h
  }

  const me = s.members.find((m) => m.id === s.settings.currentMemberId)
  await park()
  await idbSet(slotKey(h.id), { ...EMPTY, members: me ? [me] : [], currentMemberId: me?.id } satisfies Slot)
  useStore.setState((st) => ({ households: [...st.households, h] }))
  await show(h.id, h)
  enqueueEverything()
  return h
}

/** Join a household by code. Nothing already on this phone is replaced. */
export function joinHousehold(code: string): Promise<Household> {
  return guarded(() => joinHouseholdInner(code))
}
async function joinHouseholdInner(code: string): Promise<Household> {
  if (!supabase) throw new Error("Sync isn't available in this version.")
  await ensureSession()
  const { data, error } = await supabase.rpc("join_household", { p_code: code })
  if (error) throw new Error(friendlyError(error))
  if ((data as HouseRow)?.error) throw new Error((data as HouseRow).error)
  const h = toHousehold(data as HouseRow)
  const s = useStore.getState()

  if (s.households.some((x) => x.id === h.id)) {
    await switchHousehold(h.id)
    return h
  }
  if (s.onboarded) await park()
  await forgetSyncState(h.id)
  await idbDel(slotKey(h.id)).catch(() => {})
  useStore.setState((st) => ({ households: [...st.households, h] }))
  await show(h.id, h) // lists arrive from the server; "Which one are you?" follows
  return h
}

/** Remove a household from this phone. Everyone else in it keeps everything. */
export function leaveHousehold(id = activeSpaceId()): Promise<void> {
  return guarded(() => leaveHouseholdInner(id))
}
async function leaveHouseholdInner(id: string) {
  if (id === LOCAL) return
  leaving.add(id)
  setTimeout(() => leaving.delete(id), 60_000)
  const s = useStore.getState()
  const wasActive = id === activeSpaceId()
  if (wasActive) {
    if (s.focus) s.endFocus()
    stopSync()
  }
  await forgetSyncState(id)
  await idbDel(slotKey(id)).catch(() => {})
  cacheSlot(id, undefined)
  const remaining = s.households.filter((h) => h.id !== id)
  useStore.setState({ households: remaining })

  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user.id
    if (uid) await supabase.from("household_members").delete().eq("household_id", id).eq("user_id", uid)
  }

  if (!wasActive) return
  if (remaining[0]) return show(remaining[0].id, remaining[0])
  const local = await idbGet<Slot>(slotKey(LOCAL)).catch(() => undefined)
  if (local && hasData(local)) {
    useStore.setState({ hasLocalSpace: false })
    return show(LOCAL, undefined)
  }
  // Nothing left on this phone: back to the welcome screen
  withoutSync(() => useStore.getState().resetAll())
}

/** Leave every household and wipe this phone. */
export async function eraseThisPhone() {
  const ids = useStore.getState().households.map((h) => h.id)
  for (const id of ids) leaving.add(id)
  setTimeout(() => ids.forEach((id) => leaving.delete(id)), 60_000)
  stopSync()
  for (const id of ids) {
    await forgetSyncState(id)
    await idbDel(slotKey(id)).catch(() => {})
  }
  await idbDel(slotKey(LOCAL)).catch(() => {})
  useParked.setState({ spaces: {} })
  if (supabase && ids.length) {
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user.id
    if (uid) await supabase.from("household_members").delete().eq("user_id", uid).in("household_id", ids).then(() => {}, () => {})
  }
  withoutSync(() => useStore.getState().resetAll())
}

/**
 * Ask the server which households this phone belongs to, so names and codes stay
 * current and a household joined on an older version reappears in the switcher.
 */
export async function refreshMemberships() {
  if (!supabase) return
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session) return // never synced: don't create an account just to look
  const { data, error } = await supabase.from("households").select("id,name,join_code")
  // A join/leave/switch may have changed things while we were asking; try again next time
  if (error || !data || switching) return
  const server = (data as HouseRow[]).map(toHousehold).filter((h) => !leaving.has(h.id))
  const s = useStore.getState()
  const activeId = activeSpaceId()
  const known = new Map(s.households.map((h) => [h.id, h]))
  let changed = false
  const gone: string[] = []
  const next = s.households.flatMap((h) => {
    const fresh = server.find((x) => x.id === h.id)
    if (!fresh) {
      // The server says this phone isn't in it any more (left on another version, or removed).
      // Keep the one on screen so its sync error explains what happened.
      if (h.id === activeId) return [h]
      gone.push(h.id)
      changed = true
      return []
    }
    if (fresh.name !== h.name || fresh.joinCode !== h.joinCode) {
      changed = true
      return [fresh]
    }
    return [h]
  })
  for (const h of server) {
    if (!known.has(h.id)) {
      next.push(h)
      changed = true
    }
  }
  if (!changed) return
  const active = s.household && next.find((h) => h.id === s.household!.id)
  useStore.setState({ households: next, ...(active ? { household: active } : {}) })
  for (const id of gone) {
    cacheSlot(id, undefined)
    await forgetSyncState(id)
    await idbDel(slotKey(id)).catch(() => {})
  }
}

/** Households this phone is in the middle of leaving; never re-add them from the server. */
const leaving = new Set<string>()

export async function newJoinCode(): Promise<string> {
  const h = useStore.getState().household
  if (!supabase || !h) throw new Error("Not in a household")
  const { data, error } = await supabase.rpc("rotate_join_code", { p_household: h.id })
  if (error) throw new Error(friendlyError(error))
  useStore.getState().setHousehold({ ...h, joinCode: data as string })
  return data as string
}

/** Rename the household on screen. Everyone in it sees the new name. */
export async function renameHousehold(name: string) {
  const h = useStore.getState().household
  const clean = name.trim().slice(0, 80)
  if (!supabase || !h) return
  if (!clean) throw new Error("Give the household a name")
  const { error } = await supabase.from("households").update({ name: clean }).eq("id", h.id)
  if (error) throw new Error(friendlyError(error))
  useStore.getState().setHousehold({ ...h, name: clean })
}

const normName = (n: string) => n.trim().replace(/\s+/g, " ").toLocaleLowerCase()

/** Other households on this phone with the same name (ignoring case and extra spaces). */
export function sameNamed(name: string, list: Household[] = useStore.getState().households, exceptId?: string): Household[] {
  return list.filter((h) => h.id !== exceptId && normName(h.name) === normName(name))
}

/**
 * The name to show for a household. When another household on this phone has
 * the same name, add the start of its join code so the two can be told apart.
 */
export function displayName(h: Household, list: Household[] = useStore.getState().households): string {
  return sameNamed(h.name, list, h.id).length ? `${h.name} · ${h.joinCode.slice(0, 4)}` : h.name
}

/** A distinct name to suggest, based on the person using this phone. */
export function suggestName(personName: string | undefined, list: Household[] = useStore.getState().households): string {
  const who = personName?.trim()
  const options = who ? [`${who}'s family`, `${who}'s household`, `${who}'s home`] : ["Our family", "Our household", "Our home"]
  return options.find((o) => !sameNamed(o, list).length) ?? `${options[0]} 2`
}

export function joinLink(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(code)}`
}
