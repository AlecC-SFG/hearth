import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { addDays, addWeeks } from "date-fns"
import { dayKey, storage, uid } from "./storage"
import type { FocusSession, Member, Project, Settings, Task } from "./types"

export const MEMBER_COLORS = ["#e8590c", "#7048e8", "#0c8599", "#d6336c", "#2f9e44", "#1c7ed6", "#f08c00", "#5f3dc4"]
export const MEMBER_EMOJI = ["🦊", "🦉", "🐢", "🐝", "🐙", "🦋", "🐻", "🐧"]

export type NewTask = Partial<Task> & Pick<Task, "title">

interface State {
  hydrated: boolean
  onboarded: boolean
  members: Member[]
  projects: Project[]
  tasks: Task[]
  settings: Settings
  focus?: FocusSession
  /** yyyy-mm-dd → count of completions, per member */
  history: Record<string, Record<string, number>>
  /** Set when this device is part of a synced household */
  household?: Household
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
  reopenTask(id: string): void
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
  settings: defaultSettings,
  focus: undefined,
  history: {},
  household: undefined,
}

const nowIso = () => new Date().toISOString()

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
        set((s) => ({
          tasks: s.tasks
            .filter((t) => t.id !== id)
            .map((t) => (t.dependsOn.includes(id) ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== id) } : t)),
          focus: s.focus?.taskId === id ? undefined : s.focus,
        }))
        return task
      },
      restoreTask(task) {
        set((s) => ({ tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)] }))
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
        if (t.recurrence !== "none") {
          const base = t.dueAt ? new Date(t.dueAt) : new Date()
          const next = t.recurrence === "daily" ? addDays(base, 1) : addWeeks(base, 1)
          extra.push(
            makeTask({
              ...t,
              id: uid(),
              status: "todo",
              progress: 0,
              steps: t.steps.map((s) => ({ ...s, done: false })),
              dueAt: next.toISOString(),
              timeSpentMin: 0,
              dailyMin: {},
              resumeNote: undefined,
              completedAt: undefined,
              completedBy: undefined,
            }),
          )
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
          focus: s.focus?.taskId === id ? undefined : s.focus,
        }))
        return extra[0]?.id
      },
      reopenTask(id) {
        get().updateTask(id, { status: "todo", completedAt: undefined, completedBy: undefined })
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
        const { members, projects, tasks, settings, history } = get()
        return JSON.stringify({ app: "hearth", version: 1, exportedAt: nowIso(), members, projects, tasks, settings, history }, null, 2)
      },
      importData(json) {
        const d = JSON.parse(json)
        if (d.app !== "hearth" || !Array.isArray(d.tasks)) throw new Error("This doesn't look like a Hearth backup.")
        set({
          onboarded: true,
          members: d.members ?? [],
          projects: d.projects ?? [],
          tasks: d.tasks,
          settings: { ...defaultSettings, ...d.settings },
          history: d.history ?? {},
          focus: undefined,
        })
      },
      resetAll() {
        set({ ...initial, hydrated: true })
      },
      setHousehold(household) {
        set({ household })
      },
    }),
    {
      name: "hearth-v1",
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
