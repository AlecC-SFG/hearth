import { useMemo } from "react"
import { useNow } from "./use-media-query"
import { isMine } from "./use-ranked"
import { LOCAL, useParked } from "@/lib/households"
import { rankTasks, type Scored } from "@/lib/priority"
import { useStore } from "@/lib/store"
import { dayKey } from "@/lib/storage"
import type { ListItem, Member, Project } from "@/lib/types"

/** One of your tasks, from whichever household it lives in */
export interface CombinedItem extends Scored {
  spaceId: string
  spaceName: string
  /** true when its household is the one on screen (so actions need no switch) */
  isActive: boolean
  members: Member[]
  projects: Project[]
  listItems: ListItem[]
}

export interface Combined {
  items: CombinedItem[]
  doneToday: number
  /** Households included (you've said who you are there) */
  spaces: { id: string; name: string; isActive: boolean }[]
  /** Households where this phone hasn't picked a person yet, so they're left out */
  needsIdentity: { id: string; name: string }[]
}

/**
 * Your open tasks across every household on this phone, ranked together.
 * In each household "you" are whoever this phone picked there.
 */
export function useCombined(): Combined {
  const minute = useNow(60_000)
  const active = useStore((s) => s.household)
  const households = useStore((s) => s.households)
  const members = useStore((s) => s.members)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const listItems = useStore((s) => s.listItems)
  const history = useStore((s) => s.history)
  const me = useStore((s) => s.settings.currentMemberId)
  const parked = useParked((p) => p.spaces)

  return useMemo(() => {
    const today = dayKey(new Date(minute))
    const nameOf = (id: string) => (id === LOCAL ? "This phone only" : (households.find((h) => h.id === id)?.name ?? "Household"))
    const activeId = active?.id ?? LOCAL
    const sources = [
      { id: activeId, isActive: true, members, projects, tasks, listItems, history, me },
      ...Object.entries(parked)
        .filter(([id]) => id !== activeId && (id === LOCAL || households.some((h) => h.id === id)))
        .map(([id, s]) => ({
          id,
          isActive: false,
          members: s.members,
          projects: s.projects,
          tasks: s.tasks,
          listItems: s.listItems ?? [],
          history: s.history,
          me: s.currentMemberId,
        })),
    ]

    const items: CombinedItem[] = []
    const spaces: Combined["spaces"] = []
    const needsIdentity: Combined["needsIdentity"] = []
    let doneToday = 0
    for (const src of sources) {
      const known = src.members.some((m) => m.id === src.me)
      if (!known) {
        if (src.members.length) needsIdentity.push({ id: src.id, name: nameOf(src.id) })
        if (!src.isActive) continue
      }
      spaces.push({ id: src.id, name: nameOf(src.id), isActive: src.isActive })
      doneToday += src.me ? (src.history[today]?.[src.me] ?? 0) : 0
      for (const s of rankTasks(src.tasks, minute)) {
        if (!isMine(s.task, src.me)) continue
        items.push({
          ...s,
          spaceId: src.id,
          spaceName: nameOf(src.id),
          isActive: src.isActive,
          members: src.members,
          projects: src.projects,
          listItems: src.listItems.filter((i) => i.taskId === s.task.id),
        })
      }
    }
    // Same scoring everywhere, so scores compare fairly across households
    items.sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score)
    return { items, doneToday, spaces, needsIdentity }
  }, [minute, active, households, members, projects, tasks, listItems, history, me, parked])
}

/** Your started tasks in households that aren't on screen (for the started-task limit). */
export function startedElsewhere(): { taskId: string; title: string; spaceId: string; spaceName: string }[] {
  const st = useStore.getState()
  const activeId = st.household?.id ?? LOCAL
  const out: { taskId: string; title: string; spaceId: string; spaceName: string }[] = []
  for (const [id, s] of Object.entries(useParked.getState().spaces)) {
    if (id === activeId) continue
    if (id !== LOCAL && !st.households.some((h) => h.id === id)) continue
    if (!s.members.some((m) => m.id === s.currentMemberId)) continue
    const name = id === LOCAL ? "This phone only" : (st.households.find((h) => h.id === id)?.name ?? "Household")
    for (const t of s.tasks) {
      if (t.status === "doing" && isMine(t, s.currentMemberId)) out.push({ taskId: t.id, title: t.title, spaceId: id, spaceName: name })
    }
  }
  return out
}
