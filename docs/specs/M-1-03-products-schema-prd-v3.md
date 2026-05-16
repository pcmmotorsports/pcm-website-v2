# M-1-03 a2-2 Products Schema PRD v3

> **Status:** 🟢 拍板 / 2026-05-06
> **拍板人:** Sean(2026-05-06 a2-2 v3 review 5Q + 本對話 3Q + Code review pass 3 處字面修正)
> **層級:** docs/specs/、衝突仲裁僅次 STATUS.md / NORTHSTAR / supabase-schema-design.md / 0001-0005 ADR / v3-decisions.md
> **本檔角色:** a2-2 v3(products schema rebuild)範圍 + 字面 + Slice 拆法、新 session 起手錨點
>
> 配合閱讀:
> - `docs/specs/M-1-03-a2-2-v3-decisions.md`(5Q 拍板紀錄、本檔上位)
> - `docs/architecture/supabase-schema-design.md` §2.1 / §5.1 / §10.1(真權威字面源)
> - `supabase/migrations/20260505130758_init_brands_categories.sql`(a2-1 RLS 慣例)
> - `docs/phase-1-backlog.md` #81(variants 推遲錨點)、#100(§10.1 vs .sql drift 全 catalog 表錨點)

---

## §1 範圍與目標

### 1.1 a2-2 v3 範圍

**包含:**
- products 表 schema(完整欄位 + CHECK 約束 + 跨表 FK ON DELETE RESTRICT)
- products RLS 4 policy(SELECT public + INSERT/UPDATE/DELETE service_role、對齊 a2-1)
- products 索引(階段 1、引用 supabase-schema-design.md §10.1)

**不包含(對齊 5Q + 3Q 拍板):**

| 項 | 推遲到 | 拍板源 |
|---|---|---|
| variants 表 schema | M-1-13 / backlog #81 | 本對話 Q1=A |
| customers + customer_groups 表 | M-1-14 / M-2-01 | v3-decisions Q3=C2 |
| customer.tier 欄位 / customer_group_id FK | 同上 | 同上 |
| 三層折扣 application 計算 | 同上 | 同上 |
| trigger updated_at auto-update | M-1-14 application 端評估 | 本對話 Q2=B |

### 1.2 5Q 拍板共識引用(v3-decisions.md)

| Q | 拍板 | 對應 § |
|---|---|---|
| Q1=A2 | jsonb 真權威 §5.1 | §2 price_by_tier 字面 |
| Q2=B2 | service_role 慣例 a2-1 | §6 RLS |
| Q3=C2 | customer_groups 推遲 | §1.1 邊界 |
| Q4=D1 | Slice A 拆 A1 + A2 | §8 拆法 |
| Q5=E2 | 新 session 落地 | 本檔即新 session 產物 |

### 1.3 本對話 3Q 拍板共識

| Q | 拍板 | 對應 § |
|---|---|---|
| Q1=A | variants 整段拿掉、§1 邊界明寫 | §1.1 / §3 不寫 |
| Q2=B | trigger 不寫、application 端 set | §1.1 / §5 不寫、backlog 條目 |
| Q3=A | ON DELETE RESTRICT 補正 + 同步補真權威 | §2 / §4 / §9 字面 vs 事實揭示 |

---

## §2 products 表 schema

### 2.1 表 schema(SQL block)

直接搬 supabase-schema-design.md §2.1 + 補 ON DELETE RESTRICT(對齊 a2-1 Q2=B1):

```sql
CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     text UNIQUE NOT NULL,
  title           text NOT NULL,
  subtitle        text,
  description     text,
  handle          text UNIQUE NOT NULL,
  price_by_tier   jsonb NOT NULL,
  fitments        jsonb NOT NULL DEFAULT '[]',
  images          jsonb NOT NULL DEFAULT '[]',
  availability    text NOT NULL DEFAULT 'in-stock',
  brand_id        uuid REFERENCES brands(id) ON DELETE RESTRICT,
  category_id     uuid REFERENCES categories(id) ON DELETE RESTRICT,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT availability_valid CHECK (
    availability IN ('in-stock', 'out-of-stock')
  ),
  CONSTRAINT price_by_tier_keys CHECK (
    price_by_tier ? 'general' AND
    price_by_tier ? 'store'
  )
);
```

