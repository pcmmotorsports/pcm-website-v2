-- 20260916110000_m4b_storefront_search_fold.sql
--
-- 🎯 **前台搜尋:車款代號與變音符號「折成同一個形狀」再比** —— `MT07` = `MT-07` = `MT 07`、`AKRAPOVIČ` = `akrapovic`。
--
-- 📎 plan:`docs/plans/2026-09-15-storefront-search-normalize-plan.md`(鐵則 8;🛑 **Sean 還沒批**, 本檔只寫檔、未 apply)。
--    抽查:`~/pcm-mailbox/搜尋抽查-0915.md`(正式站 20 詞:MT07 30/應 154、S1000RR 172/應 525、AKRAPOVIČ 194/應 670)。
--    版本號由主視窗指定(A 窗 P1 = 20260916100000 先貼, 本檔在它之後)。
--
-- ── 改三樣, 函式簽章與回傳型別不變 ─────────────────────────────────────────────
--   ① 新函式 `public.pcm_search_fold(text)` IMMUTABLE:去空白 / 點 / 底線 / 斜線 / `·` / 連字號、轉小寫、
--      `translate` 把 Č→C、Ö→O…(字表寫死在函式裡)。🔴 **不剝中文**:`排氣管` 折完還是 `排氣管`。
--      🔵 用 `translate` 不用 `unaccent`:後者 STABLE 不能進索引運算式, 且正式庫沒裝(2026-09-15 唯讀:可裝未裝)。
--   ② 新索引 `products_search_fold_trgm_idx`:GIN trigram on `pcm_search_fold(title || ' ' || subtitle)`。
--   ③ `storefront_search_product_ids` 本體加兩件(其餘逐字抄 `20260911150000`):
--      ⑤ 折疊分支 —— 含英文或數字的詞, 折疊後比 title+subtitle 與品牌名;
--      ⑥ 整串優先 —— 兩詞以上、全是英數符號、沒有 4 個以上連續英文字母、含數字(車款代號碎片)⇒
--         逐詞 AND 照舊算, 其中有商品在 title/subtitle/description/external_id(折疊後)含整串 ⇒ 只留那些。
--   ⚠️ 限制(寫明):折完不足 4 碼的詞不走折疊(`R1` 照字面比);translate 字表只涵蓋西歐常見字母,
--      NFD 組合字元、ß、ą ę ś ż、ő 不會被折;行為驗證在 locale C 的拋棄式 PG 做, 正式庫 en_US.UTF-8
--      只由事後閘 ⑤b 那幾格 ASCII / Č / Ö 驗到。
--
-- ── 速度(plan §2)─────────────────────────────────────────────────────────────
--   正式庫唯讀 EXPLAIN:現行 9–116 ms;折疊版【沒有索引】每詞 +約 470 ms(26,491 列全掃)⇒ 索引是必要的, 不是選配。
--   拋棄式 PG 假資料:有索引 7–10 ms / 詞。貼完之後在正式庫唯讀重量同 5 詞。
--
-- ── 🔴 建索引的鎖(CONCURRENTLY 的判斷)──────────────────────────────────────────
--   **不用 `CREATE INDEX CONCURRENTLY`**:它不能在交易區塊裡, 而貼板每一支都是 BEGIN…COMMIT
--   (`scripts/apply-paste-board.sh` 檔頭:213/335 支自帶交易、零支中途 COMMIT;改形狀要動貼板路徑)。
--   先例:`20260907120000_m4b_search_partno_index_only.sql`(主視窗 2026-09-07 裁乙, 同一張 products 表)。
--   ⚠️ **代價**:建索引期間 `public.products` 的【寫入】被擋(SHARE 鎖;讀不受影響, 客人瀏覽 / 搜尋照常)。
--   ⏱️ 建置時間:拋棄式 PG 26,491 列假資料(title+subtitle 長度與正式庫同級)、用真的 pcm_search_fold 建同一支索引 ⇒ **380 ms**、
--      索引 2.3 MB。正式庫 products 26,491 列(heap 64 MB 多半是 description, 本索引不讀它)。
--      🔴 SHARE 鎖要到 COMMIT 才放 ⇒ 擋寫入的時間 = 建索引 + 其後的函式替換與事後閘(④a/b/c 各一次全表 regexp 掃 + 三次搜尋)
--      ⇒ 預估 **約 1–3 秒**(R1 nit 更正:原寫 0.5–1.5 秒只算了建索引;吻合但未證實, 貼完看 apply 回報的耗時)。
--   🛑 `lock_timeout = 5s`:拿不到鎖(有長交易在寫 products)⇒ 整包放棄、什麼都沒改, 換時段重貼。
--   🛑 貼板時段:客人少的時候, 並避開供應商同步(每天約 09:31–09:53 UTC, A 窗量)。
--
-- ── 權限 ─────────────────────────────────────────────────────────────────────
--   · `pcm_search_fold`:REVOKE PUBLIC + anon/authenticated, GRANT EXECUTE service_role
--     (正式庫 2026-09-15 唯讀:對 products 有 INSERT/UPDATE 的只有 postgres / service_role / supabase_admin ——
--      索引運算式在寫入時要能執行它;客人那條路由 DEFINER 函式以 postgres 身分呼叫, 不需要給 anon)。
--   · `storefront_search_product_ids`:名單不變(anon / authenticated / service_role), 照 `20260911150000` 重下一次。
--
-- ── 回滾 ─────────────────────────────────────────────────────────────────────
--   `supabase/rollbacks/20260916110000-rollback.sql`:函式本體逐字還原 `20260911150000`(事後閘驗 md5),
--   再 DROP 索引、DROP `pcm_search_fold`。前台 TS 零改動, 回滾不用重部署。
--
-- ── 驗證(拋棄式 PG `schema-dump-20260915/up.sh`, 零正式庫資料;R2 F1 修正後 2026-09-16 在 s110c 重跑)──────────
--   順序:dump → 板 178–190(187 前置閘五紅 = 已知:空庫沒有 cron.job pcm-acl-digest)→ 種 16 件假商品 → A 窗 20260916100000 → 本檔。
--   dump 裡的函式 md5 = 892b6c6e2d47acd550e57aad7eaeb88a(= 正式庫)⇒ 前置閘①過;套完本檔後本體 md5 = ba579fb932a3a8a72946600292405e08
--   (= 回滾檔前置閘② 與本檔事後閘 ①d 釘的值)。
--   同 27 個詞在本檔前 / 後 / 回滾後各跑一次(以 postgres 呼叫函式):
--   ```
--   詞               前                     後
--   AKRAPOVIČ        0                      3(= akrapovic)
--   MT07             1                      3(= MT-07;副標寫 MT-07 的兩件 + 副標寫 MT07 的那件)
--   MT-07            2                      3(副標寫 MT07 的那件也中)
--   S1000RR          1(描述寫 S1000RR)      2(+ 副標寫 S 1000 RR 的那件)
--   S 1000 RR        3(含誘餌)              2(誘餌「BMW S 1000 R · 1000 系列 RR」出局;只在描述寫 S1000RR 的那件【留著】)
--   R1250GS          0                      1
--   Öhlins           1                      2(Ohlins 那件也中)
--   Akrapovic MT-07  1                      2(不走整串優先;副標寫 MT07 的那件也中)
--   Yamaha MT-07     2                      3(同上)
--   其餘 18 詞逐列相同:排氣管 / Akrapovic 排氣管 / 碳纖維 防倒球 / 單一個 `-` / `R1`(不會中 R 1250 GS、GSX-R 1000)/ `1.25` / `Q 7700QQ` …;
--   下架那件 MT-07 前後都不出現。
--   ```
--   · 🔴 R2 F1 反例(種兩件:「Q 系列 7700QQ 貼紙」逐詞全中而不含整串;「通用配件」只中 `Q` 而描述寫「Q 7700 QQ」):
--     查 `Q 7700QQ` ⇒ 本檔前 1 件 · R1 修正版 **0 件**(反例重現)· 本檔 1 件(Q 系列 7700QQ 貼紙)⇒ 修好。
--   · EXPLAIN:折疊運算式走 `Bitmap Index Scan on products_search_fold_trgm_idx`。
--   · 角色:SET ROLE anon 呼叫搜尋 OK(MT07 = 3)、直接呼叫 pcm_search_fold ⇒ permission denied;
--     SET ROLE service_role INSERT products ⇒ OK(索引運算式寫入時跑得動)。
--   · 回滾檔跑完:md5 回到 892b6c6e…、索引與 pcm_search_fold 都不在、27 詞與「前」逐列相同;回滾後再套本檔 rc=0、結果同第一次。
--   · 正式庫唯讀 EXPLAIN ANALYZE(2026-09-16, statement_timeout 10s;新版以內聯折疊運算式模擬, 正式庫還【沒有】折疊索引):
--     ```
--     詞          現行函式    新版(模擬, 無折疊索引)   新版件數
--     排氣管       19.1 ms     20.2 ms                    1032(同現行)
--     MT07        133.1 ms    646.0 ms                   154(現行 30)⇐ 無索引全掃;貼上後有索引, 要重量
--     S 1000 RR   1148.0 ms   1400.0 ms                  549(現行 872)⇐ 現行就已 >1s(S / RR 短詞);整串收窄多 ~250 ms
--     ```
--   · 審查:adversarial-reviewer(opus)R1 FAIL 3 必修已修;R2 FAIL 1 必修(F1)已修 ⇒ 依規矩不跑 R3, 端 Sean;缺 codex 那一路(額度到 09-20)。
--
-- 🛑 本檔由施工窗產出、**未 apply**。貼正式庫由主視窗編號、Sean 點名。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src text;
  v_def boolean;
