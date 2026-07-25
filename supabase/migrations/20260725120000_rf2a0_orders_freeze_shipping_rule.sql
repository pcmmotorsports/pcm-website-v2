-- ═══════════════════════════════════════════════════════════════════════════
-- RF2a-0 — 凍結下單當時的運費規則與配送方式(退刷自動化線第 2 片)
-- ═══════════════════════════════════════════════════════════════════════════
-- 上位權威:docs/specs/2026-07-24-refund-automation-line-prd.md §0c(Sean 拍板 Q6=B
--   「下單凍結」)+ §4 RF2a-0 列 + §4b(B3 路線、第三欄+trigger 決定、殘餘風險表)。
--
-- 為什麼要凍結:退款要重算運費(RF1 `computeRefundQuote`)。若退款時讀「當下」規則,
--   規則一改、舊訂單的退款金額就與當初成交條件不一致 = 算錯錢。⇒ 每張單存當時規則的歷史快照。
--
-- 本檔內容:三個欄位 + 一個 BEFORE INSERT trigger + 兩條 CHECK + apply 時自檢。
--   (1)(2) `shipping_free_threshold` / `shipping_home_fee`:走 **B3 = 欄位 `NOT NULL DEFAULT`
--       凍結、零 `create_order` 改動**。實查依據:當前生效 `create_order` =
--       `20260719120000_m4a_b2_create_order_notification_email.sql`,其 `INSERT INTO public.orders`
--       為**具名 13 欄列**(`:471-477`)⇒ 新欄不在列內、由 DB DEFAULT 填。
--       ✅ 兩位審查者各自實查:`create_order` 是 orders 的唯一 INSERT 路徑;service_role 對 orders
--          無 INSERT/UPDATE(`20260611120000:239`)。PG11+ 加帶常數 DEFAULT 的欄位為 metadata-only。
--   (3) `shipping_method_at_checkout`:**Sean 2026-07-25 明確答「我可能會改運送方式,非常有可能」**
--       ⇒ 必須凍結。🔴 為何非做不可:運費金額**回推不出**原配送方式 —— 存 100 ⇒ 必為「宅配未達免運」;
--       存 0 ⇒ 可能「自取」**也可能**「宅配滿額免運」,分不出來。後台把 home 改 store 後,RF5 若按
--       當下 method 算(store→0)會**少扣運費 = 多退錢**。DEFAULT 不能引用同列其他欄位 ⇒ 只能用 trigger。
--       ⚠️ 這是 `public.orders` 上的**第一個 trigger**(實查:本 repo 對 orders 零 CREATE TRIGGER)。
--
-- 🔴 語意界線:凍結欄是**歷史快照**。規則變更要用**新 migration** `ALTER COLUMN ... SET DEFAULT`;
--   **絕不** UPDATE 既有列(那是改寫歷史成交條件)。三處必須同步(TS 常數 / create_order §7 CASE /
--   欄位 DEFAULT),#216 drift gate 已擴為三方比對並有負向突變實證。
--
-- ─────────────────────────────────────────────────────────────────────────
-- 🔴 執行順序是本檔的安全核心(Fable 對抗審查 F1)
-- ─────────────────────────────────────────────────────────────────────────
-- 本 repo 已實證 migration **不保證**跑在單一顯式交易內(`SET LOCAL` 在 migration 內是 no-op,
--   memory `reference_supabase-migration-set-local-is-noop`)⇒ **中途失敗會留下前段已生效的 DDL**。
-- 因此順序必須是:**加欄(可 NULL)→ 建 trigger → 回填 → SET NOT NULL → CHECK → 自檢**。
--   若反過來(先 SET NOT NULL 後建 trigger),中途失敗會留下「NOT NULL 已設、trigger 不存在」
--   ⇒ 之後**每一筆結帳的 INSERT 都違反 NOT NULL、結帳全斷**,直到有人手動重跑。
-- 另外 trigger 用「catalog 查不存在才 CREATE」而非 `DROP TRIGGER` + `CREATE TRIGGER` ——
--   後者兩個 statement 之間有「trigger 不存在但 NOT NULL 已生效」的斷單窗。
-- 半套用 SOP:**直接重跑本檔**(每段皆 idempotent)。⚠️ 有效期僅在 apply 窗內:一旦 Sean 真的
--   改過某單的配送方式、或未來調整運費規則,§3 的回填分支就不會再跑(欄位已 NOT NULL),
--   §3 內的全表值斷言也不會再被評估 —— 這是刻意的,避免它日後變成假陽性 RAISE。
--
-- 🔴 線上鎖風險(不過度宣稱):`lock_timeout = '3s'` 的作用是「每次取鎖最多等 3 秒,等不到就讓本
--   migration 失敗」,**不等於不會卡到客人** —— 等待中的 ACCESS EXCLUSIVE 仍會讓後到的 INSERT 排隊。
--   本次量級 33 列 / 216 kB(2026-07-25 實測),掃描為微秒級。⇒ 風險有界但非零,**建議低流量時段 apply**。
--
-- Rollback(forward-only 為原則):apply 後若已有新訂單,DROP 欄位會**永久丟失那些單的歷史快照**。
--   僅在「確認零新訂單」的緊急窗口才可人工:
--     DROP TRIGGER IF EXISTS orders_freeze_shipping_snapshot_bi ON public.orders;
--     DROP FUNCTION IF EXISTS public.orders_freeze_shipping_snapshot();
--     ALTER TABLE public.orders DROP COLUMN IF EXISTS shipping_free_threshold,
--       DROP COLUMN IF EXISTS shipping_home_fee, DROP COLUMN IF EXISTS shipping_method_at_checkout;
--
-- 安全面:`orders` 對 authenticated 有表級 GRANT SELECT + RLS own policy ⇒ 新欄只有「該單擁有者」
--   讀得到;內容是公開的運費規則與自己的配送方式,**非經銷價、非成本、無 tier 敏感值**。
--   anon 無 SELECT、service_role 無寫權、無相依 view / security_invoker view 因新欄改變曝露面。
--   RLS policy 與 GRANT 矩陣未變。trigger function 顯式 REVOKE(見 §2)。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. 取不到鎖就快速失敗(見上方鎖風險段;用 SET 而非無效的 SET LOCAL)──
SET lock_timeout = '3s';

