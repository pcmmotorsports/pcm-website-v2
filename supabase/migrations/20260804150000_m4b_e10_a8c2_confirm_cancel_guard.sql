-- ============================================================
-- M-4b E10 第 1 批 · A8c2:confirm_order_payment 金流 confirm 側取消守門
-- ============================================================
-- 真權威:docs/specs/2026-08-04-e10-a8c2-confirm-cancel-guard-plan.md(v3;關卡1 R1 10MF+R2 8/10
--   +殘 2 條折入)+ master plan row 35(:382)+ A8c1 plan(同構框架;dev 57612b1 已收割)。
-- 依賴:20260611120000(confirm 基底)、20260804120000(A8c1;前置閘 pin 部署鏈)、
--       20260730130000(A7 order_cancellations)。鐵則 12①。
--
-- 🔴 設計(plan §3.2,相對基底恰四處):
--   ① 隔離閘:非 READ COMMITTED ⇒ P8C01(RR 等鎖醒來舊快照漏看已 commit 取消;A8c1/A2b1 同款)。
--      ⚠️ 錯誤優先序刻意改變:RR/serializable 下空 rec 先收 P8C01(fail-closed 最前置)。
--   ② PF-B SELECT 加 cancelled_at 欄(FOR UPDATE 既有、不動)。
--   ③ NOT FOUND 後、paid 冪等樹之前新增取消守門塊 —— 已取消且已 paid 的同 rec 同額重放
--      不得回 idempotent 成功(C7);真相表直讀、零摘要表;PF-E 通用訊息。
--   ④ COMMENT 更新。
--   其餘(輸入驗、PF-D 樹、cross-order pre-check、PF-G、PF-C、EXCEPTION backstop)一字不動;
--   基底無過時註解。零 TS 改動(PaymentConfirmerAdapter.ts:128 RAISE→throw 既有路徑)。
--
-- 🔴 鎖面:列鎖全屬既有(PF-B 自 s2c;不觸 attempts ⇒ mark 家族環不適用);新增 relation 級面=
--   守門 EXISTS 對 order_cancellations 取 ACCESS SHARE(與 ACCESS EXCLUSIVE 維護互斥;
--   harness E2′ 格;A8c1 begin 守門同面、隨 STOP 檔對帳)。
--
-- 🔴 前置閘兩支:①confirm=基底現值 ②begin=A8c1 新版(部署鏈 pin:A8c1 未落地不得套本片,
--   R8 序 DB 層強制)。md5 pin=同 PG17 內漂移偵測、非可攜語意證明(不符=安全 false-stop)。
--   harness「先回基底再重放」流程冪等;直接二次 apply 紅在 confirm 基底閘(forward-only、預期)。
--
-- ⛔ apply 停點:不 apply;apply 前六條唯讀檢查+apply 後 read-back+confirm 專屬診斷行=plan §7。
-- 動手前模擬:剝殼後拋棄庫單交易通過(plan §6-7;harness 常設格)。
-- Rollback:plan §7 決策樹逐字(三分支;取消資料存在=任何守門不得回退;還原=基底本體
--   20260611120000:117-199 逐字 + 基底 COMMENT)。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:confirm 基底 + begin=A8c1 新版(部署鏈)──
DO $$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure));
  IF v <> '8eeb4274cbaede45a34818657ead7537' THEN
    RAISE EXCEPTION 'A8c2 前置閘:confirm_order_payment 現定義非基底(md5=%);停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure));
  IF v <> 'f621a56231e20f7f0b2618b40ac1276d' THEN
    RAISE EXCEPTION 'A8c2 前置閘:begin_charge_attempt 非 A8c1 新版(md5=%)——R8 部署鏈:先 apply 20260804120000', v;
  END IF;
END
$$;


