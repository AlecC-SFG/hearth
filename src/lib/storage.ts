import { del, get, set } from "idb-keyval"
import type { StateStorage } from "zustand/middleware"

/**
 * Persistence layer. Everything goes through this adapter so a cloud sync
 * backend (e.g. Supabase) can be swapped in later without touching the UI.
 * IndexedDB is used because it survives better than localStorage on iOS
 * home-screen apps; localStorage is the fallback.
 */
export const storage: StateStorage = {
  async getItem(name) {
    try {
      return (await get<string>(name)) ?? null
    } catch {
      try {
        return localStorage.getItem(name)
      } catch {
        return null
      }
    }
  },
  async setItem(name, value) {
    try {
      await set(name, value)
    } catch {
      try {
        localStorage.setItem(name, value)
      } catch {
        /* storage unavailable — keep running in memory */
      }
    }
  },
  async removeItem(name) {
    try {
      await del(name)
    } catch {
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore */
      }
    }
  },
}

export function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function dayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
