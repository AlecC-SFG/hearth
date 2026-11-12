import { useMemo, useState } from "react"
import { addDays, format, isSameDay, startOfDay } from "date-fns"
import NumberFlow from "@number-flow/react"
import { AlertTriangle, Archive, Brain, Pencil, Plus, Trash2, Wrench } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ResponsiveModal } from "@/components/responsive-modal"
import { EmptyState, ProgressBar } from "@/components/bits"
import { useMe, useRanked, isMine } from "@/hooks/use-ranked"
import { formatMinutes } from "@/lib/format"
import type { Scored } from "@/lib/priority"
import { isUpcoming } from "@/lib/schedule"
import { MEMBER_COLORS, useStore } from "@/lib/store"
import type { Project } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

const PROJECT_EMOJI = ["🏡", "✍️", "🪴", "🎨", "🧊", "🛠️", "📚", "🎸", "🧵", "🚗", "🌱", "💼", "🎮", "🧪", "📷", "🍳"]

interface Clash {
  key: string
  kind: "resource" | "focus"
  title: string
  detail: string
  tasks: Scored[]
}

function findClashes(ranked: Scored[]): Clash[] {
  const out: Clash[] = []
  const open = ranked.filter((s) => s.task.status !== "parked")
  // Same physical/mental resource needed by several tasks due within 48h of each other
  const byRes = new Map<string, Scored[]>()
  for (const s of open) for (const r of s.task.resources) byRes.set(r, [...(byRes.get(r) ?? []), s])
  for (const [res, list] of byRes) {
    const dated = list.filter((s) => s.task.dueAt).sort((a, b) => a.task.dueAt!.localeCompare(b.task.dueAt!))
    const doing = list.filter((s) => s.task.status === "doing")
    let group: Scored[] = []
    for (let i = 0; i < dated.length; i++) {
      for (let j = i + 1; j < dated.length; j++) {
        const gap = Math.abs(new Date(dated[j].task.dueAt!).getTime() - new Date(dated[i].task.dueAt!).getTime())
        if (gap <= 48 * 3600_000) group = [...new Set([...group, dated[i], dated[j]])]
      }
    }
    if (doing.length > 1) group = [...new Set([...group, ...doing])]
    if (group.length > 1) {
      const sorted = group.sort((a, b) => b.score - a.score)
      const total = sorted.reduce((m, s) => m + s.remainingMin, 0)
      out.push({
        key: `r-${res}`,
        kind: "resource",
        title: `${sorted.length} tasks need “${res}” around the same time`,
        detail: `${formatMinutes(total)} of work in total. Do “${sorted[0].task.title}” first: it has the highest priority.`,
        tasks: sorted,
      })
    }
  }
  // Too much deep-focus work due on the same day
  const deep = open.filter((s) => s.task.energy === "high" && s.task.dueAt)
  const byDay = new Map<string, Scored[]>()
  for (const s of deep) {
    const k = format(new Date(s.task.dueAt!), "yyyy-MM-dd")
    byDay.set(k, [...(byDay.get(k) ?? []), s])
  }
  for (const [day, list] of byDay) {
    const total = list.reduce((m, s) => m + s.remainingMin, 0)
    if (list.length > 1 && total > 120) {
      out.push({
        key: `f-${day}`,
        kind: "focus",
        title: `${list.length} deep-focus tasks due ${format(new Date(day + "T12:00"), "EEEE")}`,
        detail: `${formatMinutes(total)} of high-energy work. Move one earlier, or push one back.`,
        tasks: list.sort((a, b) => b.score - a.score),
      })
    }
  }
  return out
}

