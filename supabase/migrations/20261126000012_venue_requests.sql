-- =====================================================================
-- 식장 등록 요청
--   검색해도 안 나오는 예식장을 회원이 요청 → 관리자 화면에서 확인 후 등록/반려
--   권한  요청 = 활성 회원 / 보기 = 본인 요청 + 관리자 / 처리·삭제 = 관리자
-- =====================================================================

create table public.venue_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  location     text check (location is null or char_length(location) <= 300),
  memo         text check (memo is null or char_length(memo) <= 500),
  requested_by uuid references public.profiles (id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);
create index venue_requests_status_idx on public.venue_requests (status, created_at desc);
create index venue_requests_by_idx on public.venue_requests (requested_by);

-- 요청자는 서버가 채움
create function public.venue_requests_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.status := 'pending';
    new.created_at := now();
    new.handled_at := null;
  elsif new.status is distinct from old.status then
    new.handled_at := case when new.status = 'pending' then null else now() end;
  end if;
  new.name := btrim(new.name);
  new.location := nullif(btrim(new.location), '');
  new.memo := nullif(btrim(new.memo), '');
  return new;
end;
$$;
create trigger venue_requests_before_write before insert or update on public.venue_requests
  for each row execute function public.venue_requests_before_write();

alter table public.venue_requests enable row level security;
create policy "venue_requests: 회원 요청" on public.venue_requests for insert to authenticated
  with check ((select public.is_active_member()));
create policy "venue_requests: 본인·관리자 보기" on public.venue_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));
create policy "venue_requests: 관리자 처리" on public.venue_requests for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "venue_requests: 관리자 삭제" on public.venue_requests for delete to authenticated
  using ((select public.is_admin()));

revoke all on public.venue_requests from anon, authenticated;
grant select, delete on public.venue_requests to authenticated;
grant insert (name, location, memo) on public.venue_requests to authenticated;
grant update (status) on public.venue_requests to authenticated;
revoke execute on function public.venue_requests_before_write() from public, anon, authenticated;
