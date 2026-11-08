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
