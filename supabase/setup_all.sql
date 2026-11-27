-- 웨딩맵 전체 스키마 (supabase/migrations/ 파일을 순서대로 합친 것)
-- 새 프로젝트에서 한 번만 실행. 기존 프로젝트는 아직 적용 안 한 번호의 파일만 실행하세요.

-- >>>>> 20261108000001_init_schema.sql
-- =====================================================================
-- 웨딩맵 초기 스키마
--   venues (예식장) ─┬─ nearby_parking (주변 주차장)
--                    └─ halls (홀) ── hall_schedules (시간표)
--   edits (수정 이력), profiles (수정자 표시 이름)
--
-- 선택형 값은 영문 코드로 저장하고 화면 라벨은 프론트에서 매핑한다.
-- (코드 ↔ 한글 라벨 표는 README 참고)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles : 수정 이력에 "누가"를 보여주기 위한 공개 프로필
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- 회원가입 시 프로필 자동 생성 (이메일 앞부분을 기본 이름으로)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- venues : 예식장
-- ---------------------------------------------------------------------
create table public.venues (
  id uuid primary key default gen_random_uuid(),

  -- ── 원본 CSV 데이터 (import 스크립트만 씀, 사용자 수정 불가) ──
  source_key          text not null unique,  -- 상가업소번호, 없으면(호텔) 'h:' || 해시
  biz_no              text unique,           -- 상가업소번호 (호텔은 null)
  sido                text not null,
  sigungu             text not null,
  name                text not null,         -- 상호명
  branch_name         text,                  -- 지점명
  road_address        text not null,         -- 도로명주소 (같은 값 = 지도 마커 하나로 묶음)
  jibun_address       text,
  building_name       text,
  floor               text,
  lat                 double precision not null,
  lng                 double precision not null,
  category            text not null
    check (category in ('wedding_hall', 'hotel_4', 'hotel_5', 'auxiliary')),
  wedding_confirm     text,                  -- 예식확인 (원본 그대로)
  hotel_grade         text,
  room_count          integer,
  phone               text,
  homepage            text,
  registered_industry text,                  -- 등록업종
  former_names        text,                  -- 통합전_상호

  -- ── 주차 ──
  guest_free_minutes      integer check (guest_free_minutes >= 0),
  overtime_fee            integer check (overtime_fee >= 0),            -- 원
  overtime_unit_minutes   integer check (overtime_unit_minutes > 0),    -- 위 요금의 단위 시간(분)
  guest_free_methods      text[] check (guest_free_methods <@ array[
                            'auto', 'front_desk', 'ticket', 'plate_input']::text[]),
  vendor_parking_methods  text[] check (vendor_parking_methods <@ array[
                            'same_as_guest', 'auto', 'front_desk', 'ticket', 'plate_input',
                            'paid', 'not_allowed']::text[]),
  parking_capacity        text check (parking_capacity in ('ample', 'normal', 'tight')),
  parking_notes           text,
  parking_checked_at      timestamptz,

  -- ── 촬영 규정 ──
  official_vendor_designated boolean,        -- 원판 지정 업체 여부
  official_vendor_name       text,
  external_snap_policy       text check (external_snap_policy in (
                               'all_allowed',          -- 전부 허용
                               'no_official',          -- 원판만 불가
                               'ceremony_restricted',  -- 본식 제한
                               'no_external')),        -- 외부 업체 불가
  official_photo_timing      text check (official_photo_timing in ('before', 'after', 'mixed')),
  flash_policy               text check (flash_policy in ('allowed', 'limited', 'prohibited')),
  external_vendor_fee        integer check (external_vendor_fee >= 0),  -- 외부 업체 등록비(원), 0 = 무료
  pass_required              boolean,                                    -- 출입증 필요 여부
  equipment_route            text,           -- 장비 반입 동선
  bridal_room_info           text,           -- 신부대기실 정보
  photo_notes                text,           -- 촬영 특이사항
  photo_checked_at           timestamptz,

  -- ── 메타 ──
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index venues_road_address_idx on public.venues (road_address);
create index venues_sido_idx         on public.venues (sido);

-- ---------------------------------------------------------------------
-- nearby_parking : 주변 주차장
-- ---------------------------------------------------------------------
create table public.nearby_parking (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues (id) on delete cascade,
  name         text not null,
  fee          text,                -- "30분 1,000원 / 일 최대 15,000원" 같은 형태가 많아 텍스트
  walk_minutes integer check (walk_minutes >= 0),
  memo         text,
  lat          double precision,
  lng          double precision,
  checked_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index nearby_parking_venue_idx on public.nearby_parking (venue_id);

-- ---------------------------------------------------------------------
-- halls : 홀
-- ---------------------------------------------------------------------
create table public.halls (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  name        text not null,
  floor       text,
  hall_type   text check (hall_type in ('standalone', 'separate', 'simultaneous', 'chapel', 'outdoor')),
              -- 단독 / 분리 / 동시 / 채플 / 야외
  photo_notes text,                 -- 홀별 촬영 예외사항
  sort_order  integer not null default 0,
  checked_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (venue_id, name)
);
create index halls_venue_idx on public.halls (venue_id);

-- ---------------------------------------------------------------------
-- hall_schedules : 홀 시간표 (예식 간격·동시예식은 저장하지 않고 뷰에서 계산)
-- ---------------------------------------------------------------------
create table public.hall_schedules (
  id         uuid primary key default gen_random_uuid(),
  hall_id    uuid not null references public.halls (id) on delete cascade,
  start_time time not null,
  day_type   text not null default 'common'
             check (day_type in ('sat', 'sun', 'weekday', 'common')),  -- 토/일/평일/공통
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (hall_id, day_type, start_time)
);
create index hall_schedules_hall_idx on public.hall_schedules (hall_id);

-- ---------------------------------------------------------------------
-- edits : 수정 이력 (트리거가 자동 기록, 클라이언트는 쓰기 불가)
-- ---------------------------------------------------------------------
create table public.edits (
  id         bigint generated always as identity primary key,
  venue_id   uuid references public.venues (id) on delete cascade,  -- 상세 화면에서 모아보기용
  table_name text not null,
  record_id  uuid not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  field      text,              -- update일 때 바뀐 컬럼, insert/delete는 null
  old_value  jsonb,
  new_value  jsonb,
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index edits_venue_idx  on public.edits (venue_id, created_at desc);
create index edits_record_idx on public.edits (table_name, record_id);

-- >>>>> 20261108000002_triggers_and_history.sql
-- =====================================================================
-- 메타 자동 갱신 + 수정 이력(edits) 자동 기록
--   * updated_at / updated_by 는 트리거가 채운다 (클라이언트 값 무시)
--   * 섹션 필드가 바뀌면 해당 섹션의 "최종 확인일"을 now()로 갱신
--   * 로그인 사용자(auth.uid() 있음)의 변경만 edits에 남긴다
--     → service_role로 돌리는 CSV import는 이력에 남지 않음
-- =====================================================================

-- 이력에서 제외할 메타 컬럼
create function public._edit_ignored_columns()
returns text[]
language sql immutable
as $$
  select array['updated_at', 'updated_by', 'created_at',
               'checked_at', 'parking_checked_at', 'photo_checked_at']::text[];
$$;

-- ---------------------------------------------------------------------
-- BEFORE INSERT/UPDATE : 메타 갱신
-- ---------------------------------------------------------------------
create function public.set_row_meta()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$$;

create trigger venues_meta         before insert or update on public.venues         for each row execute function public.set_row_meta();
create trigger nearby_parking_meta before insert or update on public.nearby_parking for each row execute function public.set_row_meta();
create trigger halls_meta          before insert or update on public.halls          for each row execute function public.set_row_meta();
create trigger hall_schedules_meta before insert or update on public.hall_schedules for each row execute function public.set_row_meta();

-- ---------------------------------------------------------------------
-- 최종 확인일 갱신
--   - 섹션 필드가 바뀌면 now()
--   - 내용 변경 없이 "확인만" 할 때는 클라이언트가 *_checked_at 을 직접 보냄
--   - 미래 날짜는 now()로 잘라냄
-- ---------------------------------------------------------------------
create function public.venues_bump_checked_at()
returns trigger
language plpgsql
as $$
begin
  if (new.guest_free_minutes, new.overtime_fee, new.overtime_unit_minutes,
      new.guest_free_methods, new.vendor_parking_methods, new.parking_capacity, new.parking_notes)
     is distinct from
     (old.guest_free_minutes, old.overtime_fee, old.overtime_unit_minutes,
      old.guest_free_methods, old.vendor_parking_methods, old.parking_capacity, old.parking_notes)
  then
    new.parking_checked_at := now();
  end if;

  if (new.official_vendor_designated, new.official_vendor_name, new.external_snap_policy,
      new.official_photo_timing, new.flash_policy, new.external_vendor_fee, new.pass_required,
      new.equipment_route, new.bridal_room_info, new.photo_notes)
     is distinct from
     (old.official_vendor_designated, old.official_vendor_name, old.external_snap_policy,
      old.official_photo_timing, old.flash_policy, old.external_vendor_fee, old.pass_required,
      old.equipment_route, old.bridal_room_info, old.photo_notes)
  then
    new.photo_checked_at := now();
  end if;

  -- 주의: least()는 NULL을 무시하므로 NULL이면 그대로 둔다
  if new.parking_checked_at > now() then new.parking_checked_at := now(); end if;
  if new.photo_checked_at   > now() then new.photo_checked_at   := now(); end if;
  return new;
end;
$$;

create trigger venues_checked_at before update on public.venues
  for each row execute function public.venues_bump_checked_at();

create function public.child_bump_checked_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.checked_at is not distinct from old.checked_at then
    new.checked_at := now();
  end if;
  new.checked_at := least(coalesce(new.checked_at, now()), now());
  return new;
end;
$$;

create trigger nearby_parking_checked_at before insert or update on public.nearby_parking
  for each row execute function public.child_bump_checked_at();
create trigger halls_checked_at before insert or update on public.halls
  for each row execute function public.child_bump_checked_at();

-- 시간표가 바뀌면 소속 홀의 최종 확인일 갱신
create function public.schedules_touch_hall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.halls
     set checked_at = now()
   where id = coalesce(new.hall_id, old.hall_id);
  return null;
end;
$$;

create trigger hall_schedules_touch_hall after insert or update or delete on public.hall_schedules
  for each row execute function public.schedules_touch_hall();

-- ---------------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE : 수정 이력 기록
-- ---------------------------------------------------------------------
create function public.log_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_old      jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new      jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row      jsonb := coalesce(v_new, v_old);
  v_venue_id uuid;
  v_key      text;
begin
  if v_uid is null then
    return null;  -- import·관리자 작업은 기록하지 않음
  end if;

  v_venue_id := case tg_table_name
    when 'venues'         then (v_row ->> 'id')::uuid
    when 'hall_schedules' then (select h.venue_id from public.halls h where h.id = (v_row ->> 'hall_id')::uuid)
    else (v_row ->> 'venue_id')::uuid
  end;

  -- 홀 삭제로 cascade 삭제된 시간표: 홀 삭제 이력에 포함되므로 생략
  if tg_table_name = 'hall_schedules' and v_venue_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all (public._edit_ignored_columns())
         and (v_old -> v_key) is distinct from (v_new -> v_key) then
        insert into public.edits (venue_id, table_name, record_id, action, field, old_value, new_value, user_id)
        values (v_venue_id, tg_table_name, (v_row ->> 'id')::uuid, 'update', v_key,
                v_old -> v_key, v_new -> v_key, v_uid);
      end if;
    end loop;
  else
    insert into public.edits (venue_id, table_name, record_id, action, field, old_value, new_value, user_id)
    values (v_venue_id, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), null, v_old, v_new, v_uid);
  end if;

  return null;
end;
$$;

create trigger venues_log         after update                     on public.venues         for each row execute function public.log_edit();
create trigger nearby_parking_log after insert or update or delete on public.nearby_parking for each row execute function public.log_edit();
create trigger halls_log          after insert or update or delete on public.halls          for each row execute function public.log_edit();
create trigger hall_schedules_log after insert or update or delete on public.hall_schedules for each row execute function public.log_edit();

-- >>>>> 20261108000003_views.sql
-- =====================================================================
-- 계산 뷰 (security_invoker: 조회자 권한·RLS 그대로 적용)
-- =====================================================================

-- 요일 구분이 겹치는지: 'common'(공통)은 모든 요일과 겹침
create function public.day_types_overlap(a text, b text)
returns boolean
language sql immutable
as $$
  select a = b or a = 'common' or b = 'common';
$$;

-- ---------------------------------------------------------------------
-- 시간표 + 계산값
--   interval_minutes : 같은 홀·같은 요일의 다음 예식까지 간격(분), 마지막 회차는 null
--   is_simultaneous  : 같은 예식장 "다른 홀"에 같은 시각·겹치는 요일 예식이 있으면 true
-- ---------------------------------------------------------------------
create view public.hall_schedules_computed
with (security_invoker = on) as
select
  s.id,
  s.hall_id,
  h.venue_id,
  h.name as hall_name,
  s.day_type,
  s.start_time,
  (
    select extract(epoch from (min(n.start_time) - s.start_time))::int / 60
      from public.hall_schedules n
     where n.hall_id = s.hall_id
       and n.start_time > s.start_time
       and public.day_types_overlap(n.day_type, s.day_type)
  ) as interval_minutes,
  exists (
    select 1
      from public.hall_schedules o
      join public.halls oh on oh.id = o.hall_id
     where oh.venue_id = h.venue_id
       and o.hall_id <> s.hall_id
       and o.start_time = s.start_time
       and public.day_types_overlap(o.day_type, s.day_type)
  ) as is_simultaneous
from public.hall_schedules s
join public.halls h on h.id = s.hall_id;

-- ---------------------------------------------------------------------
-- 지도용 예식장 목록 (마커·필터·완성도 색상에 필요한 최소 컬럼)
--   completeness: none(회색) / partial(노랑) / complete(초록)
-- ---------------------------------------------------------------------
create view public.venue_map
with (security_invoker = on) as
with flags as (
  select
    v.*,
    (   v.guest_free_minutes is not null
     or v.parking_capacity is not null
     or coalesce(cardinality(v.guest_free_methods), 0) > 0
     or coalesce(cardinality(v.vendor_parking_methods), 0) > 0) as has_parking_info,
    exists (
      select 1 from public.halls h
        join public.hall_schedules s on s.hall_id = h.id
       where h.venue_id = v.id)                                 as has_hall_info,
    (   v.external_snap_policy is not null
     or v.official_vendor_designated is not null
     or v.flash_policy is not null)                             as has_photo_info,
    exists (
      select 1 from public.hall_schedules_computed c
       where c.venue_id = v.id and c.is_simultaneous)           as has_simultaneous
  from public.venues v
)
select
  id, name, branch_name, sido, sigungu, road_address, lat, lng, category,
  count(*) over (partition by road_address)::int as same_address_count,
  has_parking_info, has_hall_info, has_photo_info,
  case
    when has_parking_info and has_hall_info and has_photo_info then 'complete'
    when has_parking_info or has_hall_info or has_photo_info   then 'partial'
    else 'none'
  end as completeness,
  -- 필터용
  coalesce(guest_free_minutes >= 120, false)                               as free_parking_2h,
  external_snap_policy,
  coalesce(external_snap_policy in ('all_allowed', 'no_official'), false)  as external_snap_allowed,
  has_simultaneous,
  official_vendor_designated,
  greatest(parking_checked_at, photo_checked_at,
           (select max(h.checked_at) from public.halls h where h.venue_id = flags.id)) as last_checked_at
from flags;

-- ---------------------------------------------------------------------
-- 수정 이력 + 수정자 이름
-- ---------------------------------------------------------------------
create view public.edits_with_user
with (security_invoker = on) as
select e.*, p.display_name as user_name
  from public.edits e
  left join public.profiles p on p.id = e.user_id;

-- >>>>> 20261108000004_rls.sql
-- =====================================================================
-- RLS 정책
--   - 누구나(비로그인 포함) 읽기
--   - 로그인 사용자만 수정
--   - venues: 행 추가·삭제 불가, 원본(CSV) 컬럼은 수정 불가 (컬럼 권한으로 제한)
--   - edits: 트리거만 기록, 클라이언트는 읽기만
-- =====================================================================

-- ── 기본 권한 ──
-- "Automatically expose new tables" 옵션을 꺼도 동작하도록 필요한 권한을 직접 부여.
-- (행 단위 접근은 아래 RLS 정책이 제한)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;   -- import 스크립트용
grant all on all sequences in schema public to service_role;
grant select on public.profiles, public.venues, public.nearby_parking,
                public.halls, public.hall_schedules, public.edits
  to anon, authenticated;
grant insert, update, delete on public.nearby_parking, public.halls, public.hall_schedules
  to authenticated;

alter table public.profiles       enable row level security;
alter table public.venues         enable row level security;
alter table public.nearby_parking enable row level security;
alter table public.halls          enable row level security;
alter table public.hall_schedules enable row level security;
alter table public.edits          enable row level security;

-- ── profiles ──
create policy "profiles: 누구나 읽기" on public.profiles
  for select to anon, authenticated using (true);
create policy "profiles: 본인만 수정" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ── venues ──
create policy "venues: 누구나 읽기" on public.venues
  for select to anon, authenticated using (true);
create policy "venues: 로그인 사용자 수정" on public.venues
  for update to authenticated using (true) with check (true);

revoke insert, update, delete on public.venues from anon, authenticated;
grant update (
  guest_free_minutes, overtime_fee, overtime_unit_minutes,
  guest_free_methods, vendor_parking_methods, parking_capacity, parking_notes, parking_checked_at,
  official_vendor_designated, official_vendor_name, external_snap_policy, official_photo_timing,
  flash_policy, external_vendor_fee, pass_required, equipment_route, bridal_room_info, photo_notes,
  photo_checked_at
) on public.venues to authenticated;

-- ── nearby_parking / halls / hall_schedules ──
create policy "nearby_parking: 누구나 읽기" on public.nearby_parking for select to anon, authenticated using (true);
create policy "nearby_parking: 로그인 추가" on public.nearby_parking for insert to authenticated with check (true);
create policy "nearby_parking: 로그인 수정" on public.nearby_parking for update to authenticated using (true) with check (true);
create policy "nearby_parking: 로그인 삭제" on public.nearby_parking for delete to authenticated using (true);

create policy "halls: 누구나 읽기" on public.halls for select to anon, authenticated using (true);
create policy "halls: 로그인 추가" on public.halls for insert to authenticated with check (true);
create policy "halls: 로그인 수정" on public.halls for update to authenticated using (true) with check (true);
create policy "halls: 로그인 삭제" on public.halls for delete to authenticated using (true);

create policy "hall_schedules: 누구나 읽기" on public.hall_schedules for select to anon, authenticated using (true);
create policy "hall_schedules: 로그인 추가" on public.hall_schedules for insert to authenticated with check (true);
create policy "hall_schedules: 로그인 수정" on public.hall_schedules for update to authenticated using (true) with check (true);
create policy "hall_schedules: 로그인 삭제" on public.hall_schedules for delete to authenticated using (true);

revoke insert, update, delete on public.nearby_parking, public.halls, public.hall_schedules from anon;

-- ── edits ──
create policy "edits: 누구나 읽기" on public.edits
  for select to anon, authenticated using (true);
revoke insert, update, delete on public.edits from anon, authenticated;

-- ── 뷰 / 함수 ──
grant select on public.venue_map, public.hall_schedules_computed, public.edits_with_user
  to anon, authenticated;

-- 내부용 트리거 함수는 API(RPC)로 직접 호출 못 하게
revoke execute on function
  public.handle_new_user(), public.set_row_meta(), public.venues_bump_checked_at(),
  public.child_bump_checked_at(), public.schedules_touch_hall(), public.log_edit()
from public, anon, authenticated;

-- >>>>> 20261108000005_advisor_fixes.sql
-- =====================================================================
-- Supabase 보안·성능 점검(Advisors) 지적 사항 보완
-- =====================================================================

-- 1) 함수 search_path 고정 (function_search_path_mutable)
alter function public.set_row_meta()           set search_path = public;
alter function public.venues_bump_checked_at() set search_path = public;
alter function public.child_bump_checked_at()  set search_path = public;
alter function public._edit_ignored_columns()  set search_path = public;
alter function public.day_types_overlap(text, text) set search_path = public;

-- 2) "Enable automatic RLS" 옵션이 만든 내부 함수를 API(RPC)로 호출 못 하게
--    (프로젝트 생성 시 그 옵션을 켠 경우에만 존재)
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 3) RLS 정책에서 auth.uid()를 행마다 다시 계산하지 않도록 (auth_rls_initplan)
alter policy "profiles: 본인만 수정" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- >>>>> 20261108000006_feedback_round1.sql
-- =====================================================================
-- 1단계 피드백 반영
--   1) 업체 차량 주차 처리 방법 항목 삭제
--   2) "외부 스냅 허용" 필터 삭제 (촬영 규정의 external_snap_policy 칸은 유지)
--   3) 수정자 닉네임: profiles.nickname (중복 불가), 모든 updated_by 가 profiles 를 참조
--      → 화면에서 "마지막 수정: 닉네임 · 날짜" 를 바로 조회 가능
--   4) 사용자가 예식장 직접 추가
--   5) 정보 완성도(마커 색) 삭제
-- =====================================================================

