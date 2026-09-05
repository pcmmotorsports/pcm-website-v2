# Plan · ⟦search-CATSWITCHSLOW⟧ ① 切分類的載入回饋

> 線 `-f3` · 2026-09-06 · **plan 階段,一行 source 都沒動。**
> 主視窗裁:B 開線、先做 ①(回饋);② 為什麼慢**不在這片**。

---

## 0 · 一句白話

客人在手機上點一個分類,要等 **3.4 – 6.3 秒**(正式站量到的),
而這段期間**畫面完全不動、沒有任何提示**。他會以為壞掉 ⇒ 再點一次 / 離開。

**這一片不讓它變快,只讓它【看起來在動】。**
🛑 **兩件事不要混**:①回饋(本片)②變快(`⟦search-CATSWITCHSLOW⟧` 留 open,**未量**)。

---

## 1 · 前置事實(量到的,附落點)

| 事實 | 落點 |
|---|---|
| RSC 請求 **6–72 ms** 就發出去了 | `~/pcm-mailbox/量-抽屜正式站-20260906.md` §2 |
| **回應** 3.4–8.5 秒(正式站 3371/3378/5487/6259 ms) | 同上 |
| Next 只在 transition commit 時才寫網址 ⇒ 那之前網址不動 | 同上 §0 |
| 發起導覽的是 `useCatalogFilterUrlSync`,掛在**頁層** | `ProductsPage.tsx:208` |
| 「查看 N 件商品」那顆鈕 **`onClick={onClose}`、零 dispatch** | `FilterDrawer.tsx:411` |

📌 **最後一條決定了回饋要放哪裡**:按下「查看」的當下抽屜就關了,
而延遲發生在**它關掉之後** ⇒ 回饋若只做在抽屜裡,客人**看不到**。

---

## 2 · 鐵則 1:真權威查了什麼、查到什麼(**含分母**)

### 2.1 `design-reference`(本樹 176 檔,`design-ref-check.sh` 綠)
· 掃 `skeleton|spinner|loading|載入中|isPending` ⇒ **10 檔命中**,而逐檔開來看:
  8 檔是 `loading="lazy"`(圖片屬性)或 handoff 文件 ⇒ **與載入態無關**。
· 🟢 **唯一一個真的形狀** = `components/StorePickerModal.jsx:43,92,146-151`:
  `geoState` 走 `idle | loading | ok | error`,而**進行中時那顆鈕自己**
  ①加 `is-loading` class ②`disabled` ③**文字換成「定位中…」**。
· 🟢 正對照:同一批檔掃 `product` ⇒ **44 檔** ⇒ 這把尺會動,10 不是瞎的。

### 2.2 OD 專案(鐵則 1 要求的另一半)
⚠️ **`list_projects` 這次叫不動**(daemon 未起:`cannot reach … 127.0.0.1:7456`)
⇒ 照鐵則 1 訂正句「**數字不合 ⇒ 以磁碟為準**」,改數磁碟:**12 個專案**。
顧客站的真權威 = `pcm-home-redesign`。

· 🔴 **商品目錄那一頁 `products-list-page.html` ⇒ `skeleton|spinner|載入中|更新中|is-loading` 命中 0。**
  🟢 正對照:同一檔掃 `filter` ⇒ **31** ⇒ 尺是活的,0 是真的 0。
  ⇒ 📌 **稿【沒有】畫過「切分類時長什麼樣」。**

· 🟢 **而稿裡有一句直接管到本片的話** —— `brand-page.html:736-745`(2026-08-06 Sean 那一條的脈絡):
  > 「原本這一區用的是**灰色線框骨架**…當時的理由是『沒有商品資料就不編假的』——
  > 　理由成立,但做法錯了:**骨架該用在載入中,不該當成最終樣貌交付**。」
  ⇒ 🎯 **「骨架的正當用途就是載入中」是稿裡寫著的,不是我發明的品味。**
  ⚠️ **而它沒有畫出那個骨架長什麼樣**(那一段講的是把骨架**移除**)⇒ 樣式細節仍是空白。

### 2.3 codebase 現成的(不新造)
· `apps/storefront` **沒有**通用 skeleton / spinner 元件(`SearchOverlay.tsx:328` 那句註解
  自己記著「八個字面全 0」⇒ **別人已經量過同一件事**)。
· 唯一的 spinner = `styles/checkout.css:804 .co-pay-overlay-spinner`,**結帳付款遮罩專用**。
· `isPending` 的既有用法 = **3 支帳號表單**(`InlineAddressForm.tsx:84,357` ·
  `InlineVehicleForm.tsx:116,358` · `ProfileTab.tsx:56,197`),形狀一律 `disabled={isPending}`。

---

## 3 · 做什麼(三格,每一格都指得出它抄的是哪個既有形狀)

### 3.1 讓 hook 有一個「還在飛」的訊號
`use-catalog-filter-url-sync.tsx` 現在直接呼叫 `router.replace(next, …)`。
✅ 改成包在 `useTransition` 的 `startTransition` 裡,把 `isPending` **回傳出去**。
🔵 **為什麼是 `useTransition` 不是自造 state**(主視窗指定,而理由要寫得出來):
  App Router 的導覽本來就跑在 transition 裡,`isPending` **從發起一路 true 到 RSC commit**
  —— 那正好就是我們要蓋住的那 3.4–6.3 秒。自造 state 要自己猜什麼時候關掉,**而那是猜的**。
