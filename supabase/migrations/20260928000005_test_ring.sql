-- The test round follows whatever ring is being tried: its ring may change while it is open. A real round's ring may not.
create or replace function rounds_ring_frozen() returns trigger language plpgsql as $$
begin
  if old.id >= 1 and old.opened_at is not null and old.opened_at <= now()
     and (new.ring_min is distinct from old.ring_min or new.ring_max is distinct from old.ring_max) then
    raise exception 'round % is open: its ring can no longer change', old.id;
  end if;
  return new;
end $$;
update rounds set ring_min = 15000, ring_max = 50000 where id = 0;
