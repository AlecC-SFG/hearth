-- Hearth household sync schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it drops and recreates only Hearth's own objects.
--
-- Privacy model
--   * Every device signs in anonymously (no email or password).
--   * A device can only read or write rows for households it has joined.
--   * Joining requires the household's 8-character code (rate-limited).
--   * Enforced by Postgres row-level security, not by the app.

drop table if exists public.items cascade;
drop table if exists public.household_members cascade;
drop table if exists public.join_attempts cascade;
drop table if exists public.households cascade;
drop function if exists public.is_household_member(uuid) cascade;
drop function if exists public.create_household(text) cascade;
drop function if exists public.join_household(text) cascade;
drop function if exists public.rotate_join_code(uuid) cascade;
drop function if exists public.hearth_new_code() cascade;
drop function if exists public.hearth_touch() cascade;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- One row per synced record: a family member, project, task, or daily history count.
-- Deletes are soft (deleted = true) so other phones learn about them.
create table public.items (
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('member', 'project', 'task', 'history')),
  id text not null check (char_length(id) <= 120),
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, kind, id),
  constraint items_data_size check (data is null or pg_column_size(data) < 65536)
);
create index items_household_updated_idx on public.items (household_id, updated_at);

create table public.join_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index join_attempts_user_idx on public.join_attempts (user_id, at);

-- Server-side timestamps so "what changed since…" queries are reliable.
create function public.hearth_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger items_touch before insert or update on public.items
  for each row execute function public.hearth_touch();

create function public.is_household_member(h uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = h and m.user_id = auth.uid()
  )
$$;

-- 8 characters from an unambiguous alphabet (no 0/O, 1/I/L): ~850 billion combinations.
create function public.hearth_new_code() returns text
language plpgsql set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 31), 1);
  end loop;
  return code;
end $$;

create function public.create_household(p_name text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  loop
    v_code := public.hearth_new_code();
    exit when not exists (select 1 from public.households h where h.join_code = v_code);
  end loop;
  insert into public.households (name, join_code, created_by)
    values (left(trim(p_name), 80), v_code, auth.uid())
    returning households.id into v_id;
  insert into public.household_members (household_id, user_id) values (v_id, auth.uid());
  return json_build_object('id', v_id, 'name', left(trim(p_name), 80), 'join_code', v_code);
end $$;

create function public.join_household(p_code text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_house public.households;
  v_recent int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select count(*) into v_recent from public.join_attempts a
    where a.user_id = auth.uid() and a.at > now() - interval '1 hour';
  -- Failures return an error object instead of raising, so the attempt below is
  -- committed and the hourly limit actually counts wrong guesses.
  if v_recent >= 10 then
    return json_build_object('error', 'Too many tries. Please wait an hour and try again.');
  end if;
  insert into public.join_attempts (user_id) values (auth.uid());

  select * into v_house from public.households h
    where h.join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then
    return json_build_object('error', 'That code doesn''t match any household.');
  end if;

  insert into public.household_members (household_id, user_id)
    values (v_house.id, auth.uid())
    on conflict do nothing;
  return json_build_object('id', v_house.id, 'name', v_house.name, 'join_code', v_house.join_code);
end $$;

-- Any member can issue a new code (the old one stops working; joined phones stay joined).
create function public.rotate_join_code(p_household uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.is_household_member(p_household) then raise exception 'Not a member'; end if;
  loop
    v_code := public.hearth_new_code();
    exit when not exists (select 1 from public.households h where h.join_code = v_code);
  end loop;
  update public.households set join_code = v_code where id = p_household;
  return v_code;
end $$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.items enable row level security;
alter table public.join_attempts enable row level security; -- no policies: only the functions above touch it

create policy "members can read their household" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "members can rename their household" on public.households
  for update to authenticated using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy "members can see who joined" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy "a device can leave" on public.household_members
  for delete to authenticated using (user_id = auth.uid());

create policy "members read items" on public.items
  for select to authenticated using (public.is_household_member(household_id));
create policy "members add items" on public.items
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "members change items" on public.items
  for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

revoke all on function public.create_household(text), public.join_household(text),
  public.rotate_join_code(uuid), public.is_household_member(uuid), public.hearth_new_code() from public, anon;
grant execute on function public.create_household(text), public.join_household(text),
  public.rotate_join_code(uuid), public.is_household_member(uuid) to authenticated;

-- Live updates between phones
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;
