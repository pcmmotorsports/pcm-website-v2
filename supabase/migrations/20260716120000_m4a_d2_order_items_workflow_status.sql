-- ============================================================
-- M-4a 訂單線 Slice D-2(資料層):order_items per-item 狀態 —
--   +workflow_status(soft-ref order_status_options)+version(樂觀鎖)+updated_at
--   + backfill 繼承所屬訂單 workflow_status + orders.workflow_status 降級為「衍生顯示、停寫」
-- ============================================================
-- 真權威:docs/specs/2026-07-15-m4a-order-list-redesign-slice-d-plan.md §0(Fable 關卡1 審定
--   決策 A→A1:item 層=唯一操作真相;Sean 2026-07-15 深夜拍板 Q-A=A 逐字=「訂單狀態改每商品
--   各自一個;整單狀態=自動彙總顯示(全同→該色、混合→多狀態)、不再手設;orders.workflow_status
--   欄保留停寫不 DROP」)+ docs/handoff/2026-07-16-m4a-day2-kickoff.md 施工順序 1。
-- 鐵則 8(schema 改動)+ 鐵則 12(訂單 schema、金流紅線、經銷價零外洩)。
-- 依賴:20260604120000(order_items 表)、20260611120000 §4(orders/order_items 對 service_role
--   已 REVOKE INSERT/UPDATE/DELETE=**表級 REVOKE 自動涵蓋本檔新欄**;admin 寫入只能走 owner RPC)、
--   20260714120000(order_status_options + orders.workflow_status;live 已 apply、2026-07-16 MCP 實查
--   schema_migrations 最新=20260714130000)。
--
-- 🔴 金流護欄(Slice A/C 同款、硬性):order_items.workflow_status = Sean 的 per-item 操作/顯示軸,
--   **絕不驅動**金流/對帳/退款/庫存/出貨自動化;金流真相軸恆為 orders.payment_status。
--   本 migration **零接觸** quantity / unit_price / line_total / variant_* / product_snapshot
--   (品項凍結快照欄一個 byte 不動;交易模擬斷言 backfill 前後全表快照欄 byte 相等)。
--
-- 🔴 會員可見性(既有事實、同 orders.workflow_status 先例):order_items 對 authenticated 有
--   表級 SELECT(RLS own-only、live 實查 true)→ 新欄會員查自己單品項時可直讀;workflow_status
--   標籤文案已視為可對客(20260714120000 先例)、version/updated_at 無敏感面。
--
-- 🔴 範圍紀律(本 migration 只做這件事):
--   ① order_items 純加 3 欄(workflow_status nullable / version NOT NULL DEFAULT 1 /
--      updated_at NOT NULL DEFAULT now());**絕不加 NOT NULL 無 DEFAULT 欄**。
--   ② backfill:item 繼承所屬訂單 workflow_status(Sean 拍板;live 30 單全有值、40 item 全繼承、
--      5 多商品單同單同值=正確初始態,之後各自分流)。
--   ③ orders.workflow_status 改 COMMENT 標「衍生顯示、D-2 起停寫、欄保留不 DROP」(欄/資料不動)。
--      停寫=**雙層強制**:TS 層(parser 忽略該欄+patch 型別無該欄+adapter 不映射;Codex R1
--      must-fix 1)+ DB 層(20260716130000 §4 收窄 Slice C RPC 白名單、送到=RAISE;Fable 關卡1
--      verdict REQUIRED-2)。
--   ④ 不碰:RPC(item 層 RPC=下一檔 20260716130000)/ RLS policy / GRANT(表級 REVOKE 已涵蓋)/
--      既有欄 / create_order。
--
-- 動手前真 DB 交易模擬:✅ PASS(2026-07-16,project bmpnplmnldofgaohnaok,MCP execute_sql;
--   BEGIN → 快照全表凍結欄 → 套本檔+20260716130000 → 斷言(backfill 40/40 繼承+5 多商品單同值/
--   凍結欄 byte 全等/CHECK 生效/ACL 維持/RPC 全行為)→ ROLLBACK → 零留痕查全 0、order_items 回 9 欄)。
--   **尚未 apply(等 Sean db push;本檔+20260716130000 同批)。**
--
-- 🔴 無顯式 BEGIN;/COMMIT;(同 20260714120000:supabase CLI ExecBatch 隱式交易;顯式 COMMIT
--   撞 history 登記斷線窗)。
-- ============================================================

-- ── 1. order_items 3 新欄 ───────────────────────────────────────────────
ALTER TABLE public.order_items ADD COLUMN workflow_status text;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_workflow_status_format
  CHECK (workflow_status IS NULL OR workflow_status ~ '^[a-z0-9_]{1,64}$');
ALTER TABLE public.order_items ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE public.order_items ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.order_items.workflow_status IS
  'per-item 訂單處理狀態(M-4a D-2;soft-ref order_status_options.code、NULL=未設定)。item 層=唯一操作真相(Sean 2026-07-15 拍板 Q-A=A);整單狀態=顯示端彙總(全同→該值、混合→多狀態)。🔴 純操作/顯示層:絕不驅動金流/對帳/退款/庫存,金流真相=orders.payment_status。會員可讀自己單此欄(表級 SELECT own-only)→ 標籤文案視為可對客(同 orders.workflow_status 先例)。';
