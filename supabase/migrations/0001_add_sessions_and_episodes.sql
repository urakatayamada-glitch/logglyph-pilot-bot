-- ============================================================
-- LOGGLYPH Pilot vNext : Session基盤とMemory Trigger Episode
--
-- すべて追加のみ。既存テーブルの破壊的変更は行わない。
-- 既存の conversation_logs の anon INSERT ポリシーはこの時点では残す
-- （サーバー経由の書き込みが安定して動くことを確認してから 0003 で撤去する）。
-- ============================================================

-- ---------- sessions : 1回の会話 = 1 Session ----------
create table if not exists public.sessions (
  session_id             text primary key,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  status                 text not null default 'active'
                         check (status in ('active','completed')),

  -- どのEpisodeから始まった会話か（Episode別の成績を出すために保持）
  episode_id             uuid,
  memory_trigger_category text,
  episode_source_type    text check (episode_source_type in ('seed','ai_generated','user_memory')),

  -- 改善前後の比較に使う
  prompt_version         text,

  -- Analytics（会話終了時に確定させる）
  message_count          integer not null default 0,
  user_message_count     integer not null default 0,
  user_char_count        integer not null default 0,
  ai_char_count          integer not null default 0,

  -- 抽出結果
  memory_found           boolean not null default false,
  hidden_candidate_found boolean not null default false,
  one_line_memory        text,
  structured_memory      jsonb,

  -- 終了後の評価（任意回答。未回答はnullのまま）
  user_rating            integer check (user_rating between 1 and 5),
  wants_to_talk_again    boolean,

  -- 簡易レート制限用
  client_token           text,
  ip_hash                text,

  -- Safety
  moderation_flag_count  integer not null default 0,

  created_at             timestamptz not null default now()
);

create index if not exists sessions_started_at_idx on public.sessions (started_at desc);
create index if not exists sessions_client_token_idx on public.sessions (client_token, started_at);
create index if not exists sessions_ip_hash_idx on public.sessions (ip_hash, started_at);

-- ---------- memory_trigger_episodes ----------
-- コード内のファイルではなくDBに置く理由：
--   1. Episodeの追加・修正にデプロイが不要
--   2. sessions.episode_id と紐付けて「どのEpisodeが記憶を引き出せたか」を測れる
create table if not exists public.memory_trigger_episodes (
  id           uuid primary key default gen_random_uuid(),
  body         text not null,
  category     text not null,
  source_type  text not null default 'seed'
               check (source_type in ('seed','ai_generated','user_memory')),
  is_active    boolean not null default true,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists episodes_active_idx
  on public.memory_trigger_episodes (source_type, is_active);

-- ---------- conversation_logs への追加列 ----------
alter table public.conversation_logs
  add column if not exists turn_index integer,
  add column if not exists prompt_version text,
  add column if not exists moderation_flagged boolean not null default false,
  add column if not exists moderation_categories jsonb;

create index if not exists conversation_logs_session_idx
  on public.conversation_logs (session_id, created_at);

-- ---------- RLS ----------
-- 新規2テーブルはポリシーを一切作らない = anonからは全拒否。
-- アクセスはすべてサーバー側の service_role 経由に限定する。
alter table public.sessions enable row level security;
alter table public.memory_trigger_episodes enable row level security;
