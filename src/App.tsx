import { useEffect, useState } from "react"
import { Command, FolderKanban, Home, ListTodo, MessageSquareHeart, Plus, Settings, Users } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { formatCode, SyncBadge, WhoAreYou } from "@/components/household"
import { feedbackAvailable, openFeedback } from "@/lib/feedback"
import { syncAvailable } from "@/lib/supabase"
import { joinHousehold, startSync } from "@/lib/sync"
import { Button } from "@/components/ui/button"
import { Confetti } from "@/components/ui/confetti"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MemberAvatar } from "@/components/bits"
import { CommandPalette } from "@/components/command-palette"
import { FocusOverlay } from "@/components/focus-overlay"
import { HearthLogo } from "@/components/logo"
import { Onboarding } from "@/components/onboarding"
import { SettingsDialog } from "@/components/settings-dialog"
import { TaskEditor } from "@/components/task-editor"
import { WipGuard } from "@/components/wip-guard"
import { isMine, useMe, useRanked } from "@/hooks/use-ranked"
import { useStore } from "@/lib/store"
import { useUI, type View } from "@/lib/ui"
import { cn } from "@/lib/utils"
import { FamilyView } from "@/views/family"
import { NowView } from "@/views/now"
import { ProjectsView } from "@/views/projects"
import { TasksView } from "@/views/tasks"

const NAV: { id: View; label: string; icon: typeof Home }[] = [
  { id: "now", label: "Now", icon: Home },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "family", label: "Family", icon: Users },
]

function ThemeSync() {
  const theme = useStore((s) => s.settings.theme)
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mql.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.querySelectorAll("meta[name=theme-color]").forEach((m) => m.setAttribute("content", dark ? "#1c1612" : "#fbf8f3"))
    }
    apply()
    mql.addEventListener("change", apply)
    return () => mql.removeEventListener("change", apply)
  }, [theme])
  return null
}

function Shell() {
  const view = useUI((u) => u.view)
  const setView = useUI((u) => u.setView)
  const newTask = useUI((u) => u.newTask)
  const setPaletteOpen = useUI((u) => u.setPaletteOpen)
  const setSettingsOpen = useUI((u) => u.setSettingsOpen)
  const projectFilter = useUI((u) => u.projectFilter)
  const me = useMe()
  const ranked = useRanked()
  const myOpen = ranked.filter((s) => isMine(s.task, me?.id)).length

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-2.5 px-2 py-1">
          <HearthLogo />
          <span className="font-display text-xl font-semibold">Hearth</span>
        </div>
        <Button className="mt-6 h-10 justify-start" onClick={() => newTask({ projectId: view === "tasks" ? projectFilter : undefined })}>
          <Plus /> New task
          <kbd className="ml-auto rounded bg-primary-foreground/20 px-1.5 text-[11px]">N</kbd>
        </Button>
        <nav className="mt-4 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setView(n.id)}
              aria-current={view === n.id ? "page" : undefined}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                view === n.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <n.icon className="size-4.5" />
              {n.label}
              {n.id === "tasks" && myOpen > 0 && <span className="ml-auto text-xs tabular-nums">{myOpen}</span>}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mt-4 flex h-9 items-center gap-2 rounded-xl border bg-card px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <Command className="size-3.5" /> Quick actions
          <kbd className="ml-auto text-[11px]">Ctrl K</kbd>
        </button>
        {feedbackAvailable && (
          <button
            type="button"
            onClick={openFeedback}
            className="mt-2 flex h-9 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <MessageSquareHeart className="size-4" /> Send feedback
          </button>
        )}
        <div className="mt-auto px-3 pb-1">
          <SyncBadge />
        </div>
        <div className="flex items-center gap-2 rounded-xl p-2">
          <MemberAvatar member={me} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{me?.name}</div>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setView("family")}>
              Switch person
            </button>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="safe-top sticky top-0 z-30 flex items-center gap-2 border-b bg-background/85 px-4 py-2.5 backdrop-blur-md md:hidden">
        <HearthLogo className="size-7" />
        <span className="font-display text-lg font-semibold">Hearth</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="px-1">
            <SyncBadge compact />
          </span>
          <Button size="icon" variant="ghost" aria-label="Quick actions" onClick={() => setPaletteOpen(true)}>
            <Command />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </Button>
          <button type="button" aria-label="Switch person" onClick={() => setView("family")}>
            <MemberAvatar member={me} size="sm" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-32 md:px-8 md:pt-10 md:pb-16">
        <div key={view} className="animate-in fade-in-0 duration-200">
          {view === "now" && <NowView />}
          {view === "tasks" && <TasksView />}
          {view === "projects" && <ProjectsView />}
          {view === "family" && <FamilyView />}
        </div>
      </main>

      {/* Mobile FAB + bottom nav */}
      <Button
        size="icon-lg"
        aria-label="New task"
        onClick={() => newTask({ projectId: view === "tasks" ? projectFilter : undefined })}
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-2xl shadow-lg shadow-primary/30 md:hidden"
      >
        <Plus className="size-6" />
      </Button>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/90 backdrop-blur-md md:hidden">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setView(n.id)}
            aria-current={view === n.id ? "page" : undefined}
            className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", view === n.id ? "text-primary" : "text-muted-foreground")}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", view === n.id && "bg-primary/12")}>
              <n.icon className="size-5" />
            </span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/** Read ?join=CODE once (from a scanned QR code or invite link), then tidy the URL. */
