declare const __APP_VERSION__: string

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"

/**
 * A Google Forms "pre-filled link" with the placeholder text DEVICEINFO typed into
 * the form's device field. We swap in the real version/device details at click time.
 */
const FORM_URL = import.meta.env.VITE_FEEDBACK_URL as string | undefined

export const feedbackAvailable = !!FORM_URL

function deviceSummary(): string {
  const ua = navigator.userAgent
  const os = /iPhone|iPad|iPod/.test(ua)
    ? `iOS ${(ua.match(/OS (\d+[_\d]*)/)?.[1] ?? "").replace(/_/g, ".")}`
    : /Android/.test(ua)
      ? `Android ${ua.match(/Android ([\d.]+)/)?.[1] ?? ""}`
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : "Other"
  const browser = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? "Chrome" : /Edg/.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Browser"
  const installed =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return `Hearth ${APP_VERSION} · ${os.trim()} · ${browser} · ${installed ? "installed app" : "in browser"} · ${window.innerWidth}×${window.innerHeight}`
}

export function openFeedback() {
  if (!FORM_URL) return
  const url = FORM_URL.includes("DEVICEINFO")
    ? FORM_URL.replace("DEVICEINFO", encodeURIComponent(deviceSummary()))
    : FORM_URL
  window.open(url, "_blank", "noopener")
}
