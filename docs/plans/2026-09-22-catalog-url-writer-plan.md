# 列表頁 / 商品頁網址寫入集中處理 —— plan(:901 的第二半;Sean 2026-09-22 選乙、同意範圍)

> 前台窗 2026-09-22 寫。上游:`docs/plans/2026-09-20-vehicle-url-silent-drop-plan.md` §9-1 ~ 9-10(網址車款怎麼判斷、客人看到什麼)。
> 本檔取代該檔 §9-11。Sean 2026-09-22 選乙(一次做完整,接受 1.5–2 個工作天),本檔通過 Codex 審查就施工。
> **第二版**:第一版 Codex R1 FAIL(8 項必修,全文 `~/pcm-mailbox/codex-901-writer-plan-R1-20260922.txt`),設計整段換掉(見 3-0)。
> 🛑 **第二版 Codex R2 仍 FAIL(8 項必修 + 2 小修),依鐵則 12 停下、不跑 R3、未開始實作。本檔尚不能施工。** 全文 `~/pcm-mailbox/codex-901-writer-plan-R2-20260922.txt`。
> R2 八項:① 同網址導航完成不一定觸發落地觀察,待落地清單可能卡住;② W2 保留全部等值早退,接不到撤銷中的操作;③ 外部導航落地前仍會被舊頁操作取消,搜尋車款入口分類錯;
> ④ 漏掉「重試」的整頁重新載入;⑤ 卸載清空清單後重新掛載會採舊網址而閃回;⑥ 原生「查看全部搜尋結果」靠鏡保車與上游「有關鍵字不讀鏡」衝突;
> ⑦ 上一頁回到沒有車款的歷史網址會被補回目前車款(與 T10 矛盾);⑧ T2 不可達(有關鍵字時不畫分類膠囊)、4-3 斷言錯、測試 router 還缺幾種 Next 行為。

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
| `products-message-state.tsx:212` 原生 `<a>` | 整頁重新載入 | 進站流程:讀選車鏡(選車時已寫入 YZF-R7)⇒ 仍是 YZF-R7 |
| `lib/catalog-navigation.ts:32`(`SearchOverlay` / `VehicleFinder` / `CartView` / `CheckoutView` / 麵包屑車款標籤) | 呼叫端自己組的網址 | `VehicleFinder` 帶的是客人剛選的車(本身就是新意圖);其餘沒有車款 ⇒ 同第一列 |
| `CategoryGrid.tsx:284`、`brand/BrandAboutRedirect.tsx:91` | 其他頁或目錄 | 同第一列 |

## 3. 設計

### 3-0. 為什麼換掉第一版

第一版是「所有寫入者在同一個『待落地網址』上改」,Codex R1 指出:撤銷(R7 ⇒ MT-07 ⇒ R7)會被「跟實際網址一樣就不送」吞掉;重按同一頁不會重送;W2 的落地判斷被改壞;連結還是帶舊車。
第二版改成兩個原則:**車款只有一個來源(車款意圖);每一次送出都是完整的最新狀態,最後一發為準。**
Next 自己就會丟掉還沒完成的前一發導航(`next/dist/client/components/app-router-instance.js:147`),所以只要「最後一發」永遠是最新狀態,中途那幾發落不落地都不影響結果。

### 3-1. 車款意圖(`lib/vehicle-intent.ts`,列表頁與商品頁各一份)

一個很小的 store(`useSyncExternalStore` 訂閱),內容是「客人現在要的車款」:
`{ kind: 'vehicle', segment, brandName, modelName?, year? }` | `{ kind: 'none' }` | `{ kind: 'notFound', input }`(`input` = 網址上那段認不得的原字串,保留在網址上讓提示是無狀態的)。

- **誰可以改它**:① 客人的操作(選車、清車、清除全部、移除車款條件、點建議)—— **同步**改,再送網址;② 外部導航落地(3-3)。其他任何東西都不能改。
- **誰讀它**:所有寫網址的地方(3-2)、所有帶車款的連結(L1、L2、P3、P4)、加入購物車(C1)、選車列(列表頁的 cascade 由它同步;商品頁的適用判斷區改讀它)。
- 客人操作時照今天寫選車鏡(`writeVehicleContext`);清車時照今天清鏡(`clearVehicleContext`)。

### 3-2. 唯一的送網址出口(`lib/url-writer.ts`)

```ts
export function writeSearch(
  router: RouterLike,
  edit: (params: URLSearchParams) => void,
  opts?: { method?: 'replace' | 'push'; scroll?: boolean },
): void;
```

