# 卡片「+ 加入購物車」接線 · 簡式 plan(等回核)

> 派工=`D-227-A` ②。**已批准並施工完畢**(`D-228-A` 拍 Q1/Q2/Q3=A → 施工中 Q1 被 Critical 推翻 →
> `D-229-A` 改拍 **A=有規格導商品頁 / 無規格直加** → `D-230-A` 資料面 plan 核准)。
> 症狀(Sean)=**五**掛載面的快速加購鈕全部無效;根因=**從未接線**。
> ⚠️ 本檔留的是**規劃當下**的樣子(含被推翻的 Q1);最終落地行為以 §4a-③ 與
> `docs/specs/2026-08-08-list-variant-count-plan.md` 為準。

## §1 片型

| 項 | 判定 |
|---|---|
| 片型 | 標準片(`ProductCard` 非 `packages/ui`)|
| 內容分級 | L1 |
| 鐵則 8 | ❌ 未命中(不跨 3 檔、不動 schema/API/共用元件)|
| 鐵則 12 | ❌ 未命中(零錢邏輯——**價不進 CartItem**、server 依 tier 取價;零權限/schema/平台設定)|

## §2 現況實查(全部主對話親自開檔)

| # | 事實 | 位置 |
|---|---|---|
| A | 鈕的 onClick **只有** `preventDefault + stopPropagation`,零加購邏輯=佔位空殼 | `ProductCard.tsx:317`(=`pcard-quick-btn`,**本片編輯後**的行號;規劃當下 :257-263)|
| B | 加購 API=`useCart().addItem(item: CartItem)`;`CartItem` 必填只有 **`productId` + `qty`**,`variantId`/`vehicle` 選填。**不含價格**(鐵則 12) | `CartContext.tsx:100-104,112` |
| C | PDP 兩個入口各自組同一形狀、**不共用 code**:`ProductInfo.tsx:244-257`(qty 來自 UI)與 `ProductPage.tsx:126-142`(qty **寫死 1**);兩者共用的只有 `readSearchVehicle()` | 同左 |
| D | 車款=選填,`readSearchVehicle()` 名稱不齊回 `undefined`、整欄不帶(零猜);無車不擋結帳 | `search-vehicle.ts:13-18`、`CartContext.tsx:102` |
| E | 卡片手上有 `p: MockProduct` ⇒ `productId` 用 `p.slug` **夠**;`qty` **完全缺**(卡片無數量 UI)。⚠️ **`variantId` 那句是本片最大的錯**:當時寫「非缺資料」,實際上變體正是列表**沒帶下來**的資料 —— 那條誤判直接長成後來的 Critical | `ProductCard.tsx:189`(編輯後值;規劃當下 :187-188)|
| F | 掛載面 **props 形狀一致**、皆無 `onClick`(全走 `href`);差異只有 `showRedPrice`/`badgeStyle` 兩個純顯示參數 | `ProductsPage.tsx:399`、`ProductRelated.tsx:105`、`ProductRail.tsx:242-247`(首頁/品牌頁/會員中心經它) |
| G | 既有測試**只驗 `defaultPrevented === true`**(=點了不會跳商品頁),零加購斷言 | `ProductCard.test.tsx:49-64` |
| H | 🔴 掛載面是**五個不是四個**:派工單列的四面之外,**商品目錄 `/products` 也用同一顆 `<ProductCard>`** | `ProductsPage.tsx:399`(`grep -rn "<ProductCard"` 全 repo 只有三個直接呼叫點)|
| I | `CartProvider` 掛在**根 layout**、包住 `{children}` 與 `MobileTabBar` ⇒ **全站都在 provider 內**(沒有漏網頁面)| `app/layout.tsx:106-109` |
| J | 桌機 Header 的購物車數字**早就接好且是 reactive 的**:`const { totalQty } = useCart()` + 兩處 `pcm-cart-dot` | `Header.tsx:58,170,219` |
| K | 🔴 **手機底欄 `MobileTabBar` 的購物車 tab 沒有數字徽章**:該檔 `useCart`/`totalQty` **grep 命中 0** | `MobileTabBar.tsx:93-100`(只有 label/href/matches/icon)|

### 2-1 🔴 兩個實查結果推翻了派工單的前提

**① 「需選規格/必選欄位」這個狀態在現行資料模型下不存在。**
`ProductPage.tsx:117-122` 一 mount 就 `setSelectedVariant(product.variants?.[0] ?? null)`,
`selectSpec` 只換選、回不到「未選」;加購鈕 `ProductInfo.tsx:343` 註解逐字
「**#161 業務拍板:永遠可點、無 disabled**」。
⇒ **PDP 從來沒有「使用者沒選規格」這條路**,不是擋下也不是留白,是自動預設第一個變體。
派工單的決策題要改問「卡片直加時**加哪一個**變體」,不是「沒選怎麼辦」。

