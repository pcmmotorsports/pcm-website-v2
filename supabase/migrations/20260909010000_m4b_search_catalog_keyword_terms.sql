-- M-4b · ⟦db-SEARCHFACETMUTEX⟧ 關鍵字與 facet 不再互斥:`search_catalog_by_vehicle` 加 `p_terms`
--
-- 🔴 **今天的病**:客人打了關鍵字, 一點篩選, **他打的字就被丟掉**。
--   成因是兩條資料路互斥:`/products` 的 facet 走本函式(它沒有關鍵字參數),
--   關鍵字走 `SupabaseProductAdapter.searchByKeyword`(它吃不到 facet)。
--   ⇒ 前端今天的出路是「點 facet 就 `params.delete('search')`」(`use-catalog-filter-url-sync.tsx`)
--     —— 那是**止血**不是修好, 而板列 `⟦db-SEARCHFACETMUTEX⟧` 逐字寫著
--     「**要拆這個互斥, 只能從 DB 那一側拆**」。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **本檔【不自己寫一份 ILIKE】—— 那是本片最重要的一個決定**
-- ══════════════════════════════════════════════════════════════════════════
--   repo 裡已經有 `public.storefront_search_product_ids(p_terms text[]) RETURNS TABLE(id uuid)`
--   (現行代 `20260906950000_m4b_search_exact_match_first.sql:78`), 它做的正是:
--     ① `products_public` 四欄 ILIKE(title / subtitle / description / external_id)
--     ② 品牌名(刻意**不**併進同一個 OR —— 併回去正式站實測 249.1ms)
--     ③ 母料號正規化前綴(三個守門條件, 少第一個會**回傳整張表**)
--     ④ 變體 sku(最短 4 英數字閘, codex 與 code-reviewer 同時抓到的)
--   🎯 **每一塊都付過學費, 而那些學費寫在【那一支】的註解裡。**
--   ⇒ 📌 我在這裡自己寫一份 ILIKE = 兩份會漂, 而漂的方向是**客人搜不到**, 那沒有人會回報。
--   🛑 **第二個理由是物理的**:`products_list_public`(本函式撈的那張 view)
--     **沒有 `description` 也沒有 `external_id`** —— 就算想在這裡比也比不完整。
--     🔬 數法:`20260811040000_m4b_storefront_269b_catalog_new_arrivals.sql:198-222` 逐欄看, 16 欄。
--
-- 🔴🔴 **而委出去帶了一個一定要在【這裡】擋的坑**:
--   被委那支在**零個有效詞**時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
--   ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓**每一列都被濾掉** ⇒ **整站零商品, 而 HTTP 200、畫面完全正常**。
--   ✅ 所以述詞的第二個條件 `NOT EXISTS (… btrim(pt) <> '')` **不是防禦性程式**, 它是這一格的正確性本身。
--
-- 🔴 **加參數 = 改簽章 ⇒ 只能 DROP + CREATE ⇒ grant 會一起掉。**
--   前例 `20260904160000_m4b_search_catalog_multi_category.sql:393-394`(11 → 12 參數那次),
--   REVOKE PUBLIC + GRANT anon/authenticated/service_role + ACL 非 NULL 斷言, 本檔逐字照抄那三件。
--
-- 🛑 **本體逐字搬自 `20260906910000_m4b_catalog_rpc_expose_external_id.sql:109-444`(現行最後一代)。**
--   🔬 **產生方式是機械的, 不是手抄**:`sed -n '109,444p'` 取出 → 只在**四個點**插入 →
--     `diff` 回核 **刪 1 行(舊簽章)/ 加 70 行**, 其餘一個位元組沒動。
--     四個插入點 = ①新簽章 ②`c_ws` 空白字集常數(DECLARE)③④兩份查詢各一段關鍵字述詞。
--   🔴🔴 **⛔ ~~原本這裡寫「三處插入 / 加 29 行」~~ —— 那是【第一版】的數字, 而我改了三輪沒有跟著改。**
--     🎯 **抓到它的不是任何一輪審查, 是我自己去驗另一件事的時候順手重算的。**
--     📌 **一個寫在權威位置的數字, 只要它不會自己重算, 就會安靜地過期** ——
--       而讀的人拿它去核對時, 得到的是「對不上」而不是「這句過期了」。
--     ✅ **修法不是更小心**:`scripts/20260909010000-verify.sh` 現在有一格
--       **當場重算這兩個數字並與本行比對** ⇒ 它再過期就會紅。
--   🔴 **為什麼要講這個**:同一支函式 2026-09-06 才發生過「抄錯來源代 ⇒ 回退別人的修法, 而 `CREATE OR REPLACE`
--     成功、不會紅」(見 `20260906910000` 檔頭)。⇒ 事後閘⑤⑥ 就是釘那件事的。
--
-- ── 🔴 它答不出什麼(先講, 不要被讀成已驗)────────────────────────────────
--   · 🔴🔴 **效能【沒有量】** —— 我沒有正式庫存取。子查詢是**非相關**的(不引用 `p`)
--     ⇒ planner 理應算一次(InitPlan / hashed SubPlan), 而**那是推的不是量的**。
--     ⇒ 貼板前後要有人各跑一發 `EXPLAIN (ANALYZE)`, 尤其是「關鍵字 + 分類」同時給的那種呼叫。
--   · 🔴🔴 **[codex R3 must-fix] 只有【一般價】那支長出 `p_terms`, 經銷那支沒有。**
--     🔬 `20260908010000_m4b_q74_dealer_catalog_rpc.sql:86` 的 `search_catalog_by_vehicle_dealer`
--       是 **12 參數, 逐字沒有 `p_terms`**(`-24` 窗開檔複驗, 第二個獨立讀數)。
--     🔬 而 `apps/storefront/src/lib/products.ts:500-514` 的 `callCatalogRpc`
--       **兩支 RPC 共用同一組參數物件**(`client.rpc(rpcName, {…})`)。
--     ⇒ 🛑 **前端那一半一往那個物件加 `p_terms`, 經銷會員就拿 `PGRST202`**;
--       而**經銷客人今天 0 人 ⇒ 不會有人叫, 也不會有人紅**。
--     ✅ **貼本檔【不會】觸發它** —— 今天沒有任何一處送 `p_terms`, 那個物件一個字沒變。
--       ⇒ 📌 前置條件是「**前端那一半上線之前**」, 不是「本檔貼之前」。
--   · 🔴🔴 **[codex R3 must-fix] facet 的件數與清單會分岔。**
--     `apps/storefront/src/lib/vehicle-facet-counts.ts` 打的是**同一支 RPC** 而它不送 `p_terms`
--     ⇒ 前端那一半接上之後, 畫面可能寫「此分類 20 件」而點下去只剩 1 件。
--     ⇒ **那一半必須與清單同批改**, 已寫進 plan 的前置條件。
--   · **本檔只做 DB 那一半** —— 前端仍然會在點 facet 時刪掉 `search`,
--     所以**貼完客人看到的行為一個字都不會變**。那一半是另一片(要 plan + Sean)。
--   · 🔴🔴 **[codex R1 must-fix ①]** 我把 helper 當成【過濾器】用(`IN (SELECT …)`)
--     ⇒ 📌 **它的排序被丟掉了** —— 而 helper 的 `ORDER BY` 正是 Sean 2026-09-06 拍的
--       「**完全命中的排最前**」(⟦search-VARIANTSKUFIRST⟧)。
--     🔬 codex 給的反例:同分類裡完全命中那件賣 5,000、部分命中那件賣 9,000
--       ⇒ 本函式的 `recommend` 排序讓後者先出現;`p_limit=1` 時完全命中**根本不在那一頁**。
--     🛑 **本檔【刻意不修它】, 而理由不是難** —— 修它等於改一個 **Sean 拍過板的行為**,
--       ⇒ 那是他的題不是我的。題目已經寫成他可以一個字回完的形狀:
--       `~/pcm-mailbox/plan-front-搜尋與篩選不再互斥-20260909.md` 的 Q(甲=先合併後修 / 乙=一起做完才上)。
--     🔵 **今天貼下去不會讓【我們的 UI】上的任何人變糟**:前端沒有一處送 `p_terms`。
--     🔴 **[codex R2 nit 訂正]** ⛔ ~~所以「這條路走不到」~~ —— **那句話太滿了**:
--       本檔把新簽章 `GRANT EXECUTE … TO anon` ⇒ 📌 **任何人都可以直接打那支 RPC 帶 `p_terms`**,
--       而那一發當場就吃得到已知的排序退化。**沒有任何執行期的閘在等 Sean 拍板。**
--       ⇒ ✅ 正確的說法是:**經由我們自己的畫面走不到;直接打 API 走得到。**
--       ⇒ 而那個風險我判**可接受**(公開型錄、唯讀、退化只是名次), 但它不該被寫成「走不到」。
--   · ⛔ ~~**兩份查詢裡「帶車款」那一份我沒有真的跑過**(要種 fitments)~~
--     🟢 **作廢(codex R1 MF④ 修完)**:`scripts/20260909010000-verify.sh` 現在種了 fitments,
--       有五格走 `p_brand`(其中「車款+關鍵字 ⇒ 2」與「車款+分類+關鍵字 ⇒ 1」**只有那條路真的走到才會對**)。
--     🔴 **舊字面留刪除線而不刪**(codex R3 nit):只讀第一行的人會去重做一件已經做完的事,
--       所以**作廢那一行要跟原句貼在一起**, 不能只寫在別的地方。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src  text;
  v_n    integer;
  v_role text;
  v_lit  text;
  v_md5  text;
  v_args text;
  r      record;
