# M-1-05 刀 1 spike — 切 view 三層連動偵察

> 純偵察 recon。不改 production code、不開刀 2、不立法、不更 backlog(對齊 §6)。
> §4 JOIN 行為以實測為準;§5 處置選項 Code 列分流、**不替 Sean 拍板**。

## §1. 偵察脈絡

- **觸發:** backlog #118「SupabaseProductAdapter 讀 method 切換讀 `products_public` view」系列。
- **上一輪校準:** 原 slice 指令把 `PRODUCT_SELECT` 字面寫成簡化版 `'*, brands(*), categories(*)'`,Code 偵察揭示實況為明確欄位列且**含 `price_by_tier`**,raise 後本 spike 擴成「切 view 三層連動」偵察。
- **三層連動:**
  - **(a) JOIN 行為** — `products_public` 是 view(非 table、無 FK metadata),PostgREST embedded JOIN(brands / categories)能否推導未明 → 需實測。
  - **(b) PRODUCT_SELECT 連動** — `PRODUCT_SELECT` 點名 `price_by_tier`、view 無此欄 → 切 view 即 select 字面要動。
  - **(c) mapper 連動** — `mapSupabaseProductToDomain` 硬讀 `row.price_by_tier`(含 `premiumStore` 公式的 currency 來源)→ 切 view 後 mapper / 取價路徑要動。
- **規範背景:** lessons-learned §12-26「Supabase view 遮蔽敏感欄位 + adapter 切換時序紀律」規則 2 明定「view 落地後同 milestone(最遲下一個 slice)必跟 adapter 切讀 view」—— 即 #118 / 刀 2 的立案依據。

## §2. 環境基線

| 項目 | 值 |
|---|---|
| HEAD | `cf1803e`(branch `dev`) |
| DB project ref | `bmpnplmnldofgaohnaok`(dev DB) |
| view migration | `supabase/migrations/20260510134708_products_public_view.sql`(刀 1.5 已補齊 drift、apply 確認) |
| `products_public` relkind | `v`(view) |
| `products` relkind | `r`(ordinary table) |

**view `products_public` 欄位(13、`information_schema.columns` 實查):**
`id, external_id, title, subtitle, description, handle, fitments, images, availability, brand_id, category_id, created_at, updated_at`

**base `products` 欄位(15、`information_schema.columns` 實查):**
`id, external_id, title, subtitle, description, handle, price_by_tier, fitments, images, availability, brand_id, category_id, metadata, created_at, updated_at`

**view 相對 base 排除 2 欄:** `price_by_tier`(jsonb)、`metadata`(jsonb) —— 對齊 migration L19 註解「price_by_tier 排除(經銷價敏感欄位)」+ L25 註解「metadata 排除(自由 schema、保守不對外)」。

## §3. 三層連動現況(三方字面對照)

| 層 | 位置 | 摘要 |
|---|---|---|
| (a) view DDL | `supabase/migrations/20260510134708_products_public_view.sql` L10-28 | `security_invoker=true`、`SELECT 13 欄 FROM products`、排除 price_by_tier + metadata |
| (b) adapter select | `packages/adapters/src/supabase/SupabaseProductAdapter.ts` L24-25 `PRODUCT_SELECT` | 明確欄位列、**含 `price_by_tier`** + `brands(...)` + `categories(...)` JOIN |
| (c) mapper read | `packages/adapters/src/supabase/mappers/product.ts` L81-126 `mapSupabaseProductToDomain` | 硬讀 `row.price_by_tier.general/.store/.store.currency`;null JOIN 即 throw |

**(a) view DDL(L10-28 完整字面):**

```sql
CREATE OR REPLACE VIEW products_public
WITH (security_invoker = true) AS
SELECT
  id,
  external_id,
  title,
  subtitle,
  description,
  handle,
  -- price_by_tier 排除(經銷價敏感欄位)
  fitments,
  images,
  availability,
  brand_id,
  category_id,
  -- metadata 排除(自由 schema、未來可能混內部欄位、保守不對外)
  created_at,
  updated_at
FROM products;
```

**(b) `PRODUCT_SELECT`(SupabaseProductAdapter.ts L24-25 完整字面):**

```
'id, title, subtitle, description, handle, price_by_tier, fitments, images, availability, created_at, updated_at, brands(id, name, slug, premium_extra_pct), categories(raw_path, segments)'
```

**(c) mapper 讀取字面(product.ts):**

```ts
// L82-87 — null JOIN 即 throw
if (!row.brands) { throw new Error(`Product ${row.id} missing brand JOIN`); }
if (!row.categories) { throw new Error(`Product ${row.id} missing category JOIN`); }

// L113-117 — priceByTier 硬讀 row.price_by_tier(無 guard)
priceByTier: {
  general: toMoney(row.price_by_tier.general),
  store: toMoney(row.price_by_tier.store),
  premiumStore: { amount: toMoneyAmount(0), currency: row.price_by_tier.store.currency },
},
```

