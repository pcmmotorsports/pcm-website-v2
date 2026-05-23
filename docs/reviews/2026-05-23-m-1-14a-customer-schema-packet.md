# Codex Review Packet — M-1-14a Supabase customers schema + RLS + trigger

> 產出時間:2026-05-23 / commit 前 / 不 push
> 對應規範:`docs/patterns/codex-review-packet.md` + 鐵則 12(動 schema / RLS / GRANT / migration / SECURITY DEFINER + pricing-adjacent wallet)
> 階段 C code-reviewer 已先審:**PASS、0 must-fix**(2 consider:精準 git add + 本 packet)
> 路徑說明:Sean Q2=A(2026-05-23)拍板放 `docs/reviews/` 對齊既有 packet 慣例(原 slice 指令明文 `docs/codex-packets/`、已移至本路徑 `docs/reviews/2026-05-23-m-1-14a-customer-schema-packet.md`)。

---

```
Codex Review Packet

Mode:        唯讀審查,不要修改檔案。只回 findings / 風險 / 是否可繼續。
Repo:        /Users/sean_1/pcm-website-v2
Project:     Supabase project bmpnplmnldofgaohnaok(PCM v2 dev)

Slice / 目標:
  M-1-14a — 建第 11 筆 Supabase migration,落地 PCM 會員系統 schema 地基:
    4 表(customers / customer_addresses / customer_vehicles / customer_wallet_ledger)
    + 3 enum + 1 對帳 view + RLS(4 表全 ENABLE)+ column-level GRANT
    + 3 function / 5 trigger(updated_at × 3 + handle_new_auth_user + sync_wallet_balance_on_ledger_insert)。
  字面源:docs/specs/m-1-14-customer-schema.md §3.2-3.8(Sean 已拍、字面凍結)。

內容分級: L3(會員 tier / 儲值金 wallet 屬高頻 + 高敏業務資料,必後台 CRUD + RLS 守)。

重大改動判定: 是。
  - 動 schema(專案第一次引入 PG function + trigger,既有 10 筆 migration 全無 function)
  - 動 RLS / GRANT / SECURITY DEFINER / migration
  - 動會員 tier + wallet(pricing-adjacent)
  - 命中鐵則 8(動 schema)+ 鐵則 12(security / RLS / migration / pricing)→ 本 packet。

═══════════════════════════════════════════
拍板脈絡(Codex 請留意,皆 PRD §10 字面紀錄)
═══════════════════════════════════════════

  Q1 = B:wallet_balance / total_deposit 存進 customers 表 + ledger AFTER INSERT trigger 同步
          (非 view 即時算);view 降級為 admin 對帳工具(customer_wallet_balance_check)。
  Q2 = A:auth.users insert trigger(handle_new_auth_user)自動建 customers row。
  Q3 = A:#156 application 欄位後 raise、不進本 migration。
  Q4 = Y:Google + LINE OAuth 都做 Phase 1(本段僅 schema、OAuth route 留後段 sub-slice)。
  Q5 = A:AccountPage 拆檔(與本 schema 段無關)。
  tier 來源拍板(Q1 D-3 = A):tier 後台手動標記、客人不可自改、無累積消費自動升級邏輯。

═══════════════════════════════════════════
本 slice 3 處「字面 vs 事實」偏離(Code 主動揭示、請審查合理性)
═══════════════════════════════════════════

  Code 採「先貼 PRD 字面套用 → 跑 advisor → 由實測結果驅動修正」的 empirical 路線。
  PRD 字面凍結指「不可改 PRD 檔本身」;migration 為獨立 artifact,以下 3 處偏離皆 documented。

  【偏離 1】wallet_ledger 補 `ALTER TABLE customer_wallet_ledger ENABLE ROW LEVEL SECURITY;`
    - PRD §3.6 SQL 字面只給 customer_wallet_ledger 的 2 個 CREATE POLICY,漏 ENABLE RLS 行
      (其他 3 表 PRD 字面都有 ENABLE)。
    - 但 PRD §3.6 區段標題明示「4 表全 ENABLE」── SQL 字面與 PRD 自身宣告意圖矛盾。
    - 財務 ledger 無 ENABLE RLS → policy 形同虛設 + advisor ERROR(policy_exists_rls_disabled)+ 資料外露。
    - 處置:補上,對齊 PRD 自身標題意圖 + 安全必要。

  【偏離 2】3 個 function 加 `SET search_path = ''`
    - PRD §3.8 字面未含。對齊 Supabase lint 0011(function_search_path_mutable)、防 search_path injection。
    - 安全分析:所有 table 引用已 schema-qualified(public.customers);
      now() / COALESCE / gen_random_uuid / ->> 屬 pg_catalog(空 search_path 下仍隱式可解析);
      enum literal 比較 NEW.entry_type = 'deposit' 透過欄位已知型別 coercion、不需 search_path 解析。
      → 語意零變。
    - 套用後 advisor 確認 function_search_path_mutable 完全消失(證實此強化必要且有效)。

  【偏離 3】2 個 SECURITY DEFINER function `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`
    (handle_new_auth_user + sync_wallet_balance_on_ledger_insert)
    - PRD §3.8 字面未含。對齊 advisor lint 0028/0029
      (anon/authenticated_security_definer_function_executable):
      public schema 的 SECURITY DEFINER function 被 PostgREST 暴露成 /rest/v1/rpc/* 可直呼。
    - Code 主張(code-reviewer 已驗證正確):trigger 觸發不受影響 ──
      PG 的 trigger function EXECUTE 權限在 CREATE TRIGGER(DDL)時檢查、fire 時不再檢查呼叫者 EXECUTE;
      CREATE TRIGGER 在 REVOKE 之前執行;SECURITY DEFINER 以 owner postgres 權限執行 body,與呼叫端 role 無關。
      REVOKE 只關掉「anon/authenticated 經 RPC 直呼」攻擊面。
    - set_updated_at 為 SECURITY INVOKER、advisor 不報、不收斂(被直呼也只在 invoker 權限跑、無提權)。

═══════════════════════════════════════════
Advisor security 結果(套用後實測)
═══════════════════════════════════════════

  ✅ M-1-14a 引入的物件:全綠。
     - 套 search_path 前:function_search_path_mutable WARN(已清)。
     - 套 REVOKE EXECUTE 前:handle_new_auth_user + sync_wallet 各 2 WARN(0028+0029)共 4 個(已清)。
  ⚠️ 剩 2 個 WARN:皆為既有 `rls_auto_enable`(0028 + 0029)。
     - rls_auto_enable 是既有 event trigger `ensure_rls`(DDL 時自動開 RLS 的安全網)的 function,
       owner postgres,**不在任何 migration 檔內**(DB 有物件未進版控的 drift)、非 M-1-14a 建立。
     - Code 判定 out of scope(禁止清單:不可動既有 infra),不修,flag 給 Sean。
     - 建議:Sean 決定是否(a)REVOKE EXECUTE 收斂 +(b)補進 migration 檔捕捉此 infra,留 follow-up backlog。

═══════════════════════════════════════════
migration-history vs 檔字面落差(已知、請知悉)
═══════════════════════════════════════════

  - apply_migration 套用的是「加 REVOKE 前」版本;REVOKE EXECUTE 經 execute_sql 補套到 live。
  - local migration 檔字面已含 REVOKE = live DB 實況(兩者一致,為 commit 的 canonical artifact)。
  - Supabase migration-history 紀錄停在加 REVOKE 前版本(MCP 兩步套用的已知小落差)。
  - 影響:若日後從 history 重播(非從檔重播)會少 REVOKE 兩行;live + git 檔皆正確,操作上不影響。

═══════════════════════════════════════════
三綠 + code-reviewer
═══════════════════════════════════════════

  - typecheck: ✅(7/7、純 SQL 無 .ts 變動 FULL TURBO）
  - lint:      ✅(10/10)
  - build:     N/A(純 SQL slice)
  - manifest:  N/A(未動 storefront 元件/styles)
  - code-reviewer(階段 C):PASS / 0 must-fix；逐行比對 migration vs PRD §3.2-3.8、除 3 處 documented 偏離外 1:1 對齊、無漏標偏離;REVOKE EXECUTE 主張驗證正確;tier/wallet 三層鎖定驗證真實鎖住;commit 數字校正正確。

═══════════════════════════════════════════
請 Codex 重點審查
═══════════════════════════════════════════

  1. 3 處偏離(尤其偏離 3 REVOKE EXECUTE 不破壞 trigger 的論證)是否有 Code + code-reviewer 漏看的角度?
  2. tier / wallet_balance / total_deposit 三層鎖定(column GRANT + RLS + trigger)是否真的封死
     authenticated 自改路徑?有無繞道(例:authenticated 經某 RPC / view / 其他 policy 間接寫入)?
  3. handle_new_auth_user SECURITY DEFINER 寫 public.customers ── 是否有 NULL email / 重複 email
     (UNIQUE constraint)導致 auth signup 失敗的邊界?Phase 1 是否需 EXCEPTION 處理?
  4. wallet_amount_sign CHECK + sync trigger 加減邏輯:refund(amount > 0)路徑 Phase 2 才用,
     目前 trigger 對 refund 也會加進 wallet_balance(正確)但不加 total_deposit(只 deposit 累),語意是否符預期?
  5. customer_wallet_balance_check view(security_invoker)未開 GRANT 給 authenticated ──
     確認 Phase 1 storefront 不會撞到「view 查不到」的問題(storefront 走 customers.wallet_balance 欄、不走 view)。
  6. rls_auto_enable 既有 infra 的處置(out of scope + flag)是否同意?或建議本 slice 一併收斂?

═══════════════════════════════════════════
自帶規則摘錄(讓 Codex 無需 repo 存取即可審查)
═══════════════════════════════════════════

  鐵則 1(design 真權威):後台 schema 對應 design 已定義資料結構,不反向遷就。
    本 slice:customers/addresses/vehicles/wallet 逐欄對齊 design AccountPages.jsx /
    WalletTab.jsx / TierComponents.jsx(每欄 comment 標 design 行號)。

  鐵則 11(三綠 + 字面 vs 事實):commit 前 typecheck+lint(+動 .ts/.tsx 加 build)全綠;
    commit 訊息對應實際內容、偏離必在 commit body 註明、數字一致不盲從指令字面。
    本 slice:指令字面寫「4 trigger」,實際 5 trigger / 3 function、已校正。

  鐵則 12(重大改動產 Codex Packet):動 security/RLS/GRANT/migration/schema/pricing → 本 packet。

  Server 端會員與價格鐵則:
    - 會員等級驗證必在 server 端重新檢查、不信任 client 送的欄位。
    - 經銷價絕不傳到一般會員瀏覽器;client component 不得 import 洩漏經銷價的模組。
    - 金額用整數(分/角)或 Decimal、禁用 number 處理價格(浮點誤差)。
      本 slice:wallet_balance / total_deposit / ledger amount 全 integer + CHECK constraint。

  五方分工:Codex 唯讀審查、回 findings / 風險 / 是否可繼續,不改 code / commit / push。
```

