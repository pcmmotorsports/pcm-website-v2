# 訂單列表:把「形狀」也搬到 BMW M 版(片 A-1)

> **狀態:🔴 等 Sean 批。命中鐵則 8(跨 3+ 檔)⇒ 本檔寫完不動手。**
> **檔數 5**(2026-08-17 併入 3.4 之後從 3 變 5,**這行跟著改過**):
> `app/globals.css` · `components/orders/orders-table.tsx` · `app/orders/page.tsx` ·
> `components/orders/order-detail-items-table.tsx` · `lib/orders/order-status-axes.ts`(只改註解)
> **不動 `packages/ui`、不碰錢/權限/schema/平台設定 ⇒ 不命中鐵則 12 六類。**
> 2026-08-17 A 窗。對照表(Sean 看的那份)= artifact `f41decca-8db8-4539-b894-f45d337286e3`。
> 前置閱讀:`docs/specs/2026-08-12-admin-order-ui-design-brief.md`(849 行、十輪拍板)、
> `docs/design/admin-design-system.md` 檔頭落地狀態表。

---

## 1. 要改什麼 —— 一句話

**訂單列表已經照 BMW M 換好了【顏色】,但【形狀】還是照 OD 舊版做的。這片把形狀補上。**

---

## 2. 為什麼 —— 病根是「抄錯版本」,不是「漏做幾條」

Sean 2026-08-17 逐字:「原本設計的很多顏色或者是動畫等等好像都沒有跟上耶」
「**不是單純顏色、膠囊圓角還是直角這種問題而已**」。

量下去的結果 —— **兩個獨立實錘,同一個成因**:

| | 舊版 `overview-desktop.html` | BMW M 版 `overview-desktop-bmw-m.html` | repo 現況 |
|---|---|---|---|
| 未收款標記 | `:191` `box-shadow:0 0 0 1.5px …, 0 0 0 3px …` = **雙層外環** | `:218` `box-shadow:inset 3px 0 0 var(--danger)` = **左緣紅條** | **雙層外環**(抄舊版) |
| 篩選 chip 選中 | `:99` `.fchip[aria-pressed=true]{background:var(--fg);color:#fff}` | **沒有 `.fchip`**;工具列改 `.tab` `:148-154`,選中 = `border-bottom-color:var(--fg)` | **黑底白字膠囊**(抄舊版) |

🔴 **而 `order-status-axes.ts` 的 `PAY_MARK` 註解逐字寫著「雙層(外深內淡)是刻意的,逐字照 OD」**
—— 那句**對舊版成立、對 BMW M 版是錯的字面**。
**零機械訊號**:檔案沒改、測試沒紅、grep 那句話也看不出它指錯了版本。

📎 本片同時把這句錯字面改掉 —— 否則下一個人會拿它當「不要動」的依據。

---

## 3. 範圍 —— 五檔,逐條附 OD 行號

### 3.1 `apps/admin/src/app/globals.css`

| # | 加什麼 | OD 逐字 | 備註 |
|---|---|---|---|
| a | 選中訂單整組:淺藍底 + 左緣 3px M 藍 | `:177-178` `tbody tr.sel td{background:color-mix(in oklab,var(--accent) 8%,var(--surface));box-shadow:inset 3px 0 0 var(--accent)}` | 🔴 **參數順序要翻**:寫成 `color-mix(in oklab, var(--card) 92%, var(--primary))`。數學等值,但 lightningcss 的降級值取**第一個參數** —— 照 OD 原順序寫,降級值會變成純 `--primary`(整列變實心藍)。理由已寫在同檔 `.cap-*` 那段,本片沿用同一條 |
| b | 退貨中整組:左緣 3px 琥珀 | `:179-180` `tbody.returning td{...var(--warn)}` + `tbody.returning tr.sel td{...var(--warn)}` | **選中時橘仍勝出**,不是藍蓋橘。兩條都要寫,少一條就變成「選中的退貨單看不出在退貨」 |
| c | 未收款膠囊:雙層外環 → 左緣 3px 紅 | `:218` `.cap.m-unpaid{box-shadow:inset 3px 0 0 var(--danger)}` | ⚠️ **等 Sean 答第 4 題**(見 §5)。他選乙就不動這條 |
| d | 未收出貨:**不加**紅條 | `:219` `.cap.risk.m-unpaid{box-shadow:none}` | 🔴 它整顆已是實心紅。**主視窗從截圖讀成「未收四格都有紅條」是錯的,四格裡只有三格有** |
| e | 表頭 36px / 12px / 字距 1.5px | `:166-169` | **不搬 `text-transform:uppercase`** —— 對中文 no-op,設計參照已裁「永不採用」 |
| f | 單號欄:等寬字 + 700 + `--foreground` | `:181` `td.oid{font-family:var(--font-mono);font-weight:700;color:var(--fg)}` | 現況是一般無襯線 400 |
| g | 狀態膠囊上下內距 3px、字距 0.5px | `:206-207` | 現況 `0px 8px` / `normal` ⇒ 膠囊被壓扁 |

