-- 특이사항 수정: 글쓴이 본인 + 관리자
drop policy if exists "venue_notes: 본인 수정" on public.venue_notes;
create policy "venue_notes: 본인·관리자 수정" on public.venue_notes
  for update to authenticated
  using (((author_id = (select auth.uid())) and (select public.is_active_member())) or (select public.is_admin()))
  with check ((author_id = (select auth.uid())) or (select public.is_admin()));

notify pgrst, 'reload schema';
