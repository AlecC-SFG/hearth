import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** Null when this build has no Supabase project configured (local-only mode). */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "hearth-auth" },
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null

export const syncAvailable = !!supabase

/** Sign this device in anonymously (no email or password). */
export async function ensureSession(): Promise<string> {
  if (!supabase) throw new Error("Sync isn't set up in this version of Hearth.")
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.user.id
  let signed, error
  try {
    ;({ data: signed, error } = await supabase.auth.signInAnonymously())
  } catch (e) {
    throw new Error(friendlyError(e))
  }
  if (error || !signed?.user) {
    throw new Error(
      error?.message?.toLowerCase().includes("anonymous")
        ? "Household sync isn't switched on yet (anonymous sign-ins are disabled)."
        : error
          ? friendlyError(error)
          : "Couldn't connect. Check your internet connection.",
    )
  }
  return signed.user.id
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)
  if (/fetch|network|NetworkError|Load failed|ERR_NAME|AuthRetryableFetchError/i.test(msg)) return "Couldn't reach the server. Check your internet connection."
  return msg
}
