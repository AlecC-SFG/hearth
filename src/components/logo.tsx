import { cn } from "@/lib/utils"

/** Hearth mark: a rounded house with a flame inside. */
export function HearthLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--primary)" />
      <path d="M32 13 13 29v20a4 4 0 0 0 4 4h30a4 4 0 0 0 4-4V29L32 13Z" fill="var(--primary-foreground)" opacity=".95" />
      <path
        d="M32 27c4.5 4.6 7 8.2 7 12a7 7 0 0 1-14 0c0-2.4 1-4.4 2.8-6.3.3 2 1.3 3.3 2.7 3.8-.5-3.4.2-6.3 1.5-9.5Z"
        fill="var(--primary)"
      />
    </svg>
  )
}
