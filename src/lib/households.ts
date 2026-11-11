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
import { enqueueEverything, flushNow, forgetSyncState, startSync, stopSync, withoutSync } from "./sync"
import type { ListItem, Member, Project, Task } from "./types"

export const LOCAL = "local"

interface Slot {
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
}

/** Bring a parked household (or the phone-only list) onto the screen and start syncing it. */
async function show(id: string, household: Household | undefined) {
  const slot = (await idbGet<Slot>(slotKey(id)).catch(() => undefined)) ?? EMPTY
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
  await park()
  await show(id, household)
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
export async function createHousehold(name: string): Promise<Household> {
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
export async function joinHousehold(code: string): Promise<Household> {
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
export async function leaveHousehold(id = activeSpaceId()) {
  if (id === LOCAL) return
  const s = useStore.getState()
  const wasActive = id === activeSpaceId()
  if (wasActive) {
    if (s.focus) s.endFocus()
    stopSync()
  }
  await forgetSyncState(id)
  await idbDel(slotKey(id)).catch(() => {})
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
  stopSync()
  for (const id of ids) {
    await forgetSyncState(id)
    await idbDel(slotKey(id)).catch(() => {})
  }
  await idbDel(slotKey(LOCAL)).catch(() => {})
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
  if (error || !data) return
  const server = (data as HouseRow[]).map(toHousehold)
  const s = useStore.getState()
  const known = new Map(s.households.map((h) => [h.id, h]))
  let changed = false
  const next = s.households.map((h) => {
    const fresh = server.find((x) => x.id === h.id)
    if (fresh && (fresh.name !== h.name || fresh.joinCode !== h.joinCode)) {
      changed = true
      return fresh
    }
    return h
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
