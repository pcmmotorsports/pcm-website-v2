# P4 商品目錄 RPC 逾時 — 交 Codex（docs/superpowers 目錄提速線）治本

> 寫給正在做「優化商品目錄讀取速度」的 Codex session。接手 session(Claude)診斷完、交棒。

## TL;DR
`public.search_catalog_by_vehicle`「**沒選車**（整個目錄、每位訪客預設畫面）」路徑跑 **8.2 秒** → 超過 anon 的 8 秒 `statement_timeout` → PostgREST 回 **HTTP 500 / `57014` canceling statement due to statement timeout** → 前端 try/catch 吞成空 → `/products` 顯示「0 件商品 / 找不到符合條件的商品」。根因=**PostgREST 用 generic plan，剪不掉 RPC 內 UNION 的車款比對分支**，即使 `p_brand IS NULL` 也照掃 `product_fitments`（81,711 列）+ `product_fitments_effective`（103,237 列）。

---

## 1. ⚠️ 你的 P4 工作「已經被 commit 了」（狀態變更，先看這段）
你原本 P4 的檔沒 commit、躺在工作樹。**接手 session 幫你 commit 並推上 `origin/dev`（preview，未上 prod）**：

| commit | 內容 |
|---|---|
| `dcebd92` | `feat(storefront): #51 商品目錄 server 分頁` — 10 檔：migration `20260712183000` + `catalog-query.ts` + `catalog-page.ts`(base) + `products.ts` + `products/page.tsx` + `ProductsPage.tsx/.test` + `products-url-state.tsx` |
| `bc1a7cf` | `feat(storefront): #212 S4 卡片年份` — `catalog-page.ts` 的 `toCardFitments`/fitments 透傳 delta + `product-card-fits.ts` 等 + migration `20260712193000`(RPC 加 `fitments` key) |
| `638b42a` | `docs STATUS` |

- **所以你現在 `git status` 是乾淨的**（P4 已進 git、別找不到以為丟了）。要改就從 committed 版改。
- `catalog-page.ts` 被**刻意拆兩段**：P4 base 在 `dcebd92`、S4 的 `toCardFitments`+fitments 透傳在 `bc1a7cf`（保歸屬）。改它請留意兩段。
- **兩支 migration（`183000` P4 + `193000` S4）已 apply 到 prod A庫 `bmpnplmnldofgaohnaok`**（Sean db push）。RPC 已在 prod DB 上。
  - **改 RPC = 開一支新 migration `CREATE OR REPLACE FUNCTION search_catalog_by_vehicle(...)`，別改已 apply 的 `183000`/`193000`。**

---

## 2. Bug 症狀
- preview `/products` = 「0 件商品 / 找不到符合條件的商品」（**空狀態，不是「載入失敗」錯誤態** → 代表 RPC 是「成功但回空」被前端當 0 筆；實際是逾時被 catch）。
- 側欄「零件分類」count、「品牌 (11)」**正常**（走 `catalog_brand_counts`，快、不受影響）。

## 3. 根因（已用 EXPLAIN 實證）
RPC 的 `matched` CTE：
```sql
WITH matched AS (
  SELECT id FROM products_list_public WHERE p_brand IS NULL          -- 沒選車走這支
  UNION
  SELECT product_id FROM product_fitments          WHERE p_brand IS NOT NULL AND moto_brand = p_brand AND ...  -- 81,711 列
  UNION
  SELECT product_id FROM product_fitments_effective WHERE p_brand IS NOT NULL AND moto_brand = p_brand AND ...  -- 103,237 列
)
```
- PostgREST 呼叫 RPC = prepared statement = **generic plan**（`p_brand` 不當常數）。
- 沒選車時 `p_brand IS NOT NULL` 執行期為 false（分支2/3 回 0），但 **generic plan 在計畫期剪不掉這兩支** → 照掃 `product_fitments` + `product_fitments_effective` + UNION dedup（~185K 列、temp spill）。