-- ---------------------------------------------------------------------
-- 지도 뷰는 아래에서 바꾸는 컬럼을 참조하므로 먼저 지우고 마지막에 다시 만든다
-- ---------------------------------------------------------------------
drop view public.venue_map;
drop view public.edits_with_user;

-- ---------------------------------------------------------------------
-- 1) 업체 차량 주차 항목 삭제
-- ---------------------------------------------------------------------
create or replace function public.venues_bump_checked_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.guest_free_minutes, new.overtime_fee, new.overtime_unit_minutes,
      new.guest_free_methods, new.parking_capacity, new.parking_notes)
     is distinct from
     (old.guest_free_minutes, old.overtime_fee, old.overtime_unit_minutes,
      old.guest_free_methods, old.parking_capacity, old.parking_notes)
  then
    new.parking_checked_at := now();
  end if;

  if (new.official_vendor_designated, new.official_vendor_name, new.external_snap_policy,
      new.official_photo_timing, new.flash_policy, new.external_vendor_fee, new.pass_required,
      new.equipment_route, new.bridal_room_info, new.photo_notes)
     is distinct from
     (old.official_vendor_designated, old.official_vendor_name, old.external_snap_policy,
      old.official_photo_timing, old.flash_policy, old.external_vendor_fee, old.pass_required,
      old.equipment_route, old.bridal_room_info, old.photo_notes)
  then
    new.photo_checked_at := now();
  end if;

  if new.parking_checked_at > now() then new.parking_checked_at := now(); end if;
  if new.photo_checked_at   > now() then new.photo_checked_at   := now(); end if;
  return new;