1. **底** = 最後一個「已送出、還沒落地」的網址;沒有就用 `window.location`。
2. `edit(params)`:呼叫端只改**自己負責的那幾個參數**(W2 改分類 / 品牌 / 價格、W3 改頁碼 / 排序 / 筆數……)。
3. **車款一律由意圖覆寫**:`applyVehicleIntent(params, intent)`(`vehicle` ⇒ 用 `withVehicleParam` 寫正規寫法、清掉長版;`none` ⇒ 清掉所有車款參數;`notFound` ⇒ 保留原字串)。⇒ 不管底是哪一份網址,送出去的車款永遠是最新意圖。
4. **送不送**:只有「沒有待落地的網址,而且結果等於實際網址」才不送;其他情況一律送(待落地時照送)⇒ 撤銷(R7 ⇒ MT-07 ⇒ R7)會送出第三發 R7,最後一發為準;被取代的中途那發不影響結果。
5. 送出後把網址推進「待落地清單」。

伺服器端(沒有 `window`)一律 no-op。

### 3-3. 網址落地之後(`useUrlLanding`,列表頁與商品頁最外層各掛一次)

盯 `usePathname()` + `useSearchParams()`:

| 落地的網址 | 處理 |
|---|---|
| 在待落地清單裡(我們自己送的,可能是較早的那一發) | 把它與更早的移出清單。**不動車款意圖**(意圖本來就比網址新)⇒ 中途網址不會讓選車列閃回舊車(R1-7c) |
| 不在清單裡(外部導航:上一頁 / 下一頁、頁首 / 頁尾連結、別處 push) | 清單整串清掉。用 `resolveVehicleFromUrl`(上游 §9-2)判斷網址車款:`ok` ⇒ 意圖改成那台(不是正規寫法就用 `writeSearch` 改正規);`notFound` ⇒ 意圖改成 `notFound`(不讀鏡);`none` ⇒ **意圖保留**,若意圖是某台車就用 `writeSearch` 補寫進網址(2-4 第一列)|
| 第一次掛載 | 同「不在清單裡」,但 `none` 時照今天讀選車鏡 |
| 瀏覽器 `popstate` | 清單整串清掉(接著落地的網址就會被當成外部導航) |
| 路徑換了 / 元件卸載 | 清單整串清掉 |

清單不會永遠卡住:最後一發一定會落地(Next 只丟「被後一發取代」的導航;伺服器回應失敗時 Next 會整頁重新載入 ⇒ 重新掛載);若被外部導航取代,外部那一發落地時整串清掉。

### 3-4. 各寫入者怎麼改

| # | 改法 |
|---|---|
| W1(D) | 客人在選車列選車 ⇒ 同步改意圖 ⇒ `writeSearch`(edit 空的,車款由第 3 步覆寫)。不再自己讀網址判斷要不要寫 |
| W2 | **讀網址做判斷的部分全部照舊讀實際網址**(`:199-231` 分類落地確認、`:273-279` 讓路守衛、等值早退、`:598` 撞網址 `refresh`)——那些是「落地證據」,不能改讀待落地網址(R1-4)。只有**送出那一行**改成 `writeSearch`,edit 只設定 W2 自己的參數 |
| W3 | 送出改 `writeSearch`,edit 只設頁碼 / 排序 / 筆數。重按同一頁不需要重送(底已經包含前一發) |
| W4、W6、W9 | 送出改 `writeSearch`,edit 只動自己的參數(`upage`;分類與頁碼;關鍵字與頁碼)|
| W5、W7、W8(清除全部) | 先把意圖改成 `none`、清鏡,再 `writeSearch` 清掉所有篩選參數 |
| W10 | 「移除車款條件」:意圖 `none` + 清鏡 + `writeSearch`;建議車款:意圖改成那台 + `writeSearch`(連結 href 仍是正規網址,沒有 JavaScript 也能開) |
| L1 | 商品卡 href 的車款改讀意圖 |
| L2 | `buildCatalogPaginationHref` 改成先 `applyVehicleIntent` 再組 href(中鍵 / 修飾鍵開新分頁也帶最新車款) |

`W2 :273-279` 讓路守衛(選車狀態有車而網址還沒有 ⇒ 讓路一輪):改成**只在待落地清單非空時讓路**;清單空而網址沒車,代表 2-4 那種外部導航 ⇒ 3-3 已經會補寫車款,W2 不必再等(R1-5)。

### 3-5. 商品頁

