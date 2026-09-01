-- ============================================================
-- LOGGLYPH Pilot Wave 1 : Future Preview 後の追加設問の保存先
--
-- 変更日   : 2026-09-01
-- バージョン: v1.5.0 / Wave 1
-- 承認     : Product Owner（Wave 1 Product Decision ②）
--
-- sessions には user_rating と wants_to_talk_again しか無く、
-- Wave 1 で追加する4問を保存する場所が無い。
--
-- 列の追加のみ。既存の列・行・型は一切変更しない。
-- nullable かつ default 無しの add column は Postgres では
-- メタデータ操作だけで完了し、テーブルの書き換えを伴わない。
--
-- experiment_version 列は追加しない。
-- Wave 0 / Wave 1 の識別は prompt_version（v1.4.0 / v1.5.0）で足りる。
--
-- 保存形式（key-value。あとから意味が分からなくならないようにする）:
--   {
--     "future_curiosity": 4,              この先どうなるのか気になった
--     "want_to_accumulate": 5,            もう少し自分の記録を貯めてみたい
--     "want_five_day_insight": 4,         5日後に「見つかったこと」を見たい
--     "understood_continuation_value": 5  続ける意味が分かった
--   }
--   値は 1〜5。未回答の項目はキーごと存在しない。
-- ============================================================

alter table public.sessions
  add column if not exists followup_answers jsonb;

-- 確認用：followup_answers が1件出れば成功
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sessions'
  and column_name = 'followup_answers';
