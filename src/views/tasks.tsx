import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, CopyPlus, Info, ListChecks, Plus, RotateCcw, Search, Trash2 } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import { reopenWithToast, repeatWithToast } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { EmptyState, MemberAvatar } from "@/components/bits"
import { CheckCircle, TaskRow } from "@/components/task-row"
import { useNow } from "@/hooks/use-media-query"
import { isMine, useMe, useRanked } from "@/hooks/use-ranked"
import { useStore } from "@/lib/store"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"
import { scoreTask, type Scored } from "@/lib/priority"
import { isExpiredDone, isRecentlyDone, isUpcoming, showsFrom, upcomingLabel } from "@/lib/schedule"

function Section({ title, count, children, defaultOpen = true, hint }: { title: string; count: number; children: ReactNode; defaultOpen?: boolean; hint?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  if (count === 0) return null
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-1 text-left"
        aria-expanded={open}
      >
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground tabular-nums">{count}</span>
        {hint && <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>}
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </section>
  )
}

export function PriorityExplainer() {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
        <Info /> How priority works
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="end">
        <p className="font-medium">Every task gets a score from 0 to 100</p>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          <li><b className="text-foreground">Deadline</b>: rises as the time left gets close to the work left.</li>
          <li><b className="text-foreground">Importance</b>: Someday → Critical.</li>
          <li><b className="text-foreground">Blocker</b>: rises when other tasks are waiting on this one.</li>
          <li><b className="text-foreground">Finish line</b>: tasks that are mostly done get a boost, so they get finished before new ones start.</li>
          <li><b className="text-foreground">Quick wins</b>: anything with under 15 minutes left gets a small boost.</li>
          <li><b className="text-foreground">Not before</b>: a task with a start time waits under Later until then.</li>
        </ul>
        <p className="mt-2 text-muted-foreground">Tasks waiting on something sink to the bottom until they're unblocked.</p>
      </PopoverContent>
    </Popover>
  )
}

