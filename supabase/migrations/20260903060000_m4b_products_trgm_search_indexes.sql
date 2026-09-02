-- M-4b · 顧客站搜尋:`products` 四欄的 pg_trgm GIN 索引
--
-- ── 🔴 它要解的那件事,以及【那件事是怎麼被誤判兩次的】────────────────────────
--    症狀:客人打**中文**搜尋要等 ~1.7 秒;而打英文料號只要 ~0.12–0.3 秒。
--    ```
--    線上實測(2026-09-03 04:5x 線 `-mail` · 05:0x 主視窗-87 複量, 兩人各一把尺)
--      ASCII 1 詞 rsv4              0.115–0.19 s
--      ASCII 2 詞 rpm rsv4          0.29–0.32 s
--      ASCII 8 詞                   0.65 s
--      🔴 中文 1 個字「貼」          1.64–1.74 s
--      🔴 中文 1 字 + 零結果 ASCII   1.68–1.75 s   ← **回傳 129 bytes、零筆結果, 仍然 1.7 秒**
--    ```
--    🎯 **最後那一格是判別格**:零筆結果、129 bytes ⇒ **成本不在「找到比較多」也不在「傳輸」,
--      它在【找】那一段。**
--
--    🛑 **而這件事先前被【兩把尺】各排除過一次,兩次都是測資的問題** ——
--      ① 一份 `EXPLAIN` 說「182ms、對詞數不敏感」⇒ **它用的是哪一組字未確認**;
--         若是 ASCII, 它量到的就是上面那條快的線。⚠️ 而那個 182ms **後來被自己的作者標為
--         「沒有可重跑的來源」** ⇒ **不要再引用它。**
--      ② 一次拋棄式 PG 的量測說「21ms、對詞數不敏感」⇒ 🔴 **那座鑽機是 `LC_ALL=C --locale=C`**
--         ⇒ **C locale 之下 `ILIKE` 對 UTF-8 幾乎不做 case-folding ⇒ 中文在本機本來就便宜。**
--    📌 **⇒ 兩次都不是「量錯」,是【那把尺看不見這個現象】。**
--
-- ── 🔴🔴 而本檔最重要的一句:**這支索引【在本機驗不了】** ────────────────────
--    本 repo 已記過同族:「`pg_trgm` 對中文在 macOS BSD libc **抽零 trigram**,而正式站 glibc 正常」
--    ⇒ 📌 **在本機拋棄式 PG 上量這支索引「有沒有用」,得到的數字沒有判別力。**
--    ⇒ 🛑 **所以它的驗收【只能在正式站】** —— 驗收表寫在檔尾。
--
-- ── ⚠️ 一個我【沒有解決】的風險,寫在最前面因為它可能讓這支白做 ──────────────
--    `pg_trgm` 是**三連字元**索引,而 `ILIKE '%x%'` **兩側都是 wildcard**。
--
--    🔴🔴 **codex 2026-09-03 對抗審查指出一件決定性的事,而它推翻我原本的檢查方法**:
--    ```
--    ⛔ 我原本寫「跑 SELECT show_trgm('貼') 就知道」—— **那是錯的尺**。
--       show_trgm() 算的是【一般字串】的 trigram, 它會在頭尾補空白(padding);
--       而 `%貼%` 兩側是 wildcard ⇒ **不補 padding** ⇒ 抽不到完整 trigram。
--    ```
--    ⇒ 🛑 **所以結論是可以直接寫下來的,不需要再量**:
--      · **一個中文字(`貼`)⇒ 抽不到 trigram ⇒ 這支索引【幫不上忙】**(退化成 full index scan)
--      · **兩個字 ⇒ 同理,幫不上忙**
--      · **三個字以上(`油箱貼` / `碳纖維`)⇒ 抽得到 ⇒ 【會】有幫助**
--    ⇒ 🎯 **⇒ 這支索引解的是【三個字以上】的中文搜尋,不解【一兩個字】的。**
--
--    🛑 **⇒ 而那直接影響「這支值不值得貼」,那是產品判斷不是技術判斷**:
--      客人打「碳纖維」「油箱貼」(3 字)⇒ 有救;打「貼」「碳纖」(1–2 字)⇒ 沒救。
--      ⇒ **要不要為了 3 字以上的那一半付四支 GIN 的寫入成本 —— 那一題要人拍,寫在交件裡。**
--    ⚠️ 而**我沒有量過客人實際都打幾個字** ⇒ **那個分母不存在** ⇒ 不要拿「大部分人打 3 字」當理由。
--
-- ── 🔴 四欄要【一起】建,少一欄等於白建 ────────────────────────────────────
--    查詢是 `title ILIKE … OR subtitle ILIKE … OR description ILIKE … OR external_id ILIKE …`。
--    planner 要用索引走 `BitmapOr`, **需要 OR 的每一個分支都有可用索引**;
--    少一欄 ⇒ 那一支只能 Seq Scan ⇒ **整個 OR 退回全表掃 ⇒ 前面三支索引一點忙都幫不上。**
--    ⇒ 📌 **這支 migration 的四個索引是一個原子單位,不要「先建兩個看看」。**
--
-- ── 🛑 CONCURRENTLY:**本檔【不用】,而那是查過的不是省略** ────────────────────
--    本 repo 已記過(`20260811040000` 逐字):**「本 repo 的 migration 以交易執行,
--    CONCURRENTLY 在交易塊內會直接失敗(`CREATE INDEX CONCURRENTLY cannot run inside
--    a transaction block`)」** ⇒ 寫進 migration 裡**貼下去就會炸**。
--    ⇒ ✅ 所以本檔用**普通 `CREATE INDEX`**,而它的代價要明寫:
--      **建索引期間會擋住對 `products` 的寫入(`SHARE` 鎖),讀不受影響。**
--    ⚠️ **而「會擋多久」我【沒有量】** —— 那取決於表多大,而**我沒有正式庫 access**。
--      ✅ 貼之前想知道 ⇒ 一句唯讀:
--      ```sql
--      SELECT pg_size_pretty(pg_table_size('public.products')) AS 表大小,
--             (SELECT count(*) FROM public.products) AS 列數;
--      ```
--      🔵 **已知的一格**:列數 **22,804**(2026-09-03 主視窗-87 對正式庫量)⇒ 那不是大表。
--      🛑 **而「不是大表」是【列數】給的,不是【bytes】** —— `description` 若很長,
--        GIN 建索引的時間跟著文字量走,不跟列數走。⇒ **要那句 SQL 才知道。**
--    🔵 **若量出來會鎖太久** ⇒ 不要改本檔,改成**由 Sean 在交易外單獨下四句 CONCURRENTLY**
--      (那條路是 `20260811040000` 那支自己列的第二條路)。
--
-- 🔴 **本支未 apply。** 交主視窗排進「等 Sean 貼」佇列。

