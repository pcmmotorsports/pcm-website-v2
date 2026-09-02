-- ============================================================
-- ⟦c7-RPCDDLARCHIVED⟧ 把【已經在正式庫上跑著的】三支函式補進版控
-- ------------------------------------------------------------
-- pcm:never-apply
--   ↑ 🔴 **這一行是給機器讀的**(`scripts/migration-ledger-divergence.sh` 的第九格),
--     它讓本支印成「⑨ 刻意不套用」而不是「④ 待套 PENDING」。
--     ⚠️ **不要挪到 20 行以外** —— 那支腳本只讀檔頭前 20 行。
-- 🔴🔴🔴 **本支【不 apply 到正式庫】。它是空庫重放用的。**
--
-- ══ 為什麼不 apply(這是【理由】欄, 不是【風險】欄)══════════════════════════
--   那三支在正式庫上**已經存在** ⇒ `CREATE OR REPLACE` 貼上去只有兩種結果:
--     ① 簽章相同 ⇒ 換掉函式體, 而我們抄的就是它現在的體 ⇒ **零改動而看不出來**
--     ② 🔴 簽章有一格不同 ⇒ **它會【新建】一支**, 而新的帶【出廠預設 ACL】
--        ⇒ 📌 **「取代」與「新建」在事後的計數上長得一模一樣**
--           (那句話是 `20260827180000:352-357` 的斷言②自己寫的)
--     ③ ⛔ ~~正式庫若在 09-02 之後被手改 ⇒ CREATE OR REPLACE 會靜靜回捲那次手改~~
--   🔵 **2026-09-02 訂正:上面那三種【已經不成立了】, 因為本支改成【裸 `CREATE FUNCTION`】。**
--     `scripts/migration-static-checks.sh` 規則① 擋下了 `CREATE OR REPLACE`, 逐字:
--       「新物件一律裸 CREATE:撞名要當場紅。`OR REPLACE` 會把撞名靜靜蓋掉,
--         而你的 REVOKE 與斷言照樣綠 —— 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。」
--     🎯 **⇒ 而那道閘擋對了, 而且它順手把一個【我以為失去的保護】還給我**:
--       code-reviewer 先前指出「前例 `20260901170000` 是裸 `CREATE TABLE` ⇒ 誤貼會 `already exists`
--       ⇒ **ERROR + 回捲 + 出聲**;而本支是 `CREATE OR REPLACE` ⇒ 誤貼多半**安靜成功**
--       ⇒ 那個保護本支沒有繼承到。」
--     ✅ **⇒ 改成裸 `CREATE` 之後, 誤貼到正式庫 ⇒ `function … already exists`
--       ⇒ 整支交易回捲、零改動、而且它會出聲。⇒ 那個保護回來了。**
--     📌 **⇒ 我原本把「用 OR REPLACE」當成理所當然(因為我抄的是 `pg_get_functiondef` 的輸出,
--       而它就長那樣)—— 而那個「理所當然」帶著一個我沒注意到的行為改變。**
--
-- ══ 🔴 這一片在補什麼(而範圍比錨大)═══════════════════════════════════════
--   2026-09-02 唯讀實查:正式庫 `public` 有 **155** 支函式, 而其中 **3** 支
--   在 `supabase/migrations/` 裡找不到 `CREATE FUNCTION`(掃描前已剝 SQL 註解;
--   🟢 正對照 `coupon_redeem_order_problem` / `search_catalog_by_vehicle` ⇒ 兩支都找得到;
--   🔵 負對照 現造名字 ⇒ 找不到):
--     `pfe_staging_reset`           只有 service_role 執行得動
--     `pfe_sync_commit`             只有 service_role 執行得動
--     `search_products_by_vehicle`  🔴 **anon + authenticated + service_role**(顧客站車款搜尋)
--   📌 三支全是 fitments 那一條管線。
--   🛑 **而【兩張表】不是這一片的**(`-7d` 2026-09-02 用另一把尺獨立複量後收窄):
--      `product_fitments_effective_staging` / `..._sync_log` 的建表 DDL 也不在版控,
--      **而那是 `⟦b4-PFEDDL2⟧`(另一條線手上)** ⇒ 🔴 **本支一個字都不碰表**, 否則兩支會撞車。
--      ⚠️ 而序列 / PK 索引 / policy 那幾個**沒有人逐個查過** —— 它們多半跟著建表 DDL 一起來,
--      **而「多半」是推的不是量的**, 寫在這裡讓那一片的人自己驗。
--
--   🔴🔴 **而【被知道程度】那一格我寫錯了, 而錯法是【範圍被換掉】**(code-reviewer 抓、本窗複量):
--      我寫「前兩支全 repo **連提都沒提**(0 命中)· 第三支被提到 1 次」——
--      ⛔ **那組 0/1 是【只掃 `supabase/migrations/`】的數字, 而我貼進來時把範圍寫成「全 repo」。**
--      ✅ **全 repo 實測(2026-09-02 本窗)**:
--        `pfe_staging_reset` ⇒ **4** 支檔 · `pfe_sync_commit` ⇒ **5** 支 · `search_products_by_vehicle` ⇒ **16** 支
--        而第三支有**活的呼叫端**:`packages/adapters/src/supabase/helpers/fitment-queries.ts:132`
--      🎯 **⇒ 所以「前兩支要從零寫」那個推論【不成立】** —— 它們在 `database.types.ts`、板子、
--        backlog 裡都有;缺的只是**建它們的那一支 migration**。
--      📌 **⇒ 一個數字被搬過一次, 而搬的時候換了分母 —— 而換完之後它讀起來更有力。**
--      🛑 而板上 `⟦c7-RPCDDLARCHIVED⟧` 那一列寫的是對的(9 處註解與型別名 + 1 處真呼叫)
--        ⇒ **本檔曾經與它自己引的那個錨互相矛盾。**
--
-- ══ 🛑 來源 ═══════════════════════════════════════════════════════════════════
--   函式本體 = **正式庫現況**, 2026-09-02 唯讀 `pg_get_functiondef(oid)` **逐字**貼進來,
--   **沒有重打、沒有整理縮排**(唯一的加工是句尾補 `;`)。
--
--   🔵 **而封存檔那份【可以拿來對, 而且它對得上】**:
--     `docs/archive/2026-07-25-docs-cleanup/reviews/2026-07-12-s1-apply-sql.sql`
--     ⛔ ~~我原本寫「那份是 7-12 的、已經過期 ⇒ 拿它來比會比出不一致」~~
--     🔴 **那句話是【錯的】, 而它的錯法特別貴**(code-reviewer 抓、本窗複量):
--       實測 `search_products_by_vehicle` 兩份正規化後 **29 行 vs 29 行 · 差 1 行, 而那一行只差一個尾註解**
--       ⇒ 🎯 **邏輯逐字相同。**
--     📌 **⇒ 那句勸退把【「本檔抄對了」的唯一第二來源】推開了** ——
--       而一句過期的「這條路走不通」比一句過期的「這條路可以」貴, 因為**沒有人會去驗證一個勸退**。
--     ✅ **⇒ 正確的說法**:封存檔那份是 2026-07-12 的 ⇒ 它**可能**已經與正式庫分岔,
--       **而 2026-09-02 實測它沒有** ⇒ 要對就對, 只是對之前先確認它還是同一份。
--
-- ══ 授權(逐字釘住 —— 而 search_products_by_vehicle 那支是三支裡唯一 anon 叫得動的)══
--   正式庫實測 `proacl`:
--     pfe_staging_reset          ⇒ postgres=X , service_role=X
--     pfe_sync_commit            ⇒ postgres=X , service_role=X
--     search_products_by_vehicle ⇒ postgres=X , anon=X , authenticated=X , service_role=X
--   🔴 **空庫重建時若漏了那道 GRANT ⇒ 顧客站的車款搜尋會【對客人 403 而對我們正常】**
--      —— 因為我們自己走的是 service_role。⇒ 所以下面的斷言逐支逐角色驗。
-- ============================================================

