-- Automations UX iteration: AI instruction fields, multi-account, "no overlay" mode.

alter table public.automations
  add column if not exists overlay_ai_instructions text not null default '',
  add column if not exists caption_ai_instructions text not null default '',
  add column if not exists account_ids uuid[] not null default '{}';

-- Allow overlay_mode = 'none' (no overlay text at all).
alter table public.automations drop constraint if exists automations_overlay_mode_check;
alter table public.automations add constraint automations_overlay_mode_check
  check (overlay_mode in ('none', 'fixed', 'ideas', 'ai'));

-- Backfill account_ids from the legacy single account where present.
update public.automations
set account_ids = array[account_id]
where account_id is not null
  and (account_ids is null or array_length(account_ids, 1) is null);
