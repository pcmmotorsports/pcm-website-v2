-- ============================================================
-- 維修零件:父子同名 ⇒ 合併成一個(32列-7 ⟦search-DUPCATNAMES⟧;Sean 2026-09-14 答 Q17 = 丙)
-- ============================================================
-- 現況(2026-09-14 唯讀正式庫):
--   69546b21… raw_path '維修零件'            頂層,商品 0 件,子類 1
--   ce697b77… raw_path '維修零件 · 維修零件' 子類,商品 1,520 件(上架 1,514)
-- 做法(最短路):子類的商品全部改掛頂層,子類刪掉。頂層變成「有直掛商品、沒子類」——
--   與 `未分類` / `服務與其他` 同形(頂層直掛商品今天就存在:碳纖維部品 291 件直掛)。
-- 為什麼往上併不是往下:往下要改頂層 raw_path 或留一個空頂層,兩邊都沒比較少;而 catalog RPC
--   對 `?category=維修零件` 本來就是 `= 或 LIKE '維修零件 · %'`(20260909070000:93)⇒ 併上去後
--   同一條 URL 照樣命中;舊 URL `?category=維修零件 · 維修零件` 由 storefront
--   `parseCategoryFromUrl`(products-url-parsers.ts:54)自動退回主類,不用 redirect(測試守著)。
-- 🔴 供應商同步:`scripts/rpm-import.ts` 用「大類 · 子類」組 raw_path 查 categories,查無 ⇒
--   WRITE 模式整批 abort(:627)。本片同一顆 commit 改 importer:`X · X` 查無 ⇒ 退回 `X`。
--   ⇒ 貼板之後同步靠這條退路;貼板之前 `X · X` 仍在、退路不會被走到。順序與時段見下面「貼板順序」。
-- 冪等:子類已不在 ⇒ NOTICE 後跳過,不炸。
-- 回滾:supabase/rollbacks/20260915090000-rollback.sql(前置閘釘住「頂層此刻 0 件」⇒ 貼完當下
--   頂層上的商品全部就是本片搬上去的;之後有新同步 / 人工改掛就不再精確,見下面那條)。
-- 🔴 資料修正 1,520 列 ⇒ 鐵則 12③;只動 products.category_id 單欄 + 刪 1 列 categories。
-- 🔴 貼板順序(codex R1 must-fix 2):① importer 那條退路要先在【CI 跑的那個分支】上(rpm-sync.yml 每日排程);
--   ② 貼板避開同步在跑的時段 —— 同步中途刪子類,那一發之後的 upsert 撞 FK 而 abort;⚠️ importer 分批寫,
--      **已成功的批次不會撤銷**(codex R2):同步可能「部分完成後失敗」,不是整輪原子回滾;所以要避開,不是靠它擋。
--   ③ 回滾同理。先貼板、後推 importer 的話,中間的同步在「未 seed 子類」那道閘 abort 到 importer 上線為止(那道閘在 upsert 前,資料不髒)。
-- 🔴 回滾的精確性只在「貼完立刻回」成立(codex R1 must-fix 3):合併之後新同步進來的 / 人工改掛到頂層的商品
--   分不出來,回滾會一起搬到子類。要精確回滾就要保存搬移集合,本片不做(回滾窗口 = 當日)。
-- ⏳ PENDING —— 只做不貼;貼的人是 Sean。
-- ============================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  v_sep      text := ' · ';
  v_top      text := '維修零件';
  v_child    text;
  v_top_id   uuid;
  v_child_id uuid;
  v_top_n    bigint;
  v_child_n  bigint;
  v_moved    bigint;
