-- The public ledger is read in pages, and its totals are counted by the database itself, so both stay right however long the ledger grows.
create or replace view ledger_named as
select p.id, p.at, p.delta, p.reason, p.coin_round, p.coin_number, p.who, p.prev, p.hash,
       case when p.who = 'founder' then 'FOUNDER'
            when p.coin_round is null then null
            else coalesce(c.found_ign, c.found_name, 'anonymous') end as name      -- shown next to the row, never part of what is hashed
from ledger_public p left join coins c on c.round = p.coin_round and c.number = p.coin_number;
revoke all on ledger_named from anon, authenticated;
grant select on ledger_named to service_role;

create or replace function ledger_totals()
returns table (total_rows bigint, minted numeric, founder numeric, on_site numeric, in_wallets numeric, transfers bigint, head text)
language sql stable security definer set search_path = public as $$
  select (select count(*) from ledger),
         (select coalesce(sum(delta), 0) from ledger where reason in ('find', 'founder-fee')),   -- coins only come into existence through a find and its fee
         (select coalesce(sum(delta), 0) from ledger where reason = 'founder-fee'),
         (select coalesce(sum(delta), 0) from ledger),                                           -- found, not yet moved to a wallet
         (select coalesce(sum(amount + founder_amount), 0) from claims where status = 'sent'),
         (select count(*) from claims where status = 'sent'),
         (select hash from ledger order by id desc limit 1)
$$;
revoke all on function ledger_totals() from public, anon, authenticated;
grant execute on function ledger_totals() to service_role;
