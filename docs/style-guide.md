# Hearth style guide

Read this before changing any UI. It records how Hearth already looks, sounds and behaves, so new
screens fit in. When the code and this guide disagree, fix one of them in the same change.

---

## 1. Who it's for, and what that means for design

Hearth is a family task tracker built around ADHD. Three problems drive every screen:

| Problem | Design answer |
| --- | --- |
| **Decision paralysis** (too many options) | Show *one* thing first. The Now view leads with a single hero task and at most 3 candidates. Filters narrow choice instead of adding it. |
| **Task bouncing** (starting, never finishing) | The started-task limit (`WipGuard`) and "finish line" scoring. Make *finishing* the most rewarding action on screen. |
| **Hyperfocus** (locked on one endless thing) | Focus sessions have an end time; "Park it" is always one tap away and never feels like failure. |
| **Competing creative projects** | Projects view shows resource clashes and weekly load, so conflicts are visible before they happen. |

Rules that follow from this:

1. **One primary action per screen region.** If two buttons compete, one becomes `ghost` or `outline`.
2. **Explain the "why."** A ranked task shows its top reasons ("Deadline is close", "Quick win"). Never show a score without a reason nearby.
3. **Nothing punishing.** No red for "you're behind" except true overdue dates. Parked, reopened and skipped are neutral or warm, not red.
4. **Everything is undoable.** Destructive or state-changing actions toast with **Undo** instead of asking "Are you sure?" first. Confirmation dialogs are only for things that can't be undone (leaving a household, erasing a phone).
5. **Low reading load.** Short labels, sentence case, one idea per line of helper text.
6. **Today first.** Screens answer "what should I do today?". A repeating task's next occurrence
   stays hidden until its day (daily) or week, Sunday first (weekly), begins; the Tasks view keeps
   them in a collapsed **Coming up** section so parents can still find and edit them. When saving
   or finishing makes a task disappear, the toast says when it will show up ("back tomorrow").
7. **Missed isn't failed.** Only a real due date can make something overdue. A repeating task with
   no due date is open-ended: if its day or week passes, it quietly starts fresh (steps and progress
   reset, "where you left off" kept). Finished tasks show under **Recently done** for 7 days, then
   clear away on their own; one with a list attached moves to **Saved lists** until someone deletes
   it. The rules live in `src/lib/schedule.ts` and the store's `tidy()`.

---

## 2. Stack and where components come from

- **Base:** shadcn/ui, style `base-nova`, **Base UI** flavor (`src/components/ui/*`). Use `render={<Button />}`, not `asChild`.
- **Toasts:** Sonner (`toast`, `toast.success`, `toast.error`). Mounted once in `App.tsx`.
- **Phone sheets:** Vaul, used directly, through `ResponsiveModal` (never the Base UI drawer).
- **Command palette:** cmdk via `components/command-palette.tsx`.
- **Animated numbers:** `@number-flow/react` for any count that changes in front of the user (score, done today, list counts).
- **Celebration and accents (Magic UI):** `Confetti` (one instance, fired via `celebrate()`), `BorderBeam` (Now hero only), `AnimatedCircularProgressBar` (hero progress).
- **Icons:** lucide-react only. Default size comes from the button; inline icons are `size-3.5` (chips), `size-4` (text rows), `size-5` (nav).

Do not add another component kit. Effect components (Magic UI, Aceternity, RareUI) are for a
single moment of delight, not for chrome. Before adding one, ask: does this help someone *start*
or *finish*? If not, skip it.

Shared app pieces live in `src/components/bits.tsx`: `Chip`, `DueChip`, `BlockedChip`,
`UnblocksChip`, `ScoreBadge`, `MemberAvatar`, `AvatarStack`, `Segmented`, `ProgressBar`,
`EmptyState`. **Reuse these before writing new markup.**

---

## 3. Color

All colors are CSS variables in `src/index.css` (OKLCH), with light values on `:root` and dark on
`.dark`. Use the Tailwind token names; **never hard-code hex or oklch in components** (the
confetti palette in `actions.ts` is the one exception).

### Core palette (warm, hearth-like)

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `background` | Page | warm off-white `oklch(0.985 0.008 75)` | deep brown `oklch(0.17 0.012 50)` |
| `card` / `popover` | Raised surfaces | near white | `0.215` / `0.23` brown |
| `foreground` | Body text | dark brown | warm off-white |
| `muted` / `muted-foreground` | Wells, chips, secondary text | | |
| `primary` | Ember orange, the brand. Primary buttons, active nav, focus ring, links, "in progress" | `oklch(0.62 0.17 45)` | `oklch(0.72 0.16 50)` |
| `accent` | Soft warm hover/selected fill | | |
| `destructive` | Delete, leave, erase only | | |
| `border` / `input` | Hairlines | warm grey | white at 9% / 14% |

### Meaning colors (Hearth-specific)

| Token | Means | Typical use |
| --- | --- | --- |
| `success` (green) | Done, finished | Check circle, "done today" count |
| `hot` (red-orange) | Urgent / overdue | Score ≥ 60, overdue due chip |
| `warm` (amber) | Needs attention soon, gentle warning | Score 35–59, due soon, reopened, same-name hint |
| `calm` (teal) | Fine, no pressure | Score < 35 |
| `chart-1..5` | Data series only | Week load chart, project colors |

