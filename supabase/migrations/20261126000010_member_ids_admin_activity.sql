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
