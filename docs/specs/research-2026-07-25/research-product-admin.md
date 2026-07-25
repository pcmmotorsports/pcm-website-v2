# 商品管理領域研究:Shopify vs Medusa v2

查證日期 2026-07-25。方法:help.shopify.com / shopify.dev 用 firecrawl_scrape 或 WebFetch 抓文字;Medusa 用 GitHub raw 原始碼(develop branch, packages/modules/product 與 packages/admin/dashboard)+ docs.medusajs.com。demo.medusajs.com 已下線、help.shopify.com 瀏覽器自動化被 Turnstile 擋,故未用 agent-browser 截圖。

---

## 1. 商品新增/編輯頁版面結構

### Shopify(來源:https://help.shopify.com/en/manual/products/details/product-details-page)
文件本身以 TOC 順序列出區塊,但**未明文標註「哪些在主欄、哪些在側欄」**——以下主/側欄分法是業界公開共識(Shopify Polaris 兩欄版型,多篇 Partner 教學一致描述),非該頁逐字聲明,標記為「高信心推論」:

推定主欄(top→bottom):
1. Title and Description(標題+描述,富文本編輯器)
2. Media(圖片/3D/影片)
3. Category(Shopify Standard Product Taxonomy,單一分類、解鎖 category metafields)
4. Pricing(僅無 variant 商品顯示;price/compare-at/cost per item/margin)
5. Inventory(SKU/Barcode;僅無 variant 商品顯示)
6. Quantity(僅無 variant 商品顯示,依 location 顯示 available/committed/on hand)
7. Shipping(僅無 variant 商品顯示:weight/package/customs)
8. Variants(有 variant 時取代 4-7)
9. Purchase options(訂閱/預購/試用)
10. Metafields
11. Product disclosures
12. Search engine listing(title/description/URL handle 預覽)

推定側欄:
13. Product status(Active/Draft/Archived/Unlisted)
14. Publishing(銷售通路 + 排程發布日期)
15. Insights(銷售洞察)
16. Product organization(Product type / Vendor / Collections / Tags)
17. Theme template

原文明示:「For products that don't have any variants, the Price, Inventory, and Shipping sections are displayed on the product details page. If you add variants, then those sections are no longer displayed」——即有 variant 時 4-7 被 Variants 區塊取代。

### Medusa v2(來源:GitHub 原始碼,唯讀,100% 可驗證——優於 Shopify 段)
`https://github.com/medusajs/medusa/blob/develop/packages/admin/dashboard/src/routes/products/product-detail/product-detail.tsx`

用 `LayoutComposer` 明確分 `main` / `side` 兩欄,逐字如下:

**主欄(main,top→bottom)**:
1. `ProductGeneralSection` — 標題(product.title 當 Heading)+ Title/Subtitle/Handle/Description/Discountable
2. `ProductMediaSection` — 標題「Media」
3. `ProductOptionSection` — 標題「Options」
4. `ProductVariantSection` — 標題「Variants」
5. `detailPageDefaultEntries(product)` — 框架內建,含 Metadata + JSON 檢視區塊(通用於所有 detail 頁)

**側欄(side,top→bottom)**:
1. `ProductSalesChannelSection` — 標題「Sales channels」(`t("fields.sales_channels")`)
2. `ProductShippingProfileSection` — 標題「Shipping configuration」
3. `ProductOrganizationSection` — 標題「Organize」(注意非「Organization」,en.json 逐字 `organization.header = "Organize"`)
4. `ProductAttributeSection` — 標題「Attributes」(重量/尺寸/HS code/mid code/material/country of origin)

來源:
- product-detail.tsx: https://raw.githubusercontent.com/medusajs/medusa/develop/packages/admin/dashboard/src/routes/products/product-detail/product-detail.tsx
- 各 section 標題文字驗證於 en.json: https://raw.githubusercontent.com/medusajs/medusa/develop/packages/admin/dashboard/src/i18n/translations/en.json

**新增商品(Create)流程分頁**(來源同 en.json `products.create.tabs`):Details / Organize / Variants / Inventory kits 四個 tab,非單頁滾動。

---

## 2. 商品欄位完整清單

