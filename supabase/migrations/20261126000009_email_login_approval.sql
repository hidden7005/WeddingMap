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
