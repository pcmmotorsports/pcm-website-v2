# Plan:分類/品牌前台接線(目錄「DB 真、UI 假」收口)

> **狀態**:✅ Sean 批准(2026-07-04、q1=A)。**C1 ✅ / C2 ✅ 完成**(C1=listCategories port+adapter+拆 helpers;C2=filterProducts category 分支 + 側欄分類資料源接真〔buildCategoryTree 選項 A〕+ server fetchCategories,🔴 對客人不可見待 C4 解除 hideCategory)。各片三綠+vitest 1689+code-reviewer×2 PASS、未 push。**下一 C4**(參數化 fetch 解除寫死碳纖維部品 + 解除 hideCategory 讓分類篩選現身、Sean 肉眼驗)→ C3 品牌 → C5 相關商品。
> **真權威依據**:2026-07-04 多代理盤點(workflow `phase1-catalog-launch-recon`)+ 本檔。
> **前提認知**:車款(fitment)篩選**已真資料上線可用**(`buildVehicleTaxonomy` + `products-filter-logic.ts` `matchesVehicle`,2026-07-03);商品瀏覽(列表/精選/詳情/cart/sitemap)已全接真 Supabase、經銷價 server 端 strip。本 plan 只收「分類/品牌篩選 UI 仍 mock/no-op」這一塊。

---

## 1. 問題(盤點實證)

分類系統與品牌篩選是「DB 真、UI 假」的斷頭狀態:

