# `#484` 片 B-1 plan — 工具列快速篩選 chip(**只做「全部 / 未到貨」兩顆**)

> 2026-08-14 E 窗寫。**拆法由主視窗裁**(B-1 / B-2 / B-3),**本片 = B-1**。
> 🏁 **2026-08-14 Sean 本人批准開工**(鐵則 8;檔數以本檔量到的 **5** 送批,不是初估的 4)。
> 排序:**先 `#486` 乙案、再本片**(主視窗裁:同一個窗不並行,一次一片各自收工)。
> 前置:`#484a` 片 A2 已完工(`81f5b45c`,commit 已在 dev 收割 `b5eb60aa`)—— 本片吃它做出來的 `goodsAxes` 軸。

---

## 1. 為什麼只做兩顆(而不是 OD 畫的四顆)

OD `overview-desktop.html:611-614` / `:647-649` 兩處各畫了**四顆** chip:
`全部` / `待處理` / `未到貨` / `退貨中 <b>0</b>`。

**其中三顆沒有人定義過資料條件**(2026-08-14 唯讀實查):

| chip | 現況 | 去處 |
|---|---|---|
| 全部 | = 不篩(清掉 `goods_axis`)⇒ **零新資料** | ✅ 本片 |
| 未到貨 | 可用 `#484a` A2 做好的 `goodsAxes` 表達 ⇒ **零新資料、零新查詢** | ✅ 本片 |
| 待處理 | **對不到任何現有欄位**;需求檔 `grep -c '待處理'` = **1**,而那一行在講顏色、不是定義 | `#485`(等 Sean 定義) |
| 退貨中 | 🔴 **資料面不存在**(`AdminOrderSummary` 15 欄無「退款進行中」;`paymentStatus` 只有 `refunded`/`partiallyRefunded` = **退完了**)+ 要顯示 count ⇒ **第二次查詢** | B-3(另立條目、號由主視窗發) |

⇒ **原 plan 的「片 B = 45 分」是建立在「chip 只是既有篩選換外觀」這個假設上,而那個假設被 OD 字面推翻了。**
B-1 把「真的只是換外觀」那部分切出來,**它才是 45 分鐘的那一片**。

---

## 2. 🏁 定義題已拍板(2026-08-14 Sean = **甲案**)

「未到貨」對應哪幾個貨品軸值?

| 案 | `goodsAxes` | 白話 | 現行 13 張單會篩出 |
|---|---|---|---|
| **甲(拍板)** | `['none', 'ordered']` | **還沒到貨的單全部** —— 含「還沒跟廠商訂」與「訂了還沒到」 | 13 筆,扣掉 5 張已取消 ⇒ **8** |
| 乙 | `['ordered']` | **只有「訂了還沒到」** —— 還沒去訂的不算 | **1**(`PCM-2026-0104`) |

🔴🔴 **上面這兩個數字是 2026-08-14 事後更正的,原版是錯的,而 Sean 是看著原版拍的板。**
原版寫「甲 12(扣掉 ⇒ 7)/ 乙 **0**,13 張單裡沒有 `ordered`」。
病因:我把 `in.(ordered,instock,shipped)` = **1** 讀成「三值合計 1 ⇒ ordered 是 0」,
而**那 1 筆就是 `ordered` 本人**(`eq.ordered` = 1,重量過;母 plan `#488` 早就記過 `PCM-2026-0104`)。
⇒ **拍板方向不受影響**(1 仍遠少於 8,甲案的語意本來就是「還沒到的全部」),
但**我拿一個沒對過的數字去要拍板**,這件事留在這裡。

**推薦甲**,理由:員工問「什麼還沒到」時要的是**一張待追的清單**,而「還沒去訂」是其中最該追的那種;
乙案會把最需要處理的單排除在外,而畫面上沒有任何線索告訴他被排除了。
⚠️ **乙案今天會篩出 0 筆**(正式站 13 張單裡沒有 `ordered`)⇒ 一顆按下去永遠空的按鈕,
與 `#485` 要防的病同型。

🏁 **Sean 拍甲**(經主視窗轉達):`goodsAxes = ['none', 'ordered']`。
他是在**看過「乙案今天篩出 0 筆 = 一顆按下去永遠空的按鈕」這個代價之後**選的,不是預設值。
⇒ 實作照甲,**不要在實作時「順手」改成單值來配合下拉**(那是用 UI 限制去改業務定義,§3 已經否決過)。

---

## 3. 範圍與檔案(**5 檔** —— 起初估 4,量到下面那條之後變 5;體積 = 45 分)