-- ── 1. confirm_order_payment CREATE OR REPLACE(基底 + 四處;plan §3.2)──
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id     uuid,
  p_amount       integer,
  p_rec_trade_id text
)
RETURNS jsonb                 -- {confirmed boolean, idempotent boolean};禁回 total/價結構(PF-G)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_n           integer;
  v_generic_msg constant text := 'confirm_order_payment: 付款確認失敗';  -- 🔴 PF-E:業務拒絕單一通用訊息、不洩內部狀態
BEGIN
  -- 🔴 A8c2 隔離閘(fail-closed;A8c1 同款、A2b1 教訓):非 READ COMMITTED 下 FOR UPDATE 等鎖
  --    醒來後快照仍舊、部分取消不動 orders 列 ⇒ EXISTS 看不到已 commit 取消。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'confirm_order_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- ── 輸入驗:rec_trade_id 非空(server 自供參數、非訂單內部狀態 → 可具體)──
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'confirm_order_payment: 交易識別碼缺失';
  END IF;

  -- ── PF-B:FOR UPDATE 鎖臨界區 ──
  SELECT id, total, payment_status, tappay_rec_trade_id, cancelled_at
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  -- ── PF-D(1):訂單不存在 → 拒(通用、不洩存在與否)──
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 A8c2 取消守門(master plan row 35;R8 守門先於取消):存在任何取消紀錄 ⇒ 拒確認。
  --    位置=paid 冪等樹之前:已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功。
  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約);通用訊息=PF-E。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(3):paid 且 rec_trade_id+amount 雙等 → no-op 冪等成功(真 RETURN、不 UPDATE、不刷時間戳)──
  IF v_order.payment_status = 'paid'::public.payment_status THEN
    IF v_order.tappay_rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id
       AND p_amount IS NOT NULL AND v_order.total = p_amount THEN
      RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true);
    END IF;
    -- PF-D(4):paid 但 rec 或 amount 任一不等(疑重複扣款/竄改)→ 拒
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(4):refunded / partiallyPaid(非 unpaid)→ 拒(同 rec 也不復活成 paid)──
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(5):unpaid 且金額相符 → 翻 paid;金額不符/NULL → 拒(整數比對、不洩 total)──
  IF p_amount IS NULL OR p_amount <> v_order.total THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── cross-order rec_trade_id 重用序列 pre-check(優雅通用訊息;UNIQUE 並發 backstop 見 EXCEPTION)──
  PERFORM 1 FROM public.orders
   WHERE tappay_rec_trade_id = p_rec_trade_id AND id <> p_order_id;
  IF FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-G:翻 paid、僅 5 欄、零 fulfillment_status;WHERE 帶 payment_status='unpaid' 條件式 ──
  UPDATE public.orders
     SET payment_status      = 'paid'::public.payment_status,
         tappay_rec_trade_id = p_rec_trade_id,
         paid_at             = pg_catalog.now(),
         payment_method      = 'tappay',
         updated_at          = pg_catalog.now()
   WHERE id = p_order_id
     AND payment_status = 'unpaid'::public.payment_status;

  -- ── PF-C:row_count 守(防 FORCE RLS 靜默 0 列=收錢沒翻單)──
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false);

EXCEPTION
  -- 🔴 PF-E:cross-order rec_trade_id 真並發撞 orders.tappay_rec_trade_id UNIQUE → 通用訊息(不洩 raw 23505/約束名)
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.confirm_order_payment(uuid, integer, text) IS
  'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。';


