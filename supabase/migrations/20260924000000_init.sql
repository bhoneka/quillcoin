-- QuillCoin ledger. Nothing here ever stores a code or a coordinate.
create table if not exists rounds (
  id int primary key,
  opened_at timestamptz,          -- null = not open: hashes can still be added, nothing can be redeemed
  closed_at timestamptz,
  note text
);
insert into rounds (id, opened_at, note) values
  (0, now(), 'test round - singleplayer dev hides, worthless'),
  (1, null,  'round 1 - 10 coins within 100k of spawn')
on conflict do nothing;

create table if not exists coins (
  round int not null references rounds(id),
  number int not null,
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the code, posted by the hider tool BEFORE the round opens
  hidden_at timestamptz not null,
  blind boolean not null default false,                         -- hidden by a blind run
  server text,                                                  -- "2b2t.org" or "singleplayer"
  found_at timestamptz,
  found_by uuid references auth.users(id),
  found_ign text,
  primary key (round, number)
);

create table if not exists ledger (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users(id),   -- null = founder wallet
  delta numeric(12,3) not null,             -- +1 finder, +0.1 founder
  reason text not null,
  coin_round int, coin_number int
);

create table if not exists blacklist (      -- the hider's own accounts: may never redeem
  user_id uuid primary key references auth.users(id),
  why text
);

alter table rounds enable row level security;
alter table coins enable row level security;
alter table ledger enable row level security;
alter table blacklist enable row level security;
create policy "rounds are public" on rounds for select using (true);
create policy "board is public" on coins for select using (true);
create policy "own ledger" on ledger for select using (auth.uid() = user_id);
-- no insert/update policies anywhere: writes happen only inside the api function (service role) and claim_coin()

-- atomic redeem: one row lock, one winner, ledger written in the same transaction
create or replace function claim_coin(p_hash text, p_user uuid, p_ign text)
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
  update coins set found_at = now(), found_by = p_user, found_ign = p_ign where coins.hash = p_hash;
  insert into ledger (user_id, delta, reason, coin_round, coin_number) values
    (p_user, 1.0, 'find', c.round, c.number),
    (null, 0.1, 'founder-fee', c.round, c.number);
  return query select c.round, c.number, now()::timestamptz;
end $$;
revoke all on function claim_coin(text, uuid, text) from public, anon, authenticated;
