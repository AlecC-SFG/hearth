export type Importance = 1 | 2 | 3 | 4
export type Energy = "low" | "medium" | "high"
export type Status = "todo" | "doing" | "parked" | "done"
export type Recurrence = "none" | "daily" | "weekly"

export interface Member {
  id: string
  name: string
  emoji: string
  color: string // css color
}

export interface Project {
  id: string
  name: string
  emoji: string
  color: string
  description?: string
  archived?: boolean
}

export interface Step {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  notes?: string
  projectId?: string
  assigneeIds: string[]
  status: Status
  importance: Importance
  dueAt?: string // ISO
  estimateMin: number
  progress: number // 0-100, used when there are no steps
  steps: Step[]
  dependsOn: string[]
  energy: Energy
  resources: string[]
  recurrence: Recurrence
  /** "Where I left off" — shown first next time the task is picked up */
  resumeNote?: string
  timeSpentMin: number
  /** Minutes spent per day, keyed yyyy-mm-dd (used by the hyperfocus guard) */
  dailyMin?: Record<string, number>
  createdAt: string
  updatedAt: string
  completedAt?: string
  completedBy?: string
}

export interface FocusSession {
  taskId: string
  memberId: string
  startedAt: number
  durationMin: number
  /** Accumulated paused time in ms */
  pausedMs: number
  pausedAt?: number
}

export interface Settings {
  currentMemberId?: string
  wipLimit: number
  focusMinutes: number
  breakMinutes: number
  hyperfocusLimitMin: number
  sound: boolean
  theme: "system" | "light" | "dark"
}

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  1: "Someday",
  2: "Normal",
  3: "Important",
  4: "Critical",
}

export const ENERGY_LABEL: Record<Energy, string> = {
  low: "Low energy",
  medium: "Some focus",
  high: "Deep focus",
}
