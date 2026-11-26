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
