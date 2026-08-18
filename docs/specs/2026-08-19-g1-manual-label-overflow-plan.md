# `#659?` slice plan · 手機商品頁向右滑動 —— 說明書名字太長把整頁撐寬

> 作者:G1 · 落檔 2026-08-19(`date` 實跑)· 🔴 **狀態:尚未批准,code 一行未動。**
> 來源:**Sean 親自報的**,逐字(主視窗轉貼原文):
> 「我發現手機點網站開啟商品時候,會因為說明書名字太長,導致頁面太寬可以滑動到右邊」
> 舉例網址 `https://shop.pcmmotorsports.com/products/gbracing-ec-r9-2025-set-gbr`

## ⓪ 先講一件事:**Sean 的用詞是對的,我的讀圖是錯的**
主視窗提醒「他說『說明書名字』,而我在截圖上看到的像是【規格選項名稱】,先驗是哪一個」。
**驗完:就是說明書名字。** 那串 `(FS-R9-2025-R)` 不是下拉選單,是**第二份說明書**的 chip。
⇒ 這一格如果照讀圖去修,會修到 `ProductInfo.tsx` 的變體選擇器 —— **完全錯的地方**。

## ① 誰撐寬的(量到的,`selfCheck.ok=true`)

用 **repo 自己的尺** `scripts/storefront-probe/overflow-ruler.mjs`(整份注入正式站頁面跑,沒有自寫平行尺):
```
viewport 390 × 844   innerWidth 390 ✅  fingerprintOk ✅
selfCheck { ok:true, widthOk:true, probeSeen:true, before=afterRemoval=1 }

findings（就一個）:
  a.pd-ir-doc-sm   over=301   w=656
document.documentElement.scrollWidth = 691   （= 390 + 301，對得起來）

skippedInHorizontalScroller: 146 個（pd-hero-slide / pd-gb-mcard*…）
  ⇒ 那些是輪播、本來就該超出視窗，尺照設計排除，**而我把筆數附上，不靜默丟掉**
```
**元素內文與來源**:
```
.pd-ir-doc-n 文字 = 「安裝說明書(YZF-R9 MT-09 Tracer Tracer GT plus and Scrambler XSR900 XSR900 GP 2025-2026)」
                    **82 個字**、white-space=nowrap、寬 609px（視窗才 390）
渲染        apps/storefront/src/components/InstallResources.tsx:208  <span className="pd-ir-doc-n">{m.label}</span>
CSS         apps/storefront/src/styles/product-page.css:1776  .pd-ir-doc-n { font-weight: 600; white-space: nowrap; }
            apps/storefront/src/styles/product-page.css:1769  .pd-ir-docs-sm { display:flex; flex-wrap:wrap; gap:8px }
資料        product.manuals[0].label ← products.manuals ← 報價單 pdf_urls（GB Racing 官方 PDF 檔名）
```
🔴 **機制**:`nowrap` 讓 82 字不能換行 ⇒ chip 取 max-content 寬 656px ⇒ 撐破 390 視窗。

## ② 是不是只有這一頁
```
InstallResources 的呼叫端只有 2 個（git grep，排除測試）:
  apps/storefront/src/components/ProductTabs.tsx:192   ← 真商品頁，傳 manuals
  apps/storefront/src/app/dev-preview/brands/[slug]/page.tsx:119  ← dev preview，只傳 videoUrl、不傳 manuals
⇒ **說明書 chip 只出現在商品明細頁**，列表頁 / 購物車沒有它。
⇒ 而不論有幾頁會中，**修法都在同一個元件的同一段 CSS** ⇒ 這一格不改變修法射程。
```
⚠️ **我沒有量「還有幾個商品的 label 也這麼長」** —— 那要查正式庫 `products.manuals`,不在本輪範圍。
**這是我沒查,不是查無。**

