-- [3] 웨딩맵: 이메일 로그인·관리자 승인(0009) + 회원 아이디·로그인 필수 시작일·방문 수·관리자 통계(0010)
-- PC 브라우저의 SQL Editor → + New → 전체 붙여넣기 → Run (한 번만)
begin;
-- =====================================================================
-- 휴대폰 문자 로그인 → 이메일 로그인 + 관리자 승인
--
--   members.email        로그인에 쓰는 이메일 (소문자, 중복 불가)
--   members.approved_at  관리자가 승인한 시각. null = 승인 대기(가입 신청)
--                        관리자가 직접 등록한 이메일은 등록과 동시에 승인
--   members.phone        이제 선택 항목 (연락처 메모용)
--
--   흐름: 승인된 이메일 → 이메일 인증 코드로 로그인 → 회원과 자동 연결(active)
--         승인 안 된 이메일 → 가입 신청(request_access) → 관리자 승인 후 로그인
--
--   SQL Editor 분할 문제를 피하려고 drop 명령과 정규식 기호를 쓰지 않음
-- =====================================================================

-- ── members: 이메일·승인 컬럼 ──
alter table public.members alter column phone drop not null;
alter table public.members add column email text;
alter table public.members add column approved_at timestamptz;
alter table public.members add column request_note text;
alter table public.members add constraint members_email_format
  check (email is null or (email = lower(btrim(email)) and length(email) <= 254 and position('@' in email) > 1 and position('.' in split_part(email, '@', 2)) > 1));
alter table public.members add constraint members_contact_present check (email is not null or phone is not null);
alter table public.members add constraint members_request_note_len check (request_note is null or char_length(request_note) <= 300);
create unique index members_email_key on public.members (email);

-- 기존 회원(관리자 포함)은 승인된 것으로
update public.members set approved_at = coalesce(approved_at, created_at);

-- 저장 전 정리: 이메일 소문자, 번호 정규화(없으면 null)
create or replace function public.members_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.email is not null then
    new.email := lower(btrim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;
  if new.phone is not null then
    new.phone := nullif(public.normalize_phone(new.phone), '');
  end if;
  return new;
end;
$$;
create trigger members_normalize_email before insert or update of email on public.members
  for each row execute function public.members_normalize();

-- ── 승인된 이메일이 인증을 마치면 회원과 연결 ──
create function public.link_member_on_email_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and new.email_confirmed_at is not null then
    update public.members
       set user_id   = new.id,
           status    = case when status = 'invited' then 'active' else status end,
           joined_at = coalesce(joined_at, now())
     where email = lower(new.email)
       and approved_at is not null
       and (user_id is null or user_id = new.id);
  end if;
  return new;
end;
$$;
create trigger on_auth_user_email_confirmed
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.link_member_on_email_confirm();

-- 관리자가 승인했을 때 이미 인증을 마친 계정이 있으면 바로 연결
create function public.link_member_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if new.approved_at is not null and new.user_id is null and new.email is not null then
    select id into v_uid from auth.users
     where lower(email) = lower(btrim(new.email)) and email_confirmed_at is not null
     limit 1;
    if v_uid is not null and not exists (select 1 from public.members where user_id = v_uid) then
      new.user_id := v_uid;
      new.status := case when new.status = 'invited' then 'active' else new.status end;
      new.joined_at := coalesce(new.joined_at, now());
    end if;
  end if;
  return new;
end;
$$;
create trigger members_link_on_approve before insert or update of approved_at, email on public.members
  for each row execute function public.link_member_on_approve();

-- ── 로그인 화면용 RPC ──

-- 이메일 상태: approved(로그인 가능) / pending(승인 대기) / suspended / unknown
create function public.email_login_status(p_email text)
returns text
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when status = 'suspended' then 'suspended'
      when approved_at is null then 'pending'
      else 'approved'
    end
    from public.members
    where email = lower(btrim(p_email))
  ), 'unknown');
$$;