end;
$$;

alter table public.venues drop column vendor_parking_methods;

-- ---------------------------------------------------------------------
-- 3) 닉네임
-- ---------------------------------------------------------------------
alter table public.profiles rename column display_name to nickname;

-- 프로필 없이 가입된 사용자가 있으면 채워 넣기
insert into public.profiles (id)
select u.id from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- 이메일 앞부분이 공개되지 않도록 기본 닉네임을 "작가xxxxxx" 로
update public.profiles
   set nickname = '작가' || substr(replace(id::text, '-', ''), 1, 6)
 where nickname is null
    or nickname = (select split_part(u.email, '@', 1) from auth.users u where u.id = profiles.id);

alter table public.profiles
  alter column nickname set not null,
  add constraint profiles_nickname_length check (char_length(btrim(nickname)) between 2 and 20);
create unique index profiles_nickname_key on public.profiles (lower(nickname));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := left(btrim(coalesce(
                   new.raw_user_meta_data ->> 'nickname',   -- 카카오 로그인 등
                   new.raw_user_meta_data ->> 'name', '')), 16);
begin
  if char_length(v_nick) < 2 then
    v_nick := '작가' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  -- 이미 있는 닉네임이면 뒤에 4자리를 붙임
  if exists (select 1 from public.profiles where lower(nickname) = lower(v_nick)) then
    v_nick := v_nick || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  insert into public.profiles (id, nickname) values (new.id, v_nick)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 수정자 컬럼이 auth.users 대신 profiles 를 참조하도록
-- (API에서 halls?select=*,editor:profiles(nickname) 처럼 바로 닉네임 조회 가능)
alter table public.venues         drop constraint venues_updated_by_fkey,
  add constraint venues_updated_by_fkey         foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.nearby_parking drop constraint nearby_parking_updated_by_fkey,
  add constraint nearby_parking_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.halls          drop constraint halls_updated_by_fkey,
  add constraint halls_updated_by_fkey          foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.hall_schedules drop constraint hall_schedules_updated_by_fkey,
  add constraint hall_schedules_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.edits          drop constraint edits_user_id_fkey,
  add constraint edits_user_id_fkey             foreign key (user_id)    references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- 4) 사용자가 예식장 추가
