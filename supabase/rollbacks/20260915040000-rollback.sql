-- 20260915040000-rollback.sql —— 退回 20260915040000_m4b_01_manager_redline_rpc_gate.sql
--
-- 四支 CREATE OR REPLACE 貼回上一代【整支】(header 含 SET search_path = '' 逐字, 因為 CREATE OR REPLACE 會把 SET 子句整組換掉):
--   admin_update_order_item_amount ← 20260909080000:122 · admin_soft_delete_order_note ← 20260913020000:163
--   record_manual_cancel_notice ← 20260906920000:62 · revoke_manual_cancel_notice ← 20260906930000:56
-- admin_requeue_dead_email:DROP 2 參版 + 貼回 20260831040000:70 的 1 參版 + 原檔尾 ACL 逐字。
-- 🔴 退這支之前 P3(dead-letter-actions.ts 多帶 p_actor)那顆 TS 要先 revert, 不然 action 打 2 參版 ⇒ PGRST202。
-- 回滾不動資料;回滾後改金額回到「任何員工都能改」(今天的狀態, 不是新的洞)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  -- 🔴 codex R1 must-fix:釘【本次新版】五支的 md5(拋棄式 PG 2026-09-14 貼完實得), 不只查「含那一句」——
  --    否則更晚的修正版只要留著那句就會被本檔靜靜蓋掉。
  v_expect constant text[][] := ARRAY[
    ['public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)', '665d49b5a5cc3246bcdba0e3ffc85042'],
    ['public.admin_requeue_dead_email(uuid,text)',                                       '74a9401351405e188e89f8b1bb48e0d3'],
    ['public.admin_soft_delete_order_note(uuid,uuid,text,text,text)',                   '794b48c0e7ba77760737e3d085afccd1'],
    ['public.record_manual_cancel_notice(uuid,text,text,text)',                         '267fea1d4e3cea51f1cd2b1520a84d7c'],
    ['public.revoke_manual_cancel_notice(uuid,uuid,text,text)',                         '07a28b9d29cdbcc2e0e04e9037e4912d']
  ];
  i int; v_src text;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_requeue_dead_email(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '退回前置閘一:admin_requeue_dead_email(uuid,text) 不在 ⇒ 20260915040000 沒貼過, 沒東西可退';
  END IF;
  FOR i IN 1 .. pg_catalog.array_length(v_expect, 1) LOOP
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_expect[i][1]);
    IF v_src IS NULL OR pg_catalog.md5(v_src) <> v_expect[i][2] THEN
      RAISE EXCEPTION USING MESSAGE = '退回前置閘二:' || v_expect[i][1] || ' 本體不是 20260915040000 那一代 ' || v_expect[i][2] || '(實得 ' || COALESCE(pg_catalog.md5(v_src), '<null>') || ')⇒ 不是本檔知道怎麼退的版本';
    END IF;
  END LOOP;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_update_order_item_amount(p_order_id uuid, p_order_item_id uuid, p_unit_price integer, p_expected_version integer, p_actor text, p_request_id text, p_zero_price_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- 🔴 [A1] 只為稽核而存在的兩個變數 —— 不參與任何判斷、不影響改價是否放行。
  v_a1_attempt_id     uuid := NULL;
  v_a1_attempt_status text := NULL;
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


  -- ══ 4g-2 未稅價的單不開放改價(2026-09-05 · ⟦b4-PRICECOPYTAX⟧ 片二)═══════════════
  -- 🔴 **判準是 `price_tax_mode`, 不是 `tax_total`**(codex 2026-09-05 must-fix #10, 它對):
  --    ⛔ ~~`tax_total <> 0`~~ —— 一張 `exclusive` 的單若**稅基是 0**(全部品項 0 元 + 免運),
  --       或**小額四捨五入成 0**(稅基 ≤ 9 ⇒ ROUND(0.45)=0)⇒ `tax_total = 0`
  --       ⇒ **它會穿過那道擋**, 而之後改成高單價 ⇒ 留下一張**未稅價而稅額 0** 的單。
  --    ⇒ 📌 **我用「結果」當判準, 而該用「這張單是哪一種」。**
  --    ✅ 主判準 `price_tax_mode = 'exclusive'`;`OR tax_total <> 0` 留著當**第二道**
  --       —— 它涵蓋「欄位不知怎麼變成 inclusive 而稅額還在」那種不一致。
  -- 🔴 **為什麼要擋**:下面 `4i` 的重算式是 `v_total := v_subtotal + shipping_fee - discount_total;`
  --    —— **它沒有稅** ⇒ 一張有稅的單一改價, `total` 會少掉稅
  --    ⇒ **撞 `orders_total_balances`**(它自 `20260828100000` 起把 `tax_total` 納入等式)
  --    ⇒ 員工看到的是一個**約束名**, 而他不知道發生了什麼事。
  -- 🔴 **位置在 4g 之後、寫入之前**(codex nit #11):放在品項存在/歸屬/NOOP 檢查**之前**的話,
  --    一個**根本不存在的品項**或**純 NOOP** 會被說成「稅的問題」⇒ 訊息把人導向錯的地方。
  -- 🛑 **這是刻意的功能缺口, 不是修好了** —— 要真正支援, `4i` 那條算式要跟著重算稅,
  --    而那是另一片、要另一輪審查。
  -- 🔬 **今天未稅價的單是 0 張**(`price_tax_mode` 這一欄本檔才加)⇒ **影響從零開始長。**
  IF v_ord.price_tax_mode = 'exclusive' OR COALESCE(v_ord.tax_total, 0) <> 0 THEN
    RAISE EXCEPTION
      '這張單的單價是【未稅】的(稅另計), 而改金額這個功能還不會重算稅 —— 目前不開放改。'
      '需要調整請告知系統維護。'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_no_edit_when_taxed',
            DETAIL = 'pcm_e13_no_edit_when_taxed';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════════

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
  -- 4i-bis. 🔴 [A1] 撈【當下的 active charge attempt】—— 只寫進稽核, 不擋改價(Sean 2026-09-09 拍乙)。
  --   走既有的 partial UNIQUE 索引 payment_charge_attempts_order_lock_idx:
  --     UNIQUE (order_id) WHERE status IN ('pending','charged','released')
  --   ⇒ 述詞與 active 集【逐字相同】(20260624120007:19 的 R1b3 定義), 而 UNIQUE 保證一張單最多一筆
  --     ⇒ 不需要 ORDER BY / LIMIT, 一次 index lookup。
  -- 🛑 這是本函式【第一次】相依 payment_charge_attempts —— 刻意不加鎖(純 SELECT):
  --   加鎖會把改價與 3DS 那條路綁在一起, 而本片要的只是【留證據】不是【協調】。
  BEGIN
    SELECT a.id, a.status
      INTO v_a1_attempt_id, v_a1_attempt_status
      FROM public.payment_charge_attempts a
     WHERE a.order_id = p_order_id
       AND a.status IN ('pending', 'charged', 'released');
  EXCEPTION WHEN OTHERS THEN
    -- 🔴 稽核用的欄位【永遠不可以讓改價失敗】—— 撈不到就留 NULL, 並讓後面那一格說得出「沒撈到」。
    v_a1_attempt_id := NULL;
    v_a1_attempt_status := 'lookup_failed';
  END;

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
      'zero_price_reason', p_zero_price_reason,
      -- 🔴 [A1] 這兩個鍵回答的是「這筆改價當下, 有沒有一筆付款正在進行」——
      --   板列 ⟦深掃-A1⟧:3DS 進行中改價 ⇒ 銀行照原價扣款 ⇒ 對帳拿改後金額去比 ⇒ 永遠對不上。
      --   🛑 它【不防止】那件事(Sean 拍乙不是甲), 它讓對帳失敗時查得出來為什麼。
      'active_charge_attempt_id',     v_a1_attempt_id,
      'active_charge_attempt_status', v_a1_attempt_status
    ),
    p_request_id,
    'admin'
  );

  RETURN 'OK';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_order_note(
  p_order_id   uuid,
  p_note_id    uuid,
  p_reason     text,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 空白字集逐字沿用 A6 的 `v_ws`(31 字元),**不自己列一份** ——
  --    兩份會漂移,而漂移的方向是「這一支收得比那一支寬」,沒有任何東西會叫。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';

  -- 判空用的零寬字集,同樣逐字沿用 A6 的 `v_body_zw`(7 字元)。
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  -- 理由上限 500 **碼位**(char_length 語意,非 byte)。與上面那條 CHECK 同值 ——
  -- 🔴 兩處同值是刻意的重複:CHECK 是最後一道,這裡是為了回**固定碼**而不是 raw 23514。
  -- ⚠️ 而「CHECK 擋得住 owner 直寫」只對一半(Fable 審 nit 3):CHECK 裡的 `btrim` 是單參數版,
  --    只剝 ASCII 空白 ⇒ owner 直寫一個全形空白當理由,CHECK 照樣放行。RPC 這條路不受影響。
  v_reason_max constant integer := 500;

  v_actor  text;
  v_req    text;
  v_reason text;
  v_row    public.order_notes%ROWTYPE;
  v_n      integer;
BEGIN
  -- 🔴 **執行期 lock_timeout**(Fable 審 consider 2)—— 檔頭那句 `SET LOCAL lock_timeout` 只護
  --    貼這支 migration 的那個交易,**不護它日後每一次被呼叫**。沒有它:有人開著
  --    `BEGIN; SELECT … FROM orders WHERE id=O FOR UPDATE;` 不 commit ⇒ 員工按一次刪除就掛住一條連線、無限等。
  --    3s 抄 `20260912050000` 三支的家規(`:132,207,278`),不自己訂一個數。
  SET LOCAL lock_timeout = '3s';

  -- 0. 常數自檢(字集漂移 ⇒ 全函式拒用、fail-loud;照 A6)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: v_zw 字元集長度異常(預期 7)';
  END IF;

  -- 步 1. actor / request_id(RAISE 面 = caller bug,非固定碼;先剝、後驗,逐字照 A6 步 1)
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: actor 非法';
  END IF;
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: actor 非法(須為 staff slug,鏡像 order_notes_deleted_by_slug)';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: request_id 非法';
  END IF;

  -- 步 2-8:固定碼面。
  IF p_order_id IS NULL OR p_note_id IS NULL THEN RETURN 'INVALID_INPUT'; END IF;

  -- 🔴 長度先擋(它是錯誤),再判空(它不是錯誤)。
  IF p_reason IS NOT NULL AND pg_catalog.char_length(p_reason) > v_reason_max THEN
    RETURN 'REASON_TOO_LONG';
  END IF;

  -- 🔵 理由**選填**(Sean 2026-09-13 答乙)⇒ 沒寫、或寫了一串看不見的東西 ⇒ **存 NULL,不是錯誤**。
  --    判空用正規化後的值,**入庫存原文**(與 A6 的 body 同一條規矩:顯示保真)。
  --    ⚠️ 這一步不可省:直接存 `'   '` 會撞 `order_notes_deleted_reason_shape` 的 raw 23514,
  --       而那是一個使用者看不懂的錯 —— 一個選填欄位不該因為「打了空白」而失敗。
  IF p_reason IS NULL
     OR pg_catalog.regexp_replace(pg_catalog.translate(p_reason, v_zw, ''), '[[:space:]]', '', 'g') = ''
  THEN
    v_reason := NULL;
  ELSE
    v_reason := p_reason;
  END IF;

  -- 步 5. 鎖序 = orders 單列 FOR UPDATE → note 列(**與 A6 同向**)。
  -- 🔴 同向這件事是規格不是巧合:A6 與本支若一支先鎖 note、一支先鎖 order,兩支同時跑就會互等。
  -- ⚠️ **射程照抄 A6 `:52-54` 的限定,不要讀寬**:無死結只限「每筆交易單次呼叫」。
  --    同一筆交易內跨多張單、反序呼叫仍然互鎖得起來(PG 會殺掉一邊)。(Fable 審 nit 9)
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ORDER_NOT_FOUND'; END IF;

  -- 步 6. note 存在且在本單(複合條件一次問完 ⇒ 拿 B 單的 note id 來刪 A 單,查無)。
  -- 🔴 **排在重複 request 之前** —— 見檔頭「檢查順序」那段:步 7 要看得到這一列現在的狀態。
  SELECT * INTO v_row FROM public.order_notes
   WHERE id = p_note_id AND order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOTE_NOT_FOUND'; END IF;

  -- 步 7. 重複 request。判準**真的**照 A6 步 11:不是「audit 有同鍵列就算成功」,
  -- 而是「同鍵 + 指向本則 + 同一個人 + **而且那一則現在確實是刪除狀態**」才算真的重送。
  IF EXISTS (SELECT 1 FROM public.admin_audit_log al
              WHERE al.action = 'order_note.soft_delete' AND al.request_id = v_req) THEN
    IF EXISTS (SELECT 1 FROM public.admin_audit_log al
                WHERE al.action = 'order_note.soft_delete' AND al.request_id = v_req
                  AND al.after->>'note_id' = p_note_id::text
                  AND al.target = 'order:' || p_order_id::text
                  -- 🔴 比對 actor(Fable 審 nit 5):同一個 token 換一個人送過來,
                  --    舊版會回「成功」而 `deleted_by` 記的是**別人**。
                  AND al.actor = v_actor) THEN
      -- 🔴🔴 效果驗證(Fable 審 consider 1)。稽核說刪過、而這一列活著 ⇒ 有人把它還原了
      --    (本檔檔頭自己宣傳過「可一句 SQL 還原」⇒ 這條路**不需要攻擊者**)。
      --    此時回 DUPLICATE_REQUEST = 告訴呼叫端「成功」而**備註還在時間軸上**。⇒ fail-loud。
      IF v_row.deleted_at IS NULL THEN
        RAISE EXCEPTION 'admin_soft_delete_order_note: 稽核說這則刪過而它現在是活的(被還原或稽核遭偽造)⇒ 不謊報成功';
      END IF;
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    -- 同 request_id 但指向別則 / 別人 = request_id 被重用,或稽核遭偽造(service_role 對 audit 有 INSERT)
    -- ⇒ RAISE fail-loud,**絕不謊報成功**。
    RAISE EXCEPTION 'admin_soft_delete_order_note: request_id 已被使用但指向別的備註或別的人(重用或稽核遭偽造)';
  END IF;

  -- 步 8. 已刪 ⇒ 不覆寫(「誰刪的」不可被第二個人蓋掉)
  IF v_row.deleted_at IS NOT NULL THEN RETURN 'ALREADY_DELETED'; END IF;

  -- 步 9. 單列 UPDATE(本體唯一一句寫 order_notes;**不碰 body、不碰 corrects_note_id**)
  --       + 同交易稽核(Q1=A 的形狀,照 A6)。
  UPDATE public.order_notes
     SET deleted_at     = pg_catalog.clock_timestamp(),
         deleted_by     = v_actor,
         deleted_reason = v_reason
   WHERE id = p_note_id
  RETURNING * INTO v_row;
  -- 🔴 UPDATE 也要數(Fable 審 nit 6;`20260912050000` 家規兩邊都數,我第一版只數了稽核那邊)。
  --    今天不可達(持 FOR UPDATE、零 trigger),而哪天掛上 BEFORE UPDATE trigger 回 NULL ⇒
  --    `v_row` 被 RETURNING 清空 ⇒ **稽核落一列 `note_id: null` 而備註沒被收起來** = 我守的那件事的反面。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: UPDATE 落 % 列(期望恰 1)', v_n;
  END IF;

  -- 🔴 audit INSERT **不包任何 EXCEPTION handler**(照 A6):失敗必往上拋 ⇒ 整筆 rollback、刪除不落地。
  --    吞掉它 = 備註被收起來而稽核靜默漏筆。
  -- 🔴 `after` **不含 body 全文**(PII 最小化,照 A6 只放 sha256 與長度)。
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES
    (v_actor, 'order_note.soft_delete', 'order:' || p_order_id::text,
     pg_catalog.jsonb_build_object('note_id', v_row.id, 'deleted_at', NULL),
     pg_catalog.jsonb_build_object(
       'note_id', v_row.id,
       'note_type', v_row.note_type,
       'deleted_at', v_row.deleted_at,
       'body_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_row.body, 'UTF8')), 'hex'),
       'body_length', pg_catalog.char_length(v_row.body)),
     v_reason, v_req, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 稽核落 % 列(期望恰 1)⇒ 收起備註與留紀錄必須同生共死', v_n;
  END IF;

  RETURN 'DELETED';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_manual_cancel_notice(
  p_order_id        uuid,
  p_recipient_email text,
  p_actor           text,
  p_request_id      text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴🔴 **每個型別都帶 `pg_catalog.` 前綴**(codex 2026-09-06 must-fix)——
  --    `SET search_path = ''` **不排除 `pg_temp`**, 而暫存 schema 對【型別名】是隱含且優先搜尋的
  --    ⇒ 有建暫存物件能力的呼叫端可以先建一個帶 CHECK 的 `pg_temp.uuid`,
  --      而那個 CHECK 會在**本函式 owner(postgres)的權限下**執行。
  --    ⚠️ **那條攻擊路徑是靜態推導、我沒有實測** —— 而加前綴的成本是幾個字 ⇒ 照做, 不爭論機率。
  --    🔵 同族先例:`20260906620000` 的 `v_result pg_catalog.jsonb`(同一輪 codex 提的)。
  v_locked  pg_catalog.uuid;
  v_ok      pg_catalog.bool;
  v_now     pg_catalog.timestamptz := pg_catalog.now();
  v_constraint pg_catalog.text;
BEGIN
  -- 🔴 空值先擋。⛔ ~~這四個參數**沒有一個可以是空的**~~
  --    🔵 **codex nit 訂正:那句話與實作不符** —— 下面只擋 `p_order_id` / `p_recipient_email`
  --    / `p_actor` **三個**;`p_request_id` **可以是空的**, 它只是 correlation id,
  --    空了會讓 log 難追而**不會讓這一列變成假的**(建表 `20260717020000` 那一欄本來就 nullable,
  --    逐字「nullable=sweeper 補寄路徑無來源 request」)。
  --    ⇒ 📌 **擋的範圍要與說的範圍一樣大** —— 而讓 NULL 走下去會得到
  --    一個「述詞不成立」的假答案(NULL 比較 = UNKNOWN ⇒ WHERE 當假)。
  --    ⇒ 那會把**參數傳錯**偽裝成**這張單不合格**, 而兩者的下一步完全不同。
  IF p_order_id IS NULL
     OR pg_catalog.btrim(COALESCE(p_recipient_email, '')) = ''
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'invalid_args');
  END IF;

  -- 🔴🔴 **鎖那張單** —— 這就是本支存在的全部理由。
  --    `FOR NO KEY UPDATE`(不是 `FOR UPDATE`):我們**不改那一列**, 只要它在本交易期間
  --    不被別人改狀態;用較弱的那一種可以少擋住別的寫入者。
  --    🔵 形狀照 `20260823020000:258-260`(`pcm_sync_order_refund_payment_status` 也是這樣鎖)。
  SELECT o.id INTO v_locked
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;

  -- 🛑 **述詞在鎖【之後】重算** —— 這一段與 `20260906620000` 的
  --    `pending_manual_send_count` 逐條同義(見檔頭)。
  SELECT TRUE INTO v_ok
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.payment_method = 'tappay'
     AND o.payment_status = 'refunded'
     AND o.cancelled_at IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.order_manual_refunds m
            WHERE m.order_id = o.id
              AND m.voided_at IS NULL)
     AND NOT EXISTS (
           SELECT 1 FROM public.email_outbox e
            WHERE e.order_id = o.id
              AND e.event_type = 'order_cancelled');

  IF NOT FOUND THEN
    -- 🔵 **這裡刻意【不細分】為什麼不合格** —— 細分是 TS 那一側的工作(它要給人一句話),
    --    而本支的職責只有一個:**在鎖住的狀態下決定寫不寫**。
    --    ⇒ 📌 兩邊各做各的, 不要讓本支變成第二套訊息系統(那就是第四份字面了)。
    RETURN pg_catalog.jsonb_build_object('result', 'not_eligible');
  END IF;

  -- 🔴 `dedup_key` 用 `p_order_id::text` —— **從 uuid 轉出來的那一份**, 不是呼叫端給的字串。
  --    codex R3 must-fix ②:`dedup_key` 是 `text` 而 `orders.id` 是 `uuid`
  --    ⇒ 大小寫不同的 UUID 字串會變成兩個 dedup_key ⇒ 唯一鍵繞得過去。
  --    ✅ 在這裡轉一次, 呼叫端就**不可能**傳一個奇怪的形狀進來(它連傳的機會都沒有)。
  INSERT INTO public.email_outbox (
    event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at
  ) VALUES (
    'order_cancelled',
    p_order_id,
    p_order_id::text,
    pg_catalog.btrim(p_recipient_email),
    '訂單取消通知(人工寄出)',
    pg_catalog.jsonb_build_object(
      'manual', TRUE,
      'recorded_by', p_actor,
      'recorded_at', v_now,
      'request_id', p_request_id,
      'note', '這一列不是系統寄的:員工自己寄了信之後在後台登錄。沒有 provider_message_id 是正常的。'
    ),
    'sent',
    v_now
  );

  RETURN pg_catalog.jsonb_build_object('result', 'ok');

EXCEPTION
  -- 🔴 撞唯一鍵 ⇒ **不是成功**。回一個自己的碼, 讓 TS 那側說「別人剛登錄了」。
  --    ⚠️ 而這一格在**鎖之後**幾乎不該發生(同一張單會被鎖序列化)——
  --    留著是因為 `(event_type, dedup_key)` 這道鍵**不只本支在寫**。
  WHEN unique_violation THEN
    -- 🔴 **只認那一道鍵**(codex nit):裸接 `unique_violation` 會把**別的**唯一鍵
    --    (例如 `email_outbox_pkey`)也報成「別人剛登錄了」
    --    ⇒ 📌 **真正的錯誤來源被吞掉**, 而畫面給的下一步是錯的(叫他重新整理看紀錄)。
    --    ✅ 比 `CONSTRAINT_NAME` —— 不是它就**往上丟**, 讓 TS 那側走 `write_failed` 並留下 log。
    -- ⚠️ **這一段【沒有被實測過】, 照實寫**(2026-09-06):`raced` 這條路在**單一連線**裡
    --    造不出來 —— 述詞的 anti-join 會**先**攔下已存在的 `order_cancelled` 列並回 `not_eligible`
    --    ⇒ 拋棄式 PG 上我試了, 拿到的是 `not_eligible`(那是對的)。
    --    ⇒ 📌 要走到這裡, 必須有**另一個交易**在我算完述詞之後、寫進去之前搶先插入
    --      ⇒ 那需要兩個連線的交錯, 不在本片的驗證範圍。**它是第二層保險, 而我沒有量到它。**
    -- 🔵 關鍵字是 `CONSTRAINT_NAME`(**不是** `PG_CONSTRAINT_NAME`)——
    --    我第一版寫錯, 拋棄式 PG 當場回 `unrecognized GET DIAGNOSTICS item`。
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS DISTINCT FROM 'email_outbox_event_uniq' THEN
      RAISE;
    END IF;
    RETURN pg_catalog.jsonb_build_object('result', 'raced');
END
$fn$;

CREATE OR REPLACE FUNCTION public.revoke_manual_cancel_notice(
  p_order_id   uuid,
  -- 🔴🔴 **呼叫端要指名【它讀到的那一列】** —— codex 2026-09-06 must-fix ①。
  --    ⛔ 舊版只收 `p_order_id` ⇒ 它撤的是「這張單**現在**的那一列」, 不是「我看到的那一列」。
  --    🔬 失敗情境(它給的, 我核過):甲開著分頁讀到誤登錄 A、寫完稽核暫停;
  --       乙撤掉 A、**真的寄了信**、重新登錄 B;甲這時才進 RPC
  --       ⇒ 🛑 **它把 B 刪掉了** —— 一筆有效的登錄被一個過期的請求撤銷,
  --         而甲的稽核寫的是 A、`deleted_id` 回的是 B ⇒ 📌 那位客人的提醒又冒出來, 而信其實寄過了。
  --    ✅ 收 outbox 列的 id, `DELETE … WHERE id = p_outbox_id` ⇒ **compare-and-swap**:
  --       那一列若已經被換掉, 這一發就刪不到東西, 而下面的 ROW_COUNT 會發現。
  p_outbox_id  uuid,
  p_actor      text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 型別一律帶 `pg_catalog.` 前綴 —— `SET search_path = ''` **不排除 `pg_temp`**,
  --    而暫存 schema 對型別名是隱含且優先搜尋(codex 2026-09-06 對姊妹支的 must-fix)。
  v_row_id   pg_catalog.uuid;
  v_manual   pg_catalog.text;
  v_deleted  pg_catalog.int4;
BEGIN
  IF p_order_id IS NULL
     OR p_outbox_id IS NULL
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'invalid_args');
  END IF;

  -- 🔴🔴 **鎖那一列再看它是什麼** —— 順序不可換。
  --    先看再刪的話, 兩個人同時撤時第二個人會刪到**已經不存在**的列(或別人剛插的新列)。
  -- 🔴 **鎖【那一列】** —— 用 id, 不是用 order_id 撈「現在剛好在的那一列」。
  --    🔵 順帶關掉 codex 提的另一格:非 `STRICT` 的 `SELECT INTO` 在**有兩列**時只取一列,
  --      而刪一列照樣 `ROW_COUNT=1` ⇒ 不會發現另一列還在。用 id 之後那個歧義消失。
  --    🔵 `order_id` 仍然比對 —— 擋住「拿 A 單的列 id 配 B 單的 order_id」那種呼叫。
  SELECT e.id, e.payload->>'manual'
    INTO v_row_id, v_manual
    FROM public.email_outbox e
   WHERE e.id = p_outbox_id
     AND e.order_id = p_order_id
     AND e.event_type = 'order_cancelled'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- 🔵 找不到那一列 ⇒ 不是錯誤。三種成因對「下一步」是同一件事(重新整理再看):
    --    ①已經被撤掉了 ②從來沒登錄過 ③**它被換成另一列了**(= 上面那個過期分頁的情境)。
    --    🔴 而 ③ 正是本支收 `p_outbox_id` 的理由 —— 舊版會**刪掉那個新的**而不是回這裡。
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;

  -- 🔴🔴 **只准撤【人工登錄】的列。**
  --    ⛔ ~~系統寄的那一列撤掉 = 系統會再寄一次給客人~~
  --    🔵 **精確版**(code-reviewer 2026-09-06):那句話對**非混合單**成立(它們在自動寄的
  --       掃描面裡, 刪了 outbox 列確實會被重寄);而對**混合單**不成立(view 永久排除它們)。
  --    ⇒ 📌 **兩種單都不准撤系統寄的那一列, 而理由不同** —— 前者會重寄, 後者是「那不是你登錄的」。
  --    🛑 用 `IS DISTINCT FROM` 不是 `<>` —— `payload` 沒有 `manual` 這個鍵時
  --      `->>` 回 **NULL**, 而 `NULL <> 'true'` 是 **UNKNOWN**(不是真)⇒ IF 不成立
  --      ⇒ 📌 **系統寄的那一列會被放行刪掉。** 那正是這道閘要擋的東西。
  IF v_manual IS DISTINCT FROM 'true' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_manual');
  END IF;

  DELETE FROM public.email_outbox WHERE id = v_row_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 🔴 **數一次刪了幾列** —— 一句 DELETE 回報「成功」而刪了 0 列, 在 rc 上與刪了 1 列一樣。
  --    ⇒ 這一格把它分開。刪不到 1 列就丟, 讓整個交易回滾(稽核那一筆由呼叫端負責)。
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION '撤銷登錄:預期刪 1 列而實際刪了 % 列(order_id=%)⇒ 拒繼續', v_deleted, p_order_id;
  END IF;

  -- 🔵 `p_request_id` **回給呼叫端**(code-reviewer nit:它原本收了從頭到尾沒用)——
  --    本支不寫 payload(那一列要被刪掉), 所以它唯一有用的地方是**讓呼叫端把它接回稽核**,
  --    而那樣「這一發 RPC」與「那一筆稽核」才連得起來。
  RETURN pg_catalog.jsonb_build_object(
    'result', 'ok', 'deleted_id', v_row_id, 'request_id', p_request_id);
END
$fn$;

DROP FUNCTION public.admin_requeue_dead_email(uuid, text);

CREATE FUNCTION public.admin_requeue_dead_email(
  p_outbox_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status       text;
  v_attempts     integer;
  v_max_attempts integer;
BEGIN
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'admin_requeue_dead_email:p_outbox_id 不得為 NULL';
  END IF;

  -- 🔴 **FOR UPDATE**:兩個人同時按同一列 ⇒ 第二個等第一個做完再讀
  --    ⇒ 它會看到 `attempts = 0` ⇒ 落下面那道「不是死信」的閘 ⇒ **不會重排兩次**。
  SELECT o.status, o.attempts, o.max_attempts
    INTO v_status, v_attempts, v_max_attempts
    FROM public.email_outbox o
   WHERE o.id = p_outbox_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_requeue_dead_email:找不到 outbox 列(%)', p_outbox_id;
  END IF;

  /**
   * 🔴🔴 **白名單, 不是黑名單**(codex 2026-08-31 R1 must-fix ×2)。
   *
   * ⛔ ~~我第一版只擋 `status = 'sent'`~~ —— 那是黑名單, 而這張表有 **7 態**
   *   (`20260717020000…sql:305` 的 CHECK, 2026-08-31 正式庫實查逐字確認)。
   *   ⇒ 它會把下面這三種**一起翻回 pending**, 而每一種都是錯的:
   *
   *   · `skipped_order_ineligible` ⇒ 🔴 **那是【終態】**(`:142` 逐字「故立獨立終態」)
   *     ⇒ 翻它 = 把一個「這張單不該收信」的裁決推翻。
   *   · `skipped_shipment_voided`  ⇒ 🔴 要**先確認箱子真的復原了**才該翻
   *     (板上 `⟦b4-SHIPUNVOID1⟧` 那一列在等的正是這個判斷)⇒ 本函式答不出那件事。
   *   · `sending`                  ⇒ 🔴🔴 **sweeper 正握著它**
   *     ⇒ codex 逐字:provider 已收信、人工同時重排 ⇒ attempts 歸零成 pending,
   *       舊持有者因世代柵欄無法標 sent ⇒ **逾 provider 冪等窗後再送會寄兩次。**
   *     ⇒ 📌 **而我的世界 4 測試把這一種當成【應成功】在驗** —— 那一格我測錯了方向。
   *
   * ✅ **只認兩態**:`pending` / `failed` —— 而 `failed` 是「可重試失敗態、非終態」
   *   (`:352` 逐字), `pending` 則是它被卡在那裡沒人撿。
   * 🛑 **新增第八態的人**:預設落在「不可重排」那一側, 要進來請在這裡具名。
   */
  IF v_status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION
      'admin_requeue_dead_email:status=% 不在可重排白名單(只認 pending/failed)⇒ 拒絕。sent=會再寄一次給客人;sending=sweeper 正握著它, 翻它會寄兩次;skipped_* 各有自己的狀態契約, 不由本函式裁決',
      v_status;
  END IF;

  IF v_attempts < v_max_attempts THEN
    RAISE EXCEPTION
      'admin_requeue_dead_email:那一列還沒放棄(attempts=% < max_attempts=%)⇒ sweeper 本來就會再試;拒絕',
      v_attempts, v_max_attempts;
  END IF;

  -- ✅ 原地翻回。
  -- 🛑 `claimed_at` **必須一起清掉** —— 那張表有一條 CHECK:
  --    `(status = 'sending') = (claimed_at IS NOT NULL)`(2026-08-31 正式庫實查)
  --    ⇒ 只翻 status 而留著 claimed_at ⇒ **CHECK 直接擋下**, 整個交易回捲。
  UPDATE public.email_outbox o
     SET status          = 'pending',
         attempts        = 0,
         claimed_at      = NULL,
         next_retry_at   = pg_catalog.now(),
         last_error_code = NULL
   WHERE o.id = p_outbox_id;

  -- 🛑 **零 PII**:不回 `recipient_email`、不回 `payload`、不回 `subject`。
  --    回的是【那一列現在長什麼樣】的最小事實, 讓呼叫端能證明它真的動了。
  RETURN pg_catalog.jsonb_build_object(
    'outbox_id',            p_outbox_id,
    'previous_status',      v_status,
    'previous_attempts',    v_attempts,
    'max_attempts',         v_max_attempts,
    'requeued',             true
  );
END
$fn$;

ALTER FUNCTION public.admin_requeue_dead_email(uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_requeue_dead_email(uuid) IS
  'M-4b ⟦b4-MAILDEAD⟧:把一封已經放棄的信(attempts >= max_attempts)原地翻回 pending 重排。'
  '🔴 一次一列, 刻意沒有批次版 —— 「把歷史一次全寄出去」那個災難需要批次入口才做得到, 不建它就是最便宜的防線。'
  '原地 UPDATE 不新 INSERT:email_outbox_event_uniq (event_type, dedup_key) 擋著, 新增會讓該 cohort 永久漏信。'
  'claimed_at 必須一起清:那張表有 CHECK (status=sending) = (claimed_at IS NOT NULL)。'
  '擋兩種非死信:已 sent(重排=再寄一次給客人)/ attempts 還沒燒完(sweeper 本來就會再試)。'
  '零 PII:不回 recipient_email / payload / subject。'
  '🔴 已知缺口(另開一列):它不檢查那封信的 payload 內容是否已過期(訂單後來可能取消或改地址)。';
COMMENT ON FUNCTION public.admin_update_order_item_amount(uuid, uuid, integer, integer, text, text, text) IS
  'M-4b E10 #13 片1:改逐品項單價。🔴 同交易改 order_items.unit_price + line_total,並重算 orders.subtotal/total。'
  '🔴 金額閘不使用任何金額口徑:order_payments 有任何一列即拒(存在性檢查)—— 因為「已收多少」的口徑未定案;'
  '放寬的觸發條件 = 退款/沖銷淨額口徑定案(plan §6a L5)。'
  '🔴 零元:0 必帶原因、>0 不得帶原因(後者防前端恆填樣板)。本層只保證 API 契約,員工手滑要在 UI 層擋。'
  '🔴 折扣單一律拒(L2):subtotal 改小可能讓 total 算成負數並撞 CHECK,員工會看到 23514。'
  '🔴 稽核 before/after 逐欄列舉 ⇒ 新增可編欄位必須同時加在那兩個 jsonb_build_object,否則靜默漏記。';
REVOKE ALL ON FUNCTION public.admin_requeue_dead_email(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_requeue_dead_email(uuid)
  FROM anon, authenticated, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_requeue_dead_email(uuid) TO service_role;

DO $post$
DECLARE
  v_expect constant text[][] := ARRAY[
    ['public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)', 'b2d93e9f109075ca377e66bfa092b925'],
    ['public.admin_requeue_dead_email(uuid)',                                            'c7e472ccad1d6f92e2709d7eb09be5b6'],
    ['public.admin_soft_delete_order_note(uuid,uuid,text,text,text)',                   'a223a1d7cfa19944ecfc5a6816223315'],
    ['public.record_manual_cancel_notice(uuid,text,text,text)',                         '2d01cabec416e44323fb075d9325766b'],
    ['public.revoke_manual_cancel_notice(uuid,uuid,text,text)',                         '7c8ca7c61f082e383cc84605d8dd93ff']
  ];
  i int; v_src text; v_config text[];
BEGIN
  FOR i IN 1 .. pg_catalog.array_length(v_expect, 1) LOOP
    SELECT p.prosrc, p.proconfig INTO v_src, v_config FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_expect[i][1]);
    IF v_src IS NULL OR pg_catalog.md5(v_src) <> v_expect[i][2] THEN
      RAISE EXCEPTION USING MESSAGE = '退回後置閘:' || v_expect[i][1] || ' 沒有回到上一代 md5 ' || v_expect[i][2] || '(實得 ' || COALESCE(pg_catalog.md5(v_src), '<null>') || ')';
    END IF;
    IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '退回後置閘:% 的 SET search_path 掉了', v_expect[i][1];
    END IF;
  END LOOP;
END
$post$;

COMMIT;