BEGIN
  IF to_regprocedure('public.storefront_search_product_ids(text[])') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.storefront_search_product_ids(text[]) 不存在 ⇒ 停';
  END IF;
  SELECT p.prosrc, p.prosecdef INTO v_src, v_def
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure;
  -- ① 基底必須是 20260911150000 那一版(正式庫 2026-09-15 唯讀讀到的 md5)
  IF md5(v_src) <> '892b6c6e2d47acd550e57aad7eaeb88a' THEN
    RAISE EXCEPTION '前置閘①:正式庫的函式本體 md5 = % , 不是本檔抄的那一版(20260911150000)⇒ 有人改過它 ⇒ 停', md5(v_src);
  END IF;
  -- ② 它是 DEFINER(20260911150000 的形狀;不是的話基底不對)
  IF NOT v_def THEN
    RAISE EXCEPTION '前置閘②:它不是 SECURITY DEFINER ⇒ 基底不是 20260911150000 ⇒ 停';
  END IF;
  -- ③ 新物件名還沒被佔用
  IF to_regprocedure('public.pcm_search_fold(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③a:public.pcm_search_fold(text) 已存在 ⇒ 停, 先查是誰建的';
  END IF;
  IF to_regclass('public.products_search_fold_trgm_idx') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③b:索引名 products_search_fold_trgm_idx 已存在 ⇒ 停, 先查它是不是同一個運算式';
  END IF;
  -- ④ trigram opclass 在 extensions schema(正式庫 pg_trgm 裝在 extensions)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_opclass c JOIN pg_catalog.pg_namespace n ON n.oid = c.opcnamespace
                  WHERE c.opcname = 'gin_trgm_ops' AND n.nspname = 'extensions') THEN
    RAISE EXCEPTION '前置閘④:extensions.gin_trgm_ops 不存在 ⇒ pg_trgm 沒裝或不在 extensions ⇒ 停';
  END IF;
  -- ⑤ owner 是 postgres 且繞得過 RLS(DEFINER 的前提, 同 20260911150000 前置閘④)
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) <> 'postgres'
     OR NOT (SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = 'postgres') THEN
    RAISE EXCEPTION '前置閘⑤:owner 不是 postgres 或 postgres 不是 BYPASSRLS ⇒ 停';
  END IF;
END
$pre$;