| 檔 | 改什麼 |
|---|---|
| `apps/admin/src/components/orders/order-filter-chips.tsx`(**新檔**) | chip 排本體。**server component、零 JS** —— 每顆是 `<Link>`(href 由 `buildOrderListHref` 產),選中態用 `aria-pressed`。 |
| `apps/admin/src/app/globals.css` | `.fchip` 兩態,**逐字搬 OD**(開檔抄的,行號與宣告如下):<br>`:97-98` 常態 **8 個宣告**:`border:1px solid var(--border)` / `background:var(--card)` / `border-radius:999px` / `padding:3px 11px` / `font-size:12px` / `cursor:pointer` / `font-family:inherit` / `color:var(--mutedfg)`(⚠️ 這條規則**跨兩行**,只抄 `:97` 會漏掉後三個)<br>`:99` 選中 **4 個宣告**:`background:var(--fg)` / `color:#fff` / `border-color:var(--fg)` / `font-weight:600`<br>🔴 **不翻譯成 Tailwind 語彙**(鐵則 1)。 |
| `apps/admin/src/app/orders/page.tsx` | 掛在 `<h1>訂單</h1>` 那一列(OD 的 `.bar` 就是標題與 chip 同一列,`:609-611`)。 |
| `apps/admin/src/components/orders/order-filter-chips.test.tsx`(**新檔**) | 見 §4。 |

**不動**:`order-filter-controls.tsx`(client 互動核心)/ adapter / domain / migration。
(`order-filter-bar.tsx` **要動**,理由見下面那條 —— 它不在我第一版的清單裡。)

### 🔴 與既有「出貨狀態」下拉的關係(本片最容易做錯的地方)
chip 與下拉**篩的是同一個軸**(`goods_axis`)。兩個 producer 指向同一個 URL 參數 ⇒
**不會有第二份狀態**,下拉會自動反映 chip 按下去的結果(它讀的是 `filter.goodsAxes`)。
⚠️ 但 **B-1 的「未到貨」是兩個值,而下拉是單選** ⇒ 按下 chip 之後下拉**顯示不出**「兩個值」。
處置二選一,**要在 plan 批准時一起裁**:
- **甲(推薦)**:下拉在多值時顯示為**未選**(= 空白「全部」),chip 那邊 `aria-pressed` 為真 ⇒
  **兩個控制項各自誠實**:下拉說「我沒有選單一值」,chip 說「我選了」。
- 乙:B-1 的「未到貨」改成單值(`['ordered']`)以配合下拉 ⇒ **等於用 UI 限制去改業務定義**,不建議。
🔴 **現行 `order-filter-bar.tsx:49` 是 `filter.goodsAxes?.[0]`** ⇒ 多值時下拉會顯示**第一個值**,
那是「顯示與實際篩的不一致」——**甲案要動它**(改成:長度 > 1 時顯示空白)。
⇒ 這使本片檔數 **4 → 5**(多一個 `order-filter-bar.tsx`)。**這是量出來的,不是估的。**

---

## 4. 驗收(每條 yes/no)

1. **零新查詢**:adapter / repository / migration **零改動**(數法 `git diff --cached --name-only | grep -cE 'adapters|supabase/migrations'` = 0)。
2. **零 JS**:新元件不含 `'use client'`、不含任何 `use*` hook(數法 `grep -cE "'use client'|use[A-Z]" order-filter-chips.tsx` = 0)。
3. **chip href 走 `buildOrderListHref`**、不自己拼字串(那道編譯期窮舉守門的理由;`order-list-view.ts` 檔頭記過三次)。
4. **選中態正確**:`?goods_axis=none&goods_axis=ordered` ⇒ 「未到貨」`aria-pressed=true`、「全部」false;
   無參數 ⇒ 反過來。**兩個方向都要有測試**(不是只測選中那一格)。
5. **樣式逐字對 OD**:常態 **8 個**宣告(`overview-desktop.html:97-98`)+ 選中 **4 個**(`:99`)**逐字相同**
   (用 postcss AST 斷言,同 `orders-table.test.tsx` 既有守門的作法)。
   🔴 **數字寫死在驗收裡是刻意的**:那條 CSS 規則**跨兩行**,只讀 `:97` 會抄成 5 個宣告而看起來很正常。
6. **突變**:①把 href 改成不帶參數 ⇒ 選中態測試紅 ②把 `aria-pressed` 判定反向 ⇒ 兩個方向的測試各紅一格。
7. 三綠 exit 分開收 + 動 `.tsx` ⇒ 加 build。

---

## 5. 🔴 我沒查的(不要當作已確認)

- **手機/窄版**:OD 的 chip 排在 `.bar` 裡靠 `flex-shrink:0`(`:482`)不換行;**我沒量過**窄版會不會擠出橫向捲軸。
- **`aria-pressed` 用在 `<a>` 上**:OD 用的是 `<button>`;本片改成 `<Link>`(零 JS 的代價)。
  `aria-pressed` 在 `role=link` 上**不是合法組合** ⇒ 可能要改用 `aria-current` 或 `data-*`。**這一條要在實作前查 WAI-ARIA,不憑印象挑。**
- **與密度切換、關鍵字 chip 的排版互動**:`page.tsx:163-171` 那一列已經有 `<h1>` + 密度鈕 + 「共 N 筆」;
  再塞**兩顆** chip 會不會擠,**我沒量**(B-2/B-3 落地後會變四顆,那時要重量一次)。
- **`#495`(已結案收進隱藏)若先落地**,「未到貨」的母體會變 ⇒ 兩片的順序要主視窗排。

---

## 6. 回退

純 UI 加法。`git revert` 即可;無 migration、無資料異動、無 URL 參數新增
(用的是 `#484a` A2 已經上線的 `goods_axis`)。

— END —
