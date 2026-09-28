-- the founder's 0.1 travels with every finder's claim, in the same transaction. A founder-only row (user_id null) records a mint that had no finder attached.
alter table claims alter column user_id drop not null;
alter table claims add column if not exists founder_amount numeric(12,3) not null default 0;

drop function if exists begin_claim(uuid, text);
create or replace function begin_claim(p_user uuid, p_wallet text)
returns table (id bigint, amount numeric, founder_amount numeric)
language plpgsql security definer set search_path = public as $$
declare bal numeric; fee numeric; cid bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select coalesce(sum(l.delta), 0) into bal from ledger l where l.user_id = p_user;
  if bal <= 0 then raise exception 'nothing'; end if;
  fee := round(bal * 0.1, 3);
  insert into claims (user_id, wallet, amount, founder_amount) values (p_user, p_wallet, bal, fee) returning claims.id into cid;
  insert into ledger (user_id, delta, reason) values (p_user, -bal, 'claim'), (null, -fee, 'founder-claim');
  return query select cid, bal, fee;
end $$;

create or replace function fail_claim(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c claims%rowtype;
begin
  update claims set status = 'failed' where claims.id = p_id and status = 'pending' returning * into c;
  if found then
    insert into ledger (user_id, delta, reason) values (c.user_id, c.amount, 'claim-reversed');
    if c.founder_amount > 0 then insert into ledger (user_id, delta, reason) values (null, c.founder_amount, 'founder-claim-reversed'); end if;
  end if;
end $$;
revoke all on function begin_claim(uuid, text) from public, anon, authenticated;
revoke all on function fail_claim(bigint) from public, anon, authenticated;
grant execute on function begin_claim(uuid, text) to service_role;
grant execute on function fail_claim(bigint) to service_role;
