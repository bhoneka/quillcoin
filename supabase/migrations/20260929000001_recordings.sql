-- A recording of a dungeon can give its place away: the pattern of a dungeon's floor is decided by the world's seed, and 2b2t's seed is known.
-- So a recording's fingerprint is public from the moment it is committed, and the recording itself opens when the book is found.
-- Until then its address is kept here, where only the site's own function can read it.
create table if not exists recordings (
  round int not null,
  number int not null,
  url text not null check (url ~ '^https://'),
  added_at timestamptz not null default now(),
  primary key (round, number),
  foreign key (round, number) references coins (round, number) on delete cascade
);
alter table recordings enable row level security;     -- no policies: nobody but the service role sees it
revoke all on recordings from anon, authenticated;

alter table coins add column if not exists video_at timestamptz;    -- when the fingerprint was committed

-- the moment a book is found its recording opens, in the same transaction as the find
create or replace function coins_open_recording() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.found_at is not null and old.found_at is null and new.video_url is null then
    new.video_url := (select r.url from recordings r where r.round = new.round and r.number = new.number);
  end if;
  return new;
end $$;
drop trigger if exists coins_open_recording_t on coins;
create trigger coins_open_recording_t before update on coins for each row execute function coins_open_recording();
revoke all on function coins_open_recording() from public, anon, authenticated;