-- ── 1. 三個凍結欄。方式欄先允許 NULL:trigger 與回填都還沒到位,不能先卡 NOT NULL ──
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_free_threshold integer NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS shipping_home_fee       integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS shipping_method_at_checkout text;

-- ── 2. trigger:先於 SET NOT NULL 建好(F1);建好後任何併發結帳都會自己填快照 ──
--   語意:**只在 INSERT 時抓一次**;之後 `shipping_method` 被後台改動,快照不受影響(= 要的行為)。
CREATE OR REPLACE FUNCTION public.orders_freeze_shipping_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  -- 🔴 無條件覆寫:呼叫端不得自行指定快照值(避免寫入與實際不符的歷史)。
  --    已知限制:未來若要匯入「歷史訂單」且其真實快照 != shipping_method,本 trigger 會覆蓋掉;
  --    屆時匯入流程必須改走專用路徑或暫時停用本 trigger,不要靠改這裡。
  NEW.shipping_method_at_checkout := NEW.shipping_method;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.orders_freeze_shipping_snapshot() IS
  'RF2a-0:BEFORE INSERT ON public.orders —— 把 shipping_method 凍結進 shipping_method_at_checkout。'
  ' 退款(RF5→RF1)只能讀快照欄;後台事後改 shipping_method 不影響已成立訂單的退款算法。'
  ' 無查詢、無跨表寫入、無例外路徑。無條件覆寫呼叫端給的值(見函式內註解的匯入限制)。';

-- 顯式 REVOKE(對齊本 repo 慣例;新 function 預設 PUBLIC EXECUTE 會漏)。
-- 🔴 為何 REVOKE 後 trigger 仍跑得動:PG 對 trigger function 的 EXECUTE 權限**只在 `CREATE TRIGGER`
--    當下檢查、觸發時不再檢查**(Fable 審查更正了前一版「因為 create_order 是 SECURITY DEFINER」
--    這個錯理由 —— 結論對、理由錯,照錯理由推論會誤判未來非 DEFINER 的寫入路徑需要補 GRANT)。
REVOKE ALL ON FUNCTION public.orders_freeze_shipping_snapshot() FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  -- 🔴 用「不存在才建」而非 DROP+CREATE:後者兩句之間有斷單窗(F1)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.orders'::pg_catalog.regclass
       AND tgname = 'orders_freeze_shipping_snapshot_bi'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER orders_freeze_shipping_snapshot_bi
      BEFORE INSERT ON public.orders
      FOR EACH ROW
      EXECUTE FUNCTION public.orders_freeze_shipping_snapshot();
  END IF;
