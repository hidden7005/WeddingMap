-- =====================================================================
-- 주차·촬영 특이사항 (회원 글 + 사진 최대 4장)
--   venue_notes   예식장 × 구역(parking/photo)별로 회원이 여러 개 올림. 최신순.
--   사진 파일     Storage 버킷 'venue-photos' (비공개)
--                 경로: 예식장id/글id/1~4.jpg  (+ 썸네일 1~4_t.jpg)
--   권한          보기 = can_view() / 쓰기 = 활성 회원 / 지우기 = 올린 본인 또는 관리자
--   0007(회원·로그인) 다음에 적용해야 함
-- =====================================================================

create table public.venue_notes (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  section     text not null check (section in ('parking', 'photo')),
  body        text check (char_length(body) <= 500),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  author_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint venue_notes_not_empty check (char_length(btrim(coalesce(body, ''))) > 0 or cardinality(photo_paths) > 0)
);
create index venue_notes_venue_idx on public.venue_notes (venue_id, section, created_at desc);
create index venue_notes_author_idx on public.venue_notes (author_id);

-- 작성자는 서버가 채움 (클라이언트 값 무시), 사진 경로는 이 글의 폴더만 허용
create function public.venue_notes_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p text;
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.venue_id  := old.venue_id;
    new.section   := old.section;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.body := nullif(btrim(new.body), '');
  foreach p in array new.photo_paths loop
    if not (p = any (array[
        new.venue_id || '/' || new.id || '/1.jpg', new.venue_id || '/' || new.id || '/2.jpg',
        new.venue_id || '/' || new.id || '/3.jpg', new.venue_id || '/' || new.id || '/4.jpg'])) then
      raise exception '사진 경로가 올바르지 않습니다: %', p using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
create trigger venue_notes_before_write before insert or update on public.venue_notes
  for each row execute function public.venue_notes_before_write();

-- 수정 이력에도 남김 (누가 언제 올리고 지웠는지)
create trigger venue_notes_log after insert or update or delete on public.venue_notes
  for each row execute function public.log_edit();

alter table public.venue_notes enable row level security;
create policy "venue_notes: 읽기" on public.venue_notes for select to anon, authenticated
  using ((select public.can_view()));
create policy "venue_notes: 회원 작성" on public.venue_notes for insert to authenticated
  with check ((select public.is_active_member()));
create policy "venue_notes: 본인 수정" on public.venue_notes for update to authenticated
  using (author_id = (select auth.uid()) and (select public.is_active_member()))
  with check (author_id = (select auth.uid()));
create policy "venue_notes: 본인·관리자 삭제" on public.venue_notes for delete to authenticated
  using ((author_id = (select auth.uid()) and (select public.is_active_member())) or (select public.is_admin()));

grant select on public.venue_notes to anon, authenticated;
grant insert (id, venue_id, section, body, photo_paths) on public.venue_notes to authenticated;
grant update (body, photo_paths) on public.venue_notes to authenticated;
grant delete on public.venue_notes to authenticated;
revoke execute on function public.venue_notes_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 사진 저장소 (비공개 버킷: 볼 때는 짧은 기간 유효한 서명 URL 사용)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-photos', 'venue-photos', false, 5 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do nothing;

-- 경로 첫 폴더가 실제 예식장 id 이고, 파일명이 1~4 (썸네일 _t 포함) 인 jpg 만
create function public.is_valid_venue_photo_path(p text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select split_part(p, '/', 4) = ''
     and split_part(p, '/', 3) in ('1.jpg', '2.jpg', '3.jpg', '4.jpg', '1_t.jpg', '2_t.jpg', '3_t.jpg', '4_t.jpg')
     and length(split_part(p, '/', 2)) = 36
     and translate(split_part(p, '/', 2), '0123456789abcdef-', '') = ''
     and exists (select 1 from public.venues where id::text = split_part(p, '/', 1))
$$;

create policy "venue-photos: 보기" on storage.objects for select to anon, authenticated
  using (bucket_id = 'venue-photos' and (select public.can_view()));
create policy "venue-photos: 회원 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'venue-photos' and (select public.is_active_member()) and public.is_valid_venue_photo_path(name));
create policy "venue-photos: 본인·관리자 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'venue-photos' and ((owner_id = (select auth.uid())::text and (select public.is_active_member())) or (select public.is_admin())));
