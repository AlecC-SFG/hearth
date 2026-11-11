import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Check, Cloud, CloudOff, Copy, Loader2, LogOut, RefreshCw, Share2, UserPlus, Users } from "lucide-react"
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
import { ResponsiveModal } from "@/components/responsive-modal"
import { MemberAvatar } from "@/components/bits"
import { MEMBER_COLORS, MEMBER_EMOJI, useStore } from "@/lib/store"
import { syncAvailable } from "@/lib/supabase"
import { createHousehold, joinHousehold, joinLink, leaveHousehold, newJoinCode, useSync } from "@/lib/sync"
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

/** The household section inside Settings. */
export function HouseholdSettings() {
  const household = useStore((s) => s.household)
  const hasData = useStore((s) => s.tasks.length + s.projects.length > 0)
  const { status, error } = useSync()
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmJoin, setConfirmJoin] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  if (!syncAvailable) return null

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      setMode("idle")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  if (household) {
    const link = joinLink(household.joinCode)
    const share = async () => {
      const text = `Join our family on Hearth: open this link on your phone, or enter code ${formatCode(household.joinCode)}.`
      try {
        if (navigator.share) await navigator.share({ title: "Join our household on Hearth", text, url: link })
        else {
          await navigator.clipboard.writeText(`${text}\n${link}`)
          toast.success("Invite copied", { description: "Paste it into a text message." })
        }
      } catch {
        /* user cancelled */
      }
    }
    return (
      <div className="space-y-4 rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Household</div>
            <div className="font-display text-xl font-semibold">{household.name}</div>
          </div>
          <SyncBadge />
        </div>
        {status === "error" && error && <p className="rounded-xl bg-hot/10 p-2.5 text-sm text-hot">{error}</p>}
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <JoinQR code={household.joinCode} className="w-40 shrink-0" />
          <div className="w-full space-y-2 text-sm">
            <p className="text-muted-foreground">Add someone: they scan this with their phone camera, or open Hearth and enter the code.</p>
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
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(newJoinCode, "New code made. The old one no longer works.")}>
                <RefreshCw /> New code
              </Button>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmLeave(true)}>
          <LogOut /> Stop syncing this phone
        </Button>
        <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop syncing this phone?</AlertDialogTitle>
              <AlertDialogDescription>
                This phone keeps its current lists but stops sharing with {household.name}. Everyone else keeps syncing. You can rejoin with the code.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmLeave(false)
                  void run(leaveHousehold, "This phone stopped syncing")
                }}
              >
                Stop syncing
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border p-4">
      <div>
        <div className="font-medium">Share lists across your family's phones</div>
        <p className="text-sm text-muted-foreground">Create a household, then invite everyone with a code. Other households can't see yours.</p>
      </div>
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("create")}>
            <Users /> Create a household
          </Button>
          <Button variant="outline" onClick={() => setMode("join")}>
            <UserPlus /> Join with a code
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
          <p className="text-xs text-muted-foreground">Everything on this phone becomes the household's starting list.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Create
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
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
            if (!code.trim()) return
            if (hasData) setConfirmJoin(true)
            else void run(() => joinHousehold(code), "Joined! Your family's lists are loading.")
          }}
        >
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-2345"
            autoCapitalize="characters"
            autoComplete="off"
            className="h-12 rounded-xl text-center font-mono text-xl tracking-widest md:text-xl"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Join
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <p className="text-xs text-muted-foreground">{PRIVACY_NOTE}</p>
      <AlertDialog open={confirmJoin} onOpenChange={setConfirmJoin}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this phone's lists?</AlertDialogTitle>
            <AlertDialogDescription>
              Joining loads the household's lists in place of what's on this phone now. Save a backup first if you want to keep them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmJoin(false)
                void run(() => joinHousehold(code), "Joined! Your family's lists are loading.")
              }}
            >
              Join and replace
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