| 面向 | 現況 | 檔案:行號 |
|---|---|---|
| categories 表 | 真、17 列(16 大類 + 碳纖維部品)、P0-B db push live | `supabase/migrations/20260703120000_*.sql` |
| 首頁分類格 | 寫死 8 類 + Unsplash 圖 + 靜態 count,連到的 id 在真 DB 不存在 | `CategoryGrid.tsx:12-24` |
| 篩選側欄分類樹 | 吃 `mock-categories.ts`(11 類巢狀、L2 內容分級、#147) | `mock-categories.ts:1-105` |
| 分類過濾邏輯 | `filterProducts()` 明文**不過濾** category(選了只變標題文字) | `products-filter-logic.ts:33-44` |
| 撈商品的 fetch | 三處**寫死單一分類字串「碳纖維部品」** | `lib/products.ts:184-242`、`sitemap.ts:12-20` |
| adapter 讀取層 | **無 `listCategories` read method**(只有寫入用的單筆 `resolveCategoryId`) | `SupabaseProductAdapter.ts:385-395` |
| 品牌側欄 | 吃 `mock-brands.ts` 17 家,真資料僅 RPM CARBON → 選其他 16 家靜默 0 結果(#220c) | `mock-brands.ts:1-20`、`ProductsPage.tsx:275-277` |

**根因鏈**:分類/品牌篩選要能真正驗證 → 需要多品牌多分類真資料 → 需 `--confirm-write` 寫入 prod → 卡 Sean go/no-go + #266 + N°02 + #260。故本接線與試點寫入**互相依賴**(順序見 §5)。

## 2. 目標

客人在前台能:①首頁看真分類格 ②/products 用分類樹真篩選 ③品牌側欄只顯示有真商品的品牌、選了有結果 ④跨分類/全目錄瀏覽(非只碳纖維部品)。

## 3. 鐵則 8 四要素

**改什麼(5 片,對齊盤點 recommended_slices step 3-7)**:
- **C1 adapter `listCategories` read method**(`packages/ports` `IProductRepository` + `SupabaseProductAdapter`):回各分類 + 真商品數。CategoryGrid 首頁 + 篩選側欄共用地基。
- **C2 `filterProducts` 補 category 真過濾分支**(以既有 `matchesVehicle:56-72` 為範本、#152 分類半)+ 側欄分類樹資料源 `mock-categories.ts` → `listCategories`。
- **C3 品牌側欄動態衍生**(#220c;仿 `buildVehicleTaxonomy` 由已撈目錄推 unique brands、只渲染有真商品的品牌)+ 解除 `ProductsPage` `hideBrand`。
- **C4 參數化 `fetchCatalogProducts`/`fetchFeaturedProducts` + `sitemap.ts`**(#205;解除寫死單一分類、支援跨分類/全目錄)+ 解除 `hideCategory`。
- **C5 `#258` 相關商品**改真資料同分類查詢(排除自身取 4)或條件移除、拆 `MOCK_PRODUCTS` import(寫入當天會冒假圖+死連結,寫入前必完成)。

**為何**:categories/brands 已是真資料但前台不讀,多品牌上架後客人無法分類/品牌瀏覽、部分品牌 chip 選了 0 結果、首頁分類格是假圖假連結。

**影響面**:
- 共用篩選元件 `products-filter-logic.ts` `filterProducts`(車款篩選也用它、不可回歸)。
- 共用 server fn `fetchCatalogProducts`/`fetchFeaturedProducts`(列表 + 首頁 + sitemap SEO 同源)。
- adapter port `IProductRepository`(新增 method、不動既有簽名)。
- RPM 現況零回歸:單一分類/單一品牌下,新分支必須與現行輸出等價(RPM 全在碳纖維部品、選它 = 全部)。

**rollback**:每片可獨立 revert;`mock-categories.ts`/`mock-brands.ts` 保留為 fallback(真 DB 查空時退回、不裸奔);C4 參數化保留「預設碳纖維部品」路徑,漸進切換。

## 4. 切片順序(每片 15-45 分鐘、鐵則 8 需 Sean 批 plan 後)

1. **C1**（可先做、無 prod 依賴）:`listCategories` port + adapter + 單元測試（mock adapter 驗回各分類商品數）。
2. **C2**:`filterProducts` category 分支 + 側欄接 `listCategories`;RPM byte 回歸鎖（選碳纖維部品 = 全部）。
3. **C3**:品牌動態衍生 + 解除 hideBrand。
4. **C4**:參數化 fetch + sitemap;RPM SEO 零回歸驗證。
5. **C5**:相關商品真資料化。

C1-C4 在**單一品牌單一分類現況下可先做骨架**(RPM 當回歸錨),但**真正的多分類/多品牌效果驗收依賴試點寫入**(§5)。

## 5. 順序決策(交 Sean、雞生蛋)

接線(本 plan)與試點寫入(go/no-go + #266 + N°02)互相依賴:
- **先接線後寫入**:寫入當天客人立即看到多分類多品牌、體驗完整;但接線骨架只能用 RPM 單一分類當回歸錨驗證、多分類效果要等寫入才真看到。
- **先寫入後接線**:寫入當天客人看到假圖(#258)、死品牌 chip(#220c)、無法分類瀏覽(#205),需緊接著接線補救。
- **推薦**:先接線(C1-C5、可逆、RPM 零回歸鎖)→ 全綠 → Sean 拍 go/no-go + #266 + N°02 → 寫入 → 當天即完整。

## 6. 風險

- 寫死單一分類三處同源(`products.ts` 2 fetch + `sitemap.ts`),漏改任一 → 新分類商品在列表/精選/SEO 缺席。
- C2/C4 動共用篩選元件 + server fn,跳過 plan 直接改 = 制度違規 + 跨層契約破壞;RPM 零回歸鎖是硬約束。
- `sitemap.ts` 漏抓非碳纖分類 = SEO 缺頁(依賴 #212/#205 一併解)。
- 站內搜尋(Header 搜尋框 `dispatchEvent('pcm-open-search')` 全 repo 零 listener = 死 UI;adapter `searchByKeyword` 已具備但零前台呼叫者):**是否納入本輪範圍待 Sean 定**,未定則不做。

## 7. 不在本 plan(需 Sean 拍板 / 不可逆,見 STATUS「Sean 待決策」)

試點 `--confirm-write` 寫入 prod、#266 handle A/B/C、#260 描述覆寫語意、N°02 落地、#259 test 商品清除——全屬 Sean 拍板/不可逆項,本 plan 只做前台接線(可逆)。
