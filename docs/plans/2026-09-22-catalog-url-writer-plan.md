# 列表頁 / 商品頁網址寫入集中處理 —— plan(:901 的第二半;Sean 2026-09-22 選乙、同意範圍)

> 前台窗 2026-09-22 寫。上游:`docs/plans/2026-09-20-vehicle-url-silent-drop-plan.md` §9-1 ~ 9-10(網址車款怎麼判斷、客人看到什麼)。
> 本檔取代該檔 §9-11。Sean 2026-09-22 選乙(一次做完整,接受 1.5–2 個工作天),本檔通過 Codex 審查就施工。
> 第一版 R1 FAIL(8)、第二版 R2 FAIL(8)⇒ Sean 選「先做原型實測」。第三版依實測定設計,Codex R1 FAIL(7,全文 `~/pcm-mailbox/codex-901-writer-plan-v3-R1-20260922.txt`)⇒ 補做第二輪實測(含 production build)後改寫 §3、§4,送 R2。
> 🛑 **第三版 R2 仍 FAIL(6 必修),依鐵則 12 停下、不跑 R3、未開始實作。本檔尚不能施工。** 全文 `~/pcm-mailbox/codex-901-writer-plan-v3-R2-20260922.txt`。
> 六項:① 導航完成的清理與落地分類先後、跨掛載的完成追蹤;② 沒有車款的外部導航(如「新品上架」)落地前被後續操作吞掉;③ push 未落地又接 replace 時歷史紀錄會少一筆;
> ④ 搜尋面板選車(push、不預寫)後立刻重新整理會回到舊車;⑤ 選車鏡在 sessionStorage,reload 模擬要保留它;⑥ 原型 S9 違反上游「有關鍵字不讀鏡」、走查資料不足以做分頁情境、production 走查不能退回 dev。
> 實測紀錄:`~/pcm-mailbox/901-原型-20260922/實測結果-20260922.md`(原型程式在同目錄 `app-proto/`,**不在 repo、不被正式頁面 import**)。
> 前兩版審查全文:`~/pcm-mailbox/codex-901-writer-plan-R1-20260922.txt`、`…-R2-20260922.txt`。

## 0. 驗收標準(Sean 原話,經主視窗轉達)

> **「不管客人點多快、點哪裡,車款都會停在 YZF-R7,不會自己跳回去。」**

可以測的說法:客人最後一次選定的車款是 YZF-R7 之後,不論接著多快做任何操作(換分類、翻頁、改排序、清關鍵字、移除膠囊、翻通用配件頁、點頁首「商品目錄」、點麵包屑或相關商品),
① **過程中每一次畫面更新**,選車列都不會顯示 YZF-R7 以外的車;② 所有導航落地之後,網址、選車列、伺服器查商品用的車款三樣都是 YZF-R7;③ 帶去下一頁的連結(商品卡、麵包屑、相關商品、頁碼)帶的也是 YZF-R7。
反過來:客人清掉車款之後連點,車款不會被寫回來。
**例外**(不算「自己跳回去」):客人按瀏覽器上一頁 / 下一頁、或自己開另一個帶車款的網址 —— 那是客人明確要去那個網址。

## 1. 為什麼會跳回去(今天的機制)

列表頁有 10 個地方各自「讀 `window.location.search` ⇒ 改一格 ⇒ `router.replace`」。`router.replace` 要等伺服器回來才落地,落地前 `window.location` 仍是舊的 ⇒ 後一發用舊網址改,把舊車款寫回去。
Codex 隔離執行重現:`?vehicle=yamaha:mt-07&page=3` 清車 ⇒ 依序送出 `/products?page=3`、`/products?vehicle=yamaha%3Amt-07`。
商品頁同理:`ProductFitmentCheck.tsx:137` 依中途落地的網址改畫面與選車鏡;麵包屑、相關商品的連結用的是網址或上一輪伺服器給的車款。

## 2. 會改網址或帶車款去下一頁的地方(2026-09-22 grep + Codex R1 補列)

### 2-1. 列表頁 `/products`:同頁複製舊網址再改

