-- ============================================================
-- LOGGLYPH Pilot vNext : RLSの締め直し
--
-- ⚠ このMigrationは 0001 / 0002 を適用し、
--    サーバー経由（service_role）での書き込みが安定して動作することを
--    確認した「後」に実行してください。
--
--    vNextではすべてのDB書き込みがAPI Route経由になるため、
--    anonキーの権限は不要になります。
-- ============================================================

drop policy if exists "pilot can insert conversation logs" on public.conversation_logs;

revoke insert on table public.conversation_logs from anon;
revoke usage, select on sequence public.conversation_logs_id_seq from anon;

-- これで conversation_logs も anon からは一切触れなくなる
-- （ポリシーなし = 全拒否）。
