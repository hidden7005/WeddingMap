-- =====================================================================
-- 메타 자동 갱신 + 수정 이력(edits) 자동 기록
--   * updated_at / updated_by 는 트리거가 채운다 (클라이언트 값 무시)
--   * 섹션 필드가 바뀌면 해당 섹션의 "최종 확인일"을 now()로 갱신
--   * 로그인 사용자(auth.uid() 있음)의 변경만 edits에 남긴다
--     → service_role로 돌리는 CSV import는 이력에 남지 않음
-- =====================================================================

-- 이력에서 제외할 메타 컬럼
create function public._edit_ignored_columns()
returns text[]
language sql immutable
as $$
  select array['updated_at', 'updated_by', 'created_at',
               'checked_at', 'parking_checked_at', 'photo_checked_at']::text[];
$$;

-- ---------------------------------------------------------------------
-- BEFORE INSERT/UPDATE : 메타 갱신
-- ---------------------------------------------------------------------
create function public.set_row_meta()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$$;

create trigger venues_meta         before insert or update on public.venues         for each row execute function public.set_row_meta();
create trigger nearby_parking_meta before insert or update on public.nearby_parking for each row execute function public.set_row_meta();
create trigger halls_meta          before insert or update on public.halls          for each row execute function public.set_row_meta();
create trigger hall_schedules_meta before insert or update on public.hall_schedules for each row execute function public.set_row_meta();

-- ---------------------------------------------------------------------
-- 최종 확인일 갱신
--   - 섹션 필드가 바뀌면 now()
--   - 내용 변경 없이 "확인만" 할 때는 클라이언트가 *_checked_at 을 직접 보냄
--   - 미래 날짜는 now()로 잘라냄
-- ---------------------------------------------------------------------
create function public.venues_bump_checked_at()
returns trigger
language plpgsql
as $$
begin
  if (new.guest_free_minutes, new.overtime_fee, new.overtime_unit_minutes,
      new.guest_free_methods, new.vendor_parking_methods, new.parking_capacity, new.parking_notes)
     is distinct from
     (old.guest_free_minutes, old.overtime_fee, old.overtime_unit_minutes,
      old.guest_free_methods, old.vendor_parking_methods, old.parking_capacity, old.parking_notes)
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

  -- 주의: least()는 NULL을 무시하므로 NULL이면 그대로 둔다
  if new.parking_checked_at > now() then new.parking_checked_at := now(); end if;
  if new.photo_checked_at   > now() then new.photo_checked_at   := now(); end if;
  return new;
end;
$$;

create trigger venues_checked_at before update on public.venues
  for each row execute function public.venues_bump_checked_at();

create function public.child_bump_checked_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.checked_at is not distinct from old.checked_at then
    new.checked_at := now();
  end if;
  new.checked_at := least(coalesce(new.checked_at, now()), now());
  return new;
end;
$$;

create trigger nearby_parking_checked_at before insert or update on public.nearby_parking
  for each row execute function public.child_bump_checked_at();
create trigger halls_checked_at before insert or update on public.halls
  for each row execute function public.child_bump_checked_at();

-- 시간표가 바뀌면 소속 홀의 최종 확인일 갱신
create function public.schedules_touch_hall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.halls
     set checked_at = now()
   where id = coalesce(new.hall_id, old.hall_id);
  return null;
end;
$$;

create trigger hall_schedules_touch_hall after insert or update or delete on public.hall_schedules
  for each row execute function public.schedules_touch_hall();

-- ---------------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE : 수정 이력 기록
-- ---------------------------------------------------------------------
create function public.log_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_old      jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new      jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row      jsonb := coalesce(v_new, v_old);
  v_venue_id uuid;
  v_key      text;
begin
  if v_uid is null then
    return null;  -- import·관리자 작업은 기록하지 않음
  end if;

  v_venue_id := case tg_table_name
    when 'venues'         then (v_row ->> 'id')::uuid
    when 'hall_schedules' then (select h.venue_id from public.halls h where h.id = (v_row ->> 'hall_id')::uuid)
    else (v_row ->> 'venue_id')::uuid
  end;

  -- 홀 삭제로 cascade 삭제된 시간표: 홀 삭제 이력에 포함되므로 생략
  if tg_table_name = 'hall_schedules' and v_venue_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> all (public._edit_ignored_columns())
         and (v_old -> v_key) is distinct from (v_new -> v_key) then
        insert into public.edits (venue_id, table_name, record_id, action, field, old_value, new_value, user_id)
        values (v_venue_id, tg_table_name, (v_row ->> 'id')::uuid, 'update', v_key,
                v_old -> v_key, v_new -> v_key, v_uid);
      end if;
    end loop;
  else
    insert into public.edits (venue_id, table_name, record_id, action, field, old_value, new_value, user_id)
    values (v_venue_id, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), null, v_old, v_new, v_uid);
  end if;

  return null;
end;
$$;

create trigger venues_log         after update                     on public.venues         for each row execute function public.log_edit();
create trigger nearby_parking_log after insert or update or delete on public.nearby_parking for each row execute function public.log_edit();
create trigger halls_log          after insert or update or delete on public.halls          for each row execute function public.log_edit();
create trigger hall_schedules_log after insert or update or delete on public.hall_schedules for each row execute function public.log_edit();
