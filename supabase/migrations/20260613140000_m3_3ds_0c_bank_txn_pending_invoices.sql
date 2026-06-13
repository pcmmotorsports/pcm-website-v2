-- ============================================================
-- M-3 3DS-0c:attempt.bank_transaction_id + begin 補回傳 + pending_invoices 待開票 durable 表
-- ============================================================
-- 真權威:docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §2(3DS-0c)/§5(S1 待開票)/§1(d)
--   + codex 關卡2(0b)#1(needs_settle 補 bank_transaction_id)+ 審查側 0c plan 關卡1 批准 + 1 consider
--     (record_pending_invoice INSERT 前驗 orders.payment_status='paid' fail-closed)。
-- 依賴:20260604120000(orders + payment_status enum)、20260612150000(payment_charge_attempts)、
--       20260613130000(0b:begin dedup + cart_session_id)、20260611120000(payment_confirmer 角色)。
-- 鐵則 8(新欄 + 改 begin RPC + 新表 + 新 RPC + GRANT)+ 鐵則 12(payment / 對帳脊椎 begin / 成交點開票)。
--
-- 🔴 設計(master plan v5 §2/§5 + 關卡1/關卡2):
--   【0c-1 脊椎】
--   ① payment_charge_attempts ADD bank_transaction_id text(nullable):3DS initiate〔3DS-5b、Phase II〕
--      送 charge「前」產生並 durable 存(回應遺失本機仍有可查鍵;master plan §1 step 1)。現流程為 NULL = 前向欄;
--      不加 length CHECK(生成方式 3DS-5b 定義時再加、審查側 secondary、避過早約束)。
--   ② begin_charge_attempt CREATE OR REPLACE:needs_settle 回傳補 existing_bank_transaction_id(codex 關卡2 #1)。
--      🔴 zero-regression(審查側點 1):相對 0b begin 只改 3 處、皆服務同一新欄回傳 —— ① +DECLARE v_dup_bank
--      ② dedup SELECT +a.bank_transaction_id INTO v_dup_bank ③ needs_settle 回傳 +existing_bank_transaction_id;
--      dedup 三態 / ORDER BY(paid→charged→created_at)/ cart_session_id null fail-closed / 既有 outcome
--      (duplicate/user_in_flight/order_locked/acquired/not_unpaid)/ ACL(CREATE OR REPLACE 保留 payment_confirmer-only)
--      **一字不動**。
--   【0c-2 S1 待開票(Sean S1=B 手開)】
--   ③ pending_invoices durable 表:settleCharge〔3DS-1b〕成交(paid)點冪等寫「該單待開票」旗標。
--      - order_id UNIQUE 冪等鍵:record_pending_invoice INSERT ON CONFLICT(order_id) DO NOTHING
--        (settleCharge paid 重入不重複開票;master plan §5 / codex r2 consider)。
--      - 🔴 只記「待開旗標 + order_id 反查」:發票細節(type/carrier/title/taxId)留 orders.invoice、
--        開票時 by order_id join 讀 → 零 PII 複製、零經銷價、零金額。
--      - status('pending'→'issued')供發票 fast-follow 片轉態(本片只建表 + record RPC、不做開票/轉態)。
--   ④ record_pending_invoice(p_order_id)SECURITY DEFINER + search_path='' + 全識別子限定;只 GRANT payment_confirmer。
--      🔴 對 1b 假設(Sean Q2=A):settleCharge 在成交(paid)點經 payment_confirmer 軌(= webhook route/charge
--      adapter 同鑰 PAYMENT_CONFIRMER_DB_URL)呼此 RPC。若 1b 改走別角色、本 GRANT 需回看(payment_confirmer 為既定付款軌、此假設最穩)。
--      🔴 fail-closed 防呆(審查側 consider):INSERT 前 SELECT orders.payment_status,非 'paid' → 通用 RAISE
--      (碰錢 RPC 鐵則12、防未來 1b 誤替未付款單開票;happy path 成交點呼恆通過)。
--   ⑤ 權限(比照 webhook_events/charge_attempts):表 RLS enable 零 policy + REVOKE PUBLIC/anon/authenticated/
--      service_role/payment_confirmer + GRANT service_role SELECT(admin 唯讀、Sean 後台開票讀;order_id/status 無 PII);
--      RPC REVOKE 四方 + GRANT payment_confirmer;全矩陣 fail-closed assert + begin ACL 回歸 assert。
--
-- ⚠️ 誠實揭示:主軌(begin / record_pending_invoice)以 payment_confirmer literal 實呼於 pooled MCP 必斷線
--   (S2-c/d、3DS-0a 多次重現)→ 等價證據 = has_function_privilege 矩陣 + owner 實跑行為 + search_path='' caller 一致;
--   真連線 round-trip 由 3DS-1b/3DS-2 對 session pooler 補。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + 本 migration DDL + synthetic + DO 斷言 + ROLLBACK、零留痕;
--   project bmpnplmnldofgaohnaok PG17、2026-06-13):
--   PASS(2026-06-13、單交易套 0b〔orders.cart_session_id〕依賴 + 0c 全 DDL + 行為斷言 + ROLLBACK):
--   ① DDL 套用無誤(ALTER attempts ADD bank_transaction_id + begin CREATE OR REPLACE + pending_invoices 表
--      + record_pending_invoice + asserts);migration 自帶 2 個 DO block(3 類 assert)全靜默通過(pending_invoices 表層 ACL
--      anon/authenticated/payment_confirmer 全零、service_role 唯 SELECT / record_pending_invoice EXECUTE 唯
--      payment_confirmer / begin ACL 回歸唯 payment_confirmer)。
--   ② begin S1-S8 零回歸(沿用 0b 8 情境)+ needs_settle 補帶 existing_bank_transaction_id:
--      S2 charged sibling 帶 BANK-A2 → needs_settle 回 existing_bank_transaction_id='BANK-A2';
--      S3 pending(無 rec/bank)→ existing_rec_trade_id/bank 皆 JSON null;S8 多 sibling charged(BANK-A8)優先;
--      S1 duplicate / S4 異 cart user_in_flight / S5 acquired / S6 null fail-closed / S7 order_locked 全不變。
--   ③ pending_invoices:P1 record_pending_invoice(paid 單)→ true(首記);P2 重入同單 → false(ON CONFLICT 冪等);
--      P3 count=1;P4 unpaid 單 → 通用 RAISE(paid 防呆、審查側 consider);P5 不存在單 → 通用 RAISE。
--   ④ ROLLBACK 後唯讀複查零留痕:pending_invoices/record_pending_invoice/attempts.bank_transaction_id/
--      orders.cart_session_id 全 absent、orders/attempts/synthetic users 全 0、begin 仍 prod 原版。
--   🔴 zero-regression 額外證據:awk 抽 0c begin vs 0b begin diff = 嚴格只 3 處(+v_dup_bank / SELECT +a.bank_transaction_id
--      / needs_settle +existing_bank_transaction_id),dedup/ORDER BY/null fail-closed/既有 outcome 逐字一致。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. 【0c-1】payment_charge_attempts ADD bank_transaction_id ──
ALTER TABLE public.payment_charge_attempts ADD COLUMN bank_transaction_id text;
COMMENT ON COLUMN public.payment_charge_attempts.bank_transaction_id IS
  'M-3 3DS-0c gateway 第二道唯一鍵。3DS initiate(3DS-5b、Phase II)送 charge「前」產生並 durable 存(回應遺失本機仍有可查鍵、Record 反查用;master plan §1 step 1)。現流程 NULL=前向欄;生成方式 3DS-5b 定義時再加 length CHECK。';


