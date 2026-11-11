import type { ReactNode } from "react"
import { CalendarClock, Link2, Lock, Repeat } from "lucide-react"
import NumberFlow from "@number-flow/react"
import { formatDue } from "@/lib/format"
import { scoreTone } from "@/lib/priority"
import type { Member } from "@/lib/types"
import { cn } from "@/lib/utils"

export function MemberAvatar({ member, size = "md", ring }: { member?: Member; size?: "xs" | "sm" | "md" | "lg"; ring?: boolean }) {
  const s = { xs: "size-5 text-[11px]", sm: "size-7 text-sm", md: "size-9 text-lg", lg: "size-14 text-3xl" }[size]
  if (!member) return null
  return (
    <span
      title={member.name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full select-none",
        s,
        ring && "ring-2 ring-background",
      )}
      style={{ background: `color-mix(in oklch, ${member.color} 22%, var(--card))` }}
    >
      {member.emoji}
    </span>
  )
}

export function AvatarStack({ members, size = "xs" }: { members: Member[]; size?: "xs" | "sm" }) {
  if (!members.length) return null
  return (
    <span className="flex -space-x-1.5">
      {members.slice(0, 3).map((m) => (
        <MemberAvatar key={m.id} member={m} size={size} ring />
      ))}
    </span>
  )
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone = scoreTone(score)
  return (
    <span
      title="Priority score (0–100)"
      className={cn(
        "inline-flex h-7 min-w-10 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums",
        tone === "hot" && "bg-hot/15 text-hot",
        tone === "warm" && "bg-warm/20 text-[color-mix(in_oklch,var(--warm)_70%,var(--foreground))]",
        tone === "calm" && "bg-calm/15 text-calm",
        className,
      )}
    >
      <NumberFlow value={score} />
    </span>
  )
}

export function DueChip({ iso, recurring }: { iso?: string; recurring?: boolean }) {
  const due = formatDue(iso)
  if (!due) return null
  return (
    <Chip
      icon={recurring ? <Repeat /> : <CalendarClock />}
      className={cn(due.tone === "overdue" && "bg-hot/12 text-hot", due.tone === "soon" && "bg-warm/18")}
    >
      {due.label}
    </Chip>
  )
}

export function Chip({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium whitespace-nowrap text-muted-foreground [&_svg]:size-3.5",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function BlockedChip({ count }: { count: number }) {
  return (
    <Chip icon={<Lock />} className="bg-foreground/8">
      Waiting on {count}
    </Chip>
  )
}

export function UnblocksChip({ count }: { count: number }) {
  return (
    <Chip icon={<Link2 />} className="bg-primary/12 text-primary">
      Unblocks {count}
    </Chip>
  )
}

/** A small, accessible segmented control. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T
  onChange(v: T): void
  options: { value: T; label: ReactNode; hint?: string }[]
  className?: string
  size?: "sm" | "md"
}) {
  return (
    <div role="radiogroup" className={cn("flex gap-1 rounded-xl bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-w-0 flex-1 truncate rounded-lg px-2 font-medium text-muted-foreground transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            size === "md" ? "h-9 text-sm" : "h-7 text-xs",
            value === o.value && "bg-card text-foreground shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${Math.round(value * 100)}%`, background: color }}
      />
    </div>
  )
}

export function EmptyState({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 text-5xl">{emoji}</div>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}