COMMENT ON COLUMN public.order_items.version IS
  '樂觀鎖版本(M-4a D-2;admin_update_order_item_workflow 以 WHERE version=$expected 條件更新+SET version+1;衝突回 CONFLICT、UI 409 重載)。';
COMMENT ON COLUMN public.order_items.updated_at IS
  'per-item 狀態最後更新時間(M-4a D-2;owner RPC SET;建表期無此欄、DEFAULT now() 回填=加欄當下)。';

-- ── 2. 索引:workflow_status 篩選(後台列表 per-item 狀態篩選軸)──────────────
CREATE INDEX order_items_workflow_status_idx ON public.order_items (workflow_status);

-- ── 3. backfill:item 繼承所屬訂單 workflow_status ─────────────────────────
-- live 實查(2026-07-16):30 orders 全有 workflow_status、40 items、5 多商品單 → 全繼承同值。
-- 只動 workflow_status 一欄;version/updated_at 走 DEFAULT(backfill 不算一次「操作」、不 bump)。
UPDATE public.order_items oi
   SET workflow_status = o.workflow_status
  FROM public.orders o
 WHERE oi.order_id = o.id
   AND o.workflow_status IS NOT NULL
   AND oi.workflow_status IS NULL;

-- ── 4. orders.workflow_status 降級標記(欄保留、停寫、衍生顯示)────────────────
COMMENT ON COLUMN public.orders.workflow_status IS
  '⚠️ D-2(20260716120000)起**停寫、僅存歷史值**:per-item 真相移至 order_items.workflow_status(Sean 拍板 Q-A=A);整單狀態=顯示端由 items 彙總(全同→該值、混合→多狀態)。停寫=DB 強制:admin_update_order_workflow 已收窄(20260716130000 §4、送 workflow_status key=RAISE)+admin TS 層 parser/型別/adapter 皆無此欄;值可能過時、**顯示與篩選一律走 item 層**。欄保留不 DROP(歷史回溯+回滾保險)。原語意:soft-ref order_status_options.code;🔴 純操作/顯示層、絕不驅動金流,金流真相=payment_status。';

-- ── 5. fail-closed 斷言:欄終態 + backfill 完整 + service_role 零寫權維持 ────────
DO $$
DECLARE
  v_cnt integer;
BEGIN
  -- 5a. backfill 完整:無「所屬訂單有狀態、item 仍 NULL」的漏網列。
  SELECT count(*) INTO v_cnt
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE o.workflow_status IS NOT NULL AND oi.workflow_status IS NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'order_items backfill 異常 — % 筆 item 未繼承所屬訂單狀態;拒繼續', v_cnt;
  END IF;

  -- 5b. version 全 1(backfill 不 bump)、updated_at 全非 NULL。
  SELECT count(*) INTO v_cnt FROM public.order_items WHERE version <> 1 OR updated_at IS NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'order_items 新欄初始態異常 — % 筆 version<>1 或 updated_at NULL;拒繼續', v_cnt;
  END IF;

  -- 5c. service_role 對 order_items 零寫權維持(20260611120000 §4 表級 REVOKE 涵蓋新欄;防漂移;
  --     Fable D-2 diff verdict REQUIRED-2:補 TRUNCATE=false,寫權四動詞全斷)。
  IF has_table_privilege('service_role', 'public.order_items', 'UPDATE')
     OR has_table_privilege('service_role', 'public.order_items', 'INSERT')
     OR has_table_privilege('service_role', 'public.order_items', 'DELETE')
     OR has_table_privilege('service_role', 'public.order_items', 'TRUNCATE') THEN
    RAISE EXCEPTION 'order_items ACL 異常 — service_role 不應有直寫權(安全鑰匙丙 table 層;寫入只走 owner RPC);拒繼續';
  END IF;

  -- 5d. authenticated / anon 無 UPDATE/TRUNCATE(會員不改品項狀態;既有終態、防漂移)。
  IF has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
     OR has_table_privilege('anon', 'public.order_items', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.order_items', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.order_items', 'TRUNCATE') THEN
    RAISE EXCEPTION 'order_items ACL 異常 — client 角色不應有 UPDATE/TRUNCATE;拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
-- BEGIN;
--   DROP INDEX IF EXISTS public.order_items_workflow_status_idx;
--   ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_workflow_status_format;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS version;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS workflow_status;  -- 連帶 backfill 資料消失
--   COMMENT ON COLUMN public.orders.workflow_status IS '(回貼 20260714120000 版 COMMENT)';
-- COMMIT;
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(執行紀錄見 RPC 檔 20260716130000 尾註;兩檔同一模擬 BEGIN→ROLLBACK 串跑):
-- 1. order_items 3 新欄存在且型別/NOT NULL/DEFAULT 正確;CHECK 生效(workflow_status='BAD CODE!' 擋)。
-- 2. backfill:40 item 全繼承所屬訂單值、5 多商品單同單同值、version 全 1。
-- 3. 🔴 品項凍結欄 byte 不變:backfill 前後 quantity/unit_price/line_total/variant_sku/variant_id/
--    product_snapshot 全表快照完全相等。
-- 4. ACL:service_role INSERT/UPDATE/DELETE=false 維持、authenticated/anon UPDATE=false。
-- 5. 索引存在。
-- 6. ROLLBACK 後零留痕:新欄/CHECK/索引消失、order_items 回 9 欄。
-- ============================================================
