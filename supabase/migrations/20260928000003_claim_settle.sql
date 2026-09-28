-- A transfer to a wallet is only ever called off when its transaction can no longer happen.
-- The signature and the last block it is valid for are written down BEFORE the transaction is handed to the network,
-- so a transfer that was interrupted can be looked up later and settled one way or the other: never both.
alter table claims add column if not exists last_valid_height bigint;

create or replace function mark_claim_sent(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update claims set status = 'sent' where claims.id = p_id and status = 'pending';
  return found;
end $$;
revoke all on function mark_claim_sent(bigint) from public, anon, authenticated;
grant execute on function mark_claim_sent(bigint) to service_role;

-- totals now also count what is on its way to a wallet right now, so the books balance at every moment:
--   created = moved to wallets + on its way + still waiting on the site
drop function if exists ledger_totals();
create or replace function ledger_totals()
returns table (total_rows bigint, minted numeric, founder numeric, on_site numeric, in_wallets numeric, in_flight numeric, transfers bigint, head text)
language sql stable security definer set search_path = public as $$
  select (select count(*) from ledger),
         (select coalesce(sum(delta), 0) from ledger where reason in ('find', 'founder-fee')),
         (select coalesce(sum(delta), 0) from ledger where reason = 'founder-fee'),
         (select coalesce(sum(delta), 0) from ledger),
         (select coalesce(sum(amount + founder_amount), 0) from claims where status = 'sent'),
         (select coalesce(sum(amount + founder_amount), 0) from claims where status = 'pending'),
         (select count(*) from claims where status = 'sent'),
         (select hash from ledger order by id desc limit 1)
$$;
revoke all on function ledger_totals() from public, anon, authenticated;
grant execute on function ledger_totals() to service_role;
