-- 웨딩맵: 로그인·회원(0007) + 특이사항·사진(0008) 한 번에 적용
-- Supabase → SQL Editor → + New → 전체 붙여넣기 → Run (한 번만 실행)
begin;
-- =====================================================================
-- 3-1단계: 회원 명단, 1기기 로그인, 로그인한 사람만 보기
--
--   members        관리자가 올린 명단(이름+휴대폰). 명단에 있는 번호만 문자 로그인 가능.
--                  처음 로그인(문자 인증 완료)하면 auth 사용자와 연결되고 status = active.
--   active_sessions 회원별 "현재 유효한 로그인" 1개. 새 기기에서 로그인하면 교체되고
--                  이전 기기는 RLS에서 막힘 → 앱이 감지해 로그아웃.
--   app_settings   require_login_to_view: 켜면 비로그인·비회원은 아무것도 못 봄.
--
-- 휴대폰 번호 형식: Supabase Auth 와 같은 국제형 숫자만 (예: 821012345678)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 휴대폰 번호 정규화: '010-1234-5678', '+82 10 1234 5678' → '821012345678'
-- ---------------------------------------------------------------------
create function public.normalize_phone(p text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when d like '0%' then '82' || substr(d, 2)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- ---------------------------------------------------------------------
-- members : 회원 명단
-- ---------------------------------------------------------------------
create table public.members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 30),
  phone      text not null unique check (phone ~ '^82[0-9]{9,10}$'),
  status     text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  role       text not null default 'member' check (role in ('member', 'admin')),
  user_id    uuid unique references auth.users (id) on delete set null,
  note       text,
  joined_at  timestamptz,
  created_at timestamptz not null default now()
);

-- 저장 전 번호·이름 정리
create function public.members_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.name  := btrim(new.name);
  return new;
end;
$$;
create trigger members_normalize before insert or update of phone, name on public.members
  for each row execute function public.members_normalize();

-- 문자 인증이 끝난 auth 사용자를 명단과 연결
create function public.link_member_on_phone_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null and new.phone_confirmed_at is not null then
    update public.members
       set user_id   = new.id,
           status    = case when status = 'invited' then 'active' else status end,
           joined_at = coalesce(joined_at, now())
     where phone = public.normalize_phone(new.phone)
       and (user_id is null or user_id = new.id);
  end if;
  return new;
end;
$$;
create trigger on_auth_user_phone_confirmed
  after insert or update of phone, phone_confirmed_at on auth.users
  for each row execute function public.link_member_on_phone_confirm();

-- ---------------------------------------------------------------------
-- active_sessions : 1기기 로그인
-- ---------------------------------------------------------------------
create table public.active_sessions (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  session_id uuid not null,
  claimed_at timestamptz not null default now()
);

create function public._jwt_session_id()
returns uuid
language sql stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

-- ---------------------------------------------------------------------
-- app_settings : 한 행짜리 설정
-- ---------------------------------------------------------------------
create table public.app_settings (
  id                    boolean primary key default true check (id),
  require_login_to_view boolean not null default false,
  updated_at            timestamptz not null default now()
);
insert into public.app_settings (id) values (true);

-- ---------------------------------------------------------------------
-- 권한 판단 함수 (RLS에서 사용)
-- ---------------------------------------------------------------------
create function public.is_active_member()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.members m
      join public.active_sessions s on s.user_id = m.user_id
     where m.user_id = auth.uid()
       and m.status = 'active'
       and s.session_id = public._jwt_session_id()
  );
$$;

create function public.is_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_active_member()
     and exists (select 1 from public.members where user_id = auth.uid() and role = 'admin');
$$;

create function public.can_view()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select not (select require_login_to_view from public.app_settings where id)
      or public.is_active_member();
$$;

-- ---------------------------------------------------------------------
-- 클라이언트용 RPC
-- ---------------------------------------------------------------------

-- 로그인 전: 이름+번호가 명단과 일치하는지 (정지된 회원은 false)
create function public.check_member(p_name text, p_phone text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
     where phone = public.normalize_phone(p_phone)
       and replace(name, ' ', '') = replace(btrim(p_name), ' ', '')
       and status <> 'suspended'
  );
$$;

-- ---------------------------------------------------------------------
-- login_events : 접속 기록 (관리자가 계정 공유 의심을 확인하는 용도)
--   replaced_other = 다른 기기의 로그인을 밀어내고 들어온 경우 (= 기기 전환)
-- ---------------------------------------------------------------------
create table public.login_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  session_id     uuid not null,
  method         text,              -- otp(문자) / oauth(카카오) 등, JWT amr 에서
  device         text,              -- "iPhone · Safari" 같은 요약 (앱이 보냄)
  user_agent     text,
  replaced_other boolean not null default false,
  created_at     timestamptz not null default now()
);
create index login_events_user_idx on public.login_events (user_id, created_at desc);

