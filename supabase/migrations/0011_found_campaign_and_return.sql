-- ============================================================
-- LOGGLYPH : Found Campaign と Return 判定（Wave 1 / Found Return 01）
--
-- すべて追加のみ。既存テーブルの破壊的変更は行わない。
--
-- ⚠ 新しいテーブルは RLS を有効にし、ポリシーは一切作らない。
--   ポリシーが無い状態 = anon / authenticated からは触れない。
--   読み書きはすべてサーバー（service_role）経由。
--   0003_tighten_rls.sql で落とした anon 権限を開け直してはならない。
-- ============================================================

-- ---------- found_notes : 配布キャンペーンの記録 ----------
--
-- なぜカラムを足すのか。
--
-- /found のリンクは手動配布（DM等）なので「何人に送ったか」がDBに存在せず、
-- found_view_rate の分母を出せなかった。当初は「送付6名」をコードに
-- 直接書く案だったが、それだと
--   ・後から数字の根拠が分からなくなる
--   ・次の実験で人数が変わると破綻する
-- ため、送付の事実そのものをDBに残す。
--
--   campaign_key  … どの配布に属するか（例: wave1_found_return_01）
--   first_sent_at … 最初に送った時刻。⚠ 再送しても変更しない
--
-- ⚠ この2つは Migration では埋めない。
--   実際に送付する直前の「Sent記録」オペレーションで付与する。
--   Migration時に埋めてしまうと、まだ送っていない人が Sent に数えられる。
alter table public.found_notes
  add column if not exists campaign_key  text,
  add column if not exists first_sent_at timestamptz;

create index if not exists found_notes_campaign_idx
  on public.found_notes (campaign_key, first_sent_at);

-- ---------- sessions : 流入の文脈 ----------
--
-- /found から直接戻ってきたか（?from=found）を記録する補助情報。
--
-- ⚠ src は絶対に上書きしない。上書きすると Wave 2-A の母集団が壊れる。
--   entry_context は Return 判定の必須条件にもしない。
--   Foundを閉じて翌日ブックマークから戻った人も Post-Found Return に数える。
alter table public.sessions
  add column if not exists entry_context text;

create index if not exists sessions_entry_context_idx
  on public.sessions (entry_context);

-- ---------- internal_clients : 運営テストの明示登録 ----------
--
-- n が非常に小さいため、運営1人が混ざるだけで比率が大きく動く。
--
-- ⚠ 自動判定は禁止。IP / User Agent / 名前推測から Internal 扱いしない。
--   「これは確実に運営テスト」と分かっている client_token だけを手で入れる。
--
-- session 単位ではなく client 単位にする。
-- 同じ端末から新しい session が作られても Internal のままにするため。
create table if not exists public.internal_clients (
  client_token text primary key,
  note         text,
  added_at     timestamptz not null default now()
);
alter table public.internal_clients enable row level security;

-- ---------- 権限 ----------
grant select, insert, update, delete on public.internal_clients to service_role;

-- ============================================================
-- 検証
--
-- 1) 追加カラムが3つ返ること
--   select table_name, column_name from information_schema.columns
--   where table_schema='public'
--     and ((table_name='found_notes' and column_name in ('campaign_key','first_sent_at'))
--       or (table_name='sessions'    and column_name = 'entry_context'));
--
-- 2) internal_clients が存在すること（1 が返る）
--   select count(*) from information_schema.tables
--   where table_schema='public' and table_name='internal_clients';
--
-- 3) ポリシーが作られていないこと（0 が返る）
--   select count(*) from pg_policies
--   where schemaname='public' and tablename='internal_clients';
--
-- 4) この時点では誰も Sent になっていないこと（0 が返る）
--   select count(*) from public.found_notes where first_sent_at is not null;
-- ============================================================

notify pgrst, 'reload schema';
