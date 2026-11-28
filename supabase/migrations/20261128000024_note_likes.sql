-- 특이사항 좋아요: 회원 1명당 글 1개에 1번
create table if not exists public.note_likes (
  note_id    uuid not null references public.venue_notes (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
create index if not exists note_likes_user_idx on public.note_likes (user_id);

alter table public.note_likes enable row level security;

drop policy if exists "note_likes: 읽기" on public.note_likes;
create policy "note_likes: 읽기" on public.note_likes
  for select to anon, authenticated using ((select public.can_view()));

drop policy if exists "note_likes: 본인 누르기" on public.note_likes;
create policy "note_likes: 본인 누르기" on public.note_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));

drop policy if exists "note_likes: 본인 취소" on public.note_likes;
create policy "note_likes: 본인 취소" on public.note_likes
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.note_likes from anon, authenticated;
grant select, delete on public.note_likes to authenticated;
grant select on public.note_likes to anon;
grant insert (note_id) on public.note_likes to authenticated;

notify pgrst, 'reload schema';