### Shopify Product 物件(GraphQL Admin API,來源 https://shopify.dev/docs/api/admin-graphql/latest/objects/Product)
逐欄位(節錄核心,略過純技術性 connection 計數欄):
- `title: String!` `description: String!` `descriptionHtml: HTML!` `handle: String!`
- `vendor: String!` `productType: String!` `tags: [String!]!`
- `status: ProductStatus!` (enum: `ACTIVE` / `ARCHIVED` / `DRAFT` / `UNLISTED`)
- `category: TaxonomyCategory`
- `priceRangeV2: ProductPriceRangeV2!` `compareAtPriceRange: ProductCompareAtPriceRange`
- `totalInventory: Int!` `tracksInventory: Boolean!` `hasOutOfStockVariants: Boolean!`
- `media: MediaConnection!` `featuredMedia: Media` `mediaCount`
- `options: [ProductOption!]!` `variants: ProductVariantConnection!` `variantsCount`
- `seo: SEO!` `templateSuffix: String`(theme template)
- `metafield` / `metafields: MetafieldConnection!`
- `isGiftCard: Boolean!` `giftCardSettings` `giftCardTemplateSuffix`
- `requiresSellingPlan: Boolean!` `sellingPlanGroups`
- `resourcePublications` / `resourcePublicationsV2`(發布通路+排程時間 publishDate)
- `combinedListing` / `combinedListingRole`
- `productComponents` / `bundleComponents`(組合商品)
- `createdAt` `updatedAt` `publishedAt`

### Shopify ProductVariant 物件(https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant)
- `price: Money!` `compareAtPrice: Money` `contextualPricing`
- `sku: String` `barcode: String`
- `title: String!` `displayName: String!` `position: Int!`
- `inventoryQuantity: Int` `sellableOnlineQuantity: Int!` `inventoryItem: InventoryItem!` `inventoryPolicy`(backorder 設定)
- `media: MediaConnection!` `image: Image`(deprecated,改用 media) `selectedOptions: [SelectedOption!]!`
- `taxable: Boolean!` `deliveryProfile` `requiresComponents: Boolean!` `availableForSale: Boolean!`
- `id` `createdAt` `updatedAt` `product: Product!`
- 注:cost per item(成本)、weight 實際存在於 CSV 欄位與 UI,但不在 ProductVariant 頂層 GraphQL 欄位清單中列出(成本欄位在 `InventoryItem.unitCost`,重量在 variant 的 `inventoryItem` 底下——本輪未逐一查證 InventoryItem 物件全欄,標記「未確認 InventoryItem.unitCost/weight 確切路徑」)。

### Shopify CSV 欄位(權威,https://help.shopify.com/en/manual/products/import-export/using-csv,逐欄位確認)
Title / URL handle / Description / Vendor / Product category / Type / Tags / Published on online store / Status(active|draft|archived)/ SKU / Barcode / Option1-3 name+value(+LinkedTo)/ Price / Price·International / Compare-at price(+International)/ Cost per item / Charge tax / Inventory tracker / Inventory quantity / Continue selling when out of stock(deny|continue)/ Weight value(grams)/ Weight unit(g|kg|lb|oz)/ Requires shipping / Fulfillment service / Included·[Market] / Product image URL / Image position / Image alt text(max 512 字)/ Variant image URL / Gift card / SEO title(max 70)/ SEO description(max 320)/ Google Shopping 系列欄位 / Metafields(型別清單見下)/ Collection(僅 import 用,export 不含)。

Metafield CSV 支援型別:boolean, color, date, date_time, dimension, list.*(color/date/date_time/dimension/metaobject_reference/number_decimal/number_integer/product_reference/url/volume/weight), money, multi_line_text_field, number_decimal, number_integer, product_reference, shopify.disclosure, single_line_text_field, url, volume, weight。
🔴 **Variant metafields 不支援 CSV 匯入匯出**,只能用 variant bulk editor 加 metafield 欄位。

