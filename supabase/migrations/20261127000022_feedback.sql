-- 수정 건의사항: 회원이 보내고 관리자만 읽음
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  status     text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_status_idx on public.feedback (status, created_at);

alter table public.feedback enable row level security;

drop policy if exists "feedback: 회원 보내기" on public.feedback;
create policy "feedback: 회원 보내기" on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));

drop policy if exists "feedback: 관리자 읽기" on public.feedback;
create policy "feedback: 관리자 읽기" on public.feedback
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "feedback: 관리자 처리" on public.feedback;
create policy "feedback: 관리자 처리" on public.feedback
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant insert (body) on public.feedback to authenticated;
grant update (status) on public.feedback to authenticated;

-- 회원 이름 보여주기용 (profiles 와 연결)
alter table public.feedback drop constraint if exists feedback_user_profile_fkey;
alter table public.feedback add constraint feedback_user_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

notify pgrst, 'reload schema';