-- ── 2. 【0c-1】begin_charge_attempt CREATE OR REPLACE(needs_settle 補 existing_bank_transaction_id;codex #1)──
-- 🔴 相對 0b 只改 3 處(+v_dup_bank / SELECT +a.bank_transaction_id / needs_settle +existing_bank_transaction_id);
-- 其餘(dedup 三態、ORDER BY、null fail-closed、既有 outcome、ACL)一字不動 = zero-regression。
CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- {acquired bool, attempt_id?, fallback_token?, reason?: user_in_flight|order_locked|not_unpaid|duplicate|needs_settle, existing_*?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order        record;
  v_attempt_id   uuid;
  v_token        uuid;
  v_dup_order_id uuid;
  v_dup_display  text;
  v_dup_paid     boolean;
  v_dup_rec      text;
  v_dup_bank     text;  -- 🔴 3DS-0c 新增(needs_settle 帶 existing_bank_transaction_id)
  v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';  -- PF-E 通用訊息
BEGIN
  -- 訂單存在 + 取歸屬 + cart_session_id(customer_user_id/cart_session_id 從 orders 讀、零信任參數)
  SELECT id, customer_user_id, payment_status, cart_session_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 3DS-0b fail-closed:cart_session_id 必有(5-param create_order 入口強制寫;舊 4-param 已 DROP → 無無 key 單)
  IF v_order.cart_session_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 已 paid / refunded / partiallyPaid → 不開新 charge(與撞鎖同層級回覆、不洩具體狀態)
  -- 此讀無 row lock:與並發 confirm 有理論 race(檢查後翻 paid → 為已 paid 單插 pending row),
  -- 後果僅該單持 per-order 鎖(fail-closed、②-⑥ 對帳可解)、閘 join orders 已 paid 放行不誤卡、
  -- 零雙扣路徑;②-③c 編排層知悉(code-reviewer 2026-06-12 觀察)。
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
  END IF;

  -- 🔴 per-user 序列化(Q2=A):advisory xact lock(交易結束自動釋放、不跨外部 HTTP)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));

  -- 🔴 3DS-0b cart-instance dedup(D4 override;關卡1 fix-1:移到 user_in_flight 閘「前」)──
  -- 同 user + 同 cart_session_id + 異單,三態已扣款/扣款中證據(無時間窗、advisory lock 內 race-safe):
  --   支1 a.status='charged'(已實扣、rec 必存)/ 支2 o.payment_status='paid'(已 confirm、attempt 可能 pending)
  --   / 支3 a.status='pending' AND o 未 paid(orphan、錢可能扣)。
  -- LEFT JOIN 僅 active(pending|charged)attempt(per-order unique 保證至多一筆);ORDER BY paid 優先 → 已 paid sibling
  --   先被選為 duplicate、否則取最近 orphan 為 needs_settle。
  SELECT o.id, o.display_id, (o.payment_status = 'paid'::public.payment_status), a.rec_trade_id, a.bank_transaction_id
    INTO v_dup_order_id, v_dup_display, v_dup_paid, v_dup_rec, v_dup_bank
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_order.customer_user_id
     AND o.id              <> p_order_id
     AND o.cart_session_id  = v_order.cart_session_id
     AND (
          a.status = 'charged'
       OR o.payment_status = 'paid'::public.payment_status
       OR (a.status = 'pending' AND o.payment_status <> 'paid'::public.payment_status)
     )
   -- 排序:paid sibling 優先(→duplicate);非 paid 間 charged(已實扣、最強證據)優先於 pending,再最近(codex 關卡2 #3)
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC, (a.status = 'charged') DESC, o.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_dup_paid THEN
      -- sibling 已 paid = DB 確定完成 → 照實顯既有單(D2)
      RETURN pg_catalog.jsonb_build_object(
        'acquired', false, 'reason', 'duplicate',
        'existing_display_id', v_dup_display, 'existing_paid', true
      );
    END IF;
    -- charged-未-paid / pending-未-paid = DB 無法確定扣款與否 → 交上層 settleCharge〔3DS-1b〕Record 即時裁決(D4)
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'needs_settle',
      'existing_order_id', v_dup_order_id,
      'existing_display_id', v_dup_display,
      'existing_rec_trade_id', v_dup_rec,
      'existing_bank_transaction_id', v_dup_bank  -- 🔴 3DS-0c 新增(codex #1;settleCharge Record 查詢鍵之一)
    );
  END IF;

  -- 🔴 per-user 閘(Q2=A;round2 MF1 + round3 MF 統一 predicate;原封不動、僅移到 dedup 後 → 硬約束② 守):
  -- 「未解決付款」= 10 分鐘內、異單、active(pending|charged)、且該單尚未 paid(join orders:
  --   charged-未-paid 也擋〔雙扣視窗〕;pending-但-已-paid 放行〔不誤卡〕)。異 cart 走此擋(同 cart 已被 dedup 攔)。
  IF EXISTS (
    SELECT 1
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
  ) THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'user_in_flight');
  END IF;

  -- 🔴 per-order 佔鎖(原子;撞 active attempt → DO NOTHING → order_locked)+ 備軌 token 發放(round4 MF2)
  v_token := pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
  VALUES (p_order_id, v_order.customer_user_id, public.charge_attempt_token_hash(v_token))
  ON CONFLICT (order_id) WHERE status IN ('pending', 'charged') DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'order_locked');
  END IF;

  -- token 明文只在此回傳值(server 呼叫端記憶體);DB 只有 hash、絕不入 log
  RETURN pg_catalog.jsonb_build_object(
    'acquired', true,
    'attempt_id', v_attempt_id,
    'fallback_token', v_token
  );
