import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { addDays } from "date-fns"
import { isExpiredDone, isOpenEnded, nextOccurrence, periodStart } from "./schedule"
import { dayKey, storage, uid } from "./storage"
import type { FocusSession, ListItem, Member, Project, Settings, Task } from "./types"

export const MEMBER_COLORS = ["#e8590c", "#7048e8", "#0c8599", "#d6336c", "#2f9e44", "#1c7ed6", "#f08c00", "#5f3dc4"]
export const MEMBER_EMOJI = ["🦊", "🦉", "🐢", "🐝", "🐙", "🦋", "🐻", "🐧"]

export type NewTask = Partial<Task> & Pick<Task, "title">

interface State {
  hydrated: boolean
  onboarded: boolean
  members: Member[]
  projects: Project[]
  tasks: Task[]
  /** Items on lists attached to tasks */
  listItems: ListItem[]
  settings: Settings
  focus?: FocusSession
  /** yyyy-mm-dd → count of completions, per member */
  history: Record<string, Record<string, number>>
  /** The household currently shown on this phone (undefined = this phone only) */
  household?: Household
  /** Every household this phone belongs to; each one's lists are kept separately */
  households: Household[]
  /** True when there is a "this phone only" list set aside while viewing a household */
  hasLocalSpace: boolean
}

export interface Household {
  id: string
  name: string
  joinCode: string
}

interface Actions {
  finishOnboarding(members: Omit<Member, "id">[], seed: boolean): void
  addMember(m: Omit<Member, "id">): string
  updateMember(id: string, patch: Partial<Member>): void
  removeMember(id: string): void
  addProject(p: Omit<Project, "id">): string
  updateProject(id: string, patch: Partial<Project>): void
  removeProject(id: string): void
  addTask(t: NewTask): string
  updateTask(id: string, patch: Partial<Task>): void
  removeTask(id: string): Task | undefined
  restoreTask(t: Task): void
  toggleStep(taskId: string, stepId: string): void
  setStatus(id: string, status: Task["status"]): void
  /** Returns the id of the next occurrence for recurring tasks */
  completeTask(id: string, memberId?: string): string | undefined
  /** Put a completed task back. undo = quietly reverse a mis-tap (no "reopened by" tag). */
  reopenTask(id: string, opts?: { undo?: boolean }): void
  /** "Do it again": a fresh one-time copy of a task (and its list), leaving the original as it is */
  repeatTask(id: string): string | undefined
  /** Daily housekeeping: fresh starts for open-ended repeating tasks, clear away old finished ones */
  tidy(now?: Date): void
  addListItem(taskId: string, text: string): string
  updateListItem(id: string, patch: Partial<ListItem>): void
  removeListItem(id: string): ListItem | undefined
  clearCheckedItems(taskId: string): ListItem[]
  restoreListItems(items: ListItem[]): void
  startFocus(taskId: string, memberId: string, minutes: number): void
  pauseFocus(): void
  resumeFocus(): void
  extendFocus(minutes: number): void
  endFocus(): number
  updateSettings(patch: Partial<Settings>): void
  importData(json: string): void
  exportData(): string
  resetAll(): void
  setHousehold(h?: Household): void
}

const defaultSettings: Settings = {
  wipLimit: 2,
  focusMinutes: 25,
  breakMinutes: 5,
  hyperfocusLimitMin: 90,
  sound: true,
  theme: "system",
}

const initial: State = {
  hydrated: false,
  onboarded: false,
  members: [],
  projects: [],
  tasks: [],
  listItems: [],
  settings: defaultSettings,
  focus: undefined,
  history: {},
  household: undefined,
  households: [],
  hasLocalSpace: false,
}

const nowIso = () => new Date().toISOString()

/** List items of deleted tasks, kept in memory so "Undo" can bring them back */
const removedItems = new Map<string, ListItem[]>()

