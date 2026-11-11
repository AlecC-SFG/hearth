import type { Task } from "./types"

export interface ScorePart {
  key: "urgency" | "importance" | "blocker" | "finish" | "quick" | "started"
  label: string
  points: number
}

export interface Scored {
  task: Task
  score: number // 0-100
  parts: ScorePart[]
  progress: number // 0-1
  remainingMin: number
  blocked: boolean
  blockedBy: Task[]
  unblocks: Task[] // open tasks waiting on this one (transitive)
  overdue: boolean
}

const HOUR = 3_600_000

export function taskProgress(t: Task): number {
  if (t.status === "done") return 1
  if (t.steps.length) return t.steps.filter((s) => s.done).length / t.steps.length
  return Math.min(1, Math.max(0, t.progress / 100))
}

export function remainingMinutes(t: Task): number {
  return Math.max(0, Math.round(t.estimateMin * (1 - taskProgress(t))))
}

/** All open tasks that (directly or indirectly) wait on `id`. */
function dependentsOf(id: string, open: Task[], seen = new Set<string>()): Task[] {
  const out: Task[] = []
  for (const t of open) {
    if (t.dependsOn.includes(id) && !seen.has(t.id)) {
      seen.add(t.id)
      out.push(t, ...dependentsOf(t.id, open, seen))
    }
  }
  return out
}

/**
 * Holistic priority, 0-100:
 *  - Urgency (≤45): how little slack remains between now, the due time and the work left
 *  - Importance (≤30)
 *  - Blocker (≤25): how much other open work is waiting on this
 *  - Finish line (≤10): reward tasks that are mostly done — finish before starting new things
 *  - Quick win (5): under 15 minutes of work left
 *  - Already started (5)
 * Blocked tasks keep a fraction of their score so they sink below everything actionable.
 */
export function scoreTask(task: Task, all: Task[], now = Date.now()): Scored {
  const byId = new Map(all.map((t) => [t.id, t]))
  const open = all.filter((t) => t.status !== "done")
  const progress = taskProgress(task)
  const remainingMin = remainingMinutes(task)
  const parts: ScorePart[] = []

  // Urgency
  let overdue = false
  if (task.dueAt) {
    const hoursLeft = (new Date(task.dueAt).getTime() - now) / HOUR
    const slack = hoursLeft - remainingMin / 60
    let u: number
    if (hoursLeft < 0) {
      overdue = true
      u = 40 + Math.min(5, (-hoursLeft / 24) * 2)
    } else {
      u = 40 / (1 + Math.max(0, slack) / 24)
    }
    parts.push({ key: "urgency", label: overdue ? "Overdue" : "Due soon", points: u })
  } else {
    parts.push({ key: "urgency", label: "No deadline", points: 3 })
  }

  // Importance
  const imp = [0, 4, 12, 21, 30][task.importance]
  parts.push({ key: "importance", label: "Importance", points: imp })

  // Blocker
  const unblocks = task.status === "done" ? [] : dependentsOf(task.id, open)
  if (unblocks.length) {
    const b = Math.min(25, unblocks.reduce((sum, d) => sum + 5 + d.importance * 1.5, 0))
    parts.push({
      key: "blocker",
      label: `Unblocks ${unblocks.length} ${unblocks.length === 1 ? "task" : "tasks"}`,
      points: b,
    })
  }

  // Finish line — anti task-bouncing
  if (progress >= 0.4 && progress < 1) {
    parts.push({ key: "finish", label: `${Math.round(progress * 100)}% done`, points: 10 * progress })
  }
  if (remainingMin > 0 && remainingMin <= 15) {
    parts.push({ key: "quick", label: "Quick win", points: 5 })
  }
  if (task.status === "doing") {
    parts.push({ key: "started", label: "In progress", points: 5 })
  }

  const blockedBy = task.dependsOn
    .map((id) => byId.get(id))
    .filter((t): t is Task => !!t && t.status !== "done")
  const blocked = blockedBy.length > 0

  let score = parts.reduce((s, p) => s + p.points, 0)
  if (blocked) score *= 0.3
  if (task.status === "parked") score *= 0.6
  score = Math.round(Math.min(100, Math.max(0, score)))

  return { task, score, parts, progress, remainingMin, blocked, blockedBy, unblocks, overdue }
}

export function rankTasks(tasks: Task[], now = Date.now()): Scored[] {
  return tasks
    .filter((t) => t.status !== "done")
    .map((t) => scoreTask(t, tasks, now))
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score)
}

/** Would adding `depId` as a dependency of `taskId` create a cycle? */
export function createsCycle(taskId: string, depId: string, tasks: Task[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const stack = [depId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === taskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(byId.get(id)?.dependsOn ?? []))
  }
  return false
}

export function scoreTone(score: number): "hot" | "warm" | "calm" {
  return score >= 60 ? "hot" : score >= 35 ? "warm" : "calm"
}
