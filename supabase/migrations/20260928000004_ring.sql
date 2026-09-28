-- Every round publishes the ring its books are hidden in: the distance from spawn, in overworld blocks.
-- The ring is set before the round opens and cannot be changed afterwards.
alter table rounds add column if not exists ring_min int not null default 15000;
alter table rounds add column if not exists ring_max int not null default 100000;
alter table rounds drop constraint if exists rounds_ring_ok;
alter table rounds add constraint rounds_ring_ok check (ring_min >= 0 and ring_max > ring_min);
update rounds set ring_min = 2000, ring_max = 100000 where id = 0;      -- the test round: wherever the tests happened to be

create or replace function rounds_ring_frozen() returns trigger language plpgsql as $$
begin
  if old.opened_at is not null and old.opened_at <= now()
     and (new.ring_min is distinct from old.ring_min or new.ring_max is distinct from old.ring_max) then
    raise exception 'round % is open: its ring can no longer change', old.id;
  end if;
  return new;
end $$;
drop trigger if exists rounds_ring_frozen_t on rounds;
create trigger rounds_ring_frozen_t before update on rounds for each row execute function rounds_ring_frozen();