### 3.2 `apps/admin/src/components/orders/orders-table.tsx`

- `OrdersTable` 加一個 optional prop `selectedOrderId?: string | null`。
- `OrderGroup` 的 `<tbody className='orders-group'>` 加 `data-selected={order.id === selectedOrderId || undefined}`。
- 退貨中:`data-returning` —— 🔴 **這一格有前置缺口,見 §4。**
- 🔴 **`data-*` 不用 `='false'`,用 `undefined` 讓屬性整個不存在** —— CSS 選的是 `[data-selected]` 的存在性,寫 `false` 會全部命中。

### 3.3 `apps/admin/src/app/orders/page.tsx`

- `:98` 現在是 `const panelOpen = readOpenPanelOrderId(rawSearchParams) !== null;`
  ⇒ 改成留住 id:`const panelOrderId = readOpenPanelOrderId(rawSearchParams); const panelOpen = panelOrderId !== null;`
- `:250` `<OrdersTable … selectedOrderId={panelOrderId} />`
- **零新增查詢、零 schema、零 API 改動** —— 那個 id 本來就在 URL 裡、本來就**已經被讀出來了**
  (`app/orders/page.tsx:98` 已呼叫 `readOpenPanelOrderId(rawSearchParams)`,只是把回傳值丟掉、只留 `!== null`)。
  **數法**:`grep -n 'readOpenPanelOrderId' apps/admin/src/app/orders/page.tsx` ⇒ 命中 `:98`。

### 3.4 🆕 商品列補「出 n/m」第三顆進度(**不依賴 §5 那四題的答案**)

> 2026-08-17 併入。主視窗背書為可執行片,但要求併進本 plan 讓 Sean 一次批,不另開片。

**檔**:`apps/admin/src/components/orders/order-detail-items-table.tsx`(232 行,單一元件)

| | 現況 | 要變成 |
|---|---|---|
| 欄頭 `:131` | `訂貨 · 到貨 · 取消` | `訂貨 · 到貨 · 出貨 · 取消` |
| `ItemAxisCell` `:35-60` | `orderedQuantity/quantity`(`:49`)、`instockQuantity/quantity`(`:55`)、`cancelledQuantity`(`:58`,>0 才顯示) | 中間插一顆 `shippedQuantity/quantity` |

**OD 逐字**(`overview-desktop-bmw-m.html:574-576` 的 `pip()`,與定案版 `overview-desktop.html:1036-1038` 的 `.pcstep` 同構):
```
cur >= total → 'on'（完成）   cur > 0 → 'mid'（進行中）   否則 → 'off'（還沒開始）
```
現有 `ItemAxisCell` 已經在做同一件事,**照它既有的寫法加第三顆,不要另立一套。**

🔴 **資料早就在了,不是新撈**:
```
packages/domain/src/order/types.ts:940            shippedQuantity: number
grep -rn 'shippedQuantity' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l  ⇒ 20
而那 20 處【沒有一處】在 order-detail-items-table.tsx（該檔 232 行已開檔看完）
```
⇒ **零 schema、零查詢、零投影改動。** 純顯示。

⚠️ **範圍限定,不要講大**:這是**往定案版靠一步**,**不是**「做完商品導向」。
定案版的三段在**商品卡**上(`.pcard` + 三個收合段),repo 的在 **`ItemsTable` 的一欄**裡。
**結構不同,只是同一個資訊多顯示一顆。** 講成前者會讓人以為 §0-G 做完了。

🔴 **更正:我原本寫「多一顆膠囊會變寬,要量會不會撐爆欄寬」—— 那個前提是錯的。已量。**

