-- the chest position, encrypted by the hider tool with a key derived from the code; only a redeemed code can open it
alter table coins add column if not exists loc_enc text;
alter table coins add column if not exists found_x int;
alter table coins add column if not exists found_y int;
alter table coins add column if not exists found_z int;
