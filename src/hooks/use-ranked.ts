import { useMemo } from "react"
import { useNow } from "./use-media-query"
import { rankTasks, type Scored } from "@/lib/priority"
import { useStore } from "@/lib/store"
import type { Task } from "@/lib/types"

/** Ranked open tasks; re-scores every minute so urgency stays fresh. */
export function useRanked(): Scored[] {
  const tasks = useStore((s) => s.tasks)
  const minute = useNow(60_000)
  return useMemo(() => rankTasks(tasks, minute), [tasks, minute])
}

export function isMine(t: Task, memberId?: string) {
  return !memberId || t.assigneeIds.length === 0 || t.assigneeIds.includes(memberId)
}

export function useMe() {
  const id = useStore((s) => s.settings.currentMemberId)
  return useStore((s) => s.members.find((m) => m.id === id))
}