| # | 位置 | 做什麼 |
|---|---|---|
| W1 | `components/use-vehicle-url-sync.tsx:92` | 選車 ⇒ 網址(D) |
| W2 | `components/use-catalog-filter-url-sync.tsx:595` | 分類 / 品牌 / 價格 ⇒ 網址(`:598` 撞同網址時 `router.refresh()`) |
| W3 | `components/products-url-state.tsx:203` | 分頁 / 排序 / 每頁筆數 |
| W4 | `components/ProductsPage.tsx:406` | 通用配件分頁 `upage` |
| W5 | `components/ProductsPage.tsx:627` | 清除全部 |
| W6 | `components/ActiveChips.tsx:96` | 移除分類膠囊 |
| W7 | `components/ActiveChips.tsx:157` | 清除全部 |
| W8 | `components/FilterSide.tsx:259` | 清除全部 |
| W9 | `components/SearchKeywordChip.tsx:100` | 移除關鍵字(`push`) |
| W10 | 新增:提示區塊的「移除車款條件」、建議車款(上游 §9-4) | — |

### 2-2. 列表頁:帶車款去下一頁的連結

| # | 位置 | 今天的車款來源 |
|---|---|---|
| L1 | `components/ProductsPage.tsx` 商品卡 href(`:375-393`) | 選車狀態(上游 §9-5 原本要改成「網址優先」—— 本檔改回用 3-1 的「車款意圖」) |
| L2 | `components/Pagination.tsx:76-109` 頁碼連結 href(`ProductsPage.tsx:161 buildCatalogPaginationHref`) | 目前 `searchParams`;修飾鍵 / 中鍵不攔截(`Pagination.tsx:28`),直接開 href |

### 2-3. 商品詳情頁

| # | 位置 | 做什麼 |
|---|---|---|
| P1 | `components/ProductPage.tsx:117`(`persistVehicle`) | 選車 / 清車 ⇒ 網址;`:111` 等值早退只比短版 |
| P2 | `components/ProductBreadcrumb.tsx:138` | 清除車款(只刪短版) |
| P3 | `components/ProductBreadcrumb.tsx:44`(`withVehicle`)、`:147`(車款標籤跳目錄) | 麵包屑連結帶目前網址的車款 |
| P4 | `components/ProductRelated.tsx:105`(商品卡)、`:110`(看更多) | 用上一輪伺服器給的 `vehicleParam` / `moreHref` |
| P5 | `components/ProductFitmentCheck.tsx:137` | 依網址更新畫面與選車鏡(中途網址也會套) |
| P6 | 新增:商品頁提示的建議車款、網址正規化(上游 §9-3) | — |
| C1 | `components/ProductInfo.tsx:263`(桌機)、`components/ProductPage.tsx:238`(手機) | 加入購物車讀選車鏡 |

### 2-4. 不帶車款、送一整串新網址的導航(逐一界定)

| 位置 | 導航到 | 本案怎麼看待 |
|---|---|---|
| `Header.tsx:206`、`HomeFooter.tsx:140,142`、`ProductsPageHeader.tsx:42`(同頁 `/products`、`/products?filter=new`) | 列表頁,沒有車款 | 「外部導航,網址沒有車款」⇒ 車款意圖**保留**,並補寫進網址(3-3)⇒ 車款停在 YZF-R7 |
| `products-message-state.tsx:212` 原生 `<a>` | 整頁重新載入,網址有關鍵字 | 上游規定「有關鍵字時不讀選車鏡」⇒ 不能靠鏡。**href 直接帶上車款意圖的正規寫法**(意圖是 `vehicle` 時)⇒ 整頁載入後網址本身就有 R7(R2-⑥)|
| `lib/catalog-navigation.ts:32`(`SearchOverlay` / `VehicleFinder` / `CartView` / `CheckoutView` / 麵包屑車款標籤)、`SearchOverlay.tsx:460`(搜尋 API `app/api/search/route.ts:225` 產生的車款網址)| 呼叫端自己組的網址 | **帶車款的:發起當下交接意圖**(3-2,實測 S10);不帶車款的 ⇒ 同第一列 |
| `CategoryGrid.tsx:284`、`brand/BrandAboutRedirect.tsx:91` | 其他頁或目錄 | 同第一列 |

## 3. 設計(依兩輪實測)

### 3-0. 實測告訴我們的事(全表見實測紀錄;dev 與 production build 都跑過)

| 情境 | 今天的寫法(dev / prod) | 本案設計(dev / prod) |
|---|---|---|
| 連點選車或清車後翻頁、換分類、排序(含間隔 400 ms、中途有落地) | ❌ / ❌ 回到舊車 | ✅ / ✅ |
| 撤銷(MT-07 ⇒ R7)後不再操作 | ✅ / ❌ | ✅ / ✅ |
| 搜尋面板選 R7 後立刻排序 | ❌ / ❌ | ✅ / ✅ |
| 選車後立刻重新整理 | ❌ / ❌ | ✅ / ✅ |
| 選車後立刻卸載再掛載 | ❌ | ✅(dev) |
| 選車後立刻移除關鍵字(push)再上一頁 | ✅ / ❌ | ✅ / ✅ |
| 同網址連結、頁首連結、其他上一頁、整頁載入的「查看全部搜尋結果」 | ✅ | ✅ |

