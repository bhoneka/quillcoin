-- the finder's Discord name is stored next to the optional Minecraft name; the board shows the IGN if given, else the Discord name
alter table coins add column if not exists found_name text;
drop function if exists claim_coin(text, uuid, text);
create or replace function claim_coin(p_hash text, p_user uuid, p_ign text, p_name text)
returns table (round int, number int, found_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare c coins%rowtype;
begin
  if exists (select 1 from blacklist b where b.user_id = p_user) then raise exception 'blacklisted'; end if;
  select * into c from coins where coins.hash = p_hash for update;
  if not found then raise exception 'unknown'; end if;
  if c.found_at is not null then raise exception 'spent'; end if;
  if not exists (select 1 from rounds r where r.id = c.round and r.opened_at is not null and r.opened_at <= now() and (r.closed_at is null or r.closed_at > now()))
    then raise exception 'closed'; end if;
  update coins set found_at = now(), found_by = p_user, found_ign = p_ign, found_name = p_name where coins.hash = p_hash;
  insert into ledger (user_id, delta, reason, coin_round, coin_number) values
    (p_user, 1.0, 'find', c.round, c.number),
    (null, 0.1, 'founder-fee', c.round, c.number);
  return query select c.round, c.number, now()::timestamptz;
end $$;
revoke all on function claim_coin(text, uuid, text, text) from public, anon, authenticated;
grant execute on function claim_coin(text, uuid, text, text) to service_role;
