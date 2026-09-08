-- 20260908090000 · ⟦b4-FITSYNC1⟧③ 車款適配同步新鮮度 RPC(SECURITY DEFINER)。
--
-- 🛑🛑 **草稿。未 apply。**
--
-- ══ 0. 它為什麼存在(一句)═══════════════════════════════════════════════════
--   碼那半已經寫好而**它在正式環境跑不動** —— 告警用的角色 `payment_confirmer`
--   **對全部 77 張表零直接權限**(那是**設計**:`20260611120000_m3_s2c_confirm_payment_rpc.sql:10`
--   逐字「零 table 權限」)⇒ 所有存取走 SECURITY DEFINER。**這支 RPC 就是那條路。**
--   🔵 在它貼上去之前, 那個告警的開關是 `null`(不查、不叫、不 503)。
--   ⇒ 貼完之後 TS 那半只改**一行**:`apps/storefront/src/app/api/cron/anomaly-alert/route.ts`
--     的 `fitmentFreshnessRpcName: null` ⇒ `'get_fitment_sync_freshness'`。
--
-- ══ 1. 🔴 判準寫死 `status = 'success'` —— 而那是【白名單, 不是黑名單】═══════════
--   ⛔ ~~`max(ran_at)`~~ —— 那條線 abort 時**照樣會寫一列**
--     ⇒ 會把「天天 abort」讀成「天天有更新」, 而那正是最該叫的那一種。
--   🔬 **實測 status 的寫入值**(2026-09-08 掃 `supabase/migrations/` + `scripts/`):
--        'success' ×4 · 'abort' ×3 · 'aborted' ×1
--   🔴 **⇒ 兩種失敗拼法並存** ⇒ 所以判準只認 `= 'success'`(白名單),
--      **不寫 `!= 'abort'`** —— 黑名單在跟**下一個沒想到的拼法**賽跑。
--      📎 同一個判斷 `CLAUDE.md` Git 紀律那段對 token 前綴做過(黑名單 ⇒ 只印名稱)。
--   🛑 **而這一維在 TS 那半【零守門】** —— 它搬進這支 RPC 了 ⇒ 本檔的事後閘⑤守它。
--
-- ══ 2. 🔵 `rows_seen` 是【分母】, 必須回 ══════════════════════════════════════
--   「一列都沒有」與「這套留痕從來沒裝過」印同一個結果, 而它們的下一步相反:
--   前者去看那台機器, 後者去貼 migration。⇒ TS 那側有 `fitmentEmpty` 專屬出口在接它。
--
-- ══ 3. ✅ 一格 plan 標「未確認」而現在量到了 ═════════════════════════════════
--   `20260902210000_m4b_pfeddl2_staging_and_sync_log.sql:172` 逐字
--     `ran_at      timestamptz NOT NULL DEFAULT now()`
--   ⇒ 🟢 **codex R1 標「沒確認」的那一格(ran_at 若是 `without time zone`,
--     TS 側 `Date.now()` 比較會受執行環境時區影響)—— 不成立, 它就是 timestamptz。**
--
-- ══ 4. 🔴🔴 我【推翻了自己 plan 裡的一條】—— 明寫, 不靜靜改掉 ═══════════════════
--   ⛔ ~~plan §3 逐字「`has_function_privilege('service_role', …)` 必須 f」~~
--   🛑 **那條錯了。** 它建立在線【權限】量到的「service_role 常常還開著」——
--      而**那個量測講的是【非預期的殘留】, 不是【這一族刻意的授權】。**
--   🔬 實查同族最近一支 `20260905060000_m4b_stuck_bank_orders_health.sql:207-208`:
--        GRANT EXECUTE … TO service_role;
--        GRANT EXECUTE … TO payment_confirmer;
--      而它的事後閘②白名單逐字是 `{owner, service_role, payment_confirmer}`(`:235-241`),
--      `:206` 逐字「`service_role` 保留 —— 它是平台角色, 而拿掉它不是本片的範圍」。
--   ⇒ ✅ **本檔照族內慣例授【兩個】角色。** 唯一的呼叫者仍是 `payment_confirmer`
--      (`apps/storefront/src/lib/payment/composition.ts:215` 逐字
--       `new PgAnomalyAlertReaderAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'), …)`)。
--   📌 **⇒ 一條在別的脈絡下正確的通則, 套到一個它沒涵蓋的項目上。**
--      (memory `feedback_a-correct-relaxation-applied-to-an-item-it-never-covered` 同型。)
--
-- ══ 5. 🛑 本檔答不出什麼(照實寫)═════════════════════════════════════════════
--   · `count(*)` 在那張表上多貴 —— **沒量。** 若它很大, `rows_seen` 可能要換成
--     `reltuples` 估計值, 🛑 **而那會換掉它的語意**(估計值會低估)
--     ⇒ 換之前要回來改 TS 那側的註解。
--   · 那張表的索引與 query plan —— **沒查。**
--   · 「它跑得動嗎」由 anomaly cron 下一輪實跑驗;本檔的事後閘只驗得到
--     **「它建起來了 / 誰叫得動 / 形狀對不對」**。
--
-- ══ 6. 順序 ════════════════════════════════════════════════════════════════
--   🟢 **本支不依賴任何未貼的 migration** —— 它只讀一張已存在的表。
--   🔴 而**碼那半必須先上線**才會有人叫它 ⇒ 反過來貼也安全(沒人叫 = 沒有作用)。