決定設計的 Next 行為:
1. `router.replace` 落地前 `window.location` 仍是舊的 ⇒ 讀它的寫入者把舊車抄回去。
2. **dev 會讓連點的每一發依序落地;production 會丟掉未完成的舊導航、只落最後一發** ⇒ 兩種都要撐住。
3. `history.replaceState(history.state, '', url)`(保留 Next 自己的 state)能讓網址列與 `window.location` 立刻變,**`useSearchParams` 不會跟著變**(它仍代表「已落地」);伺服器照樣重查;重新整理保得住。
4. 預先 `pushState` 會讓前一筆歷史留著舊畫面資料 ⇒ `push` 不預寫;上一頁 / 下一頁時 Next 用歷史快取的畫面,可能與網址不一致 ⇒ 上一頁 / 下一頁後 `router.refresh()`。
5. `useTransition` 的 `isPending` 由 true 變 false = 這批導航全部結束(落地或被丟棄)⇒ 可以當「導航完成」訊號。
6. 卸載再掛載時 `useSearchParams` 可能還是舊的 ⇒ 車款意圖必須放模組層。

### 3-1. 三種「網址」要分清楚

| 名稱 | 是什麼 | 誰用 |
|---|---|---|
| **最新目標** | 最後一個自己送出、還沒結束的網址;沒有就是 `window.location` | 所有寫入者組下一個網址的底 |
| **網址列**(`window.location`)| 預寫後就是最新目標(push 除外);較早的一發落地時 Next 會把它改回那一發 ⇒ 我們再寫回最新目標 | 重新整理、分享 |
| **已落地**(`useSearchParams` / `usePathname`)| 伺服器內容對應的網址 | 所有「導航完成了沒」的判斷(W2 分類落地確認、`catalog-pending`)、選車狀態同步 |

### 3-2. 車款意圖(`lib/vehicle-intent.ts`,模組層單一來源)

同第二版:`{ kind: 'vehicle', segment, brandName, modelName?, year? } | { kind: 'none' } | { kind: 'notFound', input }`;`useSyncExternalStore` 訂閱;跨元件卸載保留。
- 客人操作同步改它(選車、清車、清除全部、移除車款條件、點建議)並照今天寫 / 清選車鏡。
- **帶車款的站內導航在發起當下交接**(`navigateToCatalog` 與搜尋面板的車款結果,`lib/catalog-navigation.ts:32`、`SearchOverlay.tsx:460`、搜尋 API 產生的車款網址 `app/api/search/route.ts:225`):解析目的網址的車款 ⇒ 改意圖、寫鏡 ⇒ 清單設成只有這一發 ⇒ `router.push`(實測 S10)。
- 其他外部導航落地時才依網址改(3-4)。

### 3-3. 唯一的送網址出口(`lib/url-writer.ts`)

```ts
export function writeSearch(router: RouterLike, edit: (p: URLSearchParams) => void, opts?: { method?: 'replace' | 'push'; scroll?: boolean }): void;
export function latestTarget(): URLSearchParams; // 給需要先讀再決定的寫入者
export function useUrlWriter(): void;            // 列表頁、商品頁最外層各掛一次:提供 startTransition、落地處理、導航完成處理
```

1. 底 = **最新目標**。
2. `edit(params)` 只改呼叫端自己的參數;車款一律由意圖覆寫(`applyVehicleIntent`)。
3. 結果等於最新目標就不送;不同就推進清單。
4. `replace`:先 `history.replaceState(history.state, '', next)` 再 `router.replace`;`push`:**不預寫**,直接 `router.push`。
5. 兩者都在 `useUrlWriter` 提供的 `startTransition` 裡呼叫(實測 5)。
6. 伺服器端沒有 `window` ⇒ no-op。

### 3-4. 落地與完成(`useUrlWriter` 內)