**② 手機上這顆鈕現在點不到。**(派工單 ③ 要我給的那句事實)
`product-card.css:169-181` `.pcard-quick { opacity:0; pointer-events:none }`,
`.is-visible` 由 **React `onMouseEnter`** 掛(`ProductCard.tsx:281`,編輯後值;規劃當下 :222-223),不是 CSS `:hover`;
`product-card.css` **全檔零 `@media`**(grep 無命中)⇒ 沒有 `@media (hover: none)` 之類的觸控兜底。
⇒ 觸控裝置沒有可靠的 `mouseenter` 前置事件,且不可見時 `pointer-events:none` 本就擋掉點擊;
第一次點卡片會被外層 `Link` 吃走直接跳商品頁。**手機不可達**,而首頁 rail / 會員中心推薦
正是手機主要動線 ⇒ 只接 onClick 等於只修好桌機那一半。

## §3 要改什麼(⚠️ 規劃當下的版本,已被 §4a-③ 取代)

~~單點:`ProductCard.tsx` 的 `pcard-quick-btn` onClick,改成
`preventDefault + stopPropagation` **之後**呼 `addItem({ productId: p.slug, qty: 1, variantId: …, …vehicle })`。~~
🔴 **`variantId` 那段作廢**(見 Q1 的推翻說明):實際落地是「有規格 → 什麼都不做、讓外層 `<Link>` 導頁;
無規格 → 直加且**刻意不帶 `variantId`**」。
形狀刻意**逐字比照 `ProductPage.tsx:126-142` 的 sticky buybar**(同樣是「沒有數量 UI 的入口」、
同樣 `qty: 1`)——不新發明一套組法,否則就是全站第三份各寫各的加購邏輯。

⚠️ C 那條(兩個 PDP 入口各寫一份)本片**不順手合併**:那是既有重複、動它會把範圍拉進 PDP,
本片再加第三處會讓債更明顯 ⇒ **立 backlog、不在本片解**。

## §4 🔴 待 Sean 拍板(三題;第 2、3 題是偵察挖出來的,派工單沒問)

### Q1 多變體商品,卡片直加要加哪一個?

> 🔴 **2026-08-08 中午已被推翻並重拍,原文保留備查**:施工中 code-reviewer 判 Critical ——
> 列表讀路徑不帶變體資料(`SupabaseProductAdapter.ts:73-74`)⇒ 卡片 `p.variants` 恆空 ⇒
> 送出 `variantId: undefined` ⇒ 購物車 fail-closed 丟整行 ⇒ **幽靈品項**(比原 bug 更糟)。
> Sean 改拍 **A=有規格導商品頁 / 無規格直加**;資料面見
> `docs/specs/2026-08-08-list-variant-count-plan.md`。下表三個選項**皆已作廢**。

| 選項 | 行為 | 代價 |
|---|---|---|
| **A(推薦)** | 比照 PDP 自動取 `p.variants?.[0]?.id` | 與 PDP 逐字一致、零新概念;但使用者不知道自己加到哪個規格 |
| B | 有多個變體就**不直加**、點了導到商品頁 | 語意最誠實;但四個掛載面的快速加購對多變體商品等於沒有 |
| C | 直加第一個 **+ 明示**「已加入:{規格名}」 | 資訊最完整;要 Q2 先決定有沒有回饋 UI |

### Q2 加購成功後給不給回饋?(🔴 我認為這題比 Q1 重要)

現況 PDP 加購**也是零回饋**(無 toast、不開側欄;只有「立即購買」會導頁)。
⇒ 卡片直加若照做,使用者按下去**畫面完全不動** —— 那與 Sean 回報的「按了沒反應」
**在體感上分不出來**。修好了他也看不出來修好了。

| 選項 | 行為 |
|---|---|
| **A(推薦)** | 鈕本身給 1.5 秒的「✓ 已加入」文字回饋(純本地 state,零新元件、零全站影響) |
| B | 做全站 toast(新元件、四掛載面+PDP 一起受惠,但體積大於本片) |
| C | 維持零回饋、只靠右上角購物車數字跳動 |

### Q3 手機上這顆鈕要不要救?(見 §2-1 ②)

| 選項 | 行為 | 代價 |
|---|---|---|
| **A(推薦)** | 本片只接桌機邏輯,**手機可達性另開片** | 手機四面(含首頁 rail、會員中心)這期仍點不到 |
| B | 本片一併加 `@media (hover: none)` 讓鈕在觸控裝置常駐顯示 | 卡片版面會變(鈕永遠壓在圖上)= **視覺題、我不自己拍** |
| C | 手機不做快速加購(維持點卡片進商品頁) | 承認手機只走商品頁動線,鈕在手機是死的 |

## §4a 🔴 Sean 2026-08-08 直接追加(兩件,已實查、都不是新 bug)