BEGIN;

-- 🔴🔴 **裸 `CREATE`, 不是 `CREATE OR REPLACE`**(`scripts/migration-static-checks.sh` ①
--    2026-09-08 當場抓到我)。理由逐字:**新物件一律裸 CREATE —— 撞名要當場紅。**
--    `OR REPLACE` 會把撞名【靜靜蓋掉】, 而下面的 REVOKE 與六道閘照樣全綠
--    ⇒ 📌 **拿到綠燈, 卻蓋掉了一個你不知道存在的東西。**
--    🔵 而它同時解掉一個我在本機量到的坑:`OR REPLACE` **沿用舊的 ACL**
--      ⇒ 在已經貼過的庫上「拿掉 GRANT 那一行」是一個【無效的突變, 而它印綠】。
CREATE FUNCTION public.get_fitment_sync_freshness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- 🔴🔴 **`SET search_path = ''`(空字串), 不是 `public, pg_catalog`。**
--    顯式列出 `public` 會把【可寫的 schema】排在 `pg_catalog` 前面, 而 repo 零處
--    `REVOKE CREATE ON SCHEMA public` ⇒ 那正是 SECURITY DEFINER 提權的標準路徑。
-- 🛑 **而它與下面四道 REVOKE 是【成對的】, 不可只取前半** ——
--    線【權限】2026-09-08 量到:3 支函式只收了 PUBLIC(而 anon/authenticated 仍有 EXECUTE),
--    其中 `sync_product_fitments` **沒有 `SET search_path`**, 與另外五支不一致。
--    🎯 那格的教訓不是「今天會出事」(它今天不是 DEFINER, 缺那格沒後果), 而是:
--       **下一個人把它改成 SECURITY DEFINER 的那一天, 缺的那一格【當場變成漏洞】,
--         而那次改動【不會紅】** —— 他改的是「加一個 SECURITY DEFINER」,
--         而漏洞來自一個他沒有動的地方。
-- 🔴 `SET` 子句必須在**這一句**裡, 不能靠一支舊的 `ALTER FUNCTION` 補 ——
--    未來有人用 `CREATE OR REPLACE` 改這支函式時, 那一句會把 `SET` 子句**整組換掉**
--    (memory `reference_create-or-replace-resets-set-clause`)⇒ 照抄舊 body 會把這格打回去。
SET search_path = ''
AS $fn$
DECLARE
  v_tbl    oid := pg_catalog.to_regclass('public.product_fitments_effective_sync_log');
  v_tbl_ok boolean;
  v_rows   bigint;
  v_last   timestamptz;
