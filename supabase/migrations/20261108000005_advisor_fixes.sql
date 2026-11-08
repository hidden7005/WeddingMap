-- =====================================================================
-- Supabase 보안·성능 점검(Advisors) 지적 사항 보완
-- =====================================================================

-- 1) 함수 search_path 고정 (function_search_path_mutable)
alter function public.set_row_meta()           set search_path = public;
alter function public.venues_bump_checked_at() set search_path = public;
alter function public.child_bump_checked_at()  set search_path = public;
alter function public._edit_ignored_columns()  set search_path = public;
alter function public.day_types_overlap(text, text) set search_path = public;

-- 2) "Enable automatic RLS" 옵션이 만든 내부 함수를 API(RPC)로 호출 못 하게
--    (프로젝트 생성 시 그 옵션을 켠 경우에만 존재)
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 3) RLS 정책에서 auth.uid()를 행마다 다시 계산하지 않도록 (auth_rls_initplan)
alter policy "profiles: 본인만 수정" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
