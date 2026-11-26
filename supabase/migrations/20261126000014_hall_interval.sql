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
