-- 회원이 자기 요청·건의의 처리 결과를 볼 수 있게
--  - 관리자 답변(반려 사유 등) reply
--  - 건의사항 처리 시각 handled_at, 본인 열람
alter table public.venue_requests add column if not exists reply text check (reply is null or char_length(reply) <= 300);
grant update (reply) on public.venue_requests to authenticated; -- 수정은 관리자 정책으로만 가능

alter table public.feedback add column if not exists reply text check (reply is null or char_length(reply) <= 300);
alter table public.feedback add column if not exists handled_at timestamptz;
grant update (reply) on public.feedback to authenticated;

create or replace function public.feedback_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reply := null;
    new.handled_at := null;
    new.created_at := now();
  elsif new.status is distinct from old.status then
    new.handled_at := case when new.status = 'pending' then null else now() end;
  end if;
  new.reply := nullif(btrim(new.reply), '');
  return new;
end;
$$;
drop trigger if exists feedback_before_write on public.feedback;
create trigger feedback_before_write before insert or update on public.feedback
  for each row execute function public.feedback_before_write();

drop policy if exists "feedback: 관리자 읽기" on public.feedback;
drop policy if exists "feedback: 본인·관리자 읽기" on public.feedback;
create policy "feedback: 본인·관리자 읽기" on public.feedback
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

notify pgrst, 'reload schema';
