-- ═══ ⟦深掃-A1⟧ 改價時把「當下有一筆付款正在進行」記進稽核 ═══
-- 出板:線【權限/信件】窗 C, 2026-09-09。plan `docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md`。
-- 授權鏈逐字:Sean 2026-09-09 拍【乙】—— 不擋, 而是把「那筆改價當下有一筆付款正在進行」記下來。
--   而端他的時候兩句限定逐字講了:①乙【不防止】問題, 錢仍然會卡那一次
--   ②它補的不是「有沒有改價紀錄」(今天就有), 是「那筆改價當下有沒有付款正在進行」。
-- SQL 由主視窗代貼, 窗 C 不 apply。
--
-- ── 病(四步, 每一步窗 C 都開檔驗過)────────────────────────────────────────
--   1. 客人結帳 NT$1,000 ⇒ 建 pending charge attempt ⇒ 跳銀行 3DS
--   2. 那幾十秒內員工把單價改成 900 —— 而改價的金額閘逐字是
--      「這張單有【任何一列】收款 ⇒ 拒」(只查 order_payments)⇒ 此時還沒有收款紀錄 ⇒ 放行
--   3. 銀行完成 NT$1,000 的扣款
--   4. 對帳把銀行的 1000 與【對帳當下從 orders 現撈的 900】比(20260624120007:151-155
--      逐字 SELECT total ... FROM public.orders WHERE id = p_order_id)⇒ 不符 ⇒ 拒絕認列
--   ⇒ 🔴 錢扣了而單子永遠未付款, 而兩邊紀錄都「正常」⇒ 沒有任何一道尺會叫。
--
-- ── 🛑 本片【不做】什麼(寫在最前面, 免得被讀成修好了)────────────────────
--   · **不擋改價** —— 那是方向甲, 而 pending attempt 沒有單靠逾時的釋放
--     (release 要客人自己再結帳一次才觸發)⇒ 甲會讓客人放棄之後那張單的價格永遠改不了。
--   · **不改任何判斷式** —— 改價放不放行, 與本片之前逐字相同。
--   · **不作廢 attempt** —— 那是方向丙;而【刪除/failed】那個版本比現況更糟(退出對帳),
--     【released】那條窗 C 沒有評估完。
--   ⇒ 📌 **本片只多寫兩個稽核鍵。錢仍然會卡那一次, 而查得出來為什麼。**
--
-- ── 🔴 這支 SQL 最容易安靜出錯的一格 ──────────────────────────────────────
--   線上這支是 SECURITY DEFINER 且帶 SET search_path TO ''(唯讀實測 proconfig)。
--   而 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 少寫那一行, 強化被打回去
--   而函式本體 md5 一模一樣、每一道尺照樣綠。
--   ⇒ ✅ 基底 = 2026-09-09 14:5x UTC 從【正式庫】唯讀取的 pg_get_functiondef
--        (原樣存在 docs/evidence/2026-09-09-admin_update_order_item_amount-live-baseline.sql),
--        **不是** supabase/migrations/20260905360000 那一份。
--   ⇒ 事後閘② 專門守這一格。
--
-- ── 影響 ────────────────────────────────────────────────────────────────
--   · 🔴 **本函式【第一次】相依 payment_charge_attempts**(改前 grep -c charge_attempt ⇒ 0)。
--     刻意用純 SELECT **不取列鎖** —— 加鎖會把改價與 3DS 那條路綁在一起, 而本片要的是留證據不是協調。
--     🛑 **而「不加鎖」要收窄**(codex R1 ②):它仍取 `ACCESS SHARE` **表鎖**, 可能等待 DDL
--        ⇒ **不能說「完全不加鎖」**。
--     ✅ 而死結那一格 codex 複核過:付款那條路是【先鎖 attempt、後更新 orders】
--        (`20260906700000:183`), 而本片的查詢**不取 attempt 的列鎖** ⇒ **不形成反向等待環。**
--   · 查詢成本 = 一次 index lookup(走既有的 partial UNIQUE order_lock_idx, 述詞與 active 集逐字相同)。
--   · 撈不到 ⇒ 留 NULL 並把 status 標成 'lookup_failed'。
--     🛑 **而「永遠不讓改價失敗」是我原本講太滿的**(codex R1 ②):`EXCEPTION WHEN OTHERS`
--        **不捕捉** `query_canceled` 與 `assert_failure` ⇒ **那一發若撞 statement timeout, 改價仍會失敗。**
--     🔵 而它確實只包住新增那一段:捕捉到錯只回滾那個子區塊, **不會吞掉前面 UPDATE 或後面稽核 INSERT 的錯**。
--     ⚠️ 另一格:非 STRICT 的 `SELECT INTO` 回多列時【任取第一列】、**不會**進 `lookup_failed`
--        ⇒ 那個「最多一列」的保證由前置閘② 守著(而它現在驗 UNIQUE + valid + 述詞)。
--   · 對現行行為零改變:改價照樣成功、判準一字未動、既有那五個稽核鍵一字未動。
--
-- ── rollback ────────────────────────────────────────────────────────────
--   supabase/rollbacks/20260909080000-rollback.sql(= 那份線上基底, 已包交易封套與 lock_timeout)

