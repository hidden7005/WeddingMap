-- =====================================================================
-- 외부 검토(제미나이) 지적 중 확인된 문제 수정
--  1) 기기 로그인: 밀려난 기기가 새 기기를 거꾸로 밀어내는 문제
--     → session_status 가 '이 세션이 그 칸의 등록보다 나중에 만들어졌는지'로 새 로그인/밀려남을 판단
--     → 승인 전(approved_at null) 계정은 not_member
--  2) 예식장: 일반 회원 직접 추가 금지, 기본 정보(이름·주소·좌표 등)는 출처와 관계없이 관리자만 수정
--  3) admin_delete_venue: 처리 전(pending) 요청만
--  4) 예식장을 지워도 수정 이력(edits)은 남김 (cascade → set null)
--  5) 닉네임 길이 상한 20 → 40 (아이디 30자 + 중복 접미사)
--  6) 내부용 함수의 비로그인 실행 권한 회수
-- =====================================================================

-- ── 1) 기기 로그인 ──
create or replace function public.session_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public._jwt_session_id();
  m public.members%rowtype;
  v_slot text := public._session_slot(null);
  v_slot_row public.active_sessions%rowtype;
  v_created timestamptz;
begin
  if v_uid is null then return jsonb_build_object('status', 'anonymous'); end if;
  select * into m from public.members where user_id = v_uid;
  if not found or m.approved_at is null then return jsonb_build_object('status', 'not_member'); end if;
  if m.status = 'suspended' then return jsonb_build_object('status', 'suspended'); end if;

  if not exists (select 1 from public.active_sessions s where s.user_id = v_uid and s.session_id = v_sid) then
    select * into v_slot_row from public.active_sessions where user_id = v_uid and slot = v_slot;
    if not found then return jsonb_build_object('status', 'unclaimed'); end if;
    -- 이 세션이 그 칸에 마지막으로 등록된 때보다 나중에 만들어졌으면 '새 로그인'(등록 필요), 아니면 '밀려남'
    select created_at into v_created from auth.sessions where id = v_sid;
    if v_created is not null and v_created > v_slot_row.claimed_at then
      return jsonb_build_object('status', 'unclaimed');
    end if;
    return jsonb_build_object('status', 'replaced');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'role', m.role,
    'name', m.name,
    'code', m.member_code,
    'nickname', coalesce(m.member_code, (select nickname from public.profiles where id = v_uid)));
end;
$$;

create or replace function public.claim_session(p_device text default null, p_user_agent text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public._jwt_session_id();
  v_slot text := public._session_slot(p_user_agent);
  v_prev uuid;
  v_prev_at timestamptz;
  v_created timestamptz;
  m public.members%rowtype;
  v_ua text := coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', p_user_agent);
begin
  if auth.uid() is null or v_sid is null then
    return 'anonymous';
  end if;
  select * into m from public.members where user_id = auth.uid();
  if not found or m.approved_at is null then
    return 'not_member';
  elsif m.status = 'suspended' then
    return 'suspended';
  end if;

  select session_id, claimed_at into v_prev, v_prev_at from public.active_sessions where user_id = auth.uid() and slot = v_slot;
  -- 이미 밀려난(그 칸의 마지막 등록보다 먼저 만들어진) 세션은 다시 차지할 수 없음
  if v_prev is not null and v_prev <> v_sid then
    select created_at into v_created from auth.sessions where id = v_sid;
    if v_created is not null and v_created <= v_prev_at then
      return 'replaced';
    end if;
  end if;

  delete from public.active_sessions where user_id = auth.uid() and session_id = v_sid and slot <> v_slot;

  if v_prev is distinct from v_sid then
    insert into public.login_events (user_id, session_id, method, device, user_agent, replaced_other)
    values (auth.uid(), v_sid,
            auth.jwt() -> 'amr' -> 0 ->> 'method',
            left(p_device, 60), left(v_ua, 400),
            v_prev is not null);
  end if;

  insert into public.active_sessions (user_id, slot, session_id, claimed_at)
  values (auth.uid(), v_slot, v_sid, now())
  on conflict (user_id, slot) do update set session_id = excluded.session_id, claimed_at = now();
  return 'ok';
end;
$$;

-- ── 2) 예식장 직접 추가 금지, 기본 정보는 관리자만 ──
drop policy if exists "venues: 회원 추가" on public.venues;
revoke insert on public.venues from authenticated;

create or replace function public.venues_protect_csv_base()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() and
     (new.name, new.branch_name, new.sido, new.sigungu, new.road_address, new.jibun_address,
      new.building_name, new.floor, new.lat, new.lng, new.category, new.homepage)
     is distinct from
     (old.name, old.branch_name, old.sido, old.sigungu, old.road_address, old.jibun_address,
      old.building_name, old.floor, old.lat, old.lng, old.category, old.homepage)
  then
    raise exception '예식장 기본 정보는 관리자만 수정할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── 3) 처리 전 삭제 요청만 ──
create or replace function public.admin_delete_venue(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.venue_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception '관리자만 할 수 있어요' using errcode = '42501';
  end if;
  select * into v_req from public.venue_requests where id = p_request_id for update;
  if not found then return 'no_request'; end if;
  if v_req.kind <> 'delete' then return 'not_delete'; end if;
  if v_req.status <> 'pending' then return 'not_pending'; end if;

  update public.venue_requests set status = 'done' where id = p_request_id;
  if v_req.venue_id is null then return 'already_gone'; end if;
  return public.admin_remove_venue(v_req.venue_id);
end;
$$;

-- ── 4) 수정 이력 보존 ──
alter table public.edits drop constraint if exists edits_venue_id_fkey;
alter table public.edits add constraint edits_venue_id_fkey
  foreign key (venue_id) references public.venues (id) on delete set null;

-- ── 5) 닉네임 길이 ──
alter table public.profiles drop constraint if exists profiles_nickname_length;
alter table public.profiles add constraint profiles_nickname_length
  check (char_length(btrim(nickname)) between 2 and 40);

-- ── 6) 내부 함수 권한 ──
revoke execute on function public._jwt_session_id() from anon;
revoke execute on function public.is_valid_venue_photo_path(text) from anon;

notify pgrst, 'reload schema';
