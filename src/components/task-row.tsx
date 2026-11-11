import { Check, Clock, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AvatarStack, BlockedChip, Chip, DueChip, ProgressBar, ScoreBadge, UnblocksChip } from "@/components/bits"
import { completeTask, requestFocus } from "@/lib/actions"
import { formatMinutes } from "@/lib/format"
import type { Scored } from "@/lib/priority"
import { useStore } from "@/lib/store"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

export function CheckCircle({ done, onClick, disabled, label }: { done?: boolean; onClick(): void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "group/check relative flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
        done ? "border-success bg-success text-white" : "border-muted-foreground/35 hover:border-success hover:bg-success/10",
      )}
    >
      <Check className={cn("size-4 transition-opacity", done ? "opacity-100" : "opacity-0 group-hover/check:opacity-60")} strokeWidth={3} />
    </button>
  )
}

export function TaskRow({ s, showScore = true }: { s: Scored; showScore?: boolean }) {
  const { task } = s
  const members = useStore((st) => st.members)
  const project = useStore((st) => st.projects.find((p) => p.id === task.projectId))
  const focusTask = useStore((st) => st.focus?.taskId)
  const editTask = useUI((u) => u.editTask)
  const assignees = members.filter((m) => task.assigneeIds.includes(m.id))

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => editTask(task.id)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && editTask(task.id)}
      className={cn(
        "group flex items-start gap-3 rounded-2xl border bg-card p-3 text-left transition-all outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/40 md:p-3.5",
        s.blocked && "bg-card/60",
        task.status === "parked" && "opacity-75",
      )}
    >
      <div className="pt-0.5">
        <CheckCircle
          label={`Complete ${task.title}`}
          done={task.status === "done"}
          disabled={s.blocked}
          onClick={() => completeTask(task.id)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className={cn("min-w-0 flex-1 font-medium leading-snug", s.blocked && "text-muted-foreground")}>
            {project && <span className="mr-1.5" title={project.name}>{project.emoji}</span>}
            {task.title}
          </div>
          {showScore && <ScoreBadge score={s.score} className="-mt-0.5" />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {task.status === "doing" && <Chip className="bg-primary/15 text-primary">In progress</Chip>}
          {task.status === "parked" && <Chip>Parked</Chip>}
          <DueChip iso={task.dueAt} recurring={task.recurrence !== "none"} />
          {s.remainingMin > 0 && <Chip icon={<Clock />}>{formatMinutes(s.remainingMin)} left</Chip>}
          {s.blocked && <BlockedChip count={s.blockedBy.length} />}
          {s.unblocks.length > 0 && <UnblocksChip count={s.unblocks.length} />}
          <span className="ml-auto flex items-center gap-1.5">
            <AvatarStack members={assignees} />
          </span>
        </div>
        {s.progress > 0 && s.progress < 1 && <ProgressBar value={s.progress} className="mt-2.5" />}
      </div>
      {!s.blocked && focusTask !== task.id && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Focus on ${task.title}`}
          title="Start a focus session"
          className="hidden self-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 md:inline-flex"
          onClick={(e) => {
            e.stopPropagation()
            requestFocus(task.id)
          }}
        >
          <Play />
        </Button>
      )}
    </div>
  )
}
