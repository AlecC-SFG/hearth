/**
 * Service worker registration with a friendly update flow.
 *
 * The service worker (vite-plugin-pwa, autoUpdate) installs new versions in the
 * background and takes over right away. The page that is already open keeps
 * running the old code, so we:
 *   - check for updates on launch, when the app comes back to the foreground,
 *     and hourly (installed home-screen apps rarely check on their own),
 *   - show "New version ready" with a Reload button when a new version takes over,
 *   - never reload by surprise while someone is typing; if the app goes into the
 *     background with an update waiting and nothing is half-edited, reload then,
 *   - after an update, say which version is now running,
 *   - offer "What's new" on both notices (notes come from public/whats-new.json).
 */
import { toast } from "sonner"
import { APP_VERSION } from "./feedback"
import { useUI } from "./ui"

const BASE = import.meta.env.BASE_URL
const LAST_VERSION_KEY = "hearth-last-version"
let updateWaiting = false

const shortVersion = (v: string) => v.split("+")[0]

/** Something is half-edited and a reload would lose it */
function busy() {
  const ui = useUI.getState()
  // Dialogs on their way out keep data-closed (Base UI) / data-state="closed" (Vaul) until the animation ends
  const openDialog = document.querySelector('[role=dialog]:not([data-closed]):not([data-state="closed"])')
  return !!ui.editing || ui.paletteOpen || !!ui.listTaskId || !!openDialog
}

export function setupPwa() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  // No controller yet = first install. That isn't an "update" worth announcing.
  const hadController = !!navigator.serviceWorker.controller

  navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE })
    .then((reg) => {
      const check = () => void reg.update().catch(() => {})
      setInterval(check, 60 * 60 * 1000)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check()
      })
    })
    .catch(() => {
      /* offline or unsupported: the app still works from the network */
    })

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || updateWaiting) return
    updateWaiting = true
    toast("A new version of Hearth is ready", {
      id: "hearth-update",
      description: "Tap Reload to update. Nothing you've saved will be lost.",
      duration: Infinity,
      action: { label: "Reload", onClick: () => location.reload() },
      cancel: { label: "What's new", onClick: () => useUI.getState().setWhatsNewOpen(true) },
    })
  })

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && updateWaiting && !busy()) location.reload()
  })
}

/** Call once the toaster is on screen: "Hearth updated to 0.3.2". */
export function announceUpdate() {
  try {
    const last = localStorage.getItem(LAST_VERSION_KEY)
    localStorage.setItem(LAST_VERSION_KEY, APP_VERSION)
    if (last && shortVersion(last) !== shortVersion(APP_VERSION)) {
      toast.success(`Hearth updated to ${shortVersion(APP_VERSION)}`, {
        duration: 8000,
        action: { label: "What's new", onClick: () => useUI.getState().setWhatsNewOpen(true) },
      })
    }
  } catch {
    /* storage unavailable */
  }
}