-- ---------------------------------------------------------------------
alter table public.venues
  add column source     text not null default 'csv' check (source in ('csv', 'user')),
  add column created_by uuid references public.profiles (id) on delete set null,
  add constraint venues_in_korea check (lat between 33 and 39 and lng between 124 and 132);

-- 로그인 사용자가 추가하면 출처·고정키·작성자를 서버가 채움 (클라이언트 값 무시)
create function public.venues_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.source     := 'user';
    new.source_key := 'u:' || new.id;
    new.biz_no     := null;
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger venues_before_insert before insert on public.venues
  for each row execute function public.venues_before_insert();

-- CSV 예식장의 기본 정보(이름·주소·좌표 등)는 사용자가 못 바꿈. 사용자가 추가한 예식장은 가능.
create function public.venues_protect_csv_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and old.source = 'csv' and
     (new.name, new.branch_name, new.sido, new.sigungu, new.road_address, new.jibun_address,
      new.building_name, new.floor, new.lat, new.lng, new.category, new.phone, new.homepage)
     is distinct from
     (old.name, old.branch_name, old.sido, old.sigungu, old.road_address, old.jibun_address,
      old.building_name, old.floor, old.lat, old.lng, old.category, old.phone, old.homepage)
  then
    raise exception '공공데이터로 등록된 예식장의 기본 정보는 수정할 수 없습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger venues_protect_csv_base before update on public.venues
  for each row execute function public.venues_protect_csv_base();

-- 추가도 수정 이력에 남김
drop trigger venues_log on public.venues;
create trigger venues_log after insert or update on public.venues
  for each row execute function public.log_edit();

create policy "venues: 로그인 사용자 추가" on public.venues
  for insert to authenticated with check (true);

grant insert (
  name, branch_name, sido, sigungu, road_address, jibun_address, building_name, floor,
  lat, lng, category, phone, homepage,
  guest_free_minutes, overtime_fee, overtime_unit_minutes, guest_free_methods,
  parking_capacity, parking_notes,
  official_vendor_designated, official_vendor_name, external_snap_policy, official_photo_timing,
  flash_policy, external_vendor_fee, pass_required, equipment_route, bridal_room_info, photo_notes
) on public.venues to authenticated;

grant update (
  name, branch_name, sido, sigungu, road_address, jibun_address, building_name, floor,
  lat, lng, category, phone, homepage
) on public.venues to authenticated;

revoke execute on function public.venues_before_insert(), public.venues_protect_csv_base()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2)·5) 지도 뷰 다시 만들기 (완성도·외부스냅 필터 제거)
-- ---------------------------------------------------------------------
create view public.venue_map
with (security_invoker = on) as
select
  v.id, v.name, v.branch_name, v.sido, v.sigungu, v.road_address, v.lat, v.lng,
  v.category, v.source,
  count(*) over (partition by v.road_address)::int as same_address_count,
  -- 필터용
  coalesce(v.guest_free_minutes >= 120, false) as free_parking_2h,
  exists (
    select 1 from public.hall_schedules_computed c
     where c.venue_id = v.id and c.is_simultaneous)  as has_simultaneous,
  v.official_vendor_designated,
  greatest(v.parking_checked_at, v.photo_checked_at,
           (select max(h.checked_at) from public.halls h where h.venue_id = v.id)) as last_checked_at
from public.venues v;

create view public.edits_with_user
with (security_invoker = on) as
select e.*, p.nickname as user_nickname
  from public.edits e
  left join public.profiles p on p.id = e.user_id;

grant select on public.venue_map, public.edits_with_user to anon, authenticated;

-- >>>>> 20261109000007_members_and_sessions.sql
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
  phone      text not null unique check (length(phone) between 11 and 12 and phone like '82%' and translate(phone, '0123456789', '') = ''),
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

-- >>>>> 20261115000008_venue_notes_photos.sql
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

-- >>>>> 20261126000009_email_login_approval.sql
-- =====================================================================
-- 휴대폰 문자 로그인 → 이메일 로그인 + 관리자 승인
--
--   members.email        로그인에 쓰는 이메일 (소문자, 중복 불가)
--   members.approved_at  관리자가 승인한 시각. null = 승인 대기(가입 신청)
--                        관리자가 직접 등록한 이메일은 등록과 동시에 승인
--   members.team         소속: AD(언아더데이) / AM(에이모먼트) / AF(언아더데이 필름)
--   members.phone        이제 선택 항목 (예전 문자 로그인용, 새 가입 신청에서는 받지 않음)
--
--   흐름: 가입 신청(이메일·이름·소속·비밀번호) → 관리자 승인 → 이메일+비밀번호로 로그인
--         관리자가 직접 등록한 이메일 → 처음 들어올 때 비밀번호를 만들고 바로 로그인
--         계정(auth.users)과 회원(members)은 "승인 + 이메일 확인" 둘 다 됐을 때 자동 연결
--
--   SQL Editor 분할 문제를 피하려고 drop 명령과 정규식 기호를 쓰지 않음
-- =====================================================================

-- ── members: 이메일·승인 컬럼 ──
alter table public.members alter column phone drop not null;
alter table public.members add column email text;
alter table public.members add column approved_at timestamptz;
alter table public.members add column team text;
alter table public.members add constraint members_email_format
  check (email is null or (email = lower(btrim(email)) and length(email) <= 254 and position('@' in email) > 1 and position('.' in split_part(email, '@', 2)) > 1));
alter table public.members add constraint members_contact_present check (email is not null or phone is not null);
alter table public.members add constraint members_team_check check (team is null or team in ('AD', 'AM', 'AF'));
create unique index members_email_key on public.members (email);

-- 기존 회원(관리자 포함)은 승인된 것으로
update public.members set approved_at = coalesce(approved_at, created_at);

-- 저장 전 정리: 이메일 소문자, 번호 정규화(없으면 null)
create or replace function public.members_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.email is not null then
    new.email := lower(btrim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;
  if new.phone is not null then
    new.phone := nullif(public.normalize_phone(new.phone), '');
  end if;
  return new;
end;
$$;
create trigger members_normalize_email before insert or update of email on public.members
  for each row execute function public.members_normalize();

-- ── 승인된 이메일이 인증을 마치면 회원과 연결 ──
create function public.link_member_on_email_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and new.email_confirmed_at is not null then
    update public.members
       set user_id   = new.id,
           status    = case when status = 'invited' then 'active' else status end,
           joined_at = coalesce(joined_at, now())
     where email = lower(new.email)
       and approved_at is not null
       and (user_id is null or user_id = new.id);
  end if;
  return new;
end;
$$;
create trigger on_auth_user_email_confirmed
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.link_member_on_email_confirm();

-- 관리자가 승인했을 때 이미 인증을 마친 계정이 있으면 바로 연결
create function public.link_member_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if new.approved_at is not null and new.user_id is null and new.email is not null then
    select id into v_uid from auth.users
     where lower(email) = lower(btrim(new.email)) and email_confirmed_at is not null
     limit 1;
    if v_uid is not null and not exists (select 1 from public.members where user_id = v_uid) then
      new.user_id := v_uid;
      new.status := case when new.status = 'invited' then 'active' else new.status end;
      new.joined_at := coalesce(new.joined_at, now());
    end if;
  end if;
  return new;
end;
$$;
create trigger members_link_on_approve before insert or update of approved_at, email on public.members
  for each row execute function public.link_member_on_approve();

-- ── 로그인 화면용 RPC ──

-- 이메일 상태
--   approved     승인됨 + 계정(비밀번호) 있음 → 로그인
--   approved_new 승인됨 + 아직 계정 없음(관리자가 직접 등록) → 비밀번호 만들기
--   pending      승인 대기 / suspended 정지 / unknown 명단에 없음 → 가입 신청
create function public.email_login_status(p_email text)
returns text
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when m.status = 'suspended' then 'suspended'
      when m.approved_at is null then 'pending'
      when m.user_id is not null
        or exists (select 1 from auth.users u where lower(u.email) = m.email) then 'approved'
      else 'approved_new'
    end
    from public.members m
    where m.email = lower(btrim(p_email))
  ), 'unknown');
