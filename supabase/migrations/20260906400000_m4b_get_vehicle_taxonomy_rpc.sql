-- ═══════════════════════════════════════════════════════════════════════════
-- `get_vehicle_taxonomy()` —— 車輛下拉一發拿完, 不再分 13 頁
--   ⟦db-TAXONOMYVIEW⟧ · 主視窗 `-f8` 2026-09-06 裁【乙】。版本號 20260906400000
--   (掃全部本地+遠端分支後選的:20260906 的 340000 / 360000 / 380000 已被用掉)。
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── 病灶(量到的, 不是推的)──────────────────────────────────────────────
-- 顧客站的車輛下拉用 **anon** client 對 `public.vehicle_taxonomy_public`
-- `.range()` 分頁(每頁 1000、共 13 頁;`apps/storefront/src/lib/products.ts:866-890`),
-- 而 `anon` 的 `statement_timeout` 是 **3s**。
-- 🔴 正式 log 逐字:`第 5 頁(offset 4000)失敗: canceling statement due to statement timeout`(57014)
--    ⇒ 整包 throw ⇒ **永遠進不了快取** ⇒ 那就是「切分類要 3 秒」的真兇。
--
-- 🔬 EXPLAIN(`-f8` 2026-09-06 09:1x 用 pcm_readonly 量;⚠️ **本窗未自驗**):
--      OFFSET 0/1000   **108 ms**
--      OFFSET 4000     **843 ms**  ← Nested Loop Anti Join, 每頁從頭走到 offset
--      OFFSET 12000    **211 ms**  ← 計畫換成 Merge Append **全掃**
--    🎯 **全掃比翻到中間便宜** ⇒ 一發拿完不是妥協, 它本來就是這張表最快的走法。
--    🔴 而 EXPLAIN 的 843 ms 與正式站撞到 3 s 之間有 **3.5× 以上的落差**(併發 / 冷快取 /
--      PostgREST 那一層)⇒ **餘裕要按正式站算, 不是按 EXPLAIN 算。**
--
-- 🔬 牆鐘(`-f8` 09:2x, 同上未自驗):整包 `jsonb_agg` 三發 **738 / 756 / 756 ms**;
--    對照 `SELECT 1` 兩發 **479 / 482 ms**(連線 + 腳本固定成本)⇒ 查詢本身 ≈ **260–275 ms**。
--    按 3.5× 落差保守估 ≈ **0.9–1.0 s**, 對 anon 的 3 s 仍有 **3×**。
--
-- ── 為什麼是 RPC 回 jsonb, 而不是物化 view ─────────────────────────────────
-- 🛑 **物化 view 解不了這一題。** 它仍然是一個 relation ⇒ 仍然吃 PostgREST 的
--    `db-max-rows`(`docs/phase-1-backlog.md:10640` 實測 **2000**、標「未自驗」),
--    而這張表 **12,197 列**(`-f8` 2026-09-06 量;`products.ts:825` 記的 12,053 是 09-05)
--    ⇒ **改成 matview 之後照樣要翻 7 頁。**
-- ✅ 而**一個回 jsonb 的函式只回【一列】** ⇒ `db-max-rows` 對它不成立。
--    📌 **這是三個做法之間唯一的結構性差別** —— 其餘都是快慢。
-- 🔵 matview(backlog `#389`)不是錯的, 它是**另一題**(view 每次重算)。兩者不衝突。
--
-- 🔴🔴 **而這不只是快 —— 它關掉一個【正確性】缺口。**
--    `20260811100000` 的 DB COMMENT 逐字列著失效條件 (2):
--    「每日 16:10 sync 整表換 effective, **翻頁之間發生會讓某車型被跳過並進快取, 無告警**」
--    ⇒ 13 次往返本身就是那個缺口。一發拿完 = 一個快照, 順手關掉它。
--
-- ── 天花板 / 這支檔答不出什麼(先講, 不要讀成比它大)────────────────────
-- · 上面每一個效能數字都是 `-f8` 用 pcm_readonly 量的, **本窗沒有正式庫存取、未自驗**。
-- · payload 大小(`jsonb::text` 長度, gzip 前):array-of-arrays **490,120** bytes /
--   array-of-objects **734,060** ⇒ 省 **33%**(⛔ ~~我 plan 裡原寫「省一半以上」~~ —— `-f8` 量了, 那句是我猜的)。
--   **gzip 後沒有人量過**;Vercel 端反序列化的時間也**沒有人量過**。
-- · 它**不改變任何資料**, 也不改 `vehicle_taxonomy_public` 本身 —— 那支 view 一個字都沒動。
-- · **全有全無**:一旦逾時就整包沒有(與今天一樣)。換到的是餘裕從「843 vs 3000」變成「~275 vs 3000」。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 1. 函式本體 ────────────────────────────────────────────────────────────
--
-- 🔵 `SECURITY INVOKER`(不是 DEFINER):`anon` 對這支 view **本來就有 SELECT**
--    (`20260811100000:133` 逐字 `GRANT SELECT ON public.vehicle_taxonomy_public TO anon, authenticated;`)
--    ⇒ 不需要提權。📌 **能不用 DEFINER 就不用** —— DEFINER 要自己扛 search_path 與注入面。
-- 🔵 view 自己是 `security_invoker = false`, 那是它的設計(invoker 版會套底表 RLS 的下架 join,
--    `20260811100000` 檔頭實測 **3,047 ms** > anon 的 3 s)⇒ 本函式不碰那個決定。
-- 🔵 `SET search_path = ''` + 全部 schema-qualified:既有慣例, 不重複解釋。
--
-- 🔴🔴 **`n` 是【另一次獨立的 count(*)】, 不是 `jsonb_array_length(rows)` ——**
--    **而那是刻意的, 也是這支函式多花一次全掃的唯一理由。**
--    📌 `-f8` 要 app 端做「我拿到幾列 vs 它說幾列」那第四個數(鐵則 11 那一格)。
--    ⇒ 如果 `n` 是從同一個 `jsonb_agg` 推出來的, **兩個數永遠相等** ——
--      那是**同一把尺量兩次**, 一致不是效度(`00-work-rules` §6-b)。
--    ⇒ 只有獨立的 `count(*)` 才會在「聚合靜默漏了列」時與 `rows` 的長度分岔。
--    💰 代價:兩次全掃 ≈ 2 × 211 ms ≈ **422 ms**(EXPLAIN 值)。對 3 s 仍有 7×。
--       **這 211 ms 買的是判別力, 不是保險。**
-- 🔴 **裸 `CREATE` 不是 `CREATE OR REPLACE`**(`migration-static-checks.sh` 第①道當場擋下我的第一版):
--    這是**新物件** ⇒ 撞名要當場紅。`OR REPLACE` 會把撞名【靜靜蓋掉】, 而 REVOKE 與斷言照樣綠
--    ⇒ 📌 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
CREATE FUNCTION public.get_vehicle_taxonomy()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔴 獨立的一發 count(*) —— 見上面那段, 不要「順手」改成 jsonb_array_length。
    'n', (SELECT pg_catalog.count(*) FROM public.vehicle_taxonomy_public),
    -- 🔵 array-of-arrays 不是 array-of-objects:實測 490,120 vs 734,060 bytes(省 33%)。
    --    欄序固定 = [moto_brand, model_code, year_start, year_end], **app 端照這個順序解**。
    -- 🔵 `COALESCE(..., '[]')`:空表時 `jsonb_agg` 回 NULL ⇒ app 端會拿到 null 而不是空陣列
    --    ⇒ 那是兩種「沒有東西」而它們在 JSON 上長得不一樣。
    -- 🔴 `COALESCE` **不加 pg_catalog. 前綴** —— 它不是普通函式, 是 SQL 標準的保留語法,
    --    加前綴是【語法錯誤】, 而它**在 apply 的當下才炸**(靜態檢查看不到、三綠看不到)。
    --    抓到它的是 `scripts/pg-catalog-prefix-gate.py`, 不是我。
    'rows', COALESCE((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_array(v.moto_brand, v.model_code, v.year_start, v.year_end)
               ORDER BY v.moto_brand, v.model_code, v.year_start, v.year_end)
        FROM public.vehicle_taxonomy_public v
    ), '[]'::jsonb)
  );
