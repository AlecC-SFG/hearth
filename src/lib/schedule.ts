/**
 * "What should I do today?" rules for repeating tasks and finished work.
 *
 * - A repeating task's next occurrence stays out of sight until its own day
 *   (daily) or week (weekly) begins.
 * - A repeating task with no due date is open-ended ("2 hours of writing"):
 *   if its day or week passes without it being done, it quietly starts fresh
 *   for the new day or week instead of going overdue.
 * - Finished tasks show for 7 days, then are cleared away. A finished task that
 *   has a list attached is kept (as a saved list) until someone deletes it.
 */
import { addDays, addWeeks, differenceInCalendarDays, format, startOfDay, startOfWeek } from "date-fns"
import type { Recurrence, Task } from "./types"

export const DONE_KEEP_DAYS = 7
const DAY = 86_400_000

/** Start of the day (daily) or week, Sunday first (weekly), that `d` falls in. */
export function periodStart(r: Recurrence, d: Date): Date {
  return r === "weekly" ? startOfWeek(d) : startOfDay(d)
}

export function nextPeriod(r: Recurrence, d: Date): Date {
  return r === "weekly" ? addWeeks(d, 1) : addDays(d, 1)
}

/** Repeating, with no due date: it never goes overdue, it just starts fresh. */
export function isOpenEnded(t: Task): boolean {
  return t.recurrence !== "none" && !t.dueAt
}

/** When a repeating task's occurrence comes into view (undefined = already in view). */
export function showsFrom(t: Task): Date | undefined {
  if (t.recurrence === "none") return undefined
  if (t.dueAt) return periodStart(t.recurrence, new Date(t.dueAt))
  return t.showFrom ? new Date(t.showFrom) : undefined
}

/** A repeating task whose day or week hasn't started yet. */
export function isUpcoming(t: Task, now = Date.now()): boolean {
  if (t.status === "done") return false
  const from = showsFrom(t)
  return !!from && from.getTime() > now
}

/** "tomorrow", "on Friday", "on Nov 20" */
export function upcomingLabel(t: Task, now = new Date()): string {
  const from = showsFrom(t)
  if (!from) return "today"
  const days = differenceInCalendarDays(from, now)
  if (days <= 0) return "today"
  if (days === 1) return "tomorrow"
  if (days < 7) return `on ${format(from, "EEEE")}`
  return `on ${format(from, "MMM d")}`
}

/**
 * Move a clock time to a new anchor, keeping its day offset and time of day
 * (so 5 PM stays 5 PM across daylight-saving changes).
 */
export function carryTime(iso: string, oldAnchor: Date, newAnchor: Date): string {
  const t = new Date(iso)
  const d = addDays(startOfDay(newAnchor), differenceInCalendarDays(t, oldAnchor))
  d.setHours(t.getHours(), t.getMinutes(), 0, 0)
  return d.toISOString()
}

/** Not startable yet: its "not before" time is still ahead (unless someone already started it). */
export function isNotYet(t: Task, now = Date.now()): boolean {
  return !!t.startAt && t.status !== "doing" && t.status !== "done" && new Date(t.startAt).getTime() > now
}

/**
 * Due date and show-from date for the occurrence after `t`. Never lands in a
 * day or week that has already passed, so a late finish doesn't leave a pile of
 * catch-up copies behind.
 */
export function nextOccurrence(t: Task, now = new Date()): { dueAt?: string; showFrom: string; startAt?: string } {
  const r = t.recurrence
  const current = periodStart(r, now)
  if (t.dueAt) {
    const due = new Date(t.dueAt)
    let next = nextPeriod(r, due)
    while (periodStart(r, next) < current) next = nextPeriod(r, next)
    return {
      dueAt: next.toISOString(),
      showFrom: periodStart(r, next).toISOString(),
      // Same window as before: "from 5 PM" stays "from 5 PM"
      startAt: t.startAt ? carryTime(t.startAt, due, next) : undefined,
    }
  }
  const own = t.showFrom ? periodStart(r, new Date(t.showFrom)) : current
  const base = own > current ? own : current
  const next = nextPeriod(r, base)
  return {
    showFrom: next.toISOString(),
    startAt: t.startAt ? carryTime(t.startAt, periodStart(r, new Date(t.startAt)), next) : undefined,
  }
}

/** Finished long enough ago to clear away (or to move to saved lists). */
export function isExpiredDone(t: Task, now = Date.now()): boolean {
  return t.status === "done" && !!t.completedAt && now - new Date(t.completedAt).getTime() >= DONE_KEEP_DAYS * DAY
}

export function isRecentlyDone(t: Task, now = Date.now()): boolean {
  return t.status === "done" && !isExpiredDone(t, now)
}
