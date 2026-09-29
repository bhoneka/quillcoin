-- A recording can still be corrected while its round is not open (a cut that showed too much, a file that would not play).
-- From the moment the round is open, the fingerprint on a book can never change again, whoever asks.
create or replace function coins_recording_locked() returns trigger language plpgsql as $$
begin
  if old.video_hash is not null and new.video_hash is distinct from old.video_hash
     and exists (select 1 from rounds r where r.id = old.round and r.opened_at is not null and r.opened_at <= now()) then
    raise exception 'round % is open: the recording of a book can no longer be replaced', old.round;
  end if;
  return new;
end $$;
drop trigger if exists coins_recording_locked_t on coins;
create trigger coins_recording_locked_t before update on coins for each row execute function coins_recording_locked();
