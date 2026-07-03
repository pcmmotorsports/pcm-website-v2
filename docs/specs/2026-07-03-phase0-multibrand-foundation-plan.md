# Phase 0 · 多供應商上架共用地基 Plan(GB Racing + Bonamici 試點)

> 狀態:**Sean 已批(2026-07-03,Q1=A / Q2=A / Q3=A / Q4=B)。v2 已折入關卡1 對抗審查 4 must-fix。**
> 🔴 **Q4=B 影響**:RPM 描述改繁中 = `syncDescription(rpm)=true` + **一次性 RPM re-sync**(改 ~1,117 線上 RPM 頁、對外可見、Phase 1 執行、鐵則 12 產 Packet)。
> 🔵 **Sean 另報 2 個現網 bug(2026-07-03,待排序、非本 plan 範圍)**:#5 部分 RPM 商品圖是舊假圖、點進去商品錯誤(疑資料/連結);#6 商品頁按「上一頁」遺失列表頁碼/排序/每頁筆數(前台瀏覽狀態未保留)。investigating root cause。
> 真權威:memory `project_quote-full-import-11-suppliers` + handoff `docs/handoff/2026-07-03-multibrand-gb-bonamici-kickoff-handoff.md` + 本 plan。
> 決策脈絡:Sean 2026-07-03 拍 Q1=C 試點 / Q2=B MVP 去碳 / Q3 接翻譯 / Q4=B gbracing+bonamici / Q5=B 逐品牌到位 / confirm1=A 接中文描述 / confirm2=B Claude 先出 N°02 草稿。
> 本 plan 只涵蓋 **Phase 0(共用地基)**;Phase 1/2/3 只定序、不在本次執行範圍。

---

## 0. 一句話

把「只會同步 RPM 一家」的匯入管線與「寫死碳纖維」的商品頁,改造成**多供應商通用地基**(參數化管線 + 16 分類 seed + 前台去碳 + 品牌切換骨架),讓 GB Racing / Bonamici 之後能安全上架——**Phase 0 全程不讓任何新商品對客人可見**(只做地基 + 乾跑驗證,真正寫入 prod 留 Phase 1、受 Q5=B「N°02 到位才上線」節制)。

---

## 1. 背景與目標(為什麼)

- **現況**:商城 DB `bmpnplmnldofgaohnaok` 只有 RPM(1,117 群 / 9,282 變體,單一品牌 `rpm-carbon`,`categories` 只 1 筆「碳纖維部品」)。
- **來源已備好**:報價單庫 view `storefront_catalog_v` 已含全 11 家 ~17,508 群、繁中 ~99% 覆蓋、零經銷價。「只有 RPM」= 同步腳本雙重寫死,非來源限制。
- **目標**:讓試點兩家(gbracing 942 群、bonamici 1,252 群)透過同一條參數化管線安全上架、商品頁不再顯示錯誤碳纖維/泰國字樣。

---

## 2. 現況查證(first-hand,2026-07-03,唯讀 MCP + workflow 偵察,附來源)

### 2.1 管線寫死點(13 處,已逐一 file:line 定位)
鏈:`rpm-import.ts`(orchestrator + host allow-list)→ `rpm-fetch.ts`(`.eq('supplier_slug','rpm')`)→ `rpm-preflight.ts`(5% 縮水 abort)→ 依 main_sku 分組 → `rpm-transform.ts` → `rpm-delta.ts`(價差閘 + pv_spec_unique preflight)→ `--confirm-write` → `rpm-load.ts`(composite-key upsert)→ `rpm-reconcile.ts`(缺席即軟下架)。

