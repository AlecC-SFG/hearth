import { useRef, useState, type ReactNode } from "react"
import { Download, Share, Smartphone, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
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
import { MemberAvatar, Segmented } from "@/components/bits"
import { useInstallPrompt } from "@/hooks/use-install"
import { useStore } from "@/lib/store"
import type { Settings } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function SettingsDialog() {
  const open = useUI((u) => u.settingsOpen)
  const setOpen = useUI((u) => u.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const members = useStore((s) => s.members)
  const update = useStore((s) => s.updateSettings)
  const { exportData, importData, resetAll } = useStore.getState()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const install = useInstallPrompt()

  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `hearth-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast.success("Backup saved")
  }

  const doImport = async (file?: File) => {
    if (!file) return
    try {
      importData(await file.text())
      toast.success("Backup restored")
      setOpen(false)
    } catch (e) {
      toast.error("Couldn't restore that file", { description: e instanceof Error ? e.message : undefined })
    }
  }

  const num = <K extends keyof Settings>(key: K, values: number[], fmt: (n: number) => string) => (
    <Segmented<number>
      size="sm"
      value={settings[key] as number}
      onChange={(v) => update({ [key]: v } as Partial<Settings>)}
      options={values.map((v) => ({ value: v, label: fmt(v) }))}
    />
  )

  return (
    <>
      <ResponsiveModal open={open} onOpenChange={setOpen} title="Settings">
        <div className="space-y-6">
          <Row label="Who's using this device?">
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => update({ currentMemberId: m.id })}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border pr-3 pl-1 text-sm font-medium",
                    settings.currentMemberId === m.id ? "border-primary bg-primary/12" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <MemberAvatar member={m} size="sm" /> {m.name}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Appearance">
            <Segmented<Settings["theme"]>
              size="sm"
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: "system", label: "Auto" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </Row>

          <div className="space-y-5 rounded-2xl bg-muted/50 p-4">
            <div className="text-sm font-semibold">Focus helpers</div>
            <Row label="Things in progress at once" hint="Starting more than this asks you to finish or park one first">
              {num("wipLimit", [1, 2, 3, 4, 5], String)}
            </Row>
            <Row label="Focus session length">{num("focusMinutes", [10, 15, 25, 45, 60], (n) => `${n}m`)}</Row>
            <Row label="Break length">{num("breakMinutes", [5, 10, 15], (n) => `${n}m`)}</Row>
            <Row label="Hyperfocus check" hint="After this much time on one task in a day, Hearth suggests a real break">
              {num("hyperfocusLimitMin", [45, 60, 90, 120, 0], (n) => (n ? `${n}m` : "Off"))}
            </Row>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Chime when time's up</span>
              <Switch checked={settings.sound} onCheckedChange={(sound) => update({ sound })} />
            </label>
          </div>

          <Row label="Install on your phone">
            {install.canPrompt ? (
              <Button variant="outline" onClick={install.prompt}>
                <Smartphone /> Install Hearth
              </Button>
            ) : install.installed ? (
              <p className="text-sm text-muted-foreground">Hearth is installed on this device. 🎉</p>
            ) : (
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p>
                  <b className="text-foreground">iPhone / iPad:</b> open Hearth in Safari, tap <Share className="inline size-3.5" /> Share, then <i>Add to Home Screen</i>.
                </p>
                <p>
                  <b className="text-foreground">Android:</b> open in Chrome, tap ⋮, then <i>Install app</i>.
                </p>
              </div>
            )}
          </Row>

          <Row label="Your data" hint="Everything is stored on this device. Save a backup now and then, or to move to a new device.">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={doExport}>
                <Download /> Save backup
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload /> Restore backup
              </Button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => doImport(e.target.files?.[0])} />
            </div>
          </Row>

          <Button variant="ghost" className="text-destructive" onClick={() => setConfirmReset(true)}>
            Erase everything & start over
          </Button>
        </div>
      </ResponsiveModal>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase everything?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes all people, projects and tasks on this device. It can't be undone unless you have a backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                resetAll()
                setConfirmReset(false)
                setOpen(false)
              }}
            >
              Erase everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