`ItemAxisCell`(`:44-62`)**不是膠囊、也不是並排** —— 它是 `<div class="text-xs leading-5">` 裡的
**垂直堆疊文字行**(`訂貨 3/3` 一行、`到貨 1/3` 一行、`已取消 N` 條件行)。
`display` 實測 `block`。⇒ **加第三行不吃寬度,吃【列高】。**

**實測(class 字串逐字取自 `:44-62`,注入真編譯 CSS 量)**:
```
                        現況      加「出貨 n/q」後
一般列（2 行 → 3 行）    56px  →  76px      （+20）
有取消的列（3 → 4 行）   76px  →  96px      （+20）
每行行高                 20px（leading-5）
寬度                     scrollWidth == clientWidth ⇒ 零截斷、不受影響
```
⚠️ **代價講明白**:訂單詳情的品項表**每一列都會高 20px**。三品項的單 = 全表高 60px。
**這不是可以忽略的數字** —— Sean 從第二輪起一路在講「上下留白太多、我們習慣看資訊很密集」(§0-A)。

### 🏁 2026-08-17 Sean 看圖後拍板:**乙 = 橫排**(`Q5`)

> **上面那段「+20px 列高」的分析仍然正確,但它描述的是【沒有被採用的甲案】。留著是為了讓人看得懂乙為什麼贏。**

**他是看實體版本選的,不是看文字**(兩案並排、各附整個商品區總高):
```
甲 直排（往下疊）  439px   一般列 77 / 有取消 97
乙 橫排（一行）    219px   全部 37
⇒ 甲比乙高一倍（多 220px）
⚠️ 他在【文字階段】答過甲、看完圖改成乙。以【最終】為準，不回頭問。
```

**⇒ 本片要做的是【乙】**:
```
目標  OD 定案版 .pcstep（overview-desktop.html:1036-1038）橫排一行
      訂貨 n/q · 到貨 n/q · 出貨 0/q
現況  ItemAxisCell（order-detail-items-table.tsx:44-62）垂直堆疊文字行
🔴 這【不是】加一行，是【改這一格的排版】
```
**做法**:把 `<div class="text-xs leading-5">` 內的三個 `<div>` 改成同一行的 `<span>`
(flex 橫排 + `gap-x-3`),並加入第三段「出貨」。「已取消」仍條件顯示、仍 `text-destructive`。

**已量(預覽,注入真編譯 CSS)**:
```
5 品項的單（含一筆有取消）  商品區總高 219px   每列 37px（= 現況列高，不變）
表格橫向溢出               無（scrollWidth == clientWidth）
```
⚠️ **仍要在實作後重量一次** —— 預覽用的是我手寫的 flex 版,**不是最終 code**。

🔴 **不得動任何一欄的欄寬** —— 那會踩到 `col-title` 的「全表最緊、任何新增不得再從這裡扣」(`globals.css:704`)
與另外四筆綠勾債。**改排版時若發現非動欄寬不可 ⇒ 停下來回報,不自行決定。**

### 3.5 同片順手改掉的錯字面

`apps/admin/src/lib/orders/order-status-axes.ts` 的 `PAY_MARK` 註解:
「雙層(外深內淡)是刻意的,**逐字照 OD**」⇒ 改成指明**哪一版**,並記錄本片換成 M 版的左緣紅條。
🔴 **改前先跑** `bash scripts/literal-sweep.sh '雙層'`,把同族字面一次掃乾淨(Sean 2026-08-15 拍板)。

---

## 4. 🔴🔴 前置缺口:「退貨中」不是欄位沒撈,是**整條退貨線在本 repo 不存在**

初稿我寫「列表投影裡有沒有這個欄位我還沒查」。**查完了,而答案比那嚴重一級。**

**數法(可重跑)**:
```
grep -rn '<pattern>' packages/domain/src packages/adapters/src apps/admin/src \
  --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l
```
| pattern | 命中 |
|---|---|
| `return_status` / `returnStatus` / `returning` / `returnedQuantity` | **0** |
| `returned_quantity` / `return_requested` / `order_returns` | 各 **1** —— 而**那三個命中全在同一段註解裡**(`apps/admin/src/components/orders/cancel-review-section.tsx:119-120`),逐字寫著「**退貨線在本 repo 零落點**」 |
| `grep -rln 'order_returns\|return_requested' supabase/migrations/` | **0 支檔** ⇒ DB 也沒有退貨表 |

⇒ **不是投影漏撈一個欄位,是這個功能整條沒有。**
⇒ OD 的 `returning` 來自它自己的假資料 `o.ret`;真後台**產不出這個狀態**。

