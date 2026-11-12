import { toast } from "sonner"
import { primeAudio, requestNotify } from "./alerts"
import { useStore } from "./store"
import { useUI } from "./ui"
import { activeSpaceId, switchHousehold } from "./households"
import { isUpcoming, upcomingLabel } from "./schedule"
import { startedElsewhere } from "@/hooks/use-combined"

const ENCOURAGEMENT = [
  "Done! That's one less thing on your mind.",
  "Finished. Your future self says thanks.",
  "Nice work — crossed off!",
  "Boom. Another one done.",
  "That's how it's done.",
]

export function celebrate() {
  const c = useUI.getState().confetti
  if (!c) return
  const colors = ["#e8590c", "#f59f00", "#7048e8", "#2f9e44", "#d6336c"]
  void c.fire({ particleCount: 90, spread: 75, origin: { y: 0.75 }, colors, disableForReducedMotion: true })
}

export function completeTask(id: string) {
  const s = useStore.getState()
  const task = s.tasks.find((t) => t.id === id)
  if (!task) return
  const nextId = s.completeTask(id)
  const next = nextId ? useStore.getState().tasks.find((t) => t.id === nextId) : undefined
  celebrate()
  toast.success(ENCOURAGEMENT[Math.floor(Math.random() * ENCOURAGEMENT.length)], {
    description: next
      ? isUpcoming(next)
        ? `“${task.title}” will be back ${upcomingLabel(next)}.`
        : `The next “${task.title}” is on your list.`
      : task.title,
    action: {
      label: "Undo",
      onClick: () => useStore.getState().reopenTask(id, { undo: true }),
    },
  })
}

export function deleteTask(id: string) {
  const removed = useStore.getState().removeTask(id)
  if (!removed) return
  useUI.getState().closeEditor()
  toast("Task deleted", {
    description: removed.title,
    action: { label: "Undo", onClick: () => useStore.getState().restoreTask(removed) },
  })
}

/** Start a focus session — but check the work-in-progress limit first. */
export function requestFocus(taskId: string, minutes?: number) {
  const s = useStore.getState()
  const me = s.settings.currentMemberId
  const mins = minutes ?? s.settings.focusMinutes
  if (!me) return
  primeAudio()
  requestNotify()
  const doing = s.tasks.filter(
    (t) => t.id !== taskId && t.status === "doing" && (t.assigneeIds.includes(me) || t.assigneeIds.length === 0),
  )
  // Things you've started in your other households count toward the limit too
  const elsewhere = startedElsewhere().filter((x) => x.taskId !== taskId)
  const task = s.tasks.find((t) => t.id === taskId)
  if (task?.status !== "doing" && doing.length + elsewhere.length >= s.settings.wipLimit) {
    useUI.getState().setWipPending({ taskId, minutes: mins })
    return
  }
  s.startFocus(taskId, me, mins)
}

export function parkTask(id: string) {
  const s = useStore.getState()
  const t = s.tasks.find((x) => x.id === id)
  s.setStatus(id, "parked")
  toast("Parked for later", {
    description: t ? `${t.title} — it'll wait for you.` : undefined,
    action: { label: "Undo", onClick: () => useStore.getState().setStatus(id, t?.status ?? "todo") },
  })
}

/** "Not done yet": put a completed task back, tagged with who reopened it. */
export function reopenWithToast(id: string) {
  const s = useStore.getState()
  const t = s.tasks.find((x) => x.id === id)
  if (!t || t.status !== "done") return
  const snapshot = { ...t }
  s.reopenTask(id)
  toast("Moved back to not done", {
    description: t.title,
    action: {
      label: "Undo",
      onClick: () => {
        const st = useStore.getState()
        // Put it back exactly as it was (done, credited to the same person)
        st.completeTask(id, snapshot.completedBy)
      },
    },
  })
}

/**
 * Do something to a task that may live in a household that isn't on screen:
 * switch to that household first (so all the normal sync, focus and completion
 * logic applies), then act.
 */
export async function actIn(spaceId: string, spaceName: string, fn: () => void) {
  if (spaceId !== activeSpaceId()) {
    try {
      await switchHousehold(spaceId)
      toast(`Switched to ${spaceName}`, { duration: 2500 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open that household")
      return
    }
  }
  fn()
}
