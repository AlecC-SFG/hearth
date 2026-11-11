let ctx: AudioContext | undefined

/** A soft two-note chime — gentle enough not to startle. */
export function chime() {
  try {
    ctx ??= new AudioContext()
    const now = ctx.currentTime
    ;[659.25, 880].forEach((freq, i) => {
      const o = ctx!.createOscillator()
      const g = ctx!.createGain()
      o.type = "sine"
      o.frequency.value = freq
      const t = now + i * 0.22
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.18, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2)
      o.connect(g).connect(ctx!.destination)
      o.start(t)
      o.stop(t + 1.25)
    })
  } catch {
    /* audio unavailable */
  }
}

/** Unlock audio on a user gesture (required by iOS Safari). */
export function primeAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === "suspended") void ctx.resume()
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: number[] = [120, 80, 120]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* ignore */
  }
}

export function requestNotify() {
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission()
  } catch {
    /* ignore */
  }
}

export function notify(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return
    void navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, { body, icon: `${import.meta.env.BASE_URL}pwa-192x192.png`, tag: "hearth-focus" }))
      .catch(() => new Notification(title, { body }))
  } catch {
    /* ignore */
  }
}