**處置**:
- 3.1-b(退貨中橘線)與 3.2 的 `data-returning` **從本片整條移除**,不是拆到 A-1b。
- **它不是視覺片,是功能片** ⇒ 要做得先有退貨資料模型(§0-I 的兩段式:登記退貨 → 確認收到貨 → 才退款)。
  **那是 Sean 的題,不是我的。**
- 📎 我差點把「§0-I 說退貨中要看得見」讀成「資料已經在了」——
  **需求說要看得見,不代表有東西可以看。** 那是兩件事。

⇒ **本片只做「選中指示」那半。** 那半的資料來源 100% 確定 = URL 上的 panel id
(`app/orders/page.tsx:98` 已經在讀了)。

---

## 5. 等 Sean 答的四題(答案會改變本片內容)

| # | 題 | 影響本片哪一條 |
|---|---|---|
| 1 | 工具列收成一行? | **不在本片**(那是版面改動,會動篩選器結構)⇒ 答了另開片 |
| 2 | `--warn` 用設計稿 `#f59e0b` 還是現行 `#a56a07` | 影響 3.1-b 那條橘線的顏色。**他不答就用現行 `#a56a07`**(不動 token = 較保守) |
| 3 | 動畫做到哪 | **不在本片**。本片零動效改動 |
| 4 | 未收款紅記號要不要換成左緣紅條 | **直接決定 3.1-c 與 3.1-d 做不做**。他答乙 ⇒ 這兩條整條拿掉 |
| 5 🆕 | **出貨進度要直排(+20px 列高)還是照 OD 改橫排(不增高)** | 見 3.4 末段。**這題是量完之後才長出來的,原本不存在** |

---

### 🏁 2026-08-17 Sean 已回(逐字)

```
Q1 工具列   「先試試看甲，要調整我在說」   ⇒ 甲（全收）。🔴 可逆授權，不是定案，做出來要給他看
Q2 --warn   「Q-視覺2,3,4 全部依照設計稿」 ⇒ 甲 #f59e0b
Q3 動畫     同上                          ⇒ 甲 只做按鈕 130ms
Q4 紅記號   同上                          ⇒ 甲 左緣紅槓；未收出貨不加（OD :218/:219）
Q5          🔴 未問 —— 它是量完 3.4 之後才長出來的
```
⇒ **`3.1-b` 的橘線仍然不做**(§4:資料不存在)。**`3.1-c` / `3.1-d` 解鎖。**
⇒ **`Q1` 工具列不在本片**,另開片。
⇒ **「全部依照設計稿」= 往後同類分歧的預設** —— 但前提是**先確認哪一份是設計稿**
(今天已證明會出錯:三支 `*-directions.html` 是選項稿、`overview-desktop.html` 才是定案版)。

⇒ **本片可以在四題未答的情況下開工的部分**(逐條列,不是「其餘」):
`3.1-a` / `3.1-e` / `3.1-f` / `3.1-g` / `3.2`(僅 selected)/ `3.3` / `3.4`(出貨 pip)/ `3.5`(錯字面)
= **8 條**。
**3.1-b 卡 §4 缺口;3.1-c 與 3.1-d 卡第 4 題。**

---

## 6. 預期影響面

| 面 | 影響 |
|---|---|
| 錢 / 權限 / schema / migration | **零**。不讀新欄位、不動查詢、不動 RLS |
| `packages/ui` | **零** ⇒ 不命中鐵則 12⑥ |
| 平台設定 | **零** |
| 前台 storefront | **零**(`globals.css` 是 `apps/admin` 自己那支) |
| 其他後台頁 | **零 —— 已查。** `grep -rln "orders-grid" apps/admin/src --include='*.tsx' --include='*.css' \| grep -v '\.test\.'` ⇒ **3 支檔**:`app/globals.css`(規則本體)、`orders-table.tsx`、`order-toolbar.tsx`。<br>其中 **`.tsx` 的 7 行命中裡有 6 行是註解**,唯一的**渲染點** = `orders-table.tsx:528` `<div className='orders-grid …'>`。<br>⇒ `商品` / `客戶` 列表**沒有**用這個 class ⇒ 不連動 |
| 既有測試 | `design-tokens.test.ts` 釘 `:root` 的 token,本片不動 token 值 ⇒ 預期不紅。**預期不等於實測** |
| 手機卡片模式 | ⚠️ `@container` 卡片化下 `inset` 陰影落在哪、`<tbody>` 是不是還是定位脈絡(`globals.css` 有一條把定位脈絡抬到 `tbody.orders-group`)⇒ **要在 390px 實看,不能只看桌機** |

