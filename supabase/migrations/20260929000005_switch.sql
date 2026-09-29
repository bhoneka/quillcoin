-- The token part of QuillCoin can be switched off as a whole, and is off from here on.
-- While it is off, a find creates one coin for its finder and nothing else: no founder's tenth, and nothing can be moved to a wallet.
-- A coin is then a line in this ledger and nothing more. Nothing is deleted: switching it on again is one row.
create table if not exists switches (
  name text primary key,
  is_on boolean not null,
  since timestamptz not null default now()
);
alter table switches enable row level security;               -- no policies: nobody but the site's own function reads it
revoke all on switches from public, anon, authenticated, service_role;
grant select on switches to service_role;                     -- and even that one cannot flip it
insert into switches (name, is_on) values ('token', false)
  on conflict (name) do update set is_on = excluded.is_on, since = now();

create or replace function token_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.is_on from switches s where s.name = 'token'), false)
$$;
revoke all on function token_on() from public, anon, authenticated;
grant execute on function token_on() to service_role;

-- a find: the founder's tenth is written only while the token part is on
create or replace function redeem_book(p_code text, p_user uuid, p_ign text, p_name text)
returns table (round int, number int, found_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare c coins%rowtype; h text; ign text; nm text;
begin
  if p_code is null or p_code !~ '^QLL-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$' then raise exception 'unknown'; end if;
  if exists (select 1 from blacklist b where b.user_id = p_user) then raise exception 'blacklisted'; end if;
  h := encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
  select * into c from coins where coins.hash = h for update;
  if not found then raise exception 'unknown'; end if;
  if c.found_at is not null then raise exception 'spent'; end if;
  if not exists (select 1 from rounds r where r.id = c.round and r.opened_at is not null and r.opened_at <= now() and (r.closed_at is null or r.closed_at > now()))
    then raise exception 'closed'; end if;
  ign := case when p_ign ~ '^[A-Za-z0-9_]{3,16}$' then p_ign else null end;
  nm := nullif(btrim(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9 _.\-]', '', 'g'), 32)), '');
  update coins set found_at = now(), found_by = p_user, found_ign = ign, found_name = nm where coins.hash = h;
  insert into ledger (user_id, delta, reason, coin_round, coin_number) values (p_user, 1.0, 'find', c.round, c.number);
  if token_on() then
    insert into ledger (user_id, delta, reason, coin_round, coin_number) values (null, 0.1, 'founder-fee', c.round, c.number);
  end if;
  return query select c.round, c.number, now()::timestamptz;
end $$;

-- a transfer cannot even begin while the token part is off
create or replace function begin_claim(p_user uuid, p_wallet text)
returns table (id bigint, amount numeric, founder_amount numeric)
language plpgsql security definer set search_path = public as $$
declare bal numeric; fee numeric; cid bigint;
begin
  if not token_on() then raise exception 'off'; end if;
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then raise exception 'wallet'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  if (select count(*) from claims c where c.user_id = p_user and c.at > now() - interval '1 hour') >= 6 then raise exception 'slow'; end if;
  if exists (select 1 from claims c where c.user_id = p_user and c.status = 'pending') then raise exception 'waiting'; end if;
  select coalesce(sum(l.delta), 0) into bal from ledger l where l.user_id = p_user;
  if bal <= 0 then raise exception 'nothing'; end if;
  fee := round(bal * 0.1, 3);
  insert into claims (user_id, wallet, amount, founder_amount) values (p_user, p_wallet, bal, fee) returning claims.id into cid;
  insert into ledger (user_id, delta, reason) values (p_user, -bal, 'claim'), (null, -fee, 'founder-claim');
  return query select cid, bal, fee;
end $$;

revoke all on function redeem_book(text, uuid, text, text) from public, anon, authenticated;
revoke all on function begin_claim(uuid, text) from public, anon, authenticated;
grant execute on function redeem_book(text, uuid, text, text) to service_role;
grant execute on function begin_claim(uuid, text) to service_role;