### Tinting recipe

Tinted backgrounds use the token at low opacity, with text in the full token:

```
bg-primary/12 text-primary     // selected, "Unblocks", in-progress chip
bg-hot/15 text-hot             // urgent
bg-warm/15 … bg-warm/20        // gentle warning (text stays foreground, amber text is hard to read)
bg-calm/15 text-calm
bg-foreground/8                // neutral "blocked"
```

Opacity steps in use: `/5` (hover wash), `/10`, `/12`, `/15`, `/18`, `/20`, `/25`, `/30` (shadow
tint), `/40` (hover borders), `/60` (dimmed). Stick to these.

Member colors are user data. Apply them only through `color-mix(in oklch, <color> 22%, var(--card))`
as `MemberAvatar` does, so they stay readable in both themes.

### Both themes, always

Every change must look right in light **and** dark. The theme is a `.dark` class on `<html>` set by
`ThemeSync` (light / dark / system). `theme-color` meta tags are `#fbf8f3` (light) and `#1c1612` (dark).

---

## 4. Typography

| Use | Classes |
| --- | --- |
| **Display** (screen titles, hero task, dialog titles, empty-state titles, logo wordmark) | `font-display` (Fraunces Variable) + `font-semibold`, `tracking-tight` on big titles |
| Screen title | `font-display text-3xl font-semibold tracking-tight md:text-4xl` |
| Hero task title | `font-display text-2xl md:text-3xl leading-tight text-balance` |
| Dialog / sheet title | `font-display text-xl` |
| Section heading | `font-display text-lg font-semibold` or `text-sm font-medium text-muted-foreground` for small labels |
| Body | Geist Variable, `text-sm` in dense lists, default `text-base` elsewhere |
| Task title in a row | `font-medium leading-snug` |
| Helper / meta | `text-xs` or `text-sm text-muted-foreground` |
| Numbers that line up or animate | `tabular-nums` |

Fraunces is for headings and big numbers only, never for buttons, inputs or body copy.
Sentence case everywhere ("New task", not "New Task"). Curly quotes in copy: “ ” and ’.

---

## 5. Shape, spacing and elevation

- **Radius base** `--radius: 0.85rem`. Rounded and friendly:
  - `rounded-full`: chips, avatars, check circles, score badges, progress bars
  - `rounded-lg`: segmented items
  - `rounded-xl`: inputs (`h-10 rounded-xl`), nav items, small panels, segmented track
  - `rounded-2xl`: task rows, list cards, inline callouts, FAB
  - `rounded-3xl`: the Now hero card, top of phone sheets (`rounded-t-3xl`)
- **Spacing:** views stack with `space-y-6`; lists with `space-y-2`; chips with `gap-1.5`; card
  padding `p-3` (rows, `md:p-3.5`), `p-5 md:p-7` (hero), `px-5` (modals).
- **Page frame:** `max-w-3xl`, `px-4 md:px-8`, `pt-5 md:pt-10`, bottom padding `pb-32` on phones
  so the FAB and nav never cover content.
- **Elevation:** mostly flat. `border bg-card` is the default card. `shadow-sm` on hover or the hero;
  `shadow-lg shadow-primary/30` on the FAB only. Sticky bars use `bg-background/85 backdrop-blur-md`.

---

## 6. Layout and responsiveness

- **Breakpoint:** `md` (768px) splits phone from desktop. `useIsDesktop()` matches it in JS.
- **Desktop:** 15rem sidebar (logo, household switcher, New task with `N` hint, nav, Quick
  actions `Ctrl K`, feedback, sync badge, person + settings) + content column.
- **Phone:** sticky top bar (logo, household switcher, sync badge, palette, settings, avatar),
  bottom nav with 4 tabs (Now, Tasks, Projects, Family), and a FAB for New task above it.