BEGIN
  IF v_tbl IS NULL THEN
    -- 🔴 表不在 ⇒ 回 rows_seen = 0 而 last_success_at = NULL。
    -- 🛑 **而 TS 那側【分不出】它與「表在而空的」** —— 那是刻意的:
    --    兩者的下一步都是「去看那條同步線裝好了沒」, 而信上逐字列了三種成因。
    RETURN pg_catalog.jsonb_build_object('rows_seen', 0::bigint, 'last_success_at', NULL);
  END IF;

  -- 🔴🔴 **驗 relkind 與 owner** —— `to_regclass` 對 view / sequence 也回非 NULL。
  --    表缺席時若有人在 `public` 建一支【同名 view】, 下面那句 `EXECUTE` 會用
  --    **DEFINER 的 owner 身分**去跑那支 view 的內容 ⇒ 那是提權面, 不只是「讀到錯的東西」。
  --    🛑 這一格**不回 rows_seen=0** —— 那會被讀成「還沒裝」而靜靜不告警。
  --       這是一個【有人種了東西進來】的世界, 它必須吵。(形狀照 `20260904240000`。)
  SELECT (c.relkind IN ('r', 'p')
          AND c.relowner = (SELECT p.proowner FROM pg_catalog.pg_proc p
                             WHERE p.oid = pg_catalog.to_regprocedure(
                               'public.get_fitment_sync_freshness()')))
    INTO v_tbl_ok
    FROM pg_catalog.pg_class c WHERE c.oid = v_tbl;
  IF NOT coalesce(v_tbl_ok, false) THEN
    RAISE EXCEPTION 'get_fitment_sync_freshness:public.product_fitments_effective_sync_log '
      '不是一張我們擁有的普通表(relkind/owner 不符)⇒ 拒絕以 DEFINER 身分讀它';
  END IF;

  -- 🔴 動態 SQL:那張表在【編譯本函式的當下】可能不存在 ⇒ 靜態參照會讓 CREATE 失敗。
  -- 🔵 兩個值一次查完 —— 分兩句查會讓 rows_seen 與 last_success_at 來自兩個時點,
  --    而「兩個各算一次的數字會分岔, 分岔時不會有東西叫」是本片一路在修的病。
  EXECUTE $q$
    SELECT pg_catalog.count(*)::bigint,
           pg_catalog.max(l.ran_at) FILTER (WHERE l.status = 'success')
      FROM public.product_fitments_effective_sync_log l
  $q$ INTO v_rows, v_last;

  RETURN pg_catalog.jsonb_build_object('rows_seen', v_rows, 'last_success_at', v_last);
END
$fn$;

COMMENT ON FUNCTION public.get_fitment_sync_freshness() IS
  '車款適配同步新鮮度(⟦b4-FITSYNC1⟧③)。零 PII —— 只回兩個值:留痕表的列數、'
  '以及【status = ''success''】那些列的最大 ran_at。'
  'last_success_at 為 NULL 而 rows_seen > 0 = 有列而沒有一列成功過(比「舊了」更嚴重);'
  'rows_seen = 0 = 什麼都沒量到(表空 / 從沒跑過 / 留痕被清掉 —— 這三種本函式分不出)。'
  '🔴 判準是白名單 status = ''success'', 不是黑名單 status != ''abort'' —— '
  '實測失敗值有 ''abort'' 與 ''aborted'' 兩種拼法, 黑名單在跟下一個拼法賽跑。';

-- 🔴 四道 REVOKE:FROM PUBLIC 收不到具名授權, FROM 具名 收不到 PUBLIC 授權。
--    形狀照 `docs/patterns/revoking-function-execute-in-supabase.md`
--    (逐字記過「新物件出生就自帶 anon 權限」「兩道 REVOKE, 少一道都是開的」)。
REVOKE ALL ON FUNCTION public.get_fitment_sync_freshness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_fitment_sync_freshness() FROM anon;
REVOKE ALL ON FUNCTION public.get_fitment_sync_freshness() FROM authenticated;
REVOKE ALL ON FUNCTION public.get_fitment_sync_freshness() FROM service_role;

-- 🔵 兩個角色, 理由見檔頭 §4(推翻我自己 plan 的那一條)。
GRANT EXECUTE ON FUNCTION public.get_fitment_sync_freshness() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_fitment_sync_freshness() TO payment_confirmer;

-- ══ 新物件收權斷言(樣板抄自 20260904240000, 只換清單)══════════════════════
--   🔵 它與下面那組事後閘**不重複**:本塊問「anon/authenticated 對【本檔新建的每個物件】
--      還有沒有權限」, 而事後閘問「這一支的形狀與白名單對不對」。
--   🛑 `scripts/migration-static-checks.sh` ③ 數的是**這個清單的長度** ——
--      它防「忘記收權」, **不防「忘記列」** ⇒ 清單漏一個物件, 那個物件就沒有人在問。
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_functions text[] := ARRAY['public.get_fitment_sync_freshness()']::text[];
  r         text;
  v_oid     oid;
  v_bad     int := 0;
  v_first   text;
  v_checked int := 0;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := pg_catalog.format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  -- 🔴 沒有分母的斷言不算通過 —— 清單被清空時它會靜靜全綠。
  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母, 不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限(第一個:%)。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON FUNCTION <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權, FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件, anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