---

## 7. 驗收(每條可 yes/no)

1. `TURBO_FORCE=1 pnpm typecheck` / `lint` / `build` 三綠,各項貼 `0 cached, N total`
2. `pnpm test` 綠
3. **真瀏覽器 computed value 複驗**(不是讀原始碼):選中那組 `<tbody>` 的 `td` 量到
   `boxShadow` 含 `inset` 且 3px、`backgroundColor` 非 `--card`;**未選中那組量到 `none`**
   —— 🔴 **兩個世界都要餵:該亮的亮、該不亮的不亮。** 只量選中那組 = 恆真
4. 表頭量到 `36px / 12px / letterSpacing 1.5px`;單號量到等寬字 + `700`
5. 膠囊量到 `padding 3px 8px`、`letterSpacing 0.5px`
6. **390px 手機卡片模式肉眼看過**,截圖附上
7. `scripts/literal-sweep.sh '雙層'` 零殘留
8. `git status --porcelain` 只有預期的四 (或五) 支檔
9. **出貨行(3.4)**:`shippedQuantity = 0` 與 `= quantity` 兩筆各餵一次,顯示的分子分母都對 —— **兩個世界都餵**
10. 🔴 **commit body 必須寫出「這一格的【排版】被改掉了」,不准只寫「已補上出貨進度」。**
    做的是**乙案(直排 → 橫排)**,不是「多加一行」。
    ⚠️ **原第 10 條(列高 56→76)已隨甲案作廢** —— 乙案**列高不變**,那個數字不再是代價。
    **代價換成:這一格從上下堆疊變成橫排,是版面改動,不是加值。**
11. **實作後重量並貼數字**:5 品項的單(含一筆有取消)商品區總高、每列高、
    以及 `scrollWidth == clientWidth`(表格沒有被撐出橫向捲軸)。
    🔴 **同時要驗「欄寬一顆都沒動」**:`grep -n 'width' apps/admin/src/app/globals.css` 的 `.col-*` 六顆值
    與 `132/188/104/104/56/154` 逐字相同

---

### 🔴 收工時**不准**寫的一句話

> ~~「商品導向做完了」~~ / ~~「§0-G 已落地」~~

**3.4 只是把現有 `ItemsTable` 那一欄的三個數字改成橫排、並補上第三段。**
定案版的商品導向是 **`.pcard` 商品卡 + 三個收合段 + 到貨登錄移出 9 欄表**
(`overview-desktop.html:1024-1101`),**本片一個字都沒做。**

⇒ **改成橫排是「借用定案版那一格的排法」,不是「做完商品導向」。**
沒有這句,下一個人會拿本片的 commit 去結 `§0-G` 的案。
⚠️ **而它現在更容易被誤讀** —— 因為橫排這個形狀**看起來就像 OD 的 `.pcstep`**,
而 `.pcstep` 在定案版裡是**商品卡的一部分**。**長得像不等於做到了。**

⚠️ **第 3 條是本片最容易假綠的一格**:`box-shadow` 在 Tailwind 下會疊一長串 `rgba(0,0,0,0) 0px 0px…`,
用 `!== 'none'` 判定會**恆真**。判準要寫成「字串含 `inset`」+ **未選中那組必須不含**。

---

## 8. Rollback

單一 commit、純樣式 + 一個 optional prop + 一顆多顯示的進度膠囊。
`git revert <sha>` 即可,**無資料遷移、無 URL 契約改動、無 API 契約改動** ⇒ 回滾零副作用。
中途放棄:三處各自獨立,拿掉 `globals.css` 那段即回到現況(prop 傳了沒人用 = 無效果,不會壞)。

---

## 9. 本片【不做】什麼(寫出來,免得被當成漏做)

- ❌ **出貨進度「直排多一行」(甲案)** —— 🔴 **Sean 2026-08-17 看圖後選【乙 橫排】**
  (兩案並排、各附商品區總高 `439px vs 219px`)。⇒ **本片做橫排,直排整條不做。**
  ⚠️ 他在文字階段答過甲、看圖後改乙。**§3.4 上半段那份「+20px 列高」的分析描述的是【沒被採用的甲案】**,留著只為看得懂乙為什麼贏
