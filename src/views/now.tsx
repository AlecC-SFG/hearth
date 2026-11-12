import { useEffect, useMemo, useState } from "react"
import NumberFlow from "@number-flow/react"
import { ArrowRight, Check, Coffee, Home, ListChecks, MapPin, Play, Plus, RotateCcw, Shuffle, Timer, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar"
import { BorderBeam } from "@/components/ui/border-beam"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Chip, DueChip, EmptyState, ProgressBar, Segmented } from "@/components/bits"
import { TaskRow } from "@/components/task-row"
import { useCombined, type CombinedItem } from "@/hooks/use-combined"
import { useMe } from "@/hooks/use-ranked"
import { actIn, completeTask, requestFocus } from "@/lib/actions"
import { refreshParked } from "@/lib/households"
import { formatMinutes, formatStart, greeting } from "@/lib/format"
import type { Scored, ScorePart } from "@/lib/priority"
import { useStore } from "@/lib/store"
import type { Energy } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

type TimeFilter = "any" | "15" | "30" | "60"
type Scope = "all" | "here"
const SCOPE_KEY = "hearth-now-scope"
type EnergyFilter = "any" | Energy

const ENERGY_RANK: Record<Energy, number> = { low: 0, medium: 1, high: 2 }

function reasonText(p: ScorePart, s: Scored): string {
  switch (p.key) {
    case "urgency":
      return s.overdue ? "It's overdue" : "Deadline is close"
    case "importance":
      return s.task.importance >= 4 ? "Critical" : "Important"
    case "blocker":
      return p.label
    case "finish":
      return `Almost there — ${Math.round(s.progress * 100)}% done`
    case "quick":
      return "Quick win"
    case "started":
      return "You already started"
  }
}

function topReasons(s: Scored): string[] {
  return s.parts
    .filter((p) => p.points >= 5 && !(p.key === "urgency" && !s.task.dueAt))
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((p) => reasonText(p, s))
}

