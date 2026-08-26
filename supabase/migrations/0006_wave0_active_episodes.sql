-- ============================================================
-- LOGGLYPH Pilot Wave 0 : 配布時に使用するEpisodeを10件に絞る
--
-- ChatGPTレビュー §9 の指定による。
-- Wave 0 で使うのは S03 / S04 / S06 / S09 / S10 / S11 / S14 / S17 / S18 / S20。
--
-- 絞る理由：
--   Episodeは20件あるが、Wave 0の想定セッション数は20〜30件程度。
--   20件を全部有効にすると1件あたりの露出が1〜1.5回しかなく、
--   「どのEpisodeが記憶を引き出せたか」をEpisode単位で判定できない。
--   10件に絞れば1件あたり2〜3回の露出になり、比較の土台ができる。
--
-- 行の特定方法：
--   memory_trigger_episodes に安定したコード列が無いため、
--   0005 と同じく本文末尾の問いかけ（Cue）で特定する。
--
-- 元に戻す場合：
--   update public.memory_trigger_episodes set is_active = true
--   where source_type = 'seed';
-- ============================================================

-- 1. seedを一旦すべて無効化する
update public.memory_trigger_episodes
set is_active = false
where source_type = 'seed';

-- 2. Wave 0 の10件だけを有効化する
update public.memory_trigger_episodes
set is_active = true
where source_type = 'seed'
  and (
       body like '%そういう、自分だけがずっと覚えてる恥ずかしいやつってある？%'  -- S03 embarrassment
    or body like '%そういう、自分でも意外なくらい効いた出来事ってある？%'        -- S04 nostalgia
    or body like '%そういう、怒られるより効いたことってある？%'                  -- S06 work
    or body like '%そういう、勢いで引き受けたことってある？%'                    -- S09 decision
    or body like '%うまくいかなかった日のこと、何か覚えてる？%'                  -- S10 failure
    or body like '%そういう、誰かの一言で変わったことってある？%'                -- S11 challenge
    or body like '%選ばなかった道って、何かある？%'                              -- S14 regret
    or body like '%最近、自分が変わったなと思うことある？%'                      -- S17 aging
    or body like '%何もしてないのに覚えてる日って、ある？%'                      -- S18 surprise
    or body like '%ずっと言い続けてること、何かある？%'                          -- S20 dream
  );

-- 確認用：10 と出れば正しい。10でない場合は配布しないこと。
select count(*) as wave0_active
from public.memory_trigger_episodes
where source_type = 'seed' and is_active = true;