export function makeTask(t: NewTask): Task {
  const ts = nowIso()
  return {
    id: uid(),
    notes: "",
    assigneeIds: [],
    status: "todo",
    importance: 2,
    estimateMin: 30,
    progress: 0,
    steps: [],
    dependsOn: [],
    energy: "medium",
    resources: [],
    recurrence: "none",
    timeSpentMin: 0,
    createdAt: ts,
    updatedAt: ts,
    ...t,
  }
}

export function focusElapsedMs(f: FocusSession, now = Date.now()): number {
  const pausedNow = f.pausedAt ? now - f.pausedAt : 0
  return Math.max(0, now - f.startedAt - f.pausedMs - pausedNow)
}

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initial,

      finishOnboarding(members, seed) {
        const ms = members.map((m) => ({ ...m, id: uid() }))
        const data = seed ? seedData(ms) : { projects: [], tasks: [] }
        set({
          onboarded: true,
          members: ms,
          projects: data.projects,
          tasks: data.tasks,
          settings: { ...get().settings, currentMemberId: ms[0]?.id },
        })
      },

      addMember(m) {
        const id = uid()
        set((s) => ({ members: [...s.members, { ...m, id }] }))
        return id
      },
      updateMember(id, patch) {
        set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
      },
      removeMember(id) {
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
          tasks: s.tasks.map((t) => ({ ...t, assigneeIds: t.assigneeIds.filter((a) => a !== id) })),
          settings:
            s.settings.currentMemberId === id
              ? { ...s.settings, currentMemberId: s.members.find((m) => m.id !== id)?.id }
              : s.settings,
        }))
      },

      addProject(p) {
        const id = uid()
        set((s) => ({ projects: [...s.projects, { ...p, id }] }))
        return id
      },
      updateProject(id, patch) {
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      },
      removeProject(id) {
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)),
        }))
      },

      addTask(t) {
        const task = makeTask(t)
        set((s) => ({ tasks: [task, ...s.tasks] }))
        return task.id
      },
      updateTask(id, patch) {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowIso() } : t)),
        }))
      },
      removeTask(id) {
        const task = get().tasks.find((t) => t.id === id)
        const items = get().listItems.filter((i) => i.taskId === id)
        if (items.length) removedItems.set(id, items)
        set((s) => ({
          listItems: items.length ? s.listItems.filter((i) => i.taskId !== id) : s.listItems,
          tasks: s.tasks
            .filter((t) => t.id !== id)
            .map((t) => (t.dependsOn.includes(id) ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== id) } : t)),
          focus: s.focus?.taskId === id ? undefined : s.focus,
        }))
        return task
      },
      restoreTask(task) {
        const items = removedItems.get(task.id) ?? []
        removedItems.delete(task.id)
        set((s) => ({
          tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)],
          listItems: items.length ? [...s.listItems.filter((i) => i.taskId !== task.id), ...items] : s.listItems,
        }))
      },
      toggleStep(taskId, stepId) {
        const t = get().tasks.find((x) => x.id === taskId)
        if (!t) return
        get().updateTask(taskId, {
          steps: t.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)),
          status: t.status === "todo" ? "doing" : t.status,
        })
      },
      setStatus(id, status) {
        get().updateTask(id, { status })
      },
      completeTask(id, memberId) {
        const t = get().tasks.find((x) => x.id === id)
        if (!t) return
        const day = dayKey()
        const who = memberId ?? get().settings.currentMemberId ?? "anon"
        const extra: Task[] = []
        const carried: ListItem[] = []
        if (t.recurrence !== "none") {
          const next = nextOccurrence(t)
          extra.push(
            makeTask({
              ...t,
              id: uid(),
              status: "todo",
              progress: 0,
              steps: t.steps.map((s) => ({ ...s, done: false })),
              dueAt: next.dueAt,
              showFrom: next.showFrom,
              timeSpentMin: 0,
              dailyMin: {},
              resumeNote: undefined,
              completedAt: undefined,
              completedBy: undefined,
              beforeDone: undefined,
              nextOccurrenceId: undefined,
              reopenedBy: undefined,
              reopenedAt: undefined,
            }),
          )
          // Anything not checked off this time stays on the next occurrence's list
          for (const i of get().listItems.filter((x) => x.taskId === id && !x.done)) {
            carried.push({ ...i, id: uid(), taskId: extra[0].id, createdAt: nowIso() })
          }
        }
        set((s) => ({
          tasks: [
            ...extra,
            ...s.tasks.map((x) =>
              x.id === id
                ? {
                    ...x,
                    status: "done" as const,
                    progress: 100,
                    steps: x.steps.map((st) => ({ ...st, done: true })),
                    beforeDone: { status: x.status, progress: x.progress, steps: x.steps },
                    nextOccurrenceId: extra[0]?.id,
                    reopenedBy: undefined,
                    reopenedAt: undefined,
                    completedAt: nowIso(),
                    completedBy: who,
                    updatedAt: nowIso(),
                  }
                : x,
            ),
          ],
          history: {
            ...s.history,
            [day]: { ...s.history[day], [who]: (s.history[day]?.[who] ?? 0) + 1 },
          },
          listItems: carried.length ? [...s.listItems, ...carried] : s.listItems,
          focus: s.focus?.taskId === id ? undefined : s.focus,
        }))
        return extra[0]?.id
      },
      reopenTask(id, opts) {
        const t = get().tasks.find((x) => x.id === id)
        if (!t || t.status !== "done") return
        const me = get().settings.currentMemberId
        // Take back the "done" count from the day and person it was credited to
        const day = t.completedAt ? dayKey(new Date(t.completedAt)) : undefined
        const who = t.completedBy
        // Remove the next occurrence of a repeating task, unless someone already started it
        const next = t.nextOccurrenceId ? get().tasks.find((x) => x.id === t.nextOccurrenceId) : undefined
        const dropNext =
          !!next && next.status === "todo" && next.timeSpentMin === 0 && !next.steps.some((st) => st.done) && next.progress === 0
        const before = t.beforeDone
        set((s) => {
          const history = { ...s.history }
          if (day && who && history[day]?.[who]) {
            const dayMap = { ...history[day] }
            dayMap[who] = Math.max(0, dayMap[who] - 1)
            if (!dayMap[who]) delete dayMap[who]
            history[day] = dayMap
          }
          return {
            history,
            tasks: s.tasks
              .filter((x) => !(dropNext && x.id === next!.id))
              .map((x) =>
                x.id === id
                  ? {
                      ...x,
                      status: before && before.status !== "done" ? before.status : "todo",
                      progress: before?.progress ?? 0,
                      steps: before?.steps ?? x.steps.map((st) => ({ ...st, done: false })),
                      beforeDone: undefined,
                      nextOccurrenceId: undefined,
                      completedAt: undefined,
                      completedBy: undefined,
                      reopenedBy: opts?.undo ? undefined : me,
                      reopenedAt: opts?.undo ? undefined : nowIso(),
                      updatedAt: nowIso(),
                    }
                  : x,
              ),
            listItems: dropNext ? s.listItems.filter((i) => i.taskId !== next!.id) : s.listItems,
          }
        })
      },

      repeatTask(id) {
        const t = get().tasks.find((x) => x.id === id)
        if (!t) return
        const copy = makeTask({
          title: t.title,
          notes: t.notes,
          projectId: t.projectId,
          assigneeIds: t.assigneeIds,
          importance: t.importance,
          estimateMin: t.estimateMin,
          energy: t.energy,
          resources: t.resources,
          steps: t.steps.map((s) => ({ ...s, id: uid(), done: false })),
          // One time only, no deadline carried over: set a new date in the editor if it needs one
        })
        const ts = nowIso()
        const items = get()
          .listItems.filter((i) => i.taskId === id)
          .map((i) => ({ ...i, id: uid(), taskId: copy.id, done: false, doneBy: undefined, createdAt: ts }))
        set((s) => ({ tasks: [copy, ...s.tasks], listItems: items.length ? [...s.listItems, ...items] : s.listItems }))
        return copy.id
      },

      tidy(now = new Date()) {
        const s = get()
        const withList = new Set(s.listItems.map((i) => i.taskId))
        // Finished over a week ago: clear away, unless a list is attached (kept as a saved list)
        const drop = new Set(s.tasks.filter((t) => isExpiredDone(t, now.getTime()) && !withList.has(t.id)).map((t) => t.id))
        let changed = drop.size > 0
        const ts = nowIso()
        const cleared = new Map<string, number>()
        for (const t of s.tasks) if (drop.has(t.id) && t.projectId) cleared.set(t.projectId, (cleared.get(t.projectId) ?? 0) + t.estimateMin)
        const tasks = s.tasks
          .filter((t) => !drop.has(t.id))
          .map((t) => {
            let out = t
            if (drop.size && t.dependsOn.some((d) => drop.has(d))) out = { ...out, dependsOn: out.dependsOn.filter((d) => !drop.has(d)) }
            if (t.status === "done" || !isOpenEnded(t)) return out
            const start = periodStart(t.recurrence, now)
            if (!t.showFrom) {
              changed = true
              return { ...out, showFrom: start.toISOString(), updatedAt: ts }
            }
            // Its day or week went by: no "overdue", it simply starts fresh for this one
            if (new Date(t.showFrom) < start && s.focus?.taskId !== t.id) {
              changed = true
              return {
                ...out,
                showFrom: start.toISOString(),
                status: t.status === "parked" ? ("parked" as const) : ("todo" as const),
                progress: 0,
                steps: t.steps.map((st) => ({ ...st, done: false })),
                timeSpentMin: 0,
                reopenedBy: undefined,
                reopenedAt: undefined,
                updatedAt: ts,
              }
            }
            return out
          })
        if (!changed) return
        set({
          tasks,
          projects: cleared.size
            ? s.projects.map((p) => (cleared.has(p.id) ? { ...p, clearedMin: (p.clearedMin ?? 0) + cleared.get(p.id)! } : p))
            : s.projects,
        })
      },

      addListItem(taskId, text) {
        const id = uid()
        set((s) => {
          const order = Math.max(0, ...s.listItems.filter((i) => i.taskId === taskId).map((i) => i.order)) + 1
          return {
            listItems: [
              ...s.listItems,
              { id, taskId, text, done: false, order, addedBy: s.settings.currentMemberId, createdAt: nowIso() },
            ],
          }
        })
        return id
      },
      updateListItem(id, patch) {
        set((s) => ({
          listItems: s.listItems.map((i) =>
            i.id === id
              ? { ...i, ...patch, ...(patch.done !== undefined ? { doneBy: patch.done ? s.settings.currentMemberId : undefined } : {}) }
              : i,
          ),
        }))
      },
      removeListItem(id) {
        const item = get().listItems.find((i) => i.id === id)
        set((s) => ({ listItems: s.listItems.filter((i) => i.id !== id) }))
        return item
      },
      clearCheckedItems(taskId) {
        const gone = get().listItems.filter((i) => i.taskId === taskId && i.done)
        set((s) => ({ listItems: s.listItems.filter((i) => !(i.taskId === taskId && i.done)) }))
        return gone
      },
      restoreListItems(items) {
        const ids = new Set(items.map((i) => i.id))
        set((s) => ({ listItems: [...s.listItems.filter((i) => !ids.has(i.id)), ...items] }))
      },

      startFocus(taskId, memberId, minutes) {
        const t = get().tasks.find((x) => x.id === taskId)
        if (t && t.status !== "doing") get().updateTask(taskId, { status: "doing" })
        set({ focus: { taskId, memberId, startedAt: Date.now(), durationMin: minutes, pausedMs: 0 } })
      },
      pauseFocus() {
        const f = get().focus
        if (f && !f.pausedAt) set({ focus: { ...f, pausedAt: Date.now() } })
      },
      resumeFocus() {
        const f = get().focus
        if (f?.pausedAt) set({ focus: { ...f, pausedMs: f.pausedMs + (Date.now() - f.pausedAt), pausedAt: undefined } })
      },
      extendFocus(minutes) {
        const f = get().focus
        if (!f) return
        // Log the time already spent, then restart the clock for a fresh block.
        get().endFocus()
        set({ focus: { ...f, startedAt: Date.now(), durationMin: minutes, pausedMs: 0, pausedAt: undefined } })
      },
      endFocus() {
        const f = get().focus
        if (!f) return 0
        const mins = Math.round(Math.min(focusElapsedMs(f), f.durationMin * 60000) / 60000)
        const t = get().tasks.find((x) => x.id === f.taskId)
        if (t && mins > 0) {
          const day = dayKey()
          get().updateTask(t.id, {
            timeSpentMin: t.timeSpentMin + mins,
            dailyMin: { ...t.dailyMin, [day]: (t.dailyMin?.[day] ?? 0) + mins },
          })
        }
        set({ focus: undefined })
        return mins
      },

      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },
      exportData() {
        const { members, projects, tasks, listItems, settings, history } = get()
        return JSON.stringify({ app: "hearth", version: 2, exportedAt: nowIso(), members, projects, tasks, listItems, settings, history }, null, 2)
      },
      importData(json) {
        const d = JSON.parse(json)
        if (d.app !== "hearth" || !Array.isArray(d.tasks)) throw new Error("This doesn't look like a Hearth backup.")
        set({
          onboarded: true,
          members: d.members ?? [],
          projects: d.projects ?? [],
          tasks: d.tasks,
          listItems: d.listItems ?? [],
          settings: { ...defaultSettings, ...d.settings },
          history: d.history ?? {},
          focus: undefined,
        })
      },
      resetAll() {
        set({ ...initial, hydrated: true })
      },
      setHousehold(household) {
        set((s) => ({
          household,
          // Keep the list entry in step (renames, new join codes)
          households: household ? s.households.map((h) => (h.id === household.id ? household : h)) : s.households,
        }))
      },
    }),
    {
      name: "hearth-v1",
      version: 2,
      migrate: (persisted, version) => {
        const st = persisted as Partial<State>
        if (version < 2) {
          st.households = st.household ? [st.household] : []
          st.hasLocalSpace = false
        }
        return st as State & Actions
      },
      storage: createJSONStorage(() => storage),
      partialize: ({ hydrated: _h, ...rest }) => rest,
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
)

