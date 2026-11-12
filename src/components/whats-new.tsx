import { useEffect, useState } from "react"
import { format } from "date-fns"
import { Loader2, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/responsive-modal"
import { Chip } from "@/components/bits"
import { APP_VERSION } from "@/lib/feedback"
import { useUI } from "@/lib/ui"

interface Release {
  version: string
  date: string
  changes: string[]
}

const running = APP_VERSION.split("+")[0]

/** -1, 0 or 1, comparing "0.10.2" style versions */
function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1
  return 0
}

/**
 * "What's new" popup. The notes live in public/whats-new.json and are fetched when
 * opened, so a page still running the old version can show the new version's notes.
 */
export function WhatsNew() {
  const open = useUI((u) => u.whatsNewOpen)
  const setOpen = useUI((u) => u.setWhatsNewOpen)
  const [releases, setReleases] = useState<Release[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`${import.meta.env.BASE_URL}whats-new.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<Release[]>) : Promise.reject()))
      .then((list) => {
        if (!live) return
        setReleases(list.slice(0, 4))
        setFailed(false)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [open])

  const newer = releases?.some((r) => compare(r.version, running) > 0)

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={setOpen}
      title="What's new in Hearth"
      description={newer ? "A new version is ready. Reload to start using it." : `You're on version ${running}.`}
      footer={
        newer ? (
          <Button onClick={() => location.reload()}>
            <RefreshCw /> Reload now
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setOpen(false)}>
            Got it
          </Button>
        )
      }
    >
      {failed ? (
        <p className="py-2 text-sm text-muted-foreground">Couldn't load the notes right now. Check your connection and try again.</p>
      ) : !releases ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5 pb-2">
          {releases.map((r) => {
            const cmp = compare(r.version, running)
            return (
              <section key={r.version} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-semibold tabular-nums">{r.version}</h3>
                  {cmp > 0 && (
                    <Chip icon={<Sparkles />} className="bg-primary/12 text-primary">
                      New
                    </Chip>
                  )}
                  {cmp === 0 && <Chip>This version</Chip>}
                  <span className="ml-auto text-xs text-muted-foreground">{format(new Date(`${r.date}T12:00`), "MMM d")}</span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {r.changes.map((c) => (
                    <li key={c} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </ResponsiveModal>
  )
}