BEGIN;

SET LOCAL search_path = public, pg_catalog;

-- ── pfe_staging_reset ─────────────────────────────────────────────────
CREATE FUNCTION public.pfe_staging_reset()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_deleted int;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  WITH del AS (DELETE FROM public.product_fitments_effective_staging WHERE true RETURNING 1)
  SELECT count(*)::int INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$function$;

-- ── pfe_sync_commit ───────────────────────────────────────────────────
CREATE FUNCTION public.pfe_sync_commit(p_run_id uuid, p_source_rows integer, p_orphan_rows integer, p_allow_anomaly boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_old int;
  v_new int;
  v_foreign int;
  rec record;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  SELECT count(*) INTO v_old FROM public.product_fitments_effective;
  SELECT count(*), count(*) FILTER (WHERE run_id <> p_run_id)
    INTO v_new, v_foreign
  FROM public.product_fitments_effective_staging;
  IF v_new = 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging empty, refuse swap (keep old % rows)', v_old;
  END IF;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging has % rows from another run, refuse swap (concurrent sync?)', v_foreign;
  END IF;
  IF v_old > 0 AND v_new < v_old AND (v_old - v_new)::numeric / v_old > 0.10 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: shrink % -> % exceeds 10 pct, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  IF v_old > 0 AND v_new > v_old * 2 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: growth % -> % exceeds 2x, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  FOR rec IN
    SELECT p.supplier_slug,
           count(*) FILTER (WHERE x.src = 'old') AS old_cnt,
           count(*) FILTER (WHERE x.src = 'new') AS new_cnt
    FROM (
      SELECT product_id, 'old'::text AS src FROM public.product_fitments_effective
      UNION ALL
      SELECT product_id, 'new'::text FROM public.product_fitments_effective_staging
    ) x
    JOIN public.products p ON p.id = x.product_id
    GROUP BY p.supplier_slug
    HAVING count(*) FILTER (WHERE x.src = 'old') > 0
       AND count(*) FILTER (WHERE x.src = 'new') = 0
  LOOP
    IF NOT p_allow_anomaly THEN
      RAISE EXCEPTION 'pfe_sync_commit: supplier % effective rows % -> 0, refuse swap (supplier vanished from source view?)', rec.supplier_slug, rec.old_cnt;
    END IF;
  END LOOP;
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  DELETE FROM public.product_fitments_effective WHERE true;
  INSERT INTO public.product_fitments_effective
    (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
  SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code
  FROM public.product_fitments_effective_staging;
  DELETE FROM public.product_fitments_effective_staging WHERE true;
  INSERT INTO public.product_fitments_effective_sync_log
    (status, source_rows, staged_rows, orphan_rows, old_count, new_count, note, run_id)
  VALUES ('success', p_source_rows, v_new, p_orphan_rows, v_old, v_new, p_note, p_run_id);
  RETURN jsonb_build_object('old_count', v_old, 'new_count', v_new);
END;
$function$;

-- ── search_products_by_vehicle ────────────────────────────────────────
CREATE FUNCTION public.search_products_by_vehicle(p_brand text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH matched AS (
    SELECT product_id FROM public.product_fitments
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
    UNION
    SELECT product_id FROM public.product_fitments_effective
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
  )
  SELECT jsonb_build_object(
    'id', p.id, 'external_id', p.external_id, 'title', p.title, 'subtitle', p.subtitle,
    'description', p.description, 'highlights', p.highlights, 'manuals', p.manuals,
    'video_url', p.video_url, 'handle', p.handle, 'fitments', p.fitments,
    'images', p.images, 'availability', p.availability,
    'brand_id', p.brand_id, 'category_id', p.category_id, 'price_general', p.price_general,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'brands', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
                                 'premium_extra_pct', b.premium_extra_pct),
    'categories', jsonb_build_object('raw_path', c.raw_path, 'segments', c.segments)
  )
  FROM public.products_public p
  JOIN matched      m ON m.product_id = p.id
  JOIN public.brands     b ON b.id = p.brand_id
  JOIN public.categories c ON c.id = p.category_id
  ORDER BY p.id;
$function$;

-- ── 授權:先收乾淨再給(形狀照 repo 既有前例)────────────────────────────────
--   🔴🔴 **我第一版把 `pfe_sync_commit` 寫成【無參數】—— 那是我【猜】的, 不是讀來的。**
--     replay 當場紅:`ERROR: function public.pfe_sync_commit() does not exist`。
--     真簽章 `(uuid, integer, integer, boolean, text)`(`pg_get_function_identity_arguments` 問出來的)。
--   🎯 **⇒ 而這支檔的檔頭自己就寫著「取代與新建在計數上長一樣, 只有簽章分得出來」**
--     —— 而我在同一支檔裡把簽章寫錯了。**⇒ 函式簽章要問 catalog, 不要從函式名推。**
--   🔴🔴 **而修它的第一發【沒有落地, 而我沒發現】**:我在 python 裡寫 `assert n==4`,
--     實際是 **7** 處 ⇒ 斷言擋下了(它做對了), 而我沒看它的輸出、直接去看 replay
--     ⇒ ⇒ **我拿一個沒改到的檔跑了三分鐘, 然後看到一模一樣的紅。**
--   📌 **⇒ 一個「我改好了」與一個「我以為我改好了」, 在下一發紅上長得一模一樣。**
--   🔴 **收的對象是【PUBLIC + 三個具名角色】, 不是只有 PUBLIC**(codex must-fix):
--     建立者的 **default ACL 可以直接授權給具名角色**(`ALTER DEFAULT PRIVILEGES … TO anon`)
--     ⇒ 只 `REVOKE … FROM PUBLIC` **收不到那一種** ⇒ 新函式會帶著一個沒人要的 grantee 出生。
--     🔵 而封存檔那份前例就是這個形狀(`FROM PUBLIC, anon, authenticated`)⇒ 我原本比它窄。
REVOKE ALL ON FUNCTION public.pfe_staging_reset()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pfe_sync_commit(uuid, integer, integer, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_products_by_vehicle(text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.pfe_staging_reset()       TO service_role;
GRANT EXECUTE ON FUNCTION public.pfe_sync_commit(uuid, integer, integer, boolean, text) TO service_role;
-- ACL-GATE-EXEMPT: public.search_products_by_vehicle -- 顧客站車款搜尋, 這道授權正式庫上早就有(Sean 2026-09-02 前就在跑), 本支只是把它補進版控且標 never-apply
--   🔵 而「誰在看它」那一格本支自己答得出來:同檔驗證④ 是 **ACL 閉世界比對**
--      (`aclexplode(proacl)` 全攤開, 含 `is_grantable`)⇒ **多一個角色、多一種權限、或多了可轉授, 它都會 RAISE。**
--   🛑 而那道斷言只在【空庫重放】那條路上燒 —— 因為本支 never-apply。
--      ⇒ 📌 **所以這個豁免的真正意思是:「這道 GRANT 不會被貼進正式庫, 而它在唯一會跑到它的那條路上有人看。」**
--   🔴 而它與 `20260902180000` 那兩個豁免【不同】:那兩個是真的要貼進正式庫的。
GRANT EXECUTE ON FUNCTION public.search_products_by_vehicle(text, text, integer)
  TO anon, authenticated, service_role;

-- ── 斷言 ─────────────────────────────────────────────────────────────────────
--   🎯 **目標換過了**(主視窗 2026-09-02 指出):本支 never-apply ⇒ 它驗的不是
--      「apply 到正式庫之後與現況相同」, 是【空庫 replay 之後那三支建得出來、
--       而且 SECURITY INVOKER 與 EXECUTE 授權是對的】。
DO $verify$
DECLARE
  r        record;
  v_secdef boolean;
  v_missing text;
  v_extra   text;
  v_cnt    int;
  -- 🔵 這張清單的形狀是 `scripts/migration-static-checks.sh` 規則③ 認得的那一種
  --    (`v_functions text[] := ARRAY[…]::text[]`)—— 它比對「可授權物件數 vs 斷言清單長度」,
  --    而它防的是**忘記把新物件列進斷言**, 不是忘記收權。
  v_functions text[] := ARRAY[
    'public.pfe_staging_reset()',
    'public.pfe_sync_commit(uuid, integer, integer, boolean, text)',
    'public.search_products_by_vehicle(text, text, integer)'
  ]::text[];
BEGIN
  -- ⓪ 角色都要在, 否則下面每一道 has_function_privilege 都失去意義
  FOR r IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) AS rolname LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname) THEN
      RAISE EXCEPTION '驗證⓪:角色 % 不存在 ⇒ 下面每一道斷言都失去意義', r.rolname;
    END IF;
  END LOOP;

  -- ①-a 🔴 **同名函式恰 1 支**(code-reviewer nit-2 + codex must-fix,兩邊各自獨立抓到):
  --    只驗「我要的那個簽章在」**不夠** —— 舊的 overload 活著時它照樣綠,
  --    而**兩支同名** ⇒ 具名參數呼叫 `42725 ambiguous` ⇒ 型錄整頁掛掉
  --    (`20260827180000:345` 逐字寫過同一條, 而我引了它的斷言②卻沒帶它的斷言①)。
  FOR r IN
    SELECT * FROM (VALUES
      ('pfe_staging_reset'), ('pfe_sync_commit'), ('search_products_by_vehicle')
    ) AS t(nm)
  LOOP
    SELECT count(*) INTO v_cnt
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.nm;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION
        '驗證①-a:public.% 應恰 1 支、實得 % 支 ⇒ overload 存活 ⇒ 具名參數呼叫會 42725 ambiguous', r.nm, v_cnt;
    END IF;
  END LOOP;

  -- ①-b 三支都要在, 而且【簽章要精確】——「取代」與「新建」在計數上長一樣, 只有簽章分得出來
  -- 🔵 吃上面那張 `v_functions` —— **同一份清單同時餵給守門與斷言**,
  --    而那讓「守門數到 3」與「斷言真的驗了 3 支」不會分岔。
  FOR r IN SELECT unnest(v_functions) AS sig LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      RAISE EXCEPTION '驗證①-b:精確簽章不存在 ⇒ %', r.sig;
    END IF;
  END LOOP;

  -- ② 🔴 三支都必須是 **SECURITY INVOKER**(正式庫實測 prosecdef = f, 三支皆是)。
  --    哪天有人把它改成 DEFINER ⇒ 函式用 owner(postgres)的身分跑
  --    ⇒ ⇒ **RLS 與表 ACL 對它就不成立了** ⇒ 那是一個授權層級的躍升, 必須有人看見。
  SELECT string_agg(p.proname, ', ') INTO v_extra
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pfe_staging_reset', 'pfe_sync_commit', 'search_products_by_vehicle')
     AND p.prosecdef;
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '驗證②:這幾支變成 SECURITY DEFINER 了 ⇒ % ⇒ 它們會用 owner 身分跑', v_extra;
  END IF;

  -- ③ 🔴 該有的授權一個都不能少 —— 而 search_products_by_vehicle 是三支裡唯一 anon 叫得動的。
  --    漏了它 ⇒ **顧客站的車款搜尋對客人 403, 而對我們正常**(我們走 service_role)。
  FOR r IN
    SELECT * FROM (VALUES
      ('public.pfe_staging_reset()',                            'service_role'),
      ('public.pfe_sync_commit(uuid, integer, integer, boolean, text)',                              'service_role'),
      ('public.search_products_by_vehicle(text, text, integer)', 'anon'),
      ('public.search_products_by_vehicle(text, text, integer)', 'authenticated'),
      ('public.search_products_by_vehicle(text, text, integer)', 'service_role')
    ) AS t(sig, rolname)
  LOOP
    IF NOT has_function_privilege(r.rolname, r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '驗證③:% 對 % 沒有 EXECUTE', r.rolname, r.sig;
    END IF;
  END LOOP;

  -- ④ 🔴🔴 **閉世界 —— 不是「列幾個不該有的去問」, 是【把 ACL 整個攤開來比】**(codex must-fix)。
  --    前一版逐條問「這個角色有沒有」⇒ 🔴 **一個【我沒列到的角色】拿到 EXECUTE, 它全綠;**
  --    而 `WITH GRANT OPTION` 也看不到(`has_function_privilege` 要另外問)。
  --    ✅ 改用 `aclexplode(proacl)` 把每一筆授權攤開, 與【預期集合】做全等比對。
  --    🔵 `grantee = 0` 是 PUBLIC —— 而 `pg_roles` 裡沒有 0 ⇒ 用 LEFT JOIN 並明文把它收進來
  --       (既有教訓:INNER JOIN 會把 PUBLIC 那一筆靜靜丟掉)。
  --    🛑 而 owner 那一筆(`postgres=X/postgres`)刻意排除:**空庫重放時 owner 是跑它的人**,
  --       釘住 owner 名字會讓這一格變成「誰跑的」而不是「授權對不對」。
  --    🔴 而 `is_grantable` 一併比:**可轉授**與「有 EXECUTE」是兩件事。
  SELECT string_agg(x.line, ' / ' ORDER BY x.line) INTO v_extra
    FROM (
      SELECT coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type
             || CASE WHEN a.is_grantable THEN '(可轉授)' ELSE '' END
             || ' → ' || p.proname AS line
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(p.proacl) a
        LEFT JOIN pg_roles g ON g.oid = a.grantee
       WHERE n.nspname = 'public'
         AND p.proname IN ('pfe_staging_reset', 'pfe_sync_commit', 'search_products_by_vehicle')
         AND a.grantee <> p.proowner            -- owner 那一筆不比(見上)
         AND NOT (
              a.privilege_type = 'EXECUTE' AND NOT a.is_grantable
              AND (
                   (p.proname IN ('pfe_staging_reset', 'pfe_sync_commit')
                    AND g.rolname = 'service_role')
                OR (p.proname = 'search_products_by_vehicle'
                    AND g.rolname IN ('anon', 'authenticated', 'service_role'))
              )
            )
    ) AS x;
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '驗證④:出現【預期集合以外】的授權 ⇒ %', v_extra;
  END IF;

  -- ⑤ 🟢 而閉世界擋的是「多」, 這一格擋「少」—— 兩格成對, 少了任一格都會有一個世界印綠。
  FOR r IN
    SELECT * FROM (VALUES
      ('public.pfe_staging_reset()',                            'service_role'),
      ('public.pfe_sync_commit(uuid, integer, integer, boolean, text)', 'service_role'),
      ('public.search_products_by_vehicle(text, text, integer)', 'anon'),
      ('public.search_products_by_vehicle(text, text, integer)', 'authenticated'),
      ('public.search_products_by_vehicle(text, text, integer)', 'service_role')
    ) AS t(sig, rolname)
  LOOP
    IF NOT has_function_privilege(r.rolname, r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '驗證⑤:% 對 % 沒有 EXECUTE', r.rolname, r.sig;
    END IF;
  END LOOP;

  RAISE NOTICE '✅ 20260902200000:三支函式已進版控 —— 多載數/簽章/SECURITY INVOKER/ACL 閉世界/該有的授權 五道全過';
END $verify$;

COMMIT;

-- ══ 🛑 這一支證不到什麼 ═══════════════════════════════════════════════════════
--   · 它證的是【從空庫重放時那三支建得出來、而且授權對】——
--     **不證明正式庫上現在那三支與本檔逐字相同**。那要另一發 `pg_get_functiondef` 去比,
--     而本檔是 2026-09-02 抄的 ⇒ 🔴 **正式庫哪天被手改, 本檔不會知道, 而它也不會紅。**
--   · 🔴 **它不會 apply** ⇒ 所以它守的是「重建那條路」, 不是「今天正在跑的那個東西」。
--   · 🔴🔴 **四道斷言沒有一道碰【函式體】** —— 它們驗簽章、驗 SECURITY INVOKER、驗授權,
--     而**本片唯一的動作就是抄那三段本體** ⇒ 🎯 **抄錯一行邏輯, 四道全綠。**
--     ✅ 而擋那一格的不是斷言, 是兩把獨立的尺:`database.types.ts`(由正式庫生成)對簽章,
--     與封存檔對本體 —— **兩把都是別人產的, 不是我打的。**
--   · ⚠️ 本檔斷言①只驗「精確簽章存在」, **沒驗多載數 = 1**
--     (`20260827180000:345` 逐字:overload 存活 ⇒ `42725 ambiguous` ⇒ 型錄全頁掛掉)。
--     空庫重放下不會發生, 而那是同族風險 ⇒ 寫著, 不假裝涵蓋。
--   · 那三支的**行為**本支一個字都沒驗 —— 它們是被逐字抄進來的, 而抄對了不代表它們是對的。