BEGIN
  -- ① 被委的那支必須在 —— 它不在的話, 本函式貼完會在**執行期**炸, 而貼板當下全綠。
  IF pg_catalog.to_regprocedure('public.storefront_search_product_ids(text[])') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.storefront_search_product_ids(text[]) 不在 ⇒ 本檔委給它的那一格會在執行期炸 ⇒ 停。';
  END IF;

  -- ② 12 參數那支必須在(= 我抄的那一代還在庫上)
  IF pg_catalog.to_regprocedure(
       'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)'
     ) IS NULL THEN
    RAISE EXCEPTION '前置閘②:12 參數那支 search_catalog_by_vehicle 不在 ⇒ 我抄的來源與庫上不同 ⇒ 停。';
  END IF;

  -- ①d 🔴🔴 **[codex R3 must-fix]** 委出去 = **一個沒有版本的執行期相依**:
  --   helper 之後任何同簽章的改動都會**立刻改變目錄結果**, 而本 RPC、測試、migration **全都不會紅**。
  --   ✅ 所以把 helper 的本體也釘住 —— 至少「我貼的那一刻, 它是我推理過的那一版」。
  --   🔬 期望值 `8ca57ae35b3c31e5f875919d9abf5061`(len 7955)= repo `20260906950000` 那一代。
  --   🟢 **而這個值有【正式庫的獨立讀數】背書**:板列 `⟦search-VARIANTSKUFIRST⟧` 逐字記著
  --     「62 已貼 … 貼後 `prosrc md5` = **8ca57ae35b3c31e5f875919d9abf5061** len **7955**」
  --     ⇒ 📌 **那不是我自己算完自己驗** —— 別人在正式庫上量到同一個數。
  --   🛑 **而這道閘【不能】阻止 helper 在我貼完之後被改** —— 它只證貼板當下。
  --     真正的修法是把「命中集合 + 排名」收成一個有版本的契約, 而那不在本片射程(已寫進 plan)。
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF v_md5 IS DISTINCT FROM '8ca57ae35b3c31e5f875919d9abf5061' THEN
    RAISE EXCEPTION E'前置閘①d:helper storefront_search_product_ids 的 md5(prosrc) = %\n'
      '  期望 8ca57ae35b3c31e5f875919d9abf5061(= repo 20260906950000 那一代, len 7955)\n'
      '  🔴 它被改過 ⇒ 我這一片的關鍵字語意跟著變了, 而我推理與驗證用的是舊那版 ⇒ 停。\n'
      '  🔑 下一步:bash scripts/latest-definition-of.sh storefront_search_product_ids ⇒ 看 repo 最後一代是哪一支,\n'
      '     若 repo 已經有更新的一代 ⇒ 本片要重跑 scripts/20260909010000-verify.sh 再更新這個期望值。', v_md5;
  END IF;

  -- ②b 🔵 **11 參數那支也要在** —— 本片不動它, 而它不在表示這個庫與正式庫不同,
  --   那時上面那些指紋比對的結論就沒有意義了(`20260811040000:266` 建的, 從來沒被 DROP)。
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '前置閘②b:11 參數那支不在 ⇒ 這個庫與正式庫的多載組成不同 ⇒ 停。';
  END IF;

  -- ③ 13 參數那支【還不能】在 —— 在的話表示本檔貼過, 或有人先建了同名多載。
  IF pg_catalog.to_regprocedure(
       'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:13 參數那支已經存在 ⇒ 本檔貼過, 或有人先建了同名多載 ⇒ 停(不要盲目重貼)。';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';

  -- 🔴 **數之前先剝註解** —— 只數字面的話, 把那一行加上 `--` 兩格照樣數到 2
  --    (同型的坑 `20260906910000` 的 codex must-fix #4 記過)。
  v_src := regexp_replace(regexp_replace(v_src, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');

  -- ①b 🔴🔴 **[codex R1 must-fix ⑤]** 被委那支的【授權】也要驗, 不是只驗它存在。
  --   本函式是 SECURITY INVOKER ⇒ 客人以 `anon` 進來, 呼叫鏈會**以 anon 的身分**去叫 helper
  --   ⇒ 📌 helper 在而 anon 沒有 EXECUTE ⇒ **只有帶關鍵字那一發** 42501,
  --     而不帶關鍵字的型錄頁完全正常 ⇒ **貼板當下、三綠、行為 harness 全部不會紅**
  --     (harness 是以 `postgres` 跑的, 它問不到這一格)。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT has_function_privilege(v_role, 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
      RAISE EXCEPTION '前置閘①b:% 對 storefront_search_product_ids 沒有 EXECUTE ⇒ 帶關鍵字那一發會 42501 ⇒ 停。', v_role;
    END IF;
  END LOOP;

  -- ④ 指紋 A:`20260906910000` 那一片的 external_id 兩份都在 ⇒ 庫上就是我抄的那一代
  v_n := (length(v_src) - length(replace(v_src, '''external_id'', pe.external_id', '')))
         / length('''external_id'', pe.external_id');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '前置閘④:庫上那支剝註解後 external_id 有 % 份(期望 2)⇒ 它不是 20260906910000 那一代 ⇒ 我抄的來源不對 ⇒ 停。', v_n;
  END IF;

  -- ⑤ 指紋 B:`20260904260000` 拿掉的那 12 處排序條件必須是 0 處
  v_n := (length(v_src) - length(replace(v_src, 'p_sort = ''recommend'' AND cardinality(v_cats) = 0', '')))
         / length('p_sort = ''recommend'' AND cardinality(v_cats) = 0');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘⑤:庫上那支還有 % 處舊排序條件 ⇒ 它比 20260904260000 舊 ⇒ 停。', v_n;
  END IF;

  -- ⑤b 🔴🔴 **[codex R1 must-fix ③]** 兩個字串指紋【證不到】庫上就是我抄的那一份。
  --   codex 給的反例是具體的:庫上若有人把批次日門檻從 100 改成 200,
  --   前置閘④⑤ 與事後閘全部照樣通過, 而**本片會安靜地把它蓋回 100**
  --   ⇒ 📌 那正是 `20260906910000` 檔頭記的那個坑(抄錯來源代 ⇒ 回退別人的修法, 而不會紅)。
  --   ✅ **所以把【我這一份帶著的每一個承重常數】逐個拿去跟庫上比** —— 不一致就停。
  --   🛑 **而這【仍然不是】全本體比對**:我沒有正式庫存取, 算不出期望的 `md5(prosrc)`
  --     ⇒ **常數以外的差異這道閘看不到。** 貼的人要另外跑一次全本體 md5 對照。
  FOREACH v_lit IN ARRAY ARRAY[
    'c_batch_day_threshold constant int := 100;',
    'c_new_arrivals_excluded_category constant text := ''維修零件'';',
    'c_recommend_band_lo constant int := 4000;',
    'c_recommend_band_hi constant int := 13800;'
  ] LOOP
    IF position(v_lit in v_src) = 0 THEN
      RAISE EXCEPTION '前置閘⑤b:庫上那支找不到承重常數「%」⇒ 有人改過它, 而我這一份會把它蓋掉 ⇒ 停。', v_lit;
    END IF;
  END LOOP;

  -- ⑤c 🔴🔴 **[codex R2 must-fix]** 上面那四個常數**仍然只是抽樣** ——
  --   庫上若改過車款年份條件 / `product_fitments_effective` 的合流 / 新品時間邊界,
  --   四個常數與兩個指紋**全部不變**, 而我這一份會整支蓋過去。
  --   ✅ **codex 指出期望的本體雜湊【可以從 repo 算, 不需要正式庫存取】** —— 它對:
  --     `prosrc` 就是 `20260906910000` 那支 `AS $function$` 與收尾標記之間的那段字, 一個位元組不差。
  --   🔬 本機實算(可重跑, 見 `scripts/20260909010000-verify.sh` 的 md5 那一格):
  --     `md5(prosrc) = 336beaff1188c7670e85134db5aa623b`(長度 17,207)
  --   🛑 **對不上要停, 不要「應該只是空白差異」就放行** —— 那正是這支函式 09-06 踩過的那個坑。
  -- 🔴🔴 **而這道閘的兩種壞法【不對稱】, 所以訊息要教人怎麼往下走**(主視窗 2026-09-09 指示):
  --   · 太鬆 ⇒ 貼到一支被人動過的函式上 ⇒ **真的出事**。
  --   · 太緊 ⇒ **貼板被擋**, 而擋下來的那一刻多半是深夜、貼的人看不懂 md5
  --     ⇒ 📌 它的代價不是「多跑一次」, 是**一個沒有人能當場判斷的紅**。
  --   ⇒ ✅ 所以下面那句 RAISE **必須自己帶出路** —— 一道紅了而不說下一步的閘,
  --     等於把問題丟給現場最沒有上下文的那個人。
  -- 🛑🛑 **md5(prosrc) 看不到的東西, 要講出來**(memory `reference_create-or-replace-resets-set-clause`):
  --   `prosrc` **只有函式本體**, **不含** `SET search_path` / volatility / SECURITY DEFINER
  --   ⇒ 📌 有人把 `search_path` 強化拿掉, 而 **body md5 一模一樣、這道閘照樣綠**。
  --   ✅ 那一面由**前置閘⑥ 與事後閘⑦**(屬性逐欄比)接手 —— **兩道閘合起來才是一張網, 各自都有洞。**
  -- 🔴 **[codex R3 must-fix]** 先剝 `\r` 再算 —— 貼入管道把行尾正規化成 CRLF 時,
  --   語意完全相同的函式會被這道閘擋下 ⇒ 📌 **安全被換成不可部署**。
  --   🔵 repo 那份實測 `\r` 出現 **0** 次 ⇒ 剝掉不改變期望值(仍是 336beaff…)。
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF v_md5 IS DISTINCT FROM '336beaff1188c7670e85134db5aa623b' THEN
    RAISE EXCEPTION E'前置閘⑤c:庫上那支的 md5(prosrc) = %\n'
      '  期望 336beaff1188c7670e85134db5aa623b(= repo 的 20260906910000:109-444 那一代, 長度 17,207)\n'
      '  🔴 撞到我 = 兩種可能, 而它們的下一步【完全不同】:\n'
      '    ① 有人動過線上那支 ⇒ 我這一份會把他的改動整支蓋掉 ⇒ 絕對不要繞過本閘。\n'
      '    ② 我這把尺過期了(線上那支是從別處貼的 / 空白或行尾差異)⇒ 要更新期望值, 不是放行。\n'
      '  🔑 怎麼分辨(唯讀, 兩步):\n'
      '    (a) python3 scripts/prod-vs-vc-functions.py ⇒ 問「正式庫跑的是不是版控這一版」\n'
      '    (b) bash scripts/latest-definition-of.sh search_catalog_by_vehicle ⇒ 看 repo 最後一代是不是仍是 20260906910000\n'
      '  🛑 兩步都做完之前不要重貼, 也不要自己改本檔的期望值 ⇒ 回報。', v_md5;
  END IF;

  -- ①c 🔴🔴 **[codex R2 must-fix]** helper 有 EXECUTE **不等於**叫得動它 ——
  --   函式的 EXECUTE **不涵蓋**它讀的那三張表的 SELECT。少了任何一張,
  --   ⇒ 📌 只有**帶關鍵字**那一發 42501, 而型錄頁完全正常 ⇒ 貼板全綠。
  --   🛑 **而這一格證不到 RLS** —— 表權限在而 policy 藏掉一部分列, 這裡照樣綠。
  --     那要以 `anon` 真的跑一次才問得出來, **本檔沒做**。
  FOREACH v_lit IN ARRAY ARRAY['public.products_public','public.product_variants_public','public.brands'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF NOT has_table_privilege(v_role, v_lit, 'SELECT') THEN
        RAISE EXCEPTION '前置閘①c:% 對 % 沒有 SELECT ⇒ helper 叫得動而讀不到 ⇒ 帶關鍵字那一發會 42501 ⇒ 停。', v_role, v_lit;
      END IF;
    END LOOP;
  END LOOP;

  -- ⑤d 🔴🔴 **[codex R4 must-fix]** `md5(prosrc)` **看不到參數的預設值** ——
  --   預設值住在 `pg_proc.proargdefaults`, 不在 `prosrc` 裡。
  --   🔬 codex 給的反例很具體:有人把 `p_limit DEFAULT 25` 改成 `50`
  --     ⇒ 📌 **本體 md5 一模一樣、屬性閘一模一樣、⑤b 的四個常數一模一樣** ⇒ 我全部通過
  --     ⇒ 而我這一份會把它**改回 25**, 而且 108r 還原時也會再改回一次, **兩次都印成功**。
  --   ✅ 所以把**帶行為的那三個預設值**也比一次。
  --   🛑 **這仍不是全部** —— 我只比這三個, 其餘參數的預設值改了本閘看不到。
  --     完整那一份要靠 108b 貼前那一發的 `pg_get_function_arguments` 快照。
  SELECT pg_get_function_arguments(p.oid) INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  FOREACH v_lit IN ARRAY ARRAY[
    'p_offset integer DEFAULT 0',
    'p_limit integer DEFAULT 25',
    'p_sort text DEFAULT ''recommend''::text'
  ] LOOP
    IF position(v_lit in v_args) = 0 THEN
      RAISE EXCEPTION E'前置閘⑤d:庫上那支的參數列裡找不到「%」\n'
        '  實際的參數列 = %\n'
        '  🔴 有人改過預設值, 而 md5(prosrc) 與屬性閘【都看不到這一層】\n'
        '  ⇒ 我這一份會把它改回去, 而且不會有任何一格紅 ⇒ 停。', v_lit, v_args;
    END IF;
  END LOOP;

  -- ⑥ 屬性逐欄(與事後閘同一組 —— 兩邊要用同一把尺)
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows, p.proleakproof,
         p.proisstrict, p.prosecdef, array_to_string(p.proconfig, '|') AS cfg,
         p.prosupport::text AS support
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.proleakproof OR r.proisstrict OR r.prosecdef
     OR r.cfg IS DISTINCT FROM 'search_path=public, pg_temp'
     OR r.support <> '-' THEN
    RAISE EXCEPTION '前置閘⑥:函式屬性與 2026-09-06 實測不符(volatile=% parallel=% cost=% rows=% leakproof=% strict=% secdef=% cfg=% support=%)⇒ 有人動過它 ⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.proleakproof, r.proisstrict, r.prosecdef, r.cfg, r.support;
  END IF;
END
$pre$;

-- ── DROP 舊簽章 ───────────────────────────────────────────────────────────
-- 🔴 不帶 IF EXISTS:前置閘②已經證明它在。簽章漂移要在這裡整支失敗, 不要靜默生出多載。
DROP FUNCTION public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz);

-- ── 本體 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[])
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- 供應商批次門檻 N（Sean 2026-08-11 Q15=C 定 500 起手、明文委任 S 窗可調 → 本檔落 100）。
  -- 判準是「單一台灣日新增**達到** N 件」（>=，不是 >）；正當性與殘留風險見檔頭。
  -- 🔴 改這個數字要開**新的 migration** 重貼整支函式 —— 本檔一旦 apply 就不該再編輯，
  --    改舊檔 `db push` 不會重跑、正式庫的門檻不會變(codex R3)。
  -- 🔴 而且改 N ＝ 檔頭那組突變證據作廢，必須用 `scripts/269b-evidence.sql` §2b 重找切點重量。
  -- 單一定義點：下面兩個分支都讀這一個，不得各寫一個數字。
  c_batch_day_threshold constant int := 100;
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
  -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ **「空白」的字集 —— 顯式列舉**(codex R1 nit + R2 nit)
  --   ⛔ ~~`btrim(pt)` 預設~~ 只剝 ASCII 空格;⛔ ~~`pt ~ '[^[:space:]]'`~~ **依 locale**
  --     (我自己的 harness 在 `--locale=C` 下抓到它對全形空格失效)。
  --   ⇒ 📌 兩個都不行, 而它們**在正式庫與拋棄式庫會給不同答案, 且兩邊都不報錯**。
  c_ws constant text := E' \t\n\r\x0B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF';
BEGIN
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH new_batch_days AS (
      -- 只在 p_new_since 有值時才會被執行（見 filtered 的 OR 短路）。
      -- 下界 = p_new_since 所在台灣日的 00:00（不是 p_new_since 本身）：整日量才判得準。
      SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
      FROM public.products_list_public pb
      WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
        -- 未來時戳不得參與批次日計數（codex R2）：那種列自己不會被回傳（filtered 有 <= now()），
        -- 但若同一天累積到 N，會把當天**真正的**新品整天一起誤殺。
        AND pb.created_at <= now()
      GROUP BY 1
      HAVING count(*) >= c_batch_day_threshold
    ), filtered AS (
      SELECT p.*
      FROM public.products_list_public p
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- 只夾窗、不夾 new_batch_days：批次日要用「整日實際有幾列」判斷。
              AND p.created_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM new_batch_days nbd
                WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
              )
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
        -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
        --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
        --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
        --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
        --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
        --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
        -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
        --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
        --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
        --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
        --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
        AND (p_terms IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
             OR p.id IN (SELECT k.id FROM public.storefront_search_product_ids(
                  (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k))
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
        --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
        --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
        'external_id', pe.external_id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
    -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
    --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
    --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH new_batch_days AS (
    SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
    FROM public.products_list_public pb
    WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
      AND pb.created_at <= now()                       -- 同上：未來時戳不參與批次日計數
    GROUP BY 1
    HAVING count(*) >= c_batch_day_threshold
  ), matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), filtered AS (
    SELECT p.*
    FROM public.products_list_public p
    JOIN matched m ON m.product_id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM new_batch_days nbd
              WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
            )
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
      -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
      --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
      --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
      --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
      --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
      --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
      -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
      --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
      --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
      --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
      --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
      AND (p_terms IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
           OR p.id IN (SELECT k.id FROM public.storefront_search_product_ids(
                (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k))
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
      --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
      --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
      'external_id', pe.external_id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
  -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
  --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
  --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;   -- 🔴 `pg_get_functiondef` 的輸出【沒有這個分號】—— 少了它, 下一個 DO 區塊會被當成同一句

-- ── 權限:DROP 會連 grant 一起掉 ⇒ 下面這兩行不是冗餘, 由檔尾斷言釘住 ──────────
-- 🔴 授權集合逐字照 `20260904160000:394` —— **三個角色, 不要少給 `service_role`**
--    (那一片的 codex must-fix ③ 就是抓到少給一個角色, 而收緊在行為上不會立刻叫)。
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle -- 型錄 RPC 加 p_terms 新簽章, 授權集合與前一代 20260904160000:394 逐字相同 anon/authenticated/service_role(板列 db-SEARCHFACETMUTEX)
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text[], text, text, int, int, int, text, text, text[], int, int, timestamptz, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text[], text, text, int, int, int, text, text, text[], int, int, timestamptz, text[]) TO anon, authenticated, service_role;

-- ── 新物件收權斷言(`migration-static-checks.sh` 規則③)────────────────────
DO $newobj_guard$
DECLARE
  v_functions text[] := ARRAY[
    'public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])'
  ]::text[];
  v_fn text;
  v_acl aclitem[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure;
    -- 🔴 **ACL 欄是 NULL 時 PUBLIC 看不見**, 而那正是「沒有明寫收權」的形狀
    --    ⇒ 本檔明寫了 REVOKE + GRANT ⇒ 這裡必須非 NULL。
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:% 的 ACL 是 NULL ⇒ REVOKE/GRANT 那兩行沒生效', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(v_acl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION '收權斷言失敗:% 還有 PUBLIC 的授權', v_fn;
    END IF;
    -- 🔴 **正對照:三個角色【要真的在】** —— 只驗「PUBLIC 不在」的話,
    --    一支【誰都叫不動】的函式也會通過, 而症狀是客人打型錄 42501。
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_acl) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'anon' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 anon 沒有 EXECUTE ⇒ 客人打型錄會 42501', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_acl) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'authenticated' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 authenticated 沒有 EXECUTE', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_acl) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'service_role' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 service_role 沒有 EXECUTE ⇒ 我把授權集合安靜收緊了', v_fn;
    END IF;
  END LOOP;
END
$newobj_guard$;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
  v_n   integer;
  r     record;
BEGIN
  -- ①🔴🔴 **[codex R3 must-fix]** ⛔ ~~斷言「只剩一支多載」~~ —— **那句會讓整筆貼板 rollback**。
  --   🔬 實查(可重跑):`git grep -l 'DROP FUNCTION public.search_catalog_by_vehicle' supabase/migrations/`
  --     ⇒ **只有兩支**:`20260811040000`(它 DROP 的是 **10** 參數那支)與本檔。
  --     ⇒ 📌 **11 參數那支從來沒有被 DROP 過** —— `20260904160000:27` 自己逐字寫著
  --       「C 另一支 migration DROP 舊簽章」= **那一步是未來式**(板列 `⟦search-DROPOLDCATSIG⟧`)。
  --   ⇒ 🛑 **所以正式庫上是 11 參 + 12 參【兩支】;本片貼完會是 11 參 + 13 參, 仍然是 2**
  --     ⇒ 舊的斷言必在**檔尾**拋錯 ⇒ **整筆 rollback**, 而前面每一步看起來都成功了。
  --   🔴 **而我的 harness 沒有抓到它**:第二階段只造了 12 參數那支正線, **沒造 11 參數**
  --     ⇒ 📌 **28 格全綠, 而那個綠的世界比正式庫少一支函式。**(已補, 見 verify.sh 第二階段)
  --   ✅ 改成問**三件具體的事**, 不問總數:
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①a:12 參數那支還在 ⇒ 我的 DROP 沒生效 ⇒ 停。';
  END IF;
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])') IS NULL THEN
    RAISE EXCEPTION '事後閘①b:13 參數那支不在 ⇒ CREATE 沒生效 ⇒ 停。';
  END IF;
  -- ①c 🔵 **11 參數那支本片【不動它】** —— 它必須原封不動還在。
  --   不在 ⇒ 我 DROP 錯簽章了, 而那會打掉一條**還有人可能在用**的舊路。
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '事後閘①c:11 參數那支不見了 ⇒ 我 DROP 錯簽章 ⇒ 停(本片不該碰它)。';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  RAISE NOTICE '事後閘①:search_catalog_by_vehicle 現在有 % 支多載(11 參 + 13 參 = 2 是預期的;這一行只報數, 不擋)。', v_n;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘②:建完之後找不到它 ⇒ 停。';
  END IF;


  -- 🔴🔴 **[codex R1 must-fix ②]** 上面那把剝註解的尺**剝不掉巢狀區塊註解**
  --   (PostgreSQL 的 `/* … /* … */ … */` 是合法的巢狀, 而 `/\*.*?\*/` 非貪婪只吃到第一個 `*/`)
  --   ⇒ 📌 把整段述詞包進巢狀註解裡, **下面四個計數仍然全部通過, 而搜尋條件已經消失**。
  --   ✅ **修法不是把 regex 寫得更聰明**(那是跟下一個沒想到的形狀賽跑)——
  --     本函式的註解**全部是 `--` 行註解, 一個 `/*` 都沒有**(本檔產生時實測 0)
  --     ⇒ 🎯 **直接要求它是 0**:哪天有人加了區塊註解, 這道閘會紅, 而他必須先想過這件事。
  -- 🔴🔴 **[codex R2 must-fix]** 同一個病的第二個形狀:把述詞搬進 `PERFORM $audit$…$audit$;`
  --   那個字串裡 ⇒ **沒有 `/*`, 四個計數照樣是 2/2/2/0, 而真正的 WHERE 已經沒有它了**。
  --   ✅ 同一招:本函式本體**一個 `$` 都沒有**(產生時實測 0)⇒ 直接要求它是 0。
  --   🛑 **[codex R3 nit] 這兩道禁令的射程要講死:它們只保護【本檔這一次貼板】。**
  --     後續的 migration **不會重跑這個事後閘** ⇒ 📌 它擋不住「未來有人改壞它」,
  --     而它擋得住的是**本檔內**合法的 dollar-quoting 與區塊註解 ⇒ 🔴 **代價是:
  --     哪天真的需要在本函式裡寫 `$$` 或 `/* */`, 維護者最省事的動作是【整段拔掉守門】。**
  --     ⇒ ✅ 撞到的人請改成「把那個閘的期望值改成新的形狀」, **不要拔掉它**。
  --   🛑 **而這一族的天花板要明寫**:任何【數字面】的閘都擋不住「字面在而不生效」的所有形狀
  --     ⇒ 📌 真正回答那個問題的是**行為**(`scripts/20260909010000-verify.sh` 的 22 格與兩發突變),
  --       而這幾道閘回答的是**另一個**問題:「有沒有人動過我貼上去的那份字」。**兩者不可互相取代。**
  IF position('$' in v_src) > 0 THEN
    RAISE EXCEPTION '事後閘②c:函式本體出現 `$` ⇒ 可能有 dollar-quoting 讓下面的計數失去判別力 ⇒ 停(理由見本行上方)。';
  END IF;
  IF position('/*' in v_src) > 0 THEN
    RAISE EXCEPTION '事後閘②b:函式本體出現區塊註解 `/*` ⇒ 下面那把剝註解的尺對【巢狀】區塊註解失效 ⇒ 停(理由見本行上方)。';
  END IF;
  -- 🔴 剝註解再數(與前置閘同一把尺)
  v_src := regexp_replace(regexp_replace(v_src, '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');

  -- ③ 關鍵字述詞兩份都在 —— 本函式有【兩份】查詢, 漏一份 = 帶車款那條路的關鍵字被忽略
  v_n := (length(v_src) - length(replace(v_src, 'public.storefront_search_product_ids(', '')))
         / length('public.storefront_search_product_ids(');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘③:剝註解後關鍵字述詞只有 % 份(期望 2 —— 本函式有兩份查詢)⇒ 有一條路沒改到。', v_n;
  END IF;

  -- ④ 🔴🔴 **零有效詞的守門兩份都在** —— 少了它, 空關鍵字會把商品濾光而 HTTP 200
  v_n := (length(v_src) - length(replace(v_src, 'NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt', '')))
         / length('NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘④:剝註解後「零有效詞」守門只有 % 份(期望 2)⇒ 空關鍵字會把商品濾光, 而畫面完全正常 ⇒ 停。', v_n;
  END IF;

  -- ④b 🔴🔴 **[codex R2 must-fix]**「濾」那一半也要在 —— 只有【擋】沒有【濾】時,
  --   `ARRAY['碳纖維', E'\t']` 會把空白詞一起送出去 ⇒ 一筆都不中 ⇒ 客人拿到 0 件而畫面正常。
  v_n := (length(v_src) - length(replace(v_src, 'array_agg(pt) FROM unnest(p_terms)', '')))
         / length('array_agg(pt) FROM unnest(p_terms)');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘④b:剝註解後「只送有效詞」的 array_agg 只有 % 份(期望 2)⇒ 混了空白詞的呼叫會回零筆 ⇒ 停。', v_n;
  END IF;

  -- ⑤ 別人的修法沒被我蓋掉:external_id 仍是 2 份
  v_n := (length(v_src) - length(replace(v_src, '''external_id'', pe.external_id', '')))
         / length('''external_id'', pe.external_id');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘⑤:external_id 剩 % 份(期望 2)⇒ 我把 20260906910000 的修法蓋掉了 ⇒ 停。', v_n;
  END IF;

  -- ⑥ 別人的修法沒被我蓋掉:那 12 處舊排序條件仍是 0 處
  v_n := (length(v_src) - length(replace(v_src, 'p_sort = ''recommend'' AND cardinality(v_cats) = 0', '')))
         / length('p_sort = ''recommend'' AND cardinality(v_cats) = 0');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘⑥:又出現 % 處舊排序條件 ⇒ 我把 20260904260000 的修法蓋掉了 ⇒ 停。', v_n;
  END IF;

  -- ⑦ 屬性逐欄(與前置閘同一組)
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows, p.proleakproof,
         p.proisstrict, p.prosecdef, array_to_string(p.proconfig, '|') AS cfg,
         p.prosupport::text AS support
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.proleakproof OR r.proisstrict OR r.prosecdef
     OR r.cfg IS DISTINCT FROM 'search_path=public, pg_temp'
     OR r.support <> '-' THEN
    RAISE EXCEPTION '事後閘⑦:新那支的屬性與舊那支不同(volatile=% parallel=% cost=% rows=% leakproof=% strict=% secdef=% cfg=% support=%)⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.proleakproof, r.proisstrict, r.prosecdef, r.cfg, r.support;
  END IF;
END
$post$;

-- ── 🔴🔴 **改了簽章 ⇒ 這一行不能少, 而少了它【顧客站型錄會掛】** ────────────────
--   PostgREST 有自己的 schema cache。12 參數那支被 DROP 了而 cache 還記著它
--   ⇒ 📌 客人打型錄拿到 `PGRST202` / 404, 而**資料庫這一側完全正常、貼板全綠**。
--   🔬 前例逐字:`20260811040000:49` 「改了 view 欄位與函式簽章, **缺此步 Data API 看不到新參數**」;
--     `20260904160000:7` 「貼完之後同一份 SQL 的最後有一行 NOTIFY —— **不要跳過它**」。
-- 🔵 **刻意放在 `COMMIT` 之前**:`NOTIFY` 本來就是提交時才真的送出,
--    而 `migration-static-checks.sh` 規則② 要求 `COMMIT` 是最後一句
--    ⇒ 兩件事沒衝突, 而放進來之後**貼的人不可能漏掉它**(它就在同一份 SQL 裡)。
-- 🛑 **我是怎麼差點漏掉的**:靜態八道、行為十格、三綠**全部都不會為它紅** ——
--    它的症狀只在【真的部署之後】出現, 而那時它長得像「函式沒建起來」。
-- 🔴🔴 **[codex R4 must-fix] 它不是「重載完成」的回條** —— `NOTIFY` 只是把訊息丟進佇列。
--   PostgREST 收到之後可能因為連線池逾時 / 查詢逾時而**沒有重載成功**
--   ⇒ 📌 **資料庫已經是新的, 而 API 那一層還記著舊簽章** ⇒ 客人拿 `PGRST202`。
--   ✅ **貼完要真的開一次** https://shop.pcmmotorsports.com/products
--     🛑 **不要帶 `?search=`** —— 那條路走的是關鍵字那支, **不經過本函式**
--       (`apps/storefront/src/app/products/page.tsx:385` 逐字 `catalogQuery.search ? searchProducts(…) : …`)
--       ⇒ 📌 **型錄 RPC 壞掉時, 帶 search 的那個畫面照樣正常。**
NOTIFY pgrst, 'reload schema';

COMMIT;
