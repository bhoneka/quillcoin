-- Rules that used to live in the API only are moved into the database, so that they hold whoever is asking.

-- 1. THE LEDGER'S LINE NUMBERS are given out under the same lock as the fingerprints.
--    Two lines written at the same moment can no longer be chained out of order, and the numbers never skip.
create or replace function ledger_chain() returns trigger language plpgsql as $$
declare last_id bigint;
begin
  perform pg_advisory_xact_lock(7757001);                       -- one writer at a time, so the chain never forks
  select l.id, l.hash into last_id, new.prev from ledger l order by l.id desc limit 1;
  new.id := coalesce(last_id, 0) + 1;
  new.hash := encode(extensions.digest(ledger_canon(new.prev, new.id, new.at, new.delta, new.reason, new.coin_round, new.coin_number, new.user_id), 'sha256'), 'hex');
  return new;
end $$;

-- 2. A BOOK IS REDEEMED WITH ITS CODE, NEVER WITH ITS FINGERPRINT. Fingerprints are public; the code is only in the book.
--    The database works out the fingerprint itself, so even the site's own key cannot redeem a book it has not been given the code of.
drop function if exists claim_coin(text, uuid, text, text);
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
  insert into ledger (user_id, delta, reason, coin_round, coin_number) values
    (p_user, 1.0, 'find', c.round, c.number),
    (null, 0.1, 'founder-fee', c.round, c.number);
  return query select c.round, c.number, now()::timestamptz;
end $$;