-- ══ 事後閘(正負向矩陣, 不是只驗「有建起來」)═══════════════════════════════
DO $gate$
DECLARE
  v_fn text := 'public.get_fitment_sync_freshness()';
  v_def text;
BEGIN
  -- ① 建成了嗎
  IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
    RAISE EXCEPTION 'fitsync 閘①:函式沒建成(簽名打錯或 CREATE 失敗)。';
  END IF;

  -- ② 形狀:SECURITY DEFINER + search_path 空字串
  --    🔵 兩種形狀都收 —— PG 實際存的是 `search_path=""`, 而寫死單一形狀會在乾淨庫當場紅。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = v_fn::regprocedure
       AND p.prosecdef
       AND (p.proconfig @> ARRAY['search_path=""'] OR p.proconfig @> ARRAY['search_path='])
  ) THEN
    RAISE EXCEPTION 'fitsync 閘②:% 不是 SECURITY DEFINER + search_path='''' ⇒ 隔離沒生效。', v_fn;
  END IF;

  -- ③ ACL 白名單:除了 owner / service_role / payment_confirmer, 不得有別人。
  --    🔴 用 aclexplode 白名單, 不列舉角色名 —— 列舉是黑名單, 它跟下一個沒想到的角色賽跑。
  --    ⚠️ **射程**:`proacl` 是 NULL 時 PUBLIC 的預設權限**看不見**
  --       ⇒ 這裡用 `acldefault('f', proowner)` 補上那一份(那份 pattern 檔記過這一格)。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn::regprocedure
       AND a.grantee <> p.proowner
       AND a.grantee <> 'service_role'::regrole::oid
       AND a.grantee <> 'payment_confirmer'::regrole::oid
  ) THEN
    RAISE EXCEPTION 'fitsync 閘③:% 有 owner / service_role / payment_confirmer 以外的 grantee。', v_fn;
  END IF;

  -- ④ 🟢 **正對照:該拿到的人【真的】拿得到** ——
  --    🛑 少了這一格, 一支「四道 REVOKE 而 GRANT 打錯字」的版本會讓③全綠,
  --       而那封信永遠叫不動它 ⇒ 📌 **「沒有別人拿到」與「該拿到的人拿得到」是兩個宣稱。**
  IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'fitsync 閘④a:payment_confirmer 拿不到 % 的 EXECUTE ⇒ 告警那條路叫不動它。', v_fn;
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'fitsync 閘④b:service_role 拿不到 % 的 EXECUTE。', v_fn;
  END IF;

  -- ⑤ 🔴🔴 **判準那一維在 TS 那半【零守門】—— 它只活在這支函式的定義裡。**
  --    ⇒ 有人把 `status = 'success'` 改成 `max(ran_at)` 或改成黑名單 ⇒
  --      **三綠不紅、測試不紅、上面四道閘全綠**, 而「天天 abort」會被讀成「天天有更新」。
  --    ✅ 所以這一格直接對函式定義下斷言。
  --    ⚠️ **射程明寫**:它是**字面**尺 —— 有人改寫成等價而不同字面的寫法(例如
  --       `status IN ('success')`)⇒ 這一格會**假紅**。假紅會有人看;假綠不會。
  SELECT pg_catalog.pg_get_functiondef(v_fn::regprocedure) INTO v_def;
  IF pg_catalog.strpos(v_def, 'status = ''success''') = 0 THEN
    RAISE EXCEPTION 'fitsync 閘⑤:函式定義裡找不到 status = ''success'' ⇒ '
      '判準被換掉了(而 abort 也會寫一列 ⇒ max(ran_at) 會把天天失敗讀成天天有更新)。';
  END IF;

  -- ⑥ 🔴 **真的叫一次** —— 「它建起來了」與「它跑得動」是兩個宣稱。
  --    🔵 而它回什麼在這裡不判(表可能還沒有任何列)⇒ 只要不丟例外就算過。
  PERFORM public.get_fitment_sync_freshness();
END
$gate$;

COMMIT;