$$;

-- 가입 신청 (이름·이메일·소속만): requested / already_pending / already_approved / suspended / invalid / too_many
create function public.request_access(p_name text, p_email text, p_team text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_name, ''));
  v_team  text := upper(btrim(coalesce(p_team, '')));
  v_state text;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 30
     or length(v_email) > 254 or position('@' in v_email) < 2
     or position('.' in split_part(v_email, '@', 2)) < 2
     or v_team not in ('AD', 'AM', 'AF') then
    return 'invalid';
  end if;
  v_state := public.email_login_status(v_email);
  if v_state in ('approved', 'approved_new') then return 'already_approved'; end if;
  if v_state = 'pending' then return 'already_pending'; end if;
  if v_state = 'suspended' then return 'suspended'; end if;
  if (select count(*) from public.members where approved_at is null) >= 300 then
    return 'too_many';
  end if;
  insert into public.members (name, email, team) values (v_name, v_email, v_team);
  return 'requested';
end;
$$;

-- 회원 활동 판단에 승인 여부도 반영
create or replace function public.is_active_member()
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
       and m.approved_at is not null
       and s.session_id = public._jwt_session_id()
  );
$$;

-- ── Supabase Auth Hook (선택, 권장): 명단에 없는 이메일은 계정 자체를 못 만들게 ──
--   가입 신청(request_access)으로 명단에 올라간 이메일(승인 대기 포함)만 계정 생성 허용
--   대시보드 → Authentication → Hooks → "Before User Created" → Postgres → 이 함수 선택
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email <> '' and exists (
    select 1 from public.members
     where email = v_email and status <> 'suspended'
  ) then
    return jsonb_build_object();
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', '가입 신청을 먼저 해주세요.'));
end;
$$;

-- ── 권한 ──
revoke execute on function
  public.link_member_on_email_confirm(), public.link_member_on_approve(), public.hook_before_user_created(jsonb)
from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.email_login_status(text) to anon, authenticated;
grant execute on function public.request_access(text, text, text) to anon, authenticated;
-- 문자 로그인용 함수는 더 이상 쓰지 않음
revoke execute on function public.check_member(text, text) from public, anon, authenticated;

-- >>>>> 20261126000010_member_ids_admin_activity.sql
-- =====================================================================
-- 회원 아이디(AD_홍길동 등) · 로그인 필수 시작일 · 방문 수 · 관리자 통계
--
--   members.member_code   관리자가 승인할 때 붙이는 화면 표시용 아이디 (중복 불가)
--                         → profiles.nickname 에 자동 반영되어 글·수정 이력·워터마크에 표시
--                         → 회원은 바꿀 수 없음 (관리자만)
--   app_settings.require_login_from   이 시각부터 로그인한 회원만 보기 (null = 정하지 않음)
--   daily_visits          브라우저당 하루 1번 방문 기록 (관리자 화면 "오늘 방문")
--   admin_stats()         관리자 화면 위쪽 숫자 카드
--
--   0009 다음에 적용. SQL Editor 분할 문제를 피하려고 drop 명령·정규식·중괄호를 쓰지 않음
-- =====================================================================

-- ── 회원 아이디 ──
alter table public.members add column member_code text;
alter table public.members add constraint members_code_len
  check (member_code is null or (char_length(member_code) between 2 and 30 and member_code = btrim(member_code)));
create unique index members_code_key on public.members (lower(member_code));

-- 아이디가 정해지거나 계정이 연결되면 닉네임을 아이디로 맞춤
create function public.sync_member_code_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null and new.member_code is not null then
    -- 다른 사람이 같은 닉네임을 이미 쓰고 있으면 그쪽 닉네임을 비켜줌
    update public.profiles
       set nickname = nickname || '_' || substr(replace(id::text, '-', ''), 1, 4)
     where lower(nickname) = lower(new.member_code) and id <> new.user_id;
    update public.profiles set nickname = new.member_code where id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger members_sync_code after insert or update of member_code, user_id on public.members
  for each row execute function public.sync_member_code_to_profile();

-- 아이디 앞부분(AD_ / AM_ / AF_)으로 소속이 비어 있으면 채움
create function public.members_team_from_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.team is null and new.member_code is not null
     and upper(split_part(new.member_code, '_', 1)) in ('AD', 'AM', 'AF') then
    new.team := upper(split_part(new.member_code, '_', 1));
  end if;
  return new;
end;
$$;
create trigger members_team_from_code before insert or update of member_code on public.members
  for each row execute function public.members_team_from_code();

-- 닉네임은 이제 관리자가 정하는 아이디 → 회원 본인 수정 막기 (관리자만)
alter policy "profiles: 본인만 수정" on public.profiles
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- session_status 에 아이디도 내려줌
create or replace function public.session_status()
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
      'code', m.member_code,
      'nickname', coalesce(m.member_code, (select nickname from public.profiles where id = auth.uid())))
  end
  from (select 1) one
  left join public.members m on m.user_id = auth.uid()
  left join public.active_sessions s on s.user_id = auth.uid();
$$;

-- ── 로그인 필수 시작일 ──
alter table public.app_settings add column require_login_from timestamptz;
grant update (require_login_from) on public.app_settings to authenticated;

create or replace function public.can_view()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_active_member() or not coalesce((
    select require_login_to_view or (require_login_from is not null and now() >= require_login_from)
      from public.app_settings where id
  ), false);
$$;

-- ── 방문 수 (브라우저당 하루 1번) ──
create table public.daily_visits (
  day     date not null default ((now() at time zone 'Asia/Seoul')::date),
  visitor text not null check (char_length(visitor) between 8 and 64),
  primary key (day, visitor)
);
alter table public.daily_visits enable row level security;
revoke all on public.daily_visits from anon, authenticated;

