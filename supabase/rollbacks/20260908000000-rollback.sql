-- ⟦還原 · 災難用⟧ 20260908000000_m4b_q74_products_list_dealer_view.sql 的回頭路
--
-- 🔵 這一片【沒有資料風險】:它只建了一支 view, 沒有動任何一列資料、沒有改任何既有物件。
--    ⇒ 還原 = 把那支 view 拿掉。products / products_list_public 一個字都沒被動過, 不需要還原。
--
-- 🔴 什麼時候【不可以】跑這一支:
--    第 2 片(經銷 RPC)已經貼上去了 ⇒ 那支函式讀這張 view ⇒ 先還原第 2 片, 再跑本支。
--    ⇒ 下面的閘會替你擋:有相依物件時整筆回滾, 不會半途把東西弄壞。
--
-- 🛑 而「有沒有相依」這件事有時效 —— 所以閘裡【當場重量】, 不吃我寫這個檔當下的讀數。

BEGIN;

SET LOCAL lock_timeout = '5s';
-- 🔴 codex R2 must-fix ④:閘①b 靠【反解出來的字面】判斷。連線若開著 quote_all_identifiers,
--    反解會變成 "delisted_at" IS NULL ⇒ 一份【完全正確的原版】會被誤判成別人的東西而拒絕還原。
--    ⇒ 誤判方向是安全的(拒絕還原), 而在災難當天「它拒絕還原」看起來就像回頭路壞了。釘住它。
SET LOCAL quote_all_identifiers = off;

DO $g$
DECLARE
  v_n int;
  v_dep text;
BEGIN
  -- 閘① 它在不在 —— 不在就別假裝還原成功
  IF to_regclass('public.products_list_dealer') IS NULL THEN
    RAISE EXCEPTION '閘①:public.products_list_dealer 不存在 ⇒ 沒有東西可還原(整筆回滾)。';
  END IF;

  -- 閘①b 🔴 codex R1 must-fix ⑥:同名【不等於】同一份。
  --   若它已被別人換成另一個定義, 原版只憑「名字在」就 DROP ⇒ 刪掉別人的東西。
  --   ⇒ 先核 (a) 它是 view 不是 table (b) 16 欄逐欄同名同序 (c) 定義裡有本片那兩個特徵。
  SELECT c.relkind::text INTO v_dep FROM pg_class c WHERE c.oid = 'public.products_list_dealer'::regclass;
  IF v_dep <> 'v' THEN
    RAISE EXCEPTION '閘①b:它現在是 relkind=%(期望 v = view)⇒ 停, 不是我建的那個東西。', v_dep;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_dep
    FROM pg_attribute a
   WHERE a.attrelid = 'public.products_list_dealer'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_dep IS DISTINCT FROM 'id,title,subtitle,handle,brand_id,category_id,availability,fitments,'
                            || 'price_general,supplier_slug,card_image,fits,brand_name,brand_slug,category_raw,created_at' THEN
    RAISE EXCEPTION '閘①b:欄名/欄序不是本片那一份(實際=%)⇒ 停。', v_dep;
  END IF;
  -- 🔴 codex R2 must-fix ③:只比兩個特徵字擋不住【保留欄位而改了定義】的版本 ——
  --    例如把價格改成 coalesce(pr.price_store, v.price_general) + 1, 或多加一個商品篩選,
  --    兩個特徵字都還在 ⇒ 舊寫法會直接刪掉別人已經改版的 view。
  --    ⇒ 改成比【整份定義】的正規化指紋(小寫 + 去引號 + 去所有空白)。
  -- ⚠️🔴 這個值是在【PG 17.10 / Homebrew / macOS 拋棄式叢集】上量的(2026-09-07)。
  --    PostgreSQL 反解 view 的排版跨版本可能不同 ⇒ 正式庫上【有可能對不上而它其實是對的】。
  --    ⇒ 所以下面這道閘的訊息會把【當下實際的值】印出來:對不上時**不要當成 view 被人改過**,
  --      先人工 pg_get_viewdef 看一眼再決定。誤判方向是拒絕還原, 那一邊是安全的。
  v_dep := md5(regexp_replace(lower(replace(pg_get_viewdef('public.products_list_dealer'::regclass, true), '"', '')), '\s+', '', 'g'));
  IF v_dep <> '496be8287f097c79b974faf53a32ccaf' THEN
    RAISE EXCEPTION '閘①b:正規化定義指紋 = %(期望 496be8287f097c79b974faf53a32ccaf)⇒ 停。⚠️ 兩種可能:(a) 這支 view 被人改過 (b) 這台伺服器的反解排版與量測時不同。人工比 pg_get_viewdef 再決定, 本閘不替你判。', v_dep;
  END IF;

  -- 閘② 有沒有別的東西靠著它(第 2 片那支 RPC、或任何人後來加的 view)
  SELECT count(*), string_agg(DISTINCT dc.relname, ', ')
    INTO v_n, v_dep
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class dc ON dc.oid = rw.ev_class
   WHERE d.refobjid = 'public.products_list_dealer'::regclass
     AND d.deptype IN ('n', 'a')
     AND dc.oid <> 'public.products_list_dealer'::regclass;
  IF v_n > 0 THEN
    RAISE EXCEPTION '閘②:還有 % 個物件靠著它(%)⇒ 停, 先還原第 2 片。', v_n, v_dep;
  END IF;

  -- 閘③ 函式體字面提到它的(pg_depend 抓不到 plpgsql 內部的引用 —— 那是【動態解析】的)
  --   🔴 這一格是必要的:plpgsql 的 body 對 planner 是字串, 上面那個 pg_depend 對它完全失明。
  --   🔴 codex R1 must-fix ④⑤, 三處都改了, 理由是【這道閘的誤判方向不對稱】:
  --     多抓一個 ⇒ 拒絕還原 ⇒ 人來看一眼(安全);漏抓一個 ⇒ 刪掉還在用的 view(不安全)。
  --     ⇒ 所以一律往【多抓】的方向調:
  --     ④ 不再只掃 public —— 任何 schema 的函式都可能字面引用它(排除系統 schema 只為降噪)
  --     ⑤a 不再剝註解 —— 剝註解會被同一行前面出現的 `--`(可能只是字串裡的字元)吃掉後面的真引用
  --     ⑤b 一律 lower() —— 未加引號的 `PRODUCTS_LIST_DEALER` 是合法且等價的寫法, 而 strpos 大小寫敏感
  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ')
    INTO v_n, v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc IS NOT NULL
     AND strpos(lower(p.prosrc), 'products_list_dealer') > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION '閘③:仍有 % 支函式的 body 字面提到它(%)⇒ 停, 先還原那些。(本閘刻意寧可多抓)', v_n, v_dep;
  END IF;
END
$g$;

DROP VIEW public.products_list_dealer;

DO $post$
BEGIN
  IF to_regclass('public.products_list_dealer') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:DROP 完它還在 ⇒ 停。';
  END IF;
  -- 正對照:同一把尺對【該在的】必須看得到 —— 否則這把尺的 NULL 不算數
  IF to_regclass('public.products_list_public') IS NULL THEN
    RAISE EXCEPTION '事後閘:正對照失敗 —— 連 products_list_public 都查無 ⇒ 這把尺壞了 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ products_list_dealer 已移除;products_list_public 仍在(正對照)。';
END
$post$;

COMMIT;