**M-1-05 刀 2 Sub-slice 2-1 新增雙欄:**
詳見 `docs/architecture/supabase-schema-design.md` §2.1 雙寫過渡期紀律。本 PRD 為 M-1-03 階段規格、雙欄為 M-1-05 後續演進、不修本 PRD 既有 §2.1 字面。

### 2.2 price_by_tier jsonb 字面範例

```json
{
  "general": { "amount": 4500, "currency": "TWD" },
  "store":   { "amount": 4000, "currency": "TWD" }
}
```

設計理由(對齊 supabase-schema-design.md §5.1 + §2.4 Pricing 公式):
- jsonb 內聯 2 key:5w SKU × 2 tier = 10w row vs 5w row、節省 join cost
- CHECK constraint 強制 `general` + `store` 兩 tier 全部存在、避免漏 tier 引發 server-side render fall-back 邏輯複雜
- `premiumStore` tier 不在 jsonb 內 seed、由 §2.4 Pricing 公式 storefront 動態算(`store × (1 - brand.premium_extra_pct / 100)`)
- amount 是 integer(分位 / TWD 元位)、對齊 packages/domain/src/shared/types.ts:MoneyAmount brand type + security-timeline #B3

**M-1-05 刀 2 Sub-slice 2-1 新增雙欄:**
詳見 `docs/architecture/supabase-schema-design.md` §2.1 雙寫過渡期紀律。本 PRD 為 M-1-03 階段規格、雙欄為 M-1-05 後續演進、不修本 PRD 既有 §2.2 字面。

### 2.3 字面 vs 事實揭示

