# Setting up Hearth for family testing

Two free accounts, about 15 minutes total. You only do this once.

## 1. Supabase (keeps each household's phones in sync)

1. Go to https://supabase.com and click **Start your project**. Signing in with GitHub is easiest.
2. Click **New project**.
   - Name: `hearth`
   - Database password: let it generate one and save it in your password manager. (Claude doesn't need it.)
   - Region: the one closest to most of your family (for example *East US*).
   - Plan: **Free**.
3. Wait a minute or two for the project to finish setting up.
4. Left sidebar → **SQL Editor** → **New query**. Open `supabase/schema.sql` from this folder, copy all of it, paste it in, and click **Run**. You should see *Success. No rows returned*.
5. Left sidebar → **Authentication** → **Sign In / Providers**. Turn on **Allow anonymous sign-ins** and click **Save**.
   (Testers never create accounts or passwords. Each phone gets an anonymous ID.)
6. Click **Connect** at the top of the project (or **Project Settings → API Keys**) and copy:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **Publishable key** (starts with `sb_publishable_`)

   Send Claude those two values. **Never share the secret key or the database password.**
   The publishable key is designed to be public. The database's row-level security rules
   are what keep each household private.

Free-plan notes: plenty of room for dozens of families. A free project pauses after
7 days with **no use at all**, and you can un-pause it from the dashboard.

## 2. Google Form (collects feedback)

1. Go to https://forms.google.com and start a **Blank form**. Title it *Hearth feedback*.
2. Add these questions:
   - **What happened, or what's your idea?** (Paragraph, required)
   - **What kind of feedback is this?** (Multiple choice: Something's broken · Something's confusing · Idea · I love this part)
   - **Your name (optional)** (Short answer)
   - **Device info** (Short answer). The app fills this in automatically.
3. Click the **⋮** menu (top right) → **Pre-fill form** (older versions call it *Get pre-filled link*).
   The form opens in a new tab.
4. In the *Device info* box type exactly `DEVICEINFO`, leave the rest blank, then click
   **Get link** at the bottom, then **Copy link** in the bar that pops up.
5. Send Claude that link. It ends with something like `&entry.123456789=DEVICEINFO`.
6. Optional: **Responses** tab → **Link to Sheets** to collect everything in a spreadsheet.

## What Claude does with these

Adds them as GitHub repository variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`FEEDBACK_URL`), tests two-phone sync against your project, then publishes the update.