-- 🔴 **鎖等待要有上限**(codex must-fix):普通 `CREATE INDEX` 取 `SHARE` 鎖(擋寫、不擋讀),
--    而**四句在同一個交易裡 ⇒ 第一支拿到的鎖會【持有到四支 + 事後閘 + COMMIT 全部做完】**。
--    沒有 `lock_timeout` 時,若當下有既有 writer 沒結束,**這一發可以無上限地等**。
--    ⇒ 設 30 秒:等不到就整發失敗回滾,**而失敗遠比「悄悄擋住全站寫入」好**。
SET LOCAL lock_timeout = '30s';

DO $$
BEGIN
  -- 前置閘①:pg_trgm 必須已安裝(`20260812130000` 建的, 帳本記 1)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION '前置閘①:pg_trgm 不在 ⇒ 本片的四支索引建了也用不到, 停下人工確認';
  END IF;
  -- 🔴 前置閘①-b:**opclass 要【找得到】,而不是「擴充套件有裝」** —— 那是兩件事。
  --    少了這一格, 建索引那一步會拋一句
  --    `operator class "gin_trgm_ops" does not exist` ⇒ **而那句話會讓人去查「pg_trgm 裝了沒」**,
  --    而它裝了。⇒ 📌 一句正確的錯誤訊息, 把人推向錯的地方。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_opclass o
      JOIN pg_catalog.pg_namespace n ON n.oid = o.opcnamespace
      JOIN pg_catalog.pg_am a ON a.oid = o.opcmethod
     WHERE o.opcname = 'gin_trgm_ops' AND n.nspname = 'extensions' AND a.amname = 'gin'
  ) THEN
    RAISE EXCEPTION '前置閘①-b:找不到 extensions.gin_trgm_ops(gin)⇒ pg_trgm 可能裝在別的 schema;本片的四句 CREATE INDEX 寫死 extensions. 前綴, 停下人工確認';
  END IF;
  -- 前置閘②:四個欄位都要在
  --   ⛔ ~~「少一個 ⇒ 建到一半炸, 而前面幾支已經建好了 = 半套狀態」~~ **那句話是錯的**(codex must-fix):
  --   本 repo 的 migration **以交易執行** ⇒ 中途失敗會**整發 rollback**,不會留下半套。
  --   ✅ 這一格真正的價值是**早一點失敗、而且訊息說得出缺哪一欄** —— 不是防半套。
  --   ⚠️ **而「半套」在【逐句貼 SQL Editor】那條路上是真的** ⇒ 那條路請整份一次貼,不要逐句。
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='products'
         AND column_name IN ('title','subtitle','description','external_id')) <> 4 THEN
    RAISE EXCEPTION '前置閘②:products 缺了本片要索引的欄位(需 title/subtitle/description/external_id)';
  END IF;
