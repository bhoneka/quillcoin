-- each hide is recorded; the recording's hash is committed with the coin and the video itself is published when the coin is found
alter table coins add column if not exists video_hash text check (video_hash ~ '^[0-9a-f]{64}$');
alter table coins add column if not exists video_url text;
