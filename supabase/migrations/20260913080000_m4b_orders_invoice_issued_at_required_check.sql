-- 20260913080000 · M-4b 發票金額月統計 **P1b**:`orders` 加 CHECK「已開立 ⇒ 一定要有開立日」。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
-- 🔴🔴 **順序:P1a(`20260913040000`)→ P2(`20260913050000` RPC + 表單 TS 部署)→ 本支。反了會壞。**
--    前置閘②③ 釘「欄要在」「P2 那一代 RPC 要在正式庫」—— **不靠人記順序**。
--    版本號刻意比 P2 大(08 > 05):`db push` 按號碼順序跑, 號碼順序 = 貼的順序。
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼要拆出來(codex 2026-09-13 R1 must-fix, plan §7-bis ①)
-- ══════════════════════════════════════════════════════════════════
-- 三層必填的**最後一道**:表單(P2)· RPC(P2)· **本支 CHECK(擋任何 writer)**。
-- 🔴 它不能與加欄同一支:貼了 CHECK 而 P2 的 RPC 還沒上 ⇒ 舊 RPC 把單標成 issued **不寫日期**
--    ⇒ 每一次「已開立」登記都撞 CHECK ⇒ **登記功能整個壞掉**。⇒ 拆到 P2 之後。
-- 🔴 少了本支:一個未來的 writer(或一次手動 SQL)就能造出「已開立而沒日期」的列, **而月統計會安靜地少算它**。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔬 這條 CHECK 的 NULL 短路面 —— 拋棄式 PG 17.10 實測(2026-09-13, real / weak 兩張表, CHECK 一字未改)
-- ══════════════════════════════════════════════════════════════════
-- ```
-- 形狀   invoice_status <> 'issued' OR invoice_issued_at IS NOT NULL
-- 壞形狀 4 發全擋:INSERT (issued,NULL) ×real/weak · UPDATE 把 issued 的日期清成 NULL · UPDATE not_issued→issued 無日期
-- 好形狀 3 發全過:(issued,日期) · (not_issued,NULL) · (voided,NULL)
-- 🔴 NULL 短路面【開的】:直接求值 (NULL,NULL) ⇒ evaluates_to_null = t;
--    weak 表(拿掉 NOT NULL)那一列【進去了】;real 表被 not-null constraint 擋(訊息是 not-null 不是 check)
-- ⇒ 撐住它的是 `orders.invoice_status` 的 NOT NULL(`20260714120000:108`)
-- ```
-- ⇒ 📌 `scripts/null-shortcircuit-check-guard.test.ts` 兩張清單都登了(PROBED_OR_CHECKS + LOAD_BEARING_NOT_NULL)。
-- ⚠️ 而那支守門對「同一句多動作 ALTER」只回報第一個 DROP NOT NULL(plan §7-bis ⑤, 照 CLAUDE.md 不修)。
--    🔵 精確一點(codex 2026-09-13 nit):NOT NULL 被拿掉之後**放行的是 `(NULL, NULL)` 那一列**;
--       `('issued', NULL)` **仍然被本 CHECK 擋** ⇒ 不是整道 CHECK 失效, 是 NULL 那一面開了。
--
-- 🔵 **只擋 `issued`**:`not_issued` 本來就沒日期;`voided` 有沒有都放行 —— Q2 甲:作廢不計入統計 ⇒ 那個日期
--    不影響數字;擋它會擋住「作廢一張從沒登記過日期的舊單」, 而那是合法動作。
--
-- 冪等:無頂層 DML ⇒ 冪等宣告閘不叫。重跑 ⇒ **兩道**:① 前置閘①(CHECK 已在 ⇒ RAISE)② ADD CONSTRAINT 撞 42710。
-- 同一個 BEGIN…COMMIT ⇒ 任一道炸 ⇒ 整包回滾。
--
-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行, 不丟資料)
-- ══════════════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE public.orders DROP CONSTRAINT orders_invoice_issued_at_required;
-- 🔴 **退 P2 的 RPC 之前要先退本支** —— 舊 RPC 不寫日期 ⇒ 留著 CHECK 就每一次登記都撞(plan §6)。

BEGIN;

-- 🔴 `ADD CONSTRAINT` 取 ACCESS EXCLUSIVE 並做全表驗證;今天 9 列 ⇒ 瞬間, 而等待期仍可能排隊。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_cnt int;
  v_src text;