- **Safe areas:** use `.safe-top` / `.safe-bottom` on anything touching screen edges.
- **Touch targets:** at least 40px tall on phones (`h-10`, `size-9`+, nav `h-16`). Hover-only
  controls (like the row's Focus button) must have another route on touch (the editor).
- **Text overflow:** `min-w-0` + `truncate` on any flexible text; `text-balance` on big titles.
  Household names can be long and repeated: always render them through `displayName()`.

---

## 7. Component patterns

**Dialogs and sheets.** Use `ResponsiveModal` for anything with content: centered dialog on desktop,
Vaul bottom sheet on phones, with title, optional description, scrolling body and a footer whose
buttons fill the width on phones. Set `dismissible={false}` only when an answer is required. Use
`AlertDialog` only for irreversible confirmations. Never nest a `<form>` inside another form
(handle Enter in code, as `Checklist` does).

**Task row** (`TaskRow`). Card that opens the editor on click/Enter. Left: `CheckCircle`. Middle:
project emoji + title, then a wrapping chip line (status, list, due, time left, blocked/unblocks,
avatars pushed right), then a thin `ProgressBar` if partly done. Right: `ScoreBadge`. Blocked rows
dim (`bg-card/60`, muted title, disabled check); parked rows `opacity-75`.

**Chips** carry metadata. Always `Chip` from bits: `h-6 rounded-full text-xs`, icon `size-3.5`.
At most ~5 chips on a row; drop the least useful rather than wrapping to three lines.

**Segmented control** (`Segmented`) for 2–4 mutually exclusive filters. `size="sm"` in toolbars.
Prefer it over selects and tabs for filters.

**Callouts** (inline notices): `rounded-2xl p-3 text-sm` with a leading `size-4` icon. `bg-warm/15`
for attention, `border border-dashed` for "you could do this", `bg-primary/5` for info.

**Empty states:** `EmptyState` with one emoji, a display-font title and one sentence telling the
person what to do next. Never a bare "No items."

**Buttons.** shadcn `Button` variants: `default` (one per region), `outline` (secondary), `ghost`
(tertiary, toolbars), `destructive` (only for delete/leave/erase). Icon-only buttons need
`aria-label` and usually `title`. Show `Loader2 animate-spin` in place of the icon while busy, and
disable the button.

**Toasts.**
- `toast.success` for wins (completion uses a random line from `ENCOURAGEMENT` + confetti).
- Plain `toast` for neutral changes, **always with an Undo action** when the change can be reversed.
- `toast.error` with the error's own message (`friendlyError` for sync), never a stack trace.
- Description is the task title or one short sentence. Keep durations default; 8s for warnings people need to read.

**Finished tasks** offer two ways back: **Not done yet** (outline; puts the same task back) and
**Do it again** (`CopyPlus`; adds a fresh one-time copy, unchecked list included, and the finished
one stays finished). Both toast with Undo.

**Update notices** ("A new version of Hearth is ready", "Hearth updated to …") carry a
**What's new** button that opens `WhatsNew`. The notes come from `public/whats-new.json`: every
release adds an entry there, newest first, in this guide's voice (one plain sentence per change,
written for the family, not for developers). Settings links to the same popup from the version line.

**Numbers.** Counts that change on screen use `NumberFlow`. Scores are 0–100 integers in a
`ScoreBadge`, colored by `scoreTone()` (hot ≥ 60, warm ≥ 35, calm below).

**Household names** go through `displayName(h, households)`, which appends the first four
characters of the join code when two households on the phone share a name.

---

## 8. Motion

- Restrained and quick: view switch `animate-in fade-in-0 duration-200`; hero `fade-in-0 slide-in-from-bottom-2`; progress `transition-[width] duration-500 ease-out`; general `transition-colors` / `transition-all`.
- Big motion is a **reward**: confetti on completion, the border beam on the one task we want you to do. Don't spend it elsewhere.
- `prefers-reduced-motion` is honored globally in `index.css`, and confetti uses `disableForReducedMotion`. Don't add motion that bypasses this.

---

## 9. Voice and copy

Hearth sounds like a kind, practical family member: warm, brief, never nagging.

- **Do:** "Your one thing", "Park it", "It's done", "Not done yet", "Do it again", "Unblocks 2", "Waiting on 1",
  "Nice, there's room now", "Fewer open loops means more actually gets done."
- **Don't:** guilt ("You failed to…"), shouting, jargon ("WIP", "sync conflict", "RLS"), or
  exclamation marks on anything other than wins.
- Address the reader as "you"; say "household" (not "workspace" or "team"), "task", "project",
  "list" (shopping/check lists), "park" (pause without guilt), "focus session".
- Explain limits as care: the started-task limit says *why* it exists.
- Errors say what happened and what to do: "Couldn't join. Check the code and try again."
- No em dashes in new UI copy; use a period, comma or colon.

---

## 10. Accessibility

- Every interactive element is a real `button`/`a`/input, or has `role`, `tabIndex` and Enter handling (see `TaskRow`).
- Visible focus: `focus-visible:ring-3 focus-visible:ring-ring/40` (or `/50`); never remove outlines without a replacement.
- `aria-label` on icon buttons; `aria-current="page"` on nav; `role="radiogroup"`/`radio` + `aria-checked` in `Segmented`; sheets always get a (possibly `sr-only`) description.
- Don't rely on color alone: scores show numbers, due chips show text, blocked shows a lock icon.
- Amber (`warm`) is a background tint only; text on it stays `foreground`.

---

## 11. Checklist before shipping a UI change

- [ ] Uses tokens and `bits.tsx` pieces; no new hex values or one-off chip styles.
- [ ] Looks right in light and dark, at 375px wide and on desktop.
- [ ] Nothing hidden under the FAB, bottom nav or the phone's notch/home bar.
- [ ] One clear primary action; anything reversible offers Undo.
- [ ] Copy is short, sentence case, kind, and follows the vocabulary above.
- [ ] Keyboard and screen-reader basics: labels, focus ring, Enter works.
- [ ] Reduced motion still works; no new animation outside the reward moments.
- [ ] Long or duplicate household/task names truncate cleanly (`displayName`, `min-w-0 truncate`).
- [ ] If this guide no longer matches the code, update the guide in the same commit.
