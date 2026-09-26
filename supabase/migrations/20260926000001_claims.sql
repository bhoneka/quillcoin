-- claiming a site balance to a wallet. The ledger stays the source of truth: a claim is a negative ledger row plus a record of where the tokens went.
create table if not exists claims (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid not null references auth.users(id),
  wallet text not null,
  amount numeric(12,3) not null,
  network text not null default 'devnet',
  status text not null default 'pending',     -- pending -> sent | failed
  tx text
);
alter table claims enable row level security;
create policy "own claims" on claims for select using (auth.uid() = user_id);

-- reserves the whole unclaimed balance in one transaction, so two clicks can never claim the same coins twice
create or replace function begin_claim(p_user uuid, p_wallet text)
returns table (id bigint, amount numeric)
language plpgsql security definer set search_path = public as $$
declare bal numeric; cid bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select coalesce(sum(l.delta), 0) into bal from ledger l where l.user_id = p_user;
  if bal <= 0 then raise exception 'nothing'; end if;
  insert into claims (user_id, wallet, amount) values (p_user, p_wallet, bal) returning claims.id into cid;
  insert into ledger (user_id, delta, reason) values (p_user, -bal, 'claim');
  return query select cid, bal;
end $$;

-- the transfer failed: give the balance back
create or replace function fail_claim(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c claims%rowtype;
begin
  update claims set status = 'failed' where claims.id = p_id and status = 'pending' returning * into c;
  if found then insert into ledger (user_id, delta, reason) values (c.user_id, c.amount, 'claim-reversed'); end if;
end $$;
revoke all on function begin_claim(uuid, text) from public, anon, authenticated;
revoke all on function fail_claim(bigint) from public, anon, authenticated;
grant execute on function begin_claim(uuid, text) to service_role;
grant execute on function fail_claim(bigint) to service_role;