$fn$;

COMMENT ON FUNCTION public.get_vehicle_taxonomy() IS
  '車輛下拉的四欄投影, 一發回完(⟦db-TAXONOMYVIEW⟧, -f8 2026-09-06 裁乙)。'
  '回 {n, rows}:rows = array-of-arrays [moto_brand, model_code, year_start, year_end], '
  'n = 另一次獨立的 count(*)。'
  '🔴 n 刻意【不】從 rows 推導 —— 它要讓呼叫端做「我拿到幾列 vs 它說幾列」那個對照, '
  '而從同一個聚合推出來的兩個數永遠相等 ⇒ 那是同一把尺量兩次。'
  '🔴 為什麼一發不分頁:anon 的 statement_timeout 是 3s, 而 OFFSET 4000 那頁實測 843ms(EXPLAIN)、'
  '正式站直接撞 3s(57014)⇒ 整包 throw ⇒ 永遠進不了快取。而【全掃只要 211ms】—— '
  '一發本來就是這張表最快的走法。'
  '🔴 為什麼不是物化 view:matview 仍是 relation ⇒ 仍吃 PostgREST db-max-rows(實測 2000), '
  '而本表 12,197 列 ⇒ 改完照樣要翻 7 頁。回 jsonb 的函式只回一列 ⇒ 那個上限不成立。'
  '🔵 它同時關掉一個正確性缺口:vehicle_taxonomy_public 的 COMMENT 失效條件 (2) —— '
  '每日 16:10 sync 換表若發生在翻頁之間, 會讓某車型被跳過並進快取且無告警。'
  '⚠️ 效能數字全部由主視窗用 pcm_readonly 量, 本函式的作者窗未自驗。'
  '⚠️ 全有全無:逾時就整包沒有。餘裕 ≈ 275ms vs 3000ms(按正式站 3.5x 落差保守估 ≈ 0.9-1.0s)。';

