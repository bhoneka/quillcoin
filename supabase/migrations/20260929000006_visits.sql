-- How many people visit, without keeping who they are.
-- One row per day and visitor, under a fingerprint of the visitor's address that the API salts with a secret and with the day:
-- it cannot be turned back into an address, and the same visitor gets another fingerprint the next day. No cookie, nothing from anybody else.
create table if not exists visits (
  day date not null,
  who text not null check (who ~ '^[0-9a-f]{64}$'),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  loads int not null default 0,
  primary key (day, who)
);
alter table visits enable row level security;                 -- no policies: nobody reads it but the two functions below
revoke all on visits from public, anon, authenticated, service_role;

create or replace function note_visit(p_who text, p_load boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_who is null or p_who !~ '^[0-9a-f]{64}$' then return; end if;
  insert into visits (day, who, loads) values ((now() at time zone 'utc')::date, p_who, case when p_load then 1 else 0 end)
    on conflict (day, who) do update set last_at = now(), loads = visits.loads + case when p_load then 1 else 0 end;
  if random() < 0.01 then delete from visits where day < (now() at time zone 'utc')::date - 90; end if;   -- three months are kept
end $$;

-- the numbers, and nothing but numbers
create or replace function visitors()
returns table (last_5_min int, last_15_min int, last_hour int, today int, yesterday int, last_7_days int, pages_today int)
language sql stable security definer set search_path = public as $$
  select (select count(*) from visits where last_at > now() - interval '5 minutes')::int,
         (select count(*) from visits where last_at > now() - interval '15 minutes')::int,
         (select count(*) from visits where last_at > now() - interval '1 hour')::int,
         (select count(*) from visits where day = (now() at time zone 'utc')::date)::int,
         (select count(*) from visits where day = (now() at time zone 'utc')::date - 1)::int,
         (select count(*) from visits where day > (now() at time zone 'utc')::date - 7)::int,
         (select coalesce(sum(loads), 0) from visits where day = (now() at time zone 'utc')::date)::int
$$;
create or replace function visitors_by_day(p_days int default 14)
returns table (day date, visitors int, pages int)
language sql stable security definer set search_path = public as $$
  select v.day, count(*)::int, coalesce(sum(v.loads), 0)::int from visits v
   where v.day > (now() at time zone 'utc')::date - least(greatest(p_days, 1), 90) group by v.day order by v.day desc
$$;
create or replace function visitors_by_hour()
returns table (hour timestamptz, new_visitors int)
language sql stable security definer set search_path = public as $$
  select date_trunc('hour', v.first_at), count(*)::int from visits v
   where v.first_at > now() - interval '24 hours' group by 1 order by 1 desc
$$;

revoke all on function note_visit(text, boolean) from public, anon, authenticated;
revoke all on function visitors() from public, anon, authenticated;
revoke all on function visitors_by_day(int) from public, anon, authenticated;
revoke all on function visitors_by_hour() from public, anon, authenticated;
grant execute on function note_visit(text, boolean) to service_role;
grant execute on function visitors() to service_role;
grant execute on function visitors_by_day(int) to service_role;
grant execute on function visitors_by_hour() to service_role;