### Medusa v2 Product model(GitHub 原始碼,100% 逐字,https://raw.githubusercontent.com/medusajs/medusa/develop/packages/modules/product/src/models/product.ts)
```
id (prefix "prod")
title: text, searchable, translatable
handle: text
subtitle: text, searchable, translatable, nullable
description: text, searchable, translatable, nullable
is_giftcard: boolean, default false
status: enum ProductStatus, default DRAFT
thumbnail: text, nullable
weight / length / height / width: float, nullable
origin_country: text, nullable
hs_code: text, nullable
mid_code: text, nullable
material: text, translatable, nullable
discountable: boolean, default true
external_id: text, nullable
metadata: json, nullable
variants: hasMany ProductVariant
type: ProductType(optional)
tags: manyToMany ProductTag
options: hasMany ProductOption
images: hasMany ProductImage
collection: belongsTo ProductCollection(optional)
categories: manyToMany ProductCategory
```
ProductStatus enum 逐字(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/core/types/src/product/common.ts):
`"draft" | "proposed" | "published" | "rejected"`

### Medusa ProductVariant model(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/modules/product/src/models/product-variant.ts)
```
id (prefix "variant")
title: text, searchable, translatable
sku / barcode / ean / upc: text, searchable, nullable(各自有唯一 index)
allow_backorder: boolean, default false
manage_inventory: boolean, default true
hs_code / origin_country / mid_code: text, nullable
material: text, translatable, nullable
weight / length / height / width: float, nullable
metadata: json, nullable
variant_rank: number, default 0, nullable
thumbnail: text, nullable  (since 2.11.2)
product: belongsTo Product
images: manyToMany ProductImage (since 2.11.2)
options: manyToMany ProductOptionValue
```
🔴 **注意:ProductVariant 本身沒有 price 欄位**——Medusa v2 價格是獨立 Pricing module(PriceSet/Price),透過 module link 掛到 variant,不在 product module schema 內(本輪未查證 link 表結構,標記未確認細節、但「不在同一張表」為原始碼直接可見的事實:product-variant.ts 全文無 price 欄位)。
🔴 **sku/barcode/ean/upc 是全域唯一 index(`where: deleted_at IS NULL`,非 scoped by product)**——代表兩個不同商品的 variant 不能共用同一組 SKU。

---

## 3. 變體(Variant)模型

### Shopify(來源:https://help.shopify.com/en/manual/products/variants/add-variants)
- 每個商品**最多 3 個 Option**(如 Size/Color/Material),各商品可用不同 Option 組合。
- **每個商品最多 2,048 個變體**(原文逐字:"You can create up to 2,048 variants for a product")——舊上限 100,現況已提升;但要注意 100 以上仍有相容性但書:
  - 每個商品最多 250 個媒體項目,每個變體最多綁 1 個媒體項目(需來自該商品媒體庫)。
  - 部分第三方 theme / app / 銷售通路 / Stocky / 舊版 Order Printer **不支援 100+ 變體**。
  - 若店鋪總變體數 ≥ 500,000,則每日透過 app/CSV 新增變體有 10,000 筆/日速率限制(Shopify Plus 除外)。
- 變體可用 **Category metafield** 連接 Option(如 Color 連到官方色票 metaobject),值可重用、改一次全站同步,且可在前台顯示色票(swatch)。
- 批次操作:「Add values to an existing option」一次性依既有組合生成新變體矩陣(如加一個新顏色自動生出所有尺寸組合)、「Duplicate multiple variants in bulk」批次複製既有變體到新選項值。
- 逐一手動新增/複製變體,不可儲存完全重複的 option 值組合。
- 每個變體可獨立設定:Price / Compare-at price / Cost / SKU / Barcode / Inventory quantity(依 location)/ Continue selling when out of stock / Weight / HS code / Country of origin / 圖片 / Location。

