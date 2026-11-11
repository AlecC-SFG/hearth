import { useEffect, useState } from "react"
import { FolderKanban, Home, ListTodo, Play, Plus, Settings, Users } from "lucide-react"
import { toast } from "sonner"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut, Command } from "@/components/ui/command"
import { useRanked } from "@/hooks/use-ranked"
import { requestFocus } from "@/lib/actions"
import { useStore } from "@/lib/store"
import { useUI, type View } from "@/lib/ui"

const VIEWS: { id: View; label: string; icon: typeof Home; key: string }[] = [
  { id: "now", label: "Now", icon: Home, key: "1" },
  { id: "tasks", label: "Tasks", icon: ListTodo, key: "2" },
  { id: "projects", label: "Projects", icon: FolderKanban, key: "3" },
  { id: "family", label: "Family", icon: Users, key: "4" },
]

function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
}

export function CommandPalette() {
  const open = useUI((u) => u.paletteOpen)
  const setOpen = useUI((u) => u.setPaletteOpen)
  const { setView, newTask, editTask, setSettingsOpen } = useUI.getState()
  const addTask = useStore((s) => s.addTask)
  const me = useStore((s) => s.settings.currentMemberId)
  const ranked = useRanked()
  const [q, setQ] = useState("")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!useUI.getState().paletteOpen)
        return
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return
      if (e.key === "n") {
        e.preventDefault()
        newTask()
      }
      const v = VIEWS.find((x) => x.key === e.key)
      if (v) setView(v.id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen, newTask, setView])

  const run = (fn: () => void) => {
    setOpen(false)
    setQ("")
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Quick actions" description="Search tasks, add a task, or jump anywhere">
      <Command>
        <CommandInput value={q} onValueChange={setQ} placeholder="Type to add or search…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          {q.trim() && (
            <CommandGroup heading="Add">
              <CommandItem
                value={`add ${q}`}
                onSelect={() =>
                  run(() => {
                    addTask({ title: q.trim(), assigneeIds: me ? [me] : [] })
                    toast.success("Added", { description: q.trim() })
                  })
                }
              >
                <Plus /> Add “{q.trim()}”
              </CommandItem>
              <CommandItem value={`add details ${q}`} onSelect={() => run(() => newTask({ title: q.trim() }))}>
                <Plus /> Add “{q.trim()}” with details…
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Focus on">
            {ranked
              .filter((s) => !s.blocked)
              .slice(0, q ? 20 : 3)
              .map((s) => (
                <CommandItem key={`f-${s.task.id}`} value={`focus ${s.task.title}`} onSelect={() => run(() => requestFocus(s.task.id))}>
                  <Play /> {s.task.title}
                </CommandItem>
              ))}
          </CommandGroup>
          {q && (
            <CommandGroup heading="Open task">
              {ranked.map((s) => (
                <CommandItem key={`e-${s.task.id}`} value={`open ${s.task.title}`} onSelect={() => run(() => editTask(s.task.id))}>
                  <ListTodo /> {s.task.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {VIEWS.map((v) => (
              <CommandItem key={v.id} value={`go ${v.label}`} onSelect={() => run(() => setView(v.id))}>
                <v.icon /> {v.label}
                <CommandShortcut>{v.key}</CommandShortcut>
              </CommandItem>
            ))}
            <CommandItem value="go settings" onSelect={() => run(() => setSettingsOpen(true))}>
              <Settings /> Settings
            </CommandItem>
            <CommandItem value="new task" onSelect={() => run(() => newTask())}>
              <Plus /> New task
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