| # | 改法 |
|---|---|
| 初始化 | `resolveVehicleFromUrl`:`ok` ⇒ 意圖 = 那台;`notFound` ⇒ `notFound`;`none` ⇒ 讀選車鏡 |
| P1 | 選車 / 清車 ⇒ 同步改意圖 ⇒ `writeSearch`。拿掉 `:111` 只比短版的等值早退(R3-3);純長版網址清除會真的清掉 |
| P2 | 同 P1 的清車 |
| P3 | 麵包屑 `withVehicle` 與車款標籤跳目錄改讀意圖 |
| P4 | `ProductRelated` 的商品卡與「看更多」:在瀏覽器端把 href 的車款參數換成意圖(伺服器給的 href 其他部分不動)|
| P5 | 適用判斷區的顯示改讀意圖;網址落地只經過 3-3 |
| C1 | 桌機與手機都在**按下加入購物車當下**讀意圖:`vehicle` 且有車型 ⇒ 帶那台;其他 ⇒ 不帶(R3-4、R1-6:換車或清車後還沒落地就加購,也是帶最新那台 / 不帶) |

## 4. 測試(證明驗收標準)

### 4-1. 測試用 router(`components/test-utils/deferred-router.tsx`)

依 Next 的行為建模:
- `replace` / `push` 先排隊不落地;**新的一發會取代還沒落地的前一發**(預設,與 Next 相同)。
- `race` 模式:讓較早的一發先落地、再落地較新的(模擬回應先後顛倒),證明中途落地不會讓車款閃回。
- `flush()` 落地;`back()` 取代所有排隊中的導航並觸發 `popstate`;`navigateExternal(url)` 模擬頁首連結。
- 每一次 render 記下選車列顯示的車款(render 探針),供「過程中不閃回」斷言。

### 4-2. 驗收標準本身(每一步之間都不 flush)

掛上實際的 `ProductsPage`(含所有 hook 與按鈕),每格給**實際可達**的起始網址與商品數(mock 的 `total` 夠多,讓分頁、分類膠囊、關鍵字膠囊都真的出現):

| # | 起始網址 | 連點序列(用畫面上真的存在的控制項) | 斷言 |
|---|---|---|---|
| T1 | `?vehicle=yamaha:mt-07&page=3`(總數 > 3 頁) | 選 YZF-R7 ⇒ 側欄換分類 ⇒ 點頁碼 2 ⇒ 改排序 | 過程中不閃回 MT-07;最後三樣都是 R7;商品卡與頁碼連結帶 R7 |
| T2 | `?vehicle=yamaha:mt-07&category=<分類>&search=<字>&page=3` | 選 YZF-R7 ⇒ 移除分類膠囊 ⇒ 移除關鍵字膠囊 ⇒ 點通用配件頁碼 2 | 同上 |
| T3 | `?vehicle=yamaha:yzf-r7&category=<分類>` | 清除全部(三個入口各一格)⇒ 立刻換排序 | 最後沒有車款、不是 MT-07 或 R7;重新整理後仍沒有(鏡已清) |
| T4 | `?vehicle=yamaha:mt-07&page=3` | 清車 ⇒ 點頁碼 2 ⇒ 換分類 | 最後沒有車款;過程中不閃回 MT-07 |
| T5 | `?vehicle=yamaha:nosuch` | 點建議 YZF-R7 ⇒ 改排序 ⇒ 側欄換分類 | 最後三樣都是 R7 |
| T6 | `?vehicle=yamaha:YZF%20R7` | 立刻換分類 ⇒ 改排序 | R7,網址是正規 `yamaha:yzf-r7` |
| T7 | `?vehicle=yamaha:yzf-r7` | 選 MT-07 ⇒ 選回 YZF-R7(撤銷)⇒ 換分類 | 最後是 R7 |
| T8 | `?vehicle=yamaha:yzf-r7` | 選 MT-07 ⇒ 立刻清車 | 最後沒有車款 |
| T9 | `?vehicle=yamaha:yzf-r7` | 換分類 ⇒ 點頁首「商品目錄」(`navigateExternal('/products')`)⇒ 換排序 | 最後仍是 R7(2-4 第一列) |
| T10 | `?vehicle=yamaha:mt-07` | 選 R7 ⇒ 換分類 ⇒ `back()` | 以上一頁網址為準(例外條款);之後翻頁不會再寫出更早的車 |

T1 ~ T8 各跑三次:預設(取代)、`race`、每步都 flush(正對照)。
🔴 **負對照(片 3 先做、先紅)**:用今天的寫法(各自讀 `window.location`)跑 T1、T4,必須紅;證明這組測試抓得到跳回去。它只替「讀舊網址」那一種錯背書,其他機制各有自己的格。