create function public.record_visit(p_visitor text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.daily_visits (visitor)
  select left(p_visitor, 64)
   where char_length(coalesce(p_visitor, '')) >= 8
  on conflict do nothing;
$$;

-- ── 관리자 화면 숫자 카드 ──
create function public.admin_stats()
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_start timestamptz := (v_today::timestamp at time zone 'Asia/Seoul');
begin
  if not public.is_admin() then
    return null;
  end if;
  return jsonb_build_object(
    'members',          (select count(*) from public.members where approved_at is not null),
    'members_active',   (select count(*) from public.members where status = 'active'),
    'pending',          (select count(*) from public.members where approved_at is null),
    'joined_today',     (select count(*) from public.members where joined_at >= v_start),
    'joined_7d',        (select count(*) from public.members where joined_at >= v_start - interval '6 days'),
    'visits_today',     (select count(*) from public.daily_visits where day = v_today),
    'visits_yesterday', (select count(*) from public.daily_visits where day = v_today - 1),
    'visits_7d',        (select count(*) from public.daily_visits where day > v_today - 7),
    'logins_today',     (select count(*) from public.login_events where created_at >= v_start),
    'notes_today',      (select count(*) from public.venue_notes where created_at >= v_start),
    'notes_total',      (select count(*) from public.venue_notes),
    'photos_total',     (select coalesce(sum(cardinality(photo_paths)), 0) from public.venue_notes),
    'edits_today',      (select count(*) from public.edits where created_at >= v_start and table_name <> 'venue_notes'),
    'suspicious',       (select count(*) from public.member_login_stats where switches_24h >= 4 or switches_7d >= 12)
  );
end;
$$;

-- ── 권한 ──
revoke execute on function public.sync_member_code_to_profile(), public.members_team_from_code() from public, anon, authenticated;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.record_visit(text) to anon, authenticated;

-- >>>>> 20261126000011_hall_schedule_note.sql
-- 홀별 "예식 안내" 문구 (시작 시각표가 공개되지 않은 홀은 간격·형태 안내를 글로 보여줌)
alter table public.halls add column schedule_note text;
alter table public.halls add constraint halls_schedule_note_len check (schedule_note is null or char_length(schedule_note) <= 300);

-- >>>>> 20261126000012_venue_requests.sql
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

-- >>>>> 20261126000013_venue_delete_requests.sql
-- =====================================================================
-- 예식장 삭제 요청 (예식장이 아닌 곳·폐업한 곳)
--   venue_requests 에 종류(kind)와 대상 예식장(venue_id)을 추가
--   kind = 'add'    식장 등록 요청 (기존)
--   kind = 'delete' 삭제 요청: venue_id 필수, 같은 사람이 같은 곳을 처리 전 중복 요청 못 함
-- =====================================================================

alter table public.venue_requests add column kind text not null default 'add';
alter table public.venue_requests add constraint venue_requests_kind check (kind in ('add', 'delete'));
alter table public.venue_requests add column venue_id uuid references public.venues (id) on delete set null;
create index venue_requests_venue_idx on public.venue_requests (venue_id);
create unique index venue_requests_one_pending_delete on public.venue_requests (venue_id, requested_by)
  where kind = 'delete' and status = 'pending';

-- 삭제 요청은 대상 예식장이 있어야 함 (요청할 때만 검사: 나중에 예식장이 지워져도 기록은 남김)
create function public.venue_requests_check_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'delete' and new.venue_id is null then
    raise exception '삭제할 예식장이 지정되지 않았습니다' using errcode = '23502';
  end if;
  return new;
end;
$$;
create trigger venue_requests_check_delete before insert on public.venue_requests
  for each row execute function public.venue_requests_check_delete();
revoke execute on function public.venue_requests_check_delete() from public, anon, authenticated;

grant insert (kind, venue_id) on public.venue_requests to authenticated;

-- >>>>> 20261126000014_hall_interval.sql
-- =====================================================================
-- 홀 예식 간격(분): 시작 시각을 모를 때만 쓰는 칸
--   - 시작 시각(hall_schedules)이 있으면 화면은 시각만 보여주고 간격은 시각에서 계산
--   - 예식 형태 '채플'은 쓰지 않음 → 기존 값 비움
--   - 이전 엑셀의 원문 안내(schedule_note)에서 "N분 간격"을 간격 칸으로 옮김
-- =====================================================================

alter table public.halls add column if not exists interval_minutes integer;
alter table public.halls add constraint halls_interval_range
  check (interval_minutes is null or interval_minutes between 10 and 600);

update public.halls set hall_type = null where hall_type = 'chapel';

update public.halls h
   set interval_minutes = substring(h.schedule_note from '([0-9]+)분')::int
 where h.interval_minutes is null
   and h.schedule_note ~ '[0-9]+분'
   and substring(h.schedule_note from '([0-9]+)분')::int between 10 and 600
   and not exists (select 1 from public.hall_schedules s where s.hall_id = h.id);
grant insert (interval_minutes), update (interval_minutes) on public.halls to authenticated;

-- >>>>> 20261126000015_drop_unused_columns.sql
-- =====================================================================
-- 쓰지 않는 열 정리 (2026-11-26 사용자 요청: 추천 + 선택 전부, 지번 주소는 남김)
--   지우기 전에 backup 스키마에 사본을 남김 (API로는 안 보이는 스키마)
--   venues  : 촬영 규정 10칸·photo_checked_at, 무료 처리 방법, 주차 규모,
--             wedding_confirm, hotel_grade, room_count, biz_no
--   halls   : photo_notes, schedule_note
--   venue_requests : location, memo
--   members : phone (예전 문자 로그인용) + 관련 함수·트리거
-- =====================================================================

-- ── 사본 ──
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.venues_dropped_20261126 as
  select id, official_vendor_designated, official_vendor_name, external_snap_policy, official_photo_timing,
         flash_policy, external_vendor_fee, pass_required, equipment_route, bridal_room_info, photo_notes,
         photo_checked_at, guest_free_methods, parking_capacity, wedding_confirm, hotel_grade, room_count, biz_no
    from public.venues;
create table if not exists backup.halls_dropped_20261126 as
  select id, venue_id, name, photo_notes, schedule_note from public.halls;
create table if not exists backup.venue_requests_dropped_20261126 as
  select id, location, memo from public.venue_requests;
create table if not exists backup.members_phone_20261126 as
  select id, name, phone from public.members where phone is not null;

-- ── 이 열을 쓰는 뷰·함수 먼저 정리 ──
drop view if exists public.venue_map;
create view public.venue_map with (security_invoker = on) as
select v.id, v.name, v.branch_name, v.sido, v.sigungu, v.road_address, v.lat, v.lng, v.category, v.source,
       count(*) over (partition by v.road_address)::integer as same_address_count,
       coalesce(v.guest_free_minutes >= 120, false) as free_parking_2h,
       exists (select 1 from public.hall_schedules_computed c where c.venue_id = v.id and c.is_simultaneous) as has_simultaneous,
       greatest(v.parking_checked_at, (select max(h.checked_at) from public.halls h where h.venue_id = v.id)) as last_checked_at
  from public.venues v;
grant select on public.venue_map to anon, authenticated;

create or replace function public.venues_bump_checked_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.guest_free_minutes, new.overtime_fee, new.overtime_unit_minutes, new.parking_notes)
     is distinct from
     (old.guest_free_minutes, old.overtime_fee, old.overtime_unit_minutes, old.parking_notes)
  then
    new.parking_checked_at := now();
  end if;
  if new.parking_checked_at > now() then new.parking_checked_at := now(); end if;
  return new;
end;
$$;

create or replace function public.venues_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.source     := 'user';
    new.source_key := 'u:' || new.id;
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public._edit_ignored_columns()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['updated_at', 'updated_by', 'created_at', 'checked_at', 'parking_checked_at']::text[];
$$;

create or replace function public.venue_requests_before_write()
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
  return new;
end;
$$;

