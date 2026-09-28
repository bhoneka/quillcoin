-- The ledger becomes a hash chain: every row carries the hash of the row before it, so changing or removing any row breaks every hash after it.
-- Rows can only be added. The newest hash is also written into each claim's transaction on Solana, where nobody can rewrite it.
create extension if not exists pgcrypto with schema extensions;
alter table ledger add column if not exists prev text;
alter table ledger add column if not exists hash text;
alter table claims add column if not exists ledger_head text;

-- exactly the text that gets hashed, built from what the public ledger shows: prev|id|time|amount|reason|round|coin|who
create or replace function ledger_canon(p_prev text, p_id bigint, p_at timestamptz, p_delta numeric, p_reason text, p_round int, p_number int, p_user uuid)
returns text language sql immutable as $$
  select coalesce(p_prev, '') || '|' || p_id || '|' || to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || to_char(p_delta, 'FM999999990.000')
      || '|' || p_reason || '|' || coalesce(p_round::text, '') || '|' || coalesce(p_number::text, '') || '|' || case when p_user is null then 'founder' else 'finder' end
$$;

-- backfill the rows that already exist, oldest first
do $$
declare r record; last text := null;
begin
  for r in select * from ledger order by id loop
    update ledger set prev = last,
      hash = encode(extensions.digest(ledger_canon(last, r.id, r.at, r.delta, r.reason, r.coin_round, r.coin_number, r.user_id), 'sha256'), 'hex')
      where id = r.id returning hash into last;
  end loop;
end $$;

create or replace function ledger_chain() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(7757001);                       -- one writer at a time, so the chain never forks
  select l.hash into new.prev from ledger l order by l.id desc limit 1;
  new.hash := encode(extensions.digest(ledger_canon(new.prev, new.id, new.at, new.delta, new.reason, new.coin_round, new.coin_number, new.user_id), 'sha256'), 'hex');
  return new;
end $$;
drop trigger if exists ledger_chain_t on ledger;
create trigger ledger_chain_t before insert on ledger for each row execute function ledger_chain();

create or replace function ledger_frozen() returns trigger language plpgsql as $$
begin raise exception 'the ledger is append-only'; end $$;
drop trigger if exists ledger_no_change on ledger;
create trigger ledger_no_change before update or delete on ledger for each row execute function ledger_frozen();
drop trigger if exists ledger_no_truncate on ledger;
create trigger ledger_no_truncate before truncate on ledger for each statement execute function ledger_frozen();

-- what the public sees: the hashed fields as the exact strings that were hashed, and never a user id
create or replace view ledger_public as
select l.id, to_char(l.at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, to_char(l.delta, 'FM999999990.000') as delta,
       l.reason, l.coin_round, l.coin_number, case when l.user_id is null then 'founder' else 'finder' end as who, l.prev, l.hash
from ledger l;
revoke all on ledger_public from anon, authenticated;
grant select on ledger_public to service_role;
