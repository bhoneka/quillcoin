-- QuillCoin ledger (Supabase / Postgres). Nothing here ever stores a code or a coordinate.
create table rounds (
  id int primary key,
  opened_at timestamptz,
  note text
);
create table coins (
  round int references rounds(id),
  number int,
  hash text not null unique,            -- sha256 of the code, posted by the hider tool BEFORE the round opens
  hidden_at timestamptz not null,
  found_at timestamptz,
  found_by uuid references auth.users(id),
  primary key (round, number)
);
create table ledger (
  id bigserial primary key,
  at timestamptz default now(),
  user_id uuid references auth.users(id),
  delta numeric(12,3) not null,          -- +1 finder, +0.1 founder wallet
  reason text,
  coin_round int, coin_number int
);
create table blacklist (                 -- the hider's own accounts: may never redeem
  user_id uuid primary key,
  why text
);
-- public read of the board (hash, number, status, finder name); writes only through the functions below
alter table coins enable row level security;
create policy "board is public" on coins for select using (true);

-- hide(): called by the hider tool with the service key. Rejects a hash once the round is open.
-- redeem(code): sha256(code) -> row -> if unspent and user not blacklisted: set found_by/found_at atomically, ledger +1 user, +0.1 founder.
-- check(code): returns spent / unspent / unknown without spending.
-- (edge functions: api/hide.ts, api/redeem.ts, api/check.ts - to write once the Supabase project exists)