-- 3. A TRANSFER ENDS ONE WAY ONLY.
--    Its signature is written down once, and only onto a transfer that is still waiting and has none.
create or replace function note_claim_tx(p_id bigint, p_tx text, p_last_valid bigint, p_network text, p_head text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update claims set tx = p_tx, last_valid_height = p_last_valid, network = p_network, ledger_head = p_head
   where claims.id = p_id and status = 'pending' and tx is null;
  return found;
end $$;

--    A transfer that never got a signature is called off after a while. One that has a signature is never touched here.
create or replace function abandon_claim(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare c claims%rowtype;
begin
  update claims set status = 'failed' where claims.id = p_id and status = 'pending' and tx is null and at < now() - interval '3 minutes' returning * into c;
  if not found then return false; end if;
  insert into ledger (user_id, delta, reason) values (c.user_id, c.amount, 'claim-reversed');
  if c.founder_amount > 0 then insert into ledger (user_id, delta, reason) values (null, c.founder_amount, 'founder-claim-reversed'); end if;
  return true;
end $$;

--    Coins go back to the site only from a transfer that is still waiting. One that has a signature may still arrive for as long as
--    the network accepts it (about a minute), so for its first three minutes it cannot be returned at all, whoever asks.
drop function if exists fail_claim(bigint);
create function fail_claim(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare c claims%rowtype;
begin
  update claims set status = 'failed'
   where claims.id = p_id and status = 'pending' and (tx is null or at < now() - interval '3 minutes') returning * into c;
  if not found then return false; end if;
  insert into ledger (user_id, delta, reason) values (c.user_id, c.amount, 'claim-reversed');
  if c.founder_amount > 0 then insert into ledger (user_id, delta, reason) values (null, c.founder_amount, 'founder-claim-reversed'); end if;
  return true;
end $$;

--    And nobody starts transfers faster than a person would.
create or replace function begin_claim(p_user uuid, p_wallet text)
returns table (id bigint, amount numeric, founder_amount numeric)
language plpgsql security definer set search_path = public as $$
declare bal numeric; fee numeric; cid bigint;
begin
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

-- 4. AN OPEN ROUND STAYS AS IT WAS WHEN IT OPENED: its opening time, its ring, its size.
--    The test round (round 0) was emptied and removed before the first real round. A database built from these files does the same here.
delete from rounds r where r.id < 1 and not exists (select 1 from coins c where c.round = r.id);
create or replace function rounds_ring_frozen() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.opened_at is not null and old.opened_at <= now() then raise exception 'round % is open: it can no longer be removed', old.id; end if;
    return old;
  end if;
  if old.opened_at is not null and old.opened_at <= now()
     and (new.id is distinct from old.id or new.opened_at is distinct from old.opened_at or new.ring_min is distinct from old.ring_min
          or new.ring_max is distinct from old.ring_max or new.planned is distinct from old.planned) then
    raise exception 'round % is open: its opening time, its ring and its size can no longer change', old.id;
  end if;
  return new;
end $$;
drop trigger if exists rounds_ring_frozen_t on rounds;
create trigger rounds_ring_frozen_t before update or delete on rounds for each row execute function rounds_ring_frozen();
alter table rounds drop constraint if exists rounds_real;
alter table rounds add constraint rounds_real check (id >= 1);              -- the test round is gone for good

-- 5. SO DO ITS BOOKS. Once a round is open a book cannot be removed or altered; it can be found, once; its chest can be put on the map, once.
create or replace function coins_frozen() returns trigger language plpgsql as $$
declare is_open boolean;
begin
  select (r.opened_at is not null and r.opened_at <= now()) into is_open from rounds r where r.id = old.round;
  if tg_op = 'DELETE' then
    if is_open then raise exception 'round % is open: its books can no longer be removed', old.round; end if;
    return old;
  end if;
  if is_open then
    if new.round is distinct from old.round or new.number is distinct from old.number or new.hash is distinct from old.hash
       or new.hidden_at is distinct from old.hidden_at or new.blind is distinct from old.blind or new.server is distinct from old.server
       or new.loc_enc is distinct from old.loc_enc then
      raise exception 'round % is open: its books can no longer change', old.round;
    end if;
    if new.video_hash is distinct from old.video_hash or new.video_at is distinct from old.video_at
       or (old.video_url is not null and new.video_url is distinct from old.video_url) then
      raise exception 'round % is open: the recording of a book can no longer be replaced', old.round;
    end if;
  end if;
  if old.found_at is not null and (new.found_at is distinct from old.found_at or new.found_by is distinct from old.found_by
       or new.found_ign is distinct from old.found_ign or new.found_name is distinct from old.found_name) then
    raise exception 'a find cannot be changed';
  end if;
  if old.found_x is not null and (new.found_x is distinct from old.found_x or new.found_y is distinct from old.found_y or new.found_z is distinct from old.found_z) then
    raise exception 'the place of a find cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists coins_recording_locked_t on coins;
drop trigger if exists coins_frozen_t on coins;
create trigger coins_frozen_t before update or delete on coins for each row execute function coins_frozen();

-- 6. THE SITE'S OWN KEY writes to the ledger and to the list of transfers through the functions above, and in no other way.
revoke insert, update, delete, truncate on ledger from service_role;
revoke insert, update, delete, truncate on claims from service_role;
revoke insert, update, delete, truncate on blacklist from service_role;
revoke delete, truncate on coins, rounds, recordings from service_role;
--    Of a book it may write what the hider tool sends, the recording, and the place of a find. Who found a book is written by redeem_book alone.
revoke insert, update on coins from service_role;
grant insert (round, number, hash, hidden_at, blind, server, loc_enc) on coins to service_role;
grant update (loc_enc, video_hash, video_at, video_url, found_x, found_y, found_z) on coins to service_role;

revoke all on function redeem_book(text, uuid, text, text) from public, anon, authenticated;
revoke all on function note_claim_tx(bigint, text, bigint, text, text) from public, anon, authenticated;
revoke all on function abandon_claim(bigint) from public, anon, authenticated;
revoke all on function fail_claim(bigint) from public, anon, authenticated;
revoke all on function begin_claim(uuid, text) from public, anon, authenticated;
revoke all on function ledger_canon(text, bigint, timestamptz, numeric, text, int, int, uuid) from public, anon, authenticated;
grant execute on function redeem_book(text, uuid, text, text) to service_role;
grant execute on function note_claim_tx(bigint, text, bigint, text, text) to service_role;
grant execute on function abandon_claim(bigint) to service_role;
grant execute on function fail_claim(bigint) to service_role;
grant execute on function begin_claim(uuid, text) to service_role;
grant execute on function ledger_canon(text, bigint, timestamptz, numeric, text, int, int, uuid) to service_role;