| 事件 | 處理 |
|---|---|
| 已落地字串**等於上次處理過的**(卸載再掛載)| 不做事(實測 6) |
| 已落地 = 清單裡第 k 個 | 移掉第 1 ~ k 個;**不動意圖**;清單還有剩 ⇒ 網址列寫回最新目標(`replaceState`,保留 state)|
| `popstate` 之後落地(上一頁 / 下一頁)| 清單清空;**意圖改成歷史網址上的車款**(沒有就是 `none`,不補回);`router.refresh()` 一次(實測 4)|
| 其他外部導航落地(頁首 / 頁尾連結等)| 清單清空;網址有車款 ⇒ 依 `resolveVehicleFromUrl` 改意圖(非正規 ⇒ `writeSearch` 改正規;`notFound` ⇒ 意圖 `notFound`);沒有 ⇒ 意圖保留並 `writeSearch` 補寫 |
| 導航完成(`isPending` true ⇒ false)| 清單清空(被丟棄的舊導航不會殘留;實測 S12);網址列若不等於已落地 ⇒ 寫成已落地 |
| 第一次載入 | 網址有車款 ⇒ 同外部導航;沒有 ⇒ 沒有關鍵字時讀選車鏡(照今天),有關鍵字時不讀(上游)|
| 路徑換到別頁 | 清單與「上次處理過的」清空 |

### 3-5. 各寫入點怎麼改

| # | 改法 |
|---|---|
| W1(D) | 客人選車 ⇒ 同步改意圖、寫鏡 ⇒ `writeSearch`(edit 空的)|
| W2 | 讀 `window.location` 的 5 處分兩類:**落地證據**(`:226`、`:230` 裡判斷分類是否已寫入的部分)改讀**已落地**(`useSearchParams`);**組下一個網址與等值早退**(`:230` 其餘、`:473`、`:563`、`:572`、`:594` 撞網址 `refresh` 判斷)改讀**最新目標**。送出換成 `writeSearch`(edit 只設 W2 的參數)。`:273-279` 讓路守衛保留 |
| W3 | `products-url-state.tsx:153,200-201` 改讀最新目標;送出換 `writeSearch` |
| W4 | `writeSearch` 只改 `upage` |
| W5、W7、W8 | 意圖改 `none`、清鏡 ⇒ `writeSearch` 清掉所有篩選參數 |
| W6 | `writeSearch` 移除分類與頁碼 |
| W9 | `writeSearch(..., { method: 'push' })` 移除關鍵字與頁碼 |
| W10 | 「移除車款條件」:意圖 `none` + 清鏡 + `writeSearch`;建議車款:意圖改那台 + 寫鏡 + `writeSearch` |
| L1、L2 | 商品卡、頁碼連結 href 的車款改讀意圖 |
| message-state `<a>` | href 帶意圖車款(2-4)|

`catalog-pending.ts` 已經讀 `useSearchParams`(已落地),**不改**;它在預寫之後不會提早判定完成(實測 3:預寫不改 `useSearchParams`)。

### 3-6. 商品頁

| # | 改法 |
|---|---|
| 初始化 | **只在意圖尚未初始化時**:`resolveVehicleFromUrl`:`ok` ⇒ 那台;`notFound` ⇒ `notFound`;`none` ⇒ 讀選車鏡 |
| P1 | 選車 / 清車 ⇒ 同步改意圖(清車同時清鏡)⇒ `writeSearch`;拿掉 `ProductPage.tsx:111` 只比短版的早退 |
| P2 | 麵包屑清車(`ProductBreadcrumb.tsx:134`):意圖 `none` + **清鏡**(今天沒清,重新整理會帶回來)+ `writeSearch` |
| P3、P4 | 麵包屑、車款標籤、相關商品、看更多的 href 車款改讀意圖 |
| P5 | 適用判斷區顯示改讀意圖 |
| C1 | 桌機與手機都在按下加入購物車當下讀意圖 |

## 4. 測試(證明驗收標準)

### 4-1. 單元測試用的 router(`components/test-utils/next-like-router.tsx`)

照實測建模,**兩種落地模型都要跑**:
- `sequential`(dev 實測):每一發依序落地;
- `latestOnly`(production 實測):新的一發會丟掉還沒落地的舊一發,只落最後一發。
另外:`window.history` 用 jsdom 真的物件,`replaceState` 保留 state 時**不改** `useSearchParams` 的 mock(mock 只在 `flush()` 落地時更新,代表「已落地」);`useTransition` 用真的 React;提供 `back()`(改網址 + `popstate`)、`navigateExternal(url)`、`remount()`、`reload()`(**清掉模組層的意圖、清單、上次處理過的**,只保留網址列與 localStorage,再重新掛載)、render 探針。

