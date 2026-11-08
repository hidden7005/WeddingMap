-- 웨딩맵 1단계 전체 스키마 (supabase/migrations/ 파일을 순서대로 합친 것)
-- Supabase SQL Editor에 전체 붙여넣고 Run. 새 프로젝트에서 한 번만 실행하세요.

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
