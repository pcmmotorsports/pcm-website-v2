# Supabase 線上 DB vs 程式「對帳」稽核報告

> **產出:** 2026-05-24 / Claude Code(唯讀稽核、未改 DB、未改 code、未 commit)
> **對象專案:** Supabase `pcm-website-v2`(id `bmpnplmnldofgaohnaok`、ap-southeast-1、Postgres 17.6、ACTIVE_HEALTHY)
> **方法:** Supabase MCP 唯讀查線上實際 schema(list_tables / list_migrations / pg_catalog 唯讀 SELECT / get_advisors)→ 跟 repo `supabase/migrations/` + `packages/domain` + `packages/adapters` 對帳。
> **重要:** 另有 2 個同組織專案 — `pcm-quote-v2`(報價系統、獨立)、`pcm-website`(INACTIVE 舊專案)。本稽核**只**查 `pcm-website-v2`。

---

## 一、白話總結(給 Sean)

線上資料庫整體**非常乾淨**。8 張表(brands / categories / products + customers / 地址 / 愛車 / 儲值金帳本)全部在、RLS 全開、欄位跟程式碼期望**逐欄對得起來**、會員資料的安全鎖(客人不能自己改會員等級 / 不能改餘額 / 帳本不能竄改)**全部到位**。

只有 **1 個真問題** 需要你拍板,加上 **1 個你早就知道、已記在 backlog 的待辦** 再次確認還沒做:

| 級別 | 問題 | 一句話 |
|---|---|---|
| ✅ 已解除(原 🔴 高) | 兩個會員相關 migration 的「版本時間戳」線上跟 repo 對不上 | 內容一樣、但檔名上的時間戳不同 → 原本下次跑 `supabase db push` 會誤判重跑撞「已存在」。**2026-05-24 已採選項 B(`supabase migration repair`)對齊回 repo 版本號、地雷解除**(見 §二末) |
| 🟡 中 | `rls_auto_enable` 這個自動開 RLS 的函式沒被任何 migration 管到、而且還對一般客人開放呼叫 | 就是 backlog #172、確認「還沒做」 |
| 🟢 低 | 11 條會員表的 RLS 規則寫法可優化(效能) | 現在 0 筆資料無感、規模大才有差、可批次改、**非漂移**(repo 跟線上一致) |
| ℹ️ 雜訊 | 7 個「未使用索引」警告 | 只是因為表還沒資料、別理它 |

下面是技術細節。

---

## 二、🔴 高 — Migration 版本時間戳漂移(workflow 漂移)

### 現象

| | repo 檔名版本 | 線上 `schema_migrations` 記錄版本 | name | 內容 |
|---|---|---|---|---|
| 會員 4 表 | `20260523034911` | **`20260523035648`** | `init_customers_and_subtables` | 相符 |
| 發票 NOT NULL patch | `20260523052537` | **`20260523052624`** | `customer_addresses_invoice_not_null_and_ledger_comment` | 相符 |

兩個檔的 **name 一致、SQL 內容一致**(已逐欄驗證線上 schema = repo migration 字面),**只有版本時間戳不同**(差幾分鐘 / 幾十秒)。其餘 10 個 product/brand migration **版本完全對齊**。

### 根因(推測、非坐實)

> **誠實更正(2026-05-24):本節原標「已坐實」+ 宣稱「10 個 product migration 每個 stmt_count 為 4~13」屬過度推論,以下為更正後的事實版本。**

查線上 `supabase_migrations.schema_migrations` 的 `statements` 陣列長度(12 個 migration 實測):

- 多數 product/brand migration 為 **4~13 句**(逐句拆開);但 `pricing_tier_alignment`(`20260511180231`)與 `products_base_table_column_grants`(`20260519031049`)這兩個 **product migration 也只有 1 句** —— 它們是經 `supabase db push` 上線的舊 migration。
- 2 個會員 migration:`stmt_count` 都是 **1**。

→ **因此 `stmt_count = 1` 並非「MCP `apply_migration`」的可靠判據**(單一 `DO`/`GRANT`/大區塊經 CLI `db push` 上線也會是 1 句)。18KB 的 `init_customers` 檔被存成 1 句確實**可疑**、暗示其上線路徑與多數 product migration 不同,但**無法單憑 stmt_count 坐實它走 MCP**。確切機制(為何會員 migration 的線上時間戳與 repo 檔名不同)**未坐實**;合理推測是 M-1-14a 會員 schema 的上線路徑與 product 不同、產生了不同的記錄時間戳,但證據不足以斷言是 MCP `apply_migration`。**無論機制為何,漂移現象本身已由 §一/§現象 兩邊版本號實證、且已用選項 B 解除。**

### 影響面(原本不修未來會痛在哪 — 現已解除)

