# M-1-14 Customer Schema PRD

- **日期:** 2026-05-23
- **作者:** Cowork(M-1-14 plan、A mode commit-ready 草稿)
- **狀態:** ✅ 已拍板(§10 五題 Q1=B / Q2=A / Q3=A / Q4=Y / Q5=A)、Block A(M-1-14a migration + M-1-14b domain/ports)+ M-1-14a-patch 已執行、後續 sub-slice c~h 待跑
- **拍板回顧(2 輪):**
  - 第 1 輪:Q1=A(tier 後台手動)/ Q2=C(一次建全 4 表)/ Q3=A mode + 混合段間推進
  - 第 2 輪(5 題 PRD 內設計題):
    - Q1 = B:wallet_balance + total_deposit 存進 customers 表 + AFTER INSERT trigger 自動同步(非 view 即時算)
    - Q2 = A(預設):auth.users insert trigger 自動建 customers row
    - Q3 = A(預設):#156 application 欄位後 raise、不進 M-1-14 schema
    - **Q4 = Y:Google + LINE 都做(Phase 1 接通);Google 走 Supabase 內建、LINE 自寫 OAuth(Supabase 不內建 LINE)**
    - Q5 = A:AccountPage 拆主檔 + 7 子檔(對齊鐵則 6)
- **依賴:** M-0-04 ports / 既有 Supabase 10 migration / design-reference 637dafc submodule
- **影響範圍:** Supabase(+1 migration、+4 表、+RLS/GRANT/view/trigger)/ packages/{domain,ports,schemas,adapters}(全擴)/ apps/storefront(+3 路由 + 7 tab + MobileTabBar)
- **估時:** 4-6 hr(8 sub-slice、A mode 一夜跑)
- **真權威字面源:** design-reference/components/AccountPages.jsx(805 行)+ WalletTab.jsx(231 行)+ TierComponents.jsx(90 行)+ App.jsx L166-206 + 既有 Supabase migration 10 筆

---

## 0. TL;DR

M-1-14 一次建立 PCM 會員系統地基:Supabase 4 表(customers / addresses / vehicles / wallet_ledger)+ RLS + adapter + zod + register/login + AccountPages 7 tab + MobileTabBar 補搬,落地後 storefront 從「dev cookie 假裝 tier」升級為「真實註冊登入 + RLS 守住經銷 tier」。

