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
--
-- 【修正履歴】
--   初版はポリシー名を "pilot can insert conversation logs" と
--   決め打ちしていたが、実際の名前は v0 期に作られた
--   "Allow anonymous conversation log inserts" だった。
--   drop policy if exists は名前が一致しないと何もせずエラーも出さないため、
--   実行しても anon の INSERT ポリシーが残ったままになっていた
--   （実機で pg_policies を見て発覚）。
--   名前に依存せず、anon / public 向けのポリシーを列挙して落とす形に変更した。
-- ============================================================

-- conversation_logs の anon / public 向けポリシーを名前に依らず全て削除する
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'conversation_logs'
      and (roles && array['anon', 'public']::name[])
  loop
    execute format(
      'drop policy %I on public.conversation_logs',
      pol.policyname
    );
    raise notice 'dropped policy: %', pol.policyname;
  end loop;
end $$;

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

-- ============================================================
-- 確認用。以下がすべて満たされていれば締め直しは完了。
--   ・RLS の3行がすべて true
--   ・「ポリシー残:」の行が1行も出ない
--   ・wave0_active が 10（0006 実行済みの場合）
--
-- テーブル権限（information_schema.role_table_grants）が anon に
-- 残っていても、RLS 有効かつポリシー無し＝全拒否なので実害はない。
-- 権限の数を数える検算は誤りだったため採用しない。
-- ============================================================
select 'RLS: ' || c.relname || ' = ' || c.relrowsecurity::text as check_result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('conversation_logs', 'sessions', 'memory_trigger_episodes')
union all
select 'ポリシー残: ' || tablename || ' / ' || policyname || ' / ' || array_to_string(roles, ',')
from pg_policies
where schemaname = 'public'
union all
select 'wave0_active: ' || count(*)::text
from public.memory_trigger_episodes
where source_type = 'seed' and is_active = true;
