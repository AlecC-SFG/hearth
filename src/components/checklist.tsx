import { useMemo, useRef, useState } from "react"
import { Check, ListChecks, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ResponsiveModal } from "@/components/responsive-modal"
import { Chip, MemberAvatar } from "@/components/bits"
import { useStore } from "@/lib/store"
import type { ListItem } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

export function useListItems(taskId?: string) {
  const all = useStore((s) => s.listItems)
  return useMemo(() => (taskId ? all.filter((i) => i.taskId === taskId) : []), [all, taskId])
}

/** "🧾 4 of 12" chip for task rows; tapping opens the list. */
export function ListChip({ taskId, className }: { taskId: string; className?: string }) {
  const items = useListItems(taskId)
  const openList = useUI((u) => u.openList)
  if (!items.length) return null
  const left = items.filter((i) => !i.done).length
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openList(taskId)
      }}
      className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      aria-label={`Open list: ${left} of ${items.length} items left`}
    >
      <Chip icon={<ListChecks />} className={cn("hover:bg-accent", left === 0 && "bg-success/15 text-success")}>
        {left === 0 ? "List done" : `${left} of ${items.length} left`}
      </Chip>
    </button>
  )
}

function Row({ item }: { item: ListItem }) {
  const update = useStore((s) => s.updateListItem)
  const remove = useStore((s) => s.removeListItem)
  const restore = useStore((s) => s.restoreListItems)
  const doneBy = useStore((s) => s.members.find((m) => m.id === item.doneBy))
  return (
    <li className="group flex items-center gap-2 rounded-xl py-0.5 pr-0.5 pl-1.5 hover:bg-muted/60">
      <button
        type="button"
        aria-label={item.done ? `Uncheck ${item.text}` : `Check off ${item.text}`}
        onClick={() => update(item.id, { done: !item.done })}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          item.done ? "border-success bg-success text-white" : "border-muted-foreground/40 hover:border-success",
        )}
      >
        {item.done && <Check className="size-3.5" strokeWidth={3} />}
      </button>
      <input
        value={item.text}
        onChange={(e) => update(item.id, { text: e.target.value })}
        onBlur={(e) => !e.target.value.trim() && remove(item.id)}
        onKeyDown={(e) => {
          // Enter just finishes editing; it must not submit the surrounding task form
          if (e.key === "Enter") {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        aria-label="List item"
        className={cn("min-w-0 flex-1 bg-transparent py-2 text-base outline-none md:text-sm", item.done && "text-muted-foreground line-through")}
      />
      {item.done && doneBy && <MemberAvatar member={doneBy} size="xs" />}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${item.text}`}
        className="opacity-60 group-hover:opacity-100"
        onClick={() => {
          const gone = remove(item.id)
          if (gone) toast("Removed", { description: gone.text, action: { label: "Undo", onClick: () => restore([gone]) } })
        }}
      >
        <X />
      </Button>
    </li>
  )
}

/** The editable list. Everyone in the household sees changes live. */
export function Checklist({ taskId, autoFocus, placeholder = "Add an item" }: { taskId: string; autoFocus?: boolean; placeholder?: string }) {
  const items = useListItems(taskId)
  const add = useStore((s) => s.addListItem)
  const clearChecked = useStore((s) => s.clearCheckedItems)
  const restore = useStore((s) => s.restoreListItems)
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const open = items.filter((i) => !i.done).sort((a, b) => a.order - b.order)
  const done = items.filter((i) => i.done).sort((a, b) => a.order - b.order)

  const submit = () => {
    // Paste or type several items at once, separated by commas or new lines
    const parts = text
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean)
    for (const p of parts) add(taskId, p)
    setText("")
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-2">
      {/* Not a <form>: this list also lives inside the task editor's form, and nested
          forms make the browser submit (and reload) the page. Enter is handled by hand. */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          enterKeyHint="done"
          aria-label="New list item"
          className="h-11 rounded-xl text-base md:text-sm"
        />
        <Button type="button" className="h-11" disabled={!text.trim()} aria-label="Add item" onClick={submit}>
          <Plus />
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing on the list yet. Tip: type several items separated by commas.</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {open.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </ul>
          {open.length === 0 && <p className="px-1 py-1 text-sm text-success">Everything's checked off. 🎉</p>}
          {done.length > 0 && (
            <div className="space-y-0.5 border-t pt-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-muted-foreground">Checked off ({done.length})</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const gone = clearChecked(taskId)
                    toast("Cleared checked items", { action: { label: "Undo", onClick: () => restore(gone) } })
                  }}
                >
                  Clear checked
                </Button>
              </div>
              <ul className="space-y-0.5">
                {done.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Full-screen sheet for using a list on the go (e.g. in the store). */
export function ChecklistSheet() {
  const taskId = useUI((u) => u.listTaskId)
  const close = useUI((u) => u.closeList)
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId))
  const items = useListItems(taskId)
  const left = items.filter((i) => !i.done).length
  return (
    <ResponsiveModal
      open={!!taskId && !!task}
      onOpenChange={(o) => !o && close()}
      title={task?.title ?? "List"}
      description={items.length ? `${left} of ${items.length} left · changes show up on everyone's phone` : "Everyone in your household can add to this list."}
    >
      {taskId && <Checklist taskId={taskId} />}
    </ResponsiveModal>
  )
}
