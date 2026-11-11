import { differenceInCalendarDays, format, isToday, isTomorrow } from "date-fns"

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h >= 8 && m === 0 && h % 8 === 0) return `${h / 8}d`
  return m ? `${h}h ${m}m` : `${h}h`
}

export function formatDue(iso?: string, now = new Date()): { label: string; tone: "overdue" | "soon" | "later" } | null {
  if (!iso) return null
  const d = new Date(iso)
  const diffH = (d.getTime() - now.getTime()) / 3_600_000
  const time = format(d, "h:mm a").replace(":00", "")
  if (diffH < 0) {
    const days = differenceInCalendarDays(now, d)
    return { label: days >= 1 ? `${days}d overdue` : `Overdue · ${time}`, tone: "overdue" }
  }
  if (isToday(d)) return { label: `Today · ${time}`, tone: "soon" }
  if (isTomorrow(d)) return { label: `Tomorrow · ${time}`, tone: diffH < 24 ? "soon" : "later" }
  const days = differenceInCalendarDays(d, now)
  if (days < 7) return { label: `${format(d, "EEE")} · ${time}`, tone: "later" }
  return { label: format(d, "MMM d"), tone: "later" }
}

/** Value for <input type="datetime-local"> */
export function toLocalInput(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 5) return "Still up"
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}
