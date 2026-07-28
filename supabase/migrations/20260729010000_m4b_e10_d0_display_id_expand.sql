-- ============================================================
-- M-4b E10 第 1 批 · D0:訂單編號改號的 expand 片(零行為改動)
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 表第 4 列(D0)、
--       §5.4a(產號合約)、§8.1(fulfillment_status 停止維護)、§8.4 步驟 11/13、§7.1。
-- 片型 M(migration;純 schema、無 trigger、無 DB 函式、無 app 行為)。
--
-- 本片做四件事,全部是 expand:
--   1. orders.legacy_display_id —— 改號後客人手上的舊單號永久 alias(A9b1 搜尋要吃)
--   2. orders_display_id_format CHECK 放寬 —— 暫時同時接受舊 PCM-YYYY-NNNN 與新 6 碼
--   3. orders.fulfillment_status 掛 COMMENT —— Q1=B 之後這欄停止維護,值是 legacy stale
--   4. pending_invoices_status_check 加 'voided' —— 不加,D1c 步驟 13 會被 CHECK 當場擋掉
--
-- 🔴 本片可重播、不含任何 production 識別值,與 D1 runbook 嚴格分開(v2 §7.1)。
-- 🔴 CHECK 的最終狀態是「新格式 only」,收緊由 N3c 負責(v2 §8.4:D0 放寬 → N3c 收緊)。
--    現在就收緊會讓結帳全斷 —— D1 之後、N3b 換產號器之前,create_order 仍在產舊格式。
--
-- 相容性:create_order 系列 RPC 走具名欄位 INSERT,新增 nullable 無 default 欄
--    會自動補 NULL(RF2a-0 已用交易模擬證過同一模式;本片 5.1 直接斷言無 default)。
--
-- ── 對抗審查紀錄(codex 關卡2,-m gpt-5.6-sol)──────────────────────
-- R1 = FAIL 9 must-fix,全部接受、零駁回,已折入:
--   ①加 lock_timeout(ALTER TABLE 的 ACCESS EXCLUSIVE 鎖持有到 COMMIT,
--     一筆未結束的 orders 查詢就能讓本片等鎖並堵住 create_order)
--   ②驗收改「精確定義比對 + 行為探針」雙軌(原用 position 找子字串,
--     regex 被放寬成 {1,6} 也照樣全綠 = 假綠)
--   ③補 column_default IS NULL 斷言  ④補 contype 與精確定義斷言
--   ⑤補 ACL 矩陣  ⑥rollback 改 forward-only down migration 指引
-- R2 = 7 條關閉、2 條部分關閉 + 新 findings,已再折入:
--   ⑦ACL 補 TRUNCATE、service_role 正向 SELECT、pending_invoices 寫權矩陣、
--     以及 has_table_privilege 抓不到的【欄級】寫權(column_privileges 實查)
--   ⑧RLS 改成【整組 policy 精確比對】(原本只找含 customer_user_id 的 policy,
--     再加一條 permissive USING(id IS NOT NULL) 就能繞過)
--   ⑨sentinel 改自訂 SQLSTATE、負向探針核對 CONSTRAINT_NAME、探針值先驗不撞、
--     空表時 NOTICE 不得把 skipped 講成 passed
--
-- 🟡 兩條 R2 findings 刻意【不在本片處理】,交 Sean 判(見交接報告):
--   (a) 顯式 BEGIN/COMMIT 與 Supabase CLI ledger 的原子性 —— 這是 repo 全域慣例
--       (現有 migration 全部這樣寫),不在單一片內破例;要改是全 repo 的決定。
--   (b) 精確定義比對對 PostgreSQL 版本敏感 —— 已知取捨:未來 PG 若改變
--       pg_get_constraintdef 的算繪格式,本片在新環境會【明確失敗並印出預期 vs 實際】,
--       是 fail-closed 不是資料風險。預期字串取自 2026-07-29 production 實查算繪。
-- ============================================================

BEGIN;

-- 🔴 等鎖上限:取不到鎖就失敗,絕不長時間持 ACCESS EXCLUSIVE 卡住結帳。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. legacy_display_id(改號前的舊單號;永久保留、可查)──────────
ALTER TABLE public.orders
  ADD COLUMN legacy_display_id text;

-- UNIQUE 約束自帶唯一索引 ⇒ 規格說的「unique + 索引」一個約束就滿足,不另建 index。
-- Postgres 的 UNIQUE 對 NULL 不設限 ⇒ 未改號的單全是 NULL、互不衝突,正是要的語意。
ALTER TABLE public.orders
  ADD CONSTRAINT orders_legacy_display_id_key UNIQUE (legacy_display_id);