### 4-2. 驗收標準本身(列表頁)

每格跑三種節奏 × 兩種落地模型:「每步都不 flush」、「每步之間 flush 一發」(中途有落地)、「每步都 flush」(正對照)。起始網址與 mock 商品數都是畫面上真的做得到的:

| # | 起始網址 | 連點序列 | 斷言 |
|---|---|---|---|
| T1 | `?vehicle=yamaha:mt-07&page=3`(總數 > 3 頁)| 選 R7 ⇒ 換分類 ⇒ 點頁碼 2 ⇒ 改排序 | 探針:選 R7 之後從未顯示 MT-07;最後已落地、網址列、選車列、最後一個送出的伺服器請求都是 R7;商品卡與頁碼 href 帶 R7 |
| T2 | `?vehicle=yamaha:mt-07&category=<分類>&page=3` | 選 R7 ⇒ 移除分類膠囊 ⇒ 點通用配件頁碼 2 | 同上 |
| T2b | `?vehicle=yamaha:mt-07&search=<字>` | 選 R7 ⇒ 移除關鍵字(push)⇒ 改排序 | 同上;歷史多一筆 |
| T3 | `?vehicle=yamaha:yzf-r7&category=<分類>` | 清除全部(三個入口各一格)⇒ 改排序 ⇒ `reload()` | 沒有車款 |
| T4 | `?vehicle=yamaha:mt-07&page=3` | 清車 ⇒ 點頁碼 2 ⇒ 換分類 | 沒有車款;探針不回到 MT-07 |
| T5 | `?vehicle=yamaha:nosuch` | 點建議 R7 ⇒ 改排序 ⇒ 換分類 | R7 |
| T6 | `?vehicle=yamaha:YZF%20R7` | 換分類 ⇒ 改排序 | R7,網址正規 |
| T7 | `?vehicle=yamaha:yzf-r7` | 選 MT-07 ⇒ 選回 R7(之後**不再操作**)| R7;清單在導航完成後清空(`latestOnly` 下也是)|
| T7b | 接 T7 | `navigateExternal('/products?vehicle=yamaha:mt-07')` | 意圖改成 MT-07(殘留清單不會把它當自己送的)|
| T8 | `?vehicle=yamaha:yzf-r7` | 換分類 ⇒ `navigateExternal('/products')` ⇒ 改排序 | R7 |
| T9 | `?vehicle=yamaha:mt-07` | 模擬搜尋面板選 R7(`navigateToCatalog`)⇒ 立刻改排序 | R7 |
| T10 | `?vehicle=yamaha:mt-07` | 選 R7 ⇒ `remount()` ⇒ 換分類 | 探針不閃回;R7 |
| T11 | `?vehicle=yamaha:mt-07` | 選 R7 ⇒ 立刻 `reload()` | R7(網址列已預寫)|
| T12 | `?vehicle=yamaha:mt-07&search=<字>` | 選 R7 ⇒ 立刻移除關鍵字(push)⇒ 等完成 ⇒ `back()` | 已落地、網址列、選車列一致,且呼叫了一次 `router.refresh()` |
| T13 | `?vehicle=yamaha:yzf-r7&search=<字>` | 清車 ⇒ 移除關鍵字 ⇒ `back()` | 以歷史網址為準:沒有車款、有關鍵字,不補回 R7 |

🔴 **負對照(先做、先紅)**:用今天的寫法跑 T1、T4、T11 必須紅。

### 4-3. 伺服器查商品用的車款

`app/products/(catalog)/page.test.tsx` 用各格**最終已落地網址**呼叫頁面,斷言 `fetchCatalogPage` 收到的車款;`?vehicle=yamaha:nosuch` 斷言沒有查商品。
🔵 這一格只證明「網址 ⇒ 伺服器查詢」;「瀏覽器最後顯示的是最後那個網址的回應」由 4-5 的真實瀏覽器驗(畫面上的伺服器內容與網址比對)。

### 4-4. 商品詳情頁

起始 `?vehicle=yamaha:mt-07`:選 R7 ⇒ 立刻點麵包屑 / 相關商品 / 看更多 ⇒ 目的地帶 R7;選 R7 ⇒ 立刻加入購物車(桌機、手機)⇒ 帶 R7;清車(適用判斷區、麵包屑各一格)⇒ 立刻加購 ⇒ 不帶;麵包屑清車 ⇒ `reload()` ⇒ 仍沒有車款;純長版 `?brand=yamaha&model=mt-07` 清除 ⇒ 網址不留車款;選 R7 ⇒ `remount()` ⇒ 不閃回。