END $$;

-- ── 3. 回填既有列 + SET NOT NULL(只在方式欄仍可 NULL 時跑=首次 apply)──
DO $$
DECLARE
  v_audit_changed bigint;
  v_fee_mismatch  bigint;
  v_bad_after     bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.orders'::pg_catalog.regclass
       AND attname = 'shipping_method_at_checkout'
       AND NOT attisdropped AND NOT attnotnull
  ) THEN
    RAISE NOTICE 'RF2a-0:方式快照欄已 NOT NULL,跳過回填(非首次 apply)';
    RETURN;
  END IF;

  -- 3a. 🔴 回填的前提必須在 **apply 當下**成立,不能只靠規劃日查過一次(Fable F2 = TOCTOU)。
  --   回填值 = 現在的 shipping_method;只有「從來沒人改過任何單的配送方式」時它才等於當時的值。
  SELECT pg_catalog.count(*) INTO v_audit_changed
    FROM public.admin_audit_log
   WHERE (before ? 'shipping_method' OR after ? 'shipping_method')
     AND (before ->> 'shipping_method') IS DISTINCT FROM (after ->> 'shipping_method');
  IF v_audit_changed <> 0 THEN
    RAISE EXCEPTION 'RF2a-0 中止:稽核顯示有 % 筆真的改過 shipping_method ⇒ 回填「快照=現值」會寫出錯的歷史。請人工從 admin_audit_log 逐筆還原原值後再套用',
      v_audit_changed;
  END IF;

  -- 3b. 獨立交叉檢:運費金額必須與配送方式自洽(store⇒0;home⇒未滿門檻收 100、滿額 0)。
  --   🔴 這條抓的是**稽核蓋不到**的路徑(例如有人直接用 SQL 改 shipping_method)。
  --   實測 2026-07-25:現行 33 列全數通過。
  SELECT pg_catalog.count(*) INTO v_fee_mismatch
    FROM public.orders
   WHERE (shipping_method = 'store' AND shipping_fee <> 0)
      OR (shipping_method = 'home'
          AND shipping_fee <> CASE WHEN subtotal >= 5000 THEN 0 ELSE 100 END);
  IF v_fee_mismatch <> 0 THEN
    RAISE EXCEPTION 'RF2a-0 中止:% 筆訂單的 shipping_fee 與 shipping_method 不自洽 ⇒ 該欄可能已被手動改過、回填會寫出錯的歷史。請人工逐筆確認',
      v_fee_mismatch;
  END IF;

  UPDATE public.orders
     SET shipping_method_at_checkout = shipping_method
   WHERE shipping_method_at_checkout IS NULL;

  ALTER TABLE public.orders ALTER COLUMN shipping_method_at_checkout SET NOT NULL;

  -- 3c. 回填結果自檢(只在本次真的回填後評估 ⇒ 不會在日後變成假陽性)
  SELECT pg_catalog.count(*) INTO v_bad_after
    FROM public.orders
   WHERE shipping_method_at_checkout IS DISTINCT FROM shipping_method
      OR shipping_free_threshold <> 5000
      OR shipping_home_fee <> 100;
  IF v_bad_after <> 0 THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:回填後仍有 % 筆列的凍結欄不正確', v_bad_after;
  END IF;

  RAISE NOTICE 'RF2a-0:回填完成、方式快照欄已 SET NOT NULL(稽核 0 筆真改動、運費交叉檢 0 筆不符)';
END $$;

-- ── 4. 值域守門 ──
--   🔴 已存在同名 constraint 時**不得只看名字就跳過**:殘留一條寬鬆的(用 OR 串、或 CHECK(true))
--      版本會讓壞值進得來 ⇒ 逐項驗形狀 + convalidated,不符即 RAISE。
DO $$
DECLARE
  v_condef    text;
  v_validated boolean;