- ❌ 工具列收一行 / 篩選器結構(`Q1`=甲 已批,但**那是另一片**,不在本片)
- ❌ 任何動效(`Q3`=甲 只做按鈕 130ms,**另一片**)
- ❌ 退貨中橘線(卡 §4 資料缺口)
- ❌ `.fchip` → `.tab` 改造 —— **它是版面改動,不是換值**,且 §0-D 第 6 列記著我們是**知情地**用 `aria-current` 偏離 OD。改它要重讀那一列
- ❌ 斑馬紋、建立包裹改名、詳情頁單頁化 —— 各自獨立,不塞進本片
- ❌ 欄寬 —— 六顆已與 §0-D 拍板值逐字相同,**不要動**
- ❌ **商品卡 `.pcard` 改造** —— 定案版 `overview-desktop.html:1024-1101` 把採購/到貨/出貨收進**每張商品卡的三個收合段**,
  並把「到貨登錄」表單**移出 9 欄表**(那正是 brief §1 病灶的解法)。
  🔴 **那是換結構,不是換樣式** ⇒ 不塞進本片。3.4 只是把現有 `ItemsTable` 那一欄改成橫排,**兩件不要混為一談** ——
  ⚠️ **而橫排這個形狀看起來就像 `.pcstep`,所以更容易被誤讀成「商品導向做完了」**
- ❌ **五筆綠勾債**(`col-oid` 132 / `col-vehicle` 180 / `col-title` 154 / `col-brand` 188 / `col-invoice` 56 只剩 1px)
  —— **本片不解、也不得惡化。** 🔴 **改排版時若非動欄寬不可 ⇒ 停下來回報,不自行決定**
- ❌ **§0-G ③ 供應商只顯示名字** —— **已合格,不用做**:
  OD 定案版 `<td>RPM Carbon</td>` / `<td>鴻鎧國際</td>`;repo `item-procurement-section.tsx:165` 是 `p.supplierLabel`。
  §0-G 罵的那句長敘述是**當時 OD 的寫法**,repo 從來沒那樣寫過

---

## 9-附錄 🔴 引用 OD 哪一份 —— **判準 + 全樹逐處分層**

> **為什麼在這裡**:`.fchip`(§9 那條「本片不做」)只是這一族的其中一處。
> 這張表把整族攤開,免得下一個人拿到一個總數就去「全部改成 bmw-m」。

### 判準(先讀這條,再看表)

```
overview-desktop.html      = 【定案版】1,983 行，十二輪累積，資訊架構 / 版面 / 文案的權威
overview-desktop-bmw-m.html= 【外觀 reskin】778 行，只 reskin 列表 + 詳情面板的【外觀】
                             檔頭逐字：「資訊架構一個字都沒動…改的只有外觀」

引【版面 / 資訊架構 / 欄寬 / 密度 / 落點 / 文案】→ 定案版  ✅ 正確，不要改
引【顏色 / 形狀 / 字距 / 膠囊 / 選中態】        → 要改引 -bmw-m
```
🔴 **「一個成立的引用」與「引錯版本」長得一模一樣,差別在【它引的是哪一層】。**

🔴🔴 **但這條規則只是【分流的第一刀】,不是判準本身** ——
**實測反例:`.kb` 那顆按鈕,bmw-m 把它從 `26px / radius 6px` 改成 `24px / radius 0`。**
⇒ **bmw-m 確實動了幾何,不只動顏色** ⇒ **每一處仍要逐處開兩份檔比對,規則只用來排序要先看哪幾處。**

### ⚠️ 數字先更正:**36(含本片工作區)/ 31(乾淨樹)** —— 而且**兩個都會過期**

```
git grep -n 'overview-desktop\.html' -- apps packages | grep -v bmw-m | wc -l
  HEAD 43abb127 ＋ 本片未 commit 的工作區  ⇒ 36
  HEAD 43abb127 乾淨樹（git stash 之後實測）⇒ 31
🔴 量測時點 2026-08-17。兩個數字都是對的，差在【工作區乾不乾淨】。
```
🔴 **本片新增 5 處**(實測 `31 → 36`,逐檔比對):
`globals.css` +1、`order-status-axes.ts` +2、`order-detail-items-table.tsx` +2。

