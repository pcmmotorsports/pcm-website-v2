# 供應商商品上架顧客站 (storefront) — 通用 runbook + preflight 清單

> **為什麼有這份**:2026-07-24 一次上三家(K-SPEED / Extreme / Lightech)踩到一堆「上架單沒寫、
> 每次重新發現」的坑 —— pv_spec 撞鍵、v2 分類全落未分類、spec 空色選單、腳踏中文名翻錯、
> brand slug 拼法分岔。akrapovic 首灌 runbook 只顧「寫入那一步」,**上游前置**散落各 playbook。
> 這份把「把某供應商商品灌上 shop.pcmmotorsports.com」的**完整流程 + forget-proof preflight**收成單一入口。
>
> **邊界**:源頭資料清洗(fetcher / spec / 分類 / 圖 / 商品名)在**報價單庫 `dllwkkfanaebrsuyuedy` + 報價單 repo**;
> 匯入寫顧客站在**網站庫 `bmpnplmnldofgaohnaok` + pcm-website-v2 repo**。一次任務要講清楚誰跑最後匯入那步。
> 報價單側 19 個註冊點另見報價單 `docs/NEW_SUPPLIER_ONBOARDING.md`;本份專講「灌上顧客站」。
>
> **維護**:每次上架新供應商、或發現新坑,回頭更新這份 + 底部「本批實例」。最近實查:2026-07-24。

---

## 0. 一句話流程

```
源頭資料就緒(§1 preflight 全綠)→ 網站 supplier-config 登記(§2)→ 乾跑五關全綠(§3)
→ Sean 批 → writeAllowed=true + 監控式首灌(§4)→ 寫後驗證(§5)→ 部署 main(§6)
```

**任一 preflight 沒過就別登記別乾跑** —— 乾跑會在該關 abort,白跑。先把源頭修好。

---

## 1. ★ Preflight 清單(源頭資料就緒;每列漏掉 = 乾跑 abort 或上架後出包)

> 全部對**報價單庫 `dllwkkfanaebrsuyuedy` 的 `storefront_catalog_v`**(view 混多供應商、`WHERE supplier_slug='<slug>'`)。
> ⚠️ 來源 `supplier_slug`(如 `kspeed`)可能 ≠ 網站 `brands.slug`(如 `k-speed`),兩邊都要對。

| # | 檢查 | 怎麼查(MCP execute_sql,除非註明) | 期望 | 沒過怎麼修 |
|---|---|---|---|---|
| 1 | **品牌列存在**(網站庫) | `SELECT slug FROM brands WHERE slug='<brandSlug>'` | 1 列 | 缺 → seed migration `INSERT INTO brands ... ON CONFLICT (slug) DO NOTHING`,MCP `apply_migration` 或 Sean db push。**先確定 brandSlug 拼法**(§2 註) |
| 2 | **價格四價齊**(源頭) | `COUNT(*) FILTER (WHERE price_retail IS NULL OR price_retail=0)` | 0 | 有 pricing_rules 的家跑完 fetcher 必接 `scripts/recompute_supplier.py <slug>`(重跑 fetcher 會清空四價,見 [[feedback_fetcher_rerun_wipes_computed_prices]]) |
| 3 | **圖片協定 = https** | `COUNT(*) FILTER (WHERE images::text ILIKE '%http://%')` | 0 | http 外部網域 = mixed content 破圖 → 源頭轉存 Cloudflare R2、DB 存乾淨 https(Lightech 前例);新 host 另加網站 image-hosts 白名單 + middleware |
| 3 | **變體規格軸不撞鍵(pv_spec)** | 報價單 repo:`uv run python scripts/variant_contract_scan.py`(看該家 `違規=0`) | `違規=0`(incomplete_spec / mergeable_duplicate 皆 0) | ①同群多變體 spec 全空/含 null → 源頭 fetcher 補「區分變體的軸」進 `raw_jsonb["spec"]`(ebc 材質軸 / Extreme 打檔·版本·顏色·快排;`{"英文key":"中文值"}`,fail-loud 不靜默 null)。②只有一軸卻含 null 值(如 `{"color":null}`)→ fetcher 改**條件式**寫該鍵(值空就不寫)。**products.spec 是 `raw_jsonb->'spec'` 的 GENERATED 欄、view 直投,改完 raw_jsonb re-sync 即生效,免 refresh** |
| 4 | **v2 分類回填**(否則全落未分類) | `COUNT(*) FILTER (WHERE major_category_v2_zh IS NOT NULL)` = 總數 | = 總數 | 新供應商 v2 恆 NULL → ①先有 `category_taxonomy_map` seed(該家 `products.category` → v2 大類·子類 pair;akrapovic/extreme 前例)②報價單 repo 跑 `uv run python scripts/taxonomy_v2_recompute.py`(先 dry-run 看「搬動既有分類 0 列」確認只補空、不動別家)`--apply`。**這是純分類寫入、不碰價格** |
| 5 | **商品名定案** | 抽查 `product_name / product_name_zh` | 不帶車款(akrapovic 拍板);變體描述若入名須與英文原文一致 | 中文名翻錯(如英文 reverse 卻寫正打)→ 由官方英文重生、patch 源頭 fixture + DB。用 targeted SQL 改 `product_name_zh`(勿重跑 fetcher = 洗四價) |
| 6 | **群數/變體指紋** | `COUNT(DISTINCT main_sku)` 群、`COUNT(*)` 變體 | 記下數字 = §3/§4 的 `--expect-groups` | — |