### Medusa v2(來源:GitHub 原始碼)
- Option 與 OptionValue 為獨立 model:`ProductOption`(title + values,可 `is_exclusive` 綁單一商品)、`ProductOptionValue`(value + rank,manyToMany 連 ProductVariant)。
- Option **可跨商品共用**(2.16.0 起 `products: manyToMany`,非 1:1 綁死單一商品)——比 Shopify 更彈性,但也代表同名 Option title 全域唯一(unique index on title where is_exclusive=false)。
- 未查到 Medusa 官方文件明文「每商品最多幾個 Option / 幾個變體」的數字上限(標記**未確認**;已試 docs.medusajs.com Product module 頁與 GitHub model 檔皆無 hard-coded 上限常數,可能是應用層/UI 層限制而非 schema 層)。
- 變體批次編輯:UI 上有 `product-image-variants-edit` 路由(圖片↔多變體批次綁定)與 create 流程的 `productVariants` 矩陣勾選(依 Option 組合自動生成候選變體清單、可勾選要建立哪些),但**沒有找到 Shopify 式「一次改多個既有變體欄位」的 spreadsheet bulk editor**——Medusa 變體編輯多為逐一 variant 表單。

---

## 4. 媒體/圖片管理

### Shopify(https://help.shopify.com/en/manual/products/product-media 及 CSV 文件)
- 支援型別:圖片、3D 模型、影片。
- 上傳/管理集中在 **Content → Files**,可用 `Used in = Product media` 篩選——**有可重用的媒體庫**概念(檔案獨立於單一商品存在,可被多處引用)。
- 排序:Image position 數字(1 起算,CSV 匯入用)。
- Alt text:每張圖可獨立設定,上限 512 字元,建議 ≤125 字元(SEO/無障礙)。
- 影片/3D 模型 CSV 不支援,需另外上傳到 Content → Files。
- 一商品最多 250 張圖片(CSV 文件章節逐字確認)。
- 變體與媒體綁定:`ProductVariant.media`(MediaConnection)+ deprecated `image` 單張欄位;每個變體限綁 1 個媒體項目、且該項目必須先存在於商品的媒體清單中。

### Medusa v2(GitHub 原始碼 product-image.ts / product-variant.ts)
- `ProductImage`:`url` / `rank`(排序)/ `metadata`,`belongsTo Product`。
- **無獨立 alt text 欄位**(schema 內只有 url/rank/metadata,沒有 alt/caption 專屬欄位——若要 alt text 需塞進 metadata,標記為與 Shopify 明顯落差)。
- 變體↔圖片:`ProductVariantProductImage` pivot table,**manyToMany**(2.11.2 起)——一張圖可綁多個變體、一個變體也可綁多張圖,比 Shopify(每變體限 1 張)更彈性。
- 沒看到獨立 3D 模型/影片型別欄位(schema 只有 `url` 泛用欄位,型別靠副檔名/前端判斷,未在 model 層區分)。
- **沒有 Files 式跨商品媒體庫**——`ProductImage.belongsTo(Product)` 是強綁定單一商品,同一張圖要用在別的商品需另建一筆記錄(url 可重複但無「檔案庫」概念)。

---

## 5. 商品列表頁

### Medusa v2(GitHub 原始碼,100% 可驗證)
- 預設欄位(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/admin/dashboard/src/hooks/table/columns/use-product-table-columns.tsx):**Product(縮圖+名稱)/ Collection / Sales channels / Variants(數量)/ Status**。
- 篩選軸(use-product-table-filters.tsx):**Type / Tag / Sales channel / Status**(status 值即 draft/proposed/published/rejected,逐一對應 en.json `products.productStatus.*`)。
- 有獨立 `product-export` 與 `product-import` 路由(CSV 匯入匯出),但 export 邏輯在後端 workflow、admin dashboard 前端原始碼未含逐欄位定義,**未查到 Medusa CSV 欄位清單**(已試:product-export 元件、GitHub 搜尋,皆未命中欄位定義檔;標記未確認)。
- **沒有找到 Shopify 式「試算表格 bulk editor」**——product-list 只看到 checkbox 選取 + `product-list-table-actions.tsx`(單一動作,如刪除/改狀態這類),沒有逐格編輯的 data grid。

