alter table public.reaction_videos
  add column if not exists position_x numeric not null default 0,
  add column if not exists position_y numeric not null default 0;

alter table public.reaction_videos
  drop constraint if exists reaction_videos_position_x_range,
  add constraint reaction_videos_position_x_range
    check (position_x between -100 and 100);

alter table public.reaction_videos
  drop constraint if exists reaction_videos_position_y_range,
  add constraint reaction_videos_position_y_range
    check (position_y between -100 and 100);

drop policy if exists "reaction_videos_update_own" on public.reaction_videos;
create policy "reaction_videos_update_own"
  on public.reaction_videos for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.avatars
      where avatars.id = reaction_videos.avatar_id
        and avatars.user_id = (select auth.uid())
    )
  );