實測（皆以 `anon` 角色）：
| 情境 | Execution Time |
|---|---|
| custom plan / literal NULL（會剪枝） | 51–267 ms |
| **force_generic_plan（= PostgREST 實況）** | **8,215 ms** → 逾時 |
| service_role（自訂計畫剪枝 + RLS bypass） | 267 ms（← 唯讀驗證會誤判成「快」，別信這條） |

（buffers：shared hit≈36,904、temp read/written = UNION dedup 溢出。）

## 4. 復現/驗收方式（治本後**必須**用這兩個之一驗，別用 SET ROLE / service_role）
**方法 A — SQL 重現 generic plan：**
```sql
begin;
set local role anon;
set local plan_cache_mode = force_generic_plan;
prepare pq(text,text,int,int,int,text,text,text[],int,int) as
  select * from public.search_catalog_by_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
explain (analyze, buffers) execute pq(null,null,null,0,25,'recommend',null,null,null,null);
rollback;
```
目標：Execution Time 從 8.2s 壓到 **< 1s（理想 < 300ms）**。

**方法 B — 真前端路徑（curl PostgREST anon；publishable key 是公開金鑰、可貼）：**
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
  "https://bmpnplmnldofgaohnaok.supabase.co/rest/v1/rpc/search_catalog_by_vehicle" \
  -H "apikey: sb_publishable_27TBdwR_DrMiEEeJal5zKg_55yFLDnI" \
  -H "Authorization: Bearer sb_publishable_27TBdwR_DrMiEEeJal5zKg_55yFLDnI" \
  -H "Content-Type: application/json" \
  -d '{"p_brand":null,"p_model":null,"p_year":null,"p_offset":0,"p_limit":25,"p_sort":"recommend","p_category":null,"p_brand_slugs":null,"p_price_min":null,"p_price_max":null}'
```
目標：**HTTP 200（非 500）、time_total < 1s**。

## 5. 修法方向（你決定；候選）
- 讓「沒選車」路徑不碰 `product_fitments` / `product_fitments_effective`：
  - **最直接**：RPC 改 `LANGUAGE plpgsql` + `IF p_brand IS NULL THEN (只查 products_list_public) ELSE (加車款比對) END IF` → generic plan 下各分支自然不掃另一支。
  - 或維持 sql 但重構讓 generic plan 可剪（UNION 難剪、較不推薦）。
- 「有選車」路徑：確認 generic plan 下 `product_fitments`/`product_fitments_effective` 用得到 index（`moto_brand,model_code,year_start,year_end`）；沒有就補。
- `count(*) OVER ()` 對全 filtered set 在大結果集偏重，可一併評估（分開算 total 或估算）。

## 6. 安全 / 契約不變量（別破）
- RPC jsonb **只投影 12 個公開欄**：`id,title,subtitle,handle,availability,price_general,card_image,fits,brand_name,brand_slug,category_raw,fitments`。**絕不加 `price_store`/`price_by_tier`/`cost`/`supplier_slug`/`metadata`**。
- **必須保留 `fitments` key**（`193000` 加的；S4 卡片顯示年份靠前端 `toCardFitments` 收它、少了年份就不顯）。
- 簽章不變（10 參數 `text,text,int,int,int,text,text,text[],int,int`）；`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO anon,authenticated,service_role` 不變。
- `products_list_public` 維持 `security_invoker=true`。

## 7. 部署現況
- prod `main = 06110a8`（舊前端、**不呼叫新 RPC、不受影響**）。P4/S4 在 `origin/dev`(preview)、**未上 prod**。
- 治本 migration 出來後流程：Sean db push → 方法 A/B 驗 < 1s → dev→main 部署 → Sean 肉眼驗 `/products`。

## 8. 我這邊已驗過、沒問題的（不用重查）
- RPC 邏輯正確性、S4 卡片年份 formatter、fitments 白名單無洩漏、migration 依賴順序（`183000`→`193000`）、view 15 欄 `security_invoker`、anon EXECUTE/SELECT 權限、real-data 年份正確 — 全綠（code-reviewer + Fable 雙審 PASS）。**唯一問題就是上面這個 no-vehicle generic-plan 逾時。**
