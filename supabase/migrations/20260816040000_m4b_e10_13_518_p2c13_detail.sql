-- 20260816040000_m4b_e10_13_518_p2c13_detail.sql
-- `#518`:讓應用層分得出「業務拒絕」與「不是業務拒絕」—— 七條業務 RAISE 各補一行 `DETAIL`
--
-- 鐵則 12③(DDL:CREATE OR REPLACE 既有函式)。**只換函式本體,不動表、索引、權限、trigger。**
-- 前一支 = `20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql`
--          (**已由 Sean apply 到正式庫** ⇒ 本片是新檔,絕不就地改那一支)。
--
-- ══ 1. 🔴 病根 —— 是我實測出來的,不是推的 ═══════════════════════════════════
--
-- 現行 code 每條 RAISE 都寫了 `CONSTRAINT = 'pcm_e13_…'`,而應用層讀不到它。
-- **實測(拋棄式 PG 17.10 + 真 PostgREST,兩支函式並排當正反對照)**:
--   帶 DETAIL   → {"code":"P2C13","details":"pcm_e13_zero_price_needs_reason","hint":null,"message":"…"}
--   不帶 DETAIL → {"code":"P2C13","details":null,                            "hint":null,"message":"…"}
-- 🔴🔴 **`CONSTRAINT` 那個欄位在 JSON 裡【根本不存在】** —— PostgREST 只吐
--      `code` / `details` / `hint` / `message` 四顆。
--      ⇒ `#518` 的病根**不是「應用層沒去讀」,是「那個值從來沒送出去過」**。
--      ⇒ 修法只能是**改用 PostgREST 真的會送的欄位**,也就是 `DETAIL`。
--
-- ══ 2. 為什麼只補【七條】而不是九條 ═════════════════════════════════════════
--
-- `P2C13` 執行期到得了客戶端的其實有 **9** 條,另外兩條不是業務拒絕:
--   `pcm_e13_subtotal_matches_lines`(跨列不變式違反 ⇒ 資料損壞)
--   `pcm_e13_guard_unknown_table`  (trigger 掛到未登記的表 ⇒ 設定錯誤)
-- 🔴 **而那兩條住在【別的函式】**(`pcm_e13_assert_order_subtotal_matches` `:192` /
--    `pcm_e13_subtotal_guard` `:233`,都是 commit 時才跑的 constraint trigger)。
--
-- ⇒ **只換 `admin_update_order_item_amount` 一支就達成目的**,分派規則是:
--      `details` ∈ 七條業務清單  ⇒ 業務拒絕,給員工看得懂的話
--      `details` 是別的或 null   ⇒ **通用錯誤 + 「找系統維護」**
--    ✅ **失敗方向是安全的**:任何沒補 DETAIL 的 `P2C13`(含那兩條、含日後新增的)
--       一律落到通用錯誤,**不會被誤講成「你的輸入有問題」**。
--    ⚠️ 代價 = 那兩條在 log 裡分不出誰是誰。**這是已知缺口,不是漏掉的**:
--       換那兩支 trigger 函式的風險(commit 時全表都會跑到)高於它的收益。
--       要做的話另開一片,backlog `#518` 底下。
--
-- ══ 3. 本檔改了什麼(逐字)═══════════════════════════════════════════════════
--
-- `CREATE FUNCTION` → `CREATE OR REPLACE FUNCTION`,函式本體**逐行照抄前一支的 325-484**,
-- 只在七處 `USING ERRCODE = 'P2C13', CONSTRAINT = 'X';` 後面加 `DETAIL = 'X'`。
-- 🔴 **DETAIL 的值刻意等於 CONSTRAINT 的值** —— 兩個不同步就是下一個 bug,
--    下面的斷言逐條核它們相等,不是只核「有 DETAIL」。
-- ⚠️ **DETAIL 只放常數,絕不內插員工輸入** —— `message` 會內插(所以應用層不 log 它),
--    `details` 進 log 的前提就是它永遠是我這邊控制的固定字串。

