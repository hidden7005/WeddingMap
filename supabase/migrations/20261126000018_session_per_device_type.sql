-- =====================================================================
-- 동시 로그인: 회원마다 PC 1대 + 휴대폰(태블릿 포함) 1대
--   active_sessions 를 (회원, 칸) 단위로. 칸 = 'pc' | 'mobile'
--   같은 칸에서 새로 로그인하면 그 칸의 이전 기기만 로그아웃
--   칸은 서버가 브라우저 정보(User-Agent)로 판단 (요청 헤더 우선, 없으면 앱이 보낸 값)
-- =====================================================================

alter table public.active_sessions add column if not exists slot text not null default 'pc';
alter table public.active_sessions drop constraint if exists active_sessions_slot_check;
alter table public.active_sessions add constraint active_sessions_slot_check check (slot in ('pc', 'mobile'));
alter table public.active_sessions drop constraint if exists active_sessions_pkey;
alter table public.active_sessions add primary key (user_id, slot);
create index if not exists active_sessions_session_idx on public.active_sessions (session_id);

-- 기존 기록의 칸 다시 매기기 (마지막 로그인 기기 기준)
update public.active_sessions s
   set slot = case when e.user_agent ~* '(iphone|ipad|ipod|android|mobile)' then 'mobile' else 'pc' end
  from (select distinct on (session_id) session_id, user_agent from public.login_events order by session_id, created_at desc) e
 where e.session_id = s.session_id;

create or replace function public._session_slot(p_user_agent text default null)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', p_user_agent, '')
         ~* '(iphone|ipad|ipod|android|mobile)'
    then 'mobile' else 'pc' end;
$$;

create or replace function public.claim_session(p_device text default null, p_user_agent text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public._jwt_session_id();
  v_status text;
  v_slot text := public._session_slot(p_user_agent);
  v_prev uuid;
begin
  if auth.uid() is null or v_sid is null then
    return 'anonymous';
  end if;
  select status into v_status from public.members where user_id = auth.uid();
  if v_status is null then
    return 'not_member';
  elsif v_status = 'suspended' then
    return 'suspended';
  end if;

  -- 같은 세션이 다른 칸에 남아 있으면 정리 (브라우저 정보가 바뀐 경우)
  delete from public.active_sessions where user_id = auth.uid() and session_id = v_sid and slot <> v_slot;

  select session_id into v_prev from public.active_sessions where user_id = auth.uid() and slot = v_slot;
  if v_prev is distinct from v_sid then
    insert into public.login_events (user_id, session_id, method, device, user_agent, replaced_other)
    values (auth.uid(), v_sid,
            auth.jwt() -> 'amr' -> 0 ->> 'method',
            left(p_device, 60), left(p_user_agent, 400),
            v_prev is not null);
  end if;

  insert into public.active_sessions (user_id, slot, session_id, claimed_at)
  values (auth.uid(), v_slot, v_sid, now())
  on conflict (user_id, slot) do update set session_id = excluded.session_id, claimed_at = now();
  return 'ok';
end;
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
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

create or replace function public.session_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then jsonb_build_object('status', 'anonymous')
    when m.id is null then jsonb_build_object('status', 'not_member')
    when m.status = 'suspended' then jsonb_build_object('status', 'suspended')
    when not exists (select 1 from public.active_sessions s where s.user_id = auth.uid())
      then jsonb_build_object('status', 'unclaimed')
    when not exists (select 1 from public.active_sessions s where s.user_id = auth.uid() and s.session_id = public._jwt_session_id())
      then jsonb_build_object('status', 'replaced')
    else jsonb_build_object(
      'status', 'ok',
      'role', m.role,
      'name', m.name,
      'code', m.member_code,
      'nickname', coalesce(m.member_code, (select nickname from public.profiles where id = auth.uid())))
  end
  from (select 1) one
  left join public.members m on m.user_id = auth.uid();
$$;

revoke execute on function public._session_slot(text) from public, anon, authenticated;