### Shopify(https://help.shopify.com/en/manual/shopify-admin/productivity-tools/bulk-editing)
- **有真正的試算表格 Bulk Editor**:選取商品 → Bulk edit → 表格畫面,欄=屬性(price/SKU/compare-at price 等,可自訂顯示哪些欄)、列=商品或變體,直接點格子編輯。
- 快捷鍵:方向鍵移動、Alt/Cmd+click 多選不連續格、Shift+click 選連續範圍、拖曳選取多格同時輸入、拖曳「fill handle」把一格值套用到上下多格、拖曳欄寬。
- 限制:多變體商品的**庫存**只能在 Inventory 頁 bulk edit,不能在商品 bulk editor 改;Edge 瀏覽器因 URL 長度限制易出錯,建議 Chrome/Firefox/Safari。
- CSV 匯入/匯出見第 2 節(比 bulk editor 支援更多欄位、量更大)。
- Collections/Customers 也共用同一套 bulk editor 元件。

---

## 6. 分類/系列(Collection/Category)模型

### Shopify(https://help.shopify.com/en/manual/products/collections 與 .../collections/conditions)
- **Collection**(單層、非階層,但可「Nested collections」把多個既有 Collection 合成一個新 Collection——概念上像 group,不是嚴格樹狀分類)。
- 手動 vs 自動二選一(也可混合):
  - 自動 = 設定 Conditions(依 product/variant title、type、vendor、category、tag、status、price/compare-at-price/weight/inventory stock、metafield、metaobject reference),**單一 Collection 最多 60 條 conditions**。
  - 手動 = 直接勾選商品/變體加入。
  - 也支援「自動排除」條件(僅 category/tag/type/vendor 四種條件類型可用於排除)。
  - Match all conditions(AND)vs Match any condition(OR)。
- Source 可以是 **Products 或 Variants**(即可以做到「只把特定顏色的變體」歸進某 Collection,而非整個商品)。
- Product 側只有一個 `Product category`(Shopify Standard Taxonomy,單選、影響稅率與 category metafields),與 Collection 是兩個不同機制;Collection 才是店面「分類頁」的呈現單位。

### Medusa v2(GitHub 原始碼)
- `ProductCollection`:扁平(title/handle/products hasMany),**無父子階層**,類似 Shopify 的手動 Collection,但**未看到 conditions/自動規則機制**(schema 只有商品清單關聯,未查到自動篩選欄位;標記為「未確認是否在別處實作」,已試 product.ts/product-collection.ts 原始碼與 docs 首頁皆未提及自動規則)。
- `ProductCategory`:**有明確階層**——`parent_category` belongsTo 自己 + `category_children` hasMany 自己 + `mpath`(materialized path,用於快速查子孫)+ `is_active` / `is_internal` / `rank`。這是樹狀分類,對應 Shopify 的 Standard Product Taxonomy 概念(單一階層分類),但 Medusa 這邊**商家可自建無限層級的分類樹**(Shopify 是官方預定義分類、不可自訂結構)。
- 一個 Product 可屬於多個 Category(manyToMany)、多個 Tag(manyToMany)、僅一個 Type(hasMany 反向、即 Type→many Products)、僅一個 Collection(belongsTo)。

---

## 7. 草稿/發布/排程

