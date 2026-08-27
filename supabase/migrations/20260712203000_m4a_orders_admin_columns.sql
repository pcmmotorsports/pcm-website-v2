-- ============================================================
-- M-4a 訂單線-01:orders 後台管理欄位 — 純加欄不破壞(display_position / order_source /
--   payment_channel / cancelled_at+reason / version)+ 不變式 CHECK + 4 索引
-- ============================================================
-- 真權威:docs/specs/2026-07-12-m4a-admin-phase1-prd.md §4.1(高風險件 #2)。
-- 依賴:20260604120000(orders 表 + payment_status/fulfillment_status enum + RLS)、
--       20260604130000 / 20260614130000(create_order RPC,最新 5-param CREATE OR REPLACE)、
--       20260613130000(orders.cart_session_id nullable 前例)、20260612150000(payment_charge_attempts)。
-- 鐵則 8(schema 改動)+ 鐵則 12(訂單 schema、連動金流對帳 / 經銷價零外洩)。
--
-- 🔴 範圍紀律(本 migration 只做這件事):
--   ① **純加欄**:5 個新欄目前皆不存在(偵察確認);全部 nullable 或帶 DEFAULT,
--      故 create_order / confirm_payment 的**具名欄 INSERT/UPDATE 不受影響**(不列新欄 → DB 填 NULL/DEFAULT)。
--      = PRD §4.1「加欄不破壞既有 create_order RPC」的成立條件。**絕不加 NOT NULL 無 DEFAULT 欄。**
--   ② **本片不碰 customer_user_id**:散客單放寬 customer_user_id→NULL 是 PRD §4.2「手動建單」slice 的事
--      (牽動 RLS 兩 policy + #256 雙扣 self-join + database.types 重 gen),風險層級不同、另片處理。
--   ③ **本片不碰 create_order / confirm_payment / 對帳 RPC**:純表結構,無 RPC 改動。
--   ④ customers.version(PRD §6.3 樂觀鎖亦要 customers 加)= 客戶線 slice 另片(本片只動 orders)。
--
-- 🔴 經銷價零外洩(鐵則 12):本片無 price_store / price_by_tier / cost 欄、無 view;沿用 orders RLS own-only。
--
-- 動手前真 DB 交易模擬:**⏳ PENDING** —— 本檔為草稿,待 Fable 對抗審(高風險件 #2)+ Sean 批准後,
--   於 project bmpnplmnldofgaohnaok(pcm-website-v2 PG17)以 MCP execute_sql
--   BEGIN → 套本 migration → DO 區塊斷言(見檔尾「交易模擬斷言清單」)→ ROLLBACK → 零留痕查,再落地。
--   **尚未執行、尚未 apply、尚未 commit。**(字面 vs 事實:不預先宣稱 PASS。)
-- ============================================================

BEGIN;

-- ── 1. display_position:後台「工作排序」手動排序鍵 ─────────────────────
-- bigint NULL:NULL = 未手動排過(列表 ORDER BY display_position NULLS FIRST, created_at DESC, id);
-- 整數稀疏間隔(相鄰差 1024)、插入取鄰居中點,皆由 admin server 端計算賦值(client 不傳 position)、
-- 本 migration 只加欄 + 索引,不含賦值邏輯。既有列全 NULL(未排過)= 相容。
ALTER TABLE public.orders ADD COLUMN display_position bigint;

-- ── 2. order_source / payment_channel:來源與金流管道(兩件事、拆兩欄)──────
-- order_source:單子從哪來。既有列皆 web(create_order 由前台建)→ DEFAULT 'web' 正確回填;
-- create_order 不寫此欄 → 得 'web';未來手動單由 admin RPC 明寫 manual_*。
ALTER TABLE public.orders
  ADD COLUMN order_source text NOT NULL DEFAULT 'web';
ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_source_check
  CHECK (order_source IN ('web', 'manual_phone', 'manual_line', 'manual_other'));

-- payment_channel:錢實際走哪條管道(與 order_source 正交:電話單也可能之後刷卡)。
-- 既有列皆 TapPay 結帳 → DEFAULT 'tappay' 正確回填;confirm_payment 寫 payment_method='tappay' 不動此欄。
ALTER TABLE public.orders
  ADD COLUMN payment_channel text NOT NULL DEFAULT 'tappay';
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_channel_check
  CHECK (payment_channel IN ('tappay', 'bank_transfer', 'cash', 'none'));

-- ── 3. cancelled_at / cancelled_reason:營運取消軸(獨立於 payment_status)──────
-- PRD §4.2:取消限 unpaid 且未出貨、原子條件更新、不硬刪(late-success 要查得到單);
-- 本 migration 只加欄,取消邏輯(原子 UPDATE)在後續 admin RPC/repository slice。
ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN cancelled_reason text;

-- ── 4. version:樂觀鎖(兩分頁互改可察覺,衝突回 409)──────────────────────
-- NOT NULL DEFAULT 1:既有列回填 1(PG11+ 常數 DEFAULT = metadata-only、無 table rewrite)。
-- admin 寫入走 `... WHERE version = $expected` 條件更新 + SET version = version + 1(後續 slice);
-- create_order/confirm_payment 不動此欄(不列 → 保持 DB 值),不受影響。
ALTER TABLE public.orders ADD COLUMN version integer NOT NULL DEFAULT 1;

-- ── 5. 不變式:非 tappay 管道的單不得帶 tappay_rec_trade_id ────────────────
-- 邏輯:NOT(channel<>'tappay' AND rec_trade_id IS NOT NULL) = (channel='tappay' OR rec_trade_id IS NULL)。
-- 既有列 payment_channel 剛回填為 'tappay'(左側恆真)→ 全部滿足 → 可直接 VALID 加、無需 NOT VALID。
-- 效果:未來 cash/bank_transfer 單若誤帶 rec_trade_id 直接被 DB 擋(對帳正向隔離的 schema 層防線)。
ALTER TABLE public.orders
  ADD CONSTRAINT orders_tappay_rec_channel_check
  CHECK (payment_channel = 'tappay' OR tappay_rec_trade_id IS NULL);

-- ── 6. 索引:list + 雙軸篩選 + 排序 + 取消篩選(server-side pagination 前置)──────
-- 6a. 工作排序主索引:對齊 ORDER BY display_position NULLS FIRST, created_at DESC, id。
CREATE INDEX orders_display_position_idx
  ON public.orders (display_position ASC NULLS FIRST, created_at DESC, id);
-- 6b. 時間排序視圖 + keyset 分頁(既有無 created_at 索引)。
CREATE INDEX orders_created_at_idx ON public.orders (created_at DESC);
-- 6c. 雙軸狀態篩選(payment_status × fulfillment_status)。
CREATE INDEX orders_status_idx ON public.orders (payment_status, fulfillment_status);
-- 6d. 已取消篩選:partial index 只索引已取消列(小、供「已取消」視圖;預設列表排除取消走 6a + IS NULL filter)。
CREATE INDEX orders_cancelled_at_idx
  ON public.orders (cancelled_at) WHERE cancelled_at IS NOT NULL;

-- ── 7. 語意分界 COMMENT(Fable 對抗審 REQUIRED-BEFORE-APPLY)───────────────
-- 🔴 orders 已有 payment_method 欄(20260604120000:109、confirm_payment 付款成功寫 'tappay')=金流「事實」軸;
--   新 payment_channel=管理/預期軸。兩軸易混淆 → COMMENT 釘死分界,防未來報表用錯欄算錢。
COMMENT ON COLUMN public.orders.payment_channel IS
  '管理/預期收款管道(建單時定、admin 可改);算實收金額用 payment_method+payment_status,勿用本欄';
-- 🔴 orders 對 authenticated 有表級 GRANT SELECT + own policy → 會員看得到自己單的 cancelled_reason。
--   故本欄=可對客文案;內部取消原因寫 admin_audit_log.reason(手動建單/取消 slice)。
COMMENT ON COLUMN public.orders.cancelled_reason IS
  '取消原因=可對客文案(會員可見自己單此欄);內部原因寫 admin_audit_log,勿寫入本欄';

COMMIT;

-- ============================================================
-- ROLLBACK(手動、逆序;本片純加欄 → 逆向純 DROP、無資料損失風險)
-- ============================================================
-- BEGIN;
--   DROP INDEX IF EXISTS public.orders_cancelled_at_idx;
--   DROP INDEX IF EXISTS public.orders_status_idx;
--   DROP INDEX IF EXISTS public.orders_created_at_idx;
--   DROP INDEX IF EXISTS public.orders_display_position_idx;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tappay_rec_channel_check;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_channel_check;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_source_check;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS version;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS cancelled_reason;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS cancelled_at;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_channel;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS order_source;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS display_position;
-- COMMIT;

-- ============================================================
-- 交易模擬斷言清單(套用時 DO 區塊逐條驗;Fable 審 + Sean 批後執行)
-- ============================================================
-- 1. 5 新欄存在且型別正確(information_schema.columns:display_position=bigint、order_source/payment_channel/
--    cancelled_reason=text、cancelled_at=timestamptz、version=integer)。
-- 2. order_source/payment_channel NOT NULL 且 DEFAULT 'web'/'tappay';version NOT NULL DEFAULT 1。
-- 3. 既有列全部被回填:SELECT count(*) FROM orders WHERE order_source IS NULL OR payment_channel IS NULL
--    OR version IS NULL → 0。
-- 4. 3 個 CHECK 存在且生效:插入 order_source='xxx' / payment_channel='xxx' / (channel='cash' 且 rec_trade_id
--    非 null)各自被擋(拋 check_violation)。
-- 5. create_order 未受影響:以既有 5-param 呼叫 create_order 成功建單、新單 order_source='web'
--    payment_channel='tappay' version=1(具名欄 INSERT 不觸新欄、走 DEFAULT)。
-- 6. 4 索引存在(pg_indexes)。
-- 7. RLS 未變:orders_select_own / order_items_select_own policy 定義不變、GRANT 矩陣不變。
-- 8. ROLLBACK 後零留痕:5 欄 / 3 CHECK / 4 索引 / 2 COMMENT 全消失(information_schema 再查為 0)。
-- 9. (Fable nit-2)無 trigger 實證:SELECT count(*) FROM pg_trigger
--    WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal → 0(把「無 trigger」從 grep 升級為 DB 實證)。
