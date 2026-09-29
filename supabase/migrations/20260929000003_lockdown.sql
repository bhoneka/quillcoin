-- The site reads the board and the ledger through the API. Straight from the database a signed-in visitor may read
-- two things only: their own ledger lines and their own transfers. Everything else is closed at the door, whatever
-- the row rules say, and it stays closed for tables and functions that are added later.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select (user_id, delta, reason, coin_round, coin_number, at) on ledger to authenticated;
grant select (user_id, at, amount, wallet, status, tx, network) on claims to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
