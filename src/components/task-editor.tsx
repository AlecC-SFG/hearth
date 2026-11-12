import { useEffect, useMemo, useState, type ReactNode } from "react"
import { addDays, nextSaturday } from "date-fns"
import { Check, CheckCircle2, ChevronDown, CopyPlus, GripVertical, ListChecks, Lock, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { ResponsiveModal } from "@/components/responsive-modal"
import { MemberAvatar, Segmented } from "@/components/bits"
import { Checklist, useListItems } from "@/components/checklist"
import { deleteTask, reopenWithToast, repeatWithToast } from "@/lib/actions"
import { formatMinutes, fromLocalInput, toLocalInput } from "@/lib/format"
import { createsCycle } from "@/lib/priority"
import { isUpcoming, upcomingLabel } from "@/lib/schedule"
import { makeTask, useStore } from "@/lib/store"
import { uid } from "@/lib/storage"
import type { Energy, Importance, Recurrence, Task } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

const ESTIMATES = [10, 15, 30, 60, 90, 120, 180, 240, 480]

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Pill({ active, onClick, children, className }: { active?: boolean; onClick(): void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/12 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  )
}

function quickDue(kind: "today" | "tomorrow" | "weekend"): string {
  const d = kind === "today" ? new Date() : kind === "tomorrow" ? addDays(new Date(), 1) : nextSaturday(new Date())
  d.setHours(kind === "weekend" ? 10 : 18, 0, 0, 0)
  if (kind === "today" && d.getTime() < Date.now()) d.setHours(23, 0, 0, 0)
  return d.toISOString()
}

/** Today at a given hour (local) */
function atHour(h: number): string {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

export function TaskEditor() {
  const editing = useUI((s) => s.editing)
  const newDefaults = useUI((s) => s.newDefaults)
  const close = useUI((s) => s.closeEditor)
  const tasks = useStore((s) => s.tasks)
  const members = useStore((s) => s.members)
  const projects = useStore((s) => s.projects)
  const me = useStore((s) => s.settings.currentMemberId)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const live = useStore((s) => (editing && editing !== "new" ? s.tasks.find((t) => t.id === editing) : undefined))

  const existing = editing && editing !== "new" ? tasks.find((t) => t.id === editing) : undefined
  const [draft, setDraft] = useState<Task | null>(null)
  const [more, setMore] = useState(false)
  const [stepText, setStepText] = useState("")
  const [resText, setResText] = useState("")
  const [depOpen, setDepOpen] = useState(false)
  const [showList, setShowList] = useState(false)
  const listItems = useListItems(draft?.id)

  useEffect(() => {
    if (!editing) return
    const base = existing ?? makeTask({ title: "", assigneeIds: me ? [me] : [], ...newDefaults })
    setDraft(structuredClone(base))
    setMore(!!existing && (!!existing.projectId || existing.dependsOn.length > 0 || existing.resources.length > 0 || !!existing.notes))
    setStepText("")
    setResText("")
    setDepOpen(false)
    setShowList(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const allResources = useMemo(() => [...new Set(tasks.flatMap((t) => t.resources))].sort(), [tasks])

  if (!draft) return null
  const set = (patch: Partial<Task>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const isNew = editing === "new"

  const save = () => {
    const title = draft.title.trim()
    if (!title) {
      toast.error("Give it a name first")
      return
    }
    const pending = stepText.trim()
    const steps = pending ? [...draft.steps, { id: uid(), title: pending, done: false }] : draft.steps
    const final = { ...draft, title, steps }
    if (isNew) {
      const { createdAt: _c, updatedAt: _u, ...rest } = final
      addTask(rest) // keeps the draft's id, so a list started here stays attached
      toast.success("Added", { description: isUpcoming(final) ? `${title}. It'll show up ${upcomingLabel(final)}.` : title })
    } else {
      // Only save what this form edits. Completion state and focus time may have
      // changed on another phone (or via "Not done yet") while the form was open.
      const {
        status: _st,
        completedAt: _ca,
        completedBy: _cb,
        beforeDone: _bd,
        nextOccurrenceId: _no,
        reopenedBy: _rb,
        reopenedAt: _ra,
        timeSpentMin: _ts,
        dailyMin: _dm,
        createdAt: _cr,
        showFrom: _sf, // kept up to date by the daily tidy-up, not this form
        ...editable
      } = final
      if (live?.status === "done") {
        // Steps were all ticked when it was completed; don't overwrite that snapshot
        delete (editable as Partial<Task>).steps
        delete (editable as Partial<Task>).progress
      }
      updateTask(final.id, editable)
      const saved = useStore.getState().tasks.find((t) => t.id === final.id)
      if (saved && isUpcoming(saved) && (!live || !isUpcoming(live))) {
        toast("Saved", { description: `${title} will show up ${upcomingLabel(saved)}.` })
      }
    }
    close()
  }

  // Cancelling a brand-new task also discards any list started on it
  const dismiss = () => {
    if (isNew) {
      const st = useStore.getState()
      for (const i of st.listItems.filter((x) => x.taskId === draft.id)) st.removeListItem(i.id)
    }
    close()
  }

  const addStep = () => {
    const t = stepText.trim()
    if (!t) return
    set({ steps: [...draft.steps, { id: uid(), title: t, done: false }] })
    setStepText("")
  }
  const addResource = (r: string) => {
    const v = r.trim()
    if (!v || draft.resources.includes(v)) return
    set({ resources: [...draft.resources, v] })
    setResText("")
  }

  const depCandidates = tasks.filter((t) => t.id !== draft.id && t.status !== "done")
  const deps = draft.dependsOn.map((id) => tasks.find((t) => t.id === id)).filter(Boolean) as Task[]

  return (
    <ResponsiveModal
      open={!!editing}
      onOpenChange={(o) => !o && dismiss()}
      title={isNew ? "New task" : "Edit task"}
      className="md:max-w-xl"
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" className="mr-auto text-destructive md:flex-none" onClick={() => deleteTask(draft.id)}>
              <Trash2 /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={dismiss} className="hidden md:inline-flex">
            Cancel
          </Button>
          <Button onClick={save}>{isNew ? "Add task" : "Save"}</Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Input
          autoFocus={isNew}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="What needs doing?"
          className="h-12 rounded-xl text-lg font-medium md:text-lg"
          aria-label="Task title"
        />

        {live?.status === "done" && (
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Done{live.completedBy && members.find((m) => m.id === live.completedBy) ? ` by ${members.find((m) => m.id === live.completedBy)!.name}` : ""}
              </div>
              {live.completedAt && <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(live.completedAt), { addSuffix: true })}</div>}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  repeatWithToast(live.id)
                  close()
                }}
              >
                <CopyPlus /> Do it again
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => reopenWithToast(live.id)}>
                <RotateCcw /> Not done yet
              </Button>
            </div>
          </div>
        )}
        {live?.status !== "done" && live?.reopenedBy && (
          <div className="flex items-center gap-2 rounded-xl bg-warm/15 p-3 text-sm">
            <RotateCcw className="size-4 shrink-0" />
            Reopened by {members.find((m) => m.id === live.reopenedBy)?.name ?? "someone"}
            {live.reopenedAt && <span className="text-muted-foreground">· {formatDistanceToNow(new Date(live.reopenedAt), { addSuffix: true })}</span>}
          </div>
        )}

        {draft.resumeNote && !isNew && (
          <div className="rounded-xl border border-primary/30 bg-primary/8 p-3 text-sm">
            <div className="mb-1 font-medium">📍 Where you left off</div>
            <Textarea
              value={draft.resumeNote}
              onChange={(e) => set({ resumeNote: e.target.value })}
              className="min-h-0 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
              rows={2}
            />
          </div>
        )}

        <Field label="Who's doing it?">
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = draft.assigneeIds.includes(m.id)
              return (
                <Pill
                  key={m.id}
                  active={on}
                  onClick={() =>
                    set({ assigneeIds: on ? draft.assigneeIds.filter((x) => x !== m.id) : [...draft.assigneeIds, m.id] })
                  }
                  className="pl-1"
                >
                  <MemberAvatar member={m} size="xs" /> {m.name}
                </Pill>
              )
            })}
            <Pill active={draft.assigneeIds.length === 0} onClick={() => set({ assigneeIds: [] })}>
              Anyone
            </Pill>
          </div>
        </Field>

        <Field label="How important?">
          <Segmented<Importance>
            value={draft.importance}
            onChange={(importance) => set({ importance })}
            options={[
              { value: 1, label: "Someday" },
              { value: 2, label: "Normal" },
              { value: 3, label: "Important" },
              { value: 4, label: "Critical" },
            ]}
          />
        </Field>

        <Field label="When is it due?">
          <div className="flex flex-wrap gap-2">
            <Pill active={!draft.dueAt} onClick={() => set({ dueAt: undefined })}>
              No date
            </Pill>
            <Pill onClick={() => set({ dueAt: quickDue("today") })}>Today</Pill>
            <Pill onClick={() => set({ dueAt: quickDue("tomorrow") })}>Tomorrow</Pill>
            <Pill onClick={() => set({ dueAt: quickDue("weekend") })}>Weekend</Pill>
          </div>
          <Input
            type="datetime-local"
            value={toLocalInput(draft.dueAt)}
            onChange={(e) => set({ dueAt: fromLocalInput(e.target.value) })}
            className="h-10 rounded-xl"
            aria-label="Due date and time"
          />
        </Field>

        <Field label="Not before" hint="stays off “Your one thing” until then">
          <div className="flex flex-wrap gap-2">
            <Pill active={!draft.startAt} onClick={() => set({ startAt: undefined })}>
              Any time
            </Pill>
            {draft.dueAt ? (
              [1, 2].map((h) => {
                const iso = new Date(new Date(draft.dueAt!).getTime() - h * 3_600_000).toISOString()
                return (
                  <Pill key={h} active={draft.startAt === iso} onClick={() => set({ startAt: iso })}>
                    {h} {h === 1 ? "hour" : "hours"} before it's due
                  </Pill>
                )
              })
            ) : (
              <Pill onClick={() => set({ startAt: atHour(17) })}>This evening</Pill>
            )}
          </div>
          <Input
            type="datetime-local"
            value={toLocalInput(draft.startAt)}
            onChange={(e) => set({ startAt: fromLocalInput(e.target.value) })}
            className="h-10 rounded-xl"
            aria-label="Not before: date and time"
          />
          {draft.startAt && draft.dueAt && draft.startAt >= draft.dueAt && (
            <p className="rounded-xl bg-warm/15 p-2 text-xs">This starts after it's due. Pick an earlier start, or a later due time.</p>
          )}
        </Field>

        <Field label="How long will it take?" hint={`${formatMinutes(draft.estimateMin)} total`}>
          <div className="flex flex-wrap gap-2">
            {ESTIMATES.map((m) => (
              <Pill key={m} active={draft.estimateMin === m} onClick={() => set({ estimateMin: m })}>
                {formatMinutes(m)}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Energy it needs">
          <Segmented<Energy>
            value={draft.energy}
            onChange={(energy) => set({ energy })}
            options={[
              { value: "low", label: "🔋 Low" },
              { value: "medium", label: "⚡ Some" },
              { value: "high", label: "🔥 Deep", hint: "Deep focus" },
            ]}
          />
        </Field>

        {listItems.length > 0 || showList ? (
          <Field label="List" hint="Everyone in the household can edit it">
            <Checklist taskId={draft.id} autoFocus={showList && listItems.length === 0} placeholder="Add an item, e.g. milk, eggs, bread" />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowList(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-left text-sm hover:bg-muted/50"
          >
            <ListChecks className="size-4 text-primary" />
            <span>
              <span className="font-medium">Add a list</span>
              <span className="text-muted-foreground">: groceries, packing, supplies…</span>
            </span>
          </button>
        )}

        <Field label="Tiny steps" hint="Small steps are easier to start">
          <ul className="space-y-1.5">
            {draft.steps.map((s, i) => (
              <li key={s.id} className="group flex items-center gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-2">
                <GripVertical className="size-3.5 text-muted-foreground/50" />
                <button
                  type="button"
                  aria-label={s.done ? "Mark step not done" : "Mark step done"}
                  onClick={() =>
                    set({ steps: draft.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })
                  }
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                    s.done ? "border-success bg-success text-white" : "border-muted-foreground/40",
                  )}
                >
                  {s.done && <Check className="size-3.5" />}
                </button>
                <input
                  value={s.title}
                  onChange={(e) =>
                    set({ steps: draft.steps.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })
                  }
                  className={cn("min-w-0 flex-1 bg-transparent py-1 text-sm outline-none", s.done && "text-muted-foreground line-through")}
                  aria-label={`Step ${i + 1}`}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove step"
                  onClick={() => set({ steps: draft.steps.filter((x) => x.id !== s.id) })}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={stepText}
              onChange={(e) => setStepText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addStep()
                }
              }}
              placeholder={draft.steps.length ? "Add another step" : "What's the very first thing to do?"}
              className="h-9 rounded-xl"
            />
            <Button type="button" variant="secondary" onClick={addStep} aria-label="Add step">
              <Plus />
            </Button>
          </div>
          {draft.steps.length === 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Or set progress by hand</span>
                <span className="font-medium text-foreground tabular-nums">{draft.progress}%</span>
              </div>
              <Slider
                value={draft.progress}
                onValueChange={(v) => set({ progress: Array.isArray(v) ? v[0] : (v as number) })}
                min={0}
                max={100}
                step={5}
              />
            </div>
          )}
        </Field>

        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="flex w-full items-center justify-between rounded-xl border border-dashed px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50"
          aria-expanded={more}
        >
          Project, dependencies, resources & more
          <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} />
        </button>

        {more && (
          <div className="space-y-5">
            <Field label="Project">
              <div className="flex flex-wrap gap-2">
                <Pill active={!draft.projectId} onClick={() => set({ projectId: undefined })}>
                  None
                </Pill>
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <Pill key={p.id} active={draft.projectId === p.id} onClick={() => set({ projectId: p.id })}>
                      {p.emoji} {p.name}
                    </Pill>
                  ))}
              </div>
            </Field>

            <Field label="Waiting on" hint="Tasks that must be finished first">
              {deps.length > 0 && (
                <ul className="space-y-1.5">
                  {deps.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-2.5 text-sm">
                      <Lock className="size-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate">{d.title}</span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove dependency ${d.title}`}
                        onClick={() => set({ dependsOn: draft.dependsOn.filter((x) => x !== d.id) })}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {depOpen ? (
                <Command className="rounded-xl border">
                  <CommandInput placeholder="Search tasks…" autoFocus />
                  <CommandList className="max-h-52">
                    <CommandEmpty>No matching tasks.</CommandEmpty>
                    {depCandidates
                      .filter((t) => !draft.dependsOn.includes(t.id))
                      .map((t) => {
                        const cycle = createsCycle(draft.id, t.id, tasks)
                        return (
                          <CommandItem
                            key={t.id}
                            value={`${t.title} ${t.id}`}
                            disabled={cycle}
                            onSelect={() => {
                              set({ dependsOn: [...draft.dependsOn, t.id] })
                              setDepOpen(false)
                            }}
                          >
                            <span className="flex-1 truncate">{t.title}</span>
                            {cycle && <span className="text-xs text-muted-foreground">would loop</span>}
                          </CommandItem>
                        )
                      })}
                  </CommandList>
                </Command>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setDepOpen(true)}>
                  <Plus /> Add a task it's waiting on
                </Button>
              )}
            </Field>

            <Field label="Resources it uses" hint="Tools, rooms, gear, or headspace">
              <div className="flex flex-wrap gap-2">
                {draft.resources.map((r) => (
                  <span key={r} className="inline-flex h-8 items-center gap-1 rounded-full bg-secondary pr-1 pl-3 text-sm">
                    {r}
                    <button
                      type="button"
                      aria-label={`Remove ${r}`}
                      className="rounded-full p-1 hover:bg-foreground/10"
                      onClick={() => set({ resources: draft.resources.filter((x) => x !== r) })}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {allResources
                  .filter((r) => !draft.resources.includes(r))
                  .slice(0, 6)
                  .map((r) => (
                    <Pill key={r} onClick={() => addResource(r)} className="border-dashed">
                      <Plus className="size-3" /> {r}
                    </Pill>
                  ))}
              </div>
              <Input
                value={resText}
                onChange={(e) => setResText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addResource(resText)
                  }
                }}
                onBlur={() => addResource(resText)}
                placeholder="e.g. 3D printer, Workshop, Car, Quiet time"
                className="h-9 rounded-xl"
              />
            </Field>

            <Field label="Repeats">
              <Segmented<Recurrence>
                value={draft.recurrence}
                onChange={(recurrence) => set({ recurrence })}
                options={[
                  { value: "none", label: "Never" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
            </Field>

            <Field label="Notes">
              <Textarea
                value={draft.notes ?? ""}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Links, details, ideas…"
                rows={3}
                className="rounded-xl"
              />
            </Field>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </ResponsiveModal>
  )
}
