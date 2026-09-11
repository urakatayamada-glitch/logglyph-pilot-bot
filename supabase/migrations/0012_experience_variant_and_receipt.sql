-- ============================================================
-- LOGGLYPH : Memory Receipt と体験条件（experience_variant）
--
-- すべて追加のみ。既存テーブルの破壊的変更は行わない。
-- ============================================================

-- ---------- sessions : 体験条件 ----------
--
-- src（どの記事から来たか）とは別の軸。
--   src                … 流入記事
--   experience_variant … プロダクト体験条件
--
--   baseline          … 会話後に Future Preview（この先3つが育ちます／開発中）
--   memory_receipt_v1 … 会話後に Memory Receipt（今日ひとつ残りました／確定）
--
-- ⚠ サーバ側で決める。クライアントからは指定させない。
-- ⚠ 再開のときは既存の値を保持する。会話の途中でフラグを切り替えても
--   そのセッションの条件は変わらない。
--
-- ⚠ これは A/B ランダムテストではない。導入前後の variant 比較である。
--   記事1の読者と、フラグを入れたあとの読者は同じ集団ではない。
--   統計的効果としては扱わず Positive / Negative Signal として読むこと。
alter table public.sessions
  add column if not exists experience_variant text not null default 'baseline';

-- 既存の行はすべて baseline だった（Memory Receipt が存在しなかったため）。
-- default は今後の行にしか効かないので、既存分も明示的に埋める。
update public.sessions
set experience_variant = 'baseline'
where experience_variant is null;

create index if not exists sessions_experience_variant_idx
  on public.sessions (experience_variant, started_at);

-- ---------- receipt_views : Memory Receipt を表示した記録 ----------
--
-- session_id を主キーにする。再読み込みで行が増えると
-- Memory Receipt Viewed が水増しされるため。
create table if not exists public.receipt_views (
  session_id   text primary key,
  client_token text not null,
  viewed_at    timestamptz not null default now()
);
create index if not exists receipt_views_token_idx
  on public.receipt_views (client_token, viewed_at);
alter table public.receipt_views enable row level security;

grant select, insert on public.receipt_views to service_role;

-- ============================================================
-- 検証
--
-- 1) 列が増えたこと
--   select column_name, column_default from information_schema.columns
--   where table_schema='public' and table_name='sessions'
--     and column_name='experience_variant';
--
-- 2) 既存の行がすべて baseline であること（1行だけ返る）
--   select experience_variant, count(*) from public.sessions
--   group by experience_variant;
--
-- 3) receipt_views が空であること（0 が返る）
--   select count(*) from public.receipt_views;
--
-- 4) ポリシーが作られていないこと（0 が返る）
--   select count(*) from pg_policies
--   where schemaname='public' and tablename='receipt_views';
-- ============================================================

notify pgrst, 'reload schema';
