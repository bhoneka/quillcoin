-- per-key hit counter for the api function (edge isolates don't share memory, so the count lives here)
create table if not exists rate (key text primary key, n int not null, at timestamptz not null);
alter table rate enable row level security;   -- no policies: nobody but the service role sees it
create or replace function bump_rate(p_key text, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  insert into rate (key, n, at) values (p_key, 1, now())
  on conflict (key) do update
    set n  = case when rate.at < now() - interval '1 minute' then 1 else rate.n + 1 end,
        at = case when rate.at < now() - interval '1 minute' then now() else rate.at end
  returning n into cur;
  if random() < 0.01 then delete from rate where at < now() - interval '10 minutes'; end if;
  return cur > p_max;
end $$;
revoke all on function bump_rate(text, int) from public, anon, authenticated;
grant execute on function bump_rate(text, int) to service_role;
