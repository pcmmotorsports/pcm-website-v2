# S1 Plan:網站 schema 加 supplier_slug / 軟下架 + 清敏感 metadata

> 2026-06-02 / 執行 session 自驅規劃(報價單↔網站整合 Phase 1 第 S1 片)。
> **鐵則 8 重大改動 + 鐵則 12 敏感(動 schema + RLS + 碰經銷/成本 metadata)→ 本 plan 等 Sean 最終批 + codex 雙關卡。未碰 DB。**
> 上層工作 plan:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`(S0–S6)。
> **版本**:v1(codex k1 round1 FAIL)→ v2(採 4 must-fix)→ **v3(codex k1 round2 FAIL→採 5 findings;codex 雙輪硬上限到、不跑 round3、raise Sean 批)**。

## 1. 目標
網站 `products` + `product_variants` 加 `supplier_slug`(對齊報價單 `(supplier_slug, sku)` 模型)、`products` 加軟下架 `delisted_at`(給 S4 下架對賬)、清掉兩表 `metadata` 內經銷/成本敏感欄並**加 CHECK 硬擋**。為 S3 鋪乾淨 schema 地基。

## 2. 決策基線(Sean 拍)
- **Q1=A** 軟下架用 `delisted_at timestamptz`(NULL=上架)。
- **Q2=A** metadata 清 `shopee`/`cost`/`source_amount`/`source_currency`;留 `name_en`/`source_corrected`/`source_corrected_count`。
- **supplier_slug `NOT NULL DEFAULT 'rpm'`**(現役 RPM-only 過渡;S3 評估移 DEFAULT)。
- **唯一鍵切換留 S3**;S1 只加欄、不動唯一鍵約束。
- migration **用 `supabase db push`**(非 MCP)。

## 2.5 codex 關卡1 findings 處置(雙輪)
**round1(FAIL)4 must-fix → v2 採納**:① 下架要靠 RLS 非只 view WHERE;② delisted_at 可見性;③ variants 連動下架;④ metadata CHECK 硬擋。
**round2(FAIL)5 findings → v3 採納**:
- **MF1/MF2(RLS 引用未 grant column 可能 permission denied)**:round1 要「不 grant delisted_at」、round2 指「不 grant 又會 permission denied」。**v3 解法:grant `delisted_at` + RLS `USING(delisted_at IS NULL)` + view 不投射**。化解兩輪——RLS 擋掉下架 row 後,anon 可見 row 的 `delisted_at` 必為 NULL、下架 row 整列不可見 → **grant 不洩漏下架資訊**(化解 round1「怕洩漏」);grant 過的 column 在 policy 引用 → **無 permission denied**(化解 round2)。仍以 §8 真 DB 實測為最終 gate(不憑記憶斷言 Postgres 行為)。
- **consider→升 must(security_invoker)**:3 個 view `CREATE OR REPLACE` **必帶 `WITH (security_invoker = true)`**(漏寫退回 definer、RLS 失效、經銷防護破)。寫進 §4.1 DDL 要求 + §6 rollback。
- **consider(CHECK 破壞面)**:§4.3 CHECK 後 **S1→S3 期間所有會寫 `shopee/cost/source_amount/source_currency` 到 metadata 的路徑(rpm-import / seed / 修復 migration / 手動 SQL / 未來 dashboard edit)都會被拒寫**——此為 MF4 預期(schema 強制),§7 列全破壞面。
- **nit**:§6 rollback `DROP CONSTRAINT` 寫完整 `ALTER TABLE ... DROP CONSTRAINT ...`。

## 3. 現況(親驗 repo 6 個 migration)
| 表 | 結構 | metadata 敏感欄 | 三層經銷防護 | supplier_slug |
|---|---|---|---|---|
| `products`(群層、`external_id=rpm-MAINSKU` UNIQUE + `handle` UNIQUE) | 16 欄、`products_public`(14)/`products_list_public`(9)、皆 `security_invoker=true` | `shopee`/`cost`/`source_amount`/`source_currency`(+ 非敏感 `name_en`/`source_corrected_count`) | column GRANT(排 price_by_tier/price_store/metadata)+ view 排除 + RLS 4 policy(SELECT `USING(true)`) | ❌ 無 |
| `product_variants`(變體層、`sku` UNIQUE、`pv_spec_unique`) | `product_variants_public`(10)、`security_invoker=true` | `shopee`/`cost`/`source_amount`/`source_currency`(+ 非敏感 `source_corrected`) | 同上(排 price_store/metadata)、SELECT `USING(true)` | ❌ 無 |

⚠️ **兩層模型差異**:報價單「products=變體層 `UNIQUE(supplier_slug, sku)`」;網站「products=群層 + product_variants=變體層」。S1 兩表都加 supplier_slug;唯一鍵切換留 S3。

## 4. 要改什麼(migration DDL 設計)

### 4.1 加 `supplier_slug`(兩表)
- `ALTER TABLE products ADD COLUMN supplier_slug text NOT NULL DEFAULT 'rpm';` + product_variants 同。
- column GRANT:`GRANT SELECT (supplier_slug)`(供應商=公開)。
- 加進 3 個 public view 末欄投射:`CREATE OR REPLACE VIEW ... WITH (security_invoker = true) AS SELECT ..., supplier_slug FROM ...`(**每個 view 必帶 `WITH(security_invoker=true)`**、否則退 definer 破 RLS;Postgres 只能末尾 append 欄;adapter 以欄名取值)。
- index:`idx_products_supplier_slug` + `idx_product_variants_supplier_slug`(為 S3 + 對賬鋪路)。

### 4.2 加軟下架 `delisted_at`(僅 products 群層;RLS 擋 + grant 但 view 不投射)
- `ALTER TABLE products ADD COLUMN delisted_at timestamptz;`(NULL=上架)。變體**不加**(單一真相群層、靠 RLS 連動)。
- **GRANT SELECT (delisted_at)**(消除 RLS policy 引用未 grant column 的 permission denied 疑慮;在下方 RLS 前提下不洩漏)。
- public view **不投射** `delisted_at`(API 預設不回傳、乾淨)。
- **RLS(products)**:`DROP POLICY products_select_public; CREATE POLICY products_select_public ON products FOR SELECT USING (delisted_at IS NULL);` → 下架 row 對 anon/authenticated 整列不可見(base table + view 皆受 RLS)。service_role bypass、同步可讀寫全部。
  - **不洩漏論證**:可見 row 的 `delisted_at` 必為 NULL、下架 row 不可見 → anon 查 `delisted_at` 只得 NULL、無下架時間/存在性洩漏。
- **RLS(variants)**:`DROP POLICY product_variants_select_public; CREATE POLICY product_variants_select_public ON product_variants FOR SELECT USING (EXISTS(SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND p.delisted_at IS NULL));` → 下架商品的變體一併隱藏(引用的 `products.id`/`delisted_at` 皆 grant 過、無 permission denied)。
- 現有 933 群全 `delisted_at` NULL → 改後 anon 仍全見、**行為與現況等價**(零回歸);S4 UPDATE `delisted_at=now()` 即自動隱藏商品 + 變體。

### 4.3 清 metadata 敏感欄 + CHECK 硬擋(Q2=A + MF4)
- 先清值:`UPDATE products SET metadata = metadata - 'shopee' - 'cost' - 'source_amount' - 'source_currency';` + product_variants 同。
- 再加 CHECK(順序:先 UPDATE 後 ADD CONSTRAINT):
  - `ALTER TABLE products ADD CONSTRAINT products_metadata_no_sensitive CHECK (NOT (metadata ?| array['shopee','cost','source_amount','source_currency']));`
  - product_variants 同(`product_variants_metadata_no_sensitive`)。
- 留 `name_en`/`source_corrected_count`(products)/`source_corrected`(variants)。
- 不可逆(清空)但無風險:源頭 B 庫仍有、S3 重跑同步可回(S3 起 transform 停寫敏感欄、對齊 CHECK)。

### 4.4 grant / RLS / view 對齊小結
- 新增 column GRANT:`supplier_slug`(兩表)+ `delisted_at`(products)→ anon + authenticated SELECT。
- 改 2 個 SELECT RLS policy(products + variants、§4.2);INSERT/UPDATE/DELETE policy 不動(service_role)。
- 敏感欄(`price_store`/`price_by_tier`/`metadata`)維持不 grant、不進 view + 新增 CHECK 硬擋。
- 3 個 view 重建必帶 `WITH(security_invoker=true)`。

## 5. 影響面
- **DB schema**:兩表加 supplier_slug + products 加 delisted_at;3 view `CREATE OR REPLACE`(帶 security_invoker、末欄加 supplier_slug);column grants 增 supplier_slug + delisted_at;2 index;2 metadata CHECK;改 2 個 SELECT RLS policy。
- **rpm-import / rpm-transform**:S1 **不改 code**;但 §4.3 CHECK 後 transform 仍寫敏感 metadata 會被拒寫 → **rpm-import 在 S3 改 transform 停寫前不可跑**(MF4 預期)。
- **adapter / mapper / 前台**:**不碰**(adapter 讀 view;下架過濾在 RLS 層透明受益;supplier_slug plumb 留 S6)。
- **既有 16c 商品頁 / featured / 卡片**:零改動(view 末欄 append + 現況全 NULL、RLS 過濾等價)。

## 6. Rollback(down migration;Supabase forward-only、migration 檔頭註明可手動執行)
1. `DROP POLICY products_select_public ON products; CREATE POLICY products_select_public ON products FOR SELECT USING (true);` + variants 同(還原 `USING(true)`)。
2. 還原 3 個 view 為 S1 前定義(帶 `WITH(security_invoker=true)`、去 supplier_slug 投射)。
3. `ALTER TABLE products DROP CONSTRAINT products_metadata_no_sensitive;` + `ALTER TABLE product_variants DROP CONSTRAINT product_variants_metadata_no_sensitive;`
4. `REVOKE SELECT (supplier_slug, delisted_at) ON products FROM anon, authenticated;` + `REVOKE SELECT (supplier_slug) ON product_variants FROM anon, authenticated;`(拆兩表、variants 無 delisted_at)。
5. `DROP INDEX idx_products_supplier_slug; DROP INDEX idx_product_variants_supplier_slug;`
6. `ALTER TABLE products DROP COLUMN supplier_slug; ALTER TABLE products DROP COLUMN delisted_at; ALTER TABLE product_variants DROP COLUMN supplier_slug;`
- 清空的 metadata 敏感值不可逆(無風險、重跑同步回)。

## 7. 風險(研究 + 親驗 + codex 雙輪)
- **CHECK 後所有寫敏感 metadata 路徑被擋**(rpm-import / seed / 修復 migration / 手動 SQL / 未來 dashboard)→ S1 後、S3 改 transform 停寫前**勿經任何路徑寫 shopee/cost/source_amount/source_currency 到 metadata**;S3 緊接。此為 MF4 預期(schema 強制 > 程序約束)。
- **RLS column 權限 + 串連行為**:v3 走「grant delisted_at」化解 permission denied 疑慮;但 Postgres RLS policy 引用 column / subquery 套 parent RLS 的精確行為**動手前必 §8 真 DB 實測**(不憑記憶斷言)。
- **supplier_slug 群↔變體一致性**:S1 全 'rpm' 無虞;一致性約束(變體須等 parent supplier)排 S3。
- **supplier_slug DEFAULT 'rpm' 長期不對** → S3 移 DEFAULT。
- **線上 vs repo 漂移** → §8 動手前 MCP 複驗。
- **未來後台 admin 讀下架**:Phase 1 走 service_role(bypass RLS)、無需求;未來 authenticated 讀需另開 policy(留)。

## 8. 動手前驗證(S1 執行第一步、硬 gate、對齊 NIT-1)
MCP 唯讀(網站 `bmpnplmnldofgaohnaok`):
1. `products`/`product_variants` 的 `metadata` **key 清單 + 含敏感 key 的列數 count**(確認敏感欄真在、實計筆數;**不取金額值入對話**)。
2. 線上 view 定義 / column grants / RLS policy / **view 的 security_invoker reloption** vs repo 是否漂移(`list_migrations` + `pg_policies` / `pg_views` / `information_schema.role_column_grants`)。
3. **RLS 串連實測(硬 gate)**:套 migration(或先在測試 row)後,**用 anon + authenticated key** 對一筆設了 `delisted_at` 的測試商品查 `products` / `products_public` / `product_variants_public`:
   - 必須**正常回傳、不得 `permission denied` / 500**(驗 grant delisted_at + RLS 引用 column 可行);
   - 該下架商品 + 其變體**查不到**(MF1/MF3 生效);
   - 查 `delisted_at` 欄只得 NULL(不洩漏、MF2 化解論證);
   - 驗完還原測試資料。
   - 若出現 permission denied → 走 fallback:`SECURITY DEFINER` helper function 讀 delisted_at + 固定 `search_path`、policy 只傳 public 欄。
4. `get_advisors`(security)確認無新洩漏面。
5. **view 重建後經銷欄硬擋驗證(套 migration 後、不可省;審查 session 加)**:重建 3 個 public view 是經銷防護**最易回歸**的時機。明確驗:`cost`/`shopee`/`source_amount`/`source_currency`/`price_store` 透過重建後的 `products_public`/`products_list_public`/`product_variants_public` 仍**查不到**(維持 PG 42703 硬擋 / 不在投射);且逐一核對 3 個 view 的 SELECT 欄位清單**只多了 `supplier_slug`、絕無** price_store/price_by_tier/metadata/cost/shopee。**不可只測下架隱藏而漏測經銷欄。**

## 9. Gates(PCM 紀律)
- **codex 關卡1**:round1 FAIL→v2、round2 FAIL→v3(雙輪硬上限到、不跑 round3、raise Sean 批)。
- **三綠**:S1 純 `.sql`(不動 .ts)→ typecheck + lint 仍跑、build 跳;migration 由 `supabase db push` 套用(Sean 跑)。
- **code-reviewer**(commit 前)。
- **codex 關卡2**(審查 session、commit 前 diff、敏感片;每片硬上限 2 輪)。
- STATUS 7 欄自更;**不 push**。

— END —