END;
$fn$;

COMMENT ON FUNCTION public.begin_charge_attempt(uuid) IS
  'M-3-S2-d 佔 per-order charge 鎖 + per-user 10 分鐘閘 + 發備軌 token + 3DS-0b cart-instance dedup(D4)+ 3DS-0c needs_settle 帶 existing_bank_transaction_id。begin 序:讀 order(+cart_session_id、null fail-closed)→ not_unpaid → advisory xact lock → cart dedup(同 user 同 key 異單三態 → paid:duplicate / 其餘有扣款跡象:needs_settle〔帶 order_id/display/rec/bank、交 settleCharge 裁決〕,移到 user_in_flight 閘前)→ user_in_flight(異 cart)→ 佔鎖/order_locked。只 payment_confirmer 可呼。';


-- ── 3. 【0c-2】pending_invoices 待開票 durable 表(S1=B、Sean 手開;master plan v5 §5)──
CREATE TABLE public.pending_invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🔴 order_id UNIQUE = 冪等鍵(settleCharge paid 重入 ON CONFLICT DO NOTHING、不重複開票);反查 orders.invoice 取發票細節
  order_id    uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  -- 待開旗標(發票 fast-follow 片轉 'issued';本片只建表 + record、不做轉態)
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pending_invoices IS
  'M-3 3DS-0c 待開票 durable 表(S1=B、Sean 後台手開、master plan v5 §5)。settleCharge 成交(paid)點經 record_pending_invoice 冪等寫;order_id UNIQUE 冪等鍵(paid 重入不重複開)。🔴 只記待開旗標 + order_id 反查、發票細節留 orders.invoice(零 PII 複製、零金額/經銷價)。寫入唯 SECURITY DEFINER record_pending_invoice(payment_confirmer);表零直接權限(RLS 零 policy)。開票/轉 issued = 發票 fast-follow 片。';