| # | 檔案:行 | 寫死內容 | 處置 |
|---|---|---|---|
| 1-2 | `rpm-fetch.ts:21,73` | `SUPPLIER='rpm'` + `.eq('supplier_slug',…)` | 參數化 |
| 3 | `rpm-transform.ts:56` | subtitle 硬加 `· 碳纖維` | 改由 category 衍生 |
| 4 | `rpm-transform.ts:146` | handle 前綴 `rpm-` | 改 `${prefix}-`(見 2.3 註) |
| 5 | `rpm-import.ts:55` | `BRAND_SLUG='rpm-carbon'` | 改 supplier→brand 對照 |
| 6 | `rpm-import.ts:56` | `CATEGORY_RAW_PATH='碳纖維部品'`(整批固定) | **改逐群由 major_category_zh 解析**(`transformGroup` 已收 categoryId 參數,只需 caller 逐群解析) |
| 7-8 | `rpm-delta.ts:17,177` | `SUPPLIER='rpm'` scope | 參數化 |
| 9-11 | `rpm-reconcile.ts:21,43,103` | `SUPPLIER='rpm'`(**:103 軟下架唯一護欄**) | 參數化 |
| 12 | `rpm-preflight.ts:24` | `checkFetchIntegrity` 未傳 supplier | 參數化 |
| 13 | `rpm-transform.ts:188` | `variantSortKey` 假設 `{weave,finish,special}` | 非 crash、bonamici 退化成 sku-only(純顯示序、無資料錯);fallback 已足 |
| — | `.github/workflows/rpm-sync.yml:62` | 排程只跑 rpm | **Phase 0 不動排程**(§3) |

### 2.2 schema 已「多供應商就緒」——只有腳本寫死(關鍵好消息)
- `products` 唯一鍵 = **`(supplier_slug, external_id)`**;`product_variants` = **`(supplier_slug, sku)`**;另 **`products.handle` 全域唯一**、`product_variants` 另有 **`pv_spec_unique(product_id, spec)`**。兩表皆有 `supplier_slug` 欄 + 索引 + `delisted_at`。
- 加供應商 **免動 products/variants schema**(既有欄位夠用)。
- `products_public` / `product_variants_public` view **物理排除** `price_store`/`price_by_tier`/`metadata` → 經銷價防護不因加供應商削弱(已驗 `rpm-transform.ts` price_store 恆 null、price_by_tier.store=零售 placeholder)。

### 2.3 供應商 slug ≠ 網站 brand slug(非 identity,必建對照)
- `brands` 表已 seed **21 家**(非 11),試點兩家都在:`GB RACING`→slug **`gb-racing`**、`BONAMICI RACING`→`bonamici`。→ **不需新增 brand 列**。
- 🔴 來源 `supplier_slug` 與 `brands.slug` 不一致,必明確對照:`gbracing`→`gb-racing` / `cncracing`→`cnc-racing` / `eazigrip`→`eazi-grip` / `rpm`→`rpm-carbon`;其餘(bonamici/lightech/evotech/samco/motogadget/front3d/materya)identity。
- (N1)handle 前綴用「供應商命名空間」;採 `supplier_slug`(如 `gbracing-`)或 brand slug(`gb-racing-`)由 `supplier-config` 明訂並註記(客人看到的是品牌頁 slug,handle 只是 SEO key)。

### 2.4 來源 `brand` 欄是「車輛廠牌」不是產品品牌
- `storefront_catalog_v.brand` = Ducati/BMW/Yamaha…(**車種**,fitment 用),**不是**產品製造商。產品品牌一律由 `supplier_slug` 對照,**絕不**拿 `brand` 欄當 brand_id(`rpm-transform.ts:162` 註解已明載)。

### 2.5 spec 形狀逐家不同(去碳核心)
- rpm=`{weave,finish,(special)}`、bonamici=`{color,material}`、gbracing=**`null`**。前台 `ProductInfo` DIM_LABEL / `ProductTabs` 規格表寫死 weave/finish → 套非 RPM 會錯或空。

