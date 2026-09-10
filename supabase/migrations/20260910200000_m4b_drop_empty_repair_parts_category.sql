-- 20260910200000 · 刪掉那個【空的、會被選錯的】第三列「維修零件」。
--
-- 🔴 為什麼有這一支:`categories` 裡有三列 name = '維修零件'
--      69546b21  sort 1001  raw_path「維修零件」                ← 頂層, 0 件, 而它是下面那列的【父層】
--        └ ce697b77 sort 10 raw_path「維修零件 · 維修零件」      ← 1,646 件都在這裡
--      d83ce275  sort 10    raw_path「服務與其他 · 維修零件」     ← 0 件 · 0 子分類 · 本支要刪的
--
-- 🎯 前台 `.find()` 走 (sort_order, name, id) ⇒ `sort_order = 10` 有【兩列】同名
--    ⇒ 選中有貨的那一列靠的是 UUID 字典序的巧合。刪掉空的那列 ⇒ 變成唯一解。
--
-- 🛑 **刪完仍有 2 列同名**(頂層 + 它的子層)。這一發【不是】在消滅同名,
--    是在消滅那個【會被選錯而且是空的第三者】。兩件事,別讀成同一件。
--
-- 🛑 **69546b21 不能刪** —— 它的「0 件」不是「沒人用」, 它是導覽節點, 貨掛在它的子層。
--    🔵 `ON DELETE RESTRICT` 會擋住那一發 —— 而「一個會失敗的操作」與「一個不該做的操作」
--       不是同一件事。前者靠資料庫救, 後者要靠讀懂那棵樹。(出處:窗A 2026-09-10 查證)
--
-- 🔵 碼那一側:三個 uuid 在 apps/ 與 packages/ 命中 0 · sitemap.ts 不列舉分類。
--    唯一相關處 `CategoryGrid.tsx:247` HOME_WALL_EXCLUDED 比對的是【名字】不是 uuid
--    ⇒ 刪這一列不會讓它失效。
--
-- 📋 查證全文 docs/evidence/2026-09-10-維修零件三列-刪之前先查.md
-- ✅ Sean 2026-09-10 拍甲(逐字「q1 甲」= 刪)。
-- ↩️ rollback supabase/rollbacks/20260910200000_down.sql

BEGIN;

-- 前置閘:從查證到貼下去之間, 世界會變 ⇒ 在同一個交易裡再確認一次它仍然是空的。
DO $gate$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.products
   WHERE category_id = 'd83ce275-1dd7-489d-a4c1-809a5c5c87fc'::uuid;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘:那一列底下現在有 % 件商品 ⇒ 拒刪', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.categories
   WHERE parent_category_id = 'd83ce275-1dd7-489d-a4c1-809a5c5c87fc'::uuid;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘:那一列底下現在有 % 個子分類 ⇒ 拒刪', v_n;
  END IF;

  -- 🔴 分母閘:那一列必須存在。不存在 ⇒ 這支貼過了, 或 uuid 打錯 ⇒ 兩種都要當場紅,
  --    而不是讓 DELETE 靜靜地刪掉 0 列然後回 rc=0。
  SELECT count(*) INTO v_n FROM public.categories
   WHERE id = 'd83ce275-1dd7-489d-a4c1-809a5c5c87fc'::uuid;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘:要刪的那一列命中 % 列(期望 1)⇒ 拒刪', v_n;
  END IF;
END
$gate$;

DELETE FROM public.categories
 WHERE id = 'd83ce275-1dd7-489d-a4c1-809a5c5c87fc'::uuid;

DO $assert$
DECLARE v_dup bigint; v_sort10 bigint;
BEGIN
  SELECT count(*) INTO v_dup FROM public.categories WHERE name = '維修零件';
  IF v_dup <> 2 THEN
    RAISE EXCEPTION '事後斷言:同名「維修零件」應剩 2 列, 實際 % ⇒ 拒繼續', v_dup;
  END IF;

  -- 🎯 這一格才是這支 migration 的目的:sort_order = 10 的同名列必須剩【唯一一列】。
  SELECT count(*) INTO v_sort10 FROM public.categories
   WHERE name = '維修零件' AND sort_order = 10;
  IF v_sort10 <> 1 THEN
    RAISE EXCEPTION '事後斷言:sort_order=10 的「維修零件」應剩 1 列, 實際 % ⇒ 選中仍靠巧合', v_sort10;
  END IF;

  RAISE NOTICE '✅ 刪掉 1 列。而【仍有 2 列同名】(頂層 + 它的子層)⇒ 這一發沒有消滅同名, 只消滅了那個【會選錯】的第三者。';
END
$assert$;

COMMIT;