-- ── 2. 兩道 REVOKE, 再 GRANT ───────────────────────────────────────────────
-- 🔴 **新物件出生就自帶 anon 權限** —— 兩道 REVOKE 收的是【兩個不同來源】的預設:
--    一道收 PUBLIC(Postgres 內建), 一道收 anon/authenticated/service_role
--    (Supabase 的 pg_default_acl, 只在 supabase_admin 建的時候存在)。
--    📎 `docs/patterns/revoking-function-execute-in-supabase.md`
-- 🛑 而那兩道是**必要基線, 不是「已經關上」的證明** —— 下面第 3 節的斷言才是。
REVOKE ALL ON FUNCTION public.get_vehicle_taxonomy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vehicle_taxonomy()
  FROM anon, authenticated, service_role;
-- 🔵 顧客站用 anon;登入的客人走 authenticated ⇒ 兩個都要。
-- 🔴 **`acl-drift-gate` 當場擋下**,而它擋得對:「migration 裡所有 ACL 斷言都是 apply 時一次性
--    ⇒ 這一行 apply 之後,沒有東西會再紅」。⇒ 照它要的形狀寫明理由,不繞路。
--    ⚠️ 它同時警告了一條**更糟的路**:把這段改端給 Sean 貼 SQL Editor ——
--      那是本閘的盲區,線上改了而 repo 一個字都沒有。**沒有走那條。**
--    ⚠️ **物件名不帶括號** —— 那道閘的字集是 `[a-z0-9_."*]`(`acl-drift-gate.py:118`),
--      我第一版寫 `public.get_vehicle_taxonomy()` ⇒ **它沒認出來, 而照樣印同一句話**
--      ⇒ 📌 一個【格式沒對上】與一個【真的沒寫豁免】, 在它的輸出上長得一樣。
-- ACL-GATE-EXEMPT: public.get_vehicle_taxonomy -- 顧客站車輛下拉要 anon 直接叫(⟦db-TAXONOMYVIEW⟧, 20260906400000, -f8 2026-09-06 裁乙);不是 service_role 因為這條路走的是瀏覽器端的 anon key, 沒有 server 中介
GRANT EXECUTE ON FUNCTION public.get_vehicle_taxonomy() TO anon, authenticated;

