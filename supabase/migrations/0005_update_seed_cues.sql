-- ============================================================
-- LOGGLYPH Pilot v1.3.2 : Seed Episode の問いかけ修正
--
-- ChatGPTレビュー §7 の指示による、S07 / S08 / S13 / S15 の
-- 最後の問いかけ（Cue）の差し替え。
--
-- 目的：
--   S07 「理由なく離れた人」→ 状況を具体化し、絶縁・死別へ無防備に
--        接続しないようにする
--   S08 「家族との、そういう場面」→ 問いが広すぎたため、
--        「離れた日に残った一言」へ限定する
--   S13 「帰る場所ってある？」→ 孤立感に直接触れる問いを避け、
--        場所の見え方の変化に限定する
--   S15 「誰にも言ってないこと」→ 秘密の直接要求に近かったため、
--        「人に見せるためじゃない継続」へ言い換える
--
-- Episode本文は変更していません。最後の1行のみ差し替えます。
-- 既にDBへ投入済みの行を更新するため、UPDATE で実行します。
-- ============================================================

-- S07 friendship
update public.memory_trigger_episodes
set body = replace(
  body,
  'そういう、理由なく離れた人っている？',
  '喧嘩したわけじゃないのに、いつの間にか疎遠になった人っている？'
)
where body like '%そういう、理由なく離れた人っている？%';

-- S08 family
update public.memory_trigger_episodes
set body = replace(
  body,
  '家族との、そういう場面ってある？',
  '家を出た日とか、誰かと離れた日に、妙に残ってる一言ってある？'
)
where body like '%家族との、そういう場面ってある？%';

-- S13 nostalgia
update public.memory_trigger_episodes
set body = replace(
  body,
  '帰る場所って、どこかにある？',
  '久しぶりに行ったら、知ってるはずなのに違って見えた場所ってある？'
)
where body like '%帰る場所って、どこかにある？%';

-- S15 desire
update public.memory_trigger_episodes
set body = replace(
  body,
  '誰にも言ってない、続けてることってある？',
  '人に見せるためじゃないけど、なんとなく続けてることってある？'
)
where body like '%誰にも言ってない、続けてることってある？%';

-- 確認用：4件すべて更新されていれば 4 と出る
select count(*) as updated_cues
from public.memory_trigger_episodes
where body like '%疎遠になった人っている？%'
   or body like '%妙に残ってる一言ってある？%'
   or body like '%違って見えた場所ってある？%'
   or body like '%なんとなく続けてることってある？%';
