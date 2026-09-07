-- ============================================================
-- LOGGLYPH : /found と Stage 1（Entry Pull 実測）と削除機能
--
-- すべて追加のみ。既存テーブルの破壊的変更は行わない。
--
-- ⚠ ここで作るテーブルには RLS を有効にし、ポリシーは一切作らない。
--   ポリシーが無い状態 = anon / authenticated からは触れない。
--   読み書きはすべてサーバー（service_role）経由で行う。
--   0003_tighten_rls.sql で落とした anon 権限を開け直してはならない。
-- ============================================================

-- ---------- sessions への追加 ----------
alter table public.sessions
  -- 流入識別。?src=note_wave2 等。知人コホートは null のまま。
  add column if not exists src text,
  -- 本人の削除操作で「内容だけ」消した時刻。
  -- 行そのものは匿名集計のために残すので、これが削除の記録になる。
  add column if not exists content_deleted_at timestamptz;

create index if not exists sessions_src_idx on public.sessions (src, started_at);

-- ---------- found_notes : 承認済みの「少し違う角度から」 ----------
--
-- 自動生成しない。Claudeが下書きし、Product Ownerが文面を読んで承認した
-- テキストだけを表示する。approved = false の間は画面に段ごと出さない。
create table if not exists public.found_notes (
  session_id  text primary key,
  note        text not null,
  approved    boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.found_notes enable row level security;

-- ---------- found_views : /found の閲覧と1タップ評価 ----------
create table if not exists public.found_views (
  view_id        uuid primary key default gen_random_uuid(),
  client_token   text not null,
  viewed_at      timestamptz not null default now(),
  -- Personal Value Recognition。1回だけ受け付ける。
  value_response text check (value_response in ('fit','off','unknown')),
  responded_at   timestamptz
);
create index if not exists found_views_token_idx
  on public.found_views (client_token, viewed_at);
alter table public.found_views enable row level security;

-- ---------- entry_views : Stage 1。Entry Pull の分母 ----------
--
-- これまでは「はじめる」を押すまで何も記録していなかったため、
-- 読んで帰った人がデータに一切現れず、Entry Pull を一度も実測できていなかった。
--   viewed_at   … 画面に到達した
--   accepted_at … 注意書きに同意した
-- 会話の開始は sessions 側で見る。API費用はここでは一切かからない。
create table if not exists public.entry_views (
  view_id      uuid primary key default gen_random_uuid(),
  client_token text not null,
  src          text,
  referrer     text,
  viewed_at    timestamptz not null default now(),
  accepted_at  timestamptz
);
-- 同一端末・同一日で1行に集約する（bot / prefetch / 再読み込みの過大計上を防ぐ）
create unique index if not exists entry_views_token_day_uidx
  on public.entry_views (client_token, (date_trunc('day', viewed_at at time zone 'Asia/Tokyo')));
alter table public.entry_views enable row level security;

-- ---------- capacity_rejections : 上限で断った人 ----------
--
-- ⚠ 分析上きわめて重要。
--   「興味がなくて始めなかった人」と「枠がなくて始められなかった人」を
--   同じ数字に混ぜると Entry Pull が壊れる。断った人はここに記録し、
--   Entry Pull の分母から除外する。
create table if not exists public.capacity_rejections (
  rejection_id uuid primary key default gen_random_uuid(),
  client_token text,
  ip_hash      text,
  src          text,
  reason       text not null,
  rejected_at  timestamptz not null default now()
);
create index if not exists capacity_rejections_at_idx
  on public.capacity_rejections (rejected_at desc);
alter table public.capacity_rejections enable row level security;

-- ---------- 権限 ----------
--
-- 0004 の alter default privileges で service_role には既に all が付くが、
-- 明示しておく。found_notes は本人の削除操作で行ごと消すので delete を含める。
grant select, insert, update, delete on public.found_notes to service_role;
grant select, insert, update on public.found_views         to service_role;
grant select, insert, update on public.entry_views         to service_role;
grant select, insert         on public.capacity_rejections to service_role;

-- ============================================================
-- 検証（4 が返ること）
--
--   select count(*) as new_tables
--   from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('found_notes','found_views','entry_views','capacity_rejections');
--
-- ポリシーが作られていないことの確認（0 が返ること）
--
--   select count(*) from pg_policies
--   where schemaname = 'public'
--     and tablename in ('found_notes','found_views','entry_views','capacity_rejections');
-- ============================================================