1. **下次 `supabase db push` 會誤判**:CLI 看 repo 有 `20260523034911`,線上 `schema_migrations` 沒這號 → 當成「未上線 migration」嘗試重跑 → 撞 `type "member_tier" already exists` / `relation "customers" already exists` → push 中斷。
2. M-1-16(200 SKU 種子)或任何新 migration 上線前,這個地雷會先爆。
3. repo 的版本號 ≠ 線上真正部署的版本號,「版本控制」失去單一可信來源,未來追 schema 歷史會混淆。

### 修法選項(當時供拍板)

- **選項 A(對齊線上):** 把 repo 兩個檔 rename 成線上版本號。repo 配合線上事實、零 DB 動作。
- **選項 B(對齊 repo)← Sean 拍板採用:** 跑 `supabase migration repair --status reverted <線上版本>` + `--status applied <repo版本>` 把線上 tracking 改成 repo 版本號。動 tracking metadata、**不動實際 schema、不動資料、不改 repo 任何 `.sql` 與版本號引用**。
- **選項 C(暫不處理):** 不建議(會在最忙的 M-1-16 前爆)。

### ✅ 解除紀錄(2026-05-24,Q1=B 已執行)

採選項 B、由 Claude Code 在 main session 跑 `supabase migration repair`(Sean 親口指派「Supabase 部分你執行」):

```
supabase migration repair --status reverted 20260523035648 20260523052624
supabase migration repair --status applied  20260523034911 20260523052537
```

兩條皆 exit 0。修復後 `supabase migration list` 與 MCP `list_migrations` 雙重複驗:線上 `schema_migrations` 現記錄 **`20260523034911` / `20260523052537`**(對齊 repo 檔名),`035648` / `052624` 已消失,全 12 個 migration 的 Local 與 Remote 兩欄對齊、無 member migration pending。

- **未動:** 線上 schema、資料、repo 的 `.sql` 檔、14 處版本號 JSDoc/handoff/review 引用(B 後它們全部維持有效)。
- **可逆性:** `migration repair` 僅 relabel tracking metadata、可再 repair 回去。
- **下次 `db push` 誤判風險 = 已解除。**

---

## 三、🟡 中(backlog #172 確認仍開)— `rls_auto_enable` 未納管 + EXECUTE 對外開放

### 現象

- 線上存在 event trigger function `public.rls_auto_enable()`(SECURITY DEFINER)+ event trigger `ensure_rls`(`ddl_command_end` 時自動對新表開 RLS)。
- 全 repo grep:`rls_auto_enable` **只**出現在 `20260507012301_init_products_rls.sql` 的**註解**裡(L9-11 解釋「表已被它自動 enable」),**沒有任何 migration `CREATE` 它** → 它是 Supabase 環境 / 手動產的**未版本控制 DDL**。
- 安全 advisor 報 2 個 WARN(lint 0028 + 0029):`anon` 與 `authenticated` 都能經 `/rest/v1/rpc/rls_auto_enable` 呼叫這個 SECURITY DEFINER 函式(EXECUTE 沒被 REVOKE)。
  - 線上 ACL 證實:`rls_auto_enable` acl = `{=X, anon=X, authenticated=X, ...}`(PUBLIC + anon + authenticated 都有 EXECUTE)。
  - 對照:`handle_new_auth_user` / `sync_wallet_balance_on_ledger_insert` 兩個 SECURITY DEFINER 函式的 EXECUTE **已被 REVOKE**(acl 只剩 `postgres` + `service_role`)✅ — 證明會員 migration 的收斂做對了,只剩 `rls_auto_enable` 沒收。

### 結論

完全對應 **backlog #172**(「rls_auto_enable 納管補 migration + REVOKE EXECUTE、專門 slice、不急」)。本次稽核**確認此項仍開、兩個子項都還沒做**:(a) 補一個 migration 把它納入版本控制;(b) `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`。風險:一般客人可呼叫該 RPC(雖然它只是對表開 RLS、實際濫用空間小,但屬 advisor 標 WARN 的外露面)。

**處置(2026-05-24 Q3=A 拍板):維持不急、不另開專門 slice。** e-3(deposit-wallet)或 M-1-16 反正會動 migration,屆時**順手折入同一個 migration**:`CREATE OR REPLACE FUNCTION public.rls_auto_enable()`(把現有定義納入版本控制)+ `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;`。成本極小(兩三行 DDL),不值得獨立 slice 的開銷。

---

## 四、🟢 低(效能、**非漂移**)— RLS `auth.uid()` 未包 `(select …)`

效能 advisor 報 11 個 `auth_rls_initplan` WARN:會員 4 表的所有 own-row RLS 規則用 `auth.uid() = customer_user_id`(直呼),Postgres 會**逐 row 重算** `auth.uid()`,規模大時慢。官方建議改成 `(select auth.uid()) = customer_user_id`(每 query 算一次)。