export function TasksView() {
  const me = useMe()
  const ranked = useRanked()
  const tasks = useStore((s) => s.tasks)
  const members = useStore((s) => s.members)
  const projects = useStore((s) => s.projects)
  const listItems = useStore((s) => s.listItems)
  const openList = useUI((u) => u.openList)
  const newTask = useUI((u) => u.newTask)
  const editTask = useUI((u) => u.editTask)
  const projectFilter = useUI((u) => u.projectFilter)
  const setProjectFilter = useUI((u) => u.setProjectFilter)
  const [who, setWho] = useState<string>("me")
  const [q, setQ] = useState("")

  const match = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (t: Scored["task"]) =>
      (who === "all" ? true : who === "me" ? isMine(t, me?.id) : t.assigneeIds.includes(who)) &&
      (!projectFilter || t.projectId === projectFilter) &&
      (!needle || t.title.toLowerCase().includes(needle) || t.notes?.toLowerCase().includes(needle))
  }, [q, who, me?.id, projectFilter])

  const list = ranked.filter((s) => match(s.task))
  const ready = list.filter((s) => !s.blocked && !s.notYet && s.task.status !== "parked")
  const later = list.filter((s) => !s.blocked && s.notYet && s.task.status !== "parked")
  const blocked = list.filter((s) => s.blocked && s.task.status !== "parked")
  const parked = list.filter((s) => s.task.status === "parked")
  const now = useNow(60_000)
  const done = tasks
    .filter((t) => isRecentlyDone(t, now) && match(t))
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
  // Repeating tasks whose day or week hasn't started: out of the way, but findable
  const upcoming = tasks
    .filter((t) => isUpcoming(t, now) && match(t))
    .sort((a, b) => (showsFrom(a)?.getTime() ?? 0) - (showsFrom(b)?.getTime() ?? 0))
    .map((t) => scoreTask(t, tasks, now))
  // Finished over a week ago but with a list attached: kept until someone deletes it
  const listCount = new Map<string, number>()
  for (const i of listItems) listCount.set(i.taskId, (listCount.get(i.taskId) ?? 0) + 1)
  const saved = tasks
    .filter((t) => isExpiredDone(t, now) && listCount.has(t.id) && match(t))
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
  const deleteSaved = (id: string) => {
    const removed = useStore.getState().removeTask(id)
    if (removed) toast("List deleted", { description: removed.title, action: { label: "Undo", onClick: () => useStore.getState().restoreTask(removed) } })
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Tasks</h1>
        <div className="flex items-center gap-1">
          <PriorityExplainer />
          <Button className="hidden md:inline-flex" onClick={() => newTask({ projectId: projectFilter })}>
            <Plus /> New task
          </Button>
        </div>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="h-10 rounded-xl pl-9" />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          {[{ id: "me", label: "Mine" }, { id: "all", label: "Everyone" }].map((o) => (
            <FilterPill key={o.id} active={who === o.id} onClick={() => setWho(o.id)}>
              {o.label}
            </FilterPill>
          ))}
          {members.map((m) => (
            <FilterPill key={m.id} active={who === m.id} onClick={() => setWho(m.id)}>
              <MemberAvatar member={m} size="xs" /> {m.name}
            </FilterPill>
          ))}
          <span className="mx-1 w-px shrink-0 bg-border" />
          {projects
            .filter((p) => !p.archived)
            .map((p) => (
              <FilterPill
                key={p.id}
                active={projectFilter === p.id}
                onClick={() => setProjectFilter(projectFilter === p.id ? undefined : p.id)}
              >
                {p.emoji} {p.name}
              </FilterPill>
            ))}
        </div>
      </div>

      {ready.length + later.length + blocked.length + parked.length + done.length + upcoming.length + saved.length === 0 ? (
        <EmptyState emoji="📝" title={q ? "No matches" : "Nothing here yet"}>
          {q ? "Try a different search." : "Add your first task with the + button."}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Section title="Ready to go" count={ready.length} hint="highest priority first">
            {ready.map((s) => <TaskRow key={s.task.id} s={s} />)}
          </Section>
          <Section title="Later" count={later.length} hint="not time to start yet">
            {[...later].sort((a, b) => a.task.startAt!.localeCompare(b.task.startAt!)).map((s) => <TaskRow key={s.task.id} s={s} />)}
          </Section>
          <Section title="Waiting on something" count={blocked.length}>
            {blocked.map((s) => <TaskRow key={s.task.id} s={s} />)}
          </Section>
          <Section title="Parked" count={parked.length} defaultOpen={false}>
            {parked.map((s) => <TaskRow key={s.task.id} s={s} />)}
          </Section>
          <Section title="Coming up" count={upcoming.length} defaultOpen={false} hint="repeating tasks show up on their day">
            {upcoming.map((s) => (
              <div key={s.task.id} className="space-y-1">
                <p className="px-1 text-xs text-muted-foreground">Shows up {upcomingLabel(s.task)}</p>
                <TaskRow s={s} showScore={false} />
              </div>
            ))}
          </Section>
          <Section title="Recently done" count={done.length} defaultOpen={done.length <= 5} hint="clears away after 7 days">
            {done.map((t) => {
              const by = members.find((m) => m.id === t.completedBy)
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-2xl border bg-card/60 p-3">
                  <CheckCircle done label={`Mark ${t.title} not done`} onClick={() => reopenWithToast(t.id)} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => editTask(t.id)}>
                    <span className="block truncate text-muted-foreground line-through">{t.title}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {by && <MemberAvatar member={by} size="xs" />}
                      {by ? `${by.name} · ` : ""}
                      {t.completedAt ? formatDistanceToNow(new Date(t.completedAt), { addSuffix: true }) : ""}
                    </span>
                  </button>
                  <Button size="sm" variant="outline" onClick={() => reopenWithToast(t.id)}>
                    <RotateCcw /> Not done yet
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Do “${t.title}” again`} title="Do it again" onClick={() => repeatWithToast(t.id)}>
                    <CopyPlus />
                  </Button>
                </div>
              )
            })}
          </Section>
          <Section title="Saved lists" count={saved.length} defaultOpen={false} hint="from finished tasks, kept until you delete them">
            {saved.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl border bg-card/60 p-3">
                <ListChecks className="size-5 shrink-0 text-muted-foreground" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openList(t.id)}>
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {listCount.get(t.id)} {listCount.get(t.id) === 1 ? "item" : "items"}
                    {t.completedAt ? ` · done ${format(new Date(t.completedAt), "MMM d")}` : ""}
                  </span>
                </button>
                <Button size="sm" variant="outline" onClick={() => openList(t.id)}>
                  Open
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Do “${t.title}” again`} title="Do it again" onClick={() => repeatWithToast(t.id)}>
                  <CopyPlus />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete list: ${t.title}`} title="Delete list" onClick={() => deleteSaved(t.id)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors",
        active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}
