# plan · 車款讀不到的時候要講一句(Sean 拍甲)

> 立於 2026-09-06 · 線 `front` · **碼未動,等主視窗批**
> 板列 `⟦search-TAXONOMYTIMEOUT⟧`(`docs/launch-todo.md:2202`)
> Sean 拍板:**甲 —— 要,用同一句**「車款清單暫時無法載入,請稍後再試或改用自行輸入」;
> 四處 = 首頁選車 / 型錄側欄 / 商品頁車款區 / 購物車。

---

## 1 · 今天的事實(量到的,不是推的)

`apps/storefront/src/lib/products.ts` 有一對門,而**同一句註解「刻意丟掉 `failed`」出現三次**:

```
:622  fetchCatalogBrandTaxonomy   丟掉 tryCatalogBrandTaxonomy 的 failed
:728  fetchCategories             丟掉 tryCategories 的 failed
:1016 fetchVehicleTaxonomy        丟掉 tryVehicleTaxonomy 的 failed
```

**兩扇門各有多少人走**(數法:`git grep -n` 那三個名字,濾掉 `.test.` 與註解行與 `products.ts` 自己):

```
說實話那扇門 try*    相異檔 2   app/api/search/route.ts · lib/brand-products.ts
不說話那扇門 fetch*  相異檔 9
負對照 現造 fetchZqNopeTaxonomy ⇒ 0
```

🔴 **而 `tryVehicleTaxonomy` 一個外部消費端都沒有** —— 它只被同檔的 `fetchVehicleTaxonomy` 呼叫。
📌 **⇒ 這一片要用的機器【已經造好了,而從來沒有人接上它】。**

**Sean 點名的四處,各自從哪裡拿**:

| 面 | 拿的地方 | 交給誰 |
|---|---|---|
| 首頁選車 | `app/page.tsx:110` 的 `Promise.all` | `<VehicleFinder motoBrands={…}>`(`:174`) |
| 型錄側欄 | `app/products/page.tsx:99` 的 `Promise.all` | `ProductsPage` 的 `motoBrands` prop(`:152`) |
| 商品頁車款區 | `app/products/[slug]/page.tsx:104` | `<ProductPage motoBrands={taxonomy}>`(`:172`) |
| 購物車 | `app/cart/page.tsx:27-28` | `<CartView motoBrands={…}>`(`:51`) |

## 2 · 🔴 鐵則 1:**稿裡沒有這個元件的錯誤態**(查無,而分母寫出來)

```
分母      design-reference 176 個檔(`bash scripts/design-ref-check.sh` ⇒ ✅ 正對照 README.md 在)
載入失敗   1 檔   design-reference/design-reference/HANDOFF-DETAILS.md:607(講 Leaflet 地圖降級, 不是本題)
暫時無法   1 檔 ┐ design-reference/components/ErrorPage.jsx:7-8
稍後再試   1 檔 ┘ 逐字「服務暫時無法使用 / 我們正在處理、請稍後再試。如持續發生、請聯絡客服。」
empty-state 0 檔
負對照 現造 zqerrnope ⇒ 0 檔
```
🎯 **`ErrorPage.jsx` 是【整頁】錯誤頁,不是【一個下拉旁邊】的一行字** ⇒ **稿裡沒有這一態。**
✅ **⇒ 不發明樣式,沿用站內既有的那一組**:
`apps/storefront/src/components/products-message-state.tsx:18` 的 `MESSAGE_STATE_STYLE`
+ `role="alert"`(用法逐字見 `ProductsPage.tsx:378-381`)。

## 3 · 兩個案,而差別是【誠實】對【diff 大小】

| | 案 A(推薦) | 案 B |
|---|---|---|
| 做法 | 四處改呼叫 `tryVehicleTaxonomy()`,把 `failed` 當 prop 傳到那四個元件 | 四處不動資料層,元件自己判 `motoBrands.length === 0` |
| 誠實 | 🟢 **「讀不到」與「真的沒有」分開** | 🔴 兩者合成一個值 |
| diff | 4 支 route + 4 支元件(多一個 prop) | 4 支元件 |
| 對齊 | 🟢 本 repo 這條規矩**已經做過四次**(見 §4) | 🔴 與那四次相反 |
| 風險 | prop 要一路傳,漏掉一處**不會紅** | 車款樹若哪天合法為空,會顯示一句假的錯誤 |

### ✅ 推薦 **案 A**,三個理由
1. **機器已經在了** —— `tryVehicleTaxonomy` 就是為這件事寫的,而它今天零消費端。
2. **本 repo 這條規矩已經做過四次**,車款是唯一的例外(§4)。
3. 案 B 的「`length === 0` 當作失敗」是個**代理**;而 `account/vehicle/actions.ts:43-45`
   今天正是這樣做的 —— ⚠️ 那不是背書,那是**現況**,而本片正好可以把它一起換成真旗標。

## 4 · 這條規矩本 repo 已經做過四次(所以這不是新設計)
```
components/SearchOverlayFacets.tsx:82         facets.failed.brands ⇒ 另一種畫法
components/ProductsPage.tsx:378-381           「載入失敗、請稍後再試」+ role="alert"
components/account/AccountView.tsx:129 逐字   「walletEntriesFailed 與 walletEntries: [] 是兩件事」
app/account/vehicle/actions.ts:45 逐字        「車款清單暫時無法載入,請稍後再試或改用自行輸入」
```

