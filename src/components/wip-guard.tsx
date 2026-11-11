import { Check, PauseCircle, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/responsive-modal"
import { ProgressBar } from "@/components/bits"
import { completeTask, parkTask } from "@/lib/actions"
import { taskProgress } from "@/lib/priority"
import { useStore } from "@/lib/store"
import { useUI } from "@/lib/ui"

/** Shown when someone tries to start a new task while their hands are already full. */
export function WipGuard() {
  const pending = useUI((u) => u.wipPending)
  const setPending = useUI((u) => u.setWipPending)
  const tasks = useStore((s) => s.tasks)
  const settings = useStore((s) => s.settings)
  const startFocus = useStore((s) => s.startFocus)
  const me = settings.currentMemberId

  const target = tasks.find((t) => t.id === pending?.taskId)
  const doing = tasks.filter(
    (t) => t.id !== pending?.taskId && t.status === "doing" && (!me || t.assigneeIds.length === 0 || t.assigneeIds.includes(me)),
  )
  const roomNow = doing.length < settings.wipLimit

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
          : `You've already started ${doing.length} ${doing.length === 1 ? "thing" : "things"}. Finish or park one before starting “${target?.title ?? "this"}”. Fewer open loops means more actually gets done.`
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
      </ul>
    </ResponsiveModal>
  )
}
