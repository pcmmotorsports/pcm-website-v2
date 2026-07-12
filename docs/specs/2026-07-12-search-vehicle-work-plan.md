# 搜尋／變體 工作群 執行計畫（四條線）

> 日期：2026-07-12（Asia/Taipei）· 狀態：**規劃定案、待開新 session 逐條執行**（本 session 只偵察+提案+落計畫，未動 code/DB）
> 對應 memory：`project_search-vehicle-consistency-keyword-engine.md`（根因數字+codex 深審）
> 架構原則（Sean #276 定）：**報價單當大腦、網站消費**。
> 兩 Supabase：報價單 B庫 `dllwkkfanaebrsuyuedy` / 網站 `bmpnplmnldofgaohnaok`。
> Sean 2026-07-12 決定：三件事都做、分 session、搜尋引擎先簡單、lightech 要上。

---

## 0. 起因與根因（SQL 實證）

網站選 YAMAHA MT-09 SP 2021 出 74 件 vs 報價單同條件 250 件。復刻報價單 `search.ts` 查詢加總=250，分解：

| 少掉 | 件數 | 佔比 | 性質 | 對應工作線 |
|---|---|---|---|---|
| 母款家族樹展開缺失 | 41 | 16% | 搜尋機制 | **S1 變體補足** |
| 供應商未上架（lightech 為主） | 106 | 42% | 上架工程 | **S2 lightech 上架** |
| 資料新鮮度（cron matrix 沒含新供應商） | 29 | 12% | 同步工程 | S2 附帶／cron 修 |
| 網站現顯示 | 74 | 30% | — | — |

黃金例 bonamici Y016：供應商原始只標 `["MT-09"]`，報價單家族樹展開成 7 車款（MT-09 / SP / AMT / Sport Tracker / Sport Tracker ABS / Street Rally / Y-AMT）。網站只有原始 `["MT-09"]` 故搜 SP miss。報價單這套家族樹（`model_dictionary` / `model_family_closure_mv` / `category_variant_rule` / `product_groups_mv.search_models`）**只授 service_role、不對外**；對外 `storefront_catalog_v`（變體層 49811 列）只投影原始 `fitment_parsed`。

---

## 1. 四條線 + 依賴地圖

```
S1 變體補足（地基）──┬─→ S2 lightech 上架（吃 S1 展開合約）
                    ├─→ S3 搜尋引擎 MVP（車款 token 走 S1 展開後 fitment）
                    └─→ S4 目錄卡片顯示年份（要 S1 的家族/年份資訊）
```

**S1 是關鍵路徑，S2/S3/S4 都踩在它上面。** 建議順序：S1 →（S2 ∥ S4）→ S3。
S2 可與 S4 並行（一個灌資料、一個改前端卡片）；S3 最後（要字典快照 + 展開後 fitment 都就位）。

---

## 2. S1 · 變體補足（車款搜尋對齊，地基）— **最高優先**

### 目標
網站搜 MT-09 SP 對齊報價單（就已上架供應商而言），繼承件 41 立即回來；且保留「原廠直上 vs 家族規則推導」可追溯。

### 資料合約（吸收 codex：不覆蓋原始、加來源標記）
- **報價單端**：新增對外「一列一 fitment」的 effective view（暫名 `storefront_fitments_v`），每列：
  `supplier_slug, sku/main_sku, moto_brand, model_code, year_start, year_end, match_source ('direct'|'inherited'), source_model_code, rule_version`。
  來源 = `product_groups_mv.search_vehicles`（展開後）+ 標記哪些是原始（direct）哪些是家族樹推導（inherited）。
  年份走商品自身區間（不放大成變體車款存在年份，避免誤配）；缺年份 case 明確標記。
  權限：anon 唯讀、只投影公開最小欄（**不曝家族規則/內部備註/供應商來源/淘汰別名**）。
- **網站端**：
  - 同步管線多讀 effective view → 寫進**既有** `product_fitments`（`20260708130000`，trigger 衍生表、`listByFitment` 已存在無 caller），加 `match_source`/`source_model_code` 欄。
  - **🔴 `products.fitments` 原始值不覆蓋**（provenance：退貨/保固/裝不上爭議要查原廠明示 vs 推導）。
  - 車款篩選改走 `product_fitments`（接既有 `listByFitment`），不再前端全量過濾原始 jsonb。

### 現況錨點
- 網站比對：`apps/storefront/src/components/products-filter-logic.ts:61-73`（trim 後完全相等、無 normalize）。
- 前端全量撈：`app/products/page.tsx:20-27` + `ProductsPage.tsx` useMemo 前端過濾。
- 既有下推基礎：`SupabaseProductAdapter.ts:253-267`（listByFitment 無 caller）+ `helpers/fitment-queries.ts:44-80`。

### 驗收
網站 MT-09 SP 2021 命中數 ≈ 報價單同供應商 direct+inherited（144 之扣掉未上架/新鮮度差）；bonamici Y016 搜 MT-09 SP 找得到；`products.fitments` 原始值不變（porcelain 驗）；車款篩選走 DB。

### 重大改動（鐵則 8/12）
動兩庫 schema/view + 同步管線 + 篩選資料流 → plan 已提（本檔），開工前產 Codex Review Packet。rollback：effective view 可 DROP、`product_fitments` 可重建、原始 fitments 未動。

---

## 3. S2 · lightech 上架（+ cron matrix 修）