BEGIN
  -- 4a. 兩個金額欄非負
  SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated INTO v_condef, v_validated
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::pg_catalog.regclass
     AND c.conname  = 'orders_shipping_rule_non_negative';
  IF v_condef IS NULL THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_shipping_rule_non_negative
      CHECK (shipping_free_threshold >= 0 AND shipping_home_fee >= 0) NOT VALID;
    ALTER TABLE public.orders VALIDATE CONSTRAINT orders_shipping_rule_non_negative;
  ELSIF v_condef !~ 'shipping_free_threshold[^)]*>= 0'
        OR v_condef !~ 'shipping_home_fee[^)]*>= 0'
        OR v_condef !~* ' AND '
        OR v_condef ~* ' OR '
        OR NOT v_validated THEN
    RAISE EXCEPTION 'RF2a-0 中止:orders_shipping_rule_non_negative 已存在但形狀/狀態不符(def=%, validated=%)—— 不覆寫、請人工檢查',
      v_condef, v_validated;
  END IF;

  -- 4b. 配送方式快照只能是 home|store。
  --   ✅ 安全:`create_order:304` 已白名單同兩值 ⇒ 本 CHECK **不會**改變結帳可接受的輸入;
  --      它擋的是「日後有人往快照欄寫別的值」。
  SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated INTO v_condef, v_validated
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::pg_catalog.regclass
     AND c.conname  = 'orders_shipping_method_at_checkout_whitelist';
  IF v_condef IS NULL THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_shipping_method_at_checkout_whitelist
      CHECK (shipping_method_at_checkout IN ('home', 'store')) NOT VALID;
    ALTER TABLE public.orders VALIDATE CONSTRAINT orders_shipping_method_at_checkout_whitelist;
  ELSIF v_condef !~ 'shipping_method_at_checkout'
        OR v_condef !~ 'home'
        OR v_condef !~ 'store'
        OR NOT v_validated THEN
    RAISE EXCEPTION 'RF2a-0 中止:orders_shipping_method_at_checkout_whitelist 已存在但形狀/狀態不符(def=%, validated=%)',
      v_condef, v_validated;
  END IF;
END $$;

-- ── 5. 欄位語意(給未來的人與 RF5 實作者)──
COMMENT ON COLUMN public.orders.shipping_free_threshold IS
  'RF2a-0(Q6=B):下單當時的免運門檻(整數、TWD 元)。歷史快照,**不是**當前設定。'
  ' 由欄位 DEFAULT 於 INSERT 時填入(create_order 的 INSERT 為具名欄位列、不含本欄)。'
  ' 🔴 RF5 組 RF1 引擎的 shippingRule 只能讀本欄,嚴禁 fallback 到程式端預設值。'
  ' 🔴 規則變更:新 migration SET DEFAULT,且與新版 create_order 同一支並以顯式交易包住;絕不 UPDATE 既有列。';

COMMENT ON COLUMN public.orders.shipping_home_fee IS
  'RF2a-0(Q6=B):下單當時未達免運門檻的宅配運費(整數、TWD 元)。歷史快照,**不是**當前設定。'
  ' 🔴 RF5 只能讀本欄、嚴禁 fallback;規則變更同上;不 UPDATE 既有列。';

COMMENT ON COLUMN public.orders.shipping_method_at_checkout IS
  'RF2a-0:下單當時的配送方式快照(home|store),由 BEFORE INSERT trigger 填入。'
  ' 🔴 RF5 重算運費**必須用本欄**,不可用 shipping_method —— 後者後台可事後改(Sean 明示會改),'
  ' 用它會讓 home 改成 store 的單少扣運費、多退錢。'
  ' 🔴 RF5 仍須 fail-closed:本欄若為非 home|store 的值(理論上被 CHECK 擋住)一律拒絕退款。';

-- ── 6. schema 形狀自檢(fail-closed;只驗結構、不驗全表值 —— 值的斷言在 §3 回填分支內)──
DO $$
DECLARE
  v_type_thr      text;
  v_type_fee      text;
  v_type_method   text;
  v_notnull_thr   boolean;
  v_notnull_fee   boolean;
  v_notnull_meth  boolean;
  v_def_threshold text;
  v_def_fee       text;
  v_validated_a   boolean;
  v_validated_b   boolean;
  v_trigger_cnt   bigint;
