-- ============================================================
-- LOGGLYPH Reading Engine Benchmark
--
-- 変更日 : 2026-09-20
-- 承認   : Product Owner（2026-09-20 / 「実装開始・推奨で」）
--
-- 目的：Humanities Model 本体に進む前の Gate。
--       「Claude が手で強い Reading を書けること」ではなく
--       「製品が自動でそれを出せること」を実データで確かめる。
--
-- ⚠ 既存テーブルは一切変更しない。新規3テーブルの追加のみ。
-- ⚠ 会話・抽出・Admin の既存動作には影響しない。
-- ⚠ 参加者の発話そのものはここに複製しない。
--    保存するのは Signal の引用・生成された読み・検査結果まで。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 実行単位
-- ------------------------------------------------------------
create table if not exists public.reading_bench_runs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  engine_version  text not null,
  model           text not null,

  -- 対象にしたセッション
  session_ids     text[] not null,

  -- Reading Abstention / Candidate Attrition
  -- ⚠ 「落ちた場所の内訳」を必ず残す。棄却率だけでは、
  --    質が上がったのか、出さないことで失敗を回避しているのか区別できない。
  attrition       jsonb not null,

  -- 候補ごとの検査結果（Signal / 読み / 4軸 / 採否）
  results         jsonb not null,

  note            text
);

-- ------------------------------------------------------------
-- 2. Blind 評価
--
-- ⚠ kind（どれがエンジンの出力か）を、verdict が入る前に
--    画面へ出してはいけない。対応表が見えた時点でこの評価は無効になる。
--    列としては持つが、表示の制御はコード側で行う。
-- ------------------------------------------------------------
create table if not exists public.reading_bench_ratings (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.reading_bench_runs(id) on delete cascade,
  session_id  text not null,

  -- 画面上の並び。実行時にランダムで決める
  slot        text not null check (slot in ('A', 'B', 'C')),

  -- 正体。open_bet = エンジンの出力 / decoy = 固定の一般論 / swapped = 他人の読み
  kind        text not null check (kind in ('open_bet', 'decoy', 'swapped')),

  text        text not null,

  -- ① そこを見る？ ② 自分にしか当てはまらない ③ 一般論っぽい
  verdict     text check (verdict in ('sees', 'only_me', 'generic')),
  rated_at    timestamptz,

  unique (run_id, session_id, slot)
);

create index if not exists reading_bench_ratings_run_idx
  on public.reading_bench_ratings (run_id, session_id);

-- ------------------------------------------------------------
-- 3. RLS
--
-- ポリシーは作らない（deny-all）。アクセスは service_role 経由のみ。
-- 0003_tighten_rls.sql で閉じた方針をそのまま踏襲する。
-- ⚠ anon / public 向けのポリシーを、ここで作らないこと。
-- ------------------------------------------------------------
alter table public.reading_bench_runs    enable row level security;
alter table public.reading_bench_ratings enable row level security;

grant select, insert, update on public.reading_bench_runs    to service_role;
grant select, insert, update, delete on public.reading_bench_ratings to service_role;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：この2行が返れば成功（0行なら作成されていない）
-- ------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('reading_bench_runs', 'reading_bench_ratings')
order by table_name;