-- ── 2. 結構 assert:碼錨(code-exact)+ UNIQUE indexdef pin + ACL 窮舉 + SECDEF fail-open 面 ──
DO $$
DECLARE v_def text; v_idx text;
BEGIN
  v_def := pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure);
  IF position(E'USING ERRCODE = \'P8C01\'' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c2 結構 assert:隔離閘碼錨缺失;拒繼續';
  END IF;
  IF position('id, total, payment_status, tappay_rec_trade_id, cancelled_at' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c2 結構 assert:cancelled_at 欄碼錨缺失;拒繼續';
  END IF;
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_def) = 0
     OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c2 結構 assert:取消守門碼錨缺失;拒繼續';
  END IF;
  IF position(E'WHERE id = p_order_id\n   FOR UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c2 結構 assert:PF-B FOR UPDATE 碼錨缺失(zero-regression 破);拒繼續';
  END IF;
  IF position('GET DIAGNOSTICS v_n = ROW_COUNT;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c2 結構 assert:PF-C 碼錨缺失(zero-regression 破);拒繼續';
  END IF;
  -- 🔴 順序錨(codex 關卡2 R2 加嚴:錨完整條件字面防反轉;paid 錨用真 IF 非註解)
  IF position('current_setting(''transaction_isolation'') <> ''read committed''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c2 碼錨:隔離閘條件字面缺失或被反轉;拒繼續';
  END IF;
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_def)
     >= position('IF v_order.payment_status = ''paid''::public.payment_status THEN' in v_def) THEN
    RAISE EXCEPTION 'A8c2 順序錨:取消守門不在 paid 冪等樹(真 IF)之前;拒繼續';
  END IF;
  IF position('current_setting(''transaction_isolation'')' in v_def)
     >= position('交易識別碼缺失' in v_def) THEN
    RAISE EXCEPTION 'A8c2 順序錨:隔離閘不在輸入驗之前;拒繼續';
  END IF;
  -- 🔴 P7 兩層的安全承重=UNIQUE 索引存在(pre-check 行為不可判別、誠實認列;plan §5.1 P7b)
  SELECT indexdef INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='orders' AND indexname='orders_tappay_rec_trade_id_key';
  IF v_idx IS DISTINCT FROM 'CREATE UNIQUE INDEX orders_tappay_rec_trade_id_key ON public.orders USING btree (tappay_rec_trade_id)' THEN
    RAISE EXCEPTION 'A8c2 結構 assert:rec UNIQUE indexdef 漂移([%]);backstop 失據、拒繼續', v_idx;
  END IF;
  -- 🔴 indexdef 相同但 invalid/not-ready 的索引不提供 backstop(codex 關卡2 抓)
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = 'public.orders_tappay_rec_trade_id_key'::regclass
                    AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique) THEN
    RAISE EXCEPTION 'A8c2 結構 assert:rec UNIQUE 索引非 valid/ready/live/unique;backstop 失據、拒繼續';
  END IF;
  -- 有效權閘(has_function_privilege 涵蓋 role 繼承;直接 ACL 窮舉抓不到 membership)
  IF has_function_privilege('anon',          'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8c2 有效權閘異常 — confirm 應只 payment_confirmer 可呼(含繼承);拒繼續';
  END IF;
  -- ACL 窮舉(含 GRANT OPTION 指紋;A8c1 版式)
  DECLARE v_grantees text;
  BEGIN
    SELECT string_agg(g, ',' ORDER BY g)
      INTO v_grantees
      FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                   || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
              FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'public.confirm_order_payment(uuid,integer,text)'::regprocedure
               AND a.privilege_type = 'EXECUTE') t;
    IF v_grantees IS DISTINCT FROM 'payment_confirmer,postgres' THEN
      RAISE EXCEPTION 'A8c2 ACL 窮舉異常 — EXECUTE grantee 全集=[%];拒繼續', v_grantees;
    END IF;
  END;
  -- SECDEF fail-open 面(守門讀表 owner 對齊 + FORCE RLS off)
  DECLARE v_fn_owner oid; v_bad text;
  BEGIN
    SELECT proowner INTO v_fn_owner FROM pg_proc WHERE oid='public.confirm_order_payment(uuid,integer,text)'::regprocedure;
    SELECT string_agg(c.relname, ',') INTO v_bad
      FROM pg_class c
     WHERE c.oid IN ('public.orders'::regclass, 'public.order_cancellations'::regclass)
       AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'A8c2 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on;拒繼續', v_bad;
    END IF;
  END;
END
$$;

COMMIT;