-- RLS enable、零 policy(非 owner 直查全拒;寫入唯 SECURITY DEFINER owner)
ALTER TABLE public.pending_invoices ENABLE ROW LEVEL SECURITY;

-- 表層權限終態:anon/authenticated/payment_confirmer 全零;service_role 寫權收、保 SELECT(admin 唯讀;對齊 webhook_events/charge_attempts)
REVOKE ALL ON TABLE public.pending_invoices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pending_invoices FROM service_role;
REVOKE ALL ON TABLE public.pending_invoices FROM payment_confirmer;
GRANT SELECT ON TABLE public.pending_invoices TO service_role;

-- fail-closed assert:表層 ACL 終態 + payment_confirmer 表層零權限 role-hygiene(對齊 3DS-0a L97 慣例)
DO $$
BEGIN
  IF has_table_privilege('anon',          'public.pending_invoices', 'SELECT')
     OR has_table_privilege('anon',          'public.pending_invoices', 'INSERT')
     OR has_table_privilege('anon',          'public.pending_invoices', 'UPDATE')
     OR has_table_privilege('anon',          'public.pending_invoices', 'DELETE')
     OR has_table_privilege('authenticated', 'public.pending_invoices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.pending_invoices', 'INSERT')
     OR has_table_privilege('authenticated', 'public.pending_invoices', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.pending_invoices', 'DELETE')
     OR has_table_privilege('service_role',  'public.pending_invoices', 'INSERT')
     OR has_table_privilege('service_role',  'public.pending_invoices', 'UPDATE')
     OR has_table_privilege('service_role',  'public.pending_invoices', 'DELETE')
     OR has_table_privilege('service_role',  'public.pending_invoices', 'TRUNCATE')
     OR has_table_privilege('service_role',  'public.pending_invoices', 'REFERENCES')
     OR has_table_privilege('service_role',  'public.pending_invoices', 'TRIGGER')
     OR NOT has_table_privilege('service_role', 'public.pending_invoices', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'SELECT')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'INSERT')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'UPDATE')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'DELETE')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'TRUNCATE')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'REFERENCES')
     OR has_table_privilege('payment_confirmer', 'public.pending_invoices', 'TRIGGER') THEN
    RAISE EXCEPTION 'pending_invoices 表層 ACL 異常 — 應 anon/authenticated/payment_confirmer 全零、service_role 唯 SELECT;拒繼續';
  END IF;