⚠️ **hook 的回傳型別今天是 `void`**(`use-catalog-filter-url-sync.tsx:166`)。
  🔴 **⛔ ~~唯一呼叫端 `ProductsPage.tsx:208`,含測試共 2 處~~ —— 我寫的時候沒數就寫,
     當場 grep 是【31 處】**:正式碼 **1**(`ProductsPage.tsx:208`)+ 測試 **30**
     (`products-url-state.hooks.test.tsx` 29 · `use-deep-link-restore.test.tsx:112` 1)。
     舊字面留刪除線 —— 今晚這是我第三次「抄一個數字/座標而沒有當場量」。
  🔵 **而這個數字不改變做法,它改變的是【風險描述】**:`void` → `{ isPending }`
     對**忽略回傳值**的呼叫端是相容的 ⇒ **那 30 處測試一行都不用改**;
     ⚠️ 而「不用改」這句話**要由 typecheck 印出來證實**,不是我推的。

### 3.2 回饋放哪(**放頁面上,不放抽屜裡**)
理由見 §1 最後一條:抽屜按完就關了。
✅ **形狀抄 `StorePickerModal`** 那一套(稿裡唯一的既有形狀):
  · 件數那一行(`.pp-count`)在 pending 時**文字換成「更新中…」**
  · 商品格線加一個 `is-loading` class(**降低不透明度 + 停用點擊**),不新造元件
⇒ 📌 客人看到的是「**我剛剛那一下有被接到,它在跑**」,而**不是**一個假的進度條。

### 3.3 抽屜那顆鈕在關閉前也要吱一聲
`FilterDrawer.tsx:411` 現在是 `onClick={onClose}` —— 按下去抽屜立刻消失。
✅ 最小改動:**pending 時鈕文字換成「套用中…」+ `disabled`**(同 StorePickerModal 三件套),
  **而抽屜仍然關**(不改關閉時機 —— 改它是另一種行為,不在本片)。
⚠️ 🔴 **這一格有一個我答不出來的取捨,要拍板** —— 見 §6。

---

## 4 · 測試(每一發寫出它在哪個世界會紅)

1. **hook 回傳 `isPending`**:`startTransition` 期間為 `true`、commit 後為 `false`。
   🔴 拿掉 `startTransition` 包裹 ⇒ 恆 `false` ⇒ 這一格紅。
2. **`.pp-count` 在 pending 時印「更新中…」**、非 pending 時印件數。
   🟢 **正對照**:非 pending 世界必須印**件數**(否則「永遠顯示更新中」也會過)。
3. **格線的 `is-loading`**:pending 時有、否則沒有。
4. 🔴 **回歸**:`products-url-state.hooks.test.tsx` 現有 **35 格**必須全綠
   —— 那支 hook 是本 repo 最密的 race 修法聚集地,**包一層 transition 不得改變任何既有行為**。

🛑 **本片不寫「延遲變短了」的任何斷言** —— 它一秒都沒變快。

---

## 5 · 預期影響面 / rollback

| 面 | 影響 |
|---|---|
| 手機抽屜切分類 | 目標行為 |
| **桌機側欄** | 🔴 **同一支 hook** ⇒ 桌機也會看到「更新中…」;`multi-category-sidebar.spec.ts` 必須照跑 |
| `packages/ui` | **不碰** |
| rollback | 單顆 `git revert`;無 DB、無 env、無對外副作用 |

---

## 6 · 🔴 這份 plan 答不出什麼(要拍板的那一格)

**稿沒有畫過切分類的載入態**(§2.2,命中 0 + 正對照 31)。
§3 選的形狀是**從稿裡兩個既有形狀推出來的**(StorePickerModal 三件套 + 「骨架用在載入中」那句),
**而它不是稿本身** ⇒ 以下這一格是品味,我不自己拍:

```
Q-切分類的載入回饋長什麼樣: 客人手機上點一個分類, 要等 3-6 秒才看到結果,
  現在這段時間畫面完全不動。要讓他看到什麼?
  甲 = 最小: 件數那行變「更新中…」+ 商品格線變淡(不新造元件, 最快能上)
  乙 = 骨架: 商品格線換成灰色卡片骨架(稿裡說骨架就是給載入中用的, 而稿沒畫過它長怎樣)
A: 甲 | 乙
```
🔵 **我推甲** —— 乙要新造一套視覺,而**稿沒有畫**,那等於我替 Sean 決定了外觀;
甲兩個形狀都能指到既有落點。**乙不是壞選項,它只是需要他先看過。**

**其他答不出的**:
· **② 為什麼要 3–8 秒 —— 完全沒量。** 候選:server query / facet 計算 / cold start。留 `open`。
· **哪些分類會慢** —— 只試了 3 個。
· **真手機 + 行動網路** —— 沒量,而它只會更慢。
