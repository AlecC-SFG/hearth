# Hearth

A calm, ADHD-friendly task tracker for the whole family. It runs in any desktop
browser and installs on iPhone and Android as a home-screen app (PWA).

## Run it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## How it helps

| Problem | What Hearth does |
| --- | --- |
| Decision paralysis | **Now** shows one task. "Not this one" offers at most two others, then asks you to pick one for 10 minutes. Time and energy filters ("I have 15 min and low energy") narrow it further. |
| Hyperfocus | Every focus session is timeboxed and ends with a check-in. After 90 minutes on one task in a day (adjustable), Hearth suggests a real break. |
| Task bouncing | A limit on things in progress (default 2). Starting a third asks you to finish or park one. Nearly-finished tasks get a "finish line" priority boost. Stopping saves a "where I left off" note that shows first next time. |
| Competing projects | Projects, resources (3D printer, Desk PC, Quiet time…) and energy levels. The Projects page flags tasks fighting over the same resource, too much deep-focus work due on one day, and shows a 7-day workload chart. |

## Priority score (0–100)

Deadline pressure (time left vs. work left) + importance + how many tasks it
unblocks + finish-line bonus + quick-win bonus. Tasks waiting on unfinished
dependencies sink to the bottom. See `src/lib/priority.ts`.

## Data

Stored on each device in IndexedDB (`src/lib/storage.ts`). Use Settings →
Save backup / Restore backup to move data between devices. The storage
adapter is the single place to plug in cloud sync later.

## Put it on your phones

Phones need the app hosted at an HTTPS address. Any free static host works:

```bash
npm run build
```

Then deploy the `dist/` folder to Netlify, Vercel, Cloudflare Pages or GitHub
Pages. On iPhone, open the site in Safari → Share → Add to Home Screen. On
Android, open it in Chrome → ⋮ → Install app.

## Built with

shadcn/ui (Base UI flavor), Sonner (toasts), Vaul (mobile sheets), cmdk
(Ctrl/⌘ K palette), NumberFlow (animated numbers), Magic UI (confetti, border
beam, progress ring), Tailwind CSS v4, Zustand, date-fns, vite-plugin-pwa.

Keyboard: `N` new task · `1–4` switch views · `Ctrl/⌘ K` quick actions.
