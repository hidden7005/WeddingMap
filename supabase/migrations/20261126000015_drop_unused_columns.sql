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
