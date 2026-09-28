-- Run ONCE, by hand, on the day before round 1 opens. It is not a migration and is never applied automatically.
--
-- Round 0 was the public test: its books, its finds and its transfers were made on Solana's test network with a token that is worth nothing.
-- This removes all of it, so that the real ledger starts empty, at line 1, with the real token.
-- It refuses to run once a real round is open or a real coin has been found. From that moment the ledger can only grow.
begin;

do $$
begin
  if exists (select 1 from rounds where id >= 1 and opened_at is not null and opened_at <= now()) then
    raise exception 'a real round is open: the ledger can no longer be reset';
  end if;
  if exists (select 1 from coins where round >= 1 and found_at is not null) then
    raise exception 'a real coin has been found: the ledger can no longer be reset';
  end if;
  if exists (select 1 from ledger where coin_round >= 1) then
    raise exception 'the ledger holds lines of a real round: it can no longer be reset';
  end if;
end $$;

-- the ledger refuses every change; for this one statement the guards are lifted, then put back
alter table ledger disable trigger ledger_no_change;
alter table ledger disable trigger ledger_no_truncate;
truncate table claims, ledger restart identity;
alter table ledger enable trigger ledger_no_change;
alter table ledger enable trigger ledger_no_truncate;

delete from coins where round = 0;
delete from rounds where id = 0;
truncate table rate;

-- what is left: the real rounds and the fingerprints already committed for them
select r.id as round, r.opened_at, count(c.*) as books_committed from rounds r left join coins c on c.round = r.id group by r.id, r.opened_at order by r.id;

commit;
