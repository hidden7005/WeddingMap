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
