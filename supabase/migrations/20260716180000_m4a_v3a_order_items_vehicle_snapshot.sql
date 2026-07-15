-- ============================================================
-- M-4a V-3a(資料層):order_items.vehicle_snapshot — 每品項「給哪台車用」下單凍結快照(新欄)
-- ============================================================
-- 真權威:docs/specs/2026-07-15-order-item-vehicle-capture-design.md v0.2 §3/§8 +
--   review-inbox m4a-v3-plan.verdict.md(Fable 關卡1 R1 PASS;裁示 1=拆 V-3a 硬閘/3=CHECK 中間值)。
-- 鐵則 8(schema 改動)+ 鐵則 12(訂單 schema;金流紅線=vehicle 純 metadata、零價格面)。
-- 依賴:20260604120000(order_items 表)、20260611120000 §4(order_items 對 service_role 表級
--   REVOKE 寫權=自動涵蓋本檔新欄)、20260716120000(D-2 三欄;版本鏈 head=20260716150000)。
-- 下一檔 20260716190000(create_order 白名單寫入)讀本欄 → **兩支依序 db push、本檔在前**。
--
-- 🔴 語意(§3):下單時凍結、不隨車庫/字典改動=快照;客人自報車款、非敏感(無經銷價/tier/PII 面);
--   會員 own SELECT 既有涵蓋(order_items 表級 SELECT + RLS own-only)→ 免新 RLS policy/GRANT。
-- 🔴 唯一寫入路徑=create_order RPC 白名單重組(20260716190000;jsonb 逐欄重建、禁 client jsonb 直存);
--   本 CHECK=縱深底線(防**未來新 writer** 繞 RPC 寫壞形狀=D-2「停寫升 DB 強制」同一姿勢),
--   驗 kind enum + object + 逐 kind 必填欄非空(verdict 裁示 3 中間值);year/source 細節=RPC 主閘。
-- 🔴 金流護欄:本 migration 零接觸 quantity / unit_price / line_total / variant_* / product_snapshot /
--   workflow_status(品項凍結快照欄與 D-2 欄一個 byte 不動);vehicle 不進任何取價/對帳路徑。
-- 🔴 Slice C RPC(admin_update_order_workflow)與 D-2 item RPC(admin_update_order_item_workflow)
--   白名單皆未列本欄=依現行「未列鍵送到即 RAISE」語意天然拒寫、零改動(verdict 核驗項)。
--
-- 🔴 無顯式 BEGIN;/COMMIT;(supabase CLI ExecBatch 隱式交易;同 20260714120000 慣例)。
-- **尚未 apply(等 Sean db push;本檔+20260716190000 同批、依序)。**
-- ============================================================

-- ── 1. 新欄(nullable=選填不擋單;無 DEFAULT=既有列與未帶 vehicle 的新列恆 NULL)──
ALTER TABLE public.order_items ADD COLUMN vehicle_snapshot jsonb;

COMMENT ON COLUMN public.order_items.vehicle_snapshot IS
  'M-4a V-3a:此品項「給哪台車用」下單凍結快照(選填;NULL=客人未填)。形狀={kind:''dict'',brand,model,year?,source} 或 {kind:''free'',raw,year?,source}(V-2a CartItemVehicle 判別式、字面凍結)。唯一寫入=create_order RPC 白名單重組(20260716190000);🔴 客人自報、車種鐵律零正規化零猜;純 metadata 絕不驅動金流/取價/對帳(金流真相=payment_status/unit_price 凍結欄);無經銷價/tier 面、會員 own SELECT 可讀自己填的值。';

-- ── 2. 形狀 CHECK(縱深底線;verdict 裁示 3=kind enum+object+逐 kind 必填非空、year/source 留 RPC 主閘)──
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_vehicle_snapshot_shape
  CHECK (
    vehicle_snapshot IS NULL
    OR (
      pg_catalog.jsonb_typeof(vehicle_snapshot) = 'object'
      -- kind 取值包 coalesce:缺 kind 時比較為 NULL、(NULL OR NULL)=NULL 會被 CHECK 放行
      -- (三值邏輯洞、reviewer minor)→ coalesce 成 '' 令兩支恆 false=確定違反
      AND (
        (
          coalesce(vehicle_snapshot->>'kind', '') = 'dict'
          AND coalesce(pg_catalog.btrim(vehicle_snapshot->>'brand'), '') <> ''
          AND coalesce(pg_catalog.btrim(vehicle_snapshot->>'model'), '') <> ''
        )
        OR (
          coalesce(vehicle_snapshot->>'kind', '') = 'free'
          AND coalesce(pg_catalog.btrim(vehicle_snapshot->>'raw'), '') <> ''
        )
      )
    )
  );

-- ── 3. fail-closed 斷言:欄終態 + ACL 維持(擋 db push)──
DO $$
BEGIN
  -- 3a. 欄存在且 nullable(選填語意;NOT NULL 會擋未填單=事故)。
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_items'
       AND column_name = 'vehicle_snapshot' AND data_type = 'jsonb' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'order_items.vehicle_snapshot 欄缺失或非 nullable jsonb;拒繼續';
  END IF;

  -- 3b. 形狀 CHECK 存在。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.order_items'::pg_catalog.regclass
       AND conname = 'order_items_vehicle_snapshot_shape' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'order_items_vehicle_snapshot_shape CHECK 缺失;拒繼續';
  END IF;

  -- 3c. service_role 對 order_items 零寫權維持(表級 REVOKE 涵蓋新欄;防漂移、同 D-2 5c 四動詞)。
  IF has_table_privilege('service_role', 'public.order_items', 'UPDATE')
     OR has_table_privilege('service_role', 'public.order_items', 'INSERT')
     OR has_table_privilege('service_role', 'public.order_items', 'DELETE')
     OR has_table_privilege('service_role', 'public.order_items', 'TRUNCATE') THEN
    RAISE EXCEPTION 'order_items ACL 異常 — service_role 不應有直寫權;拒繼續';
  END IF;

  -- 3d. authenticated / anon 無 UPDATE/TRUNCATE(會員不改快照;同 D-2 5d、防漂移)。
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
--   ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_vehicle_snapshot_shape;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS vehicle_snapshot;  -- 已存快照連帶消失
-- COMMIT;
-- ============================================================
