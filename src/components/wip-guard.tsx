import { useMemo } from "react"
import { ArrowRight, Check, Home, PauseCircle, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/responsive-modal"
import { Chip, ProgressBar } from "@/components/bits"
import { startedElsewhere } from "@/hooks/use-combined"
import { actIn, completeTask, parkTask } from "@/lib/actions"
import { useParked } from "@/lib/households"
import { taskProgress } from "@/lib/priority"
import { useStore } from "@/lib/store"
import { useUI } from "@/lib/ui"

/** Shown when someone tries to start a new task while their hands are already full. */
export function WipGuard() {
  const pending = useUI((u) => u.wipPending)
  const setPending = useUI((u) => u.setWipPending)
  const editTask = useUI((u) => u.editTask)
  const tasks = useStore((s) => s.tasks)
  const settings = useStore((s) => s.settings)
  const startFocus = useStore((s) => s.startFocus)
  const parked = useParked((p) => p.spaces)
  const me = settings.currentMemberId

  const target = tasks.find((t) => t.id === pending?.taskId)
  const doing = tasks.filter(
    (t) => t.id !== pending?.taskId && t.status === "doing" && (!me || t.assigneeIds.length === 0 || t.assigneeIds.includes(me)),
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elsewhere = useMemo(() => (pending ? startedElsewhere() : []), [pending, parked])
  const total = doing.length + elsewhere.length
  const roomNow = total < settings.wipLimit

  const start = () => {
    if (!pending || !me) return
    startFocus(pending.taskId, me, pending.minutes)
    setPending(undefined)
  }

  return (
    <ResponsiveModal
      open={!!pending}
      onOpenChange={(o) => !o && setPending(undefined)}
      title={roomNow ? "Nice, there's room now" : "Your hands are full"}
      description={
        roomNow
          ? "You made space. Ready to start?"
          : `You've already started ${total} ${total === 1 ? "thing" : "things"}${elsewhere.length ? " across your households" : ""}. Finish or park one before starting “${target?.title ?? "this"}”. Fewer open loops means more actually gets done.`
      }
      footer={
        <>
          {!roomNow && (
            <Button variant="ghost" className="text-muted-foreground md:flex-none" onClick={start}>
              Start anyway
            </Button>
          )}
          <Button disabled={!roomNow} onClick={start}>
            <Play /> Start {target?.title ? `“${target.title}”` : ""}
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {doing.map((t) => (
          <li key={t.id} className="rounded-2xl border bg-card p-3">
            <div className="font-medium">{t.title}</div>
            <ProgressBar value={taskProgress(t)} className="my-2" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => completeTask(t.id)}>
                <Check /> It's done
              </Button>
              <Button size="sm" variant="ghost" onClick={() => parkTask(t.id)}>
                <PauseCircle /> Park it
              </Button>
            </div>
          </li>
        ))}
        {elsewhere.map((x) => (
          <li key={x.taskId} className="rounded-2xl border bg-card/70 p-3">
            <div className="font-medium">{x.title}</div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <Chip icon={<Home />}>{x.spaceName}</Chip>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPending(undefined)
                  void actIn(x.spaceId, x.spaceName, () => editTask(x.taskId))
                }}
              >
                Go to it <ArrowRight />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </ResponsiveModal>
  )
}
