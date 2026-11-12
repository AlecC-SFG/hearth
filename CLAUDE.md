# Hearth

Family task tracker PWA (Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui Base UI flavor),
built for ADHD-friendly prioritization. Live at https://alecc-sfg.github.io/hearth/.

## UI changes

**Before changing any UI, read [docs/style-guide.md](docs/style-guide.md) and follow it.** It defines
the design principles, color tokens, typography, component patterns, motion, copy voice and the
pre-ship checklist. If a change makes the guide out of date, update the guide in the same commit.

## Notes

- Local builds in Git Bash on Windows need `MSYS2_ENV_CONV_EXCL='*'` so `BASE_PATH` isn't mangled.
- Supabase: only the publishable key is used. Never ask for the secret key or database password.
- Commits use the GitHub no-reply email as author.
