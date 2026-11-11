-- Patch 002: allow list items (grocery lists etc.) to sync individually.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check
  check (kind in ('member', 'project', 'task', 'history', 'listitem'));