### 4-5. 真實瀏覽器

- **production 模式**:storefront `next build` + `next start`,連本機鑽機資料庫(鑽機的 Supabase 替身;做法:沿用 `scripts/storefront-probe/up.sh` 的環境變數,把 `next dev` 換成 `next build && next start`,寫進本片的走查紀錄,不改腳本本身)。若做不到,退回 dev 模式跑,並在回報標明「production 行為只由原型驗證」。
- 鑽機種子只有 Aprilia 兩款與 YZF-R7(`scripts/storefront-probe/seed.sql:131`)⇒ 走查前用 SQL 補一筆 Yamaha MT-07 的車款對應(同今天接線片走查的做法),寫進走查紀錄。
- 用原型的 `runner.js` 改指向 storefront 的真實按鈕,跑 S1、S2、S3、S5、S6a、S6c、S7、S9、S10、S11、S12 對應情境(S8 卸載在 storefront 沒有按鈕,只在單元測試驗),每一步記錄選車列、網址列、已落地網址、畫面上伺服器內容的車款、送出的請求;全部一致才算完成。截圖到 `~/pcm-mailbox/`。

## 5. 拆片與時間(12 片合計約 9 小時 15 分實作 + 每片三綠等待約 1 小時 + 審查約 3 小時 ⇒ 約 13 小時)

| 片 | 內容 | 時間 |
|---|---|---|
| 1 | `resolveVehicleFromUrl` + 建議排序 + `withVehicleParam` + 單元測試 | 45 分 |
| 2 | `vehicle-intent` + `url-writer` + `useUrlWriter`(transition、落地、完成、popstate refresh)+ 單元測試 | 45 分 |
| 3 | 測試 router(兩種落地模型、reload、back)+ T1、T4、T11 負對照先紅 | 45 分 |
| 4 | 列表頁意圖接線 + W1 | 45 分 |
| 5 | W2、W3、W4 | 45 分 |
| 6 | W5 ~ W9 + message-state 連結 + 帶車款導航交接(`navigateToCatalog`、搜尋面板)| 45 分 |
| 7 | W10 + 提示區塊 + L1、L2 + 件數延後(上游 §9-4)| 45 分 |
| 8 | T1 ~ T13 全綠(兩種模型 × 三種節奏)+ 4-3 伺服器測試 | 45 分 |
| 9 | 商品頁初始化 + P1、P2、P5 | 45 分 |
| 10 | P3、P4、C1 + 4-4 | 45 分 |
| 11 | 真實瀏覽器走查(4-5,含 production build)+ 截圖 | 60 分 |
| 12 | 三綠 + `pnpm test` 全套 + 修 | 45 分 |

每片三綠 + 相關測試;碰到客人畫面的片(7、9、10)用鑽機看並截圖;每片送 Codex,R2 還有必修就停。

## 6. 影響

- 客人:連點不會跳回舊車;壞車款網址不再變成全站或舊車;只差空白 / 橫線 / 大小寫的網址直接找到車。
- 行為改變:推翻 08-08 拍板 A(Sean 明示);點頁首「商品目錄」時車款保留並寫進網址(今天是選車列保留、網址沒有、商品沒有按車過濾 —— 本來就不一致);同頁導航到另一個車款網址時選車列跟著網址。
- 不碰 schema / 資料庫 / `packages/ui` / 件數 API。

## 7. Rollback

revert 這一批 commit(預計 12 顆,都在 `agent/ops-17-exthost-correct`)。🔴 片 2 ~ 7 改了所有寫網址的地方,只退其中幾顆會留下一半新一半舊 ⇒ **要整批一起退**。沒有資料庫變更。

## 8. 沒做 / 限制

1. 多個瀏覽器分頁各自有自己的意圖與待落地清單,互不影響。
2. 年份照上游 §9-10,不在本案。
3. 首頁、購物車頁、帳號頁不在本案(它們讀選車鏡,本案選車時照今天寫鏡)。
4. 時間是初估。
5. 本設計依賴 Next 16.3.0 的實測行為(`replaceState` 保留 state 時 `useSearchParams` 不變、production 丟棄舊導航、`useTransition` 涵蓋導航);升級 Next 時要重跑原型 `runner.js` 與 4-5。
6. 客人在「移除關鍵字(push)」等 push 還沒落地時就按重新整理,會回到 push 之前的網址(push 不預寫);車款不受影響(車款的變更都是 replace、已預寫)。