BEGIN
  IF encode(convert_to(v_sep, 'UTF8'), 'hex') <> '20c2b720' THEN
    RAISE EXCEPTION '維修零件合併:分隔符 byte 應為 20c2b720,實得 %;拒繼續', encode(convert_to(v_sep, 'UTF8'), 'hex');
  END IF;
  v_child := v_top || v_sep || v_top;

  -- 前置閘①:頂層恰 1 列且真的是頂層
  SELECT id INTO v_top_id FROM public.categories WHERE raw_path = v_top AND parent_category_id IS NULL;
  IF v_top_id IS NULL THEN
    RAISE EXCEPTION '維修零件合併:頂層 raw_path=% 不在或不是頂層;拒繼續', v_top;
  END IF;
  IF (SELECT count(*) FROM public.categories WHERE raw_path = v_top) <> 1 THEN
    RAISE EXCEPTION '維修零件合併:raw_path=% 應恰 1 列,實得 %;拒繼續', v_top, (SELECT count(*) FROM public.categories WHERE raw_path = v_top);
  END IF;

  -- 冪等出口:子類已經不在 ⇒ 本片做過了(或從來沒有),不動
  SELECT id INTO v_child_id FROM public.categories WHERE raw_path = v_child;
  IF v_child_id IS NULL THEN
    RAISE NOTICE '維修零件合併:子類 % 不在 ⇒ 已合併過或不存在,跳過', v_child;
    RETURN;
  END IF;

  -- 前置閘②:子類真的掛在這個頂層下、而且是它唯一的子類(不然「併成一個」這句話就不成立)
  IF (SELECT parent_category_id FROM public.categories WHERE id = v_child_id) IS DISTINCT FROM v_top_id THEN
    RAISE EXCEPTION '維修零件合併:子類 % 的 parent 不是頂層 %;拒繼續', v_child, v_top;
  END IF;
  IF (SELECT count(*) FROM public.categories WHERE parent_category_id = v_top_id) <> 1 THEN
    RAISE EXCEPTION '維修零件合併:頂層底下不只一個子類(實得 %),本片只處理同名那一個;拒繼續', (SELECT count(*) FROM public.categories WHERE parent_category_id = v_top_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.categories WHERE parent_category_id = v_child_id) THEN
    RAISE EXCEPTION '維修零件合併:子類底下還有孫類;拒繼續';
  END IF;

  -- 前置閘③:頂層此刻 0 件直掛 —— 回滾的精確性靠這一格(搬回去的就是搬上來的)
  SELECT count(*) INTO v_top_n   FROM public.products WHERE category_id = v_top_id;
  SELECT count(*) INTO v_child_n FROM public.products WHERE category_id = v_child_id;
  IF v_top_n <> 0 THEN
    RAISE EXCEPTION '維修零件合併:頂層已有 % 件直掛商品,回滾會分不出誰是誰;拒繼續(要先另外處理)', v_top_n;
  END IF;

  -- 目的寫入:只動 products.category_id 單欄
  UPDATE public.products SET category_id = v_top_id WHERE category_id = v_child_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved <> v_child_n THEN
    RAISE EXCEPTION '維修零件合併:搬了 % 件,子類原有 % 件,對不上;拒繼續', v_moved, v_child_n;
  END IF;

  DELETE FROM public.categories WHERE id = v_child_id;  -- FK RESTRICT:還有商品掛著會在這裡炸,那是對的

  -- 事後閘
  -- 🔵 用 raw_path 前綴數,不用 name:別的頂層底下也可能有一個叫「維修零件」的子類(鑽機上就有
  --    `服務與其他 · 維修零件` 那列舊的),那不是本片的對象。
  IF (SELECT count(*) FROM public.categories WHERE raw_path = v_top OR raw_path LIKE v_top || v_sep || '%') <> 1 THEN
    RAISE EXCEPTION '維修零件合併:事後 raw_path 以 % 開頭的應恰 1 列(只剩頂層),實得 %', v_top,
      (SELECT count(*) FROM public.categories WHERE raw_path = v_top OR raw_path LIKE v_top || v_sep || '%');
  END IF;
  IF (SELECT count(*) FROM public.products WHERE category_id = v_top_id) <> v_child_n THEN
    RAISE EXCEPTION '維修零件合併:事後頂層應有 % 件,實得 %', v_child_n, (SELECT count(*) FROM public.products WHERE category_id = v_top_id);
  END IF;
  RAISE NOTICE '維修零件合併:% 件商品由 % 改掛 %,子類已刪', v_moved, v_child, v_top;
END
$mig$;

COMMIT;
