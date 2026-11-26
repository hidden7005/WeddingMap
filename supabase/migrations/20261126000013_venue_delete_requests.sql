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