## 5 · 字串單一來源(不複製四份)

**今天那句話只存在一處**:`app/account/vehicle/actions.ts:45`
(數法:`git grep -c "車款清單暫時無法載入" -- apps/` ⇒ **命中 1 支檔, 就是它**。
⚠️ **我第一版在這裡寫「2, 其中 1 是測試」而那是錯的** —— 那個 2 來自另一發較短的字串 `暫時無法載入`,
兩發不是同一把尺。📌 **兩個數不合先問是不是同一種東西。**)

✅ **抽成一個常數,放 `apps/storefront/src/components/products-message-state.tsx`**
(那支檔已經是「訊息態」的家,`MESSAGE_STATE_STYLE` 就住在那裡)⇒
`account/vehicle/actions.ts` 改成 import 它,**inline 字面刪掉**。

🛑 **守門**:加一格「這句話在 repo 裡只有一個定義點」的測試
(`git grep` 那個字面 ⇒ 常數定義處 1 + 測試,零 inline 複本)。
📌 理由不是潔癖 —— `supplier-placeholder.ts` 檔頭逐字警告過「複製成兩份 ⇒ 它們會分岔,而分岔不會紅」。

## 6 · 驗收:四格 smoke,每格都要**兩個世界印不同的東西**

| # | 面 | `failed=true` ⇒ | `failed=false` 且空 ⇒ |
|---|---|---|---|
| 1 | `VehicleFinder` | 那句話在(`role="alert"`) | **不顯示那句話** |
| 2 | `ProductsPage` 側欄 | 同上 | 同上 |
| 3 | `ProductPage` 車款區 | 同上 | 同上 |
| 4 | `CartView` | 同上 | 同上 |

🔴 **每一格都要配那個「空而沒失敗」的負對照** —— 否則一個「無條件印那句話」的實作**四格全綠**。
🛑 **而那正是本 repo 記過的形狀**:恆真守門族。

**突變(每發只動一件,預期各自紅在不同格)**
```
MU1 把某一處的 failed 寫死 false      ⇒ 該面的第一格紅
MU2 把訊息改成無條件顯示              ⇒ 四個負對照格全紅
MU3 抽出去的常數改回 inline 複製一份   ⇒ §5 那格單一來源守門紅
```

## 7 · 鐵則標記 · rollback

| 鐵則 | 判定 |
|---|---|
| 8 重大改動先提 plan | 🔴 **觸發**(跨 8 支檔、動四個元件的 props)⇒ **本檔就是那個 plan** |
| 12 高風險必過 codex | ⚠️ **六類一類都不在**(不動錢/權限/schema/平台設定/對外送出;四個元件都在 `apps/storefront/src/components`,**不是 `packages/ui`** —— 逐支 `git ls-files` 核過:四支在 `packages/ui` 各 0、在 `apps/storefront` 各 1)⇒ 走 `code-reviewer` |
| 11 三綠 | 🔴 動 `.tsx` ⇒ typecheck + lint + **build** |
| 9 內容分級 | **L1**(這句話年 0-1 次會改)⇒ hardcode 可,而放單一來源常數 |
| 1 design | ⛔ ~~§2:稿裡查無此態~~ ⇒ 🔴 **2026-09-06 訂正(R1 must-fix ⑦)**:那句**只查了 `design-reference` 那一半**。補查 OD 之後 —— **OD 那半【有】** ,逐字 `pcm-home-redesign/products-list-page.html` 的 `<div id="pp-error" role="alert" style="padding:64px 0;text-align:center;color:var(--c-text-3);font:14px/1.6 system-ui, sans-serif" hidden>載入失敗、請稍後再試</div>`,而我用的 `MESSAGE_STATE_STYLE` + `role="alert"` **與它逐字相同**(站內那組本來就是從它來的)。⇒ ✅ **結論沒變(沿用站內既有形狀、不發明),而證據原本是不完整的。** 🔬 OD daemon 打不開 ⇒ 照鐵則 1 以磁碟為準:12 個專案;數的時候要排除 `.file-versions`(歷史版灌大分母 19 ⇒ 現行檔 1),且互動層 `grep` 是 shell function(`grep -o` 印不出字面而 `grep -l` 有命中)⇒ 用 `/usr/bin/grep`。 |

**rollback**:純前端顯示層,單次 commit ⇒ `git revert`。零 DB、零快取、零部署順序。

## 8 · 這份 plan 答不出什麼
· **那四處今天多常真的 `failed`** —— 修後的 57014 頻率**未量**(preview 3 小時零命中,而那是低負載我自己的流量)。
· **`fetchCatalogBrandTaxonomy` / `fetchCategories` 那兩扇門要不要一起改** —— **本片不碰**,Sean 拍的是車款那一格。
　🔵 而它們是同一個形狀 ⇒ 建議另開一列,**不要夾進這一片**。
· **手機版那四處的版面** —— 我沒有量過那句話在 390 寬會不會撐破哪一格。