BEGIN;

-- 🔴 ⟦b4-LOCK1⟧ 鎖超時:CREATE OR REPLACE FUNCTION 會拿 ACCESS EXCLUSIVE LOCK。
SET LOCAL lock_timeout = '5s';

-- ══ 前置閘 ══════════════════════════════════════════════════════════════════
DO $gate$
DECLARE v_bad text;
BEGIN
  -- 前置閘① 那支函式在, 而且仍是 SECURITY DEFINER + search_path 空字串。
  --   不符 ⇒ 本檔的基底(2026-09-09 14:5x UTC 的線上定義)已經過期, 停。
  -- 🔴🔴 [codex R1 must-fix ⑤] 第一版只查【名稱 + secdef + search_path】——
  --   ⇒ 別的窗若改了改價的稅額 / 收款 / 權限判斷, 而那兩個屬性沒動,
  --     這道閘照樣放行, 然後我整支覆蓋回舊邏輯。**四道事後閘也攔不住。**
  --   ⇒ 而它還攔不住另一種:【七參數那一版不存在、只剩別的多載】——
  --     那時 CREATE OR REPLACE 會變成【新增函式】而拿到新物件的預設權限。
  --   ✅ 修法 = 用完整七參數的 regprocedure 鎖定, 而且比對【本體的 md5】等於核准基底。
  IF pg_catalog.to_regprocedure(
       'public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '貼板 A1 前置閘①:那個【七參數】簽章不存在 ⇒ 停。'
                    'CREATE OR REPLACE 在這種情況會變成【新增函式】而拿到預設權限, 不是取代。';
  END IF;

  SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure(
           'public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)')
     AND (p.prosecdef IS NOT TRUE
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '貼板 A1 前置閘①:這支已不是「SECURITY DEFINER + search_path 空字串」⇒ 基底過期, 停:%', v_bad;
  END IF;

  -- 前置閘①-b 🔴 **本體必須逐字元等於核准基底** —— 這才是真正擋住「別人改過而我覆蓋回去」的那一道。
  --   md5 由主視窗在代貼前用同一支查詢取一次比對(見 plan §7 的貼前程序);
  --   而這裡釘住【那幾個承重字面仍在】, 當作檔內的第二層。
  IF pg_catalog.pg_get_functiondef(
       pg_catalog.to_regprocedure(
         'public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)'))
     NOT LIKE '%pcm_e13_no_edit_after_payment%' THEN
    RAISE EXCEPTION '貼板 A1 前置閘①-b:線上那支找不到收款金額閘的字面 ⇒ '
                    '它已經不是我核准的那一版 ⇒ 停, 重新取一次線上定義。';
  END IF;

  -- 前置閘② 🔴 那個索引必須在 —— 本片的查詢靠它才便宜。
  -- 🔴 [codex R1 ⑤] 只驗索引【名字】不夠 —— 要驗它是 UNIQUE、有效、而且述詞涵蓋那三個 status。
  --   理由:本片的 SELECT INTO 【沒有 LIMIT】, 而它靠那個 UNIQUE 保證最多一列。
  --   ⚠️ 而 codex 提醒了一格我原本沒寫:非 STRICT 的 SELECT INTO 回多列時【任取第一列】,
  --     不會進 lookup_failed ⇒ 那個保證一旦失效, 稽核欄位會安靜地記到「某一筆」而不是「那一筆」。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class i
      JOIN pg_catalog.pg_index x ON x.indexrelid = i.oid
      JOIN pg_catalog.pg_class c ON c.oid = x.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'payment_charge_attempts'
       AND i.relname = 'payment_charge_attempts_order_lock_idx'
       AND x.indisunique
       AND x.indisvalid
       AND pg_catalog.pg_get_indexdef(i.oid) LIKE '%pending%'
       AND pg_catalog.pg_get_indexdef(i.oid) LIKE '%charged%'
       AND pg_catalog.pg_get_indexdef(i.oid) LIKE '%released%') THEN
    RAISE EXCEPTION '貼板 A1 前置閘②:payment_charge_attempts_order_lock_idx 不在, 或它不再是'
                    '【UNIQUE + valid + 述詞含 pending/charged/released】⇒ '
                    '本片的 SELECT INTO 失去「最多一列」的保證(而它會安靜地任取一列)⇒ 停';
  END IF;
END $gate$;

-- ══ 改動:基底 + 兩個稽核鍵(判斷式一字未動)═══════════════════════════════
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

-- ══ 事後閘 ══════════════════════════════════════════════════════════════════
DO $post$
DECLARE v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_update_order_item_amount';

  -- 事後閘① 🔴 新的兩個稽核鍵【真的在函式本體裡】——
  --   而這一格【不需要一筆真的改價】就證得到(貼板當下沒有 pending attempt 可造)。
  IF v_def NOT LIKE '%active_charge_attempt_id%'
     OR v_def NOT LIKE '%active_charge_attempt_status%' THEN
    RAISE EXCEPTION '貼板 A1 事後閘①:新的稽核鍵沒進去 ⇒ 停';
  END IF;

  -- 事後閘② 🔴 SET 子句 / SECURITY DEFINER 沒被 CREATE OR REPLACE 吃掉。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_update_order_item_amount'
       AND (p.prosecdef IS NOT TRUE
            OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])) THEN
    RAISE EXCEPTION '貼板 A1 事後閘②:SET search_path / SECURITY DEFINER 掉了 ⇒ 停';
  END IF;

  -- 事後閘③ ⚪ 正對照:既有的那五個稽核鍵【一個都不能少】——
  --   少了它, 「我把 after 整段換掉」與「我只多加兩個鍵」在事後閘① 眼裡一樣綠。
  --
  -- 🔴🔴 **這道閘的第一版【叫不動】, 而那是在拋棄式 PG 上量到的, 不是想到的。**
  --   ⛔ ~~IF v_def NOT LIKE '%zero_price_reason%'~~ —— 我把那一行【整行刪掉】去測它,
  --      而它【沒有紅】:因為 `p_zero_price_reason` 這個【參數名】還在簽章與別處,
  --      那個子字串照樣命中 ⇒ 📌 **一道用子字串當判準的閘, 被同名的參數餵飽了。**
  --   ✅ 修法 = 比對【那一對鍵與值的完整字面】, 而不是那個名字本身。
  --   🎯 而這一格值得留著:本片的病(對帳失敗時沒人知道為什麼)與這道閘的病
  --      (綠了而其實沒在看)是同一種 —— **一個看起來正常的輸出, 由好幾種原因產生。**
  IF position('''zero_price_reason'', p_zero_price_reason' in v_def) = 0
     OR position('''unit_price'',        p_unit_price' in v_def) = 0
     OR v_def NOT LIKE '%order.item.amount.update%' THEN
    RAISE EXCEPTION '貼板 A1 事後閘③(正對照):既有的稽核鍵少了 ⇒ 我改到不該改的 ⇒ 停';
  END IF;

  -- 事後閘④ ⚪ 正對照:改價的判斷式【一字未動】—— 那道金額閘還在。
  IF v_def NOT LIKE '%pcm_e13_no_edit_after_payment%' THEN
    RAISE EXCEPTION '貼板 A1 事後閘④(正對照):改價的金額閘不見了 ⇒ 我動到判斷式 ⇒ 停';
  END IF;
END $post$;

COMMIT;