- **這不是漂移**:repo migration 字面就是這樣寫(`auth.uid() = ...`),線上 = repo,一致。
- 現在 0 筆資料完全無感;真有大量會員查詢才有差。
- 可批次優化(一個 migration `DROP POLICY` + 重建,或 `ALTER POLICY`),屬獨立小 slice。**選擇性**,不急。

---

## 五、ℹ️ 雜訊(不要動)— `unused_index` INFO x7

7 個「索引從未被使用」INFO:`idx_products_availability` + 6 個會員表索引(customers_tier_idx / customers_email_idx / customer_addresses_customer_idx / customer_vehicles_customer_idx / customer_wallet_ledger_customer_idx / _date_idx)。

**原因 = 表還沒資料、沒查詢流量**,不是設計問題。這些索引都是依設計刻意建的(查會員地址 / 愛車 / 帳本必用)。**忽略**,等有資料 + 查詢後它們自然會被用到。

---

## 六、對得起來的部分(✅ 無漂移、留底)

| 維度 | 線上 | 程式期望 | 結論 |
|---|---|---|---|
| 表數量 | 8 表全在、RLS 全 enable | repo migration 全建 | ✅ |
| **adapter SELECT 欄位** | customers 10 / addresses 13 / vehicles 11 / ledger 8 | `CUSTOMER_SELECT` / `ADDRESS_SELECT` / `VEHICLE_SELECT` / `LEDGER_SELECT` | ✅ **逐欄完全相符** |
| domain 型別 | snake_case 欄 | camelCase entity(Customer / CustomerAddress / CustomerVehicle / WalletLedgerEntry / WalletBalance) | ✅ 一一對應 |
| RLS — addresses / vehicles | SELECT/INSERT/UPDATE/DELETE own(`auth.uid()=customer_user_id`) | 4 CRUD own | ✅ |
| RLS — customers | SELECT/UPDATE own + INSERT/DELETE service_role | 同 | ✅ |
| RLS — wallet_ledger | SELECT own + INSERT service_role、**無 UPDATE/DELETE** | ledger immutable | ✅(帳本不可竄改) |
| Partial unique index | `one_default_per_customer`(WHERE is_default)、`one_primary_per_customer`(WHERE is_primary) | use-case 兩步 unset→set 靠它守 | ✅ 兩個都在 |
| Trigger(5) | 3×`set_updated_at` + `on_auth_user_created`(auth.users)+ `on_wallet_ledger_inserted` | 同 | ✅ |
| Function(4) | handle_new_auth_user(SECDEF)/ sync_wallet_balance(SECDEF)/ set_updated_at(invoker)/ rls_auto_enable(SECDEF) | 前 3 個由 migration 建;rls_auto_enable 見 §三 | ✅(rls_auto_enable 除外) |
| Enum(3) | member_tier{general,store,premiumStore} / invoice_type{personal,company,donate} / wallet_entry_type{deposit,use,refund} | domain union 型別 | ✅ |
| CHECK 約束 | `wallet_amount_sign`(deposit+/use-/refund+)、invoice company/donate 必填 | 同 | ✅ |
| **欄位級 GRANT(會員防越權)** | authenticated 對 customers 只能 UPDATE `name/phone/birthday/updated_at`;`tier`/`wallet_balance`/`total_deposit` **只能 SELECT** | 防客人自升等 / 改餘額 | ✅ **三級會員價格鐵則守住** |
| SECURITY DEFINER EXECUTE 收斂 | handle_new_auth_user / sync_wallet_balance EXECUTE 已 REVOKE(只剩 postgres+service_role) | advisor 0028/0029 應對 | ✅(rls_auto_enable 仍欠、見 §三) |
| M-1-14a-patch | invoice_title / invoice_tax_id / invoice_donate_code 線上為 NOT NULL | patch migration | ✅ 已上線 |

> 備註:domain JSDoc 引用 migration 檔名 `20260523034911_init_customers_and_subtables`(= repo 檔名)。**因採選項 B(對齊 repo、非 rename),這些 JSDoc 引用維持正確、無須改動** —— 線上 tracking 現已等於 repo 版本號 `034911`,14 處引用全部仍指向有效版本。

---

## 七、拍板結果(2026-05-24 Sean 已決)

1. **§二 migration 版本漂移 → Q1=B ✅ 已執行**:跑 `supabase migration repair` 把線上 tracking 對齊回 repo 版本號(`034911`/`052537`),漂移解除、repo 與 `.sql` 未動(見 §二解除紀錄)。
2. **§三 backlog #172 → Q3=A ✅**:維持不急、不另開專門 slice,**折入 e-3 / M-1-16 的下一個 migration**(`CREATE OR REPLACE` + `REVOKE EXECUTE`,見 §三處置)。
3. **§四 RLS 效能優化**:維持非急、未排(0 筆資料無感、規模上來再批次處理)。

(本報告 2026-05-24 收尾、與 graphify 結構稽核報告同 commit 入版控。)