END
$$;

-- 🔴 `gin_trgm_ops` 是**必須**的:預設的 opclass 對 `ILIKE '%x%'` **用不上**
--    ⇒ 少寫它會建出一支**定義看起來很正常、而查詢照樣 Seq Scan** 的索引。
--
-- 🔴🔴 **而它必須寫成 `extensions.gin_trgm_ops`(schema 限定)—— 這不是風格,是【不寫就炸】。**
--    Supabase 把擴充套件裝在 `extensions` schema(`20260812130000:126` 逐字
--    `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions`),
--    而預設 `search_path` 是 `"$user", public` ⇒ **不含 `extensions`**。
--    ⇒ 📌 **我第一版寫的是裸 `gin_trgm_ops`,而它在拋棄式庫上當場炸**:
--      `ERROR: operator class "gin_trgm_ops" does not exist for access method "gin"`
--    ⇒ 🎯 **而那個錯誤訊息會讓人以為【pg_trgm 沒裝】** —— 而它裝了,只是不在路徑上。
--      (前置閘① 問的是 `pg_extension` ⇒ 它**照樣通過** ⇒ 兩件事分開。)
--    ⇒ ✅ 而 `20260812130000:55` 早就逐字寫過:「opclass `extensions.gin_trgm_ops`」
--      —— **那條經驗已經在 repo 裡,而我沒有先去讀它。**
CREATE INDEX products_title_trgm_idx       ON public.products USING gin (title       extensions.gin_trgm_ops);
CREATE INDEX products_subtitle_trgm_idx    ON public.products USING gin (subtitle    extensions.gin_trgm_ops);
CREATE INDEX products_description_trgm_idx ON public.products USING gin (description extensions.gin_trgm_ops);
CREATE INDEX products_external_id_trgm_idx ON public.products USING gin (external_id extensions.gin_trgm_ops);

-- ── 事後閘:形狀抄 `20260901010000` 那支(它列了三種「定義字串看起來對而索引不是我要的那支」)──
DO $$
DECLARE
  v_names text[] := ARRAY['products_title_trgm_idx','products_subtitle_trgm_idx',
                          'products_description_trgm_idx','products_external_id_trgm_idx'];
  v_n text; v_def text; v_valid boolean; v_pred text;
BEGIN
  FOREACH v_n IN ARRAY v_names LOOP
    SELECT pg_get_indexdef(i.indexrelid), i.indisvalid, pg_get_expr(i.indpred, i.indrelid)
      INTO v_def, v_valid, v_pred
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = v_n
       AND n.nspname = 'public';        -- ① 限 namespace:別的 schema 的同名索引不算數
    IF v_def IS NULL THEN
      RAISE EXCEPTION '事後閘:% 建不出來', v_n;
    END IF;
    IF NOT v_valid THEN                  -- ② indisvalid:失敗的建索引會留下【定義正確而不可用】的索引
      RAISE EXCEPTION '事後閘:% 的 indisvalid = false ⇒ 定義是對的而查詢照樣 Seq Scan', v_n;
    END IF;
    IF v_pred IS NOT NULL THEN           -- ③ partial index 的定義片段一樣會過字串比對, 而它只蓋一部分
      RAISE EXCEPTION '事後閘:% 是 partial index(%)⇒ 它只蓋住一部分的列', v_n, v_pred;
    END IF;
    -- 🔴 ④ **它建在哪張表、哪一欄** —— codex must-fix:前面三格全過, 而
    --    「把 `products_description_trgm_idx` 建在 `title` 上」**照樣全綠**
    --    ⇒ 📌 索引【名字】對、schema 對、opclass 對, 而它索引的是**別的東西**。
    IF (SELECT i.indrelid FROM pg_catalog.pg_index i
          JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = v_n AND n.nspname = 'public') <> 'public.products'::regclass THEN
      RAISE EXCEPTION '事後閘:% 不是建在 public.products 上', v_n;
    END IF;
    -- ⑤ 欄位要對:索引名裡的那個欄名, 必須就是它實際索引的那一欄
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE c.relname = v_n AND n.nspname = 'public'
         AND v_n = 'products_' || a.attname || '_trgm_idx'
    ) THEN
      RAISE EXCEPTION '事後閘:% 索引到的欄位與它的名字對不上 ⇒ 建在別欄上了', v_n;
    END IF;
    -- ⑥ 只比【有判別力】的片段, 不逐字比整串(括號與空白跨 PG 版本會變 ⇒ 逐字比會在換版時假紅)
    IF pg_catalog.strpos(v_def, 'gin_trgm_ops') = 0 THEN
      RAISE EXCEPTION '事後閘:% 的定義裡沒有 gin_trgm_ops ⇒ 對 ILIKE ''%%x%%'' 用不上, 等於白建(定義:%)', v_n, v_def;
    END IF;
    IF pg_catalog.strpos(v_def, 'USING gin') = 0 THEN
      RAISE EXCEPTION '事後閘:% 不是 gin(定義:%)', v_n, v_def;
    END IF;
  END LOOP;
  RAISE NOTICE '事後閘通過(四支皆:在 public、indisvalid、非 partial、**建在 public.products 上**、**索引的欄位與名字相符**、含 gin_trgm_ops、USING gin)。🛑 **它們證不到的**:(a)**不驗查詢有沒有真的用到它** —— 那要 EXPLAIN, 而 planner 用不用是它的決定;(b)**不驗變快了沒** —— 驗收在檔尾那五格, 而且【只能在正式站跑】(本機 BSD libc 對中文抽零 trigram);(c)不驗一個中文字能不能產生足夠 trigram —— 見檔頭那句 show_trgm。';
