# SESSION HANDOFF — 2026-07-03 報價單完整匯入偵察 + 多品牌上架規劃 + GB/Bonamici N°02 設計草稿(交接:新 session 開始上架)

> 一句話:**Sean 要「把報價單完整匯入」= 把報價單庫 11 供應商全型錄上商城(現況只有 RPM)。本 session 完成偵察 + #212 多品牌進度規劃(Q1-Q5 全拍)+ GB/Bonamici N°02 品牌特色區設計草稿(Artifact)+ gallery 箭頭 CSS 修(commit `b75f6bc` 未推)。** 下一 session 開始**實際上架 GB + Bonamici**(Q4=B 試點),但這是鐵則 8 多片工程——**先寫 Phase 0 共用地基正式 plan 給 Sean 批,不要直接動 DB/pipeline**。
> 環境:repo `pcm-website-v2` · branch `dev` · HEAD=`b75f6bc`(**1 commit 未 push**)· 工作樹 clean · 商城庫 `bmpnplmnldofgaohnaok` · 報價單庫 `dllwkkfanaebrsuyuedy`(僅唯讀查過)· 金流 flag(`TAPPAY_3DS_ENABLED`/`ANOMALY_ALERT_ENABLED`/`CRON_SWEEPER_ENABLED`)全程 false 未動 · 未上 prod(production=main)。
> 🔴 **接手第一件事**:①先讀 memory `project_quote-full-import-11-suppliers`(決策+事實全記)②寫 Phase 0 plan 提給 Sean(鐵則 8)③`b75f6bc` 未 push,等 Sean 手動推。
> 接手先讀:memory `project_quote-full-import-11-suppliers` + brief `docs/specs/2026-06-04-product-page-template-design.md`(#212 方向3)+ backlog #212(`docs/phase-1-backlog.md:5528`)+ 本 handoff。

## 1. Sean 拍板(2026-07-03、全數已定)

| 題 | 拍板 | 含意 |
|---|---|---|
| Q1 節奏 | **C** | 先試點跑通多供應商管線再放量 |
| Q2 前台去 RPM 化 | **B** | MVP 先擋錯誤碳纖維字樣、非 RPM 家規格通用兜底(非全資料驅動) |
| Q3 翻譯 | **接進來** | 中文品名/描述/分類接進網站(不是接受空白) |
| Q4 試點名單 | **B** | **gbracing + bonamici** 兩家 |
| Q5 上線節奏 | **B** | **逐品牌到位**——每家等它的 N°02 特色區也做好才上線(∴ Sean 的 OD/設計工在關鍵路徑) |
| confirm1 | **A** | 接回中文描述 = **推翻舊「描述停同步」拍板** |
| confirm2 | **B** | Claude 先做 N°02 草稿、Sean 之後改(Sean 授權 Claude 依 RPM 設計元素 + web 研究出草稿,此任務**覆蓋** memory `feedback_sean-owns-visual-design-going-forward`) |

## 2. 偵察查證事實(唯讀 MCP + repo,已寫進 memory,此處摘要)

- **現況**:網站庫只有 RPM(上架 1,117 群 / 軟下架 291 / 9,282 變體、單一品牌 `rpm-carbon`、`categories` 表只 1 筆)。每日 GitHub Actions `.github/workflows/rpm-sync.yml`(台 03:00)健康運轉、RPM 已 100% 同步(1,117 = 來源 distinct main_sku)。
- **來源**:報價單庫 view `storefront_catalog_v`(48,953 列=SKU 級、已含全 11 家、零經銷價、`security_invoker`、過濾 `major_category NOT NULL AND price_store>0`)。各家「會變網站商品數」= distinct main_sku:lightech 4566 / evotech 3435 / cncracing 1978 / eazigrip 1741 / samco 1403 / bonamici 1252 / **rpm 1117(已上)** / gbracing 942 / motogadget 912 / front3d 108 / materya 54 → 共 ~17,508 群、10 新家 ~16,400 群。
- 🔴 **「只有 RPM」原因 = 同步腳本雙重寫死**:`scripts/rpm-fetch.ts:21,71-74`(`SUPPLIER='rpm'` + `.eq('supplier_slug','rpm')`)+ `scripts/rpm-transform.ts`(brand_id 固定 rpm-carbon / category_id 固定「碳纖維部品」/ subtitle 硬加「碳纖維」/ spec 假設 `{weave,finish}` / handle 前綴 `rpm-`)。**非來源限制;`brands` 表已 seed 全 11 家 slug、`storefront_catalog_v` 已含全家。**
- **中文翻譯已備**(推翻初判):`storefront_catalog_v` 品名/描述/分類繁中 ~99-100% 覆蓋(`product_name_zh` / `description`←底表 `description_zh` / `major_category_zh` 16 大類 / `category_zh` 97 子類);真台灣 GEO 行銷文案非機翻;報價單側混合翻譯管線(字典 7 家自動 + Claude Haiku 對話 seed rpm/motogadget/front3d + samco 一次性)、`translation_locked` 防夜跑洗。網站沒顯示 = `rpm-fetch.ts` VIEW_COLS 當年刻意不抓 description(來源那時空、現滿)。**誠實尾巴**:AI 3 家 + samco 全新品項不自動翻、需人手 seed(源頭維護尾巴、不擋現有型錄)。
- **分類體系來源現成**:16 大分類(操控部品 7290 / 周邊配件 3462 / 車殼外觀 2723 / 引擎部品 1732 / …）+ 97 子類;網站 `categories` 只 1 筆待建。
- **經銷價防護 = view 物理排欄**:`products_public` / `product_variants_public` 無 `price_store`/`price_by_tier`/敏感 metadata;`SupabaseProductAdapter.ts` 全走 public view;加供應商不削弱此層。

## 3. GB / Bonamici N°02 品牌特色區設計草稿(confirm2=B 產出)

- **Artifact(可視草稿,Sean 已看過並回饋數輪)**:`https://claude.ai/code/artifact/13dc2490-7a87-40d6-a582-a56840ee093b`(源檔在本 session scratchpad `brand-n02-draft.html`、**非 repo 檔**)。
- **設計語言**:沿用 RPM 商品頁真 token(`apps/storefront/src/styles/tokens.css` + `product-page.css`:金線 `#a98a4a` 章節頭 / Antonio 義體大數字 / sharp 直角 / pd-section·pd-eyebrow 骨架)。**共用金線 = 全站商品頁簽名;品牌色只進各自特色區內容**(GB 紅 `#fe0000`+海軍藍 `#004289` / Bonamici 古銅 `#a3965f`+陽極多色)。
- **架構**(= #212 方向3「每品牌一元件 + `product.brand` 條件渲染」):每品牌 = N°01 品牌介紹 3 卡(可資料驅動)+ N°02 特色區(bespoke)。GB 走「冠軍認證橫幅 + 信任狀數字列 + 產品線矩陣」;Bonamici 走「品牌影片 + 研發段 + 職人切削段 + 陽極色牆 + 20 年徽章」。
- **文案修正(Sean 定)**:GB 產品線 = 引擎護蓋 / **車架防倒球** / **拉桿護弓(防止短兵相接誤觸)** / **輪軸防倒球(前後輪軸心保護)**;Bonamici 第二段從「生產線」改「職人手工·精密切削」。
- **素材狀態(全部候選、Sean 之後換授權版)**:
  - GB:logo(白底✅)、GB-trust 冠軍橫幅(Sean 提供✅)、引擎護蓋/軸心(官網白底✅去背);⚠️ **車架防倒球=裝車實拍、拉桿護弓=促銷 banner** → 待 Sean 給乾淨白底棚拍換。
  - Bonamici:logo✅、研發照(`bona 4.jpg`)+ 職人照(`Bona.jpg`)(Sean 提供✅)、8 色陽極真圖(Sean 提供✅);影片 = YouTube `JBWv0RvSWXY` **縮圖佔位**(CSP 擋 iframe,正式站才嵌真播放器;縮圖是建築空拍、Sean 可換封面/影片)。備用未用:`bona2.jpg`(賽事)/`bona3.jpg`(裝車)。
  - 🔴 官網抓的圖(GB frame/lever candidate 等)**版權屬品牌方、上正式站前 Sean 確認授權**。

## 4. gallery 箭頭 CSS 修(已 commit、未推)

- `b75f6bc fix(storefront): 商品頁 gallery 箭頭移除半透明毛玻璃框、透明底只留符號 [m-1]`。
- 改 `apps/storefront/src/styles/product-page.css` `.pd-hero-arrow`(-8/+7):白底 `rgba .32`+backdrop blur+白邊 → `transparent`、拿掉 blur/border、只留 `< >`、加 drop-shadow 保可讀、hover 改箭頭微放大。只動 `.pd-hero-arrow`;lightbox(`.pd-lb-arrow`)、縮圖翻頁(`.pd-thumbs-nav`)獨立 class 不連動。三綠:typecheck 7/7 + lint 10/10(純 CSS 免 build)。**未 push,等 Sean 推去看 dev preview;drop-shadow 濃淡可再調**。

## 5. 下一 session 做什麼(= Sean 本次指示「開始上架 GB + Bonamici」)

**這是鐵則 8 多片工程,起手 = 寫 Phase 0 共用地基正式 plan 給 Sean 批,不要跳過直接動 DB/pipeline。** 進度形狀:

```
Phase 0  共用地基(一次、鐵則8需批)
         ├ 匯入管線多供應商化:rpm-fetch/transform/load 去 rpm 寫死 → 參數化(brand/category/subtitle/spec 逐家對應、VIEW_COLS 補 description/category_zh/major_category_zh)
         ├ 網站建 16 大分類(categories 表 seed)
         ├ 功能性去 RPM 化(Q2=B):ProductInfo DIM_LABEL + ProductTabs 規格表 → 非 RPM 家通用兜底/留白(至少釘死碳纖維字樣只給 rpm)
         └ N°01 品牌介紹範本化(ProductHighlights/ProductServices 讀品牌欄位)
Phase 1  試點資料上架(gbracing + bonamici)→ Sean 肉眼驗(中文/車款/價格對、無錯誤碳纖維字樣、經銷價零外洩)
Phase 2  逐品牌 N°02(草稿已備、Sean OD 精修 → 搬進 storefront,brand 條件渲染)——Q5=B:兩家 N°02 都到位才上線
Phase 3  放量其餘 8-9 家 + 每日同步涵蓋全供應商
```

**關鍵技術地圖(動 pipeline 時看)**:
- 同步鏈:`scripts/rpm-fetch.ts`(讀 view、rpm 硬濾)→ `rpm-transform.ts`(rpm-carbon 寫死)→ `rpm-load.ts`(upsert)+ `rpm-delta.ts`/`rpm-reconcile.ts`(S4 下架對賬)/`rpm-preflight.ts`;排程 `.github/workflows/rpm-sync.yml`。S3b 拆分 plan:`docs/specs/2026-06-02-S3b-sync-rewrite-plan.md`。
- 前台去 RPM 化:`apps/storefront/src/components/ProductInfo.tsx`(DIM_LABEL/選擇器 key)、`ProductTabs.tsx`(規格 pane 靜態 JSX「真碳纖維/泰國」)、`ProductHighlights.tsx`(N°01)、`ProductSwatchWall.tsx`(N°02 RPM 專屬)。
- 合約:`docs/STOREFRONT_CATALOG_CONTRACT.md`;#212 五斷點見 backlog `docs/phase-1-backlog.md:5528`。
- 車種鐵律:AI/匯入不碰車種、走 `fitment_parsed` 直出(memory `project_storefront-content-model-design`);ProductFitments 已資料驅動、不卡。

## 6. graphify

**未刷**。Sean 標準規則「graphify 不主動刷、等 Sean 說」;且本 session 動的是 CSS 視覺(非結構性 code)。下一 session 動 pipeline/元件後,若 Sean 說刷 → `/graphify --update`。

## 7. 開放項 / 待決(無硬 blocker)

- 🏛️ **Phase 0 plan 待寫待批**(下一 session 起手,鐵則 8)。
- 🔧 GB 兩張圖(車架防倒球裝車實拍 / 拉桿護弓 banner)待 Sean 給乾淨白底棚拍。
- 🔧 品牌敘事圖(GB/Bonamici 官網候選)授權待 Sean 確認;Bonamici 影片封面/選片 Sean 可換。
- 🔧 #211 fitment 正規化(報價單匯入端無守門)、#209 描述 pipeline 維護尾巴(AI 3 家新品需人手 seed)。
- 🔴 carry-over(Sean 手動,前 session 帶下來):live `0072`/`0073` 雙扣退款(W1 runbook)。

## 8. 收尾自檢

git working tree clean ✅ / **1 commit 未 push(`b75f6bc`,等 Sean 手動推)**✅ / 金流 flag 全 false 未動 ✅ / 零 DB 寫入(僅唯讀 MCP 查)✅ / 零 schema/migration ✅ / secret 0 洩漏 ✅ / graphify 未刷(§6)✅ / N°02 草稿在 Artifact + scratchpad、非 repo 檔 ✅。

## 相關真權威

- memory:`project_quote-full-import-11-suppliers`(本任務決策+事實 SSoT)/ `project_product-page-template-multibrand`(#212)/ `project_storefront-content-model-design`(車種鐵律)
- brief:`docs/specs/2026-06-04-product-page-template-design.md`(N°02 方向3 + OD 框架 + 設計 token)
- backlog:#212(`docs/phase-1-backlog.md:5528`,5 斷點 + 去 RPM 化)/ #211 / #209
- Artifact:`https://claude.ai/code/artifact/13dc2490-7a87-40d6-a582-a56840ee093b`(N°02 草稿 v4)