create or replace function public.members_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.email is not null then
    new.email := lower(btrim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;
  return new;
end;
$$;

-- members_normalize 트리거가 phone 열을 지켜보고 있어 name 만 보도록 다시 만듦
drop trigger if exists members_normalize on public.members;
create trigger members_normalize before insert or update of name on public.members
  for each row execute function public.members_normalize();

-- 예전 문자 로그인용
drop trigger if exists on_auth_user_phone_confirmed on auth.users;
drop function if exists public.link_member_on_phone_confirm();
drop function if exists public.check_member(text, text);

-- ── 열 삭제 ──
alter table public.venues
  drop column if exists official_vendor_designated,
  drop column if exists official_vendor_name,
  drop column if exists external_snap_policy,
  drop column if exists official_photo_timing,
  drop column if exists flash_policy,
  drop column if exists external_vendor_fee,
  drop column if exists pass_required,
  drop column if exists equipment_route,
  drop column if exists bridal_room_info,
  drop column if exists photo_notes,
  drop column if exists photo_checked_at,
  drop column if exists guest_free_methods,
  drop column if exists parking_capacity,
  drop column if exists wedding_confirm,
  drop column if exists hotel_grade,
  drop column if exists room_count,
  drop column if exists biz_no;
alter table public.halls
  drop column if exists photo_notes,
  drop column if exists schedule_note;
alter table public.venue_requests
  drop column if exists location,
  drop column if exists memo;
alter table public.members
  drop column if exists phone;

notify pgrst, 'reload schema';

-- >>>>> 20261126000016_drop_venue_phone.sql
-- 예식장 전화번호 열 삭제 (2026-11-26 사용자 요청: 전화번호 안 씀). 사본: backup.venues_phone_20261126
create table if not exists backup.venues_phone_20261126 as select id, name, phone from public.venues where phone is not null;
create or replace function public.venues_protect_csv_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and old.source = 'csv' and
     (new.name, new.branch_name, new.sido, new.sigungu, new.road_address, new.jibun_address,
      new.building_name, new.floor, new.lat, new.lng, new.category, new.homepage)
     is distinct from
     (old.name, old.branch_name, old.sido, old.sigungu, old.road_address, old.jibun_address,
      old.building_name, old.floor, old.lat, old.lng, old.category, old.homepage)
  then
    raise exception '공공데이터로 등록된 예식장의 기본 정보는 수정할 수 없습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
alter table public.venues drop column if exists phone;
notify pgrst, 'reload schema';

-- >>>>> 20261126000017_admin_delete_venue.sql
-- =====================================================================
-- 관리자: 삭제 요청의 '삭제 완료' → 예식장을 바로 지움
--   admin_delete_venue(요청 id) : 관리자만. 지우기 전 행 전체를 backup.venues_deleted_log 에 JSON 으로 남기고,
--   요청을 '완료'로 바꾼 뒤 예식장 삭제 (홀·시간표·특이사항은 함께 지워짐)
-- =====================================================================

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.venues_deleted_log (
  id          bigint generated always as identity primary key,
  venue_id    uuid not null,
  name        text,
  data        jsonb not null,
  halls       jsonb,
  request_id  uuid,
  deleted_by  uuid,
  deleted_at  timestamptz not null default now()
);

create or replace function public.admin_delete_venue(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.venue_requests%rowtype;
  v_venue public.venues%rowtype;
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있어요' using errcode = '42501';
  end if;
  select * into v_req from public.venue_requests where id = p_request_id for update;
  if not found then return 'no_request'; end if;
  if v_req.kind <> 'delete' then return 'not_delete'; end if;

  update public.venue_requests set status = 'done' where id = p_request_id;

  if v_req.venue_id is null then return 'already_gone'; end if;
  select * into v_venue from public.venues where id = v_req.venue_id;
  if not found then return 'already_gone'; end if;

  insert into backup.venues_deleted_log (venue_id, name, data, halls, request_id, deleted_by)
  values (v_venue.id, v_venue.name, to_jsonb(v_venue),
          (select jsonb_agg(to_jsonb(h) || jsonb_build_object('times',
             (select jsonb_agg(s.start_time order by s.start_time) from public.hall_schedules s where s.hall_id = h.id)))
             from public.halls h where h.venue_id = v_venue.id),
          p_request_id, auth.uid());

  -- 같은 예식장에 들어온 다른 삭제 요청도 함께 완료 처리
  update public.venue_requests set status = 'done'
   where venue_id = v_venue.id and kind = 'delete' and status = 'pending';

  -- 딸린 행을 먼저 지움 (예식장과 같이 지우면 수정 이력 기록이 이미 사라진 예식장을 가리켜 실패함)
  delete from public.hall_schedules where hall_id in (select id from public.halls where venue_id = v_venue.id);
  delete from public.halls where venue_id = v_venue.id;
  delete from public.venue_notes where venue_id = v_venue.id;
  delete from public.nearby_parking where venue_id = v_venue.id;
  delete from public.venues where id = v_venue.id;
  return 'deleted';
end;
$$;

revoke execute on function public.admin_delete_venue(uuid) from public, anon;
grant execute on function public.admin_delete_venue(uuid) to authenticated;

-- >>>>> 20261126000018_session_per_device_type.sql
-- =====================================================================
-- 동시 로그인: 회원마다 PC 1대 + 휴대폰(태블릿 포함) 1대
--   active_sessions 를 (회원, 칸) 단위로. 칸 = 'pc' | 'mobile'
--   같은 칸에서 새로 로그인하면 그 칸의 이전 기기만 로그아웃
--   칸은 서버가 브라우저 정보(User-Agent)로 판단 (요청 헤더 우선, 없으면 앱이 보낸 값)
-- =====================================================================

alter table public.active_sessions add column if not exists slot text not null default 'pc';
alter table public.active_sessions drop constraint if exists active_sessions_slot_check;
alter table public.active_sessions add constraint active_sessions_slot_check check (slot in ('pc', 'mobile'));
alter table public.active_sessions drop constraint if exists active_sessions_pkey;
alter table public.active_sessions add primary key (user_id, slot);
create index if not exists active_sessions_session_idx on public.active_sessions (session_id);

-- 기존 기록의 칸 다시 매기기 (마지막 로그인 기기 기준)
update public.active_sessions s
   set slot = case when e.user_agent ~* '(iphone|ipad|ipod|android|mobile)' then 'mobile' else 'pc' end
  from (select distinct on (session_id) session_id, user_agent from public.login_events order by session_id, created_at desc) e
 where e.session_id = s.session_id;

create or replace function public._session_slot(p_user_agent text default null)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', p_user_agent, '')
         ~* '(iphone|ipad|ipod|android|mobile)'
    then 'mobile' else 'pc' end;
$$;

create or replace function public.claim_session(p_device text default null, p_user_agent text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public._jwt_session_id();
  v_status text;
  v_slot text := public._session_slot(p_user_agent);
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

  -- 같은 세션이 다른 칸에 남아 있으면 정리 (브라우저 정보가 바뀐 경우)
  delete from public.active_sessions where user_id = auth.uid() and session_id = v_sid and slot <> v_slot;

  select session_id into v_prev from public.active_sessions where user_id = auth.uid() and slot = v_slot;
  if v_prev is distinct from v_sid then
    insert into public.login_events (user_id, session_id, method, device, user_agent, replaced_other)
    values (auth.uid(), v_sid,
            auth.jwt() -> 'amr' -> 0 ->> 'method',
            left(p_device, 60), left(p_user_agent, 400),
            v_prev is not null);
  end if;

  insert into public.active_sessions (user_id, slot, session_id, claimed_at)
  values (auth.uid(), v_slot, v_sid, now())
  on conflict (user_id, slot) do update set session_id = excluded.session_id, claimed_at = now();
  return 'ok';
end;
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.members m
      join public.active_sessions s on s.user_id = m.user_id
     where m.user_id = auth.uid()
       and m.status = 'active'
       and m.approved_at is not null
       and s.session_id = public._jwt_session_id()
  );
$$;

create or replace function public.session_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then jsonb_build_object('status', 'anonymous')
    when m.id is null then jsonb_build_object('status', 'not_member')
    when m.status = 'suspended' then jsonb_build_object('status', 'suspended')
    when not exists (select 1 from public.active_sessions s where s.user_id = auth.uid())
      then jsonb_build_object('status', 'unclaimed')
    when not exists (select 1 from public.active_sessions s where s.user_id = auth.uid() and s.session_id = public._jwt_session_id())
      then jsonb_build_object('status', 'replaced')
    else jsonb_build_object(
      'status', 'ok',
      'role', m.role,
      'name', m.name,
      'code', m.member_code,
      'nickname', coalesce(m.member_code, (select nickname from public.profiles where id = auth.uid())))
  end
  from (select 1) one
  left join public.members m on m.user_id = auth.uid();
$$;

revoke execute on function public._session_slot(text) from public, anon, authenticated;

-- >>>>> 20261126000019_outdoor_flag_admin_venue.sql
-- =====================================================================
-- 1) 예식 형태: '단독' 없앰, '야외'는 분리/동시와 따로 함께 고를 수 있게 (halls.is_outdoor)
-- 2) 관리자: 예식장 이름 수정·바로 삭제
--    - 공공데이터 예식장 기본 정보 보호 트리거에서 관리자는 예외
--    - admin_remove_venue(예식장 id) : 백업 후 삭제 (요청 없이)
-- 3) '투숙객 무료' 주차 정보 삭제 (사용자 요청)
-- =====================================================================

alter table public.halls add column if not exists is_outdoor boolean not null default false;
update public.halls set is_outdoor = true, hall_type = null where hall_type = 'outdoor';
update public.halls set hall_type = null where hall_type = 'standalone';
grant insert (is_outdoor), update (is_outdoor) on public.halls to authenticated;

create or replace function public.venues_protect_csv_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and old.source = 'csv' and not public.is_admin() and
     (new.name, new.branch_name, new.sido, new.sigungu, new.road_address, new.jibun_address,
      new.building_name, new.floor, new.lat, new.lng, new.category, new.homepage)
     is distinct from
     (old.name, old.branch_name, old.sido, old.sigungu, old.road_address, old.jibun_address,
      old.building_name, old.floor, old.lat, old.lng, old.category, old.homepage)
  then
    raise exception '공공데이터로 등록된 예식장의 기본 정보는 수정할 수 없습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.admin_remove_venue(p_venue_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue public.venues%rowtype;
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있어요' using errcode = '42501';
  end if;
  select * into v_venue from public.venues where id = p_venue_id;
  if not found then return 'already_gone'; end if;

  insert into backup.venues_deleted_log (venue_id, name, data, halls, request_id, deleted_by)
  values (v_venue.id, v_venue.name, to_jsonb(v_venue),
          (select jsonb_agg(to_jsonb(h) || jsonb_build_object('times',
             (select jsonb_agg(s.start_time order by s.start_time) from public.hall_schedules s where s.hall_id = h.id)))
             from public.halls h where h.venue_id = v_venue.id),
          null, auth.uid());

  update public.venue_requests set status = 'done'
   where venue_id = v_venue.id and kind = 'delete' and status = 'pending';

  delete from public.hall_schedules where hall_id in (select id from public.halls where venue_id = v_venue.id);
  delete from public.halls where venue_id = v_venue.id;
  delete from public.venue_notes where venue_id = v_venue.id;
  delete from public.nearby_parking where venue_id = v_venue.id;
  delete from public.venues where id = v_venue.id;
  return 'deleted';