END
$$;

-- ── rollback(一句,而它可以在交易外跑)──────────────────────────────────────
--   DROP INDEX CONCURRENTLY IF EXISTS public.products_title_trgm_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.products_subtitle_trgm_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.products_description_trgm_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.products_external_id_trgm_idx;
--   🔵 `DROP INDEX CONCURRENTLY` **也不能在交易塊內** ⇒ 要退場請 Sean 在 SQL Editor 逐句下。
--   ⚠️ 而退場是安全的:索引只影響速度, 不影響結果 ⇒ 拿掉之後回到今天的行為(慢, 但正確)。


-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 貼完的驗收(**只能在正式站跑**;本機 BSD libc 對中文抽零 trigram ⇒ 本機量到的沒有判別力)
--
-- ⛔ **我原本在事後閘的訊息裡寫「驗收在檔尾那五格」,而檔尾當時【只有 rollback】**
--    (codex must-fix)⇒ 📌 **我引用了一個我沒有寫的東西** ⇒ 補在這裡。
--
-- ── 基準線(貼之前,已量好,**不要重量**)────────────────────────────────────
--   對 https://shop.pcmmotorsports.com/api/search,每格 3–4 發取中位數,
--   帶 cache-buster + `cache:'no-store'`(`x-vercel-cache` 要是 MISS)
--   ```
--   ASCII 1 詞 rsv4                0.115–0.19 s
--   ASCII 2 詞 rpm rsv4            0.29–0.32 s
--   ASCII 8 詞                     0.65 s
--   中文 3 字 碳纖維               1.76 s      ← 🎯 **這一格是判別格(3 字, 抽得到 trigram)**
--   中文 1 字 貼                   1.70 s      ← 🔵 對照格(1 字, **理論上不會變快**)
--   中文1字 + 零結果 ASCII         1.70 s
--   ```
-- ── 貼完重跑同一組, 而判準【先寫在這裡】────────────────────────────────────
--   ✅ **成功** = 「碳纖維」那一格從 ~1.76 s 掉到 **< 0.5 s**
--   🔵 **而「貼」那一格【預期不會變】** —— 那不是失敗, 那是 trigram 的性質(見檔頭)
--      ⇒ 🛑 **不要把它讀成「索引沒接上」**;兩格一起看才分得出「沒接上」與「接上了但那一格本來就沒救」
--   🔴 **若連「碳纖維」都沒變快** ⇒ **那才是「索引沒被用到」** ⇒ 下一步是對正式庫跑:
--      `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM products_public
--         WHERE title ILIKE '%碳纖維%' OR subtitle ILIKE '%碳纖維%'
--            OR description ILIKE '%碳纖維%' OR external_id ILIKE '%碳纖維%'
--         ORDER BY id LIMIT 8;`
--      看它是 `Bitmap Index Scan` 還是 `Seq Scan`。
-- ── 🔴 而貼完要一起看的【代價】那一半(codex must-fix:我原本一格都沒寫)────────
--   四支 GIN 會讓**每一次寫入 products 都變貴**(WAL、備份、replication、VACUUM),
--   而 GIN 預設 `fastupdate=on` 的 pending list 清理會造成**偶發的延遲尖峰**。
--   ✅ 貼完量一次(唯讀):
--   ```sql
--   SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS 索引大小
--     FROM pg_stat_user_indexes WHERE relname='products' AND indexrelname LIKE '%trgm%';
--   ```
--   ⚠️ **而寫入變慢多少我沒有量,也沒有辦法在本機量** ⇒ **未確認**;
--      商品寫入是低頻(供應商匯入),而**「低頻」也是我沒有量過的說法** ⇒ 一併標未確認。
-- ═══════════════════════════════════════════════════════════════════════════
