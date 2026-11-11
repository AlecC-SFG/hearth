import { useEffect, useRef, useState } from "react"
import NumberFlow, { NumberFlowGroup } from "@number-flow/react"
import { Check, Coffee, Minimize2, Pause, Play, Plus, Square, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { MemberAvatar } from "@/components/bits"
import { useNow } from "@/hooks/use-media-query"
import { completeTask } from "@/lib/actions"
import { chime, notify, vibrate } from "@/lib/alerts"
import { formatMinutes } from "@/lib/format"
import { taskProgress } from "@/lib/priority"
import { focusElapsedMs, useStore } from "@/lib/store"
import { dayKey } from "@/lib/storage"
import { cn } from "@/lib/utils"

type Phase = "running" | "checkin" | "hyperfocus" | "stopping"

function Clock({ ms }: { ms: number }) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return (
    <NumberFlowGroup>
      <span className="font-display tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
        <NumberFlow value={m} format={{ minimumIntegerDigits: 2 }} />
        <span className="opacity-60">:</span>
        <NumberFlow value={s} format={{ minimumIntegerDigits: 2 }} digits={{ 1: { max: 5 } }} />
      </span>
    </NumberFlowGroup>
  )
}

function Ring({ value, children, className }: { value: number; children: React.ReactNode; className?: string }) {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className={cn("relative", className)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function FocusOverlay() {
  const focus = useStore((s) => s.focus)
  const settings = useStore((s) => s.settings)
  const task = useStore((s) => s.tasks.find((t) => t.id === s.focus?.taskId))
  const member = useStore((s) => s.members.find((m) => m.id === s.focus?.memberId))
  const { pauseFocus, resumeFocus, extendFocus, endFocus, toggleStep, updateTask, setStatus } = useStore.getState()
  const now = useNow(250)
  const [phase, setPhase] = useState<Phase>("running")
  const [minimized, setMinimized] = useState(false)
  const [breakUntil, setBreakUntil] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [progress, setProgress] = useState(0)
  const alerted = useRef<string | null>(null)

  const elapsed = focus ? focusElapsedMs(focus, now) : 0
  const remaining = focus ? focus.durationMin * 60_000 - elapsed : 0
  const todayMin = (task?.dailyMin?.[dayKey()] ?? 0) + Math.round(Math.min(elapsed, (focus?.durationMin ?? 0) * 60_000) / 60000)
  const sessionKey = focus ? `${focus.taskId}-${focus.startedAt}` : null

  // Reset when a new session begins
  useEffect(() => {
    setPhase("running")
    alerted.current = null
  }, [sessionKey])

  // Time's up → check in (or hyperfocus guard)
  useEffect(() => {
    if (!focus || !task || phase !== "running" || focus.pausedAt) return
    if (remaining <= 0 && alerted.current !== sessionKey) {
      alerted.current = sessionKey
      const limit = settings.hyperfocusLimitMin
      setPhase(limit > 0 && todayMin >= limit ? "hyperfocus" : "checkin")
      setMinimized(false)
      if (settings.sound) chime()
      vibrate()
      notify("Time's up ⏱", `How's “${task.title}” going?`)
    }
  }, [remaining, focus, task, phase, sessionKey, settings, todayMin])

  // Break finished
  useEffect(() => {
    if (breakUntil && now >= breakUntil) {
      setBreakUntil(null)
      if (settings.sound) chime()
      vibrate([80, 60, 80])
      notify("Break's over", "Ready for your one thing?")
    }
  }, [now, breakUntil, settings.sound])

  // Countdown in the browser tab title
  useEffect(() => {
    const base = "Hearth"
    if (focus && task && remaining > 0) {
      const t = Math.ceil(remaining / 1000)
      document.title = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} · ${task.title}`
    } else if (breakUntil) document.title = "Break · Hearth"
    else document.title = base
  }, [focus, task, remaining, breakUntil])

  const startBreak = () => {
    endFocus()
    setBreakUntil(Date.now() + settings.breakMinutes * 60_000)
  }
  const beginStop = () => {
    if (!task) return
    setNote(task.resumeNote ?? "")
    setProgress(task.progress)
    setPhase("stopping")
  }
  const saveStop = (park: boolean) => {
    if (!task) return
    updateTask(task.id, { resumeNote: note.trim() || undefined, ...(task.steps.length ? {} : { progress }) })
    endFocus()
    if (park) setStatus(task.id, "parked")
  }

  if (breakUntil) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/97 p-6 text-center backdrop-blur animate-in fade-in-0">
        <Coffee className="mb-4 size-10 text-primary" />
        <h2 className="font-display text-3xl font-semibold">Break time</h2>
        <p className="mt-2 max-w-sm text-muted-foreground">Stand up, stretch, get some water, look out a window. Your task will be right here.</p>
        <div className="mt-8 text-6xl font-semibold">
          <Clock ms={breakUntil - now} />
        </div>
        <Button variant="ghost" className="mt-8" onClick={() => setBreakUntil(null)}>
          End break early
        </Button>
      </div>
    )
  }

  if (!focus || !task) return null
  const pct = Math.min(1, elapsed / (focus.durationMin * 60_000))
  const nextStep = task.steps.find((s) => !s.done)

  if (minimized && phase === "running") {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border bg-foreground py-2 pr-4 pl-2 text-background shadow-lg animate-in slide-in-from-bottom-4 md:bottom-6"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Timer className="size-4" />
        </span>
        <span className="text-lg font-semibold">
          <Clock ms={remaining} />
        </span>
        <span className="truncate text-sm opacity-80">{task.title}</span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background animate-in fade-in-0">
      <div className="mx-auto flex min-h-full max-w-xl flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MemberAvatar member={member} size="sm" />
            Focus session
          </div>
          {phase === "running" && (
            <Button variant="ghost" size="sm" onClick={() => setMinimized(true)}>
              <Minimize2 /> Minimize
            </Button>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <h2 className="font-display text-2xl leading-tight font-semibold text-balance md:text-3xl">{task.title}</h2>

          {phase === "running" && (
            <>
              <Ring value={pct} className="my-8 size-64 md:size-72">
                <div className="text-6xl font-semibold md:text-7xl">
                  <Clock ms={remaining} />
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{focus.pausedAt ? "Paused" : `of ${focus.durationMin} min`}</div>
              </Ring>
              {task.resumeNote && <p className="mb-4 max-w-md rounded-xl bg-primary/8 px-3 py-2 text-sm">📍 {task.resumeNote}</p>}
              {task.steps.length > 0 && (
                <ul className="w-full max-w-md space-y-1.5 text-left">
                  {task.steps.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => toggleStep(task.id, s.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted",
                          s === nextStep && "bg-muted/70 font-medium",
                        )}
                      >
                        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border-2", s.done ? "border-success bg-success text-white" : "border-muted-foreground/40")}>
                          {s.done && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className={cn(s.done && "text-muted-foreground line-through")}>{s.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {phase === "checkin" && (
            <div className="mt-6 w-full max-w-md space-y-3 animate-in fade-in-0 slide-in-from-bottom-2">
              <div className="text-5xl">⏱️</div>
              <h3 className="font-display text-2xl font-semibold">Time's up! How's it going?</h3>
              <p className="text-sm text-muted-foreground">
                {formatMinutes(Math.max(1, todayMin))} on this today · {Math.round(taskProgress(task) * 100)}% done
              </p>
              <div className="grid gap-2 pt-2">
                <Button size="lg" className="h-12 text-base" onClick={() => completeTask(task.id)}>
                  <Check /> I finished it!
                </Button>
                <Button size="lg" variant="outline" className="h-12 text-base" onClick={() => extendFocus(settings.focusMinutes)}>
                  <Plus /> Keep going · {settings.focusMinutes} more min
                </Button>
                <Button size="lg" variant="outline" className="h-12 text-base" onClick={startBreak}>
                  <Coffee /> Take a {settings.breakMinutes} min break
                </Button>
                <Button size="lg" variant="ghost" className="h-12 text-base" onClick={beginStop}>
                  <Square /> Stop and save my place
                </Button>
              </div>
            </div>
          )}

          {phase === "hyperfocus" && (
            <div className="mt-6 w-full max-w-md space-y-3 animate-in fade-in-0 slide-in-from-bottom-2">
              <div className="text-5xl">🌊</div>
              <h3 className="font-display text-2xl font-semibold">You've been deep in this for {formatMinutes(todayMin)}</h3>
              <p className="text-muted-foreground">
                That's real progress. Your brain and body need a reset now: water, a stretch, maybe a snack. Then come back and check whether something else needs you today.
              </p>
              <div className="grid gap-2 pt-2">
                <Button size="lg" className="h-12 text-base" onClick={startBreak}>
                  <Coffee /> Take a {settings.breakMinutes} min break
                </Button>
                <Button size="lg" variant="outline" className="h-12 text-base" onClick={beginStop}>
                  <Square /> Stop and save my place
                </Button>
                <Button size="lg" variant="ghost" className="h-12 text-muted-foreground" onClick={() => extendFocus(10)}>
                  I really need 10 more minutes
                </Button>
              </div>
            </div>
          )}

          {phase === "stopping" && (
            <div className="mt-6 w-full max-w-md space-y-4 text-left animate-in fade-in-0 slide-in-from-bottom-2">
              <div>
                <h3 className="font-display text-2xl font-semibold">Leave a note for future you</h3>
                <p className="text-sm text-muted-foreground">What's the very next thing to do when you come back? It'll be waiting at the top of this task.</p>
              </div>
              <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Start with the drip tray: offset the base curve 4mm" rows={3} className="rounded-xl text-base" />
              {task.steps.length === 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>How far along is it?</span>
                    <span className="font-medium tabular-nums">{progress}%</span>
                  </div>
                  <Slider value={progress} onValueChange={(v) => setProgress(Array.isArray(v) ? v[0] : (v as number))} min={0} max={100} step={5} />
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="lg" onClick={() => saveStop(false)}>
                  Save & stop
                </Button>
                <Button size="lg" variant="outline" onClick={() => saveStop(true)}>
                  Save & park it
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => setPhase(remaining > 0 ? "running" : "checkin")}>
                Back
              </Button>
            </div>
          )}
        </div>

        {phase === "running" && (
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="lg" className="h-12" onClick={() => (focus.pausedAt ? resumeFocus() : pauseFocus())}>
              {focus.pausedAt ? <Play /> : <Pause />} {focus.pausedAt ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" size="lg" className="h-12" onClick={beginStop}>
              <Square /> Stop
            </Button>
            <Button size="lg" className="h-12" onClick={() => completeTask(task.id)}>
              <Check /> Done!
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
