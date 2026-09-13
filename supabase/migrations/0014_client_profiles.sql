-- ============================================================
-- LOGGLYPH 最終ユーザーテスト : プロフィール取得（profile_v1）
--
-- 変更日   : 2026-09-13
-- 承認     : Product Owner（2026-09-13 / 3点の判断）
--
-- 目的：「誰に Return Pull が強く出たのか」を利用ログと突き合わせる。
--       demographic segmentation を作るためではない。
--
-- ⚠ 既存テーブルは一切変更しない。新規テーブルの追加のみ。
-- ⚠ 本人特定情報（名前・メール・電話）は列としても作らない。
-- ⚠ 保存するのは英数コードのみ。日本語ラベルはコード側（lib/profile.ts）に持つ。
--    文言を直したときに過去データが読めなくなるのを防ぐため。
-- ⚠ 自由記述の列は作らない。職業・地名などの特定情報が混入するため。
--
-- 主キーが client_token ＝ 1人1行。session 単位ではない。
-- 属性は会話ごとに変わらないので、何度も聞かない。
-- ============================================================

create table if not exists public.client_profiles (
  client_token   text primary key,

  -- Q1 今の自分に近い状態（複数選択）。Segmentation の中心。
  states         text[],
  -- Q2 試してみようと思った理由（複数選択）
  motives        text[],
  -- Q3 振り返り・記録の習慣（単一）
  reflect_habit  text,
  -- Q4/Q5 参考値。結論には使わない。
  age_band       text,
  gender         text,

  -- 1つでも答えたか。false のまま行があるのは「出したが断られた」の意味。
  -- ⚠ この区別が無いと、無回答が多いときに
  --    「出していない」のか「断られた」のか分からなくなる。
  answered       boolean not null default false,

  first_shown_at timestamptz not null default now(),
  answered_at    timestamptz,
  updated_at     timestamptz not null default now()
);

-- RLS は有効化するが、ポリシーは作らない（deny-all）。
-- 読み書きは service_role 経由のみ。0003 で閉じた方針をそのまま踏襲する。
alter table public.client_profiles enable row level security;

grant select, insert, update on public.client_profiles to service_role;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：この3行が返れば成功（0行なら作成されていない）
-- ------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'client_profiles'
  and column_name in ('client_token', 'states', 'answered')
order by column_name;