### ① 「商品目錄也沒反應」= 同一顆鈕的**第五個掛載面**,不是另一件事

`grep -rn "<ProductCard"` 全 repo 只有三個直接呼叫點,`/products` 商品目錄
(`ProductsPage.tsx:399`)是其中之一 ⇒ 它跟首頁 rail / 品牌頁 / 會員中心 / 相關商品
**是同一顆空殼鈕**。⇒ **一處接線,五面同時好**,不需要為商品目錄另外做什麼。
(派工單 `D-227-A` 列的「四掛載面」漏了商品目錄,此處更正。)

🔴 **2026-08-08 R2 追加式更正(原文保留)**:「一處接線五面同時好」**只對三面成立**。
五個掛載面走**兩條不同的資料路**:
- **走 `toUIProduct`**(首頁 rail / 相關商品 / 會員中心推薦)⇒ 有 `variantCount` 真值 ⇒ 卡片直加正常運作。
- **走 RPC `search_catalog_by_vehicle` → `lib/catalog-page.ts` 的 `catalogRowToUIProduct`**
  (**`/products` 商品目錄** / 品牌頁)⇒ 那支 mapper **沒有 `variantCount` 欄** ⇒ 卡片拿到 `undefined`。
⇒ 依 R2 修法,未知一律走**安全側**(當作有規格、導商品頁),所以那兩面**不會**製造幽靈品項,
但也**還不能**在卡片上直接加入 —— 要讓它們恢復直加,得讓 RPC 帶回變體數(動 DB 函式=另一片)。
**規劃階段沒看到這條路**是本片最大的視野漏洞,照實記。


### ② 「購物車數字要全站連動」— 桌機早就連動了,真正缺的是**手機底欄**

- `CartProvider` 在**根 layout**(`app/layout.tsx:106-109`)包住 `{children}` 與 `MobileTabBar`
  ⇒ **全站都在 provider 內,沒有漏網頁面**。
- 桌機 Header 的數字**已經接好且 reactive**:`Header.tsx:58` `const { totalQty } = useCart()`,
  `:170` / `:219` 兩處渲染 `pcm-cart-dot`。
- ⇒ 🔴 **Sean 看到「數字不動」的原因就是加購從沒接線**(`addItem` 一次都沒被呼叫過)——
  一個根因兩個症狀,不是兩件要分別修的事。**鈕接好的當下,桌機數字自動就會跳。**
- 🔴 **真正缺的那塊**:`MobileTabBar` 的購物車 tab **沒有數字徽章**
  (該檔 `useCart`/`totalQty` **grep 命中 0**,`:93-100` 只有 label/href/matches/icon)。
  ⇒ 手機底部那顆購物車圖示永遠不顯示數字。**這才是「全站連動」需要另外補的一塊。**

**做法(併入本片,體積很小)**:`MobileTabBar` 加 `useCart()` 讀 `totalQty`,
購物車那顆 tab 加一個徽章 `<span>`,CSS 比照 `pcm-cart-dot` 既有樣式。
⚠️ 該檔目前是**純資料驅動的 tab 陣列**(`TABS` 常數在元件外),加徽章要讓 cart 那顆多一個
條件渲染 ⇒ 會動到該檔的渲染結構,不是純加一行;`MobileTabBar` 在**根 layout 每頁都掛**,
所以它從無 context 依賴變成有 ⇒ 收工前跑一次全站 smoke。

## §5 驗收(已落地;實際 16 案在 `product-card-quick-add.test.tsx`,每條配只紅自己的突變)

1. ✅ **無規格**點快速加購 ⇒ `addItem` 被呼、`qty:1`、**不帶 `variantId`**(能走到就保證無變體)
2. ✅ 點快速加購 ⇒ **不導頁**(既有 `defaultPrevented` 那條保留、未回歸)
3. ✅ 選車 context 有車 ⇒ `vehicle` 欄帶上;名稱不齊 ⇒ 整欄不帶(零猜)
4. ✅ **有規格 ⇒ 不加購 + 不擋原生導航 + 鈕字面「選擇規格」**(取代原「依 Q1 拍板結果」;
   含**幽靈品項回歸格**=本片存在的理由)
5. ✅ 回饋:1.5 秒「✓ 已加入」+ 連點計時器重置(時間戳非布林)
6. ✅ 五掛載面 props 形狀一致 ⇒ 一處接線五面同時生效
7. ✅ 手機底欄徽章三格(有東西顯示件數 / 空車不顯 0 / 只掛購物車那顆)
8. ✅ `variantCount` 缺欄(舊資料)⇒ 當無規格處理(向後相容不是意外)

## §6 Rollback

單一 onClick 的單點改動,`git revert` 即完整回退;無資料遷移、無 schema、無 env。

— site-redesign 窗,2026-08-08