CREATE OR REPLACE FUNCTION public.admin_update_order_item_amount(
  p_order_id          uuid,
  p_order_item_id     uuid,
  p_unit_price        integer,
  p_expected_version  integer,
  p_actor             text,
  p_request_id        text,
  p_zero_price_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ord        public.orders%ROWTYPE;
  v_item       public.order_items%ROWTYPE;
  v_line_total bigint;
  v_subtotal   bigint;
  v_total      bigint;
  v_payments   integer;
  v_rows       integer;
BEGIN
  -- 4a. server 供參數 fail-closed(形狀抄 20260714130000:84-96)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_order_item_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 order_id / order_item_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: expected_version 越界';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: unit_price 必須是非負整數';
  END IF;

  -- 4b. 🔴 零元防呆(本層只保證 API 契約,不保證員工沒手滑 —— 見檔頭 §3)。
  IF p_unit_price = 0 AND (p_zero_price_reason IS NULL OR pg_catalog.btrim(p_zero_price_reason) = '') THEN
    RAISE EXCEPTION '單價改為 0 需要填原因(例:贈品 / 換貨補寄)'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_zero_price_needs_reason',
            DETAIL = 'pcm_e13_zero_price_needs_reason';
  END IF;
  -- 🔴 反向:>0 卻帶原因 ⇒ 拒。防它退化成「前端恆填一個樣板字」。
  IF p_unit_price > 0 AND p_zero_price_reason IS NOT NULL THEN
    RAISE EXCEPTION '單價不是 0 時不得帶「零元原因」(收到:%)', p_zero_price_reason
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_reason_only_for_zero',
            DETAIL = 'pcm_e13_reason_only_for_zero';
  END IF;

  -- 4c. 鎖父列。🔴 FOR NO KEY UPDATE(不是 FOR UPDATE)——
  --     FOR UPDATE 與 order_items 的 FK RI 取的 KEY SHARE 會死結(40P01,2026-08-03 A2b1 實測)。
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 訂單不存在';
  END IF;
  IF v_ord.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  -- 4d. 🔴 金額閘:這張單有【任何一列】收款 ⇒ 拒(見檔頭 §2;不使用任何金額口徑)。
  SELECT count(*) INTO v_payments FROM public.order_payments p WHERE p.order_id = p_order_id;
  IF v_payments > 0 THEN
    RAISE EXCEPTION
      '這張單已經有收款紀錄(% 筆),目前不開放改金額 —— 因為「已收多少」的算法還沒定案。需要調整請走退款流程,或告知系統維護。',
      v_payments
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_no_edit_after_payment',
            DETAIL = 'pcm_e13_no_edit_after_payment';
  END IF;

  -- 4e. 🔴 折扣閘(plan §6a L2 的「會自己響」那半):本片未處理折扣單的改價。
  --     若 subtotal 被改小而 discount_total > subtotal + shipping_fee ⇒ total 算成負數 ⇒ 撞 CHECK (total >= 0),
  --     而員工會看到 23514 技術碼。⇒ 折扣一上線,第一張折扣單改價就會撞到這裡,訊息說得出為什麼。
  IF v_ord.discount_total <> 0 THEN
    RAISE EXCEPTION
      '這張單有折扣(%),而本功能尚未處理折扣單的改價(#13 片1 已知限制 L2)。請告知系統維護。',
      v_ord.discount_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_discount_not_supported',
            DETAIL = 'pcm_e13_discount_not_supported';
  END IF;

  -- 4f. 取品項,並確認它屬於這張單(防跨單誤改)。
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 品項不存在';
  END IF;
  IF v_item.order_id <> p_order_id THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 品項不屬於這張訂單';
  END IF;

  -- 4g. no-op 拒(不 bump version、不寫稽核;形狀抄 20260714130000:196-203)。
  IF v_item.unit_price = p_unit_price THEN
    RETURN 'NOOP';
  END IF;

  -- 4h. 🔴 同交易改兩處:line_total 必須跟著 unit_price 走,否則撞 order_items_line_balances。
  --     ⚠️ 我們是【設計上】同時改,不是靠撞 CHECK 才發現 —— 驗收要有一格證明這件事。
  v_line_total := p_unit_price::bigint * v_item.quantity::bigint;
  IF v_line_total > 2147483647 THEN
    RAISE EXCEPTION '改後的 line_total(%)超出 integer 上限', v_line_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_line_total_overflow',
            DETAIL = 'pcm_e13_line_total_overflow';
  END IF;

  UPDATE public.order_items
     SET unit_price = p_unit_price,
         line_total = v_line_total::integer
   WHERE id = p_order_item_id;

  -- 4i. 重算訂單層。subtotal = Σ line_total;total 依 orders_total_balances 的等式。
  SELECT COALESCE(SUM(i.line_total), 0) INTO v_subtotal
    FROM public.order_items i WHERE i.order_id = p_order_id;
  v_total := v_subtotal + v_ord.shipping_fee::bigint - v_ord.discount_total::bigint;
  IF v_total < 0 THEN
    RAISE EXCEPTION '改後的訂單總額會變成負數(%),本功能不處理', v_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_total_negative',
            DETAIL = 'pcm_e13_total_negative';
  END IF;
  IF v_subtotal > 2147483647 OR v_total > 2147483647 THEN
    RAISE EXCEPTION '改後的 subtotal/total 超出 integer 上限'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_order_amount_overflow',
            DETAIL = 'pcm_e13_order_amount_overflow';
  END IF;

  UPDATE public.orders
     SET subtotal   = v_subtotal::integer,
         total      = v_total::integer,
         version    = v_ord.version + 1,
         updated_at = pg_catalog.now()
   WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 更新列數異常(%)', v_rows;
  END IF;

  -- 4j. 同交易寫稽核。🔴 逐欄列舉 —— 新增可編欄位時**必須**同時加在這裡,
  --     否則它不會進操作紀錄,而且不會有任何東西紅(#13 片0a §4 的 must)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.item.amount.update',
    'order_item:' || p_order_item_id::text,
    pg_catalog.jsonb_build_object(
      'order_id',   p_order_id,
      'unit_price', v_item.unit_price,
      'line_total', v_item.line_total,
      'subtotal',   v_ord.subtotal,
      'total',      v_ord.total
    ),
    pg_catalog.jsonb_build_object(
      'order_id',          p_order_id,
      'unit_price',        p_unit_price,
      'line_total',        v_line_total::integer,
      'subtotal',          v_subtotal::integer,
      'total',             v_total::integer,
      'zero_price_reason', p_zero_price_reason
    ),
    p_request_id,
    'admin'
  );

  RETURN 'OK';
END;
$fn$;

-- ══ 4. apply 時的自我斷言 ═════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_def  text;
  v_cnt  integer;
BEGIN
  SELECT pg_get_functiondef('public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)'::regprocedure)
    INTO v_def;

  -- ① 正向對照:抓不到定義的話,下面每一條都恆真
  IF v_def IS NULL OR position('P2C13' in v_def) = 0 THEN
    RAISE EXCEPTION '#518 驗收失敗 — 抓不到函式定義或裡面沒有 P2C13,下面的斷言沒有判別力';
  END IF;

  -- ②a 🔴 **先釘住「本函式內的 P2C13 恰為七條」**(codex 關卡2 R1 must-fix 3)。
  --     初版只數「配對」⇒ 已有七組正確配對時,**新增第八條**寫成
  --     `CONSTRAINT = 'x', HINT = 'y';`(沒有 DETAIL、也不以 `';` 結尾)
  --     兩道都不命中 ⇒ **照樣全綠**。先把分母釘死才有意義。
  SELECT count(*) INTO v_cnt FROM regexp_matches(v_def, 'ERRCODE = ''P2C13''', 'g');
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION '#518 驗收失敗 — 本函式內的 P2C13 應為 7 條,實 %。'
      '(多出來的那條要先回答:它是業務拒絕還是系統故障?再決定要不要進白名單)', v_cnt;
  END IF;

  -- ② 七條業務 RAISE 都要有 DETAIL,【而且 DETAIL 的值等於 CONSTRAINT 的值】
  --    🔴 只數「有幾個 DETAIL」抓不到「DETAIL 寫錯名字」——那正是最可能發生的手滑。
  --    ⚠️ **這是【語法模板斷言】,不是語意驗證**(codex 關卡2 nit 4):
  --       它認的是「`CONSTRAINT = 'x',` 換行 `DETAIL = 'x'`」這個**固定字面形狀**。
  --       兩者對調、或中間插入別的合法 option(`HINT = …`),即使語意完全正確也會紅。
  --       ⇒ 紅的時候先問「我是不是換了寫法」,再問「我是不是寫錯了」。
  SELECT count(*) INTO v_cnt
    FROM regexp_matches(v_def, 'CONSTRAINT = ''([a-z0-9_]+)'',\s*DETAIL = ''([a-z0-9_]+)''', 'g') AS m
   WHERE m[1] = m[2];
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION '#518 驗收失敗 — CONSTRAINT 與 DETAIL 同名的配對應為 7 組,實 %。'
      '(數字偏小=有人漏補或把 DETAIL 打錯名字;偏大=有人新增了業務拒絕卻沒更新'
      ' apps/admin/src/lib/orders/amount-p2c13-set.test.ts 的清單)', v_cnt;
  END IF;

  -- ③ 🔴 一條 P2C13 都不准只有 CONSTRAINT 沒有 DETAIL(本函式內)
  SELECT count(*) INTO v_cnt
    FROM regexp_matches(v_def, 'CONSTRAINT = ''[a-z0-9_]+'';', 'g');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#518 驗收失敗 — 本函式內還有 % 條 RAISE 只設 CONSTRAINT 沒設 DETAIL。'
      'PostgREST 不吐 CONSTRAINT,那條的拒絕原因到不了應用層', v_cnt;
  END IF;

  -- ④ 函式形狀沒被換掉(security / search_path 是安全面,replace 時最容易掉)
  IF position('SECURITY DEFINER' in v_def) = 0 THEN
    RAISE EXCEPTION '#518 驗收失敗 — SECURITY DEFINER 不見了';
  END IF;
  IF v_def !~ 'search_path' THEN
    RAISE EXCEPTION '#518 驗收失敗 — search_path 設定不見了';
  END IF;

  RAISE NOTICE '✅ #518:七組 CONSTRAINT/DETAIL 同名、零條只有 CONSTRAINT、函式形狀未變';
END
$verify$;

-- ══ 5. Rollback ═══════════════════════════════════════════════════════════════
-- 重跑 `20260815040000_…` 的 `CREATE FUNCTION` 段(把 CREATE 改成 CREATE OR REPLACE)即可回到原狀。
-- additive:沒有動表、索引、權限、trigger ⇒ 沒有資料層要回滾的東西。
