import { create } from "zustand"
import type { ConfettiRef } from "@/components/ui/confetti"
import type { Task } from "./types"

export type View = "now" | "tasks" | "projects" | "family"

interface UIState {
  view: View
  setView(v: View): void
  /** task id being edited, "new" for a new task, or undefined */
  editing?: string
  newDefaults?: Partial<Task>
  editTask(id: string): void
  newTask(defaults?: Partial<Task>): void
  closeEditor(): void
  paletteOpen: boolean
  setPaletteOpen(o: boolean): void
  settingsOpen: boolean
  setSettingsOpen(o: boolean): void
  /** Task waiting for the WIP-limit check before it can start */
  wipPending?: { taskId: string; minutes: number }
  setWipPending(p?: { taskId: string; minutes: number }): void
  projectFilter?: string
  setProjectFilter(id?: string): void
  confetti?: ConfettiRef | null
}

export const useUI = create<UIState>()((set) => ({
  view: (() => {
    try {
      return (localStorage.getItem("hearth-view") as View) || "now"
    } catch {
      return "now"
    }
  })(),
  setView(view) {
    try {
      localStorage.setItem("hearth-view", view)
    } catch {
      /* ignore */
    }
    set({ view })
    window.scrollTo({ top: 0 })
  },
  editTask: (id) => set({ editing: id, newDefaults: undefined }),
  newTask: (defaults) => set({ editing: "new", newDefaults: defaults }),
  closeEditor: () => set({ editing: undefined }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setWipPending: (wipPending) => set({ wipPending }),
  setProjectFilter: (projectFilter) => set({ projectFilter }),
}))
