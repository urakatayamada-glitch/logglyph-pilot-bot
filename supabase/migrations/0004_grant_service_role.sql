-- ============================================================
-- LOGGLYPH Pilot vNext : service_role への権限付与
--
-- 0001 で作った sessions / memory_trigger_episodes に
-- service_role への GRANT を書き忘れていたため、
-- サーバーからの読み書きが "permission denied for table sessions" で
-- 失敗していた。
--
-- service_role はサーバー側専用のロールで、RLSを無視する前提のもの。
-- ブラウザには渡らないため、全権限を与えて問題ない。
-- ============================================================

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- 今後テーブルを追加したときも同じ問題が起きないよう、既定の権限も設定する
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;

-- 確認用（実行すると 20 と出るはず）
select count(*) as episodes from public.memory_trigger_episodes;