-- 로그인 직후: 이 기기를 "현재 로그인"으로 등록 (이전 기기는 자동 로그아웃) + 접속 기록
create function public.claim_session(p_device text default null, p_user_agent text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public._jwt_session_id();
  v_status text;
  v_prev uuid;
begin
  if auth.uid() is null or v_sid is null then
    return 'anonymous';
  end if;
  select status into v_status from public.members where user_id = auth.uid();
  if v_status is null then
    return 'not_member';
  elsif v_status = 'suspended' then
    return 'suspended';
  end if;

  select session_id into v_prev from public.active_sessions where user_id = auth.uid();
  if v_prev is distinct from v_sid then
    insert into public.login_events (user_id, session_id, method, device, user_agent, replaced_other)
    values (auth.uid(), v_sid,
            auth.jwt() -> 'amr' -> 0 ->> 'method',
            left(p_device, 60), left(p_user_agent, 400),
            v_prev is not null);
  end if;

  insert into public.active_sessions (user_id, session_id, claimed_at)
  values (auth.uid(), v_sid, now())
  on conflict (user_id) do update set session_id = excluded.session_id, claimed_at = now();
  return 'ok';
end;
$$;

-- 관리자용 회원별 접속 요약
create view public.member_login_stats
with (security_invoker = on) as
select
  e.user_id,
  count(*) filter (where e.created_at > now() - interval '7 days')                         as logins_7d,
  count(*) filter (where e.replaced_other and e.created_at > now() - interval '24 hours')  as switches_24h,
  count(*) filter (where e.replaced_other and e.created_at > now() - interval '7 days')    as switches_7d,
  count(distinct e.device) filter (where e.created_at > now() - interval '7 days')         as devices_7d,
  max(e.created_at)                                                                         as last_login_at
from public.login_events e
group by e.user_id;

-- 주기적 확인: ok / replaced(다른 기기 로그인) / suspended / not_member / unclaimed / anonymous
create function public.session_status()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then jsonb_build_object('status', 'anonymous')
    when m.id is null then jsonb_build_object('status', 'not_member')
    when m.status = 'suspended' then jsonb_build_object('status', 'suspended')
    when s.session_id is null then jsonb_build_object('status', 'unclaimed')
    when s.session_id <> public._jwt_session_id() then jsonb_build_object('status', 'replaced')
    else jsonb_build_object(
      'status', 'ok',
      'role', m.role,
      'name', m.name,
      'nickname', (select nickname from public.profiles where id = auth.uid()))
  end
  from (select 1) one
  left join public.members m on m.user_id = auth.uid()
  left join public.active_sessions s on s.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.members         enable row level security;
alter table public.active_sessions enable row level security;
alter table public.app_settings    enable row level security;

-- members: 관리자만 전체, 본인은 자기 행만 읽기
create policy "members: 관리자 읽기"   on public.members for select to authenticated using ((select public.is_admin()) or user_id = (select auth.uid()));
create policy "members: 관리자 추가"   on public.members for insert to authenticated with check ((select public.is_admin()));
create policy "members: 관리자 수정"   on public.members for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "members: 관리자 삭제"   on public.members for delete to authenticated using ((select public.is_admin()));
grant select, insert, update, delete on public.members to authenticated;
revoke all on public.members from anon;

-- login_events: 관리자만 읽기, 쓰기는 claim_session 함수만
alter table public.login_events enable row level security;
create policy "login_events: 관리자 읽기" on public.login_events for select to authenticated using ((select public.is_admin()));
grant select on public.login_events, public.member_login_stats to authenticated;
revoke insert, update, delete on public.login_events from anon, authenticated;
revoke all on public.login_events, public.member_login_stats from anon;

-- active_sessions: 함수로만 접근
revoke all on public.active_sessions from anon, authenticated;

-- app_settings: 누구나 읽기, 관리자만 수정
create policy "app_settings: 누구나 읽기" on public.app_settings for select to anon, authenticated using (true);
create policy "app_settings: 관리자 수정" on public.app_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.app_settings to anon, authenticated;
grant update (require_login_to_view) on public.app_settings to authenticated;

-- ── 기존 테이블 정책 교체: 보기 = can_view(), 쓰기 = 활성 회원 ──
drop policy "profiles: 누구나 읽기" on public.profiles;
drop policy "profiles: 본인만 수정" on public.profiles;
create policy "profiles: 읽기" on public.profiles for select to anon, authenticated using ((select public.can_view()));
create policy "profiles: 본인만 수정" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active_member()))
  with check (id = (select auth.uid()));