-- ── 3. fail-closed 斷言(清單驅動)──────────────────────────────────────────
-- 🔵 清單寫成宣告式 `ARRAY[...]`、變數名必須是 `v_functions` / `v_relations` ——
--    `scripts/migration-static-checks.sh` 第③道取清單的 awk 是 `^[[:space:]]*v_(relations|functions)`,
--    名字沒對上時它會照樣印「列了 0 個」⇒ **格式沒對上與真的漏列, 在它的輸出上是同一句話。**
DO $acl$
DECLARE
  v_functions text[] := ARRAY['public.get_vehicle_taxonomy()']::text[];
  v_relations text[] := ARRAY[]::text[];   -- 本支不建任何 relation
  f text;
  r text;
  v_n bigint;
  v_len bigint;
  v_real bigint;
BEGIN
  FOREACH f IN ARRAY v_functions LOOP
    -- 🔴 該收的:PUBLIC 與 service_role 一格都不准有
    --    (service_role 走的是後台那條路, 它不需要這支車輛下拉的函式)
    FOREACH r IN ARRAY ARRAY['public','service_role'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '收權斷言失敗:% 對 % 還開著 EXECUTE(REVOKE 少了一個角色?或 proacl 是 NULL = 套用預設)', f, r;
      END IF;
    END LOOP;
    -- 🟢 正對照:該有的兩個必須【有】—— 少了這一格,「全部收光」會被判成成功
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF NOT pg_catalog.has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '收權斷言失敗:% 對 % 沒有 EXECUTE ⇒ 顧客站叫不到它(收過頭)', f, r;
      END IF;
    END LOOP;
  END LOOP;

  -- ── 判別力:函式回的東西真的等於那支 view 嗎 ──────────────────────────
  -- 🔴 **空庫重放讓路**(照 20260811100000 的先例, 窄寫):
  --    view 空 + 底表也空 ⇒ 正確行為, 跳過資料面斷言;
  --    view 空 + 底表有資料 ⇒ 真的壞了 ⇒ 照樣炸。
  SELECT pg_catalog.count(*) INTO v_real FROM public.vehicle_taxonomy_public;
  IF v_real = 0 THEN
    IF EXISTS (SELECT 1 FROM public.product_fitments)
       OR EXISTS (SELECT 1 FROM public.product_fitments_effective) THEN
      RAISE EXCEPTION 'get_vehicle_taxonomy:view 是空的而底表有資料 —— 底表或 anti-join 出事了';
    END IF;
    -- 🛑 **空庫這條路上, 下面每一格都是「0 = 0」⇒ 全數通過。**
    --    ⇒ 那不是覆蓋, 是讓路。誠實寫出來, 不要讀成「驗過了」。
    RAISE NOTICE 'get_vehicle_taxonomy:空庫重放 ⇒ 跳過資料面斷言(這【不是】驗過了)';
  ELSE
    SELECT (public.get_vehicle_taxonomy() ->> 'n')::bigint,
           pg_catalog.jsonb_array_length(public.get_vehicle_taxonomy() -> 'rows')
      INTO v_n, v_len;
    -- 🟢 ① 它說幾列 == view 真的幾列
    IF v_n IS DISTINCT FROM v_real THEN
      RAISE EXCEPTION 'get_vehicle_taxonomy:n=% 而 view 實際 % 列 ⇒ 兩者不合', v_n, v_real;
    END IF;
    -- 🟢 ② 我拿到幾列 == 它說幾列(第四個數;n 是獨立 count ⇒ 這一格有判別力)
    IF v_len IS DISTINCT FROM v_n THEN
      RAISE EXCEPTION 'get_vehicle_taxonomy:rows 長度 % 而 n=% ⇒ 聚合漏了列', v_len, v_n;
    END IF;
    -- 🟢 ③ 每一列都是四個元素(欄序固定是 app 端解析的前提)
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_array_elements(public.get_vehicle_taxonomy() -> 'rows') AS e
       WHERE pg_catalog.jsonb_array_length(e) <> 4
    ) THEN
      RAISE EXCEPTION 'get_vehicle_taxonomy:有列不是四個元素 ⇒ app 端的欄序假設破了';
    END IF;
    RAISE NOTICE 'get_vehicle_taxonomy:% 列, rows 長度 %(兩個獨立來源一致)', v_real, v_len;
  END IF;
END
$acl$;

COMMIT;
