-- Isolate Zernio social connections per avatar.
-- Each avatar gets its own Zernio profile (zernio_profile_id), instead of a
-- shared ZERNIO_PROFILE_ID env var. Legacy connections are wiped ("clean and
-- reconnect") so each avatar reconnects under its own profile.

-- 1. Per-avatar Zernio profile.
alter table public.avatars
  add column if not exists zernio_profile_id text;

create unique index if not exists avatars_zernio_profile_id_key
  on public.avatars (zernio_profile_id)
  where zernio_profile_id is not null;

-- 2. Clean and reconnect: drop legacy shared-profile connections and switch the
--    social_accounts uniqueness to include avatar_id, so avatars of the same
--    user no longer overwrite each other on sync upsert.
delete from public.social_accounts;

alter table public.social_accounts
  drop constraint if exists social_accounts_user_id_zernio_account_id_key;

alter table public.social_accounts
  add constraint social_accounts_user_avatar_account_key
  unique (user_id, avatar_id, zernio_account_id);
