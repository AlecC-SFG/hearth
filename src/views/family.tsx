import { useState } from "react"
import { subDays } from "date-fns"
import NumberFlow from "@number-flow/react"
import { Flame, Hand, Pencil, Plus, Trash2, UserCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ResponsiveModal } from "@/components/responsive-modal"
import { DueChip, MemberAvatar } from "@/components/bits"
import { isMine, useMe, useRanked } from "@/hooks/use-ranked"
import { MEMBER_COLORS, MEMBER_EMOJI, useStore } from "@/lib/store"
import { dayKey } from "@/lib/storage"
import type { Member } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

const MORE_EMOJI = [...MEMBER_EMOJI, "🐱", "🐶", "🦄", "🐸", "🦖", "🐼", "🦁", "🐨"]

function streak(history: Record<string, Record<string, number>>, id: string): number {
  let n = 0
  for (let i = 0; i < 365; i++) {
    const k = dayKey(subDays(new Date(), i))
    if (history[k]?.[id]) n++
    else if (i > 0) break
  }
  return n
}

function weekCount(history: Record<string, Record<string, number>>, id: string): number {
  let n = 0
  for (let i = 0; i < 7; i++) n += history[dayKey(subDays(new Date(), i))]?.[id] ?? 0
  return n
}

export function FamilyView() {
  const me = useMe()
  const members = useStore((s) => s.members)
  const history = useStore((s) => s.history)
  const focus = useStore((s) => s.focus)
  const tasks = useStore((s) => s.tasks)
  const updateSettings = useStore((s) => s.updateSettings)
  const updateTask = useStore((s) => s.updateTask)
  const ranked = useRanked()
  const editTask = useUI((u) => u.editTask)
  const [editing, setEditing] = useState<Member | "new" | null>(null)

  const anyone = ranked.filter((s) => s.task.assigneeIds.length === 0 && !s.blocked && !s.notYet).slice(0, 6)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Family</h1>
        <Button variant="outline" onClick={() => setEditing("new")}>
          <Plus /> Add person
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {members.map((m) => {
          const today = history[dayKey()]?.[m.id] ?? 0
          const week = weekCount(history, m.id)
          const st = streak(history, m.id)
          const focusing = focus?.memberId === m.id ? tasks.find((t) => t.id === focus.taskId) : undefined
          const next = ranked.find((s) => isMine(s.task, m.id) && !s.blocked && !s.notYet && s.task.status !== "parked")
          const isMe = me?.id === m.id
          return (
            <article key={m.id} className={cn("relative rounded-2xl border bg-card p-4", isMe && "border-primary/50 ring-1 ring-primary/30")}>
              <div className="flex items-center gap-3">
                <MemberAvatar member={m} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-xl font-semibold">{m.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {focusing ? (
                      <span className="text-primary">● Focusing on {focusing.title}</span>
                    ) : isMe ? (
                      "This is you on this device"
                    ) : (
                      " "
                    )}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                  <Pencil />
                </Button>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "today", value: today },
                  { label: "this week", value: week },
                  { label: "day streak", value: st, icon: st >= 3 },
                ].map((x) => (
                  <div key={x.label} className="rounded-xl bg-muted/60 py-2">
                    <dd className="flex items-center justify-center gap-1 font-display text-2xl font-semibold tabular-nums">
                      {x.icon && <Flame className="size-4 text-hot" />}
                      <NumberFlow value={x.value} />
                    </dd>
                    <dt className="text-xs text-muted-foreground">{x.label}</dt>
                  </div>
                ))}
              </dl>
              {next && (
                <button type="button" onClick={() => editTask(next.task.id)} className="mt-3 w-full rounded-xl border px-3 py-2 text-left text-sm hover:bg-muted/50">
                  <span className="text-xs text-muted-foreground">{isMe ? "Your" : `${m.name}'s`} one thing</span>
                  <span className="block truncate font-medium">{next.task.title}</span>
                </button>
              )}
              {!isMe && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => {
                    updateSettings({ currentMemberId: m.id })
                    toast(`Switched to ${m.name}`, { description: "This device now shows their tasks." })
                  }}
                >
                  <UserCheck /> This is me
                </Button>
              )}
            </article>
          )
        })}
      </div>

      {anyone.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-xl font-semibold">Up for grabs</h2>
            <p className="text-sm text-muted-foreground">Not assigned to anyone yet. Claim one!</p>
          </div>
          <div className="space-y-2">
            {anyone.map((s) => (
              <div key={s.task.id} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
                <button type="button" onClick={() => editTask(s.task.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{s.task.title}</div>
                  <div className="mt-1">
                    <DueChip iso={s.task.dueAt} recurring={s.task.recurrence !== "none"} />
                  </div>
                </button>
                {me && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      updateTask(s.task.id, { assigneeIds: [me.id] })
                      toast.success("It's yours!", { description: s.task.title })
                    }}
                  >
                    <Hand /> I'll take it
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <MemberEditor member={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function MemberEditor({ member, onClose }: { member: Member | "new" | null; onClose(): void }) {
  const members = useStore((s) => s.members)
  const addMember = useStore((s) => s.addMember)
  const updateMember = useStore((s) => s.updateMember)
  const removeMember = useStore((s) => s.removeMember)
  const [draft, setDraft] = useState<Omit<Member, "id">>({ name: "", emoji: "🦊", color: MEMBER_COLORS[0] })
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = member === "new" ? "new" : (member?.id ?? null)
  if (key !== lastKey) {
    setLastKey(key)
    if (member === "new") {
      const i = members.length % MEMBER_EMOJI.length
      setDraft({ name: "", emoji: MEMBER_EMOJI[i], color: MEMBER_COLORS[i] })
    } else if (member) setDraft({ ...member })
  }

  const save = () => {
    const name = draft.name.trim()
    if (!name) return toast.error("Add a name")
    if (member === "new") addMember({ ...draft, name })
    else if (member) updateMember(member.id, { ...draft, name })
    onClose()
  }

  return (
    <ResponsiveModal
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={member === "new" ? "Add a person" : "Edit person"}
      footer={
        <>
          {member && member !== "new" && members.length > 1 && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive md:flex-none"
              onClick={() => {
                removeMember(member.id)
                toast(`${member.name} removed`, { description: "Their tasks are now up for grabs." })
                onClose()
              }}
            >
              <Trash2 /> Remove
            </Button>
          )}
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <MemberAvatar member={{ ...draft, id: "preview" }} size="lg" />
          <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className="h-11 rounded-xl text-base" />
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {MORE_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setDraft({ ...draft, emoji: e })}
              className={cn("flex aspect-square items-center justify-center rounded-lg text-xl hover:bg-muted", draft.emoji === e && "bg-primary/15 ring-2 ring-primary")}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {MEMBER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setDraft({ ...draft, color: c })}
              className={cn("size-8 rounded-full ring-offset-2 ring-offset-background", draft.color === c && "ring-2 ring-foreground")}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </ResponsiveModal>
  )
}
