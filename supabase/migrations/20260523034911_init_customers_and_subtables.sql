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
  invoice_title        text DEFAULT '',          -- 公司抬頭(company only、對齊 L744)
  invoice_tax_id       text DEFAULT '',          -- 統編 8 碼(company only、對齊 L745 maxLength=8)
  invoice_donate_code  text DEFAULT '',          -- 愛心碼(donate only、對齊 L749 placeholder「例:8585(罕病)、925(伊甸)」)
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

COMMENT ON TABLE customer_wallet_ledger IS
  'M-1-14:儲值金交易紀錄(對齊 design WalletTab.jsx wallet-tx 結構)。amount 為 signed integer、deposit + / use - / refund +、CHECK constraint 守門。balance = SUM via customer_wallet_balance view、不存欄位避免 drift。Phase 1 deposit 為 mock(TapPay 整合留 M-3)、use 由 M-3 結帳折抵時寫入。';

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
ALTER TABLE customer_wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_select_own ON customer_wallet_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);

CREATE POLICY wallet_insert_service_role ON customer_wallet_ledger
  FOR INSERT TO service_role
  WITH CHECK (true);

-- 無 UPDATE / DELETE policy = 全拒(RLS default)、ledger immutable

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
$$ LANGUAGE plpgsql SET search_path = '';

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE TRIGGER on_wallet_ledger_inserted
  AFTER INSERT ON customer_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_balance_on_ledger_insert();

COMMENT ON FUNCTION public.sync_wallet_balance_on_ledger_insert IS
  'M-1-14 Q1=B:ledger AFTER INSERT 同步 customers.wallet_balance(amount 為 signed integer、deposit + / use - / refund +、自動加減)+ total_deposit(只累 deposit)。SECURITY DEFINER 必要(trigger 需繞 customers 表的 authenticated UPDATE GRANT 限制、以 owner 權限寫 wallet_balance / total_deposit 欄)。對帳工具見 customer_wallet_balance_check view。';

-- ============================================================
-- 函式 EXECUTE 權限收斂(security advisor lint 0028 / 0029 應對)
-- 字面 vs 事實:此段 PRD §3.8 字面未含、Code 依 advisor 實測結果補的安全強化(見 commit body)。
-- 2 個 SECURITY DEFINER trigger function 不需被 anon / authenticated 經 PostgREST RPC(/rest/v1/rpc/*)呼叫;
-- 預設 PostgreSQL + Supabase 對 public schema function GRANT EXECUTE 給 PUBLIC / anon / authenticated,
-- 暴露成可直呼的 RPC endpoint。REVOKE 後 trigger 仍正常觸發
-- (EXECUTE 權限在 CREATE TRIGGER 時檢查、非 fire 時;SECURITY DEFINER 以 owner postgres 權限執行不受影響)。
-- set_updated_at 為 SECURITY INVOKER、advisor 不報、不需收斂。
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_wallet_balance_on_ledger_insert() FROM PUBLIC, anon, authenticated;
