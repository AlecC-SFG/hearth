import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Check, ChevronsUpDown, Cloud, CloudOff, Copy, Home, Loader2, LogOut, Plus, RefreshCw, Share2, Smartphone, UserPlus, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResponsiveModal } from "@/components/responsive-modal"
import { MemberAvatar } from "@/components/bits"
import { MEMBER_COLORS, MEMBER_EMOJI, useStore } from "@/lib/store"
import { syncAvailable } from "@/lib/supabase"
import { createHousehold, joinHousehold, joinLink, leaveHousehold, LOCAL, newJoinCode, switchHousehold } from "@/lib/households"
import { useSync } from "@/lib/sync"
import { cn } from "@/lib/utils"

export const PRIVACY_NOTE =
  "Your household's lists are stored on Hearth's test server so your phones stay in sync. Only phones that join with your household's code can see them. The person running this test can access the server for troubleshooting."

export function formatCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export function JoinQR({ code, className }: { code: string; className?: string }) {
  const [svg, setSvg] = useState("")
  useEffect(() => {
    let alive = true
    QRCode.toString(joinLink(code), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c1612", light: "#ffffff" } })
      .then((s) => alive && setSvg(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [code])
  return (
    <div
      className={cn("aspect-square rounded-2xl bg-white p-3 [&_svg]:size-full", className)}
      role="img"
      aria-label="QR code to join this household"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Small cloud indicator for headers. */
export function SyncBadge({ compact }: { compact?: boolean }) {
  const household = useStore((s) => s.household)
  const { status, error } = useSync()
  if (!household) return null
  const map = {
    off: { icon: CloudOff, label: "Not syncing", cls: "text-muted-foreground" },
    connecting: { icon: Loader2, label: "Connecting…", cls: "text-muted-foreground [&_svg]:animate-spin" },
    syncing: { icon: Loader2, label: "Syncing…", cls: "text-muted-foreground [&_svg]:animate-spin" },
    synced: { icon: Cloud, label: "Synced", cls: "text-success" },
    offline: { icon: CloudOff, label: "Offline", cls: "text-warm" },
    error: { icon: CloudOff, label: "Sync problem", cls: "text-hot" },
  }[status]
  const detail = status === "error" && error ? error : status === "offline" ? "Changes will sync when you're back online" : map.label
  return (
    <span title={`${household.name}: ${detail}`} className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap", map.cls)}>
      <map.icon className="size-4" />
      {!compact && <span className="truncate">{status === "synced" ? household.name : map.label}</span>}
    </span>
  )
}

/** Create-or-join forms, used in Settings and in the household switcher. */
export function HouseholdForms({ initialMode = "idle", onDone, compact }: { initialMode?: "idle" | "create" | "join"; onDone?(): void; compact?: boolean }) {
  const inHousehold = useStore((s) => !!s.household)
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      setMode("idle")
      setName("")
      setCode("")
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => (initialMode === "idle" ? setMode("idle") : onDone?.())

  return (
    <div className="space-y-3">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button size={compact ? "sm" : "default"} onClick={() => setMode("create")}>
            <Users /> {inHousehold ? "Create another household" : "Create a household"}
          </Button>
          <Button size={compact ? "sm" : "default"} variant="outline" onClick={() => setMode("join")}>
            <UserPlus /> {inHousehold ? "Join another" : "Join with a code"}
          </Button>
        </div>
      )}
      {mode === "create" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void run(() => createHousehold(name.trim()), "Household created. Invite your family!")
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Household name, e.g. The Smiths" className="h-10 rounded-xl" />
          <p className="text-xs text-muted-foreground">
            {inHousehold
              ? "It starts with just you. Your other households aren't affected."
              : "Everything on this phone becomes the household's starting list."}
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Create
            </Button>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === "join" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) void run(() => joinHousehold(code), "Joined! Their lists are loading.")
          }}
        >
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-2345"
            autoCapitalize="characters"
            autoComplete="off"
            aria-label="Household code"
            className="h-12 rounded-xl text-center font-mono text-xl tracking-widest md:text-xl"
          />
          {inHousehold && (
            <p className="text-xs text-muted-foreground">Your other households stay on this phone. Switch between them from the menu at the top.</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Join
            </Button>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** The household section inside Settings. */
export function HouseholdSettings() {
  const household = useStore((s) => s.household)
  const households = useStore((s) => s.households)
  const others = households.filter((h) => h.id !== household?.id)
  const { status, error } = useSync()
  const [busy, setBusy] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  if (!syncAvailable) return null

  if (!household) {
    return (
      <div className="space-y-3 rounded-2xl border p-4">
        <div>
          <div className="font-medium">Share lists across your family's phones</div>
          <p className="text-sm text-muted-foreground">Create a household, then invite everyone with a code. Other households can't see yours.</p>
        </div>
        <HouseholdForms />
        <p className="text-xs text-muted-foreground">{PRIVACY_NOTE}</p>
      </div>
    )
  }

  const link = joinLink(household.joinCode)
  const share = async () => {
    const text = `Join ${household.name} on Hearth: open this link on your phone, or enter code ${formatCode(household.joinCode)}.`
    try {
      if (navigator.share) await navigator.share({ title: `Join ${household.name} on Hearth`, text, url: link })
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`)
        toast.success("Invite copied", { description: "Paste it into a text message." })
      }
    } catch {
      /* user cancelled */
    }
  }
  const rotate = async () => {
    setBusy(true)
    try {
      await newJoinCode()
      toast.success("New code made. The old one no longer works.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Household</div>
          <div className="font-display text-xl font-semibold">{household.name}</div>
          {others.length > 0 && <div className="text-xs text-muted-foreground">Also on this phone: {others.map((h) => h.name).join(", ")}</div>}
        </div>
        <SyncBadge />
      </div>
      {status === "error" && error && <p className="rounded-xl bg-hot/10 p-2.5 text-sm text-hot">{error}</p>}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <JoinQR code={household.joinCode} className="w-40 shrink-0" />
        <div className="w-full space-y-2 text-sm">
          <p className="text-muted-foreground">Add someone to {household.name}: they scan this with their phone camera, or open Hearth and enter the code.</p>
          <div className="rounded-xl bg-muted px-3 py-2 text-center font-mono text-2xl font-semibold tracking-widest">{formatCode(household.joinCode)}</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={share}>
              <Share2 /> Send invite
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard?.writeText(link).catch(() => {})
                toast.success("Link copied")
              }}
            >
              <Copy /> Copy link
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={rotate}>
              <RefreshCw /> New code
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-2 border-t pt-3">
        <div className="text-sm font-medium">Other households</div>
        <p className="text-xs text-muted-foreground">
          You can belong to more than one, like your own family and your parents'. Each keeps its own lists. Switch between them from the menu at the top.
        </p>
        <HouseholdForms compact />
      </div>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmLeave(true)}>
        <LogOut /> Remove {household.name} from this phone
      </Button>
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {household.name} from this phone?</AlertDialogTitle>
            <AlertDialogDescription>
              This phone stops syncing with {household.name}, and its lists are removed from this phone. Everyone else in the household keeps
              everything. You can rejoin later with the code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmLeave(false)
                try {
                  await leaveHousehold()
                  toast.success(`${household.name} removed from this phone`)
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Something went wrong")
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** After joining, each phone picks which family member it belongs to. */
export function WhoAreYou() {
  const household = useStore((s) => s.household)
  const members = useStore((s) => s.members)
  const currentId = useStore((s) => s.settings.currentMemberId)
  const update = useStore((s) => s.updateSettings)
  const addMember = useStore((s) => s.addMember)
  const status = useSync((s) => s.status)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")

  const needsPick = !!household && !members.some((m) => m.id === currentId)
  const loading = needsPick && members.length === 0 && (status === "connecting" || status === "syncing")

  return (
    <ResponsiveModal
      open={needsPick}
      onOpenChange={() => {}}
      dismissible={false}
      title={`Welcome to ${household?.name ?? "the household"}!`}
      description="Which one are you? Hearth will show your tasks on this phone."
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Loading your family…
        </div>
      ) : (
        <div className="space-y-2 pb-2">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => update({ currentMemberId: m.id })}
              className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left text-lg font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <MemberAvatar member={m} size="md" /> {m.name}
            </button>
          ))}
          {adding ? (
            <form
              className="flex gap-2 pt-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!name.trim()) return
                const i = members.length % MEMBER_EMOJI.length
                const id = addMember({ name: name.trim(), emoji: MEMBER_EMOJI[i], color: MEMBER_COLORS[i] })
                update({ currentMemberId: id })
              }}
            >
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="h-11 rounded-xl" />
              <Button type="submit" className="h-11" disabled={!name.trim()}>
                Add me
              </Button>
            </form>
          ) : (
            <Button variant="ghost" className="w-full" onClick={() => setAdding(true)}>
              <UserPlus /> I'm not on the list
            </Button>
          )}
        </div>
      )}
    </ResponsiveModal>
  )
}

/** Menu at the top of the app for moving between households on this phone. */
export function HouseholdSwitcher({ className }: { className?: string }) {
  const household = useStore((s) => s.household)
  const households = useStore((s) => s.households)
  const hasLocalSpace = useStore((s) => s.hasLocalSpace)
  const [dialog, setDialog] = useState<"create" | "join" | null>(null)

  if (!syncAvailable || households.length === 0) return null
  const showLocal = hasLocalSpace || !household

  const go = async (id: string, label: string) => {
    try {
      await switchHousehold(id)
      toast(`Switched to ${label}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch")
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex h-9 min-w-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label="Switch household"
        >
          <Home className="size-4 shrink-0 text-primary" />
          <span className="truncate">{household?.name ?? "This phone only"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your households</DropdownMenuLabel>
            {households.map((h) => (
              <DropdownMenuItem key={h.id} onClick={() => go(h.id, h.name)}>
                <Home />
                <span className="flex-1 truncate">{h.name}</span>
                {household?.id === h.id && <Check className="text-primary" />}
              </DropdownMenuItem>
            ))}
            {showLocal && (
              <DropdownMenuItem onClick={() => go(LOCAL, "this phone only")}>
                <Smartphone />
                <span className="flex-1">This phone only</span>
                {!household && <Check className="text-primary" />}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialog("join")}>
            <UserPlus /> Join another household…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("create")}>
            <Plus /> Create a new household…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ResponsiveModal
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "join" ? "Join another household" : "Create a new household"}
        description={
          dialog === "join"
            ? "Enter the code someone in that household gave you. Your current households stay on this phone."
            : "It starts with just you. Invite others from Settings afterwards."
        }
      >
        {dialog && <HouseholdForms key={dialog} initialMode={dialog} onDone={() => setDialog(null)} />}
      </ResponsiveModal>
    </>
  )
}
