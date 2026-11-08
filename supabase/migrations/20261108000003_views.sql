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