> ### 🔴🔴 這一段我自己踩了兩次,兩次都留著
>
> **① 我流通出去的「32」** —— 而乾淨樹實測是 **31**。那個 32 是**更早的某次量測**,
> 我沒有記時點就把它當現況轉述。
> **② 更糟的是**:我第一版寫這段時,句子是「**從乾淨的 43abb127 量會得到 32**」——
> **我沒有量就寫了那個數字,而它就寫在一段【警告不要寫沒量過的數字】的文字裡面。**
> ⇒ 是回頭跑 `git stash` 實測才發現是 31。**寫警告不會讓人免疫於那個警告。**
>
> ⇒ **通則(這才是這段的價值,不是那兩個數字)**:
> **報這類數字一律帶【量測時點 + 當時 HEAD + 工作區乾不乾淨】,三個缺一個就複現不了。**

🔴🔴 **這不是量錯,是【動態分母】** —— **這一輪的動作改變了被量的東西。**
⇒ **通則:報這類數字一律帶【量測時點 + 當時 HEAD + 工作區乾不乾淨】**,三個缺一個就複現不了。
📎 同型坑設計參照檔記過(`git show <commit>:<檔>` 才複現得了舊數);**這次是我踩,而且是我自己造成的。**

### 逐處分層(36 處 = 乾淨樹 31 + 本片新增 5)

| # | 位置 | 引的是哪一層 | 結論 |
|---|---|---|---|
| 1 | `globals.css:523` 欄寬 13 顆 CSS 宣告 | 版面 | ✅ |
| 2 | `globals.css:607` 密度三檔值 | 版面 | ✅ |
| 3 | `globals.css:731` `table-layout:fixed` | 版面 | ✅ |
| 4 | `globals.css:743` nowrap+overflow+ellipsis 三件 | 版面 | ✅ |
| 5 | `globals.css:749` `padding:0 8px` | 版面 | ✅ |
| 6 | `globals.css:987` 窄版收哪些欄 | 版面 | ✅ |
| 7 | `globals.css:1062` 520 斷點 | 版面 | ✅ |
| 8 | `globals.css:1139` 解除桌機截斷 | 版面 | ✅ |
| 9 | `globals.css:1154` 收欄位規則作廢 | 版面 | ✅ |
| 10 | `globals.css:1212` 卡片落點 `k-oid`→`k-st` | 版面 | ✅ |
| 11 | `globals.css:1269` 卡片 ⋯ 36×36 | 版面 | ✅ |
| 12 | `refund-wiring.test.tsx:968` 危險操作沉底 | 資訊架構 | ✅ |
| 13 | `customer-panel.tsx:47` 手機雙標題列病 | 版面 | ✅ |
| 14 | `order-detail.tsx:162` 客人明細入口位置 | 版面 | ✅ |
| 15 | `order-detail.tsx:217` 備註在發票下方 | 版面 | ✅ |
| 16 | `order-detail.tsx:300` 危險操作沉底 | 資訊架構 | ✅ |
| 17 | `orders-table.test.tsx:924` 520 斷點 | 版面 | ✅ |
| 18 | `orders-table.tsx:22` 泛指真權威(rowSpan 收斂) | 版面 | ✅ |
| 19 | `orders-table.tsx:32` `rowspan` 命中 0 | 版面 | ✅ |
| 20 | 🔴 `orders-table.tsx:340` **欄序 / 卡片模式 order** | 版面 | ✅ **見下方專段** |
| 21 | `orders-table.tsx:526` 密度值單一來源 | 版面 | ✅ |
| 22 | `order-list-view.ts:96` 密度值域 | 版面 | ✅ |
| 23 | `order-return-to.ts:54` 返回導航行為 | 行為 | ✅ |
| 24 | `order-status-axes.ts:10` 狀態八值字面 | 文案 | ✅ |
| 25 | `notes-timeline.tsx:26` note_type 三類分色 | 外觀 | ✅ **bmw-m 沒有這東西**(`nt-internal\|nt-contact\|nt-notified` ⇒ 0 命中)⇒ 定案版是唯一來源 |
| 26 | `order-density-toggle.tsx:13` 密度鈕形狀 | 外觀 | ✅ **bmw-m 沒有密度鈕**(`denbtn\|data-den\|密度` ⇒ 0)⇒ 同上 |
| 27 | `orders-table.test.tsx:1709` `⋯` = U+22EF | 字元 | ✅ bmw-m 也是同一顆(`⋯` ⇒ 1 命中) |
| 28 | `order-detail-items-table.tsx:53` `.pcstep` | 版面 | ✅ 本片新增,已明寫「定案版」;bmw-m 無 `.pcstep` |
| 29 | `order-detail-items-table.tsx:67` `.pcard` 商品卡 | 資訊架構 | ✅ 本片新增 |
| 30 | `globals.css:443` | 說明 | 📝 本片新增的**對照說明**,不是引它當權威 |
| 31 | `order-status-axes.ts:97` | 說明 | 📝 同上 |
| 32 | `order-status-axes.ts:103` | 說明 | 📝 同上(判準本身) |
| 33 | 🔴 `globals.css:854` `.fchip` 常態 + 選中 | **外觀** | ❌ **引錯版本**(bmw-m `.fchip` ⇒ **0 命中**、改成 `.tab` ⇒ 7)。**本片不做**(§9) |
| 34 | 🔴 `order-filter-chips.tsx:7` `.bar .fchip` | **外觀** | ❌ **引錯版本**,同 33。**本片不做** |
| 35 | 🔴 `globals.css:953` `.kb` 10 個宣告 | **外觀 + 幾何** | ❌ **引錯版本,本次新發現**(見下) |
| 36 | ⚠️ `order-toolbar.tsx:29` `<h2>訂單</h2>` 後緊接四顆 `.fchip` | **判不出來** | ⚠️ 見下 |

