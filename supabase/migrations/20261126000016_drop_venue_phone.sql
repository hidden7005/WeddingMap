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
