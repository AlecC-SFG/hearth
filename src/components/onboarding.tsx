import { useState } from "react"
import { ArrowLeft, ArrowRight, Loader2, Plus, UserPlus, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { MemberAvatar } from "@/components/bits"
import { PRIVACY_NOTE } from "@/components/household"
import { HearthLogo } from "@/components/logo"
import { MEMBER_COLORS, MEMBER_EMOJI, useStore } from "@/lib/store"
import { syncAvailable } from "@/lib/supabase"
import { createHousehold, joinHousehold } from "@/lib/households"

type Path = "choose" | "setup" | "join"

export function Onboarding({ initialCode }: { initialCode?: string }) {
  const finish = useStore((s) => s.finishOnboarding)
  const [path, setPath] = useState<Path>(initialCode ? "join" : syncAvailable ? "choose" : "setup")
  const [names, setNames] = useState<string[]>(["", "", ""])
  const [houseName, setHouseName] = useState("")
  const [share, setShare] = useState(true)
  const [seed, setSeed] = useState(true)
  const [code, setCode] = useState(initialCode ?? "")
  const [busy, setBusy] = useState(false)
  const filled = names.map((n) => n.trim()).filter(Boolean)

  const setup = async () => {
    setBusy(true)
    finish(
      filled.map((name, i) => ({ name, emoji: MEMBER_EMOJI[i % MEMBER_EMOJI.length], color: MEMBER_COLORS[i % MEMBER_COLORS.length] })),
      seed,
    )
    if (syncAvailable && share) {
      try {
        await createHousehold(houseName.trim() || `${filled[0]}'s family`)
        toast.success("Your household is ready", { description: "Invite your family from Settings." })
      } catch (e) {
        toast.error("Couldn't create the household yet", {
          description: `${e instanceof Error ? e.message : ""} You can try again from Settings.`,
        })
      }
    }
    setBusy(false)
  }

  const join = async () => {
    setBusy(true)
    try {
      await joinHousehold(code)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't join")
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_60%)] p-5">
      <div key={path} className="w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
        {path !== "choose" && syncAvailable && (
          <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => setPath("choose")}>
            <ArrowLeft /> Back
          </Button>
        )}
        <HearthLogo className="size-14" />

        {path === "choose" && (
          <>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight">Welcome to Hearth</h1>
            <p className="mt-2 text-lg text-muted-foreground">
              A calm home for your family's tasks. It shows you one thing at a time, so you can stop deciding and start doing.
            </p>
            <div className="mt-8 grid gap-3">
              <button
                type="button"
                onClick={() => setPath("setup")}
                className="flex items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Users className="size-5" />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">Set up my family</span>
                  <span className="text-sm text-muted-foreground">I'm the first one here</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => setPath("join")}
                className="flex items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-secondary">
                  <UserPlus className="size-5" />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">Join my family</span>
                  <span className="text-sm text-muted-foreground">Someone gave me a code</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            </div>
          </>
        )}

        {path === "join" && (
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void join()
            }}
          >
            <h1 className="font-display text-4xl font-semibold tracking-tight">Join your family</h1>
            <p className="text-muted-foreground">Enter the code from the person who set up Hearth. It's in their Settings.</p>
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-2345"
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="Household code"
              className="h-14 rounded-xl text-center font-mono text-2xl tracking-widest md:text-2xl"
            />
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : null} Join <ArrowRight />
            </Button>
            <p className="text-xs text-muted-foreground">{PRIVACY_NOTE}</p>
          </form>
        )}

        {path === "setup" && (
          <>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight">{syncAvailable ? "Set up your family" : "Welcome to Hearth"}</h1>
            {!syncAvailable && (
              <p className="mt-2 text-lg text-muted-foreground">
                A calm home for your family's tasks. It shows you one thing at a time, so you can stop deciding and start doing.
              </p>
            )}
            <form
              className="mt-6 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (filled.length) void setup()
              }}
            >
              <label className="text-sm font-medium">Who's in your family? Put yourself first.</label>
              {names.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <MemberAvatar member={{ id: String(i), name: n, emoji: MEMBER_EMOJI[i % MEMBER_EMOJI.length], color: MEMBER_COLORS[i % MEMBER_COLORS.length] }} />
                  <Input
                    autoFocus={i === 0}
                    value={n}
                    onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={i === 0 ? "Your name" : "Name"}
                    className="h-11 rounded-xl text-base"
                  />
                  {names.length > 1 && (
                    <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => setNames(names.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  )}
                </div>
              ))}
              {names.length < 12 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setNames([...names, ""])}>
                  <Plus /> Add someone
                </Button>
              )}

              {syncAvailable && (
                <div className="space-y-3 rounded-xl border bg-card p-3">
                  <label className="flex items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-medium">Share with everyone's phones</span>
                      <span className="text-xs text-muted-foreground">You'll get a code to invite your family.</span>
                    </span>
                    <Switch checked={share} onCheckedChange={setShare} />
                  </label>
                  {share && (
                    <Input
                      value={houseName}
                      onChange={(e) => setHouseName(e.target.value)}
                      placeholder={filled[0] ? `${filled[0]}'s family` : "Household name, e.g. The Smiths"}
                      className="h-10 rounded-xl"
                      aria-label="Household name"
                    />
                  )}
                </div>
              )}

              <label className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
                <span>
                  <span className="block text-sm font-medium">Start with example tasks</span>
                  <span className="text-xs text-muted-foreground">See how it all works. Delete them anytime.</span>
                </span>
                <Switch checked={seed} onCheckedChange={setSeed} />
              </label>

              <Button type="submit" size="lg" className="mt-2 h-12 w-full text-base" disabled={!filled.length || busy}>
                {busy ? <Loader2 className="animate-spin" /> : null} Let's go <ArrowRight />
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {syncAvailable && share ? PRIVACY_NOTE : "Everything stays on this device. No account needed."}
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
