-- ============================================================
-- LOGGLYPH : Story Preview（story_preview_v1）
--
-- すべて追加のみ。既存テーブルの破壊的変更は行わない。
--
-- ⚠ Fact / Interpretation / Dramatization を層として分ける。
--
--   FACT           本人が実際に話したこと
--                  sessions.one_line_memory / conversation_logs / memory_facets
--   INTERPRETATION AIによる意味づけ・仮説。人格に触れうる
--                  found_notes（従来どおり手動承認。自動生成しない）
--   DRAMATIZATION  脚本としての演出。自動生成してよい
--                  story_fragments
--
-- ⚠ DRAMATIZATION を FACT に逆輸入しない。
--   「海を見てぼーっとしていた」は facet に入る。
--   「人生に絶望していた」は演出なので入らない。
--   これはコード側でも強制する（facet を作る関数は story_fragments を読まない）。
-- ============================================================

-- ---------- story_fragments : 演出。事実ではない ----------
create table if not exists public.story_fragments (
  session_id     text primary key,
  client_token   text not null,
  body           text not null,
  model          text not null,
  prompt_version text not null,
  created_at     timestamptz not null default now()
);
create index if not exists story_fragments_token_idx
  on public.story_fragments (client_token, created_at);
alter table public.story_fragments enable row level security;

-- ---------- memory_facets : FACT から抽出した構造化素材 ----------
--
-- 進捗％の根拠になる。category と slot の組で「情報の種類」を表す。
-- ⚠ 同じ種類は1セッションにつき1つ。何度同じ話をしても％は動かない。
create table if not exists public.memory_facets (
  facet_id     uuid primary key default gen_random_uuid(),
  session_id   text not null,
  client_token text not null,
  category     text not null,
  slot         text not null,
  value        text not null,
  created_at   timestamptz not null default now(),
  unique (session_id, category, slot)
);
create index if not exists memory_facets_token_idx
  on public.memory_facets (client_token, created_at);
alter table public.memory_facets enable row level security;

-- ---------- story_progress_snapshots : 表示時点の％ ----------
--
-- 「65% → 80%」の差分を出すために、その回に見せた値を残す。
create table if not exists public.story_progress_snapshots (
  session_id   text primary key,
  client_token text not null,
  scores       jsonb not null,
  overall      int   not null,
  created_at   timestamptz not null default now()
);
create index if not exists story_progress_token_idx
  on public.story_progress_snapshots (client_token, created_at);
alter table public.story_progress_snapshots enable row level security;

-- ---------- story_views : 表示計測 ----------
create table if not exists public.story_views (
  session_id   text primary key,
  client_token text not null,
  viewed_at    timestamptz not null default now()
);
create index if not exists story_views_token_idx
  on public.story_views (client_token, viewed_at);
alter table public.story_views enable row level security;

-- ---------- Episode に物語カテゴリのタグ ----------
--
-- 不足しているカテゴリを引き出しやすい Episode を優先抽選するため。
-- ⚠ Conversation Engine 本体（lib/conversation/）は変更しない。
--   変えるのは Episode の抽選の優先度だけ。
alter table public.memory_trigger_episodes
  add column if not exists narrative_categories text[];

create index if not exists episodes_narrative_idx
  on public.memory_trigger_episodes using gin (narrative_categories);

-- ---------- 権限 ----------
grant select, insert, update on public.story_fragments          to service_role;
grant select, insert, update on public.memory_facets            to service_role;
grant select, insert, update on public.story_progress_snapshots to service_role;
grant select, insert         on public.story_views              to service_role;

-- ============================================================
-- 検証
--
-- 1) 4テーブルが返ること
--   select count(*) from information_schema.tables
--   where table_schema='public' and table_name in
--     ('story_fragments','memory_facets','story_progress_snapshots','story_views');
--
-- 2) ポリシーが無いこと（0）
--   select count(*) from pg_policies where schemaname='public'
--     and tablename in ('story_fragments','memory_facets','story_progress_snapshots','story_views');
--
-- 3) Episode に列が増えたこと
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='memory_trigger_episodes'
--     and column_name='narrative_categories';
-- ============================================================

notify pgrst, 'reload schema';