function readJoinCode(): string | undefined {
  try {
    const code = new URLSearchParams(location.search).get("join")
    if (code) history.replaceState(null, "", location.pathname)
    return code ? code.toUpperCase() : undefined
  } catch {
    return undefined
  }
}

/** Opened an invite link on a phone that already uses Hearth. */
function JoinFromLink({ code, onDone }: { code: string; onDone(): void }) {
  const household = useStore((s) => s.household)
  const [busy, setBusy] = useState(false)
  const already = household?.joinCode === code
  useEffect(() => {
    if (already) onDone()
  }, [already, onDone])
  if (already || !syncAvailable) return null
  return (
    <AlertDialog open onOpenChange={(o) => !o && onDone()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Join household {formatCode(code)}?</AlertDialogTitle>
          <AlertDialogDescription>
            {household
              ? `This phone will leave ${household.name} and load the new household's lists instead.`
              : "This phone's current lists will be replaced by the household's. Save a backup first (Settings) if you want to keep them."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Not now</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await joinHousehold(code)
                toast.success("Joined! Your family's lists are loading.")
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't join")
              }
              onDone()
            }}
          >
            Join
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default function App() {
  const hydrated = useStore((s) => s.hydrated)
  const onboarded = useStore((s) => s.onboarded)
  const householdId = useStore((s) => s.household?.id)
  const [joinCode, setJoinCode] = useState(readJoinCode)

  useEffect(() => {
    if (hydrated) void startSync()
  }, [hydrated, householdId])

  // An invite link opened on a brand-new phone is handled by onboarding; don't ask twice.
  const [seenOnboarded, setSeenOnboarded] = useState<boolean | undefined>(undefined)
  if (hydrated && seenOnboarded !== onboarded) {
    if (seenOnboarded === false && onboarded) setJoinCode(undefined)
    setSeenOnboarded(onboarded)
  }

  return (
    <TooltipProvider>
      <ThemeSync />
      {!hydrated ? (
        <div className="flex min-h-dvh items-center justify-center">
          <HearthLogo className="size-12 animate-pulse" />
        </div>
      ) : !onboarded ? (
        <Onboarding initialCode={joinCode} />
      ) : (
        <>
          <Shell />
          <WhoAreYou />
          {joinCode && <JoinFromLink code={joinCode} onDone={() => setJoinCode(undefined)} />}
          <TaskEditor />
          <WipGuard />
          <SettingsDialog />
          <CommandPalette />
          <FocusOverlay />
        </>
      )}
      <Confetti
        manualstart
        ref={(r) => {
          useUI.setState({ confetti: r })
        }}
        className="pointer-events-none fixed inset-0 z-[100] size-full"
      />
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  )
}