-- 가입 신청: requested / already_pending / already_approved / suspended / invalid / too_many
create function public.request_access(p_name text, p_email text, p_phone text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(public.normalize_phone(p_phone), '');
  v_state text;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 30
     or length(v_email) > 254 or position('@' in v_email) < 2
     or position('.' in split_part(v_email, '@', 2)) < 2 then
    return 'invalid';
  end if;
  v_state := public.email_login_status(v_email);
  if v_state = 'approved' then return 'already_approved'; end if;
  if v_state = 'pending' then return 'already_pending'; end if;
  if v_state = 'suspended' then return 'suspended'; end if;
  if (select count(*) from public.members where approved_at is null) >= 300 then
    return 'too_many';
  end if;
  -- 연락처는 선택: 휴대폰 번호 형식이 아니면 버림
  if v_phone is not null and not (length(v_phone) between 11 and 12 and v_phone like '821%') then
    v_phone := null;
  end if;
  insert into public.members (name, email, phone, request_note)
  values (v_name, v_email, v_phone, left(nullif(btrim(coalesce(p_note, '')), ''), 300));
  return 'requested';
end;
$$;

-- 회원 활동 판단에 승인 여부도 반영
create or replace function public.is_active_member()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.members m
      join public.active_sessions s on s.user_id = m.user_id
     where m.user_id = auth.uid()
       and m.status = 'active'
       and m.approved_at is not null
       and s.session_id = public._jwt_session_id()
  );
$$;

-- ── Supabase Auth Hook (선택, 권장): 승인 안 된 이메일은 계정 자체를 못 만들게 ──
--   대시보드 → Authentication → Hooks → "Before User Created" → Postgres → 이 함수 선택
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email <> '' and exists (
    select 1 from public.members
     where email = v_email and approved_at is not null and status <> 'suspended'
  ) then
    return jsonb_build_object();
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', '승인된 이메일만 로그인할 수 있어요. 가입 신청 후 관리자 승인을 기다려주세요.'));
end;
$$;

-- ── 권한 ──
revoke execute on function
  public.link_member_on_email_confirm(), public.link_member_on_approve(), public.hook_before_user_created(jsonb)
from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.email_login_status(text) to anon, authenticated;
grant execute on function public.request_access(text, text, text, text) to anon, authenticated;
-- 문자 로그인용 함수는 더 이상 쓰지 않음
revoke execute on function public.check_member(text, text) from public, anon, authenticated;

-- =====================================================================
-- 회원 아이디(AD_홍길동 등) · 로그인 필수 시작일 · 방문 수 · 관리자 통계
--
--   members.member_code   관리자가 승인할 때 붙이는 화면 표시용 아이디 (중복 불가)
--                         → profiles.nickname 에 자동 반영되어 글·수정 이력·워터마크에 표시
--                         → 회원은 바꿀 수 없음 (관리자만)
--   app_settings.require_login_from   이 시각부터 로그인한 회원만 보기 (null = 정하지 않음)
--   daily_visits          브라우저당 하루 1번 방문 기록 (관리자 화면 "오늘 방문")
--   admin_stats()         관리자 화면 위쪽 숫자 카드
--
--   0009 다음에 적용. SQL Editor 분할 문제를 피하려고 drop 명령·정규식·중괄호를 쓰지 않음
-- =====================================================================

-- ── 회원 아이디 ──
alter table public.members add column member_code text;
alter table public.members add constraint members_code_len
  check (member_code is null or (char_length(member_code) between 2 and 30 and member_code = btrim(member_code)));
create unique index members_code_key on public.members (lower(member_code));

-- 아이디가 정해지거나 계정이 연결되면 닉네임을 아이디로 맞춤
create function public.sync_member_code_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null and new.member_code is not null then
    -- 다른 사람이 같은 닉네임을 이미 쓰고 있으면 그쪽 닉네임을 비켜줌
    update public.profiles
       set nickname = nickname || '_' || substr(replace(id::text, '-', ''), 1, 4)
     where lower(nickname) = lower(new.member_code) and id <> new.user_id;
    update public.profiles set nickname = new.member_code where id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger members_sync_code after insert or update of member_code, user_id on public.members
  for each row execute function public.sync_member_code_to_profile();