export function NowView() {
  const me = useMe()
  const combined = useCombined()
  const settings = useStore((s) => s.settings)
  const newTask = useUI((u) => u.newTask)
  const openList = useUI((u) => u.openList)
  const editTask = useUI((u) => u.editTask)
  const [time, setTime] = useState<TimeFilter>("any")
  const [energy, setEnergy] = useState<EnergyFilter>("any")
  const [skip, setSkip] = useState(0)
  const [scope, setScopeState] = useState<Scope>(() => {
    try {
      return (localStorage.getItem(SCOPE_KEY) as Scope) || "all"
    } catch {
      return "all"
    }
  })
  const setScope = (v: Scope) => {
    setScopeState(v)
    setSkip(0)
    try {
      localStorage.setItem(SCOPE_KEY, v)
    } catch {
      /* ignore */
    }
  }

  // Coming back to "Now" is a good moment to check the other households
  useEffect(() => {
    void refreshParked()
  }, [])

  const multi = combined.spaces.length > 1
  const all = multi && scope === "all"
  const activeName = combined.spaces.find((x) => x.isActive)?.name ?? "This household"
  const mine = useMemo(() => (all ? combined.items : combined.items.filter((i) => i.isActive)), [all, combined.items])
  const allDoing = mine.filter((s) => s.task.status === "doing")
  const candidates = useMemo(
    () =>
      mine
        .filter((s) => !s.blocked && !s.notYet && s.task.status !== "parked")
        .filter((s) => time === "any" || s.remainingMin <= Number(time))
        .filter((s) => energy === "any" || ENERGY_RANK[s.task.energy] <= ENERGY_RANK[energy])
        .slice(0, 3),
    [mine, time, energy],
  )
  const activeDone = useStore((s) => {
    const k = new Date()
    const key = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, "0")}-${String(k.getDate()).padStart(2, "0")}`
    return s.settings.currentMemberId ? (s.history[key]?.[s.settings.currentMemberId] ?? 0) : 0
  })
  const doneToday = all ? combined.doneToday : activeDone
  const hero: CombinedItem | undefined = candidates[skip]
  const project = hero && hero.projects.find((p) => p.id === hero.task.projectId)
  const nextStep = hero?.task.steps.find((s) => !s.done)
  const heroList = hero?.listItems ?? []
  const heroListLeft = heroList.filter((i) => !i.done).length
  /** Run an action on the hero's task, switching to its household first if needed */
  const act = (item: CombinedItem, fn: () => void) => void actIn(item.spaceId, item.spaceName, fn)
  const doing = allDoing.filter((s) => s.task.id !== hero?.task.id)
  // Soonest task whose start time hasn't come yet, for a kind "next up" when nothing else fits
  const laterToday = mine
    .filter((s) => s.notYet && !s.blocked && s.task.status !== "parked" && s.task.startAt)
    .sort((a, b) => a.task.startAt!.localeCompare(b.task.startAt!))[0]

  const setFilter = (fn: () => void) => {
    fn()
    setSkip(0)
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {greeting()}
            {me ? `, ${me.name}` : ""}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Your one thing</h1>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl font-semibold text-success tabular-nums">
            <NumberFlow value={doneToday} />
          </div>
          <div className="text-xs text-muted-foreground">done today</div>
        </div>
      </header>

      {multi && (
        <Segmented<Scope>
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: `All households (${combined.spaces.length})` },
            { value: "here", label: `Just ${activeName}` },
          ]}
        />
      )}
      {combined.needsIdentity.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed p-3 text-sm">
          <UserRound className="size-4 text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">
            To include {combined.needsIdentity.map((x) => x.name).join(" and ")} here, tell Hearth which person you are there.
          </span>
          {combined.needsIdentity.map((x) => (
            <Button key={x.id} size="sm" variant="outline" onClick={() => void actIn(x.id, x.name, () => {})}>
              Open {x.name}
            </Button>
          ))}
        </div>
      )}

      <section aria-label="What can you do right now?" className="grid gap-2 sm:grid-cols-2">
        <Segmented<TimeFilter>
          size="sm"
          value={time}
          onChange={(v) => setFilter(() => setTime(v))}
          options={[
            { value: "any", label: "Any time" },
            { value: "15", label: "15 min" },
            { value: "30", label: "30 min" },
            { value: "60", label: "1 hour" },
          ]}
        />
        <Segmented<EnergyFilter>
          size="sm"
          value={energy}
          onChange={(v) => setFilter(() => setEnergy(v))}
          options={[
            { value: "any", label: "Any energy" },
            { value: "low", label: "🔋 Low" },
            { value: "medium", label: "⚡ Some" },
            { value: "high", label: "🔥 Lots" },
          ]}
        />
      </section>

      {hero ? (
        <article
          key={hero.task.id}
          className="relative overflow-hidden rounded-3xl border bg-card p-5 shadow-sm animate-in fade-in-0 slide-in-from-bottom-2 md:p-7"
        >
          <BorderBeam size={120} duration={9} colorFrom="var(--primary)" colorTo="var(--warm)" />
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {all && (
                  <Chip icon={<Home />} className={cn(!hero.isActive && "bg-primary/12 text-primary")}>
                    {hero.spaceName}
                  </Chip>
                )}
                {project && (
                  <Chip>
                    {project.emoji} {project.name}
                  </Chip>
                )}
                <DueChip iso={hero.task.dueAt} recurring={hero.task.recurrence !== "none"} />
                {hero.remainingMin > 0 && <Chip>{formatMinutes(hero.remainingMin)} left</Chip>}
              </div>
              <h2 className="font-display text-2xl leading-tight font-semibold text-balance md:text-3xl">{hero.task.title}</h2>
              <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground" aria-label="Why this task">
                {topReasons(hero).map((r) => (
                  <li key={r} className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            {hero.progress > 0 && (
              <AnimatedCircularProgressBar
                value={Math.round(hero.progress * 100)}
                gaugePrimaryColor="var(--primary)"
                gaugeSecondaryColor="var(--muted)"
                className="size-20 shrink-0 text-base md:size-24"
              />
            )}
          </div>

          {hero.task.reopenedBy && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-warm/15 p-3 text-sm">
              <RotateCcw className="size-4 shrink-0" />
              <span>
                <span className="font-medium">{hero.members.find((m) => m.id === hero.task.reopenedBy)?.name ?? "Someone"}</span> says this isn't quite done yet.
              </span>
            </div>
          )}

          {heroList.length > 0 && (
            <button
              type="button"
              onClick={() => act(hero, () => openList(hero.task.id))}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <ListChecks className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Open the list</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {heroList
                    .filter((i) => !i.done)
                    .slice(0, 4)
                    .map((i) => i.text)
                    .join(", ") || "Everything's checked off"}
                </span>
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {heroListLeft} of {heroList.length} left
              </span>
            </button>
          )}

          {hero.task.resumeNote && (
            <div className="mt-4 flex gap-2 rounded-2xl bg-primary/8 p-3 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <span className="font-medium">Where you left off: </span>
                {hero.task.resumeNote}
              </div>
            </div>
          )}

          {nextStep && (
            <button
              type="button"
              onClick={() => act(hero, () => useStore.getState().toggleStep(hero.task.id, nextStep.id))}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left transition-colors hover:border-success hover:bg-success/5"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-muted-foreground/35">
                <Check className="size-3.5 opacity-0" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">Next tiny step</span>
                <span className="font-medium">{nextStep.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {hero.task.steps.filter((s) => s.done).length}/{hero.task.steps.length}
              </span>
            </button>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <div className="flex">
              <Button size="lg" className="h-11 rounded-r-none px-5 text-base" onClick={() => act(hero, () => requestFocus(hero.task.id))}>
                <Play className="fill-current" /> Start · {settings.focusMinutes} min
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="lg" className="h-11 rounded-l-none border-l border-primary-foreground/20 px-2.5" aria-label="Choose focus length" />
                  }
                >
                  <Timer />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Focus for…</DropdownMenuLabel>
                  {[5, 10, 15, 25, 45, 60].map((m) => (
                    <DropdownMenuItem key={m} onClick={() => act(hero, () => requestFocus(hero.task.id, m))}>
                      {m} minutes {m === 5 && <span className="ml-auto text-xs text-muted-foreground">just start</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button size="lg" variant="outline" className="h-11" onClick={() => act(hero, () => completeTask(hero.task.id))}>
              <Check /> It's done
            </Button>
            {candidates.length > 1 && (
              <Button size="lg" variant="ghost" className="h-11 text-muted-foreground" onClick={() => setSkip((i) => i + 1)}>
                <Shuffle /> Not this one
              </Button>
            )}
          </div>
        </article>
      ) : candidates.length > 0 ? (
        <article className="rounded-3xl border bg-card p-5 md:p-7">
          <h2 className="font-display text-2xl font-semibold">Pick one of these three</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            They're all good choices. Choose any one and give it just 10 minutes. Starting is the hardest part.
          </p>
          <div className="mt-4 space-y-2">
            {candidates.map((c) => (
              <button
                key={c.task.id}
                type="button"
                onClick={() => act(c, () => requestFocus(c.task.id, 10))}
                className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.task.title}</span>
                  {all && <span className="block text-xs text-muted-foreground">{c.spaceName}</span>}
                </span>
                <span className="text-sm text-muted-foreground">10 min</span>
                <ArrowRight className="size-4 text-primary" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setSkip(0)}>
              Start over
            </Button>
            <Button variant="ghost" onClick={() => setSkip(0)}>
              <Coffee /> Take a 5 minute break first
            </Button>
          </div>
        </article>
      ) : (
        <div className="rounded-3xl border border-dashed bg-card/50">
          {laterToday && time === "any" && energy === "any" && mine.every((s) => s.notYet || s.blocked || s.task.status === "parked") ? (
            <EmptyState emoji="☕" title="Nothing to start just yet">
              Next up: <span className="font-medium text-foreground">{laterToday.task.title}</span>, {formatStart(laterToday.task.startAt!).replace(/^From/, "from")}. Rest counts too.
            </EmptyState>
          ) : mine.length === 0 ? (
            <EmptyState emoji="🌤️" title="All clear!">
              Nothing on your list right now. Enjoy it, or add something new.
              <div className="mt-4">
                <Button onClick={() => newTask()}>
                  <Plus /> Add a task
                </Button>
              </div>
            </EmptyState>
          ) : (
            <EmptyState emoji="🔍" title="Nothing fits that right now">
              Try a different amount of time or energy, or take a real break. Rest counts too.
            </EmptyState>
          )}
        </div>
      )}

      {doing.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-lg font-semibold">Already started</h3>
            <span
              className={cn(
                "text-sm tabular-nums",
                allDoing.length >= settings.wipLimit ? "font-medium text-hot" : "text-muted-foreground",
              )}
            >
              {allDoing.length} of {settings.wipLimit} started
            </span>
          </div>
          {allDoing.length >= settings.wipLimit && (
            <p className="text-sm text-muted-foreground">
              Your hands are full. Finish or park one of these before starting something new.
            </p>
          )}
          <div className="space-y-2">
            {doing.map((s) =>
              s.isActive ? (
                <TaskRow key={s.task.id} s={s} showScore={false} />
              ) : (
                <button
                  key={s.task.id}
                  type="button"
                  onClick={() => act(s, () => editTask(s.task.id))}
                  className="flex w-full items-start gap-3 rounded-2xl border bg-card/70 p-3 text-left transition-colors hover:border-primary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.task.title}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <Chip icon={<Home />} className="bg-primary/12 text-primary">
                        {s.spaceName}
                      </Chip>
                      <DueChip iso={s.task.dueAt} />
                    </span>
                    {s.progress > 0 && <ProgressBar value={s.progress} className="mt-2.5" />}
                  </span>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </button>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  )
}