mapper return(L102-125)引用的 `row.*` 欄位:`id, title, fitments, price_by_tier.{general,store,store.currency}, description, images, availability, handle, subtitle, created_at, updated_at` + `row.brands.{id,name,slug,premium_extra_pct}` + `row.categories.{raw_path,segments}`。

**三層連動衝突點(字面推導、非預判):**

1. **PRODUCT_SELECT × view:** `PRODUCT_SELECT` 點名 `price_by_tier`,view 無此欄 → 切 view 後 PostgREST 解析該欄即報 column-not-exist(parse 階段、與 row 數無關)。切 view **必同步改 `PRODUCT_SELECT` 字面去 `price_by_tier`**。
2. **mapper × view:** 即使 `PRODUCT_SELECT` 去掉 `price_by_tier`,mapper L113-117 仍硬讀 `row.price_by_tier.general/.store` → view row 無此欄 → runtime `Cannot read properties of undefined`。切 view **必同步改 mapper 或拆 view 專用 mapper**。
3. **mapper 需求 vs view 供給:** mapper 所需 base 欄位中,**唯一** view 未提供的是 `price_by_tier`(其餘 `id/title/fitments/description/images/availability/handle/subtitle/created_at/updated_at` + `brand_id/category_id` view 皆有)。連動處置的核心即「`price_by_tier` 移除後怎麼接」。

## §4. JOIN 行為實測(三組 + 基線)

spike script:`packages/adapters/scripts/spikes/M-1-05-postgrest-view-join.mjs`(丟棄式、未 commit、留檔)。
跑法:`node --env-file=apps/storefront/.env.local packages/adapters/scripts/spikes/M-1-05-postgrest-view-join.mjs`。
client:inline `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`(service_role、不複用 `client.ts`)。

| # | Query | status | error.code | error.message | data | 結論 |
|---|---|---|---|---|---|---|
| Q1 | `.from('products_public').select('id, title, handle, brands(*), categories(*)')` | `200 OK` | `null` | `null` | `[]` | ✅ embed 關係解析成功 |
| Q2 | `.from('products_public').select('id, title, handle, brands!brand_id(*), categories!category_id(*)')` | `200 OK` | `null` | `null` | `[]` | ✅ FK hint 亦解析成功 |
| Q3 | `.from('products_public').select('id, title, handle, brands!inner(*), categories!inner(*)')` | `200 OK` | `null` | `null` | `[]` | ✅ inner hint 亦解析成功 |
| B | `.from('products').select('id, title, handle, brands(*), categories(*)')`(base 基線) | `200 OK` | `null` | `null` | `[]` | ✅ base 表 embed 正常 |

**實測判讀:**

- 四組皆 `status 200 / error null`。`data []` 因 dev DB `products` / `products_public` 皆 0 row(無 seed)。
- **0 row 不影響結論:** PostgREST embedded JOIN 的關係解析發生在 query-parse 階段。若 view 與 `brands` / `categories` 無可偵測關係,會回 HTTP 4xx + PostgREST relationship 錯誤(如 `PGRST200` "Could not find a relationship ...")—— 與 row 數無關。回 `200 + error null` 即證實 PostgREST 在 `products_public` view 上**成功推導出對 brands / categories 的 embedded JOIN 關係**。
- **Q1 預設語法即 work** → 切 view 後 JOIN 語法**不需**改 FK hint / inner hint。Q2 / Q3 為補證:hint 語法在 view 上亦相容(未來若 view 改動破壞預設推導,可作備案)。
- 推測機制(非實測結論、僅供參考):view 投射了 `brand_id` / `category_id`(base 表 FK 欄),Supabase PostgREST 能透過 view 投射的 FK 欄推導 embedded relationship。

## §5. 三層連動處置選項分流(Code 觀察、不替 Sean 拍板)

三視角縮寫:**擴** = 擴充性、**維** = 可維護性、**追** = bug 可追蹤性。

### 維度 1:JOIN 行為 —— §4 實測已定

| 選項 | 內容 | 實測 |
|---|---|---|
| **D1.A** | Q1 work — 預設 embed 語法在 view 上 work、JOIN syntax 不需改 hint | ✅ **實測支持(Q1 200/null)** |
| D1.B | Q1 ❌ → 改 `!brand_id` / `!category_id` FK hint | 未觸發(Q1 既 work);Q2 補證 hint 亦相容 |
| D1.C | Q1+Q2 ❌ → 改 inner JOIN hint | 未觸發;Q3 補證 inner hint 亦相容 |
| D1.D | 三組皆 ❌ → 切 view 撞 PostgREST 架構問題 | **未發生** |

→ 維度 1 結論:**D1.A**。切 view 的 JOIN 字面可沿用預設 `brands(...)` / `categories(...)` 語法。

### 維度 2:`price_by_tier` 移除後的取價處置

mapper 切 view 後 `row.price_by_tier` 不存在,必擇一處置:

- **D2.A — split:** `findById` 維持讀 base `products` 表(細節頁 server-side rendered、單筆可 server-side strip 經銷價),`list` 4 method(`searchByKeyword` / `listByFitment` / `listByCategory` / `listByBrand`)切 view。
  - 擴:未來新 list method 需記得歸「走 view」一類。 維:兩條讀路徑、mapper 可能需拆兩個、認知成本中。 追:`findById` 細節頁取價行為不變、回歸面最小;leak 修正集中在 list(對應 migration 議題 6 點名的 `listByCategory/Brand`)。
- **D2.B — 全切 view:** 5 個讀 method 全切 view,mapper 改為「`priceByTier` 從 view 拿不到、改由 application 層另取(server-side rpc / 邊界 strip)」,形成「view 為主防線 + application strip 為輔」(對齊 §12-26 事故脈絡所述 #118 預期解法字面)。
  - 擴:view 單一防線、未來新讀 method 自動繼承遮蔽。 維:所有讀 method 一致走 view、無「哪個走哪」記憶負擔;但需新建 application 層取價基礎設施。 追:單一路徑好追;但「拿不到 price」變正常狀態、application 取價若漏接易靜默缺價。
- **D2.C — view 改 DDL 投射 masked price:** view 加欄位投射 `price_by_tier` 遮罩版(僅 general tier 公開)。
  - Code 不推薦(理由非 §12-26、見下方更正):需動 view DDL(本 spike + 刀 2 範圍外的 migration 變更)、且把遮罩 / 計算邏輯下沉進 schema 層、複雜度與耦合度高。列出僅為完整性。

> **§12-26 字面更正(字面 vs 事實):** 上一輪 slice 指令稱 D2.C「違反 lessons §12-26『view 不加計算欄位』鐵則」。實查 §12-26 規則為 (1) 加 view 前列「投射欄位 × 角色」對照矩陣 (2) view 落地後同 milestone 跟 adapter 切讀 view (3) contract test 驗 view 不回敏感欄位 —— **無「view 不加計算欄位」此條**。D2.C 的「不推薦」改以上述準確理由為據。

**維度 2 共通受阻點(Code 核心觀察):**
`products_public` view 排除的是**整個 `price_by_tier` 欄**(含 `general` 一般價、非僅 `store` 經銷價)。故 D2.A / D2.B / D2.C 三案皆有共通前提問題:**讀 view 的路徑連 storefront 顯示用的一般價都拿不到**。migration L35 註解自己點名的 **backlog #119「projection 拆分」** 正是此問題的歸屬(讓 general 價安全投射、`store` 經銷價仍遮蔽)。→ Code 觀察:**維度 2 與 #119 強耦合,刀 2(#118)不宜在 #119 未拍板前獨立全開。**

### 維度 3:contract test

- **T1:** 對應 #118 預期解法 + §12-26 規則 3「contract test 必加 case 驗 view 不回敏感欄位」,加 case 驗 `products_public` 不回 `price_by_tier`。**本 spike 不落地** —— contract test infra 屬獨立 milestone(刀 4 收工統一立 backlog #143),本偵察僅記錄。

### Code 最有把握的候選組合(不替 Sean 拍板)

- **維度 1 = D1.A** —— §4 三組實測直接支持,高把握。切 view JOIN 字面沿用預設語法。
- **維度 2 = 待 Sean + #119** —— D2.C 可先排除(需動 view DDL、複雜度高);D2.A vs D2.B 的核心差在「price 來源機制」,該機制屬 #119 projection 拆分範疇。Code 觀察:**維度 2 無法在 #119 未拍板前獨立定案**。若刀 2 須先起手,Code 略傾 **D2.A**(細節頁回歸面最小、先集中堵 list fan-out leak),但 D2.A 仍需 #119 補 list 頁安全取價來源。
- **建議 Sean 拍板項:** (1) 刀 2 字面方向採 D2.A 或 D2.B (2) #118 是否與 #119 合併考量 / #119 是否先行。**Code 不替 Sean 拍板,留 Sean 拍刀 2 字面方向。**

## §6. 不在範圍

- 不改 production code(`SupabaseProductAdapter.ts` / mapper / view DDL / migration 不動)。
- 不開刀 2(等 Sean 拍板維度 1 + 維度 2 組合後)。
- 不立法 / 不更新 backlog #118 字面 / 不寫 §12-31 / §12-32 / #143 / #144(留刀 4 收工統一處理)。
- 不裝 dep(spike script 純 `.mjs` + 既有 `@supabase/supabase-js` + 純 `node`)。
- 不動 STATUS L29 hash drift(busboy-end 收工自動 amend 處理)。
- backlog #118 字面為「6 method」、STATUS L35 字面為「刀 2 改寫 6→5 個讀 method 切 view + save 維持 base」;本 recon 用中性字面「5 個讀 method + save 維持 base」,不在本 spike 改 #118。