drop policy "venues: 누구나 읽기" on public.venues;
drop policy "venues: 로그인 사용자 수정" on public.venues;
drop policy "venues: 로그인 사용자 추가" on public.venues;
create policy "venues: 읽기" on public.venues for select to anon, authenticated using ((select public.can_view()));
create policy "venues: 회원 수정" on public.venues for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy "venues: 회원 추가" on public.venues for insert to authenticated with check ((select public.is_active_member()));

drop policy "nearby_parking: 누구나 읽기" on public.nearby_parking;
drop policy "nearby_parking: 로그인 추가" on public.nearby_parking;
drop policy "nearby_parking: 로그인 수정" on public.nearby_parking;
drop policy "nearby_parking: 로그인 삭제" on public.nearby_parking;
create policy "nearby_parking: 읽기" on public.nearby_parking for select to anon, authenticated using ((select public.can_view()));
create policy "nearby_parking: 회원 추가" on public.nearby_parking for insert to authenticated with check ((select public.is_active_member()));
create policy "nearby_parking: 회원 수정" on public.nearby_parking for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy "nearby_parking: 회원 삭제" on public.nearby_parking for delete to authenticated using ((select public.is_active_member()));

drop policy "halls: 누구나 읽기" on public.halls;
drop policy "halls: 로그인 추가" on public.halls;
drop policy "halls: 로그인 수정" on public.halls;
drop policy "halls: 로그인 삭제" on public.halls;
create policy "halls: 읽기" on public.halls for select to anon, authenticated using ((select public.can_view()));
create policy "halls: 회원 추가" on public.halls for insert to authenticated with check ((select public.is_active_member()));
create policy "halls: 회원 수정" on public.halls for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy "halls: 회원 삭제" on public.halls for delete to authenticated using ((select public.is_active_member()));

drop policy "hall_schedules: 누구나 읽기" on public.hall_schedules;
drop policy "hall_schedules: 로그인 추가" on public.hall_schedules;
drop policy "hall_schedules: 로그인 수정" on public.hall_schedules;
drop policy "hall_schedules: 로그인 삭제" on public.hall_schedules;
create policy "hall_schedules: 읽기" on public.hall_schedules for select to anon, authenticated using ((select public.can_view()));
create policy "hall_schedules: 회원 추가" on public.hall_schedules for insert to authenticated with check ((select public.is_active_member()));
create policy "hall_schedules: 회원 수정" on public.hall_schedules for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy "hall_schedules: 회원 삭제" on public.hall_schedules for delete to authenticated using ((select public.is_active_member()));

drop policy "edits: 누구나 읽기" on public.edits;
create policy "edits: 읽기" on public.edits for select to anon, authenticated using ((select public.can_view()));

-- ── 함수 실행 권한 ──
revoke execute on function
  public.members_normalize(), public.link_member_on_phone_confirm()
from public, anon, authenticated;
revoke execute on function public.claim_session(text, text), public.session_status() from public, anon;
grant execute on function public.claim_session(text, text), public.session_status() to authenticated;
grant execute on function public.check_member(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 기본 닉네임이 겹치면 가입 자체가 실패하던 문제 수정: 안 겹칠 때까지 숫자를 붙임
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := left(btrim(coalesce(
                   new.raw_user_meta_data ->> 'nickname',
                   new.raw_user_meta_data ->> 'name', '')), 15);
  v_nick text;
  i int := 0;
begin
  if char_length(v_base) < 2 then
    v_base := '작가' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;
  v_nick := v_base;
  while exists (select 1 from public.profiles where lower(nickname) = lower(v_nick)) loop
    i := i + 1;
    v_nick := v_base || (floor(random() * 9000) + 1000)::int;
    if i > 20 then
      v_nick := '작가' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    end if;
  end loop;

  insert into public.profiles (id, nickname) values (new.id, v_nick)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- =====================================================================
-- 주차·촬영 특이사항 (회원 글 + 사진 최대 4장)
--   venue_notes   예식장 × 구역(parking/photo)별로 회원이 여러 개 올림. 최신순.
--   사진 파일     Storage 버킷 'venue-photos' (비공개)
--                 경로: {venue_id}/{note_id}/{1..4}.jpg  (+ 썸네일 {n}_t.jpg)
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
    if p !~ ('^' || new.venue_id || '/' || new.id || '/[1-4]\.jpg$') then
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
  select p ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[1-4](_t)?\.jpg$'
     and exists (select 1 from public.venues where id::text = split_part(p, '/', 1));
$$;

create policy "venue-photos: 보기" on storage.objects for select to anon, authenticated
  using (bucket_id = 'venue-photos' and (select public.can_view()));
create policy "venue-photos: 회원 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'venue-photos' and (select public.is_active_member()) and public.is_valid_venue_photo_path(name));
create policy "venue-photos: 본인·관리자 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'venue-photos' and ((owner_id = (select auth.uid())::text and (select public.is_active_member())) or (select public.is_admin())));

commit;