## ③ 設計真權威怎麼寫(鐵則 1,兩道都跑)
```
道一 design-reference:分母 49 檔（html/css/jsx/js）⇒ `pd-ir-doc` **命中 0 檔**
     ⇒ 這個元件不在 design-reference 裡（與商品頁其他片一樣，真權威在 OD）
道二 OD list_projects ⇒ 9 個專案；本線真權威 = pcm-home-redesign
     search 'pd-ir-doc' ⇒ pcm-product.css:708 逐字
       `.pd-ir-doc-n { font-weight: 600; white-space: nowrap; }`
     ⇒ **storefront:1776 與它一字不差 —— `nowrap` 是從 design 搬來的，不是我們加的**
```
🔴🔴 **而 design 自己【想過長標籤】,只是它的長標籤比真實世界短四倍**:
```
OD product-detail-data.js:305-313  註解逐字:
   /* Evotech 型:… 測的是**長標籤**:同類多份、括號接車款檔名。 */
   { label: '安裝說明書（1198 2007-2013）', … }      ← **20 個字**
真實世界那一筆                                        ← **82 個字**
```
⇒ **design 對「82 字的標籤」是沉默,不是決定** —— 它的壓力測試案例只到 20 字。
與 `#309` 同族(memory `feedback_copying-design-literally-inherits-its-bugs`:
「鐵則 1 講的是不要重新詮釋,**不是連疏漏也照抄**」)。
🔴 **代裁:MAIN 已對 `#309` 建立同款裁定,本條沿用而【標明是沿用、可推翻】。**

## ④ 修法射程:**CSS,不是資料**
```
資料那半我們控制不了 —— label 來自【供應商官方 PDF 的檔名】（GB Racing 這份就是車型全列表）。
改資料 = 要在上架流程截斷檔名 ⇒ ①治不了下一個供應商 ②會把客人需要的資訊剪掉。
⇒ CSS 必須對任意長度穩健。
```

### 候選修法(**兩條宣告**,不動 HTML、不動資料、不動元件)
```css
.pd-ir-doc-sm { max-width: 100%; }
.pd-ir-doc-n  { white-space: normal; overflow-wrap: anywhere; }
```

### 🔴 我在真正式站上把三個世界都量了(不是「應該可以」)
```
before   findings=[pd-ir-doc-sm over=301 w=656]   docScrollWidth=691   chipW=656
after    findings=[]                              docScrollWidth=**390**  chipW=320   ✅ 完全貼齊視窗
halfFix  只加 max-width、留著 nowrap:
         findings=[pd-ir-doc-n over=266, pd-ir-doc-dl over=289]  docScrollWidth=679
         ⇒ **半套修法擋不住** ⇒ 證明兩條宣告【都】在承重，不是其中一條多餘的
三發的 selfCheck.ok 全 true。
```

## ⑤ 檔案射程 = **2 檔**
```
apps/storefront/src/styles/product-page.css        兩條宣告
apps/storefront/src/styles/product-page.test.ts    CSS 規則守門（本 repo 既有慣例，見 #310）
```
⇒ **未命中鐵則 8**(未達 3 檔)。鐵則 12 六類逐字對過 **零命中**(不碰 packages/ui、金流、schema、平台設定、對外發送)。

## ⑥ 驗收條件(每條可 yes/no)
1. 同一支尺、同一個網址、390 寬:`findings` **為空**、`docScrollWidth === 390`、`selfCheck.ok===true`。
2. **負向對照**:把兩條宣告拿掉其中任一 ⇒ 必須**重新紅**(上面 halfFix 已先證了 `max-width` 那半)。
3. `product-page.test.ts` 新守門:`.pd-ir-doc-n` 的 `white-space` **不得是 `nowrap`**,且 `.pd-ir-doc-sm` 必須有 `max-width`。**兩條各配一個突變**證明會紅。
4. **不得回歸**:短標籤那份(`安裝說明書(FS-R9-2025-R)`)的 chip 外觀不變 —— 它本來就在一行內,`white-space:normal` 不會拆它。
5. 四綠(`TURBO_FORCE=1`,動 `.css` ⇒ **含 build**)全 rc=0。

## ⑦ 影響面 / rollback
- 影響面:商品明細頁的說明書 chip。**零 schema、零 API、零資料遷移、零後端。**
- rollback:單一 commit `git revert`。
- 🔴 **這是【正式站現在就在發生】的客人可見缺陷** —— 修完要跟著推,而推的時機由 Sean 決定。

## ⑧ 我沒做的事(免得被讀成做完了)
- **沒有碰正式站的任何寫入**;全程只有一個 GET 與唯讀量測。
- **沒有量「還有多少商品的 label 過長」**(要查正式庫)。
- **沒有用 storefront-probe 拋棄式環境** —— 種子商品沒有這種 82 字 label,量了也重現不出;
  我改成**直接量 Sean 給的正式站網址**(唯讀開網頁)。**我量的世界 = 正式站,不是拋棄式。**
- **沒有量其他視寬**(只量 390)。更窄的機型(例如 320)未量。
