-- ============================================================
-- M-4a 訂單線:訂單處理狀態(可設定+顏色)+ 發票紀錄欄 — workflow_status /
--   order_status_options(seed Sean 9 狀態)/ invoice_number+invoice_amount+invoice_status
-- ============================================================
-- 真權威:docs/specs/2026-07-13-m4a-order-workflow-status-design.md(Slice A)
--          + docs/specs/2026-07-12-m4a-admin-phase1-prd.md §4/§6。
-- 鐵則 8(schema 改動)+ 鐵則 12(訂單 schema、經銷價零外洩)+ 鐵則 9:狀態詞彙=L3
--   → 後台 CRUD(Slice D)已入 PRD/設計檔,本表即其資料層。
-- 依賴:20260604120000(orders 表)、20260712203000(orders 6 管理欄,已在 prod、MCP 實查核實)。
--
-- 🔴 與設計檔的偏離(prod 實查 2026-07-14,以 live 為準):
--   · 設計檔 Slice A 寫「orders 加 shipping_method」——**不加**:orders.shipping_method 自
--     20260604120000 建表即存在(text NOT NULL、結帳寫入、現值 'home'),直接顯示即可。
--   · 既有 orders.invoice(jsonb NOT NULL)=客人結帳時的**開票需求**(type/taxId/carrier…);
--     本片新增三欄=Sean 的**開票紀錄**(號碼/金額/已開),兩者語意不同、並存不混(COMMENT 釘死)。
--
-- 🔴 金流護欄(設計檔硬性):workflow_status = Sean 的操作/顯示狀態,**絕不驅動**金流/對帳/退款/
--   雙扣告警;金流真相軸恆為 payment_status(+payment_method 事實軸)。本 migration 不碰任何
--   RPC / RLS policy / 既有欄,create_order・confirm_payment 具名欄寫入零接觸(新欄全 nullable
--   或帶 DEFAULT)。
--
-- 🔴 會員可見性(既有事實、非本片新開):orders 對 authenticated 有**表級 SELECT**(own-only RLS)
--   → 新欄(workflow_status / invoice_*)會員查自己的單時可直讀。故 workflow_status 標籤文案
--   視為**可對客**(同 cancelled_reason 先例);invoice_* 為客人自己的發票資訊、無外洩面。
--   order_status_options 表則 client 全鎖(label/color 只進後台)。
--
-- 🔴 範圍紀律(本 migration 只做這件事):
--   ① orders 純加 4 欄(workflow_status / invoice_number / invoice_amount / invoice_status),
--      全 nullable 或帶 DEFAULT;**絕不加 NOT NULL 無 DEFAULT 欄**。
--   ② 新表 order_status_options + seed 9(截圖標籤逐字、顏色近似待 Sean 微調)。
--   ③ 既有 30 筆 orders 依雙軸盡力對映回填 workflow_status(設計檔拍雛形預設 (a);Sean 玩雛形
--      可全清重設)。
--   ④ 不碰:RPC / RLS policy / view / 既有欄 / customer_user_id / 正式取消流程。
--
-- 動手前真 DB 交易模擬:✅ PASS ×2(2026-07-14,project bmpnplmnldofgaohnaok,MCP execute_sql
--   BEGIN → 套本檔 → 斷言(欄/CHECK 生效/ACL 終態/seed 9/backfill 30 筆全中/create_order 零接觸/
--   無 trigger/不在 realtime publication)→ ROLLBACK → 零留痕查全 0。R1 版跑過一次;Fable R1
--   3 must-fix(backfill paid 矩陣/交易邊界/UPDATE 收窄)修正後**重跑第二次 PASS**。
--   詳單=pcm-tools/review-inbox/m4a-order-workflow-status-a.md(+R2)。**尚未 apply(等 Sean db push)。**
--
-- 🔴 交易邊界(Fable R1 must-fix 2):**本檔刻意無顯式 BEGIN;/COMMIT;** —— supabase CLI
--   (pkg/migration ExecBatch)把整檔 statement + schema_migrations 登記本就跑在同一隱式交易;
--   檔內顯式 COMMIT 會提早結束隱式交易,讓「schema 落地」與「history 登記」之間出現斷線窗
--   (斷線=下次 db push 重跑撞 CREATE TABLE 卡死)。無顯式 COMMIT 時 DO 斷言 RAISE 連 history
--   一起回滾=fail-closed 更乾淨。(203000/210000 有顯式 BEGIN/COMMIT=歷史事實、已上 prod 不回改。)
-- ============================================================

-- ── 1. order_status_options:Sean 可設定的訂單處理狀態詞彙(策展清單)──────────
-- code = 穩定識別碼(orders.workflow_status soft-ref;ascii slug、不隨 label 改動);
-- label = 顯示文字(截圖逐字);color = badge 底色 hex;text_color = 淺/深字(深底淺字);
-- sort_order = 下拉排序(留 10 間隔供插入);is_active = soft-delete(不硬刪,既有單指向不消失)。
-- 🔴 不用 Postgres ENUM(要可增刪改)、orders 端不用硬 FK(Sean 改詞彙彈性;顯示端兜 NULL/未知 code)。
CREATE TABLE public.order_status_options (
  code        text        PRIMARY KEY,
  label       text        NOT NULL,
  color       text        NOT NULL,
  text_color  text        NOT NULL DEFAULT 'dark',
  sort_order  integer     NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_status_options_code_format  CHECK (code ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT order_status_options_label_len    CHECK (btrim(label) <> '' AND char_length(label) <= 32),
  CONSTRAINT order_status_options_color_hex    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT order_status_options_text_color   CHECK (text_color IN ('light', 'dark'))
);

COMMENT ON TABLE public.order_status_options IS
  'M-4a 後台訂單處理狀態詞彙(Sean 可設定+顏色;設計檔 2026-07-13)。orders.workflow_status soft-ref 本表 code(無硬 FK);soft-delete 用 is_active、不硬刪;client(anon/authenticated)全鎖、只 admin server(service_role)讀寫;刪除權不開,UPDATE 收窄 column-level(code/created_at 凍結)。';

-- ── 2. seed:Sean Sheet 現用 9 狀態(標籤逐字;顏色近似、hex 待 Sean 玩雛形微調)──
INSERT INTO public.order_status_options (code, label, color, text_color, sort_order) VALUES
  ('received_confirmed',   '已收已定', '#FBE4A6', 'dark',  10),
  ('received_unconfirmed', '已收未定', '#F8D7DA', 'dark',  20),
  ('shipped_done',         '出貨完成', '#C6E7B3', 'dark',  30),
  ('unpaid_confirmed',     '未收已定', '#F2A0A0', 'dark',  40),
  ('unpaid_shipped',       '未收出貨', '#A52A2A', 'light', 50),
  ('unpaid_unconfirmed',   '未收未定', '#F5F26B', 'dark',  60),
  ('unpaid_instock',       '未收現貨', '#7B3FA0', 'light', 70),
  ('instock_available',    '現貨在庫', '#2E7D46', 'light', 80),
  ('cancelled',            '已取消',   '#E57373', 'dark',  90);

-- ── 3. order_status_options ACL:client 全鎖、admin server 讀寫、無 DELETE ──────
-- 鏡像 20260712210000 admin_audit_log 模式:RLS zero-policy 縱深 + 顯式 REVOKE 再精準 GRANT。
ALTER TABLE public.order_status_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_status_options FROM PUBLIC, anon, authenticated, service_role;
-- admin(sb_secret_=service_role)讀選項+Slice D 增改;DELETE 不開(soft-delete 用 is_active)。
-- 🔴 UPDATE 收窄 column-level(Fable R1 must-fix 3):凍結 code(PK=orders.workflow_status soft-ref
--    的穩定識別碼;可 UPDATE 的話 Slice D 一個 buggy update 即把既有單指向孤兒化=效果近似硬刪)
--    與 created_at(建檔時間不可竄)。把 COMMENT 自宣的「code 穩定、不硬刪」升為 DB 強制。
GRANT SELECT, INSERT ON TABLE public.order_status_options TO service_role;
GRANT UPDATE (label, color, text_color, sort_order, is_active)
  ON public.order_status_options TO service_role;

-- ── 4. orders.workflow_status:Sean 的主操作狀態欄(nullable、soft-ref)──────────
ALTER TABLE public.orders ADD COLUMN workflow_status text;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_workflow_status_format
  CHECK (workflow_status IS NULL OR workflow_status ~ '^[a-z0-9_]{1,64}$');

COMMENT ON COLUMN public.orders.workflow_status IS
  '後台訂單處理狀態(soft-ref order_status_options.code;NULL=未設定)。🔴 純操作/顯示層:絕不驅動金流/對帳/退款/雙扣告警,金流真相=payment_status(+payment_method 事實軸)。會員可讀自己單此欄(表級 SELECT)→ 對應標籤文案視為可對客。';

-- ── 5. orders 發票「紀錄」三欄(v1 簡單欄位;電子發票 API 串接=大題另議)──────────
-- 與既有 invoice jsonb(客人結帳開票**需求**:抬頭/統編/載具)語意不同:本三欄=實際**開票紀錄**。
ALTER TABLE public.orders ADD COLUMN invoice_number text;
ALTER TABLE public.orders ADD COLUMN invoice_amount integer;
ALTER TABLE public.orders ADD COLUMN invoice_status text NOT NULL DEFAULT 'not_issued';
ALTER TABLE public.orders
  ADD CONSTRAINT orders_invoice_number_len
  CHECK (invoice_number IS NULL OR (btrim(invoice_number) <> '' AND char_length(invoice_number) <= 64));
ALTER TABLE public.orders
  ADD CONSTRAINT orders_invoice_amount_nonneg
  CHECK (invoice_amount IS NULL OR invoice_amount >= 0);
ALTER TABLE public.orders
  ADD CONSTRAINT orders_invoice_status_check
  CHECK (invoice_status IN ('not_issued', 'issued', 'voided'));

COMMENT ON COLUMN public.orders.invoice_number IS
  '開票紀錄:發票號碼(Sean 手填;v1 不串電子發票 API)。既有 invoice jsonb=客人結帳開票需求,語意不同勿混。';
COMMENT ON COLUMN public.orders.invoice_amount IS
  '開票紀錄:發票金額(integer 元位,對齊 orders 金額家族;非分)。';
COMMENT ON COLUMN public.orders.invoice_status IS
  '開票紀錄狀態:not_issued 未開 / issued 已開 / voided 已作廢(v1 簡單三值)。';

-- ── 6. 索引:workflow_status 篩選(後台列表主篩選軸)──────────────────────────
CREATE INDEX orders_workflow_status_idx ON public.orders (workflow_status);

-- ── 7. backfill:既有單依雙軸對映(設計檔雛形預設 (a);Sean 可全清重設)────────────
-- 對映=真權威 §6.1 完整 2×4 矩陣(docs/architecture/2026-04-30-backend-and-automation-design.md;
-- Fable R1 must-fix 1:「已定/未定」對映 fulfillment 訂貨軸,paid 分支不得塌陷):
--   cancelled_at 非 null → cancelled(已取消)
--   paid   × shipped    → shipped_done(出貨完成)      unpaid × shipped    → unpaid_shipped(未收出貨)
--   paid   × inStock    → instock_available(現貨在庫)  unpaid × inStock    → unpaid_instock(未收現貨)
--   paid   × ordered    → received_confirmed(已收已定)  unpaid × ordered    → unpaid_confirmed(未收已定)
--   paid   × notOrdered → received_unconfirmed(已收未定) unpaid × notOrdered → unpaid_unconfirmed(未收未定)
--   refunded / partiallyPaid 留 NULL=未設定(無對應詞彙、不硬湊)。
-- 實查 2026-07-14 分佈:unpaid×notOrdered 24 筆(#249 孤兒)+ paid×notOrdered 6 筆(收款、尚未向
-- 廠商訂貨)→ 24 未收未定 + 6 已收**未**定。
UPDATE public.orders SET workflow_status = CASE
  WHEN cancelled_at IS NOT NULL THEN 'cancelled'
  WHEN payment_status = 'paid'   AND fulfillment_status = 'shipped' THEN 'shipped_done'
  WHEN payment_status = 'paid'   AND fulfillment_status = 'inStock' THEN 'instock_available'
  WHEN payment_status = 'paid'   AND fulfillment_status = 'ordered' THEN 'received_confirmed'
  WHEN payment_status = 'paid'   THEN 'received_unconfirmed'
  WHEN payment_status = 'unpaid' AND fulfillment_status = 'shipped' THEN 'unpaid_shipped'
  WHEN payment_status = 'unpaid' AND fulfillment_status = 'inStock' THEN 'unpaid_instock'
  WHEN payment_status = 'unpaid' AND fulfillment_status = 'ordered' THEN 'unpaid_confirmed'
  WHEN payment_status = 'unpaid' THEN 'unpaid_unconfirmed'
  ELSE NULL
END
WHERE workflow_status IS NULL;

-- ── 8. fail-closed 斷言:order_status_options ACL 終態 + seed 完整 ──────────────
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_col  text;
  v_cnt  integer;
BEGIN
  -- 8a. client 角色 7 權限全零。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.order_status_options', v_priv) THEN
        RAISE EXCEPTION 'order_status_options ACL 異常 — client 角色 % 不應有 %(client 須全鎖);拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 8b. service_role:SELECT/INSERT(表級)必有;UPDATE=column-level(has_table_privilege 對純
  --     column-level grant 回 false → UPDATE 用 has_column_privilege 斷言:5 可改欄必有、
  --     code/created_at 必無=凍結升 DB 強制);表級 UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 必無。
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.order_status_options', v_priv) THEN
      RAISE EXCEPTION 'order_status_options ACL 異常 — service_role 應有 %(admin 讀寫路徑);拒繼續', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('service_role', 'public.order_status_options', v_priv) THEN
      RAISE EXCEPTION 'order_status_options ACL 異常 — service_role 不應有表級 %(UPDATE 只准 column-level、無硬刪);拒繼續', v_priv;
    END IF;
  END LOOP;
  FOREACH v_col IN ARRAY ARRAY['label', 'color', 'text_color', 'sort_order', 'is_active'] LOOP
    IF NOT has_column_privilege('service_role', 'public.order_status_options', v_col, 'UPDATE') THEN
      RAISE EXCEPTION 'order_status_options ACL 異常 — service_role 應可 UPDATE 欄 %(Slice D 設定 UI 路徑);拒繼續', v_col;
    END IF;
  END LOOP;
  FOREACH v_col IN ARRAY ARRAY['code', 'created_at'] LOOP
    IF has_column_privilege('service_role', 'public.order_status_options', v_col, 'UPDATE') THEN
      RAISE EXCEPTION 'order_status_options ACL 異常 — service_role 不得 UPDATE 欄 %(code=soft-ref 穩定識別碼、created_at 不可竄);拒繼續', v_col;
    END IF;
  END LOOP;

  -- 8c. seed 恰 9 筆、全 active。
  SELECT count(*) INTO v_cnt FROM public.order_status_options WHERE is_active;
  IF v_cnt <> 9 THEN
    RAISE EXCEPTION 'order_status_options seed 異常 — 應 9 筆 active、實 % 筆;拒繼續', v_cnt;
  END IF;

  -- 8d. backfill 後 orders 無「雙軸有值但 workflow_status 空」的 paid/unpaid 單
  --     (refunded/partiallyPaid 允許 NULL=未設定)。
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE workflow_status IS NULL AND payment_status IN ('paid', 'unpaid');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'orders backfill 異常 — paid/unpaid 單仍有 % 筆 workflow_status NULL;拒繼續', v_cnt;
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
-- BEGIN;
--   DROP INDEX IF EXISTS public.orders_workflow_status_idx;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_invoice_status_check;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_invoice_amount_nonneg;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_invoice_number_len;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_workflow_status_format;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS invoice_status;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS invoice_amount;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS invoice_number;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS workflow_status;   -- 連帶 backfill 資料消失
--   DROP TABLE IF EXISTS public.order_status_options;                  -- 連帶 seed / grant 消失
-- COMMIT;
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(2026-07-14 已跑 PASS ×2:R1 版一次、Fable 3 must-fix 修正版重跑一次;
--   BEGIN → 套本檔 → 逐條 → ROLLBACK → 零留痕):
-- 1. orders 4 新欄存在且型別/NOT NULL/DEFAULT 正確(workflow_status text NULL /
--    invoice_number text NULL / invoice_amount integer NULL / invoice_status text NOT NULL DEFAULT 'not_issued')。
-- 2. 4 CHECK 生效:workflow_status='BAD CODE!' 擋 / invoice_number='  '(純空白)擋 / invoice_amount=-1 擋 /
--    invoice_status='xxx' 擋(各 check_violation)。
-- 3. order_status_options 存在、7 欄、4 CHECK 生效(壞 code/純空白 label/壞 hex/壞 text_color 各擋)、
--    RLS enabled + 0 policy、seed 9 筆。
-- 4. ACL 終態(§8 DO 已斷言;模擬時獨立再查):anon/authenticated 7 權限全 false;
--    service_role 表級 SELECT/INSERT=true、表級 UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER=false、
--    column UPDATE:label/color/text_color/sort_order/is_active=true、code/created_at=false。
-- 5. backfill:30 筆全有值(24 unpaid_unconfirmed + 6 received_unconfirmed〔paid×notOrdered=
--    收款未訂貨=已收**未**定,§6.1 矩陣〕)、無其他值。
-- 6. create_order 零接觸:函式定義無新欄字面;新單走 DEFAULT(workflow_status NULL / invoice_status
--    'not_issued')。
-- 7. orders 無 trigger(pg_trigger NOT tgisinternal → 既有 0 不變);order_status_options 無 trigger。
-- 8. order_status_options 不在 supabase_realtime publication(pg_publication_tables → 0)。
-- 9. ROLLBACK 後零留痕:新表/新欄/索引/CHECK/COMMENT/grant 全消失。
-- ============================================================