-- ── ① 折疊函式 ──────────────────────────────────────────────────────────────
-- 🔴 字表兩邊長度必須相同(translate 逐字對應);事後閘⑤b 驗 Č / Ö 兩格。
CREATE FUNCTION public.pcm_search_fold(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $fn$
  SELECT pg_catalog.lower(
           pg_catalog.regexp_replace(
             pg_catalog.translate(coalesce(p_text, ''),
               'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÇçČčĆćŠšŽžÑñŁłŘřĚěŮů',
               'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyCcCcCcSsZzNnLlRrEeUu'),
             '[[:space:]._/·-]+', '', 'g'))
$fn$;
ALTER FUNCTION public.pcm_search_fold(text) OWNER TO postgres;
-- ACL-GATE-EXEMPT: public.pcm_search_fold -- 只給 service_role(20260916110000;2026-09-15 正式庫唯讀實查):對 products 有寫入權的只有 postgres/service_role/supabase_admin, 索引運算式寫入時要能執行;客人走 DEFINER 以 postgres 呼叫, anon/authenticated 不需要
REVOKE ALL ON FUNCTION public.pcm_search_fold(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_search_fold(text) TO service_role;

-- ── ② 索引:運算式必須與函式本體 ⑤ ⑥ 兩處【逐字】相同(別名除外), planner 才認得 ────────
CREATE INDEX products_search_fold_trgm_idx
  ON public.products USING gin ((public.pcm_search_fold(coalesce(title, '') || ' ' || coalesce(subtitle, ''))) extensions.gin_trgm_ops);

-- ── ③ 函式 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
 RETURNS TABLE(id uuid, is_exact boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH t AS (
    -- 🔴 逐詞編號 ⇒ 下面用「不同詞的個數」判斷「每個詞都中了」
    --    `WITH ORDINALITY` 讓重複的詞不會被摺疊成一個(打兩次同一個字仍是一個條件)
    -- 🔵 `pat` = 逃脫後的完整 LIKE 樣式, **在這裡算一次、下面三處引用**。
    --    三層 replace 的順序有意義(先 `\` 再 `%` 再 `_`)⇒ 抄成三份會各自漂;
    --    而抽成 SQL 函式是一支**新 DB 物件**(GRANT/REVOKE/審查全部跟著來)⇒ 用 CTE 欄位。
    SELECT DISTINCT ON (term) term, ord,
           '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat,
           -- 🔵 2026-09-16 折疊版的詞與樣式(plan `docs/plans/2026-09-15-storefront-search-normalize-plan.md` §1-2)。
           --    `_` 已被折疊拿掉 ⇒ 只剩 `\` 與 `%` 要逃脫(順序同上:先 `\` 再 `%`)。
           public.pcm_search_fold(term) AS f,
           '%' || replace(replace(public.pcm_search_fold(term), '\', '\\'), '%', '\%') || '%' AS fpat
      FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
     -- 空字串 / 全空白的詞丟掉 —— 留著會變成 `%%` 而那會命中全部
     WHERE btrim(term) <> ''
     -- 🔵 2026-09-16(R1 nit):DISTINCT ON 取【最早出現】的那個 ord ⇒ 重複詞時整串的拼法固定。
     ORDER BY term, ord
  ),
  n AS (SELECT count(*)::bigint AS want FROM t),
  -- ── ② 品牌:先自己撈, 再用 brand_id 回去比 ────────────────────────────
  -- 🔴🔴 **這一塊存在的唯一理由就是「不要讓 b.name 出現在 products 的 OR 裡」。**
  --    ⛔ ~~`LEFT JOIN brands b … OR b.name ILIKE …`~~ ⇒ 跨表欄位進 OR
  --       ⇒ planner 只能先 join 再過濾 ⇒ **products 上的索引全部用不到**(正式站 249.1ms)
  --    ⇒ 📌 下一個人「簡化」它回去合併成一個 OR:三綠全綠、行為零改變、而中文搜尋回到 243ms。
  bh AS (
    SELECT t.ord, br.id AS brand_id
      FROM public.brands br
      JOIN t ON (
           br.name ILIKE t.pat
           -- 🔵 2026-09-16:品牌名也折疊比(`AKRAPOVIČ` ⇒ Akrapovic);品牌表小, 不需要索引, 也不進 products 的 OR。
        OR (t.term ~ '[A-Za-z0-9]' AND length(t.f) >= 4 AND public.pcm_search_fold(br.name) LIKE t.fpat)
      )
  ),
  -- ── hits:三塊各吐 `(id, ord)`, UNION ALL 在【(商品, 詞)】那一層 ──────────
  -- 🛑 **不可以搬到商品那一層**(理由見檔頭「UNION 的層級是正確性核心」)。
  hits AS (
    -- ① 四欄 OR:純 products_public 欄位、零跨表 ⇒ BitmapOr 吃得到 trgm
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
           p.title       ILIKE t.pat
        OR p.subtitle    ILIKE t.pat
        OR p.description ILIKE t.pat
        OR p.external_id ILIKE t.pat
      )
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
    UNION ALL
    -- ② 品牌
    SELECT p.id, bh.ord
      FROM public.products p
      JOIN bh ON p.brand_id = bh.brand_id
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
    UNION ALL
    -- ③ ⟦search-PARTNOSEPINDIGITS⟧ 料號:兩端都正規化, 再比【前綴】
    -- 🔴🔴 **三個條件缺一不可, 而少了第一個會【回傳整張表】**:
    --    ① `regexp_replace(term) <> ''` —— 中文詞正規化之後是**空字串**,
    --       而 `LIKE '' || '%'` = `LIKE '%'` ⇒ **命中每一列**。
    --       ⇒ 📌 客人打「油箱貼」就會拿到全站商品, 而 HTTP 200、畫面完全正常。
    --    ② 詞裡**同時**有字母與數字 —— 少了它, 打 `a` ⇒ 前綴 `A%` ⇒ 命中所有 A 開頭的料號。
    --    ③ 用 `LIKE` 不是 `ILIKE` —— 兩端都已經 `upper()` 過了。
    -- 🔵 **不需要 escape**:正規化把 `%` `_` `\` 全都當成非英數刪掉了 ⇒ 構造不出萬用字元。
    -- 🔴 **順序刻意:兩個便宜的 `~` 排在最前面** —— 中文搜尋佔多數而它們一定不含數字。
    --    🔬 而正式站的 EXPLAIN 現在替這段註解背書:中文詞下這一塊印 **`never executed`**。
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
             t.term ~ '[0-9]'
         AND (
               t.term ~ '[A-Za-z]'
            -- 🔴 2026-09-04 加的第二條路:【夠長的純數字】也算料號
            --    門檻 7 的來源與爆炸半徑量測 ⇒ 見本檔檔頭「門檻為什麼是 7 不是 9」
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
             LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
     -- 🔴 2026-09-11 DEFINER:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
    UNION ALL
    -- ── ④ ⟦search-VARIANTSKU⟧ 變體料號:形狀【逐字鏡射第 ③ 塊】────────────────
    -- 🔴 **為什麼鏡射而不是寫 `ILIKE '%sku%'`**:第 ③ 塊那三個條件是付過學費的
    --    (詞正規化後是空字串 ⇒ `LIKE '%'` ⇒ 命中每一列, 而 HTTP 200、畫面完全正常)。
    --    ⚠️ **而那段註解自己已經過期一半**(codex 2026-09-06 N3):現行還有數字閘在,
    --    單獨移除「正規化非空」那一條**不會**再讓中文變成全表命中 —— 防護保留, 理由訂正。
    -- 🔵 吐的是 `pv.product_id`, 不是變體 id ⇒ UNION ALL 仍在【(商品, 詞)】那一層。
    --    一個商品有多個變體 ⇒ 同一對 `(id, ord)` 會來很多次, 而外層 `count(DISTINCT h.ord)`
    --    只數**不同的詞**, 重複不影響(codex 2026-09-06 逐條驗過這一題)。
    -- ⛔ ~~**走 `product_variants_public` 而不是 `product_variants`** —— 那支 view 是~~
    -- ⛔ ~~`security_invoker = true`, 而本函式是 INVOKER ⇒ 下架母商品的變體由 RLS 擋掉。~~
    -- 🔴🔴 **[2026-09-11 本函式改 SECURITY DEFINER —— 上面那句的前提不在了]**
    --    INVOKER + RLS 之下, 搜尋條件(ILIKE / LIKE / upper / regexp_replace)全部不是 leakproof
    --    ⇒ 【一支索引都用不上】, 客人每個詞整張掃(plan `docs/plans/2026-09-11-search-definer-plan.md` §1)。
    --    ⇒ 改讀底表 `product_variants`, 下架母商品的變體由本函式【自己】照 policy 原文擋(下面每一支的 WHERE)。
    --    ✅ **零價變體【刻意不擋】** —— Sean 2026-09-06 拍甲, 逐字「甲=沒價格的也讓客人搜到」。
    --    ⇒ 📌 這是**拍板**, 不是「還沒做」。下一個人想加 `price_general > 0` 之前, 先去問 Sean。
    SELECT pv.product_id AS id, t.ord
      FROM public.product_variants pv
      JOIN t ON (
         -- 🔴 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-10:放寬 —— **純字母也算料號**。
         --   量到的收益:純字母且正規化 >= 4 碼的料號 410 種, 其中【現行三塊全部撈不到】363 種。
         --   ⚠️ 而放寬的同時比法要換, 見下面那個 CASE —— **兩件事是一組的, 拆開做會出事。**
             ( t.term ~ '[0-9]' OR t.term ~ '[A-Za-z]' )
         AND (
               t.term ~ '[A-Za-z]'
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         -- 🔴🔴 **最短長度閘 —— 而它 2026-09-10 換了理由, 舊理由【已作廢】, 照實寫:**
         --    ⛔ ~~舊理由:它守的是 `RPC_ID_CAP = 1000` 那個懸崖(過 cap ⇒ 整發退回舊路)~~
         --    🔴 **那個 cap 2026-09-07 就被拿掉了** —— `SupabaseProductAdapter.ts:79` 逐字
         --      「⛔ ~~`const RPC_ID_CAP = 1000;`~~ 2026-09-07 拿掉(⟦search-RPC1000FALLBACK⟧)」,
         --      `:1112` 那個退回舊路的 `if` 同樣是刪除線。⇒ 📌 **懸崖不存在。**
         --    🎯 而那句話是怎麼活下來的, 值得留在這裡:`20260906900000` 的註解寫於 09-06,
         --      09-07 那段碼被拿掉而**註解沒跟著改** ⇒ 09-10 有人讀註解當依據, 四手轉述都沒人去看碼。
         --      ⇒ 🛑 **一句擋人的話, 在障礙消失之後仍然擋著 —— 它擋得越有效, 問題越隱形。**
         --    ⚠️ `20260906900000` 那支檔案裡的舊註解**本片沒有動**(那要另一支 migration)。
         --
         --    🔴🔴 **而我第二個理由也被打掉了, 照實寫(codex R2 nit, 而他對)**:
         --      ⛔ ~~新理由:L=4 最大命中 727 而 L=3 是 3,649 ⇒ 5 倍懸崖~~
         --      🎯 **那把尺量的是【純字母】窗格, 而純字母現在走【相等式】** ——
         --        這道長度閘之後只剩「含數字」那一族會走包含式。**族群不對, 數字搬不過來。**
         --      🔬 **量對族群之後(含數字 且 (含字母 或 >=7 碼), 2026-09-10 唯讀)**:
         -- ```
         --    L=2  最大 3,894 (N0)      L=4  最大 3,606 (PRN0)
         --    L=3  最大 3,607 (RN0)     L=5  最大 3,065     L=6  最大 933
         -- ```
         --      ⇒ 🛑 **4 掉到 3 沒有懸崖 —— 3,607 對 3,606, 是平的。**
         --      🔬 而它實際擋掉的東西量得到(該詞經第 ④ 塊會多拉幾件 / 第 ① 塊本來就有幾件):
         --        `1B` 1,021 / 150 · `A1` 950 / 926 · `N0` 3,894 / 3,851 · `R1` 743 / 1,565
         --        ⇒ 真正新增最多的是 `1B`(約 +871), 而那不是客人會打的詞。
         --    ✅ **⇒ 所以這道閘留著的理由是【它不在本片範圍】, 不是「它守著什麼」。**
         --      🛑 **不要再替它編第三個理由。** 要動它就自己量一次, 而那是另一片。
         --    🔵 而**相等式那一支根本不需要它**(相等式的上界實測 = 1 件)⇒ 對純字母它是多餘的。
         AND length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 4
         -- 🔴🔴 **這裡是【包含】不是【前綴】—— 而那是量出來的, 不是風格**:
         --    Sean 打的兩個詞需要兩種不同的比法, 而沒有任何一種前綴同時抓得到:
         -- ```
         --    詞            整串前綴  右半前綴  整串包含
         --    PET52R           0        1        1     ⇐ 真實 sku 是 `PET52-PET52R`
         --    AZ203B           1        0        1
         --    01022450101      1        0        1
         --    ZZQ9999X(負對照) 0        0        0     ⇐ 尺會動
         -- ```
         --    🎯 成因:sku **沒有一致的形狀**(2026-09-06 正式庫唯讀全掃 59,841 列):
         --      有破折號 35,064 / 沒有 24,777;恰一個 8,357 / **多個 26,707**;
         --      而「破折號左半 = 母商品 external_id」**只有 16,348 列(27%)**
         --      ⇒ 📌 **「右半就是變體料號」這個假設對 73% 的列不成立** ⇒ 切字串那條路走不通。
         -- 🔵 **而【包含】在這裡不比前綴貴** —— sku 上沒有可用索引(見檔頭), 兩種都是全表掃 + 每列一次 regexp
         --    ⇒ 前綴唯一的好處(吃索引)在這條路上**本來就拿不到**。
         -- ⚠️ **爆炸半徑量過**:過得了上面三個守門條件的最寬那種詞(7 位以上數字),
         --    包含式實測命中 **≤ 1 筆**(`0102245` / `01022450` / `0102245010` 各 1、`0000000` / `1234567` 各 0);
         --    而 `'0'` `'1'` `'01'` 那種會命中上萬的詞 **根本進不了第 ④ 塊**(不含字母且不足 7 位)。
         -- 🔴🔴 **2026-09-10:比法【分兩支】, 而那不是風格, 是量出來的。**
         --    放寬之後若讓純字母詞也走包含式, 客人打的是英文字而 sku 裡的字母片段是
         --    **供應商的編碼慣例** ⇒ 唯讀實測:
         -- ```
         --    詞      現行三塊   包含式第 ④ 塊   真正新增給客人看見
         --    FIRE        19         727              719   🔴
         --    NINJA      867         727              702   🔴
         --    BLUE         3          31               30
         --    樣本 sku:APR-1-FIRE / HON-24-FIRE / KAW-44-FIRE ⇒ 商品是【防爆水管】
         --    ⇒ 📌 `FIRE` 不是料號, 是字尾慣例。客人打 FIRE 拿到 719 條水管。
         -- ```
         --    ✅ **改成相等式之後**:收益 **363/363 一件沒少**, 而噪音上界從 **727 降到 1**
         --      (全庫掃過:純字母料號用相等式最多拉 1 件 —— ADLAU=1 · ADLB=1 · ADLA=1 …)。
         --    🔬 唯讀跑過整支:`ADLA` ⇒ 1 · `PET52R` ⇒ 1 · `FIRE` ⇒ **0**。
         --    🛑 **含數字那一支【維持包含式】, 不要一起改成相等** ——
         --      真實 sku 是 `PET52-PET52R`, 而 Sean 打的是 `PET52R` ⇒ 相等式會讓它變 0。
         --      🔵 而含數字片段(`PRN0` / `RN014`)沒有人會打 ⇒ 包含式對它們本來就安全。
         -- 🔴 2026-09-11:原本這裡是一個 `CASE WHEN t.term ~ '[0-9]' THEN … LIKE '%…%' ELSE … = … END`,
         --   而 CASE 讓索引用不到 ⇒ 拆成兩個 UNION ALL 分支, 判斷條件逐字不變:
         --   這一支只收【含數字】的詞(包含式, 吃 `product_variants_sku_norm_trgm_idx`),
         --   下面那一支只收【不含數字】的詞(相等式, 吃 `product_variants_sku_norm_idx`)。
         --   🛑 兩支的前四道閘必須逐字相同 —— 改一支就要改另一支。
         AND t.term ~ '[0-9]'
         AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
     -- 🔴 2026-09-11 DEFINER:照 `product_variants_select_public` 原文自己擋「母商品已下架」的變體
     WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)
    UNION ALL
    -- ── ④b 同一塊的純字母那一支(2026-09-11 從上面的 CASE 拆出來;理由同上)────────
    SELECT pv.product_id AS id, t.ord
      FROM public.product_variants pv
      JOIN t ON (
             ( t.term ~ '[0-9]' OR t.term ~ '[A-Za-z]' )
         AND (
               t.term ~ '[A-Za-z]'
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 4
         AND t.term !~ '[0-9]'
         AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
             =    upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g'))
      )
     -- 🔴 2026-09-11 DEFINER:照 `product_variants_select_public` 原文自己擋「母商品已下架」的變體
     WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv.product_id AND p.delisted_at IS NULL)
    UNION ALL
    -- ── ⑤ 2026-09-16 折疊比對(plan §1-2 a):`MT07` = `MT-07` = `MT 07`、`AKRAPOVIČ` = `akrapovic` ──────
    -- 🔴 運算式必須與 `products_search_fold_trgm_idx` 逐字相同(別名 p 除外), planner 才認得那支索引。
    -- 🔴 只收【含英文或數字】的詞:純中文折疊前後一樣, 走 ① 的 title trigram 就好, 不多付一次。
    -- 🔴 `length(t.f) >= 4`(R1 must-fix 2 / 3):
    --    · 短詞跨字詞邊界會變寬 —— 資料那邊空白被拿掉後 `R1` 會中「R 1250 GS」、`1.25` 會中所有 125cc;
    --    · 1–2 字的詞 trigram 抽不出三字組 ⇒ 吃不到索引 ⇒ 每列重算 fold(正式庫全掃實測約 470 ms / 詞)。
    --    ⇒ 折完不足 4 碼的詞【不走】這一支, 照舊由 ① 字面比(`R1` / `R6` / `Z9` 行為不變)。
    --    ⇒ 只打符號的詞折完是空字串, 也一併被這道擋下(不會變成 `LIKE '%%'`)。
    --    目標詞都 ≥ 4 碼:mt07 / s1000rr / r1250gs / akrapovic / ohlins。
    SELECT p.id, t.ord
      FROM public.products p
      JOIN t ON (
             t.term ~ '[A-Za-z0-9]'
         AND length(t.f) >= 4
         AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '')) LIKE t.fpat
      )
     -- 🔴 2026-09-16:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
  ),
  -- ── ⑥ 2026-09-16 整串優先(plan §1-2 b):`S 1000 RR` 整串折成 `s1000rr`, 拿來【收窄逐詞 AND 的結果】 ────────
  -- 🔴 觸發條件:兩個詞以上、每個詞都只有英數符號、沒有任何一個詞含 4 個以上連續英文字母、整串含數字
  --    —— 車款代號碎片的形狀(`S 1000 RR` / `R 1250 GS` / `MT 07`)。
  --    帶品牌或英文字(`Akrapovic MT-07` / `Yamaha MT-07` / `Ninja 400`)、混中文(`Akrapovic 排氣管`)一律不觸發。
  -- 🔴🔴 **它只從【每個詞都中】的那批裡挑, 不另找商品**(R1 must-fix 1 + R2 must-fix F1 的修法):
  --    ⛔ ~~第一版:整串只比 title+subtitle, 中了就只回那批~~ ⇒ 品牌 / 描述 / 料號 / 變體找到的商品會被悄悄丟掉。
  --    ⛔ ~~R1 修正版:從 hits(還沒做 HAVING, 中任一詞的商品都在)挑~~ ⇒ R2 F1:
  --       ① `S 1000 RR` 的 `S` 會中大半張表 ⇒ 對幾萬列折疊 description;
  --       ② 只中一個詞、而描述含整串的商品會把 use_ph 打開 ⇒ 每詞都中的商品被刪, 它自己再被 HAVING 擋掉 ⇒ 可能 0 筆。
  --    ✅ 現在:先算 and_ids(= 最後那道 HAVING 的同一個條件), 再看其中有沒有商品在
  --       title / subtitle / description / external_id 任一處(折疊後)含整串;有 ⇒ 只留那些;沒有 ⇒ 原樣回傳。
  --    🔬 正式庫 2026-09-15 唯讀量「第一版會丟掉、而描述或料號其實有寫整串」的件數:
  --       S 1000 RR 32 · MT 07 5 · Z 900 1 · R 1250 GS 0 ⇒ 現在這些都留著。
  --    🔵 描述沒有折疊索引, 但這裡只對 and_ids(每詞都中;正式庫 S 1000 RR 那發 872 列)算 fold, 不掃全表。
  --    🔵 and_ids 帶 `WHERE EXISTS (SELECT 1 FROM ph)`:沒觸發整串優先的查詢(單詞 / 中文 / 帶英文字)一列都不算。
  ph AS (
    SELECT public.pcm_search_fold(string_agg(t.term, '' ORDER BY t.ord)) AS f
      FROM t
    HAVING count(*) > 1
       AND bool_and(t.term ~ '^[A-Za-z0-9._/·-]+$')
       AND bool_and(t.term !~ '[A-Za-z]{4,}')
       AND bool_or(t.term ~ '[0-9]')
  ),
  and_ids AS (
    SELECT h.id
      FROM hits h CROSS JOIN n
     WHERE EXISTS (SELECT 1 FROM ph)
     GROUP BY h.id, n.want
    HAVING count(DISTINCT h.ord) = n.want
  ),
  ph_hits AS (
    SELECT a.id
      FROM and_ids a
      JOIN public.products p ON p.id = a.id
      JOIN ph ON (
             length(ph.f) >= 4
         AND public.pcm_search_fold(coalesce(p.title, '') || ' ' || coalesce(p.subtitle, '') || ' '
                                    || coalesce(p.description, '') || ' ' || coalesce(p.external_id, ''))
             LIKE '%' || replace(replace(ph.f, '\', '\\'), '%', '\%') || '%'
      )
     -- 🔴 2026-09-16:照 `products_select_public` 原文 `USING (delisted_at IS NULL)` 自己擋下架
     WHERE p.delisted_at IS NULL
  ),
  use_ph AS (SELECT EXISTS (SELECT 1 FROM ph_hits) AS yes),
  -- 🔵 收窄只刪列、不補列 ⇒ 下面那道 `count(DISTINCT h.ord) = n.want` 的語意不變(整串命中的那些本來就逐詞都中了)。
  hits2 AS (
    SELECT h.id, h.ord
      FROM hits h CROSS JOIN use_ph u
     WHERE NOT u.yes OR h.id IN (SELECT x.id FROM ph_hits x)
  )
  -- 🎯 ⟦db-SEARCHFACETMUTEX⟧ 2026-09-09:把「完全命中」從【只能排序】變成【看得見的欄位】。
  --   🔴 **原封用下面 ORDER BY 那一段的同一個運算式** —— 抄成兩份會漂,
  --     而漂了之後「排最前的那顆」與「被標成完全命中的那顆」會是不同的商品。
  --   ⇒ 所以下面的 ORDER BY 改成引用這個別名, 而不是再寫一次。
  SELECT h.id, EXISTS (
              SELECT 1 FROM t
               WHERE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
                 AND ( EXISTS (SELECT 1 FROM public.products p2
                                WHERE p2.id = h.id AND p2.delisted_at IS NULL
                                  AND upper(regexp_replace(p2.external_id, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                    OR EXISTS (SELECT 1 FROM public.product_variants pv2
                                WHERE pv2.product_id = h.id
                                  AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = pv2.product_id AND p.delisted_at IS NULL)
                                  AND upper(regexp_replace(pv2.sku, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                     )
            ) AS is_exact
    FROM hits2 h
    CROSS JOIN n
   WHERE n.want > 0            -- 🔴 零個有效詞 ⇒ 回零列(不是回全表)
   GROUP BY h.id, n.want
  -- 🔴🔴 **這個 `DISTINCT` 是承重的, 不是冗贅。** 拿掉 ⇒ 同一對從多塊各來一次 ⇒ 多算
  --    ⇒ `= want` 不成立 ⇒ 那一列被【丟掉】⇒ **客人打料號拿到 0 筆**(變窄, 不是放寬)。
  --    ⇒ 📌 而「拿到 0 筆」不會有人回報, 他只會覺得我們沒賣。
  HAVING count(DISTINCT h.ord) = n.want
  -- ── 🔴 ⟦search-VARIANTSKUFIRST⟧ 完全命中排最前(Sean 2026-09-06:「完全命中的排最前」)──
  --   🛑 **本函式在此之前【一個 ORDER BY 都沒有】** —— `grep -c 'ORDER BY'` 對前一代 ⇒ **0**
  --     ⇒ 順序完全由 planner 決定。所以這不是「改排序」, 是**第一次給它一個排序**。
  --   🔵 **用 `=` 不是 `LIKE`**:要的是**完全命中** —— 兩端都正規化之後直接比相等。
  --   🔴🔴 **`h.id` 這個第二鍵是承重的, 不是湊數**:
  --     沒有它, 同一組(都完全命中 / 都不是)之間的順序**仍然由 planner 決定**
  --     ⇒ 📌 **「排序不穩定」與「排序錯了」在畫面上很像, 而分頁時前者更毒** ——
  --       同一筆商品會出現在兩頁, 而另一筆一頁都不出現。
  --   ⚠️ **代價(未量)**:那個 `EXISTS` 對結果集的每一列各跑一次。
  --     正式庫的延遲**沒有量**(主視窗裁乙:貼完之後用唯讀 `EXPLAIN` 量一次再關板列)。
   ORDER BY is_exact DESC,
            h.id;
$function$
;

-- ── 權限:兩道 REVOKE 都下, 再具名 GRANT(名單 = 正式庫現行)────────────────
-- ACL-GATE-EXEMPT: public.storefront_search_product_ids --REVOKE PUBLIC/anon/authenticated 後具名還原, 授權集合與正式庫現行 proacl 相同 anon/authenticated/service_role(2026-09-11 唯讀讀到 has_function_privilege 三者皆 t);anon 必須留, 它就是客人的搜尋
REVOKE ALL ON FUNCTION public.storefront_search_product_ids(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_search_product_ids(text[]) TO anon, authenticated, service_role;

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 🔴 本檔新建的可授權物件清單(靜態檢查規則③:清單只驗你列出來的 ⇒ 新建幾個就列幾個)
  v_functions text[] := ARRAY['public.pcm_search_fold(text)']::text[];
  v_fn        text;
  v_code  text;
  v_n     integer;
  v_valid boolean;
  v_ready boolean;
  r       record;
BEGIN
  -- ⓪ 新建函式的收權斷言:PUBLIC / anon / authenticated 都拿不到 EXECUTE
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪a:% 不存在', v_fn;
    END IF;
    -- 🔵 R1 nit:proacl 為 NULL 時展開 acldefault(= PUBLIC 可執行), 照 pattern §3.6 規則 2
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘⓪b:% 的 EXECUTE 沒收乾淨(PUBLIC / anon / authenticated)', v_fn;
    END IF;
  END LOOP;
  -- ① 屬性:DEFINER + search_path = '' + 回傳型別不變
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) THEN
    RAISE EXCEPTION '事後閘①a:不是 SECURITY DEFINER';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '事後閘①b:search_path 不是空字串(或被追加了別的設定)';
  END IF;
  IF pg_catalog.pg_get_function_result('public.storefront_search_product_ids(text[])'::regprocedure) <> 'TABLE(id uuid, is_exact boolean)' THEN
    RAISE EXCEPTION '事後閘①c:回傳型別變了 ⇒ DEFINER 函式多吐欄位 = 可能漏資料';
  END IF;
  -- ①d(R2 nit N2):本體 md5 = 回滾檔前置閘②釘的那個值 ⇒ 兩邊漂掉在貼的當下就紅, 不是等到回滾才發現
  IF md5((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure)) <> 'ba579fb932a3a8a72946600292405e08' THEN
    RAISE EXCEPTION '事後閘①d:函式本體 md5 不是回滾檔釘的那個值 ⇒ 兩邊漂掉了';
  END IF;

  -- ② 剝註解後的碼(只認整行 `--`;區塊註解明確拒絕, 同 20260910070000 的 ⓪b)
  SELECT string_agg(ln, E'\n') INTO v_code
    FROM (SELECT ln FROM regexp_split_to_table(
            pg_catalog.pg_get_functiondef('public.storefront_search_product_ids(text[])'::regprocedure), E'\n') AS ln
           WHERE btrim(ln) !~ '^--') s;
  IF position('/*' IN v_code) <> 0 OR position('*/' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②a:函式裡出現區塊註解 ⇒ 剝註解器不支援, 下面的文字閘不算數';
  END IF;
  IF position('前提不在了' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②b:剝註解沒生效(註解裡的字還在)⇒ 下面的文字閘不算數';
  END IF;
  -- 不得再經過 security_invoker 的 view(否則 DEFINER 的意義只剩一半)
  IF position('products_public' IN v_code) <> 0 OR position('product_variants_public' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②c:碼裡還有 *_public view';
  END IF;
  -- 9 處下架過濾(① ② ③ · ④ 兩支 · ⑤ 折疊 · ⑥ 整串 · is_exact 兩個子查詢)
  v_n := (length(v_code) - length(replace(v_code, 'delisted_at IS NULL', ''))) / length('delisted_at IS NULL');
  IF v_n <> 9 THEN
    RAISE EXCEPTION '事後閘②d:下架過濾在碼裡有 % 處(期望 9)', v_n;
  END IF;
  -- 折疊分支與整串優先真的接上了(最後那個 SELECT 讀的是 hits2, 不是 hits)
  IF position('FROM hits2 h' IN v_code) = 0 OR position('public.pcm_search_fold(coalesce(p.title, '''') || '' '' || coalesce(p.subtitle, ''''))' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘②g:折疊分支 / 整串優先沒有接上(找不到 FROM hits2 h 或索引運算式)';
  END IF;
  -- 不得碰 anon 讀不到的欄位
  IF v_code ~* '(price_store|price_by_tier|metadata)' THEN
    RAISE EXCEPTION '事後閘②e:DEFINER 函式碰到 price_store / price_by_tier / metadata ⇒ 可能漏經銷價或內部欄位';
  END IF;
  IF position('CASE WHEN t.term' IN v_code) <> 0 THEN
    RAISE EXCEPTION '事後閘②f:第 ④ 塊的 CASE 還在 ⇒ 變體料號索引用不到';
  END IF;

  -- ③ ACL:枚舉每一個持 EXECUTE 的 grantee, 只准 postgres / anon / authenticated / service_role;PUBLIC(grantee 0)不准
  FOR r IN
    SELECT a.grantee, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS who
      FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure AND a.privilege_type = 'EXECUTE'
  LOOP
    IF r.who NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
      RAISE EXCEPTION '事後閘③a:% 持有 EXECUTE ⇒ 名單外', r.who;
    END IF;
  END LOOP;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = 'public.storefront_search_product_ids(text[])'::regprocedure) IS NULL THEN
    RAISE EXCEPTION '事後閘③b:proacl 是 NULL ⇒ 等於 PUBLIC 可執行(pattern §3.6)';
  END IF;
  IF NOT (has_function_privilege('anon', 'public.storefront_search_product_ids(text[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.storefront_search_product_ids(text[])', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.storefront_search_product_ids(text[])', 'EXECUTE')) THEN
    RAISE EXCEPTION '事後閘③c:三個具名角色有人拿不到 EXECUTE ⇒ 客人搜尋會壞';
  END IF;

  -- ⑤ 折疊函式:IMMUTABLE、固定幾格的輸出、ACL(寫 products 的角色要能跑它;anon / authenticated 不需要)
  IF (SELECT p.provolatile FROM pg_catalog.pg_proc p WHERE p.oid = 'public.pcm_search_fold(text)'::regprocedure) <> 'i' THEN
    RAISE EXCEPTION '事後閘⑤a:pcm_search_fold 不是 IMMUTABLE ⇒ 不能當索引運算式';
  END IF;
  IF public.pcm_search_fold('MT-07') <> 'mt07' OR public.pcm_search_fold('S 1000 RR') <> 's1000rr'
     OR public.pcm_search_fold('AKRAPOVIČ') <> 'akrapovic' OR public.pcm_search_fold('Öhlins') <> 'ohlins'
     OR public.pcm_search_fold('排氣管') <> '排氣管' OR public.pcm_search_fold(NULL) <> '' THEN
    RAISE EXCEPTION '事後閘⑤b:pcm_search_fold 輸出不對(MT-07 / S 1000 RR / AKRAPOVIČ / Öhlins / 排氣管 / NULL)';
  END IF;
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = 'public.pcm_search_fold(text)'::regprocedure) IS NULL THEN
    RAISE EXCEPTION '事後閘⑤c:pcm_search_fold 的 proacl 是 NULL ⇒ 等於 PUBLIC 可執行(pattern §3.6)';
  END IF;
  IF has_function_privilege('anon', 'public.pcm_search_fold(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pcm_search_fold(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.pcm_search_fold(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑤d:pcm_search_fold 的 EXECUTE 名單不對(anon / authenticated 應為 f、service_role 應為 t)';
  END IF;
  -- ⑥ 索引:存在、可用、運算式是折疊函式 + trigram
  SELECT i.indisvalid, i.indisready INTO v_valid, v_ready
    FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.products_search_fold_trgm_idx');
  IF v_valid IS DISTINCT FROM true OR v_ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION '事後閘⑥a:products_search_fold_trgm_idx 不存在或不可用';
  END IF;
  IF position('pcm_search_fold' IN pg_catalog.pg_get_indexdef('public.products_search_fold_trgm_idx'::regclass)) = 0
     OR position('gin_trgm_ops' IN pg_catalog.pg_get_indexdef('public.products_search_fold_trgm_idx'::regclass)) = 0 THEN
    RAISE EXCEPTION '事後閘⑥b:索引運算式不是 pcm_search_fold + gin_trgm_ops';
  END IF;

  -- ④ 行為閘:下架商品搜不到, 而同形狀的上架商品搜得到(正對照)。
  --    🛑 有分母:庫裡沒有「帶字母+數字料號的下架商品」時沒有判別力 ⇒ 印 NOTICE, 不把沉默印成通過。
  SELECT p.id, p.external_id INTO r FROM public.products p
   WHERE p.delisted_at IS NOT NULL AND p.external_id ~ '[A-Za-z]' AND p.external_id ~ '[0-9]'
     AND length(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g')) >= 4
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.external_id]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '行為閘④a:下架商品 % 被搜到了 ⇒ DEFINER 在漏下架品', r.external_id;
    END IF;
  ELSE
    RAISE NOTICE '⚠️ 行為閘④a 跳過:這個庫沒有帶字母+數字料號的下架商品 ⇒ 下架過濾今天【沒有】被行為驗到';
  END IF;
  SELECT p.id, p.external_id INTO r FROM public.products p
   WHERE p.delisted_at IS NULL AND p.external_id ~ '[A-Za-z]' AND p.external_id ~ '[0-9]'
     AND length(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g')) >= 4
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.external_id]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '行為閘④b:上架商品 % 用自己的料號搜不到 ⇒ 函式壞了(不是變嚴)', r.external_id;
    END IF;
  ELSE
    RAISE NOTICE '⚠️ 行為閘④b 跳過:這個庫沒有帶字母+數字料號的上架商品';
  END IF;
  -- ④c 🔴 本片的受詞:副標寫 `XX-00` 的上架商品, 用去掉連字號的 `XX00` 要搜得到(`MT-07` ⇒ `MT07`)。
  SELECT p.id, (pg_catalog.regexp_match(p.subtitle, '([A-Za-z]{2,4})-([0-9]{2,4})')) AS m INTO r
    FROM public.products p
   WHERE p.delisted_at IS NULL AND p.subtitle ~ '[A-Za-z]{2,4}-[0-9]{2,4}'
   ORDER BY p.id LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.storefront_search_product_ids(ARRAY[r.m[1] || r.m[2]]) s WHERE s.id = r.id) THEN
      RAISE EXCEPTION '行為閘④c:副標含 %-% 的上架商品用 % 搜不到 ⇒ 折疊分支沒生效', r.m[1], r.m[2], r.m[1] || r.m[2];
    END IF;
  ELSE
    RAISE NOTICE '⚠️ 行為閘④c 跳過:這個庫沒有副標含 XX-00 形狀的上架商品 ⇒ 折疊分支今天【沒有】被行為驗到';
  END IF;
END
$post$;

COMMIT;
