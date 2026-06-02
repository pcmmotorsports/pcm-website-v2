# S3 同步腳本改寫 — 動手前 prep / 偵察筆記(blocked on S0)

> 執行 session 2026-06-02 在「S3 卡 S0」期間做的唯讀偵察(改任何碼前)。
> **非最終 plan**:S3 真正開工前、S0 view 合約一到、補完下方 OPEN 項即升正式 plan + 跑 codex 關卡1(鐵則 8+12)。
> 上層 plan:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`(§4 S3 列、§8 風險)。
> handoff:`docs/handoff/2026-06-02-quote-integration-handoff.md`(§7.3 S3 內容)。

## A. S3 要改什麼(S0-independent、已可定)

S3 = 同步腳本從「直讀來源 raw `products` + `product_groups_mv`」改成「讀報價單側乾淨 view `storefront_catalog_v`」+ 廢 `RPM-` 前綴 + 只寫公開欄(停寫敏感 metadata、解 S1 CHECK)+ 對齊 `(supplier_slug, sku)`。

逐檔(現況行號):

1. **`scripts/rpm-fetch.ts`**
   - 現:`fetchAllRpmProducts`(L49-68)讀 source `products` 17 欄(**含敏感** `price_shopee`/`price_cost`/`price_source_amount`/`price_source_currency`)+ `.eq('supplier_slug','rpm')`;`fetchVehicleLabels`(L70-82)第二查讀 `product_groups_mv` 取 `vehicle_label`。
   - S3:改讀單一 `storefront_catalog_v`(只公開欄)。`vehicle_label` 若 view 已含 → 併入、刪 `fetchVehicleLabels` 第二查。`SourceProductRow`(L29-46)介面**砍掉 4 個敏感欄**。

2. **`scripts/rpm-transform.ts`**
   - 🔴 **停寫敏感 metadata**:`transformGroup` 的 metadata(L160-167)內 `shopee`/`cost`/`source_amount`/`source_currency` + `transformVariant` 的 metadata(L181-187)同 4 欄 → **刪除**(S1 CHECK 會拒寫、不刪整批 upsert fail)。保留非敏感:`name_en` / `source_corrected_count` / `source_corrected`。
   - 🔴 **price 語意**(plan §6 / handoff §6 地雷):現 transform 讀 source `price_store` 寫網站 `price_store`(網站語意=經銷);但**報價單 `price_store`=零售**(命名相反)。S0 view 合約欄改用語意名 `price_retail`。S3 對接**照語意不照欄名**:`view.price_retail` → 網站 `price_general`(零售)。網站 `price_store`(經銷)來源見 OPEN-2。
   - **廢 `RPM-` 前綴**:`external_id`(L142)現 `('rpm-'+mainSku).toUpperCase()`(=`RPM-DCC01`)、`handle`(L143)`'rpm-'+lower`。S3 改鍵模型 `(supplier_slug, sku)`(見 OPEN-3）。

3. **`scripts/rpm-load.ts`**
   - `upsertBatched`(L31-54)`onConflict` 由 `external_id`(products)/ `sku`(variants)改 **複合鍵** `(supplier_slug, sku)`。依賴 S1 已建唯一鍵(S1 把「唯一鍵切換」留給 S3)。

4. **`scripts/rpm-import.ts`**(orchestration)
   - 分群(L89-96）/ dry-run(L116-124）/ 寫入(L126-136）流程沿用;接線改吃新 fetch/transform 簽名。

## B. OPEN 項(卡 S0、view 合約一到才能定)

- **OPEN-1 view 欄位清單**:`storefront_catalog_v` 實際吐哪些欄?(sku / product_name_zh / description / `price_retail` / stock_status / fitment_parsed / images / spec / vehicle_label / supplier_slug …)→ 決定 `rpm-fetch` SELECT + `SourceProductRow` 介面。**等報價單回合約 + 審查 session 複驗 view 零敏感後**才定。
- **OPEN-2 網站經銷價(`price_store`)來源**:Phase 1 詳情頁釘 general、tier 價延 M-2-08。S3 是否仍寫網站 `price_store`?view 是否吐 dealer 價(半敏感、Q2=A 傾向不吐)?**預設:view 不吐 dealer、S3 不寫 `price_store`(留 NULL / 沿用舊值)**,待 Sean / S0 合約拍。
- **OPEN-3 唯一鍵切換 migration**(plan §8 風險):舊 `external_id RPM-DCC01` → 新 `(rpm, DCC01)`。需一次性對映既有 933 products + 7277 variants 的 schema/資料 migration(鐵則 8+12)→ 可能令 S3 體積超 15-45 分 → **評估拆 S3a(唯一鍵 migration)+ S3b(腳本改寫)**。
- **OPEN-4 連線方式**:網站用哪把 key 連報價單 B庫 `dllwkkfanaebrsuyuedy` 讀 view(受限 read key vs anon)。plan §7 待 Sean。

## C. 紀律 gate(S3 開工時)

- 鐵則 8+12 → 先 plan + codex 關卡1(審 plan)+ 關卡2(審 diff)、每片 codex 硬上限 2 輪。
- 前後台同步、檔案 <400、三綠(動 .ts 加 build)、code-reviewer、精準 git add、commit 字面 vs 事實、STATUS 7 欄、busboy-end、**不 push**。
- 🔴 S1→S3 間勿經任何路徑(手動 rpm-import / seed / 手動 SQL)寫 `shopee`/`cost`/`source_amount`/`source_currency` 到 metadata(S1 CHECK 拒)。
- OD 商品頁重做 = 獨立 workstream(疊 S6 上)、與 S3 無關。

— END —
