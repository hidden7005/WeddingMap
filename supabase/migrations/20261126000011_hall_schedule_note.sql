-- 홀별 "예식 안내" 문구 (시작 시각표가 공개되지 않은 홀은 간격·형태 안내를 글로 보여줌)
alter table public.halls add column schedule_note text;
alter table public.halls add constraint halls_schedule_note_len check (schedule_note is null or char_length(schedule_note) <= 300);