-- 格式守門:本欄只存「改號前的舊格式單號」。唯二 writer(D1c 步驟 11、N3c 逐列改號)
-- 寫進來的都是舊格式;寫進新格式值 = 有人把新舊搞反,寧可當場擋下。
ALTER TABLE public.orders
  ADD CONSTRAINT orders_legacy_display_id_format
  CHECK (legacy_display_id IS NULL OR legacy_display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$');

COMMENT ON COLUMN public.orders.legacy_display_id IS
  'E10 訂單編號改 6 碼之前的舊單號(PCM-YYYY-NNNN)。非 NULL = 這張單改過號;客服與單號搜尋(A9b1)必須同時比對本欄與 display_id,否則客人拿舊號查不到。永久保留、不清空。';

-- ── 2. display_id CHECK 放寬成暫收新舊兩種格式 ────────────────────
-- 新格式合約見 v2 §5.4a:28 字元字母表(去 0O1IL 易混淆、去 AEU 母音)、固定 6 碼、無前綴。
ALTER TABLE public.orders
  DROP CONSTRAINT orders_display_id_format;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_display_id_format
  CHECK (
    display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$'
    OR display_id ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$'
  );

COMMENT ON CONSTRAINT orders_display_id_format ON public.orders IS
  'E10 D0 放寬:暫時同時接受舊格式 PCM-YYYY-NNNN 與新 6 碼格式。🔴 這是過渡狀態 —— N3c 會在收窗後把本約束收緊成新格式 only。';

-- ── 3. fulfillment_status 停止維護的告示 ──────────────────────────
-- 🔴 措辭不得寫成「衍生顯示」—— 沒有 writer 在維護的欄位叫衍生顯示,
--    會讓後人以為它跟得上真相(v2 §8.1 逐字要求)。
COMMENT ON COLUMN public.orders.fulfillment_status IS
  'E10 起停止維護、值為 legacy stale、不得當現況真相。Sean 2026-07-28 拍 Q1=B:訂單層彙總狀態不維護,出貨/訂貨進度的真相在 order_items 的計數器與其明細表。本欄保留不 DROP 只為避免破壞既有 enum 型別依賴;任何新程式不得讀取本欄做判斷。';

-- ── 4. pending_invoices 允許 voided ───────────────────────────────
ALTER TABLE public.pending_invoices
  DROP CONSTRAINT pending_invoices_status_check;

ALTER TABLE public.pending_invoices
  ADD CONSTRAINT pending_invoices_status_check
  CHECK (status IN ('pending', 'issued', 'voided'));

COMMENT ON CONSTRAINT pending_invoices_status_check ON public.pending_invoices IS
  'E10 D0 加入 voided:訂單作廢/清理後,待開票紀錄改標 voided 而非刪除(保留憑證軌跡)。';

-- ── 5. 收工驗收(fail-closed;任一條不成立 = 整片回滾)──────────────
DO $$
DECLARE
  v_def      text;
  v_expected text;
  v_cnt      integer;
  v_rows     integer;
  v_probe_id uuid;
  v_cname    text;
  v_probed   boolean := false;
BEGIN
  -- 5.1 legacy_display_id 欄存在、nullable、text、且【無 default】
  --     無 default 是「具名欄位 INSERT 自動補 NULL」相容性論證的前提;
  --     若誤加固定 default,第一筆結帳寫進假 alias、第二筆就撞 UNIQUE。
  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema     = 'public'
     AND table_name       = 'orders'
     AND column_name      = 'legacy_display_id'
     AND is_nullable      = 'YES'
     AND data_type        = 'text'
     AND column_default IS NULL;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders.legacy_display_id 應為 1 個 nullable/text/無 default 欄,實 % 個', v_cnt;
  END IF;

  -- 5.2 四個約束的【型別 + 精確定義】逐一比對(不只數名稱;預期字串取自 production 實查算繪)
  v_expected := 'UNIQUE (legacy_display_id)';
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_legacy_display_id_key'
     AND contype = 'u' AND convalidated;
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders_legacy_display_id_key 定義不符;預期 [%],實際 [%]', v_expected, COALESCE(v_def, '(不存在或未驗證)');
  END IF;

  v_expected := 'CHECK (((legacy_display_id IS NULL) OR (legacy_display_id ~ ''^PCM-[0-9]{4}-[0-9]{4,}$''::text)))';
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_legacy_display_id_format'
     AND contype = 'c' AND convalidated;
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders_legacy_display_id_format 定義不符;預期 [%],實際 [%]', v_expected, COALESCE(v_def, '(不存在或未驗證)');
  END IF;

  v_expected := 'CHECK (((display_id ~ ''^PCM-[0-9]{4}-[0-9]{4,}$''::text) OR (display_id ~ ''^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$''::text)))';
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_display_id_format'
     AND contype = 'c' AND convalidated;
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders_display_id_format 定義不符(錨點/長度/字母表任一被改都落在這裡);預期 [%],實際 [%]', v_expected, COALESCE(v_def, '(不存在或未驗證)');
  END IF;

  v_expected := 'CHECK ((status = ANY (ARRAY[''pending''::text, ''issued''::text, ''voided''::text])))';
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.pending_invoices'::regclass AND conname = 'pending_invoices_status_check'
     AND contype = 'c' AND convalidated;
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'D0 驗收失敗 — pending_invoices_status_check 定義不符;預期 [%],實際 [%]', v_expected, COALESCE(v_def, '(不存在或未驗證)');
  END IF;

  -- 5.3 既有訂單在放寬後的 CHECK 下全部合法(放寬不該擋掉任何一張)
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE display_id !~ '^PCM-[0-9]{4}-[0-9]{4,}$'
     AND display_id !~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — 有 % 張既有訂單的 display_id 不符放寬後的兩種格式', v_cnt;
  END IF;

  -- 5.4 行為探針:證明約束「實際擋得住」,不只是定義長得對。
  --     一律在子交易內做,靠自訂 SQLSTATE 的 sentinel 例外強制回滾,零資料殘留。
  --     (sentinel 用 SQLSTATE 'PC001' 而非訊息字串比對 —— 訊息可能與真實錯誤撞名。)
  SELECT count(*) INTO v_rows FROM public.orders;
  IF v_rows > 0 THEN
    -- 探針值必須不與既有資料衝突,否則會撞 UNIQUE 產生與本片無關的假紅
    IF EXISTS (
      SELECT 1 FROM public.orders
       WHERE display_id IN ('YWP3PC', 'PCM-2026-9999', 'YWP3P0', 'ywp3pc', 'YWP3P', 'YWP3PCX')
          OR legacy_display_id = 'PCM-1999-0001'
    ) THEN
      RAISE EXCEPTION 'D0 驗收失敗 — 探針值與既有資料衝突,請改用其他探針值(這不是 schema 問題)';
    END IF;

    SELECT id INTO v_probe_id FROM public.orders ORDER BY id LIMIT 1;
    v_probed := true;

    -- 正向:合法新 6 碼必須可寫(否則 D1c 改號會被擋)
    BEGIN
      UPDATE public.orders SET display_id = 'YWP3PC' WHERE id = v_probe_id;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 放寬後的 CHECK 竟拒絕合法新 6 碼格式';
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 正向:舊格式必須仍可寫(D1→N3b 窗口期的新單靠這個,擋掉 = 結帳全斷)
    BEGIN
      UPDATE public.orders SET display_id = 'PCM-2026-9999' WHERE id = v_probe_id;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 放寬後的 CHECK 竟拒絕舊格式(結帳會全斷)';
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 負向:含易混淆字元 0 的 6 碼必被【本片的約束】擋下(核對 CONSTRAINT_NAME,
    --       避免被別的約束擋下卻誤判成本片生效)
    BEGIN
      UPDATE public.orders SET display_id = 'YWP3P0' WHERE id = v_probe_id;
      RAISE EXCEPTION 'D0 驗收失敗 — 含易混淆字元 0 的 6 碼竟被接受(字母表未生效)';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'orders_display_id_format' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%(不能證明 display_id CHECK 生效)', v_cname;
      END IF;
    END;

    -- 負向:小寫 6 碼
    BEGIN
      UPDATE public.orders SET display_id = 'ywp3pc' WHERE id = v_probe_id;
      RAISE EXCEPTION 'D0 驗收失敗 — 小寫 6 碼竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'orders_display_id_format' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:5 碼(證明長度固定 6、不是 {1,6})
    BEGIN
      UPDATE public.orders SET display_id = 'YWP3P' WHERE id = v_probe_id;
      RAISE EXCEPTION 'D0 驗收失敗 — 5 碼竟被接受(長度未固定)';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'orders_display_id_format' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:7 碼
    BEGIN
      UPDATE public.orders SET display_id = 'YWP3PCX' WHERE id = v_probe_id;
      RAISE EXCEPTION 'D0 驗收失敗 — 7 碼竟被接受(長度未固定)';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'orders_display_id_format' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:換行繞過錨點(Postgres 的 ~ 對多行輸入的經典洞)
    BEGIN
      UPDATE public.orders SET display_id = E'YWP3PC\nBAD' WHERE id = v_probe_id;
      RAISE EXCEPTION 'D0 驗收失敗 — 含換行的值竟被接受(錨點可被繞過)';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'orders_display_id_format' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:新格式值寫進 legacy 欄(防新舊搞反)
    BEGIN
      UPDATE public.orders SET legacy_display_id = 'BKPR5M' WHERE id = v_probe_id;
      RAISE EXCEPTION 'D0 驗收失敗 — 新格式值竟可寫進 legacy_display_id';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'orders_legacy_display_id_format' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 正向:legacy 欄可寫合法舊格式
    BEGIN
      UPDATE public.orders SET legacy_display_id = 'PCM-1999-0001' WHERE id = v_probe_id;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'D0 驗收失敗 — legacy_display_id 竟拒絕合法舊格式';
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 探針零殘留
    SELECT count(*) INTO v_cnt FROM public.orders WHERE legacy_display_id IS NULL;
    IF v_cnt <> v_rows THEN
      RAISE EXCEPTION 'D0 驗收失敗 — 探針殘留:legacy_display_id 應全為 NULL,實 % / % 列', v_cnt, v_rows;
    END IF;
  END IF;

  -- 5.5 pending_invoices 的 voided 行為探針
  SELECT count(*) INTO v_rows FROM public.pending_invoices;
  IF v_rows > 0 THEN
    BEGIN
      UPDATE public.pending_invoices SET status = 'voided'
       WHERE id = (SELECT id FROM public.pending_invoices ORDER BY id LIMIT 1);
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'D0 驗收失敗 — pending_invoices 仍不接受 voided,D1c 步驟 13 會在正式交易內爆掉';
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    BEGIN
      UPDATE public.pending_invoices SET status = 'bogus'
       WHERE id = (SELECT id FROM public.pending_invoices ORDER BY id LIMIT 1);
      RAISE EXCEPTION 'D0 驗收失敗 — 非法 invoice status 竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'pending_invoices_status_check' THEN
        RAISE EXCEPTION 'D0 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;
  END IF;

  -- 5.6 COMMENT 已掛上且措辭正確(v2 §8.1 明文禁止寫成「衍生顯示」)
  --     用 strpos 不用 position(x IN y):後者是 SQL 特殊語法,schema-qualify 後不合法。
  SELECT col_description('public.orders'::regclass, attnum) INTO v_def
    FROM pg_attribute
   WHERE attrelid = 'public.orders'::regclass AND attname = 'fulfillment_status';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, '停止維護') = 0 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders.fulfillment_status 的停止維護 COMMENT 未掛上';
  END IF;
  IF pg_catalog.strpos(v_def, '衍生顯示') > 0 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — COMMENT 不得使用「衍生顯示」措辭(v2 §8.1)';
  END IF;

  -- 5.7 ACL 矩陣 fail-closed:本片不得新增任何權限。
  --     基線(2026-07-29 production 實查):
  --       orders           → authenticated SELECT only、service_role SELECT only、anon 無
  --       pending_invoices → service_role SELECT only、authenticated 與 anon 皆無
  --     legacy_display_id 沿用 orders 既有 table-level GRANT。本欄存的是「客人自己的舊單號」
  --     = 客人自己的資料,非內部資料,不違反 v2 §1 原則 3。
  IF pg_catalog.has_table_privilege('anon', 'public.orders', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.pending_invoices', 'SELECT') THEN
    RAISE EXCEPTION 'D0 驗收失敗 — anon 竟可讀 orders / pending_invoices';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pending_invoices', 'SELECT') THEN
    RAISE EXCEPTION 'D0 驗收失敗 — authenticated 竟可 SELECT pending_invoices(發票紀錄不對客開放)';
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION 'D0 驗收失敗 — authenticated 對 orders 的 SELECT 不見了(本片不該動權限)';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION 'D0 驗收失敗 — service_role 對 orders 的 SELECT 不見了';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pending_invoices', 'SELECT') THEN
    RAISE EXCEPTION 'D0 驗收失敗 — service_role 對 pending_invoices 的 SELECT 不見了';
  END IF;
  -- 表級寫權:三個 role × 兩張表 × 四種寫權,一個都不准有
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
   CROSS JOIN (VALUES ('public.orders'), ('public.pending_invoices')) AS t(tbl)
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
   WHERE pg_catalog.has_table_privilege(r.role_name, t.tbl, p.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — 表級寫權應為 0 個組合,實 % 個(寫入一律走 owner RPC)', v_cnt;
  END IF;
  -- 🔴 欄級寫權:has_table_privilege 抓不到只授到單欄的 grant(R2 抓)。
  --    REFERENCES 是既有基線(service_role 對 orders 有),不算寫權、排除。
  SELECT count(*) INTO v_cnt
    FROM information_schema.column_privileges
   WHERE table_schema = 'public'
     AND table_name IN ('orders', 'pending_invoices')
     AND grantee IN ('anon', 'authenticated', 'service_role')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — 發現 % 個欄級寫權 grant', v_cnt;
  END IF;

  -- 5.8 RLS:整組 policy 精確比對。
  --     只檢查「存在一條含 customer_user_id 的 policy」擋不住「再加一條 USING(true) 的
  --     permissive policy」—— permissive 之間是 OR,多一條就等於全開(R2 抓)。
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass) THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders 的 RLS 竟未啟用';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pending_invoices'::regclass) THEN
    RAISE EXCEPTION 'D0 驗收失敗 — pending_invoices 的 RLS 竟未啟用';
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders 應恰有 1 條 policy,實 % 條(多一條 permissive 就等於全開)', v_cnt;
  END IF;

  SELECT policyname || '|' || cmd || '|' || permissive || '|' || roles::text || '|' || COALESCE(qual, '(null)') || '|' || COALESCE(with_check, '(null)')
    INTO v_def
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders';
  v_expected := 'orders_select_own|SELECT|PERMISSIVE|{authenticated}|(customer_user_id = ( SELECT auth.uid() AS uid))|(null)';
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'D0 驗收失敗 — orders 的 own-order policy 已漂移;預期 [%],實際 [%]', v_expected, COALESCE(v_def, '(無)');
  END IF;

  -- pending_invoices 是 zero-policy(RLS 開 + 零 policy = 全拒),多任何一條都要當場擋下
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pending_invoices';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 驗收失敗 — pending_invoices 應為 zero-policy,實 % 條', v_cnt;
  END IF;

  -- 🔴 誠實回報:空表環境會跳過行為探針,NOTICE 不得把 skipped 講成 passed(R2 抓)
  IF v_probed THEN
    RAISE NOTICE 'D0 驗收全數通過(精確定義比對 + 行為探針 + ACL/RLS 矩陣)';
  ELSE
    RAISE NOTICE 'D0 驗收通過(精確定義比對 + ACL/RLS 矩陣);⚠️ orders 為空表,行為探針已【略過】、未取得行為證據';
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- 🔴 回滾方式:**另立一支 down migration,不要手動 DROP**
-- ============================================================
-- Supabase 是 forward-only:手動在 SQL Editor 拆掉 schema 不會同步
-- supabase_migrations.schema_migrations ⇒ 後續 db push 仍認為 D0 已套用而跳過,
-- 於是 A9b1 查 legacy_display_id 會直接報「欄位不存在」。
--
-- 要回滾請新增一支版本號更大的 migration,內容依序(全部放同一交易):
--
--   -- 前置守門(破壞性指令之前,不是之後):
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM public.orders WHERE legacy_display_id IS NOT NULL) THEN
--       RAISE EXCEPTION '已有訂單改過號,回滾會永久遺失舊單號 — 拒絕執行';
--     END IF;
--     IF EXISTS (SELECT 1 FROM public.pending_invoices WHERE status = 'voided') THEN
--       RAISE EXCEPTION '已有 voided 發票紀錄,收緊 CHECK 會失敗 — 先處理那些列';
--     END IF;
--   END $$;
--
--   -- 反向 DDL(逆序):
--   ALTER TABLE public.pending_invoices DROP CONSTRAINT pending_invoices_status_check;
--   ALTER TABLE public.pending_invoices ADD CONSTRAINT pending_invoices_status_check
--     CHECK (status IN ('pending', 'issued'));
--   COMMENT ON COLUMN public.orders.fulfillment_status IS NULL;
--   ALTER TABLE public.orders DROP CONSTRAINT orders_display_id_format;
--   ALTER TABLE public.orders ADD CONSTRAINT orders_display_id_format
--     CHECK (display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$');
--   ALTER TABLE public.orders DROP CONSTRAINT orders_legacy_display_id_format;
--   ALTER TABLE public.orders DROP CONSTRAINT orders_legacy_display_id_key;
--   ALTER TABLE public.orders DROP COLUMN legacy_display_id;
-- ============================================================