-- 닉네임은 이제 관리자가 정하는 아이디 → 회원 본인 수정 막기 (관리자만)
alter policy "profiles: 본인만 수정" on public.profiles
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- session_status 에 아이디도 내려줌
create or replace function public.session_status()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then jsonb_build_object('status', 'anonymous')
    when m.id is null then jsonb_build_object('status', 'not_member')
    when m.status = 'suspended' then jsonb_build_object('status', 'suspended')
    when s.session_id is null then jsonb_build_object('status', 'unclaimed')
    when s.session_id <> public._jwt_session_id() then jsonb_build_object('status', 'replaced')
    else jsonb_build_object(
      'status', 'ok',
      'role', m.role,
      'name', m.name,
      'code', m.member_code,
      'nickname', coalesce(m.member_code, (select nickname from public.profiles where id = auth.uid())))
  end
  from (select 1) one
  left join public.members m on m.user_id = auth.uid()
  left join public.active_sessions s on s.user_id = auth.uid();
$$;

-- ── 로그인 필수 시작일 ──
alter table public.app_settings add column require_login_from timestamptz;
grant update (require_login_from) on public.app_settings to authenticated;

create or replace function public.can_view()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_active_member() or not coalesce((
    select require_login_to_view or (require_login_from is not null and now() >= require_login_from)
      from public.app_settings where id
  ), false);
$$;

-- ── 방문 수 (브라우저당 하루 1번) ──
create table public.daily_visits (
  day     date not null default ((now() at time zone 'Asia/Seoul')::date),
  visitor text not null check (char_length(visitor) between 8 and 64),
  primary key (day, visitor)
);
alter table public.daily_visits enable row level security;
revoke all on public.daily_visits from anon, authenticated;

create function public.record_visit(p_visitor text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.daily_visits (visitor)
  select left(p_visitor, 64)
   where char_length(coalesce(p_visitor, '')) >= 8
  on conflict do nothing;
$$;

-- ── 관리자 화면 숫자 카드 ──
create function public.admin_stats()
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_start timestamptz := (v_today::timestamp at time zone 'Asia/Seoul');
begin
  if not public.is_admin() then
    return null;
  end if;
  return jsonb_build_object(
    'members',          (select count(*) from public.members where approved_at is not null),
    'members_active',   (select count(*) from public.members where status = 'active'),
    'pending',          (select count(*) from public.members where approved_at is null),
    'joined_today',     (select count(*) from public.members where joined_at >= v_start),
    'joined_7d',        (select count(*) from public.members where joined_at >= v_start - interval '6 days'),
    'visits_today',     (select count(*) from public.daily_visits where day = v_today),
    'visits_yesterday', (select count(*) from public.daily_visits where day = v_today - 1),
    'visits_7d',        (select count(*) from public.daily_visits where day > v_today - 7),
    'logins_today',     (select count(*) from public.login_events where created_at >= v_start),
    'notes_today',      (select count(*) from public.venue_notes where created_at >= v_start),
    'notes_total',      (select count(*) from public.venue_notes),
    'photos_total',     (select coalesce(sum(cardinality(photo_paths)), 0) from public.venue_notes),
    'edits_today',      (select count(*) from public.edits where created_at >= v_start and table_name <> 'venue_notes'),
    'suspicious',       (select count(*) from public.member_login_stats where switches_24h >= 4 or switches_7d >= 12)
  );
end;
$$;

-- ── 권한 ──
revoke execute on function public.sync_member_code_to_profile() from public, anon, authenticated;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.record_visit(text) to anon, authenticated;

-- 기존 관리자(최찬호)에게 아이디 부여 (관리자 화면에서 바꿀 수 있음)
update public.members set member_code = 'AD_' || name where role = 'admin' and member_code is null;

commit;