/* ------------------------------------------------------------------ */
/* Example data, so a new family sees how Hearth works                 */
/* ------------------------------------------------------------------ */

function seedData(ms: Member[]): { projects: Project[]; tasks: Task[] } {
  const [a, b, c] = ms
  const at = (days: number, hour = 18) => {
    const d = addDays(new Date(), days)
    d.setHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  const step = (title: string, done = false) => ({ id: uid(), title, done })
  const home: Project = { id: uid(), name: "Home & chores", emoji: "🏡", color: "#e8590c" }
  const novel: Project = { id: uid(), name: "Novel: The Lantern Coast", emoji: "✍️", color: "#7048e8", description: "Second draft, chapters 1–12" }
  const planter: Project = { id: uid(), name: "3D printed planter set", emoji: "🪴", color: "#2f9e44", description: "Three nesting planters with drip trays" }

  const model = makeTask({
    title: "Model the planter in Blender",
    projectId: planter.id,
    assigneeIds: [a?.id].filter(Boolean) as string[],
    importance: 3,
    estimateMin: 180,
    energy: "high",
    resources: ["Desk PC"],
    status: "doing",
    steps: [step("Block out base shape", true), step("Add drainage holes", true), step("Model drip tray"), step("Export STL")],
    dueAt: at(2),
    resumeNote: "Drip tray: start from the base curve, offset 4mm.",
    timeSpentMin: 95,
  })
  const print = makeTask({
    title: "Slice & print the first planter",
    projectId: planter.id,
    assigneeIds: [a?.id].filter(Boolean) as string[],
    importance: 2,
    estimateMin: 60,
    energy: "low",
    resources: ["3D printer"],
    dependsOn: [model.id],
    dueAt: at(4),
  })
  const paint = makeTask({
    title: "Sand & paint planters",
    projectId: planter.id,
    assigneeIds: [a?.id, c?.id].filter(Boolean) as string[],
    importance: 2,
    estimateMin: 120,
    energy: "medium",
    resources: ["Workshop"],
    dependsOn: [print.id],
    dueAt: at(9),
  })
  const ch4 = makeTask({
    title: "Revise chapter 4 opening",
    projectId: novel.id,
    assigneeIds: [a?.id].filter(Boolean) as string[],
    importance: 3,
    estimateMin: 90,
    energy: "high",
    resources: ["Desk PC", "Quiet time"],
    progress: 60,
    dueAt: at(1, 21),
  })
  const outline = makeTask({
    title: "Outline chapters 5–6",
    projectId: novel.id,
    assigneeIds: [a?.id].filter(Boolean) as string[],
    importance: 2,
    estimateMin: 60,
    energy: "medium",
    resources: ["Quiet time"],
    dependsOn: [ch4.id],
  })
  const dishes = makeTask({
    title: "Unload the dishwasher",
    projectId: home.id,
    assigneeIds: [c?.id ?? a?.id].filter(Boolean) as string[],
    importance: 2,
    estimateMin: 10,
    energy: "low",
    recurrence: "daily",
    dueAt: at(0, 19),
  })
  const laundry = makeTask({
    title: "Fold & put away laundry",
    projectId: home.id,
    assigneeIds: [b?.id ?? a?.id].filter(Boolean) as string[],
    importance: 2,
    estimateMin: 25,
    energy: "low",
    recurrence: "weekly",
    steps: [step("Fold towels"), step("Fold clothes"), step("Put everything away")],
    dueAt: at(1, 12),
  })
  const groceries = makeTask({
    title: "Plan meals & grocery list",
    projectId: home.id,
    assigneeIds: [b?.id ?? a?.id].filter(Boolean) as string[],
    importance: 3,
    estimateMin: 30,
    energy: "medium",
    dueAt: at(0, 20),
  })
  const shop = makeTask({
    title: "Grocery run",
    projectId: home.id,
    assigneeIds: [b?.id, c?.id].filter(Boolean) as string[],
    importance: 3,
    estimateMin: 60,
    energy: "medium",
    resources: ["Car"],
    dependsOn: [groceries.id],
    dueAt: at(1, 17),
  })
  const science = makeTask({
    title: "Science fair poster",
    assigneeIds: [c?.id ?? a?.id].filter(Boolean) as string[],
    importance: 4,
    estimateMin: 150,
    energy: "high",
    progress: 0,
    steps: [step("Pick the 3 key results"), step("Print photos"), step("Lay out poster"), step("Write captions")],
    dueAt: at(3, 8),
  })
  const closet = makeTask({
    title: "Reorganize the hall closet",
    projectId: home.id,
    importance: 1,
    estimateMin: 90,
    energy: "medium",
  })

  return {
    projects: [home, novel, planter],
    tasks: [model, print, paint, ch4, outline, dishes, laundry, groceries, shop, science, closet],
  }
}

if (import.meta.env.DEV) (window as unknown as { __hearth: typeof useStore }).__hearth = useStore
