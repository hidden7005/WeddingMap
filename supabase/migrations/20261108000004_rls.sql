-- =====================================================================
-- RLS 정책
--   - 누구나(비로그인 포함) 읽기
--   - 로그인 사용자만 수정
--   - venues: 행 추가·삭제 불가, 원본(CSV) 컬럼은 수정 불가 (컬럼 권한으로 제한)
--   - edits: 트리거만 기록, 클라이언트는 읽기만
-- =====================================================================

-- ── 기본 권한 ──
-- "Automatically expose new tables" 옵션을 꺼도 동작하도록 필요한 권한을 직접 부여.
-- (행 단위 접근은 아래 RLS 정책이 제한)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;   -- import 스크립트용
grant all on all sequences in schema public to service_role;
grant select on public.profiles, public.venues, public.nearby_parking,
                public.halls, public.hall_schedules, public.edits
  to anon, authenticated;
grant insert, update, delete on public.nearby_parking, public.halls, public.hall_schedules
  to authenticated;

alter table public.profiles       enable row level security;
alter table public.venues         enable row level security;
alter table public.nearby_parking enable row level security;
alter table public.halls          enable row level security;
alter table public.hall_schedules enable row level security;
alter table public.edits          enable row level security;

-- ── profiles ──
create policy "profiles: 누구나 읽기" on public.profiles
  for select to anon, authenticated using (true);
create policy "profiles: 본인만 수정" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ── venues ──
create policy "venues: 누구나 읽기" on public.venues
  for select to anon, authenticated using (true);
create policy "venues: 로그인 사용자 수정" on public.venues
  for update to authenticated using (true) with check (true);

revoke insert, update, delete on public.venues from anon, authenticated;
grant update (
  guest_free_minutes, overtime_fee, overtime_unit_minutes,
  guest_free_methods, vendor_parking_methods, parking_capacity, parking_notes, parking_checked_at,
  official_vendor_designated, official_vendor_name, external_snap_policy, official_photo_timing,
  flash_policy, external_vendor_fee, pass_required, equipment_route, bridal_room_info, photo_notes,
  photo_checked_at
) on public.venues to authenticated;

-- ── nearby_parking / halls / hall_schedules ──
create policy "nearby_parking: 누구나 읽기" on public.nearby_parking for select to anon, authenticated using (true);
create policy "nearby_parking: 로그인 추가" on public.nearby_parking for insert to authenticated with check (true);
create policy "nearby_parking: 로그인 수정" on public.nearby_parking for update to authenticated using (true) with check (true);
create policy "nearby_parking: 로그인 삭제" on public.nearby_parking for delete to authenticated using (true);

create policy "halls: 누구나 읽기" on public.halls for select to anon, authenticated using (true);
create policy "halls: 로그인 추가" on public.halls for insert to authenticated with check (true);
create policy "halls: 로그인 수정" on public.halls for update to authenticated using (true) with check (true);
create policy "halls: 로그인 삭제" on public.halls for delete to authenticated using (true);

create policy "hall_schedules: 누구나 읽기" on public.hall_schedules for select to anon, authenticated using (true);
create policy "hall_schedules: 로그인 추가" on public.hall_schedules for insert to authenticated with check (true);
create policy "hall_schedules: 로그인 수정" on public.hall_schedules for update to authenticated using (true) with check (true);
create policy "hall_schedules: 로그인 삭제" on public.hall_schedules for delete to authenticated using (true);

revoke insert, update, delete on public.nearby_parking, public.halls, public.hall_schedules from anon;

-- ── edits ──
create policy "edits: 누구나 읽기" on public.edits
  for select to anon, authenticated using (true);
revoke insert, update, delete on public.edits from anon, authenticated;

-- ── 뷰 / 함수 ──
grant select on public.venue_map, public.hall_schedules_computed, public.edits_with_user
  to anon, authenticated;

-- 내부용 트리거 함수는 API(RPC)로 직접 호출 못 하게
revoke execute on function
  public.handle_new_user(), public.set_row_meta(), public.venues_bump_checked_at(),
  public.child_bump_checked_at(), public.schedules_touch_hall(), public.log_edit()
from public, anon, authenticated;