### 2.6 前台碳纖維寫死點(11 處)+ 無品牌切換機制 + 🔴 守門字串陷阱(F1)
組裝層 = `ProductPage.tsx`;多數區塊 prop-less 無條件渲染。**全 repo 無 `product.brand` 條件渲染機制**(#212 方向3 需從零建)。
- 🔴 **F1 must-fix**:UI 的 `product.brand` = **顯示名**(`products.ts:107` `brand: product.brand.name` → 值 `'RPM CARBON'`),**不是** slug。守門若寫 `brand==='rpm-carbon'` 會**恆 false → RPM 頁碳纖維段全消失 = live 回歸**。**正解**:`toUIProduct` 加 `brandSlug ← product.brand.slug` 傳 UI、守門一律用 `brandSlug==='rpm-carbon'`;prop-less 元件(`ProductServices`/`ProductHighlights`/`ProductSwatchWall`,`ProductPage.tsx:287,296-297`)由 ProductPage 傳 brand prop。

| 檔案:行 | 問題 |
|---|---|
| `ProductServices.tsx:33` | 「泰國原廠 / RPM Carbon 授權代理」|
| `ProductHighlights.tsx:16` | 整個 N°01「為什麼選 RPM Carbon / 來自泰國」|
| `ProductSwatchWall.tsx:44` | N°02 紋路牆(rpm-swatches) |
| `ProductTabs.tsx:121,130,161,165,169,174,192` | 「真碳纖維 / 紋路 / 表面 / **產地:泰國**(:174 註解自承會錯)/ 特殊樣式」|
| `ProductSpotlight.tsx` | hasSpotlight 目前只 3 legacy mock 觸發(潛伏地雷) |
| `data/rpm-policies.ts:46` | 保固「紋路明顯錯位」被 3 處共用(低優先) |

### 2.7 分類:1 → 16(來源清單 first-hand)
- 網站 `categories` 只 1 筆「碳纖維部品」(RPM 專屬、不在 16 內)。
- 16 大類(`major_category_zh`,已查證含群數):操控部品 7290 / 周邊配件 3462 / 車殼外觀 2723 / 引擎部品 1732 / 騎士好物 575 / 後視鏡 438 / 電子系統 246 / 車架 197 / 煞車系統 187 / 燈具方向燈 173 / 駐車架 160 / 傳動齒比 128 / 服飾配備 93 / 四輪 ATV/UTV 46 / 排氣系統 28 / 行李箱包 26。(97 子類暫不 seed,見 Q3。)

### 2.8 合約 & 價格(避免踩 v1 舊坑)
- 合約真權威 `STOREFRONT_CATALOG_CONTRACT.md` 在**報價單 repo**、現行 **v2**:`price_retail` = 原價/一般價。v1 曾誤洩經銷價,v2 已修。管線只信 v2 語意(`rpm-transform.ts:137` 已 `roundTwd(price_retail)→price_general`、整數、零 float)。
- 來源 view **無經銷價欄**;price_store 對 RPM 恆 null;加供應商沿用此行為。

### 2.9 描述:接線 vs 治理(劃清界線,對齊 confirm1=A + F2)
- **接線(Phase 0 做)**:把 view.description 這一欄「搬進」products.description(機械搬欄位)。
- **內容治理(Phase 0 不做,歸報價單 repo PRD v2 / #209)**:翻譯品質、brand_story workstream 等「欄位內容怎麼寫」——parked。
- 🔴 **F2 must-fix(RPM 保護縫)**:現行 `rpm-transform.ts:93,149` **刻意不寫 description**(upsert 省欄→現有 RPM 描述原地保留)。但註解「view 對 RPM 全空」**已過時**——MCP 查證 RPM 來源描述 **100% 有值且為繁中**(現況網站存的是英文 HTML)。若 P0-A 對所有供應商一律寫 description,**每夜 cron 會把 ~1,117 RPM 頁英文描述覆寫成繁中**(對外可見改動)。**正解**:`supplier-config` 逐家 `syncDescription` 旗標——**RPM=false(維持現況、byte-safe)**、試點=true(來源 null→省欄不寫 null);Phase 0 是否順便切 RPM 為繁中 = 決策 Q4。

### 2.10 試點資料品質(first-hand 抽查)
- gbracing 942 群=942 sku(單變體、無 spec);bonamici 1,252 群/1,710 sku(色彩變體)。
- 描述/中文品名 ~99.9% 覆蓋(各僅 1 缺);major_category_zh 100% 有值。
- 無 fitment(通用件):gbracing ~186 群 / bonamici ~439 群 → 無車款 pill(車種鐵律、null 已優雅處理)。
- 缺圖:gbracing 46 群 → placeholder。
- 🔴 **C3 spec 碰撞(真寫入 blocker,非只 dry-run)**:bonamici **3 群**(PU_001 8→1 / CHAD18 5→1 / PSD2 2→1)群內多變體 spec `{color,material}` 全同(真正區分軸是尺寸、不在 spec)→ 撞 `pv_spec_unique(product_id,spec)`,`rpm-import.ts:150-155` preflight **在 dry-run 也 throw**。→ P0-A 需偵測 + 報告碰撞群;dry-run 改列報告不 throw;Phase 1 處置(見 §5、決策留該時)。gbracing 單變體無此問題。
- fitment_parsed 已乾淨結構化 → #211 對試點非必要(留放量)。

---

## 3. 範圍邊界

**Phase 0 做**:①管線參數化(scripts)②16 分類 seed(migration)③前台去碳 + 品牌切換骨架(Q2=B)④試點乾跑驗證(唯讀零寫入)。

**Phase 0 不做**:❌ 不寫 gbracing/bonamici 進 prod DB(留 Phase 1、受 Q5=B 節制)❌ 不動每日排程 `rpm-sync.yml`(維持 rpm-only)❌ 不動 products/variants schema ❌ 不動 RPM 渲染(前台去碳以 `brandSlug==='rpm-carbon'` 守門、RPM 路徑 byte 不變)❌ 不做描述內容治理 / brand_story ❌ 不做 N°02 bespoke 元件內容(Phase 2)。

---

## 4. Phase 0 切片(每片獨立三綠 + code-reviewer,鐵則 4/8/11;順序 A→B→C→D)

### P0-A · 管線參數化(scripts,純程式、乾跑、零 DB 寫入)
- 新 `scripts/supplier-config.ts`:每家 `{ brandSlug, handlePrefix, syncDescription, categoryStrategy }`(§2.3/§2.9)。
- `rpm-fetch/delta/reconcile/preflight`:寫死 `SUPPLIER` → **呼叫端一路傳入 `supplierSlug`**(§2.1 #1-2,7-12);`VIEW_COLS` 補 `description / category_zh / major_category_zh`。
- `rpm-transform/import`:brand 由對照解析(#5)、**category 逐群由 major_category_zh 解析**(#6,`transformGroup` 已收 categoryId)、handle `${prefix}-`(#4)、subtitle 由 category 衍生不硬寫碳纖維(#3)、variantSortKey 通用 fallback(#13)、**description 依 `syncDescription` 決定寫不寫(F2)**。
- 🔴 **F4 handle preflight**:批次前檢查 handle charset 白名單(禁空白/slash 等 URL 危險字元)+ 全域唯一性(對齊 pv_spec preflight 前例),撞鍵/髒字元 → abort 列清單,不進 upsert。
- 🔴 **F3 護欄**:試點期 CLI **禁同時帶 `--allow-fetch-shrink` + `--allow-large-delist`**;abort 一律先當 scope bug 查。
- **驗收(含回歸與負測)**:
  - `--supplier=gbracing|bonamici` dry-run 乾跑成功、報表 brand/category/handle/subtitle/description 正確;
  - 🔴 `--supplier=rpm` dry-run 與現況 **byte 等價**(rpm 樣本 JSON **無 description 欄**、subtitle 仍碳纖維、brand=rpm-carbon)——F2/RPM 零回歸的字面驗收;
  - 🔴 **負測**:故意錯配 supplier(fetch=gbracing 但 reconcile scope 傳 rpm)dry-run → 報告顯示 ~100% missing(證明錯 scope 被 gate 攔、非靜默誤刪);
  - handle preflight + spec 碰撞偵測(§2.10 C3)產出清單;三綠。

### P0-B · 16 分類 seed(1 migration,需 Sean db push)
- 新 migration:INSERT 16 大類(§2.7,flat、parent NULL、raw_path=major_category_zh、segments=[…]、sort_order 依群數)+ down-migration(DELETE 該 16 列)。
- RPM「碳纖維部品」**不動**(決策 Q2=A);新供應商映射 16 大類。**零可見變化**(尚無商品指向 + 前台分類樹尚未接真、見 §5 C1)。
- **驗收**:MCP 交易模擬(BEGIN→seed→查→ROLLBACK)零留痕 + Sean db push 後唯讀驗 16 列在。

### P0-C · 前台去碳 + 品牌切換骨架(共用元件,Q2=B)
- **F1 正解**:`toUIProduct` 加 `brandSlug`;品牌切換以 `brandSlug==='rpm-carbon'` 守門(`ProductServices/Highlights/SwatchWall/ProductTabs` 碳纖維段 + `ProductSpotlight` 第二道守門)→ RPM 維持原文案;**非 RPM = 空白**(Q2=B)或品牌中性 generic(不猜產地/材質)。prop-less 元件由 ProductPage 傳 brand prop。
- `ProductInfo` DIM_LABEL / `ProductTabs` 規格表 → 資料驅動:依 variant spec 實際 key(weave/finish/color/material…)配 label map 渲染、無值該列不渲染。
- **動共用元件 → 跑完整 vitest**;RPM 頁 byte 不變(Sean 肉眼驗 RPM 頁無變化);補/更新 smoke test。三綠。

### P0-D · 試點乾跑驗證(唯讀零寫入)
- gbracing + bonamici dry-run 報告:brand/category 映射、中文描述接上、無碳纖維字樣、價格 round、變體/色彩、缺圖/無 fitment 統計、handle preflight 結果、**spec 碰撞群清單(C3)**。交 Sean。100% 唯讀。

---

## 5. Phase 1/2/3 後續(定序;不在本 plan 執行範圍)

```
Phase 0 地基(本 plan、零可見變化)  ──▶  P0-D 乾跑驗證通過
Phase 2 N°02(Sean 精修草稿→bespoke 元件,掛 P0-C 骨架)── 可與 Phase 0 並行 ── Q5=B:兩家 N°02 到位
Phase 1 試點寫入 prod(confirm-write gbracing→bonamici 分階段)
        + 🔴 前台目錄接線(#205 featured/catalog 解除「碳纖維部品」釘死 + #220c 品牌側欄真資料化)
        + spec 碰撞 3 群處置(C3)+ 加入每日排程 matrix  ──▶  Sean 肉眼驗收 ──▶ 上線可見
Phase 3 放量其餘 8-9 家 + 每日同步全開(#211 正規化在此評估)
```
- 🔴 **C1 校正**:商城只有一個 prod DB、shop.pcmmotorsports.com 已 LIVE,但 **寫入 ≠ 立刻瀏覽可見**:前台 featured/目錄仍釘死「碳纖維部品」(`products.ts:188-191,224-227`)、/products 側欄用靜態分類(`ProductsPage.tsx`)→ 試點商品映射新分類後**不會**出現在首頁/列表,只能直連 handle URL。故「瀏覽可見」需 Phase 1 補**前台目錄/品牌接線(#205/#220c)**——這也是 Q1 的真正開關。
- **C2 依賴註記**:合約 §10「網站 mirror source `delisted_at`、不自行由缺席判定」是**未來式**(來源 `delisted_at` 欄尚未存在);現行 reconcile「缺席即軟下架」與 v2 現況一致、Phase 0 保留合理。**待來源 delisted_at + N=3 去抖落地時,reconcile 必改鏡射、不得疊第二層去抖**。

---

## 6. 關鍵正確性不變式(Phase 1 執行必守,Phase 0 先在設計釘死)

1. **軟下架隔離(最高風險)**:每家跑「自己完整一輪」、`supplierSlug` 一路一致貫穿 fetch→delta→reconcile→preflight;reconcile 絕不跨供應商合併。護欄:`rpm-reconcile.ts:103` scope + >10% 下架比 hard-abort。
2. **淨新供應商首載天然免疫**:試點兩家網站現有 0 筆 → reconcile「現有−來源」=0 下架 → 首載不可能誤刪 RPM(關卡1 已獨立驗證邏輯成立)。
3. **RPM 零回歸**:`--supplier=rpm` 輸出 byte 等價(含 description 不寫);前台 RPM 路徑 byte 不變(brandSlug 守門)。
4. **經銷價零外洩**:全走 public view;來源無經銷價欄;不觸 price_store 通道。
5. 🔴 **(F3)試點期禁帶兩個 `--allow-*` bypass 旗標**;連續 abort 先當 scope bug 查、不硬推。
6. 🔴 **(F4)handle 進 upsert 前必過 preflight**(charset 白名單 + 全域唯一),不得中途撞 `products_handle_key` 造成部分寫入髒中間態。

---

## 7. 影響面 & Rollback

| 切片 | 影響面 | Rollback |
|---|---|---|
| P0-A | scripts(乾跑、零 DB 寫入) | git revert;無 prod 效果 |
| P0-B | +16 categories 列 | down-migration DELETE 16 列(無商品指向、安全) |
| P0-C | 共用商品頁元件 | git revert;RPM 路徑 byte 不變、full vitest 守門 |
| P0-D | 唯讀 | 無 |
| (Phase 1) | confirm-write 進 prod | 按 supplier_slug 精準刪除 / delisted_at(supplier-scoped) |

- 鐵則 8 觸發:動 schema(categories seed)+ 共用元件 + 跨 3+ 檔。鐵則 12:P0-B + Phase 1 收尾產 Codex Review Packet。

---

## 8. 待 Sean 決策(批次、multi-select)

```
Q1(上線可見時機;真正開關 = 前台目錄接線 #205/#220c,見 §5 C1)
  A. 嚴格 Q5=B:GB/Bonamici 只在各自 N°02 特色區做好、才寫入 + 才接線可見(推薦)
  B. 先寫入 + 接線「素面」版(去碳安全、無 N°02 特色區),N°02 之後補
  C. 先寫入但不接線(只直連 URL 不進列表),N°02 好了才接線可見
A: A|B|C

Q2(RPM 分類處置,seed 16 大類後)
  A. RPM 維持「碳纖維部品」不動(不擾動線上;新供應商用 16 大類)(推薦)
  B. RPM 一併改真實大類(統一分類,但改變線上 RPM 分類顯示 + 重跑 RPM 同步)
A: A|B

Q3(試點分類深度)
  A. 只 seed 16 大類(flat),商品依 major_category_zh 歸類,97 子類留放量(推薦 MVP)
  B. 現在 seed 16 大類 + 97 子類(階層)
A: A|B

Q4(RPM 描述;來源已是繁中、線上現存英文 HTML — 見 §2.9 F2)
  A. Phase 0 不動 RPM 描述(維持現況英文、byte-safe),只試點接繁中(推薦、不擾動 RPM)
  B. 順便把 RPM 也切繁中描述(合 confirm1=A 精神、對台灣客更好,但改 ~1,117 個線上 RPM 頁 + 重跑 RPM 同步)
A: A|B
```
(小事我直接照推薦做:同步腳本檔名維持 `rpm-*` 只改內部、#211 正規化留放量、handle 前綴命名於 supplier-config 明訂。)

---

## 9. 驗收條件(Phase 0 整體)

- ☐ P0-A:`--supplier=gbracing|bonamici` dry-run 乾跑 + 映射正確;`--supplier=rpm` byte 回歸(無 description 欄);負測錯 scope 顯 100% missing;handle preflight + spec 碰撞偵測有輸出;三綠。
- ☐ P0-B:16 分類 seed 落地(MCP 零留痕 + Sean db push 後唯讀驗);RPM 分類未受擾動。
- ☐ P0-C:非 RPM 商品頁零碳纖維字樣;**RPM 頁 byte 不變(brandSlug 守門)**;完整 vitest 綠;smoke test 補齊。
- ☐ P0-D:gbracing + bonamici 乾跑驗證報告交 Sean、100% 唯讀。
- ☐ 全程金流 flag 全 false;零 prod 商品寫入;經銷價零外洩。
- ☐ 每片 code-reviewer 必跑;P0-B/Phase 1 命中鐵則 12 產 Packet。

---

## 10. 關卡1 對抗審查 log(2026-07-03,adversarial-reviewer / Fable 5 跨模型,鐵則 8 SOP ③)

初版 verdict = **FAIL(4 must-fix)**;全數 **Claude first-hand 查證屬實後折入**,reviewer 明示折入後轉 PASS-with-comments。
- **F1**(守門字串)→ 已驗 `products.ts:107` brand=顯示名 → 改 brandSlug 傳線(§2.6 / P0-C)。
- **F2**(description 覆寫 RPM)→ 已驗 RPM 來源描述現 100% 繁中、註解過時 → per-supplier `syncDescription` + RPM 回歸字面(§2.9 / P0-A)+ Q4。
- **F3**(bypass 旗標打穿)→ 不變式 5 + 負測(§6 / P0-A)。
- **F4**(handle 無 preflight)→ handle preflight + 不變式 6(§4 / §6)。
- **C1**(寫入≠可見)→ §5 補前台目錄接線 #205/#220c 為 Phase 1 切片、校正可見性、重塑 Q1。
- **C2**(合約 delisted_at)→ §5 依賴註記。**C3**(bonamici 3 群 spec 碰撞)→ 已驗屬實、§2.10 + P0-A/D 偵測報告 + Phase 1 處置。
- Nits(rpm-policies 行號 :40→:46、handle 前綴拼法、variantSortKey 退化)已折入 §2。
- 誠實邊界:F1/F2 若照初版字面實作會造成 live 回歸——已在動任何 code 前攔下。
```