> **改源頭資料的鐵律**:能 targeted SQL(只補 NULL / 移除 null 鍵)就別重跑整支 fetcher —— 重跑 = delete-then-upsert
> 會清空台幣四價 + 換 row id(見 [[feedback_fetcher_rerun_wipes_computed_prices]])。同時把修法寫回 fetcher code(耐下次排程重抓)。

---

## 2. 網站側登記 `scripts/supplier-config.ts`

在 `SUPPLIER_CONFIGS` 加一組(照 akrapovic / 本批三家的格式):

- `supplierSlug`:來源 view 的 `supplier_slug`(fetch scope)。
- `brandSlug`:**網站 `brands.slug`,🔴 可能 ≠ supplierSlug**(kspeed→`k-speed`、rpm→`rpm-carbon`、eazigrip→`eazi-grip`)。MCP 實查 brands 表、勿憑記憶。
- `handlePrefix`:handle = `${prefix}-${mainSku.toLowerCase()}`。
- `syncDescription`:來源有繁中描述就 true。
- `syncInstallResources`:有 pdf/video 來源才 true(靜態無附件 = false)。
- `categoryStrategy`:多數 `{ kind: 'per-group' }`。
- `variantImages`:多變體家 = `'per-variant'`。
- `writeAllowed`:**先 `false`**(fail-closed、過夜零寫入),乾跑全綠 + Sean 批首灌後才翻 `true`。

---

## 3. 乾跑五關(讀取無寫入)

```bash
cd /Users/sean_1/pcm-website-v2
pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=<slug>
```

任一不對就停、回 §1 修源頭:

| 關 | 期望輸出 |
|---|---|
| 群數 | `分群 N 群`(= §1-6 指紋) |
| 分類對上 | `已對上: N 群 / 未對上: 0 群` + `null-v2 0 群→未分類`(沒過 = §1-4 沒回填) |
| handle preflight | `✅ N 群 handle 全部合法且唯一` |
| pv_spec preflight | `✅ pv_spec_unique preflight 撞鍵 0`(沒過 = §1-3 沒建軸) |
| 價格 delta | `🔴異常 0 / ⚠️離群 0` |

---

## 4. 監控式首灌(全程盯著、不交排程)

Sean 對「這次首灌」明確點頭後,`writeAllowed` 翻 `true`、commit,然後:

```bash
cd /Users/sean_1/pcm-website-v2
pnpm exec tsx scripts/rpm-import.ts --confirm-write --supplier=<slug> --expect-groups=N 2>&1 | tee /tmp/<slug>-first-load.log
```

- 🔴 不帶任何 `--allow-*` bypass;撞閘 = 真有事。
- 看到 `[rpm-import] WRITE 完成:N 商品 / M 變體` 才算完。
- 中途斷 / upsert 報錯 → 走 akrapovic runbook 的補償程序(`docs/runbooks/2026-07-19-akrapovic-first-load-runbook.md` §4:先關 writeAllowed → 軟下架 → 最後才硬刪)。

---

## 5. 寫後驗證(網站庫)

```sql
SELECT b.slug, COUNT(DISTINCT p.id) products, COUNT(v.id) variants,
  COUNT(DISTINCT p.id) FILTER (WHERE p.category_id=(SELECT id FROM categories WHERE raw_path='未分類')) uncategorized
FROM brands b JOIN products p ON p.brand_id=b.id
LEFT JOIN product_variants v ON v.product_id=p.id
WHERE b.slug='<brandSlug>' GROUP BY b.slug;
```

期望:products/variants = 指紋、**uncategorized = 0**。

---

## 6. 部署(讓程式端變更生效)

商品是**資料寫入 → 即時 live**(客人立刻看得到商品/價/圖)。但若這次動了**網站程式**(如變體維標籤
`ProductInfo.tsx`、image-hosts 白名單),要**部署**才生效:

- 顧客站 = Vercel project `pcm-website-v2`,**production 從 `main` 部署**(domain `shop.pcmmotorsports.com`)。
- 開發在 `dev`;上線 = `git push origin dev` 後 `git push origin dev:main`(fast-forward)→ 觸發 production 部署。
- 🔴 push main = 直接上線(見 [[feedback_push_to_main_means_deploy]]);要 Sean 明確批。部署後 MCP `get_deployment` 確認 `readyState: READY`。
- **車種篩選下拉**有 1 小時 `unstable_cache`,新車款最多 1 小時才進下拉;商品頁/列表即時(見 [[reference_quote_filter_dropdown_1h_cache]])。

---

## 7. 本批實例(2026-07-24,三家各踩的坑)

| 家 | brandSlug | 量 | 這家卡在哪 |
|---|---|---|---|
| **K-SPEED** | `k-speed`(≠ `kspeed`) | 960 群/989 變體 | 只缺品牌列(db push);資料本乾淨、v2 齊、圖 GCS https。圖是 `[{"url":...}]` 物件陣列,匯入端自動正規化為字串陣列(非坑) |
| **Extreme** | `extreme` | 664 群/712 變體 | ①17 群腳踏變體 spec 全空 → 補打檔/版本/顏色/快排四軸(撞鍵 48→0)②v2 全 NULL → taxonomy_v2_recompute 回填 712(對照表本就在)③5 筆腳踏中文名英中錯置 → 由英文重生。靜態 fixture、無 pdf/video |
| **Lightech** | `lightech` | 4566 群/8788 變體 | ①12k 圖 http → 已轉 R2 ②spec 無條件寫 `{"color":null}` → 39 群 incomplete_spec + 空色選單 → fetcher 改條件式 + 清庫存 3054 筆 null color |

> 共通教訓:**「上架三家」= 三種不同的病**。每家先跑 §1 preflight 六關把病照出來,別假設「別家能上這家就能上」。