不做:Phase 2 9 大藍圖 / Excel 大量匯入 / Admin UI 客製 / TapPay 真實環境 / 經銷申請流程(走 #156 後續 PRD)。社群登入 Google + LINE:Q4=Y 已拍 Phase 1 做(Google 走 Supabase 內建、LINE 自寫 OAuth、實作留 M-1-14f1/f2)。

---

## 1. 任務目標 + 拍板回顧

### 1.1 任務目標(一句話)

把 design-reference `AccountPages.jsx` + `WalletTab.jsx` + `TierComponents.jsx` + `App.jsx` MobileTabBar 字面直接搬進 storefront,並建 Supabase 4 表 + RLS 對應 design 已定義的全部資料結構(會員 + 地址 + 愛車 + 儲值金記錄),tier 由後台手動標記、客人不可自改。

### 1.2 三視角(三條未來會痛的 root cause)

- **擴充性:** 4 表一次到位 + RLS 一次寫對,M-2 / M-3 / M-4a 不需再動 customers schema,只需 ALTER ADD COLUMN 加 #156 application 欄位(走 #156 PRD 階段)+ M-3 加 order_id FK 到 wallet_ledger.related_order_id。
- **可維護性:** 沿用既有 products RLS / view / GRANT pattern,新 4 表 RLS 結構與既有一致;tier 寫入單一路徑(service_role only),audit 容易追。
- **bug 可追蹤性:** wallet_balance / total_deposit 存 customers 表、ledger AFTER INSERT trigger 同步(Q1=B);金額爭議時看 ledger 完整紀錄 + customer_wallet_balance_check view 對帳(比對 customers 欄 vs ledger SUM 抓 drift);customers 表 user_id = auth.users.id 1:1,debug join 路徑單一。

### 1.3 已拍板回顧

| Q | 拍板 | 影響 |
|---|---|---|
| Q1 (D-3) | A:tier 後台手動標記 | domain JSDoc 改寫、auto-upgrade 邏輯零 |
| Q2 (D-2) | C:一次建全 4 表 | schema 一次到位、避免後續來回擴 |
| Q3 (Q-mode) | A mode + 混合段間推進 | Cowork 完整 PRD、Code 跑前 2 段(schema+RLS)連跑、其餘停等 |

---

## 2. 系統設計總覽

### 2.1 架構圖

```
┌─────────────────────────────────────────────────────┐
│  apps/storefront                                    │
│  ├─ (auth)/login/page.tsx       → LoginPage         │
│  ├─ (auth)/register/page.tsx    → RegisterPage      │
│  ├─ account/page.tsx            → AccountPage 7 tab │
│  ├─ components/MobileTabBar.tsx → 5 tab bottom nav  │
│  └─ lib/auth.ts                 → useSession hook   │
└────────────────┬────────────────────────────────────┘
                 │ Supabase Auth SDK(client + server)
                 ↓
┌─────────────────────────────────────────────────────┐
│  packages/use-cases                                 │
│  ├─ register-customer.ts                            │
│  ├─ login-customer.ts                               │
│  ├─ add-address.ts / update-address.ts              │
│  ├─ add-vehicle.ts / update-vehicle.ts              │
│  └─ deposit-wallet.ts(Phase 1 mock、TapPay 留 M-3) │
└────────────────┬────────────────────────────────────┘
                 │ port interfaces
                 ↓
┌─────────────────────────────────────────────────────┐
│  packages/ports                                     │
│  ├─ ICustomerRepository(擴 update 等)              │
│  ├─ IAddressRepository(新)                         │
│  ├─ IVehicleRepository(新)                         │
│  └─ IWalletRepository(新、含 deposit / use / balance)│
└────────────────┬────────────────────────────────────┘
                 │ adapter implementations
                 ↓
┌─────────────────────────────────────────────────────┐
│  packages/adapters/supabase                         │
│  ├─ SupabaseCustomerAdapter                         │
│  ├─ SupabaseAddressAdapter                          │
│  ├─ SupabaseVehicleAdapter                          │
│  └─ SupabaseWalletAdapter                           │
└────────────────┬────────────────────────────────────┘
                 │ supabase-js SDK
                 ↓
┌─────────────────────────────────────────────────────┐
│  Supabase PG                                        │
│  ├─ auth.users(內建、登入認證)                     │
│  ├─ public.customers(business profile + tier)      │
│  ├─ public.customer_addresses                       │
│  ├─ public.customer_vehicles                        │
│  ├─ public.customer_wallet_ledger                   │
│  ├─ public.customer_wallet_balance_check(對帳 view)│
│  └─ RLS 4 表「auth.uid() = user_id」+ tier UPDATE  │
│      column-level GRANT 拒 authenticated            │
└─────────────────────────────────────────────────────┘
```

### 2.2 設計原則(三條鐵則)

1. **客人寫不到 tier、寫不到別人的 row** — RLS `auth.uid() = user_id` + column-level GRANT REVOKE `tier` 從 authenticated。tier 寫入唯一路徑 = service_role。
2. **wallet_balance / total_deposit 存 customers 表、ledger trigger 同步(Q1=B 拍板)** — ledger AFTER INSERT trigger 自動加減 customers 欄、hot path 直讀欄位免 SUM;customer_wallet_balance_check view 留作 admin 對帳工具(比對 customers 欄 vs ledger SUM 抓 trigger drift)。Phase 2 規模上來可加 cron 每日對帳告警(對齊 lessons defer 模式)。
3. **customer_id = auth.users.id(uuid)、1:1 對應** — 子表(addresses / vehicles / wallet_ledger)直接存 customer_user_id,RLS check `auth.uid() = customer_user_id` 無需 JOIN,性能最佳 + 業界推薦。

### 2.3 既有 pattern 沿用清單

| 既有 migration | M-1-14 沿用 |
|---|---|
| `20260507012301_init_products_rls.sql` | RLS 4 policy 結構模板(SELECT / INSERT / UPDATE / DELETE,但 USING 條件不同) |
| `20260510134708_products_public_view.sql` | view `WITH (security_invoker = true)` + GRANT SELECT TO anon/authenticated |
| `20260516072210_products_views_pricing_split.sql` | list vs detail view 拆分 pattern(本 milestone 建 customer_wallet_balance_check 對帳 view、非 balance 來源) |
| `20260519031049_products_base_table_column_grants.sql` | column-level GRANT pattern(tier 欄位 REVOKE 從 authenticated) |
| `packages/adapters/src/supabase/client.ts` | createSupabaseAnonClient / createSupabaseServiceClient 直接重用、不需新建 |
| `packages/adapters/src/supabase/SupabaseProductAdapter.ts` | adapter class 結構模板(constructor DI、PGRST_NOT_FOUND 處理、`findSingle` helper) |

---

## 3. Supabase Schema(完整 SQL)

### 3.1 Migration 檔名 + 結構

**檔名:** `supabase/migrations/20260524000000_init_customers_and_subtables.sql`(time 自動產、字面以 Code 跑時為準、本 PRD 用 placeholder)

**結構:** 單一 migration 含 4 表 + RLS + GRANT + view + trigger,對齊既有 products 多 migration 演化的「初始一檔到位」慣例(`init_brands_categories` / `init_products`)。

### 3.2 customers 表

```sql
-- ============================================================
-- M-1-14 customers 表 + 3 子表 + RLS + GRANT + view + trigger
-- 對齊 design AccountPages.jsx L310-681 + WalletTab.jsx + TierComponents.jsx
-- 對齊 既有 products RLS / view / GRANT pattern
-- ============================================================

-- 三級會員 tier enum
CREATE TYPE member_tier AS ENUM ('general', 'store', 'premiumStore');

-- 1. customers 主表(business profile + tier + wallet 快取欄位)
--    user_id = auth.users.id 1:1 對應、即 customers PK
--    對齊 design AccountPages.jsx L312-414 user 物件:email / name / phone / birthday
--    wallet_balance / total_deposit:Q1=B 拍板存進表 + ledger AFTER INSERT trigger 同步(非 view 即時算)
CREATE TABLE customers (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL DEFAULT '',
  phone           text DEFAULT '',
  birthday        date,
  tier            member_tier NOT NULL DEFAULT 'general',
  wallet_balance  integer NOT NULL DEFAULT 0,    -- Q1=B:trigger 同步、authenticated 不可直寫
  total_deposit   integer NOT NULL DEFAULT 0,    -- Q1=B:累積儲值總額(後台參考門檻、非 auto-upgrade 觸發)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_tier_idx ON customers(tier);
CREATE INDEX customers_email_idx ON customers(email);

COMMENT ON TABLE customers IS
  'M-1-14:會員主表、user_id = auth.users.id 1:1。tier 由後台手動標記(Q1=A、對齊 design TierComponents L27)、客人不可自改(column-level GRANT REVOKE + RLS)。';
COMMENT ON COLUMN customers.tier IS
  'general / store / premiumStore(camelCase、對齊 packages/domain/src/shared/types.ts MemberTier);design snake_case ↔ schema camelCase 走 designTierToSchema mapper。';
```

### 3.3 customer_addresses 表

```sql
-- 2. customer_addresses 表(收件地址 + 發票)
--    對齊 design InlineAddressForm L686-757
--    invoice_type enum 含 personal / company / donate(對齊 L727-737 三 tab)
CREATE TYPE invoice_type AS ENUM ('personal', 'company', 'donate');

CREATE TABLE customer_addresses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id     uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  is_default           boolean NOT NULL DEFAULT false,
  name                 text NOT NULL,            -- 收件人(對齊 design L714 placeholder「王小明」)
  phone                text DEFAULT '',          -- 對齊 design L715 placeholder「0912 345 678」
  line                 text NOT NULL,            -- 地址(對齊 design L716 placeholder「縣市 / 區 / 路 / 號 / 樓」)
  invoice_type         invoice_type NOT NULL DEFAULT 'personal',
  invoice_carrier      text DEFAULT '',          -- 手機載具(personal only、對齊 L740 placeholder「/ABCD123」)
  invoice_title        text NOT NULL DEFAULT '', -- 公司抬頭(company only、對齊 L744;M-1-14a-patch 加 NOT NULL 堵 Codex M1 CHECK NULL 漏洞)
  invoice_tax_id       text NOT NULL DEFAULT '', -- 統編 8 碼(company only、對齊 L745 maxLength=8;M-1-14a-patch 加 NOT NULL)
  invoice_donate_code  text NOT NULL DEFAULT '', -- 愛心碼(donate only、對齊 L749「例:8585(罕病)、925(伊甸)」;M-1-14a-patch 加 NOT NULL)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addresses_invoice_company_has_data CHECK (
    invoice_type != 'company' OR (invoice_title != '' AND invoice_tax_id != '')
  ),
  CONSTRAINT addresses_invoice_donate_has_code CHECK (
    invoice_type != 'donate' OR invoice_donate_code != ''
  )
);

CREATE INDEX customer_addresses_customer_idx ON customer_addresses(customer_user_id);
-- 同 customer 內 is_default = true 唯一(對齊 design saveAddress L352-358 邏輯)
CREATE UNIQUE INDEX customer_addresses_one_default_per_customer
  ON customer_addresses(customer_user_id) WHERE is_default = true;

COMMENT ON TABLE customer_addresses IS
  'M-1-14:收件地址 + 發票合一(對齊 design AccountPage InlineAddressForm L686-757)。每 customer 至多一筆 is_default。';
```

### 3.4 customer_vehicles 表

```sql
-- 3. customer_vehicles 表(我的愛車)
--    對齊 design InlineVehicleForm L760-798
CREATE TABLE customer_vehicles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  is_primary        boolean NOT NULL DEFAULT false,
  name              text NOT NULL,            -- 車型(對齊 design L783 placeholder「YAMAHA YZF-R6」)
  year              text DEFAULT '',          -- 年份(對齊 L784 placeholder「2022」、text 不用 int 因 design 是 text input)
  engine            text DEFAULT '',          -- 引擎號(對齊 L785 placeholder「RJ27-xxxxx」)
  km                text DEFAULT '',          -- 里程(對齊 L786 placeholder「12,340 km」、text 因含千分位 + 單位)
  mods              text DEFAULT '',          -- 已改裝(對齊 L787 placeholder「7 件」、text 簡述)
  service           date,                     -- 最近保養(對齊 L788 type="date")
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_vehicles_customer_idx ON customer_vehicles(customer_user_id);
-- 同 customer 內 is_primary = true 唯一(對齊 design saveVehicle L387-396 邏輯)
CREATE UNIQUE INDEX customer_vehicles_one_primary_per_customer
  ON customer_vehicles(customer_user_id) WHERE is_primary = true;

COMMENT ON TABLE customer_vehicles IS
  'M-1-14:會員愛車(對齊 design AccountPage InlineVehicleForm L760-798)。每 customer 至多一輛 is_primary。Phase 2 升級為獨立 Vehicle entity 接 vehicle service ecosystem(對齊 docs/features/vehicle-service-ecosystem.md)。';
```

### 3.5 customer_wallet_ledger 表 + balance view

```sql
-- 4. customer_wallet_ledger 表(儲值金交易紀錄)
--    對齊 design WalletTab.jsx L7-22 + L122-141
--    entry_type enum:deposit(儲值)/ use(消費折抵)/ refund(退款返還、Phase 2 預留)
CREATE TYPE wallet_entry_type AS ENUM ('deposit', 'use', 'refund');

CREATE TABLE customer_wallet_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  entry_date        date NOT NULL DEFAULT current_date,  -- design L101 wal-tx-date 顯示這個(純日期、非 timestamp)
  entry_type        wallet_entry_type NOT NULL,
  amount            integer NOT NULL,           -- signed:deposit +、use -、refund +(對齊 design L130 amount field)
  note              text NOT NULL DEFAULT '',  -- 顯示文案(對齊 design L132「儲值 NT$ 30,000」/ L17「訂單 PCM-2026-0421 折抵」)
  related_order_id  uuid,                       -- M-3 訂單 FK(Phase 1 留 null、Phase 1 mock 儲值不關聯訂單)
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_amount_sign CHECK (
    (entry_type = 'deposit' AND amount > 0) OR
    (entry_type = 'use'     AND amount < 0) OR
    (entry_type = 'refund'  AND amount > 0)
  )
);

CREATE INDEX customer_wallet_ledger_customer_idx ON customer_wallet_ledger(customer_user_id);
CREATE INDEX customer_wallet_ledger_date_idx ON customer_wallet_ledger(entry_date DESC);

-- M-1-14a-patch C2:COMMENT 對齊 Q1=B(原字面「balance = SUM via view、不存欄位」與 Q1=B 拍板矛盾、校正)
COMMENT ON TABLE customer_wallet_ledger IS
  'M-1-14 Q1=B 拍板:wallet_balance / total_deposit 存 customers 表欄位、ledger AFTER INSERT trigger 自動同步(非 view 即時算)。customer_wallet_balance_check view 留作 admin 對帳工具、非 storefront hot path。amount signed integer / deposit + / use - / refund +、CHECK constraint 守門。Phase 1 deposit 為 mock(TapPay 整合留 M-3);use 由 M-3 結帳折抵時寫入。';

-- 5. customer_wallet_balance_check view(對帳工具、debug only、非 hot path)
--    Q1=B 拍板用 customers.wallet_balance + total_deposit 欄位 + trigger 同步,
--    此 view 保留作為「對帳工具」:admin 端可比對 customers vs ledger SUM 是否一致,
--    若 drift 即可早期發現。Phase 1 不接 storefront、不放 storefront RLS 路徑。
CREATE VIEW customer_wallet_balance_check
  WITH (security_invoker = true) AS
SELECT
  customer_user_id,
  COALESCE(SUM(amount), 0)::integer                                       AS computed_balance,
  COALESCE(SUM(amount) FILTER (WHERE entry_type = 'deposit'), 0)::integer AS computed_total_deposit,
  MAX(created_at)                                                          AS last_entry_at
FROM customer_wallet_ledger
GROUP BY customer_user_id;

COMMENT ON VIEW customer_wallet_balance_check IS
  'M-1-14 Q1=B 拍板:對帳工具、計算 ledger SUM 供 admin 端 cross-check customers.wallet_balance / total_deposit 是否一致(trigger drift 防線)。Phase 1 不放 storefront hot path;Phase 2 規模上來可加 cron 每日對帳告警。';
```

### 3.6 RLS Policies

```sql
-- ============================================================
-- RLS:4 表全 ENABLE、客人只能讀寫自己 row、tier 寫入走 service_role only
-- 對齊既有 products RLS 4 policy 結構(init_products_rls.sql)
-- ============================================================

-- ------------ customers ------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select_own ON customers
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY customers_update_own ON customers
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY customers_insert_service_role ON customers
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY customers_delete_service_role ON customers
  FOR DELETE TO service_role
  USING (true);

-- ------------ customer_addresses ------------
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY addresses_select_own ON customer_addresses
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);

CREATE POLICY addresses_insert_own ON customer_addresses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_user_id);

CREATE POLICY addresses_update_own ON customer_addresses
  FOR UPDATE TO authenticated
  USING (auth.uid() = customer_user_id)
  WITH CHECK (auth.uid() = customer_user_id);

CREATE POLICY addresses_delete_own ON customer_addresses
  FOR DELETE TO authenticated
  USING (auth.uid() = customer_user_id);

-- ------------ customer_vehicles ------------
ALTER TABLE customer_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY vehicles_select_own ON customer_vehicles
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);

CREATE POLICY vehicles_insert_own ON customer_vehicles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_user_id);

CREATE POLICY vehicles_update_own ON customer_vehicles
  FOR UPDATE TO authenticated
  USING (auth.uid() = customer_user_id)
  WITH CHECK (auth.uid() = customer_user_id);

CREATE POLICY vehicles_delete_own ON customer_vehicles
  FOR DELETE TO authenticated
  USING (auth.uid() = customer_user_id);

-- ------------ customer_wallet_ledger ------------
-- 客人只能 SELECT 自己紀錄(對齊 design WalletTab 顯示自己交易);
-- INSERT 走 service_role(deposit by mock / M-3 結帳折抵都是 server-side 動作);
-- UPDATE / DELETE 一律禁(ledger immutable、金額爭議要可審計、對齊 backlog #156 audit 精神)
CREATE POLICY wallet_select_own ON customer_wallet_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);

CREATE POLICY wallet_insert_service_role ON customer_wallet_ledger
  FOR INSERT TO service_role
  WITH CHECK (true);

-- 無 UPDATE / DELETE policy = 全拒(RLS default)、ledger immutable
```

### 3.7 Column-level GRANT(tier 鎖定 + 公開 view)

```sql
-- ============================================================
-- Column-level GRANT(對齊 既有 products_base_table_column_grants 慣例)
-- 重點:authenticated 不可寫 tier(否則繞過 admin 升等)
-- ============================================================

-- customers 表 column-level GRANT
--   authenticated 可 SELECT 自己 row 所有欄位(view 不拆、tier / wallet_balance / total_deposit 給看是合理 — 客人本就知道自己等級 + 餘額)
--   authenticated 只能 UPDATE name / phone / birthday(對齊 design profile tab L666-669)
--   tier / email / user_id / wallet_balance / total_deposit / created_at / updated_at 不開 UPDATE 給 authenticated
--   wallet_balance / total_deposit 由 trigger 寫(以表 owner 權限執行、Q1=B);客人嘗試 UPDATE 會被欄位 GRANT 拒
REVOKE ALL PRIVILEGES ON TABLE customers FROM anon, authenticated;
GRANT SELECT ON TABLE customers TO authenticated;
GRANT UPDATE (name, phone, birthday, updated_at) ON TABLE customers TO authenticated;
-- service_role 已預設全開(Supabase 預設、不需顯式 GRANT)

-- customer_addresses 表(authenticated 全欄位可改、是自己的地址)
REVOKE ALL PRIVILEGES ON TABLE customer_addresses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customer_addresses TO authenticated;

-- customer_vehicles 表(authenticated 全欄位可改、是自己的車)
REVOKE ALL PRIVILEGES ON TABLE customer_vehicles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customer_vehicles TO authenticated;

-- customer_wallet_ledger 表(authenticated SELECT only;INSERT 走 service_role)
REVOKE ALL PRIVILEGES ON TABLE customer_wallet_ledger FROM anon, authenticated;
GRANT SELECT ON TABLE customer_wallet_ledger TO authenticated;

-- customer_wallet_balance_check view(admin 對帳工具、不開 anon / authenticated;Phase 1 只 service_role 看)
-- GRANT SELECT ON customer_wallet_balance_check TO authenticated;  -- 不開、Phase 1 admin 端走 service_role 直查
```

### 3.8 Trigger(updated_at 自動更新 + register 時自動建 customers row)

```sql
-- ============================================================
-- Trigger:updated_at 自動更新 + auth.users insert 時自動建 customers row
-- ============================================================

-- updated_at 自動更新 trigger(3 表共用 function、wallet_ledger 不需因 immutable)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER customer_addresses_set_updated_at
  BEFORE UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER customer_vehicles_set_updated_at
  BEFORE UPDATE ON customer_vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 自動建 customers row trigger
--   auth.users 新增時自動建 public.customers row、預設 tier='general'
--   對齊 design RegisterPage L263 「localStorage[pcm-user] = { email, name, phone, loggedIn: true }」mock 行為
--   採 trigger 而非 use-case 內顯式 insert 的原因:見 §10 設計拍板題 Q2
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.customers (user_id, email, name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMENT ON FUNCTION public.handle_new_auth_user IS
  'M-1-14:auth.users 新增時自動建 public.customers row(對齊 Supabase 官方 social-login pattern)。name / phone 從 raw_user_meta_data 取(register 時由 storefront 傳 options.data)。SECURITY DEFINER 必要(trigger 需以 owner 權限寫 public.customers)。Google / LINE OAuth 註冊也走此 trigger:Google 走 Supabase 內建 signInWithOAuth、LINE 走自寫 OAuth + Supabase Admin API createUser(都會觸發 auth.users insert)。';

-- ledger AFTER INSERT trigger 同步 customers wallet_balance + total_deposit(Q1=B 拍板)
CREATE OR REPLACE FUNCTION public.sync_wallet_balance_on_ledger_insert()
RETURNS trigger AS $$
BEGIN
  UPDATE public.customers
  SET
    wallet_balance = wallet_balance + NEW.amount,
    total_deposit  = total_deposit + (CASE WHEN NEW.entry_type = 'deposit' THEN NEW.amount ELSE 0 END),
    updated_at     = now()
  WHERE user_id = NEW.customer_user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_wallet_ledger_inserted
  AFTER INSERT ON customer_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_balance_on_ledger_insert();

COMMENT ON FUNCTION public.sync_wallet_balance_on_ledger_insert IS
  'M-1-14 Q1=B:ledger AFTER INSERT 同步 customers.wallet_balance(amount 為 signed integer、deposit + / use - / refund +、自動加減)+ total_deposit(只累 deposit)。SECURITY DEFINER 必要(trigger 需繞 customers 表的 authenticated UPDATE GRANT 限制、以 owner 權限寫 wallet_balance / total_deposit 欄)。對帳工具見 customer_wallet_balance_check view。';
```

---

## 4. packages/domain identity(擴 Customer + 子 entity)

### 4.1 擴 Customer 型別

```ts
// packages/domain/src/identity/types.ts(改寫)
import type { MemberTier } from '../shared/types';

export type CustomerId = string;  // = auth.users.id uuid

export type Customer = {
  id: CustomerId;
  email: string;
  name: string;
  phone: string;
  birthday: string | null;  // ISO date 'YYYY-MM-DD' or null
  tier: MemberTier;
  walletBalance: number;    // Q1=B:DB trigger 同步、authenticated 不可直寫
  totalDeposit: number;     // Q1=B:累積儲值(後台參考門檻)
  createdAt: string;        // ISO datetime
  updatedAt: string;
};

// 子 entity(addresses / vehicles / wallet 各自 type 檔)
```

### 4.2 新 entity 檔

```ts
// packages/domain/src/identity/address.ts(新)
export type AddressId = string;
export type InvoiceType = 'personal' | 'company' | 'donate';

export type CustomerAddress = {
  id: AddressId;
  customerUserId: CustomerId;
  isDefault: boolean;
  name: string;
  phone: string;
  line: string;
  invoice: {
    type: InvoiceType;
    carrier: string;       // personal only
    title: string;         // company only
    taxId: string;         // company only
    donateCode: string;    // donate only
  };
  createdAt: string;
  updatedAt: string;
};
```

```ts
// packages/domain/src/identity/vehicle.ts(新)
export type VehicleId = string;

export type CustomerVehicle = {
  id: VehicleId;
  customerUserId: CustomerId;
  isPrimary: boolean;
  name: string;     // 車型
  year: string;
  engine: string;
  km: string;
  mods: string;
  service: string | null;  // ISO date or null
  createdAt: string;
  updatedAt: string;
};
```

```ts
// packages/domain/src/identity/wallet.ts(新)
export type WalletEntryId = string;
export type WalletEntryType = 'deposit' | 'use' | 'refund';

export type WalletLedgerEntry = {
  id: WalletEntryId;
  customerUserId: CustomerId;
  entryDate: string;           // ISO date
  entryType: WalletEntryType;
  amount: number;              // signed integer
  note: string;
  relatedOrderId: string | null;
  createdAt: string;
};

export type WalletBalance = {
  customerUserId: CustomerId;
  balance: number;
  totalDeposit: number;
  lastEntryAt: string | null;
};
```

---

## 5. packages/ports(擴 ICustomerRepository + 新 3 子 port)

```ts
// packages/ports/src/ICustomerRepository.ts(改寫)
import type { Customer, CustomerId, MemberTier } from '@pcm/domain';

export interface ICustomerRepository {
  findById(id: CustomerId): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  update(id: CustomerId, patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday'>>): Promise<Customer>;
  // tier 寫入走 service_role-only、不在 ICustomerRepository 暴露(走 IAdminCustomerRepository M-4a)
  // register / login 走 Supabase Auth SDK、不經 ICustomerRepository(對齊 §10 Q2 拍板)
}

// 新 3 子 port
// packages/ports/src/IAddressRepository.ts
import type { CustomerAddress, AddressId, CustomerId } from '@pcm/domain';
export interface IAddressRepository {
  listByCustomer(customerId: CustomerId): Promise<CustomerAddress[]>;
  create(addr: Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomerAddress>;
  update(id: AddressId, patch: Partial<CustomerAddress>): Promise<CustomerAddress>;
  delete(id: AddressId): Promise<void>;
}

// packages/ports/src/IVehicleRepository.ts(類似結構)
// packages/ports/src/IWalletRepository.ts(類似結構 + balance / addEntry method)
```

---

## 6. packages/schemas(zod schema)

```ts
// packages/schemas/src/index.ts(填空殼)
import { z } from 'zod';

// === Auth forms ===
export const LoginInput = z.object({
  email: z.string().email('Email 格式不正確'),
  password: z.string().min(8, '密碼至少 8 碼'),
  remember: z.boolean().default(true),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RegisterInput = z.object({
  name: z.string().min(1, '請填寫姓名'),
  email: z.string().email('Email 格式不正確'),
  password: z.string().min(8, '密碼至少 8 碼'),
  phone: z.string().regex(/^[\d\s-]{8,}$/, '手機格式不正確'),
  agree: z.literal(true, { errorMap: () => ({ message: '請同意服務條款' }) }),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

// === Address form(對齊 design InlineAddressForm) ===
export const AddressInput = z.object({
  isDefault: z.boolean().default(false),
  name: z.string().min(1, '請填寫收件人'),
  phone: z.string().default(''),
  line: z.string().min(1, '請填寫地址'),
  invoice: z.object({
    type: z.enum(['personal', 'company', 'donate']),
    carrier: z.string().default(''),
    title: z.string().default(''),
    taxId: z.string().default(''),
    donateCode: z.string().default(''),
  }),
}).superRefine((data, ctx) => {
  if (data.invoice.type === 'company') {
    if (!data.invoice.title) ctx.addIssue({ code: 'custom', path: ['invoice.title'], message: '請填寫公司抬頭' });
    if (!data.invoice.taxId.match(/^\d{8}$/)) ctx.addIssue({ code: 'custom', path: ['invoice.taxId'], message: '統編需 8 碼數字' });
  }
  if (data.invoice.type === 'donate' && !data.invoice.donateCode) {
    ctx.addIssue({ code: 'custom', path: ['invoice.donateCode'], message: '請填愛心碼' });
  }
});
export type AddressInput = z.infer<typeof AddressInput>;

// === Vehicle form ===
export const VehicleInput = z.object({
  isPrimary: z.boolean().default(false),
  name: z.string().min(1, '請填寫車型'),
  year: z.string().default(''),
  engine: z.string().default(''),
  km: z.string().default(''),
  mods: z.string().default(''),
  service: z.string().default(''),  // ISO date or ''
});
export type VehicleInput = z.infer<typeof VehicleInput>;

// === Profile form ===
export const ProfileInput = z.object({
  name: z.string().min(1),
  phone: z.string().default(''),
  birthday: z.string().default(''),  // ISO date or ''
});
export type ProfileInput = z.infer<typeof ProfileInput>;

// === Wallet deposit ===
export const DepositInput = z.object({
  amount: z.number().int().min(100, '最少 NT$ 100').max(1_000_000, '單次上限 NT$ 1,000,000'),
  paymentMethod: z.enum(['tappay', 'atm']),
});
export type DepositInput = z.infer<typeof DepositInput>;
```

---

## 7. packages/adapters(4 個 Supabase adapter、字面骨架)

```ts
// packages/adapters/src/supabase/SupabaseCustomerAdapter.ts(新)
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICustomerRepository } from '@pcm/ports';
import type { Customer, CustomerId } from '@pcm/domain';

const PGRST_NOT_FOUND = 'PGRST116';
const CUSTOMER_SELECT = 'user_id, email, name, phone, birthday, tier, wallet_balance, total_deposit, created_at, updated_at';

export class SupabaseCustomerAdapter implements ICustomerRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(id: CustomerId): Promise<Customer | null> {
    const { data, error } = await this.supabase
      .from('customers')
      .select(CUSTOMER_SELECT)
      .eq('user_id', id)
      .single();
    if (error) {
      if (error.code === PGRST_NOT_FOUND) return null;
      throw error;
    }
    return mapSupabaseCustomerToDomain(data);
  }

  async findByEmail(email: string): Promise<Customer | null> { /* 對齊上 */ }

  async update(id: CustomerId, patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday'>>): Promise<Customer> {
    const { data, error } = await this.supabase
      .from('customers')
      .update(patch)
      .eq('user_id', id)
      .select(CUSTOMER_SELECT)
      .single();
    if (error) throw error;
    return mapSupabaseCustomerToDomain(data);
  }
}

// mapper / SupabaseAddressAdapter / SupabaseVehicleAdapter / SupabaseWalletAdapter
// 結構類似、本 PRD 字面骨架、Code 實作時對齊 SupabaseProductAdapter pattern 補完整
```

---

## 8. apps/storefront use-cases + 元件 + 路由

### 8.1 use-cases(packages/use-cases/src/)

| use-case | 用途 | Phase 1 |
|---|---|---|
| `register-customer.ts` | 接 Supabase Auth signUp、name/phone 透過 options.data 傳 | M-1-14 |
| `login-customer.ts` | 接 Supabase Auth signInWithPassword | M-1-14 |
| `logout-customer.ts` | 接 Supabase Auth signOut | M-1-14 |
| `update-profile.ts` | update customers name/phone/birthday | M-1-14 |
| `add-address.ts` / `update-address.ts` / `delete-address.ts` | CRUD addresses | M-1-14 |
| `add-vehicle.ts` / `update-vehicle.ts` / `delete-vehicle.ts` | CRUD vehicles | M-1-14 |
| `deposit-wallet.ts` | Phase 1 mock(直接寫 ledger 一筆 deposit、不真 TapPay)| M-1-14 |

### 8.2 storefront 路由

| 路由 | 元件 | 對應 design 來源 |
|---|---|---|
| `/login` | `LoginPage`(含 Google + LINE 一鍵登入 button) | AccountPages.jsx L181-253 |
| `/register` | `RegisterPage`(含 Google + LINE 一鍵登入 button) | AccountPages.jsx L256-308 |
| `/account` | `AccountPage`(7 tab、單檔內 state 切換 tab) | AccountPages.jsx L310-681 |
| `/cart` | `CartPage`(留 M-3) | AccountPages.jsx L11-178(本 milestone **不搬**、留 M-3) |
| `/auth/callback` | Google OAuth callback handler(Supabase 內建走此路徑) | Supabase 內建 signInWithOAuth pattern |
| `/api/auth/line/start` | LINE OAuth start route(產生 LINE OAuth URL + state + redirect) | Q4=Y 自寫(LINE 不在 Supabase 內建) |
| `/api/auth/line/callback` | LINE OAuth callback route(收 code、換 token、拿 profile、用 Supabase Admin API createUser/signInUser、發 session) | Q4=Y 自寫 |

### 8.3 storefront 元件

| 元件 | 對應 design | 範圍 |
|---|---|---|
| `LoginPage.tsx` + `auth.css` | AccountPages.jsx LoginPage + account.css auth-* | M-1-14 |
| `RegisterPage.tsx`(共用 auth.css) | AccountPages.jsx RegisterPage | M-1-14 |
| `AccountPage.tsx` + `account.css` + 7 tab 子元件 | AccountPages.jsx L310-681 + account.css | M-1-14 |
| `InlineAddressForm.tsx` + `InlineVehicleForm.tsx` | AccountPages.jsx L686-798 | M-1-14 |
| `WalletTab.tsx` + `wallet.css` | WalletTab.jsx + wallet.css | M-1-14 |
| `TierBadge.tsx` + `TierUpgradePath.tsx` + `tier.css` | TierComponents.jsx + tier.css | M-1-14 |
| `MobileTabBar.tsx` + `mobile-tabbar.css`(從 tweaks.css L375-426 抽) | App.jsx L166-206 + tweaks.css | M-1-14(#158) |

### 8.4 lib/auth.ts(client + server 雙模)

```ts
// apps/storefront/src/lib/auth.ts(新)
import { createSupabaseAnonClient } from '@pcm/adapters';

export async function getCurrentSession() {
  const supabase = createSupabaseAnonClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentCustomer() {
  // server-side、走 customers 表 + auth.users join、對齊三級會員價格驗證鐵則
}

// Google 一鍵登入(Supabase 內建)
export async function signInWithGoogle() {
  const supabase = createSupabaseAnonClient();
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
}

// LINE 一鍵登入(導向自寫 API route、Supabase 不內建 LINE)
export function signInWithLine() {
  window.location.href = '/api/auth/line/start';
}
```

### 8.5 LINE OAuth 自寫流程(Q4=Y 拍板)

**前提:** Sean 在 LINE Developers 註冊 LINE Login channel(見 §13 dashboard checklist),拿 channel_id / channel_secret,設定到 v2 repo `.env.local`。

**流程:**
```
storefront /login 點「使用 LINE 登入」
    ↓ window.location.href = '/api/auth/line/start'
GET /api/auth/line/start
    ↓ 產生 state(防 CSRF)+ 組 LINE OAuth URL + redirect 到 LINE
LINE 用戶同意授權
    ↓ LINE redirect 回 /api/auth/line/callback?code=XXX&state=YYY
GET /api/auth/line/callback
    ↓ 1. 驗 state
    ↓ 2. POST LINE token endpoint 換 access_token + id_token(OIDC)
    ↓ 3. POST LINE verify endpoint 驗 id_token(簽名/aud/exp/nonce)拿 sub(=line userId)/ name / email?
         (M-1-14e-f2 校正:LINE v2/profile endpoint 不含 email;email 必經 id_token、且僅當 email scope 已核准 → 改採 id_token verify)
    ↓ 4. 用 Supabase Admin API(service_role)以 line_user_id(sub)為唯一身分鍵:
         - 合成 email = line_{sub}@line.pcmmotorsports.local(命名空間隔離、不 by-email 併帳;LINE 無 email_verified)
         - createUser({ email: 合成, email_confirm: true, app_metadata: { pcm_provider:'line', pcm_line_user_id: sub }, user_metadata: { name, line_email } })
                → handle_new_auth_user trigger 自動建 customers row(phone='' DEFAULT、取 user_metadata.name)
         - 身分鍵存 **app_metadata(service_role-only、公開 signUp 無法偽造)**、非 user_metadata(codex 關卡2 must-fix:user_metadata 可被 anon signUp options.data 偽造)
         - 撞 already-registered → 驗既有 user.app_metadata.pcm_provider==='line' 且 pcm_line_user_id===sub 才視為回頭用戶、否則拒(防冒登入、偽造者/孤兒無 app_metadata 必拒)
    ↓ 5. generateLink({ type:'magiclink', email: 合成 }) → hashed_token;anon cookie client verifyOtp({ token_hash, type:'email' }) 發 session
    ↓ 6. redirect 到 /account
```

**Env vars 新增(`.env.local` Sean 端設定、Code 不可動 .env*):**

```
LINE_CHANNEL_ID=...           # 從 LINE Developers Console 抓
LINE_CHANNEL_SECRET=...       # 從 LINE Developers Console 抓
LINE_REDIRECT_URI=https://[your-domain]/api/auth/line/callback
```

**重點:** Code 跑 LINE OAuth sub-slice 前必確認 env 已設,否則 LINE 路徑會 throw env 未設 error。env 設定走 Sean 端 dashboard,見 §13。

---

## 9. 設計拍板題(§10 Sean 必拍 5 題)

(見下 §10)

---

## 10. 設計拍板題

**5 題必拍、Sean 一次拍完 Cowork 整合進 PRD 最終版、Code 一夜跑。**

### Q1 — `wallet_balance` / `total_deposit` 怎麼存?

**✅ Sean 拍 B(2026-05-23)**:存進 customers 表 + ledger AFTER INSERT trigger 同步。

| 選項 | 描述 |
|---|---|
| A. View 即時 SUM | 不存欄位、view SUM(amount) 算 |
| **✅ B. customers 表加 wallet_balance + total_deposit + trigger 同步** | ledger 寫入 trigger UPDATE customers,hot path 快、view 留作對帳工具 |
| C. materialized view + 定期 refresh | 過度設計 |

落地:§3.2 加兩欄、§3.5 view rename `customer_wallet_balance_check`(admin 對帳工具、不開 storefront)、§3.6 GRANT REVOKE 兩欄不開 authenticated UPDATE、§3.8 加 `sync_wallet_balance_on_ledger_insert` AFTER INSERT trigger(SECURITY DEFINER)。drift 防線:Phase 2 可加 cron 比對 customers vs view、目前 Phase 1 不需。

### Q2 — register 時誰建 customers row?

| 選項 | 描述 | 三視角 |
|---|---|---|
| **A. auth trigger 自動建(推薦)** | `on_auth_user_created` trigger、SECURITY DEFINER、對齊 Supabase 官方 social-login pattern | 擴充性:之後加 Google/LINE 登入自動建 customers,不需各管道分別寫;可維護性:邏輯集中 DB trigger;bug 可追蹤性:DB log 追 |
| B. register use-case 顯式 insert | application 層 signUp 後手動 insert customers | 擴充性:多管道時需各別寫 insert;可維護性:邏輯散在 app;bug 可追蹤性:app log 追、但若 insert 失敗 auth user 已建 inconsistent |
| C. 兩者並存(trigger 保底 + use-case 顯式) | 重複寫、用 ON CONFLICT 處理 | 多餘、不建議 |

**Cowork 預設用 A**(PRD §3.8 已採),Sean 不反對即沿用。

### Q3 — #156 application 欄位(application_status / requested_tier 等)現在建 vs 後 raise?

| 選項 | 描述 | 三視角 |
|---|---|---|
| **A. 後 raise(推薦)** | M-1-14 customers 表只建 §3.2 字面、application 欄位走 #156 PRD 階段 ALTER ADD COLUMN | 擴充性:#156 PRD 階段一次評估完整申請流程設計;可維護性:M-1-14 範圍乾淨、不混進未完整評估的欄位;bug 可追蹤性:#156 是獨立 milestone、scope 不混 |
| B. 現在建(M-1-14 一次到位) | customers 加 application_status / requested_tier / applied_at / reviewed_at / reviewed_by | 擴充性:之後 #156 PRD 不動 schema;可維護性:欄位未完整設計就建 schema、可能後改;bug 可追蹤性:M-1-14 commit 訊息含 #156 範圍 audit 混 |

**Cowork 預設用 A**(對齊 Q2=C「一次建全」拍板字面為「profile + addresses + vehicles + wallet」、未明指 application 欄位、且 #156 PRD 還沒寫不適合預建)。

### Q4 — Social Login(Google / LINE)Phase 1 做不做?

**✅ Sean 拍 Y(2026-05-23 2 輪重拍)**:Google + LINE 都做 Phase 1。

技術背景(Cowork raise):Supabase Auth **內建 18 個 OAuth provider 沒有 LINE**(有 Google / Apple / Facebook / Kakao 等)。原 Cowork 推 B(LINE 留 Phase 2),Sean 重拍 Y 接受「LINE 自寫 OAuth flow」+1-2 hr 實作成本。

落地:
- **Google:** Supabase 內建、Code 寫 1 行 `signInWithOAuth({ provider: 'google' })`(見 §8.4 `signInWithGoogle`)。Sean 端在 Google Cloud Console 註冊 OAuth client + Supabase Dashboard 啟用。
- **LINE:** 自寫 API routes `/api/auth/line/start` + `/api/auth/line/callback`(見 §8.5 流程)。Sean 端在 LINE Developers 註冊 LINE Login channel + 設 callback URL + 拿 channel_id / channel_secret 進 `.env.local`。
- env vars 新增:`LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` / `LINE_REDIRECT_URI`。
- 走 trigger:不論 Google 還是 LINE 註冊都會觸發 `auth.users` insert → `handle_new_auth_user` trigger 自動建 `customers` row。

### Q5 — AccountPage 7 tab 怎麼拆檔結構?(對齊鐵則 6:單檔 ≤ 400 行)

design AccountPages.jsx 805 行裡 AccountPage 本身 372 行 + 7 tab 內容。直接搬會超 400 行警戒。

| 選項 | 描述 | 三視角 |
|---|---|---|
| **A. AccountPage.tsx 主檔 + 7 個 tab 子元件檔(推薦)** | `AccountPage.tsx`(~150 行 layout + tab nav)+ `_components/{Overview,Orders,Wallet,Favorites,Vehicles,Address,Profile}Tab.tsx` 7 檔 | 擴充性:tab 新增 / 改一 tab 不動主檔;可維護性:每檔 < 400 行對齊鐵則 6;bug 可追蹤性:tab 出錯定位單檔 |
| B. 直接搬單檔(800 行、違鐵則 6) | 1:1 對應 design,維持單檔 | 擴充性:tab 改動需動巨檔;可維護性:違鐵則 6;bug 可追蹤性:單檔 grep 容易、但 debug 上下文混 |
| C. 7 個 tab 各自路由(`/account/orders` `/account/wallet` ...) | URL 顯式狀態 + 各 tab 獨立 page | 擴充性:深連結友善;可維護性:URL 多、Header 對應 tab 高亮邏輯複雜;bug 可追蹤性:每 tab 獨立 page 出錯範圍小 |

**Cowork 推 A**(對齊鐵則 6 + 既有 storefront ProductPage 拆 sub-component pattern;C 雖然更現代但本 milestone 不擴張,M-2 / M-3 補真資料時若需再升級到 C 是後續 enhancement)。

---

## 11. Sub-slice 拆分執行包(Q3 混合段間推進)

**9 個 sub-slice、估時 5-8 hr、Q3 混合式推進:前 2 段連跑(schema 不可逆),後 7 段每段跑完停等 Sean。**

| # | Sub-slice | 估時 | 連跑/停等 | 內容 |
|---|---|---|---|---|
| 1 | M-1-14a Supabase migration(4 表 + RLS + GRANT + view + 4 trigger) | 45-60 min | **連跑** | 一筆 migration 含 §3.2-3.8 全部(含 Q1=B wallet_balance 同步 trigger) |
| 2 | M-1-14b domain identity 擴 + ports 新 3 子 | 30-45 min | **連跑**(跟 #1 同收尾 review) | §4 + §5 完整字面 |
| 3 | M-1-14c packages/schemas zod 填空 | 30 min | 停等 | §6 完整 zod |
| 4 | M-1-14d SupabaseCustomerAdapter + 3 子 adapter + mappers | 45-60 min | 停等 | §7 完整 |
| 5 | M-1-14e use-cases(register / login / logout / update-profile / address CRUD / vehicle CRUD / deposit-wallet) | 45-60 min | 停等 | §8.1 完整 |
| 6 | M-1-14f1 storefront 元件 — LoginPage + RegisterPage + auth.css + Google OAuth(Supabase 內建) | 45-60 min | 停等 | §8.3 LoginPage + RegisterPage + §8.4 signInWithGoogle |
| 7 | **M-1-14f2 LINE OAuth 自寫(Q4=Y 新拆 sub-slice)** | **60-90 min** | **停等(env 必先設)** | §8.5 `/api/auth/line/start` + `/api/auth/line/callback` 兩 API routes + Supabase Admin API createUser 流程 + session 發放 |
| 8 | M-1-14g storefront 元件 — AccountPage 主檔 + 7 子檔 + account.css + wallet.css + tier.css(Q5=A 拆檔) | 60-90 min | 停等 | §8.3 AccountPage 拆 7 個 _components/{Overview,Orders,Wallet,Favorites,Vehicles,Address,Profile}Tab.tsx |
| 9 | M-1-14h MobileTabBar(#158)+ mobile-tabbar.css(從 tweaks.css L375-426 抽) | 30-45 min | 停等 | §8.3 MobileTabBar + #158 backlog update |

**Codex Review Packet 觸發點:** #1(動 schema + RLS + 4 trigger SECURITY DEFINER、屬鐵則 12 + security 高敏)/ #4(動 service_role 路徑)/ #7(動 service_role + 自寫 OAuth、屬 security 高敏、必觸發 Codex Packet)。Code 跑到觸發點停下、產 Packet 等 Sean 早上貼給 Codex。

**每 sub-slice 共通:** typecheck + lint + build(動 .ts/.tsx 加)三綠才 commit、commit 訊息對齊「字面 vs 事實」+ STATUS.md 7 欄位同步 + busboy-end + 不 push。

**M-1-14f2 LINE OAuth 前置阻塞:** 跑 #7 前 Sean 必先完成 §13 dashboard checklist 三項(LINE channel 註冊 + callback URL 設定 + `.env.local` 三 env vars 寫入),否則 #7 Code 跑到 LINE provider config 會 throw env 未設 error 停下。建議 Sean 在 Code 跑 #6 期間(預估 45-60 min)同步做 LINE Developers 註冊。

---

## 12. backlog raise #156 + #158 字面校正

### 12.1 #156 校正

既有條目大致完整,M-1-14 PRD 落地後補:
- 條目「狀態」加註:「⏳ 待執行(M-1-14 customers 表已建、application 欄位 ALTER ADD COLUMN 待 #156 PRD 階段;M-1-14 已預留 customers.tier 寫入 service_role only,審核通過後由 admin 端寫 tier、對齊本 #156)」
- 條目「預期解法」L285 「Customer schema 擴欄:application_status enum ...」加註:「ALTER TABLE customers ADD COLUMN ...(對齊 M-1-14 Q3=A 拍板:#156 階段才加 application 欄位)」
- 「通過 → 自動升等 tier」校正字面:「通過 → admin 端 service_role 寫 customers.tier(對齊 M-1-14 Q1=A:不存在累積消費自動升級邏輯)」

### 12.2 #158 校正

行號 + CSS 來源:
- 條目「問題」L314 改:`design App.jsx L166-190 有完整 <nav className="mobile-tabbar"> 字面、5 個 tab(首頁 / 商品 / 找車 / 會員 / 購物車)+ SVG icon + label + active dot;MobileWrapper 隱藏邏輯在 L192-209、hideTabBar = currentPage === 'product' 在 L195`(原寫 L162-193 行號偏差、且未提隱藏邏輯位置)
- 條目「預期解法」L323 改:`新建 apps/storefront/src/styles/mobile-tabbar.css(對齊 design styles/tweaks.css L375-426 .mobile-tabbar* selectors)`(原寫「styles/app.css 或 home.css」、實況 design 無 app.css、CSS 在 tweaks.css)
- 「狀態」加註:「⏳ 待執行(M-1-14h sub-slice 一併補搬、對齊 M-1-14 PRD §8.3 + §11)」
- 「依賴」加註:「對齊 M-1-14e 註冊登入 use-case(會員 tab 連結需要 customers 表 + auth.users 存在)」

---

## 13. Sean 端 Dashboard Checklist(Code 跑前必做)

**Q4=Y LINE 自寫 OAuth 觸發此 checklist**。Sean 在 Code 跑 sub-slice #7(M-1-14f2 LINE OAuth)前必完成全部 3 項,否則 sub-slice 跑到 env config 階段會 throw error 停下。

### 13.1 Google Cloud Console — 註冊 OAuth client(Supabase 內建)

1. 去 `https://console.cloud.google.com/`
2. 選或建專案(若無)
3. 左側選 **APIs & Services** → **OAuth consent screen** → 設為 External、填 PCM 基本資訊
4. 左側選 **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Application type: **Web application**
6. **Authorized redirect URIs** 加:`https://bmpnplmnldofgaohnaok.supabase.co/auth/v1/callback`(Supabase 內建路徑)
7. Create → 複製 **Client ID** + **Client Secret**
8. 去 Supabase Dashboard → **Authentication** → **Providers** → **Google** → Enable → 貼 Client ID + Secret → Save

### 13.2 LINE Developers — 註冊 LINE Login channel(自寫 OAuth)

1. 去 `https://developers.line.biz/console/`
2. **Create a new provider**(若無)→ 填 PCM Motorsports
3. **Create a new channel** → 選 **LINE Login** → 填 channel 名(例 `PCM Motorsports v2`)+ 描述
4. Channel 建好後進 **Basic settings**,複製 **Channel ID** + **Channel secret**
5. 進 **LINE Login** tab → **Callback URL** → 加(本地開發環境 + 線上環境兩條):
   - `http://localhost:3000/api/auth/line/callback`(本地)
   - `https://[your-vercel-domain]/api/auth/line/callback`(線上、Sean 自填 Vercel 網址)
6. **OpenID Connect** → 啟用 `profile` scope(取 sub + name);`email` scope **可選**(M-1-14e-f2 校正:採合成 email 方案、email 變加分非必須 → 不需等 LINE「Email address permission」審核即可上線。若要日後存真實 LINE email 再申請 + 啟用)
7. 不需 Apps for LINE 或 LIFF(本案不用 LIFF SDK,純走 Server-side OAuth)

### 13.3 v2 repo `.env.local` 寫入 3 env vars(Sean 在 terminal 自做)

⚠️ **`.env*` 屬 permissions.deny 硬攔範圍、Code 不可動、Sean 端手動寫**(對齊 CLAUDE.md 禁止清單)

```bash
# Sean 在 v2 repo terminal 跑(替換 XXX 為 13.2 第 4 步抓的字串)
cd /Users/sean_1/pcm-website-v2
echo "" >> .env.local
echo "# M-1-14 Q4=Y LINE OAuth" >> .env.local
echo "LINE_CHANNEL_ID=XXX" >> .env.local
echo "LINE_CHANNEL_SECRET=XXX" >> .env.local
echo "LINE_REDIRECT_URI=http://localhost:3000/api/auth/line/callback" >> .env.local
```

驗證:`grep -c "LINE_CHANNEL_ID" .env.local` 應回 `1`。

### 13.4 Checklist 完成標記

Sean 跑完 13.1 + 13.2 + 13.3 後跟 Cowork 說「dashboard checklist 完成」、Cowork 才把 LINE 部分 sub-slice 加進 Code 一夜跑指令。

---

— END —
