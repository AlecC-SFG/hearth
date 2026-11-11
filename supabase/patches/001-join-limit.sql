-- Patch 001: make the join-code guessing limit count failed attempts.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

create or replace function public.join_household(p_code text) returns json
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
