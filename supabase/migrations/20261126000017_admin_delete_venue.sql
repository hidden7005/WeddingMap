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