BEGIN
  SELECT a.atttypid::pg_catalog.regtype::text, a.attnotnull INTO v_type_thr, v_notnull_thr
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::pg_catalog.regclass
     AND a.attname = 'shipping_free_threshold' AND NOT a.attisdropped;
  SELECT a.atttypid::pg_catalog.regtype::text, a.attnotnull INTO v_type_fee, v_notnull_fee
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::pg_catalog.regclass
     AND a.attname = 'shipping_home_fee' AND NOT a.attisdropped;
  SELECT a.atttypid::pg_catalog.regtype::text, a.attnotnull INTO v_type_method, v_notnull_meth
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::pg_catalog.regclass
     AND a.attname = 'shipping_method_at_checkout' AND NOT a.attisdropped;

  IF v_type_thr IS DISTINCT FROM 'integer' OR v_type_fee IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:金額欄型別不是 integer(threshold=%, fee=%)', v_type_thr, v_type_fee;
  END IF;
  IF v_type_method IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:shipping_method_at_checkout 型別不是 text(=%)', v_type_method;
  END IF;
  IF NOT COALESCE(v_notnull_thr, false) OR NOT COALESCE(v_notnull_fee, false)
     OR NOT COALESCE(v_notnull_meth, false) THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:三欄未全為 NOT NULL(thr=%, fee=%, method=%)—— 疑為半套用殘留,重跑本檔或人工檢查',
      v_notnull_thr, v_notnull_fee, v_notnull_meth;
  END IF;

  -- DEFAULT 必須存在且**逐字等於** canonical 整數常數。
  --   🔴 不用「抽掉非數字再比」:那會把 `-5000` 抽成 `5000` 而通過。非 canonical 形狀一律 RAISE。
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) INTO v_def_threshold
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.orders'::pg_catalog.regclass AND a.attname = 'shipping_free_threshold';
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) INTO v_def_fee
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.orders'::pg_catalog.regclass AND a.attname = 'shipping_home_fee';
  IF v_def_threshold IS DISTINCT FROM '5000' OR v_def_fee IS DISTINCT FROM '100' THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:欄位 DEFAULT 非預期(threshold=%, fee=%;期望逐字 5000 / 100)',
      v_def_threshold, v_def_fee;
  END IF;

  SELECT c.convalidated INTO v_validated_a FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::pg_catalog.regclass
     AND c.conname = 'orders_shipping_rule_non_negative';
  SELECT c.convalidated INTO v_validated_b FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::pg_catalog.regclass
     AND c.conname = 'orders_shipping_method_at_checkout_whitelist';
  IF NOT COALESCE(v_validated_a, false) OR NOT COALESCE(v_validated_b, false) THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:CHECK constraint 缺少或未驗證(non_negative=%, method_whitelist=%)',
      v_validated_a, v_validated_b;
  END IF;

  -- trigger 必須存在、啟用、**指向正確的函式、且真的是 BEFORE INSERT FOR EACH ROW**。
  --   🔴 只驗名字不夠(Fable R2 nit;與 §4「同名 constraint 不得只看名字」同一標準):
  --      有人預建同名但指向別的函式、或掛在 UPDATE 的 trigger,只驗名字會靜默放行。
  --      `tgtype & 7 = 7` = ROW(1) + BEFORE(2) + INSERT(4)。
  SELECT pg_catalog.count(*) INTO v_trigger_cnt
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.orders'::pg_catalog.regclass
     AND t.tgname = 'orders_freeze_shipping_snapshot_bi'
     AND NOT t.tgisinternal
     AND t.tgenabled = 'O'
     AND t.tgfoid = 'public.orders_freeze_shipping_snapshot()'::pg_catalog.regprocedure
     AND (t.tgtype::int & 7) = 7;
  IF v_trigger_cnt <> 1 THEN
    RAISE EXCEPTION 'RF2a-0 自檢失敗:BEFORE INSERT trigger 不存在或未啟用(count=%)—— 🔴 沒有它,新訂單的方式快照會是 NULL 而被 NOT NULL 擋下、結帳會失敗',
      v_trigger_cnt;
  END IF;

  RAISE NOTICE 'RF2a-0 自檢通過:三欄 integer/integer/text 且 NOT NULL、DEFAULT=%/%、兩條 CHECK validated、trigger 已啟用',
    v_def_threshold, v_def_fee;
END $$;

RESET lock_timeout;