BEGIN
  -- 前置閘①:forward-only —— CHECK 已在就拒重跑
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.orders'::regclass
                AND conname = 'orders_invoice_issued_at_required') THEN
    RAISE EXCEPTION '前置閘①:orders_invoice_issued_at_required 已存在 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘②:欄要在(P1a 已貼)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname = 'invoice_issued_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘②:orders.invoice_issued_at 不在 ⇒ 先貼 20260913040000(P1a)';
  END IF;

  -- 🔴🔴 前置閘③:**P2 那一代 RPC 要在正式庫** —— 查函式定義本文, 不靠人記順序。
  --    舊代 RPC 不寫日期 ⇒ 本支貼了就讓每一次「已開立」登記撞 CHECK。
  --    判準:定義裡有 `invoice_issued_at` 與 `P9I01`(P2 那一代才有的字面)。
  --    ⚠️ **誠實標(codex 2026-09-13 nit)**:這是【字面辨識】, 不是【行為證明】—— 一支舊 RPC 的本體註解裡
  --      若有人寫了 `-- TODO invoice_issued_at / P9I01`, 兩個 strpos 就過, 而它仍然不寫日期。
  --      ⇒ 它擋的是「忘了貼 P2」這個【常見動作】, 擋不了「有人造一個假版本」。要行為證明得在拋棄式 PG
  --        真的呼叫一次 RPC 看它寫不寫 —— 那是貼板前的人工步驟, 不是 migration 做得到的事。
  SELECT pg_catalog.pg_get_functiondef('public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure)
    INTO v_src;
  IF v_src IS NULL
     OR pg_catalog.strpos(v_src, 'invoice_issued_at') = 0
     OR pg_catalog.strpos(v_src, 'P9I01') = 0 THEN
    RAISE EXCEPTION '前置閘③:正式庫的 admin_update_order_workflow 還是舊代(不寫 invoice_issued_at)⇒ 先貼 20260913050000(P2)並部署表單, 否則本支會讓每一次登記都撞 CHECK';
  END IF;

  -- 🔴🔴 前置閘④:**已開立而沒日期的單必須是 0 張** —— 這一格決定那道 CHECK 加不加得下去。
  --    🛑 **非 0 不要繞**(不要 NOT VALID、不要回填假日期):
  --      回填一個假日期 = 把猜測寫成事實, 而那個日期正是月統計唯一的依據。
  --      ⇒ 這時 P2 已經上了 ⇒ 去後台把那幾張的開立日**用真的日期**登記好(RPC 會逼你填), 再貼。
  SELECT count(*) INTO v_cnt
    FROM public.orders
   WHERE invoice_status = 'issued' AND invoice_issued_at IS NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘④:有 % 張 issued 而沒有開立日 ⇒ 先在後台用真的日期登記好再貼, 不要回填假日期', v_cnt;
  END IF;

  -- 前置閘⑤:值域裡有 'issued'(本支的 CHECK 引用那個字面;不在 ⇒ CHECK 恆真 = 等於沒加)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_src
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass AND c.conname = 'orders_invoice_status_check';
  IF v_src IS NULL OR pg_catalog.strpos(v_src, '''issued''') = 0 THEN
    RAISE EXCEPTION '前置閘⑤:orders_invoice_status_check 的值域裡沒有 issued ⇒ 本支的 CHECK 會恆真 [%]', coalesce(v_src, '(NULL)');
  END IF;
END
$precondition$;

-- 🔴🔴 **三層必填的最後一道 —— 擋任何 writer。**
--    用 `CHECK` 不用 trigger(照 `20260904224500:201-203`):CHECK 管的是那一列的狀態 ⇒ INSERT 與 UPDATE 一視同仁,
--    順序繞不過去(先填狀態再清日期 / 直接 INSERT 一張違規單, 都擋 —— 拋棄式 PG 四發實測)。
ALTER TABLE public.orders
  ADD CONSTRAINT orders_invoice_issued_at_required
  CHECK (invoice_status <> 'issued' OR invoice_issued_at IS NOT NULL);

COMMENT ON CONSTRAINT orders_invoice_issued_at_required ON public.orders IS
  $c$三層必填的最後一道(表單 / RPC / 本 CHECK):已開立的單一定要有開立日(2026-09-13 P1b)。
只擋 issued;not_issued 與 voided 有沒有日期都放行(理由在 20260913080000 檔頭)。
🔴 NULL 短路面是開的, 撐住它的是 invoice_status 的 NOT NULL —— 有人 DROP 那個 NOT NULL, 本 CHECK 會安靜失效
(CHECK 求值成 NULL 時 PostgreSQL 放行)。守它的是 scripts/null-shortcircuit-check-guard.test.ts 的承重清單。
🛑 貼之前 issued 而無日期必須是 0 張;非 0 不要 NOT VALID、不要回填假日期 —— 去後台用真的日期登記好再貼。$c$;

DO $postcheck$
DECLARE v_def text;
BEGIN
  -- 事後閘①:CHECK 在、是 CHECK、**字面對**(兩個述詞都在 —— 少了字面那一半, 一道 CHECK (true) 也會讓「存在」過)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass
     AND c.conname = 'orders_invoice_issued_at_required'
     AND c.contype = 'c';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:加完找不到 orders_invoice_issued_at_required(或它不是 CHECK)';
  END IF;
  IF pg_catalog.strpos(v_def, 'invoice_status') = 0
     OR pg_catalog.strpos(v_def, 'invoice_issued_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '事後閘①b:CHECK 的字面不含預期的兩個述詞 [%]', v_def;
  END IF;

  -- 🔴 事後閘②:是 **VALID**(不是 NOT VALID 混進來的)—— NOT VALID 對既有列不驗, 而本支的前提是既有列零違反。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.orders'::regclass
                AND conname = 'orders_invoice_issued_at_required'
                AND NOT convalidated) THEN
    RAISE EXCEPTION '事後閘②:orders_invoice_issued_at_required 是 NOT VALID ⇒ 既有列沒被驗過, 前置閘④ 被繞了';
  END IF;

  -- 🔴 事後閘③:撐住 NULL 短路面的那個 NOT NULL **還在**(貼的當下量一次;之後靠守門測試)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.orders'::regclass
                    AND a.attname = 'invoice_status'
                    AND a.attnum > 0 AND NOT a.attisdropped
                    AND a.attnotnull) THEN
    RAISE EXCEPTION '事後閘③:orders.invoice_status 不是 NOT NULL ⇒ 本 CHECK 的 NULL 短路面是開的, 它會安靜失效';
  END IF;

  -- 🟢 事後閘④(**負對照**):同一把尺問一個現造的約束名 ⇒ 要回 NULL。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.orders'::regclass AND conname = 'zzz_never_a_constraint') THEN
    RAISE EXCEPTION '事後閘④(負對照):現造的約束名居然存在 ⇒ 這把尺壞了';
  END IF;

  RAISE NOTICE '20260913080000(P1b)落地:orders_invoice_issued_at_required VALID;invoice_status NOT NULL 仍在';
END
$postcheck$;

COMMIT;