function WeekLoad({ ranked }: { ranked: Scored[] }) {
  const days = Array.from({ length: 7 }, (_, i) => startOfDay(addDays(new Date(), i)))
  const loads = days.map((d) => ranked.filter((s) => s.task.dueAt && isSameDay(new Date(s.task.dueAt), d)).reduce((m, s) => m + s.remainingMin, 0))
  const overdue = ranked.filter((s) => s.overdue).reduce((m, s) => m + s.remainingMin, 0)
  loads[0] += overdue
  const max = Math.max(240, ...loads)
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-medium">Your week</h3>
        <span className="text-xs text-muted-foreground">work due each day · over 4h is a lot</span>
      </div>
      <div className="flex items-end gap-2">
        {days.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="h-4 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{loads[i] ? formatMinutes(loads[i]) : ""}</span>
            <div className="flex h-20 w-full items-end">
              <div
                className={cn("w-full rounded-t-md rounded-b-sm transition-all", loads[i] > 240 ? "bg-hot" : loads[i] > 120 ? "bg-warm" : "bg-calm/60")}
                style={{ height: `${Math.max(4, (loads[i] / max) * 100)}%`, opacity: loads[i] ? 1 : 0.25 }}
              />
            </div>
            <span className={cn("text-xs", i === 0 ? "font-semibold" : "text-muted-foreground")}>{i === 0 ? "Today" : format(d, "EEE")}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectsView() {
  const me = useMe()
  const ranked = useRanked()
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const setView = useUI((u) => u.setView)
  const setProjectFilter = useUI((u) => u.setProjectFilter)
  const editTask = useUI((u) => u.editTask)
  const [editing, setEditing] = useState<Project | "new" | null>(null)

  const mine = useMemo(() => ranked.filter((s) => isMine(s.task, me?.id)), [ranked, me?.id])
  const clashes = useMemo(() => findClashes(mine), [mine])
  const active = projects.filter((p) => !p.archived)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Projects</h1>
        <Button onClick={() => setEditing("new")}>
          <Plus /> New project
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <WeekLoad ranked={mine} />
        <div className="rounded-2xl border bg-card p-4">
          <h3 className="mb-2 font-medium">Clashes</h3>
          {clashes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clashes. Nothing on your list is fighting over the same tools, space, or headspace this week. 👌
            </p>
          ) : (
            <ul className="space-y-3">
              {clashes.slice(0, 4).map((c) => (
                <li key={c.key} className="flex gap-3">
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", c.kind === "resource" ? "bg-warm/20" : "bg-chart-2/15 text-chart-2")}>
                    {c.kind === "resource" ? <Wrench className="size-4" /> : <Brain className="size-4" />}
                  </span>
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{c.title}</div>
                    <div className="text-muted-foreground">{c.detail}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.tasks.map((s) => (
                        <button key={s.task.id} type="button" onClick={() => editTask(s.task.id)} className="rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-accent">
                          {s.task.title}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {active.length === 0 ? (
        <EmptyState emoji="🗂️" title="No projects yet">
          Projects group related tasks, like a novel, a 3D print set, or the house.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((p) => {
            const pt = tasks.filter((t) => t.projectId === p.id && !isUpcoming(t))
            const open = ranked.filter((s) => s.task.projectId === p.id)
            const total = pt.reduce((m, t) => m + t.estimateMin, p.clearedMin ?? 0)
            const left = open.reduce((m, s) => m + s.remainingMin, 0)
            const pct = total ? (total - left) / total : 0
            const next = open.find((s) => !s.blocked)
            const blockedCount = open.filter((s) => s.blocked).length
            return (
              <article
                key={p.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: p.color }} />
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ background: `color-mix(in oklch, ${p.color} 16%, var(--card))` }}>
                    {p.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg leading-tight font-semibold">{p.name}</h3>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                    <Pencil />
                  </Button>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div className="font-display text-3xl font-semibold tabular-nums">
                    <NumberFlow value={Math.round(pct * 100)} suffix="%" />
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {open.length} open{blockedCount ? ` · ${blockedCount} waiting` : ""}
                    <br />
                    {formatMinutes(left)} of work left
                  </div>
                </div>
                <ProgressBar value={pct} color={p.color} className="mt-2" />
                {next && (
                  <button type="button" onClick={() => editTask(next.task.id)} className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="text-xs text-muted-foreground">Up next</span>
                    <span className="block truncate font-medium">{next.task.title}</span>
                  </button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setProjectFilter(p.id)
                    setView("tasks")
                  }}
                >
                  See all tasks
                </Button>
              </article>
            )
          })}
        </div>
      )}

      <ProjectEditor project={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function ProjectEditor({ project, onClose }: { project: Project | "new" | null; onClose(): void }) {
  const addProject = useStore((s) => s.addProject)
  const updateProject = useStore((s) => s.updateProject)
  const removeProject = useStore((s) => s.removeProject)
  const [draft, setDraft] = useState<Omit<Project, "id">>({ name: "", emoji: "🛠️", color: MEMBER_COLORS[0] })
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = project === "new" ? "new" : (project?.id ?? null)
  if (key !== lastKey) {
    setLastKey(key)
    if (project === "new") setDraft({ name: "", emoji: "🛠️", color: MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)] })
    else if (project) setDraft({ ...project })
  }

  const save = () => {
    if (!draft.name.trim()) return toast.error("Give the project a name")
    if (project === "new") addProject({ ...draft, name: draft.name.trim() })
    else if (project) updateProject(project.id, { ...draft, name: draft.name.trim() })
    onClose()
  }

  return (
    <ResponsiveModal
      open={!!project}
      onOpenChange={(o) => !o && onClose()}
      title={project === "new" ? "New project" : "Edit project"}
      footer={
        <>
          {project && project !== "new" && (
            <>
              <Button
                variant="ghost"
                className="mr-auto text-destructive md:flex-none"
                onClick={() => {
                  removeProject(project.id)
                  toast("Project deleted", { description: "Its tasks were kept." })
                  onClose()
                }}
              >
                <Trash2 /> Delete
              </Button>
              <Button
                variant="ghost"
                className="md:flex-none"
                onClick={() => {
                  updateProject(project.id, { archived: true })
                  toast("Project archived")
                  onClose()
                }}
              >
                <Archive /> Archive
              </Button>
            </>
          )}
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Project name" className="h-11 rounded-xl text-base" />
        <Textarea value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What's the goal? (optional)" rows={2} className="rounded-xl" />
        <div>
          <div className="mb-2 text-sm font-medium">Icon</div>
          <div className="grid grid-cols-8 gap-1.5">
            {PROJECT_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setDraft({ ...draft, emoji: e })}
                className={cn("flex aspect-square items-center justify-center rounded-lg text-xl hover:bg-muted", draft.emoji === e && "bg-primary/15 ring-2 ring-primary")}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Color</div>
          <div className="flex flex-wrap gap-2">
            {MEMBER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setDraft({ ...draft, color: c })}
                className={cn("size-8 rounded-full ring-offset-2 ring-offset-background", draft.color === c && "ring-2 ring-foreground")}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        {project && project !== "new" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5" /> Deleting a project keeps its tasks.
          </p>
        )}
      </div>
    </ResponsiveModal>
  )
}