---

## 完整 migration SQL 字面(供 Codex 無 repo 存取審查)

檔名:`supabase/migrations/20260523034911_init_customers_and_subtables.sql`

```sql
-- ============================================================
-- M-1-14 customers 表 + 3 子表 + RLS + GRANT + view + trigger
-- 對齊 design AccountPages.jsx L310-681 + WalletTab.jsx + TierComponents.jsx
-- 對齊 既有 products RLS / view / GRANT pattern
-- ============================================================

CREATE TYPE member_tier AS ENUM ('general', 'store', 'premiumStore');

CREATE TABLE customers (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL DEFAULT '',
  phone           text DEFAULT '',
  birthday        date,
  tier            member_tier NOT NULL DEFAULT 'general',
  wallet_balance  integer NOT NULL DEFAULT 0,
  total_deposit   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_tier_idx ON customers(tier);
CREATE INDEX customers_email_idx ON customers(email);

CREATE TYPE invoice_type AS ENUM ('personal', 'company', 'donate');

CREATE TABLE customer_addresses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id     uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  is_default           boolean NOT NULL DEFAULT false,
  name                 text NOT NULL,
  phone                text DEFAULT '',
  line                 text NOT NULL,
  invoice_type         invoice_type NOT NULL DEFAULT 'personal',
  invoice_carrier      text DEFAULT '',
  invoice_title        text DEFAULT '',
  invoice_tax_id       text DEFAULT '',
  invoice_donate_code  text DEFAULT '',
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
CREATE UNIQUE INDEX customer_addresses_one_default_per_customer
  ON customer_addresses(customer_user_id) WHERE is_default = true;

CREATE TABLE customer_vehicles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  is_primary        boolean NOT NULL DEFAULT false,
  name              text NOT NULL,
  year              text DEFAULT '',
  engine            text DEFAULT '',
  km                text DEFAULT '',
  mods              text DEFAULT '',
  service           date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_vehicles_customer_idx ON customer_vehicles(customer_user_id);
CREATE UNIQUE INDEX customer_vehicles_one_primary_per_customer
  ON customer_vehicles(customer_user_id) WHERE is_primary = true;

CREATE TYPE wallet_entry_type AS ENUM ('deposit', 'use', 'refund');

CREATE TABLE customer_wallet_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  uuid NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  entry_date        date NOT NULL DEFAULT current_date,
  entry_type        wallet_entry_type NOT NULL,
  amount            integer NOT NULL,
  note              text NOT NULL DEFAULT '',
  related_order_id  uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_amount_sign CHECK (
    (entry_type = 'deposit' AND amount > 0) OR
    (entry_type = 'use'     AND amount < 0) OR
    (entry_type = 'refund'  AND amount > 0)
  )
);
CREATE INDEX customer_wallet_ledger_customer_idx ON customer_wallet_ledger(customer_user_id);
CREATE INDEX customer_wallet_ledger_date_idx ON customer_wallet_ledger(entry_date DESC);

CREATE VIEW customer_wallet_balance_check
  WITH (security_invoker = true) AS
SELECT
  customer_user_id,
  COALESCE(SUM(amount), 0)::integer                                       AS computed_balance,
  COALESCE(SUM(amount) FILTER (WHERE entry_type = 'deposit'), 0)::integer AS computed_total_deposit,
  MAX(created_at)                                                          AS last_entry_at
FROM customer_wallet_ledger
GROUP BY customer_user_id;

-- RLS:4 表全 ENABLE
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_select_own ON customers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY customers_update_own ON customers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY customers_insert_service_role ON customers
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY customers_delete_service_role ON customers
  FOR DELETE TO service_role USING (true);

ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY addresses_select_own ON customer_addresses
  FOR SELECT TO authenticated USING (auth.uid() = customer_user_id);
CREATE POLICY addresses_insert_own ON customer_addresses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY addresses_update_own ON customer_addresses
  FOR UPDATE TO authenticated USING (auth.uid() = customer_user_id) WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY addresses_delete_own ON customer_addresses
  FOR DELETE TO authenticated USING (auth.uid() = customer_user_id);

ALTER TABLE customer_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_select_own ON customer_vehicles
  FOR SELECT TO authenticated USING (auth.uid() = customer_user_id);
CREATE POLICY vehicles_insert_own ON customer_vehicles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY vehicles_update_own ON customer_vehicles
  FOR UPDATE TO authenticated USING (auth.uid() = customer_user_id) WITH CHECK (auth.uid() = customer_user_id);
CREATE POLICY vehicles_delete_own ON customer_vehicles
  FOR DELETE TO authenticated USING (auth.uid() = customer_user_id);

-- ★ 偏離 1:PRD §3.6 字面遺漏、補上對齊「4 表全 ENABLE」意圖 + 財務 ledger 安全必要
ALTER TABLE customer_wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_select_own ON customer_wallet_ledger
  FOR SELECT TO authenticated USING (auth.uid() = customer_user_id);
CREATE POLICY wallet_insert_service_role ON customer_wallet_ledger
  FOR INSERT TO service_role WITH CHECK (true);
-- 無 UPDATE / DELETE policy = 全拒(RLS default)、ledger immutable

-- Column-level GRANT
REVOKE ALL PRIVILEGES ON TABLE customers FROM anon, authenticated;
GRANT SELECT ON TABLE customers TO authenticated;
GRANT UPDATE (name, phone, birthday, updated_at) ON TABLE customers TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE customer_addresses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customer_addresses TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE customer_vehicles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customer_vehicles TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE customer_wallet_ledger FROM anon, authenticated;
GRANT SELECT ON TABLE customer_wallet_ledger TO authenticated;

-- customer_wallet_balance_check view 不開 anon / authenticated(Phase 1 admin 走 service_role 直查)

-- Trigger / function(★ 偏離 2:3 function 加 SET search_path = '')
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customer_addresses_set_updated_at
  BEFORE UPDATE ON customer_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customer_vehicles_set_updated_at
  BEFORE UPDATE ON customer_vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

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
  AFTER INSERT ON customer_wallet_ledger FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_balance_on_ledger_insert();

-- ★ 偏離 3:advisor 0028/0029 應對(2 SECURITY DEFINER function 收斂 EXECUTE)
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_wallet_balance_on_ledger_insert() FROM PUBLIC, anon, authenticated;
```

> 註:上方 SQL 為精簡呈現(省去 COMMENT 與部分 inline 註解);完整含 COMMENT 版本見 repo migration 檔。語意與 live DB 一致。

— END —
