-- ============================================================
-- Sent記録オペレーション : Wave 1 / Found Return 01
--
-- ⚠ これは Migration ではない。手で実行する「送付オペレーション」。
-- ⚠ 実行するのは、6名に /found のリンクを送る「直前」。
--    先に実行すると、まだ送っていない人が Sent に数えられる。
--    後から実行すると、最初の閲覧が起点から漏れる。
--
-- 手順は 手順1 → 手順2 → 手順3 の順に、1つずつ実行する。
-- ============================================================


-- ------------------------------------------------------------
-- 手順1: 対象者を目で確認する（まだ何も書き換えない）
-- ------------------------------------------------------------
-- ここに出た人にリンクを送る。人数が想定と違う場合は、
-- 送る前に止めて原因を確認すること。
select
  n.session_id,
  s.client_token,
  s.started_at,
  s.user_message_count,
  s.memory_found,
  n.approved,
  n.campaign_key,
  n.first_sent_at
from public.found_notes n
join public.sessions s on s.session_id = n.session_id
where n.approved = true
  and s.memory_found = true
  and s.user_message_count > 0
order by s.started_at;


-- ------------------------------------------------------------
-- 手順2: campaign_key を付ける（first_sent_at はまだ付けない）
-- ------------------------------------------------------------
-- 手順1で出た行だけが対象になるよう、同じ条件で絞っている。
update public.found_notes n
set campaign_key = 'wave1_found_return_01'
from public.sessions s
where s.session_id = n.session_id
  and n.approved = true
  and s.memory_found = true
  and s.user_message_count > 0
  and n.campaign_key is null;

-- 確認（対象人数が返ること）
select count(*) as campaign_members
from public.found_notes
where campaign_key = 'wave1_found_return_01';


-- ------------------------------------------------------------
-- 手順3: 送る直前に first_sent_at を記録する
-- ------------------------------------------------------------
-- ⚠ first_sent_at is null の行だけを更新している。
--    再送のときにこのSQLをもう一度流しても、最初の送付時刻は変わらない。
--    起点がずれると Return が検出できなくなるため、ここは上書きしない。
update public.found_notes
set first_sent_at = now()
where campaign_key = 'wave1_found_return_01'
  and first_sent_at is null;

-- 確認（送付人数が返ること。Admin の Sent と一致する）
select count(distinct s.client_token) as sent_people
from public.found_notes n
join public.sessions s on s.session_id = n.session_id
where n.campaign_key = 'wave1_found_return_01'
  and n.first_sent_at is not null;


-- ------------------------------------------------------------
-- 参考: 運営テストの明示登録（必要なときだけ）
-- ------------------------------------------------------------
-- ⚠ 「これは確実に運営テスト」と分かっている client_token だけ。
--    IP / User Agent / 名前から推測して入れてはいけない。
--
-- insert into public.internal_clients (client_token, note)
-- values ('<client_token>', '運営の動作確認')
-- on conflict (client_token) do nothing;
