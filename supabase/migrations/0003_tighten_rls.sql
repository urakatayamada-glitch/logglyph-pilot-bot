-- ============================================================
-- LOGGLYPH Pilot vNext : RLSの締め直し
--
-- ⚠ このMigrationは 0001 / 0002 を適用し、
--    サーバー経由（service_role）での書き込みが安定して動作することを
--    確認した「後」に実行してください。
--
--    vNextではすべてのDB書き込みがAPI Route経由になるため、
--    anonキーの権限は不要になります。
--
-- 実行タイミング：外部（Wave 0）配布の直前。
-- ============================================================

drop policy if exists "pilot can insert conversation logs" on public.conversation_logs;

revoke insert on table public.conversation_logs from anon;

-- conversation_logs は v0 期の schema で作られており、主キーが
-- bigserial（＝連番シーケンスあり）か uuid（＝シーケンスなし）か
-- 環境によって異なる。シーケンスが無い環境で無条件に revoke すると
-- そこでエラーになり、スクリプト全体が巻き戻ってしまうため、
-- 存在を確認してから revoke する。
do $$
begin
  if exists (
    select 1 from pg_class
    where relkind = 'S' and relname = 'conversation_logs_id_seq'
  ) then
    execute 'revoke usage, select on sequence public.conversation_logs_id_seq from anon';
  end if;
end $$;

-- これで conversation_logs も anon からは一切触れなくなる
-- （ポリシーなし = 全拒否）。

-- 確認用：anon に対する conversation_logs の権限が 0 件になっていること
select count(*) as anon_privileges_remaining
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'conversation_logs'
  and grantee = 'anon';
