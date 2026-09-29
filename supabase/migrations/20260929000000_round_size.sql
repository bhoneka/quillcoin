-- Every round publishes how many books it holds, next to its ring. Neither can change once the round is open,
-- and the database itself refuses a book too many, or a book for a round that is already open.
alter table rounds add column if not exists planned int;
alter table rounds drop constraint if exists rounds_planned_ok;
alter table rounds add constraint rounds_planned_ok check (planned is null or planned > 0);
update rounds set planned = 10, note = 'round 1' where id = 1;

create or replace function rounds_ring_frozen() returns trigger language plpgsql as $$
begin
  if old.id >= 1 and old.opened_at is not null and old.opened_at <= now()
     and (new.ring_min is distinct from old.ring_min or new.ring_max is distinct from old.ring_max or new.planned is distinct from old.planned) then
    raise exception 'round % is open: its ring and its size can no longer change', old.id;
  end if;
  return new;
end $$;

create or replace function coins_guard() returns trigger language plpgsql as $$
declare r rounds%rowtype; n int;
begin
  perform pg_advisory_xact_lock(7757002);                       -- one book at a time, so two can never slip under the limit together
  select * into r from rounds where id = new.round;
  if not found then raise exception 'no such round'; end if;
  if r.id >= 1 and r.opened_at is not null and r.opened_at <= now() then
    raise exception 'round % is open: nothing can be added to it', r.id;
  end if;
  if r.planned is not null then
    select count(*) into n from coins where round = new.round;
    if n >= r.planned then raise exception 'round % already holds all % of its books', r.id, r.planned; end if;
  end if;
  return new;
end $$;
drop trigger if exists coins_guard_t on coins;
create trigger coins_guard_t before insert on coins for each row execute function coins_guard();