- 把 lightech（報價單 8788 筆）匯入網站 `products`（走既有 rpm-import 管線 + supplier-config `writeAllowed`）。
- **🔴 cron matrix 缺口**：`.github/workflows/rpm-sync.yml` 只跑 rpm/gbracing/bonamici，未含 7/11 才 `writeAllowed=true` 的 8 家（cncracing/evotech/eazigrip/samco/motogadget/front3d/materya/ebc）→ 順手補進 matrix（解 29 件新鮮度）。
- 依賴：S1 effective view 合約定案後上，確保 lightech 一進來就吃到展開（否則又是原始 fitment）。
- 參照 memory `project_brand-rollout-8plus1-overnight`（乾淨批匯入模式）、backlog #275。

## 4. S3 · 搜尋引擎 MVP（先簡單，Sean 拍 Q3=A）

- ① 修 Header：`Header.tsx:50-52,156-167` 現只 dispatch 無 listener（點了沒反應）→ 接 SearchModal。
- ② 字典快照每日同步網站本地（**不即時跨庫 RPC**，codex D4）：`search_aliases`(alias→canonical, token_type, priority, version) + `term_synonyms` + `catalog_version` 原子切版。來源=報價單 `model_dictionary`(mt09→MT-09) + `term_synonyms`(腳踏→腳踏後移組)。
- ③ query understanding（網站 server）：NFKC/大小寫/連字號正規化 + **longest-match 最長別名優先**（空白切 token 解不了「2021MT09護蓋」連寫）→ 車型 token 走 `product_fitments`(S1)、其餘接**現有** `searchByKeyword` ILIKE(`SupabaseProductAdapter.ts:284-321`)。
- ④ 排序優先序：SKU/車型精準 > title > synonym > category > description；搜尋欄位擴充納入 SKU/品牌/分類/副標（現只 3 欄 `product-query-support.ts:12-13`）；嚴格交集易回零 → 降級策略 + UI 提示。
- ⑤ **PGroonga 先 spike 再決定**（codex D3：非零維運，要 precision/recall 實測 + REINDEX runbook + 降級 ILIKE 演練 + SECURITY INVOKER）。ILIKE 中文品質夠就不上。
- 依賴：S1（車型 token 命中展開後 fitment）。

## 5. S4 · 目錄卡片顯示年份（評估報價單側提示詞）

### 痛點（實證，真實）
bonamici「鋁合金可調式腳踏後移組」網站 5 個變體同名同車款、只差價格+年份：dv4=2018-2024 / d001=2025-2026 / d001rr / d001rr_pv 等。客人分不出裝不裝得上。

### 提示詞逐點裁決
**照做**：年份優先 '18–'26 兩位數；「適用 N 款車型」不挑單一代表車款（PCM 既有鐵則）；極簡/無 emoji/低調小字/line-clamp 不破格線；先 preview（dev）再正式。
**不適用、要改**：
1. 🔴 品牌色 hex（#E73928/#1A1716/#F6F4EF）**在網站 repo 零命中**，是外部色。網站用 design token `--c-red:#dc2626`（`tokens.css:28`）+ per-brand（`--cnc-red`/`--ebc-red`）。鐵則 1：用網站 token、不照抄。
2. 🔴 view 名寫錯：提示詞說 `products_list_public`，網站實際讀 `products_public`（已投影 fitments、不需前置補）。
3. 🔴 **關鍵依賴**：提示詞要「沿用站內既有車系母層/vehicle_label 家族判定、不要模糊字串比對」——但**網站現在沒有家族判定能力**（在報價單、不對外）。現在硬做只能被迫模糊比對（提示詞自己禁止、會誤併不同車系，例 Panigale V4 vs Streetfighter V4）。→ **S4 依賴 S1** 把家族/vehicle_label 帶到網站後才能正確做。
4. 缺年份 case（例 bonamici rc08_dv4 fitment 無年份）→ 降級顯示「全年份」或不顯示，不臆測。
- 現況錨點：`ProductCard.tsx:194` 單行「適用 {fits}」無年份。

### 驗收
同名不同年變體卡片一眼看出年份差；多車款顯示「適用 N 款車型」不挑代表；手機/桌機不破、卡片等高；年份與詳情頁 fitments 一致。

---

## 6. 各線開工提醒

- 每條線開新 session：讀本檔 + STATUS + memory `project_search-vehicle-consistency-keyword-engine`。
- S1 先開（地基）；S1 資料合約 merge 後，S2/S4 才有正確資料源；S3 最後。
- S1/S2 涉兩庫 schema/migration → 鐵則 8 提 plan + 鐵則 12 Codex Packet + DB 交易模擬（BEGIN→驗→ROLLBACK）+ 第二意見。
- DB migration 寫 prod = Sean 手動（Claude 被 .env deny 擋）。
- 不 push、Sean 手動推。

## 7. codex 深審已擋下的坑（勿重犯）
① 展開不可覆蓋原始 fitment（provenance）② 字典不即時跨庫、每日快照本地化 + 原子切版 ③ 字典不整表開 anon、REVOKE 預設 EXECUTE ④ /products 正路=單一 SQL RPC JOIN 排序分頁、勿兩步 `.in('id',ids)` 撞 URL 上限 ⑤ PGroonga 先 spike ⑥ fitment 膨脹→trigger churn/index bloat 要量測 autovacuum ⑦ 年份交集/缺年份規則層明確處理。