END
$$;


-- ── 4. 【0c-2】record_pending_invoice(成交點冪等記待開票;master plan v5 §5)──
-- settleCharge〔3DS-1b〕paid 點呼 → INSERT ON CONFLICT(order_id) DO NOTHING → 回 inserted。
-- 🔴 fail-closed 防呆(審查側 consider、碰錢 RPC 鐵則12):INSERT 前驗 orders.payment_status='paid'、否則通用 RAISE
--   (防未來 1b 誤替未付款單開票;happy path 成交點呼恆通過)。SECURITY DEFINER + search_path='' + 全識別子限定。
CREATE OR REPLACE FUNCTION public.record_pending_invoice(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_generic_msg constant text := 'record_pending_invoice: 無法記錄';  -- 通用訊息(不洩內部)
  v_status   public.payment_status;
  v_inserted boolean;
BEGIN
  -- 入口 + fail-closed 防呆:訂單存在且為 paid 才記待開票(p_order_id NULL → NOT FOUND → RAISE)
  SELECT payment_status INTO v_status FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_status <> 'paid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  INSERT INTO public.pending_invoices (order_id)
  VALUES (p_order_id)
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;  -- true=首見(該單新記待開)/ false=重入(已記、no-op 冪等)
END
$fn$;

COMMENT ON FUNCTION public.record_pending_invoice(uuid) IS
  'M-3 3DS-0c:settleCharge 成交(paid)點冪等記「該單待開票」(S1=B、master plan v5 §5)。INSERT ON CONFLICT(order_id) DO NOTHING、回 inserted。fail-closed:非 paid 單通用 RAISE(碰錢防呆)。只 payment_confirmer 可呼。';

-- RPC 權限:全 REVOKE 再精準 GRANT payment_confirmer
REVOKE ALL ON FUNCTION public.record_pending_invoice(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_pending_invoice(uuid) TO payment_confirmer;


-- ── 5. fail-closed assert(RPC 矩陣 + begin ACL 回歸)──
DO $$
BEGIN
  -- record_pending_invoice EXECUTE 唯 payment_confirmer
  IF NOT has_function_privilege('payment_confirmer', 'public.record_pending_invoice(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.record_pending_invoice(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_pending_invoice(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.record_pending_invoice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_pending_invoice EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
  -- begin_charge_attempt CREATE OR REPLACE 保留 ACL = 唯 payment_confirmer(回歸 assert)
  IF NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'begin_charge_attempt EXECUTE 權限矩陣異常(CREATE OR REPLACE 後);拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.record_pending_invoice(uuid);
--   DROP TABLE IF EXISTS public.pending_invoices;
--   -- begin 還原回 20260613130000(0b)版(無 existing_bank_transaction_id;手動貼 0b begin 全文 CREATE OR REPLACE)
--   ALTER TABLE public.payment_charge_attempts DROP COLUMN IF EXISTS bank_transaction_id;
-- ============================================================