### Shopify ProductStatus(逐字,https://shopify.dev/docs/api/admin-graphql/latest/objects/Product 的 ProductStatus enum + product-details-page 文件)
- `ACTIVE`:商品完整、可販售,**新建商品預設值**。
- `DRAFT`:商品資料未完成,**複製商品/取消封存後的預設值**。
- `ARCHIVED`:資料完整但停售,從前台與後台主列表隱藏(移到 Archived 分頁)。
- `UNLISTED`:資料完整、可販售,但不可被搜尋/Collection/sitemap 發現,只能用直接 URL 存取;自動加 `noindex`/`nofollow`;不可發布到第三方銷售通路。
- **排程發布**(https://help.shopify.com/en/manual/shopify-admin/productivity-tools/future-publishing,逐字確認):在 Publishing 區塊每個銷售通路旁點日曆 icon,設定未來發布日期時間;GraphQL 對應 `resourcePublicationOnCurrentPublication.publishDate` + `isPublished` 布林(shopify.dev scheduled-product-publishing 文件範例)。**排程是「每個銷售通路各自可設定一個發布時間」,不是整個商品一個全域排程欄位**。

### Medusa v2 ProductStatus(逐字,https://raw.githubusercontent.com/medusajs/medusa/develop/packages/core/types/src/product/common.ts)
- `"draft"` `"proposed"` `"published"` `"rejected"` ——四值,語意像審核工作流(draft→proposed→approved/rejected→published)而非 Shopify 的「發布通路可見性」語意。
- **未查到 Medusa 原生的「排程未來發布」欄位或機制**(product model 無 publish_at 之類欄位;已試 product.ts 全文、docs Product module 頁,皆無排程相關敘述,標記未確認/可能需自建 workflow+cron)。
- Sales channel 可見性是獨立機制:Product 與 SalesChannel 透過另一 module link(非本輪查證範圍,標記未確認細節),UI 上有 `ProductSalesChannelSection`(見第 1 節側欄)。

---

## 未確認清單(禁止推測、如上已標記,彙總)

1. Shopify Product 詳情頁「主欄 vs 側欄」的精確二分,是業界公開共識推論、非 help.shopify.com 逐字聲明(該頁只給 TOC 順序)。已試:help.shopify.com product-details-page 全文抓取(無 layout 關鍵字)、firecrawl_search 查截圖描述(0 結果)。
2. Shopify `InventoryItem.unitCost`(成本)與 weight 確切 GraphQL 路徑未逐一查證(WebFetch 對 ProductVariant 頁摘要未列出,需另開 InventoryItem 物件頁才能確認)。
3. Medusa 官方文件/schema 是否有「每商品最大 Option 數 / 變體數」的 hard limit——未找到,可能只受 UI/效能隱性限制。
4. Medusa Pricing module 如何把 Price 掛到 ProductVariant(module link 表結構)——只確認「不在同一張表」這個事實,link 機制細節未查。
5. Medusa CSV 匯入/匯出的確切欄位清單——admin dashboard 前端原始碼找不到欄位定義(邏輯在後端 workflow),已試 product-export 元件路徑、GitHub 檔案清單。
6. Medusa ProductCollection 是否支援類似 Shopify 的自動規則(conditions)——schema 層未見,未查是否在企業版/外掛層實作。
7. Medusa Product 與 SalesChannel 的 link 機制細節、以及是否有排程發布能力——未查到。

---

## PCM 商品後台最該抄的 5 件事

1. **兩欄式 detail 頁 + 明確側欄分組**(Medusa 的 `LayoutComposer` main/side 拆法最乾淨可抄):主欄放「內容創作」類(標題/描述/媒體/選項/變體),側欄放「後設資料」類(銷售通路/組織分類/物理屬性/狀態)。PCM 是代購站,主欄可直接對應「商品資訊+變體規格」,側欄對應「供應商/分類/狀態」。
2. **Option/OptionValue 拆成獨立 model、可重用跨商品**(Medusa 做法優於 Shopify 的「Option 綁死單一商品」)——PCM 大量規格變體(顏色/尺寸/年式)若能共用同一組 Option 定義,新增商品時選現成 Option 比每次重打省事,尤其同供應商多商品共用顏色/尺寸命名時。
3. **變體矩陣批次生成 + 批次複製**(Shopify「Add values to an existing option」與「Duplicate multiple variants in bulk」)——PCM 有大量規格變體,手動一個個建變體不可行,這兩個操作模式直接解決「加一個新規格值,自動長出所有組合」的痛點,是最高槓桿的一個抄法。
4. **變體與媒體 many-to-many 綁定**(Medusa 允許一張圖綁多個變體、一個變體多張圖,比 Shopify「每變體限 1 張」寬鬆)——代購商品常見「同色不同年式共用同一張官方圖」,many-to-many 省去重複上傳。
5. **分類用「階層 Category(單選/樹狀,對應官方分類與稅務/篩選)+ 扁平 Collection(可多選、用於前台策展)」雙軌並存**(Shopify 的 Product category vs Collection 分工、Medusa 的 Category 樹狀 vs Collection 扁平分工,兩家都收斂到同一個模式)——PCM 目前分類樹單一軌道,可考慮拆成「稅務/篩選用的單一嚴謹分類」+「行銷用可重疊的策展集合」兩層,不用互相遷就。