end;
$$;
revoke execute on function public.admin_remove_venue(uuid) from public, anon;
grant execute on function public.admin_remove_venue(uuid) to authenticated;

notify pgrst, 'reload schema';

-- >>>>> 20261126000020_review_fixes.sql
-- =====================================================================
-- 외부 검토(제미나이) 지적 중 확인된 문제 수정
--  1) 기기 로그인: 밀려난 기기가 새 기기를 거꾸로 밀어내는 문제
--     → session_status 가 '이 세션이 그 칸의 등록보다 나중에 만들어졌는지'로 새 로그인/밀려남을 판단
--     → 승인 전(approved_at null) 계정은 not_member
--  2) 예식장: 일반 회원 직접 추가 금지, 기본 정보(이름·주소·좌표 등)는 출처와 관계없이 관리자만 수정
--  3) admin_delete_venue: 처리 전(pending) 요청만
--  4) 예식장을 지워도 수정 이력(edits)은 남김 (cascade → set null)
--  5) 닉네임 길이 상한 20 → 40 (아이디 30자 + 중복 접미사)
--  6) 내부용 함수의 비로그인 실행 권한 회수
-- =====================================================================

-- ── 1) 기기 로그인 ──
create or replace function public.session_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public._jwt_session_id();
  m public.members%rowtype;
  v_slot text := public._session_slot(null);
  v_slot_row public.active_sessions%rowtype;
  v_created timestamptz;
begin
  if v_uid is null then return jsonb_build_object('status', 'anonymous'); end if;
  select * into m from public.members where user_id = v_uid;
  if not found or m.approved_at is null then return jsonb_build_object('status', 'not_member'); end if;
  if m.status = 'suspended' then return jsonb_build_object('status', 'suspended'); end if;

  if not exists (select 1 from public.active_sessions s where s.user_id = v_uid and s.session_id = v_sid) then
    select * into v_slot_row from public.active_sessions where user_id = v_uid and slot = v_slot;
    if not found then return jsonb_build_object('status', 'unclaimed'); end if;
    -- 이 세션이 그 칸에 마지막으로 등록된 때보다 나중에 만들어졌으면 '새 로그인'(등록 필요), 아니면 '밀려남'
    select created_at into v_created from auth.sessions where id = v_sid;
    if v_created is not null and v_created > v_slot_row.claimed_at then
      return jsonb_build_object('status', 'unclaimed');
    end if;
    return jsonb_build_object('status', 'replaced');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'role', m.role,
    'name', m.name,
    'code', m.member_code,
    'nickname', coalesce(m.member_code, (select nickname from public.profiles where id = v_uid)));
end;
$$;

create or replace function public.claim_session(p_device text default null, p_user_agent text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public._jwt_session_id();
  v_slot text := public._session_slot(p_user_agent);
  v_prev uuid;
  v_prev_at timestamptz;
  v_created timestamptz;
  m public.members%rowtype;
  v_ua text := coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', p_user_agent);
begin
  if auth.uid() is null or v_sid is null then
    return 'anonymous';
  end if;
  select * into m from public.members where user_id = auth.uid();
  if not found or m.approved_at is null then
    return 'not_member';
  elsif m.status = 'suspended' then
    return 'suspended';
  end if;

  select session_id, claimed_at into v_prev, v_prev_at from public.active_sessions where user_id = auth.uid() and slot = v_slot;
  -- 이미 밀려난(그 칸의 마지막 등록보다 먼저 만들어진) 세션은 다시 차지할 수 없음
  if v_prev is not null and v_prev <> v_sid then
    select created_at into v_created from auth.sessions where id = v_sid;
    if v_created is not null and v_created <= v_prev_at then
      return 'replaced';
    end if;
  end if;

  delete from public.active_sessions where user_id = auth.uid() and session_id = v_sid and slot <> v_slot;

  if v_prev is distinct from v_sid then
    insert into public.login_events (user_id, session_id, method, device, user_agent, replaced_other)
    values (auth.uid(), v_sid,
            auth.jwt() -> 'amr' -> 0 ->> 'method',
            left(p_device, 60), left(v_ua, 400),
            v_prev is not null);
  end if;

  insert into public.active_sessions (user_id, slot, session_id, claimed_at)
  values (auth.uid(), v_slot, v_sid, now())
  on conflict (user_id, slot) do update set session_id = excluded.session_id, claimed_at = now();
  return 'ok';
end;
$$;

-- ── 2) 예식장 직접 추가 금지, 기본 정보는 관리자만 ──
drop policy if exists "venues: 회원 추가" on public.venues;
revoke insert on public.venues from authenticated;

create or replace function public.venues_protect_csv_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() and
     (new.name, new.branch_name, new.sido, new.sigungu, new.road_address, new.jibun_address,
      new.building_name, new.floor, new.lat, new.lng, new.category, new.homepage)
     is distinct from
     (old.name, old.branch_name, old.sido, old.sigungu, old.road_address, old.jibun_address,
      old.building_name, old.floor, old.lat, old.lng, old.category, old.homepage)
  then
    raise exception '예식장 기본 정보는 관리자만 수정할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── 3) 처리 전 삭제 요청만 ──
create or replace function public.admin_delete_venue(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.venue_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있어요' using errcode = '42501';
  end if;
  select * into v_req from public.venue_requests where id = p_request_id for update;
  if not found then return 'no_request'; end if;
  if v_req.kind <> 'delete' then return 'not_delete'; end if;
  if v_req.status <> 'pending' then return 'not_pending'; end if;

  update public.venue_requests set status = 'done' where id = p_request_id;
  if v_req.venue_id is null then return 'already_gone'; end if;
  return public.admin_remove_venue(v_req.venue_id);
end;
$$;

-- ── 4) 수정 이력 보존 ──
alter table public.edits drop constraint if exists edits_venue_id_fkey;
alter table public.edits add constraint edits_venue_id_fkey
  foreign key (venue_id) references public.venues (id) on delete set null;

-- ── 5) 닉네임 길이 ──
alter table public.profiles drop constraint if exists profiles_nickname_length;
alter table public.profiles add constraint profiles_nickname_length
  check (char_length(btrim(nickname)) between 2 and 40);

-- ── 6) 내부 함수 권한 ──
revoke execute on function public._jwt_session_id() from anon;
revoke execute on function public.is_valid_venue_photo_path(text) from anon;

notify pgrst, 'reload schema';

-- >>>>> 20261127000021_note_admin_edit.sql
-- 특이사항 수정: 글쓴이 본인 + 관리자
drop policy if exists "venue_notes: 본인 수정" on public.venue_notes;
create policy "venue_notes: 본인·관리자 수정" on public.venue_notes
  for update to authenticated
  using (((author_id = (select auth.uid())) and (select public.is_active_member())) or (select public.is_admin()))
  with check ((author_id = (select auth.uid())) or (select public.is_admin()));

notify pgrst, 'reload schema';

-- >>>>> 20261127000022_feedback.sql
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

-- >>>>> 20261127000023_request_results.sql
-- 회원이 자기 요청·건의의 처리 결과를 볼 수 있게
--  - 관리자 답변(반려 사유 등) reply
--  - 건의사항 처리 시각 handled_at, 본인 열람
alter table public.venue_requests add column if not exists reply text check (reply is null or char_length(reply) <= 300);
grant update (reply) on public.venue_requests to authenticated; -- 수정은 관리자 정책으로만 가능

alter table public.feedback add column if not exists reply text check (reply is null or char_length(reply) <= 300);
alter table public.feedback add column if not exists handled_at timestamptz;
grant update (reply) on public.feedback to authenticated;

create or replace function public.feedback_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reply := null;
    new.handled_at := null;
    new.created_at := now();
  elsif new.status is distinct from old.status then
    new.handled_at := case when new.status = 'pending' then null else now() end;
  end if;
  new.reply := nullif(btrim(new.reply), '');
  return new;
end;
$$;
drop trigger if exists feedback_before_write on public.feedback;
create trigger feedback_before_write before insert or update on public.feedback
  for each row execute function public.feedback_before_write();

drop policy if exists "feedback: 관리자 읽기" on public.feedback;
drop policy if exists "feedback: 본인·관리자 읽기" on public.feedback;
create policy "feedback: 본인·관리자 읽기" on public.feedback
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

notify pgrst, 'reload schema';