真權威 §2.1 brand_id / category_id 無 ON DELETE 子句、本檔補 ON DELETE RESTRICT 對齊 a2-1 Q2=B1 拍板;同 commit 補 supabase-schema-design.md §2.1 真權威字面對齊(§9 #1 揭示)。

### 2.4 Pricing 公式(三 tier 顯示計算、對齊 M-1-03-post-supplement)

**後台只填 2 個價 + 1 個廠牌參數:**

| 欄位 | 型 | 來源 |
|---|---|---|
| `products.price_by_tier.general` | jsonb key:Money(integer amount + 'TWD') | 商品逐筆填、後台 UI 一般售價 |
| `products.price_by_tier.store` | jsonb key:Money | 商品逐筆填、後台 UI 店家經銷價 |
| `brands.premium_extra_pct` | integer(0-30、預設 0) | 廠牌一筆填、後台 UI 廠牌加碼 % |

**storefront 渲染各 tier 顯示價(server-side、對齊 §6.1 priceByTier 不洩漏):**

| customer.tier | 顯示價計算 |
|---|---|
| `general` | `price_by_tier.general.amount` |
| `store` | `price_by_tier.store.amount`(server-side render、不 leak 給 general client) |
| `premiumStore` | `Math.round(price_by_tier.store.amount × (1 - brand.premium_extra_pct / 100))`(server-side、不 leak 給 general / store client) |

**範例:**
- 商品 A:`price_by_tier.general = 4500` / `price_by_tier.store = 4000`、廠牌 RIZOMA `premium_extra_pct = 5`
- `general` tier 看 4500、`store` tier 看 4000、`premiumStore` tier 看 `round(4000 × 0.95) = 3800`
- 廠牌不加碼(`premium_extra_pct = 0`)時、`premiumStore` 看價等同 `store`

**設計動機:**
- 後台不爆欄位:商品逐筆 2 個價 + 廠牌一處集中加碼參數、不是每商品填 3 個價、減少漏填 / 不一致風險
- 廠牌加碼集中調整:改一處、整廠牌商品 `premiumStore` 看價同步、避免逐商品改
- tier 列舉仍三級(`general` / `store` / `premiumStore`、§5.2 customer_groups 三筆 INSERT + §5.3 customer.tier CHECK 維持三 key)、僅 pricing 表達由「三 key 全 seed」改為「二 key seed + 公式算第三」

**業務字面 vs schema 字面對應(避免混淆):**
- schema / wire / TS type 字面:`'general'` / `'store'` / `'premiumStore'`(camelCase、MemberTier 列舉)
- 後台 UI / 業務語意:一般會員 / 店家經銷 / 高級店家(中文)
- design-handoff 字面慣例:`general` / `store` / `premium_store`(snake_case、業務溝通用、非 schema key)
- 三層字面語意對齊、僅拼法層次不同、實作端以 schema 字面 `premiumStore` 為準

**M-1-05 刀 2 Sub-slice 2-1 新增雙欄:**
詳見 `docs/architecture/supabase-schema-design.md` §2.1 雙寫過渡期紀律。本 PRD 為 M-1-03 階段規格、雙欄為 M-1-05 後續演進、不修本 PRD 既有 §2.4 字面。

---

## §3 ~~variants 表~~

**整段不寫。**

variants schema 真權威 supabase-schema-design.md 暫無、本對話 Q1=A 拍板推遲 M-1-13 / backlog #81 落地、a2-2 v3 範圍**不包含 variants**。

詳細推遲源見 §1.1。

---

## §4 跨表 FK 規則

| 來源 | 目標 | ON DELETE | 對齊源 |
|---|---|---|---|
| products.brand_id | brands(id) | RESTRICT | a2-1 Q2=B1 |
| products.category_id | categories(id) | RESTRICT | a2-1 Q2=B1 |

**ON DELETE RESTRICT 設計理由:**
- brands / categories 刪除時若 products 表有引用、Postgres 拒絕刪除(返錯)、保護資料完整性
- 對齊 a2-1 落地 categories.parent_category_id ON DELETE RESTRICT 慣例;a2-1 brands 表無樹結構、本身無 ON DELETE 慣例可參照、a2-2 v3 products.brand_id 採同 RESTRICT 策略延續「保護資料完整性」精神

---

## §5 ~~trigger 設計~~

**整段不寫。**

PostgreSQL trigger 真權威 supabase-schema-design.md 暫無、本對話 Q2=B 拍板「不寫 trigger、updated_at 由 application 端 server-side 寫入時手動 set」、a2-2 v3 範圍**不包含 PostgreSQL trigger**。

**風險記錄(backlog 條目):**
- UPDATE 操作不會自動更新 updated_at(欄位 DEFAULT now() 只在 INSERT 觸發)、需 application 端手動 set 或補 BEFORE UPDATE trigger;M-1-14 application 端 SupabaseAdapter 統一補時評估、屬已知議題

詳細處置源見 §1.1。

---

## §6 RLS policy

products 4 policy、對齊 a2-1 brands / categories 結構慣例:

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select_public
  ON products
  FOR SELECT
  USING (true);

CREATE POLICY products_insert_service_role
  ON products
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY products_update_service_role
  ON products
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY products_delete_service_role
  ON products
  FOR DELETE
  TO service_role
  USING (true);
```

**慣例摘要(對齊 a2-1 落地結構):**
- 1 表 = 4 policy(SELECT public + INSERT/UPDATE/DELETE 各別 TO service_role)
- INSERT policy:`TO service_role WITH CHECK (true)`(無 USING)
- UPDATE policy:`TO service_role USING (true) WITH CHECK (true)`(雙子句)
- DELETE policy:`TO service_role USING (true)`(無 WITH CHECK)
- SELECT policy:`USING (true)`(無 TO 子句、隱含 PUBLIC)

---

## §7 索引策略

引用 supabase-schema-design.md §10.1 階段 1(M-1-16 種子 200 SKU、Supabase free tier 內可建)、products 共 **3 條 explicit index + 2 條 unique 自動 index**:

```sql
-- products explicit index(3 條)
CREATE INDEX idx_products_brand_id    ON products(brand_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_availability ON products(availability) WHERE availability = 'in-stock';

-- products unique index(2 條、UNIQUE 約束自動建立、不需 explicit CREATE INDEX)
-- products.external_id(UNIQUE NOT NULL)
-- products.handle(UNIQUE NOT NULL)
```

**註(階段 2 / 3 推遲):**
- 階段 2(GIN on fitments jsonb_path_ops):backlog #30、上線後 1k-5k SKU 觸發
- 階段 3(tsvector + pg_jieba):backlog #35 + ADR-0004 Q3=A1 後段、Supabase Pro 升完觸發

---

## §8 Slice 拆法

對齊 v3-decisions Q4=D1 + 本對話 Q1+Q2 範圍縮減後估時重算:

### Slice 0 — PRD v3 落地(本檔)~30-45 min

純 docs slice:寫本檔 + 補 supabase-schema-design.md §2.1 ON DELETE + 開 backlog 新條目 ①(updated_at trigger 風險)+ 開 backlog 新條目 ②(IDE worktree 自動 spawn + 殘留處置)+ 擴展 backlog #100 涵蓋 products 部分 + commit + busboy-end + 不 push。

### Slice A1 — products migration ~30-40 min

| Step | 內容 |
|---|---|
| 1 | 寫 supabase migration `<ts>_init_products.sql`、含 §2.1 完整 CREATE TABLE + §7 三條 explicit index |
| 2 | `supabase migration up`、apply |
| 3 | 肉眼驗:`\dt`(看 products 在)+ `\d products`(欄位齊 + CHECK + FK + index)+ 跨表 SELECT JOIN(brands / categories 通) |
| 4 | L1 三綠(typecheck + lint;build §2.2 純 SQL 可省) |
| 5 | git add + commit + busboy-end(依 echo 步驟手動更新 STATUS.md 6 欄)+ 不 push |

### Slice A2 — RLS + STATUS amend ~25-30 min

| Step | 內容 |
|---|---|
| 1 | 寫 supabase migration `<ts>_init_products_rls.sql`、含 §6 ALTER TABLE ENABLE RLS + 4 policy |
| 2 | `supabase migration up`、apply |
| 3 | 肉眼驗 RLS:anon SELECT 通 / anon INSERT 拒(error: new row violates RLS)/ service_role INSERT 通 |
| 4 | L1 三綠 |
| 5 | git add + commit + busboy-end(依 echo 步驟手動更新 STATUS.md 6 欄)+ 不 push |

---

## §9 字面 vs 事實揭示預留

落地時預期偏離點清單、commit body 鐵則 11 揭示用:

| # | 字面 | 事實 | 處置 |
|---|------|------|------|
| 1 | supabase-schema-design.md §2.1 brand_id / category_id 無 ON DELETE 子句 | a2-1 Q2=B1 拍板 ON DELETE RESTRICT、a2-2 v3 對齊 | Slice 0 同 commit 補真權威字面 |
| 2 | supabase-schema-design.md L16 / L421 提 variants 但無 schema 段 | 本對話 Q1=A 拍板 a2-2 v3 不含 variants、推遲 M-1-13 #81 | §3 整段不寫、§1.1 邊界明寫 |
| 3 | supabase-schema-design.md §2.1 updated_at 只有 DEFAULT now()、無 BEFORE UPDATE trigger | 本對話 Q2=B 拍板 a2-2 v3 不寫 trigger、application 端 set | §5 整段不寫、開 backlog 新條目記風險 |
| 4 | supabase-schema-design.md §10.1 真權威列 5 條 explicit index(brand_id / category_id / external_id / handle / availability) | a2-1 落地慣例「UNIQUE 約束自動 index 不重列 explicit」、a2-2 v3 §7 對齊寫 3 條 explicit + 2 條 unique 自動 | §7 寫 3+2、Slice 0 同 commit 擴展 backlog #100 涵蓋 products + 全 catalog 表 |

---

## 變更紀錄

| 日期 | 版本 | 內容 |
|---|---|---|
| 2026-05-06 | v3 | 初版、對齊 v3-decisions 5Q + 本對話 3Q 拍板 + Code review pass 3 處字面修正(P1 §4 brands.parent_brand_id 修 / P2 §9 加第 4 條揭示 / P3 §5 風險記錄語意精準) |