### 4-3. 伺服器查商品用的車款

測試 router 不會跑伺服器。另在 `app/products/(catalog)/page.test.tsx`(既有的伺服器元件測試)用 T1 ~ T6 的**最終網址**呼叫頁面,斷言 `fetchCatalogPage` 收到的車款是 R7(`notFound` 那格斷言沒有查商品)。

### 4-4. 商品詳情頁

- 起始 `?vehicle=yamaha:mt-07`:選 R7 ⇒ 不 flush 立刻點麵包屑 / 相關商品 / 看更多 ⇒ 導航目的地帶 R7。
- 選 R7 ⇒ 不 flush 立刻加入購物車(桌機、手機各一格)⇒ 購物車車款是 R7;清車 ⇒ 不 flush 加購 ⇒ 不帶。
- 純長版 `?brand=yamaha&model=mt-07` 按清除 ⇒ 網址不留車款。
- `race` 模式下適用判斷區不閃回。

### 4-5. `url-writer` / `vehicle-intent` 單元測試

3-2、3-3 每一條規則一格;伺服器端匯入與呼叫不炸;撤銷、重送、外部導航清空、`popstate`、卸載。

### 4-6. 本機鑽機(`scripts/storefront-probe/up.sh`)

用鑽機裡有的車真的快速連點 T1、T4、T7、T9,等網址穩定、商品載完再截圖(看得到網址列與選車列);商品頁連點選車 ⇒ 加購 ⇒ 打開購物車看車款;手機寬度 375 看提示區塊。

## 5. 拆片與時間(初估約 13 小時 ≈ 1.7 個工作天 + 審查)

| 片 | 內容 | 時間 |
|---|---|---|
| 1 | `resolveVehicleFromUrl` + 建議排序 + `withVehicleParam` + 單元測試 | 45 分 |
| 2 | `vehicle-intent` + `url-writer` + `useUrlLanding` + 單元測試 | 45 分 |
| 3 | 測試用 router(取代 / race / back / 外部導航 / render 探針)+ T1、T4 負對照先紅 | 45 分 |
| 4 | W1 + 列表頁意圖接線(取代 E 的車款段)| 45 分 |
| 5 | W2(只改送出)+ 讓路守衛條件 + W3 | 45 分 |
| 6 | W4 ~ W9 | 45 分 |
| 7 | T1 ~ T10 全綠(含 race)+ 修 | 45 分 |
| 8 | 列表頁提示區塊 + W10 + L1 + L2 + 件數延後 | 45 分 |
| 9 | 伺服器頁面測試(4-3)| 30 分 |
| 10 | 商品頁初始化 + P1 / P2 / P5 | 45 分 |
| 11 | P3 / P4 / P6 + 商品頁提示位置 | 45 分 |
| 12 | C1 + 4-4 測試 | 30 分 |
| 13 | 本機鑽機走查與截圖 | 45 分 |
| 14 | 三綠 + `pnpm test` 全套 + 修 | 45 分 |
| — | 每片 Codex 審查與修正 | 約 3 小時 |

每片三綠 + 相關測試;碰到客人畫面的片(8、10、11、12)用鑽機看並截圖到 `~/pcm-mailbox/`;每片送 Codex,R2 還有必修就停。

## 6. 影響

- 客人:連點不會跳回舊車;壞車款網址不再變成全站或舊車;只差空白 / 橫線 / 大小寫的網址直接找到車。
- 行為改變:推翻 08-08 拍板 A(Sean 明示);點頁首「商品目錄」時車款保留並寫進網址(今天是選車列保留、網址沒有、商品沒有按車過濾 —— 本來就不一致);同頁導航到另一個車款網址時選車列跟著網址。
- 不碰 schema / 資料庫 / `packages/ui` / 件數 API。

## 7. Rollback

revert 這一批 commit(預計 14 顆,都在 `agent/ops-17-exthost-correct`)。🔴 片 2 ~ 8 改了所有寫網址的地方,只退其中幾顆會留下一半新一半舊 ⇒ **要整批一起退**。沒有資料庫變更。

## 8. 沒做 / 限制

1. 多個瀏覽器分頁各自有自己的意圖與待落地清單,互不影響。
2. 年份照上游 §9-10,不在本案。
3. 首頁、購物車頁、帳號頁不在本案(它們讀選車鏡,本案選車時照今天寫鏡)。
4. 時間是初估;片 3 的測試 router 若模擬不出 Next 的取代行為,會先回報再決定。
