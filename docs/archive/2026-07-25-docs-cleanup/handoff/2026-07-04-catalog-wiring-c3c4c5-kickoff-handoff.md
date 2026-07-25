# Handoff — 目錄接線線 C4/C3/C5 收尾(2026-07-04)

> 接手者:新視窗 session。目標 = 把「分類/品牌前台接線」plan 的 **C4(B:C4a+C4b 一起)→ C3 → C5** 一次做完,讓 /products 分類 + 品牌篩選對客人真的可見可用。真權威 plan = `docs/specs/2026-07-04-catalog-category-brand-frontend-wiring-plan.md`。

## 0. 開工狀態(交接時)

- branch **dev**、HEAD **`996c370`**、工作樹 clean、**origin/dev..HEAD = 6 commit 未 push**(等 Sean 手動推;開工先確認,不自行 push)。
- 開工儀式:`cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5`,預期 branch=dev / clean / HEAD=996c370。

## 1. 本 session 已完成(勿重做)

- **#259 測試商品完整清除 ✅ live**:唯讀查證→BEGIN/ROLLBACK 模擬 residue 全 0→真跑 DO block。刪測試商品 `f619b122`(supplier_slug=test)+ 1 變體 + 10 orders(全 bsas0830 自有測試單)+ 9 charge_attempts + 4 pending_invoices。**live 商品 1118→1117、total 1409→1408**;首頁測試商品已消失。(Sean q6=B 授權連訂單全清。)
- **C1 listCategories 讀取層 ✅**(commit `86bc286`):新 domain `CategorySummary`(`packages/domain/src/catalog/types.ts`)+ `IProductRepository.listCategories`(`packages/ports`)+ `SupabaseProductAdapter.listCategories`(走 `products_public` + head:true exact count、避 1000-row 上限、經銷價零外洩)+ InMemory 推導版。**鐵則6 拆檔(Sean 拍 B)**:adapter 488→371 行,抽 `packages/adapters/src/supabase/helpers/product-query-support.ts`(findSingle/PGRST_NOT_FOUND/buildIlikeOrFilter/SEARCHABLE_COLUMNS)+ `helpers/category-queries.ts`(listCategories/resolveCategoryId/count)。commit `a24b32f` = STATUS 最近3commit 對齊。
- **C2 分類過濾接真(管線)✅**(commit `996c370`):`filterProducts` 補 `matchesCategory`(比對鍵=選取分類名稱 `sub ?? main`、對齊 `product.category`=`raw`、真註冊表 `name`=`raw_path` 同源、**獨立分支不觸 matchesVehicle、車款零回歸**)+ 新 `apps/storefront/src/lib/category-taxonomy.ts` `buildCategoryTree`(**選項 A** 只留 `productCount>0` 分類、與品牌側 #220c 一致)+ server `fetchCategories()`(`lib/products.ts`)+ `page.tsx` 並行 fetch + `ProductsPage` `categories` 必填 prop。
  - **🔴 C2 對客人不可見**:分類 UI 全隱藏 —— `CascadeFilterTop` 根本沒有分類 UI(grep categor=0、只有車款),`FilterSide`(ProductsPage.tsx:277 `hideCategory`)/`FilterDrawer`(:368 `hideCategory`)分類樹關閉 → `cascade.category` 生產恆 null、`matchesCategory` 是 dead path。**C4 才點亮**。

## 2. Sean 拍板(全部已定、勿重問)

- 接線批次:q1 plan 批准 / q2 寫 prod go〔實際 --confirm-write 仍卡 #266+N°02、Sean 手動〕 / q3 #266=A 正規化 / q4 #260=B / q5 N°02=C / q6 #259=清〔已執行〕;⑦搜尋=不納本輪 / ⑧順序=先接線;鐵則6=B 拆檔〔已拆〕。
- 側欄分類顯示 = **A(只留有商品的分類)**、與品牌 #220c 一致(已落在 buildCategoryTree)。
- C2/C4 節奏第一輪=A(先 commit C2 管線)→ **C4 內部節奏=B(C4a 解除 hideCategory + C4b 參數化 fetch 一起做、一次到位)**。
- 本輪目標:**新視窗把 C4(B)+ C3 + C5 一次做好**,接線線 C1-C5 收工。

## 3. 待做(依序、每片三綠 + code-reviewer + diff 回主對話核、不 push)

### C4(Sean=B,C4a+C4b 一起一個 slice 或緊鄰兩 commit)
- **C4a 解除 hideCategory(可見片)**:`apps/storefront/src/components/ProductsPage.tsx` 移除傳給 `FilterSide`(:277)與 `FilterDrawer`(:368)的 `hideCategory` → 分類樹現身(吃 C2 已接的真 `data.categories`)。
  - 效果:/products 左欄(桌機)+ 手機抽屜出現分類篩選,目前顯「碳纖維部品(1117)」一項,選它=全部(RPM 零回歸)。
  - **🔴 視覺版面改動 = Sean 掌舵**:`FilterSide` 目前 hideVehicle(車輛移頂部)+ hideBrand/hideColor/hidePromoFlags 全關、只剩價格;解除 hideCategory 會加一區分類樹。**做完 raise Sean 開站肉眼驗版面**,不自行 polish 視覺。
  - manifest:更 `docs/design-storefront-manifest.yaml` ProductsPage `hiddenMockFilters` override(hideCategory 解除)+ `categoryFilterReal`(改「已對使用者可見」)+ `last_modified_commit`=996c370;跑 `node scripts/design-mirror.mjs --validate`。
- **C4b 參數化 fetch(跨分類/全目錄、#205)**:`apps/storefront/src/lib/products.ts` `fetchCatalogProducts`/`fetchFeaturedProducts` + `apps/storefront/src/app/sitemap.ts` 目前**寫死** `{raw:'碳纖維部品'}`(products.ts fetchFeatured L191-194 / fetchCatalog L227-230;sitemap 間接繼承)。要解除寫死、撈全目錄。
  - **🔴 設計點**:adapter 目前只有 `listAllByCategory(category)`(需分類);撈「全目錄非下架商品」需**新增 port/adapter 方法**(如 `listAllProducts()`、仿 listAllByCategory 的 `.order('id')+.range` 分頁迴圈但**不 eq category**、走 `products_public`、經銷價零外洩)。這是 C1 式的 port+adapter 加法(在已批 plan 範圍內)。
  - **RPM 零回歸**:目前 live 全在碳纖維部品(1117),撈全目錄 = 撈碳纖維部品 = 同 1117;byte 等價。多品牌寫入後才會多出其他分類商品。
  - featured 首頁:`fetchFeaturedProducts` 若改撈全目錄取前 4,現況仍全是碳纖維商品(無變化);留意「featured 旗標」是更正解(#205 註),Phase 1 可先取全目錄前 N。

### C3 品牌側欄動態衍生(#220c)
- 仿 `buildVehicleTaxonomy`(`@/lib/vehicle-taxonomy.ts`)由已撈商品衍生 unique 品牌(**只渲染有真商品的品牌**),ProductsPage 解除傳給 FilterSide/FilterDrawer 的 `hideBrand`。目前真資料單一品牌 RPM CARBON → 側欄只顯 RPM CARBON;`filterProducts` 品牌分支已存在(id→name 解析、cnc-racing/gb-racing 有測)。`mock-brands.ts` 保留為型別/fallback。

### C5 相關商品真資料(#258)
- 商品詳情頁「相關商品」目前吃 `MOCK_PRODUCTS`(休眠地雷、寫入當天會冒假圖+死連結)。改真資料同分類查詢(排除自身取 4)或條件移除、拆 `MOCK_PRODUCTS` import。**多品牌上架前必完成**。

## 4. 硬約束 / 踩雷(务必守)

- **RPM 現況零回歸 = 最高約束**:現況 live 只有「碳纖維部品」1117 筆、其餘 16 大類空;任何接線片,預設視圖(沒選篩選)必須仍回全部 1117;選碳纖維部品=全部。資料層驗法:`select c.name,(select count(*) from products p where p.category_id=c.id and p.delisted_at is null) from categories c order by sort_order`(唯讀 MCP)。
- **filterProducts 是車款篩選共用函式**:動它必確保 matchesVehicle 零回歸(獨立分支)、跑既有 vehicle 測。
- **經銷價零外洩**:所有 read 走 `products_public` 安全 view(物理排除 price_store/price_by_tier/metadata);新 adapter 方法同守。
- **寫 prod = Sean 手動**;Claude 唯讀 MCP 查證可做。本輪**不需**任何 DB 寫入(純前台接線)。
- **視覺/版面 = Sean 掌舵**(R6):C4a 解除 hideCategory、C3 解除 hideBrand 都會改側欄版面 → 做完 raise Sean 肉眼驗、不自行 polish。
- **字面 vs 事實**(本 session 血淚):C2 我一度在 manifest 誤稱「頂欄顯真分類」被 code-reviewer 擋下 —— 宣稱「可見/生效」前先 grep 確認 UI 真的渲染、真的有入口。commit body / manifest / STATUS 不得宣稱未落地的可見性。
- 流程:每片三綠(typecheck+lint+動 .ts/.tsx 加 build)+ 完整 vitest + code-reviewer(fresh)+ 動 storefront 元件更 manifest + validate;commit 精準 add(禁 add .)+ STATUS 7 欄同 commit;**不 push**。

## 5. 關鍵檔案速查

- plan(真權威):`docs/specs/2026-07-04-catalog-category-brand-frontend-wiring-plan.md`
- 過濾邏輯:`apps/storefront/src/components/products-filter-logic.ts`(matchesVehicle + matchesCategory)
- 分類 mapper:`apps/storefront/src/lib/category-taxonomy.ts`(buildCategoryTree、選項 A)
- server fetch:`apps/storefront/src/lib/products.ts`(fetchCatalogProducts/fetchFeaturedProducts/fetchCategories、寫死碳纖維部品在此)
- 頁面組裝:`apps/storefront/src/components/ProductsPage.tsx`(data 組裝 L193、hideCategory/hideBrand 在 :277/:368/FilterDrawer)
- sitemap:`apps/storefront/src/app/sitemap.ts`
- adapter:`packages/adapters/src/supabase/SupabaseProductAdapter.ts`(+ helpers/*);port:`packages/ports/src/IProductRepository.ts`
- manifest:`docs/design-storefront-manifest.yaml`(ProductsPage 段)+ `node scripts/design-mirror.mjs --validate`
- storefront DB(唯讀驗):Supabase project `bmpnplmnldofgaohnaok`

## 6. 完成後

- 接線線 C1-C5 收工 → 下一 gate = **多品牌試點寫入**(Sean go/no-go + #266 handle=A 正規化 + N°02 到位;寫 prod = Sean 手動 `--confirm-write`)。C5 + C4b 是寫入前必完成項。
- 收尾:STATUS 7 欄、`/pcm-roadmap` 更地圖、`/graphify --update`、不 push(列「未 push N commit、等你推」)。
