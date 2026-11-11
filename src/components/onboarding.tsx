import { useState } from "react"
import { ArrowRight, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { MemberAvatar } from "@/components/bits"
import { HearthLogo } from "@/components/logo"
import { MEMBER_COLORS, MEMBER_EMOJI, useStore } from "@/lib/store"

export function Onboarding() {
  const finish = useStore((s) => s.finishOnboarding)
  const [names, setNames] = useState<string[]>(["", "", ""])
  const [seed, setSeed] = useState(true)
  const filled = names.map((n) => n.trim()).filter(Boolean)

  const go = () =>
    finish(
      filled.map((name, i) => ({ name, emoji: MEMBER_EMOJI[i % MEMBER_EMOJI.length], color: MEMBER_COLORS[i % MEMBER_COLORS.length] })),
      seed,
    )

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_60%)] p-5">
      <div className="w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
        <HearthLogo className="size-14" />
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight">Welcome to Hearth</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          A calm home for your family's tasks. It shows you one thing at a time, so you can stop deciding and start doing.
        </p>

        <form
          className="mt-8 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (filled.length) go()
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
          {names.length < 8 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setNames([...names, ""])}>
              <Plus /> Add someone
            </Button>
          )}

          <label className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
            <span>
              <span className="block text-sm font-medium">Start with example tasks</span>
              <span className="text-xs text-muted-foreground">See how it all works. Delete them anytime.</span>
            </span>
            <Switch checked={seed} onCheckedChange={setSeed} />
          </label>

          <Button type="submit" size="lg" className="mt-2 h-12 w-full text-base" disabled={!filled.length}>
            Let's go <ArrowRight />
          </Button>
          <p className="text-center text-xs text-muted-foreground">Everything stays on this device. No account needed.</p>
        </form>
      </div>
    </div>
  )
}