### 🔴 #35 `.kb` —— 本次新發現的第三處引錯

```
舊版 :214-215   border-radius: 6px   width/height: 26px
BMW M :187-189  border-radius: 0     width/height: 24px      ← 兩顆都不同
repo            width/height: 26px（舊版值）
                border-radius 原本寫死 6px ⇒ 已被 R3 抓到、改吃 --radius（現為 0）
```
⇒ **圓角碰巧對了**(靠「禁裸 radius」那條規矩修的,**不是照 bmw-m 修的**);**尺寸仍是舊版的 26px。**
🔴 **本片不做**,兩個理由:
① `Q-視覺` 那批他答的是列表與膠囊,**沒有問過這顆按鈕**;
② 那顆按鈕**有熱區實測紀錄**(`#486` 乙案的 hit test)⇒ 26→24 要重驗熱區,不是換個數字。

### ⚠️ #36 為什麼判不出來(不硬歸類)

`order-toolbar.tsx:29` 引的是「**標題之後緊接四顆 chip**」這個**排列順序** ⇒ 看起來是版面 ✅。
**但 bmw-m 把那一列的元件整個換掉了**(`.fchip` 膠囊 → `.tab` 底線頁籤),
⇒ **「順序」在 bmw-m 仍成立,「那四顆是什麼」不成立。**
⇒ **同一個引用有一半對、一半錯,而我判不出該算哪一邊。**
**缺的那道檢查**:`.fchip → .tab` 要不要做本身還沒拍板(§9 列為本片不做)⇒ **那題答了,這格才判得出來。**

### 統計(可重跑)

```
36 處 ── ✅ 正確 30 ／ 📝 說明性 3 ／ ❌ 引錯版本 3 ／ ⚠️ 判不出來 1
❌ 三處全部【本片不做】：.fchip ×2（等拍板）、.kb ×1（要重驗熱區）
🔴 本片修掉的那一處（PAY_MARK 未收款紅框）不在上表 —— 它已經改成引 -bmw-m 了。
```

---

## 10. 相關既有紀錄與連動面

- `docs/specs/2026-08-12-admin-order-ui-design-brief.md` §0-D 那張「OD 內部字面不可盡信」表 ⇒ **本片發現的「抄錯版本」是同一個模式的第 7 例,收尾時要加進那張表,不另開一節**(該節明文要求)
- `docs/design/admin-design-system.md` 檔頭落地狀態表 ⇒ 本片完成後要更新「動效 token 消費端 0」以外的兩列
- memory `feedback_claimed-sync-but-only-patched-touched-lines` ⇒ 改註解字面時走 literal-sweep
- memory `project_0817-od-impeccable-polish-for-admin-visuals` ⇒ 🔴 **附一行指標:`impeccable-design-polish` 會【就地改寫】OD 專案的入口檔。要打磨先 `create_project` 複製一份,不要在被 repo 用 hash 釘住的專案裡跑**(2026-08-17 A 窗實際踩過並還原;全文由主視窗落 memory)
