# 2026-08-14 · OD 頁面的殼 —— **盤點,不是實作**

> Sean 08-14 拍 `Q2`=A(要盤)、`Q4`=B(排在 E 的欄寬片之後、不並行)。
> **本檔一行 code 都沒動**(數法:`git status --porcelain | wc -l` = 1,唯一那行是本檔的 `??`)。
> Sean 逐字指出的四項差異:**左側導覽列 / 上方分頁(全部・待處理・未到貨・退貨中)/ 彩色狀態標籤 / 操作改「⋯」選單**。
> 🔴 L3 那四片只做了「表格裡的欄位」,**沒有做頁面的殼**。這是另一條線。

## §0 真權威位置(先驗才寫,引錯整份作廢)

**OD 專案根**:`~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/pcm-admin-order-ui/`
**唯一權威 = `overview-desktop.html`(1983 行)** —— 與 L3 片3/片4 用的是同一支。

驗法(當場跑、不憑記憶):`sed -n '121p' overview-desktop.html` 回
`.k-oid{width:76px}  .k-date{width:56px} .k-veh{width:180px} .k-brand{width:96px}`
= 與 `docs/specs/2026-08-12-admin-order-ui-design-brief.md:286` 引的 `:121-124` **逐字相同** ⇒ 來源同一份、行號沒漂。

同目錄的 html 共 **6 支 · 4616 行**(數法:`wc -l "$OD"/*.html`):`overview-desktop.html`(1983)/
`order-detail-directions.html`(749)/`customer-card-summary.html`(645)/`orders-list-directions.html`(634)/
`customer-card-directions.html`(373)/`index.html`(232)。
**除 `overview-desktop.html` 外都是說明稿,不是會被執行的那一份** —— 照 design-brief §0-D 的通則,
衝突時以 `overview-desktop.html` 的 CSS 與 markup 為準。本檔引它們時一律標明是「說明稿」。

### 🔴 本次新撞到的 OD 內部矛盾與誤讀陷阱(兩條,請照 §0-D 通則加進那張表)

| # | 哪裡 | 問題 |
|---|---|---|
| 4 | `index.html:162`(說明稿)說退貨中「整組**琥珀色左邊條** + 工具列『退貨中 2』計數」 | `overview-desktop.html` 內 `border-left` **只有 2 處**(`:87` 面板分隔線、`:488` 「尚未實作」標籤塊),`data-ret`/`tr.ret`/`.ret-row` **0 命中**。⇒ **列層的琥珀左邊條在會執行的那份裡不存在**,只有 `.fchip-ret`(`:477`)那顆 chip 是琥珀色。數法:`grep -c 'border-left' overview-desktop.html` = 2 |
| 誤讀陷阱 | `overview-desktop.html:1638` 自檢句「**頂部 chip 排是否已移除**」 | 它的 `root` 是 `[data-detail]`(**訂單詳情面板**),指的是面板內那排 chip,**不是**列表工具列的 `.fchip`。⇒ **不要讀成「OD 已經把工具列分頁拿掉了」** —— 工具列那排在 `:611-614` 與 `:647-649` 兩處都還在 |

---

## §1 四項逐條對照

### 1-1 左側導覽列

| | OD | 我們 |
|---|---|---|
| markup | `overview-desktop.html:607`:`<nav class="rail"><b>PCM</b><a aria-current="page">訂單</a><a>客戶</a><a>供應</a><a>設定</a></nav>` | `apps/admin/src/components/layout/app-sidebar.tsx:23-36` `NAV_ITEMS` **7 項**:總覽 / 訂單 / 退款異常 / 客戶 / 員工管理 / 供應商 / 設定 |
| CSS / 行為 | `:80-84`:寬 **52px 固定**(`flex:0 0 52px`)、**常駐不收合**、純文字無圖示、`a[aria-current]` = 深色實心 | `app-sidebar.tsx:61` `<Sidebar collapsible='offcanvas'>` = 收起時**整條滑出畫面**(寬 0);展開為 shadcn 標準寬度、每項帶 icon |

🔴 **差異不是「我們沒有側欄」,是三件事同時不同**:①寬度與常駐 vs 整條收起 ②項目 7 vs 4 ③有無圖示。
🔴🔴 **對齊 OD 會撞到 Sean 自己的拍板**:`app-sidebar.tsx:48-54` 記著 **#380(Sean 2026-08-10 深夜正式站肉眼驗)**
把收合模式從 `icon`(留窄圖示列)改成 `offcanvas`(整條收起),逐字理由是他要「整條收起」而不是「收成一條窄列」。
**OD 的 52px 常駐 rail 正是他當時否掉的那個形狀。** ⇒ 這一項**不是實作題,是決策題**(見 §3 Q1),不得逕自動手。

### 1-2 上方分頁(全部・待處理・未到貨・退貨中)

| | OD | 我們 |
|---|---|---|
| markup | `:610-614`(面板開)與 `:646-649`(面板關):`.bar` 內 `<h2>訂單</h2>` + 4 顆 `<button class="fchip">`,退貨中那顆多帶計數 `<b>0</b>` | **不存在**。工具列 = `apps/admin/src/app/orders/page.tsx:162-180`(`<h1>訂單</h1>` + `OrderDensityToggle` + `OrderKeywordSearch`)+ `:233` `OrderFilterBar` |
| CSS | `:91-99`:`.bar` 高 **34px**、`.fchip` 藥丸、`aria-pressed=true` 深色實心;`:477` `.fchip-ret` 琥珀 | 篩選是 `<select>` 下拉:`order-filter-controls.tsx:186-204`(付款狀態 / 出貨狀態 / 來源 / 管道)+ 日期區間 `:230-271` |
| 已知坑 | `:479-480` 逐字:加了退貨中 chip 之後,**面板開著(658)時工具列被壓到換行**、「待處理」斷兩行、高度 41px 撐破 34px 的列 | — |

**四顆 chip 各自能不能接到既有 param**(`order-list-view.ts:41-44` 白名單 `payment_status` / `fulfillment_status` / `order_source` / `payment_channel`):

| chip | 能不能接 | 依據 |
|---|---|---|
| 全部 | ✅ 清空篩選即是 | 既有 `buildOrderListHref` |
| 未到貨 | ⚠️ **可接但要定義**:`FULFILLMENT_STATUS_LABEL`(`order-list-view.ts:160-165`)= 未訂貨 / 已向廠商訂貨 / 已到貨 / 已出貨 ⇒ 「未到貨」= 前兩值的**聯集**,而現行 `<select>` 是**單值**。需要新的 param 或多值支援 | `order-list-view.ts:160-165` |
| 待處理 | ❌ **OD 沒有定義它是什麼**。overview 只給了一顆按鈕,沒有對應的篩選語意 | `:612`(只有字面,無 data-*、無說明) |
| 退貨中 | ❌ **資料面不存在**:退貨流程未實作。`cancel-review-section.tsx:101` 逐字「已到貨的部分要**走退貨流程**」、`:155` 標「那是**第 3 批**」⇒ **沒有可篩的狀態、也沒有可數的數字** | 同左 |

⚠️ **名詞陷阱**:全 repo grep `待處理|未到貨|退貨中`(非測試 `.ts/.tsx`)的命中**全部**落在
`shipment-dialog*.tsx` / `shipment-launcher.tsx` / `shipment-candidates.ts`,那是**出貨對話框的品項文案**、
與列表分頁**不是同一個語意**。⇒ 不要靠字面認親。數法:
`grep -rn "待處理\|未到貨\|退貨中" --include='*.tsx' --include='*.ts' apps/admin/src | grep -v test`

### 1-3 彩色狀態標籤 —— 🔴 **疑似已經做完了,這一項要先驗再排**

| | OD | 我們 |
|---|---|---|
| | `:179-211`:`.cap` 藥丸 + 六種色調(`.y/.r/.g/.n/.bl/.pg…`)、`:191` `.cap.m-unpaid` 未收紅框、`:196` `.cap.n.is-dead` 已取消虛線框、`:200-202` `.cap.risk` 實心深紅 + ⚠ | **同款已上線**:`lib/orders/order-status-axes.ts` 的 `GOODS_TONE`(灰/黃/藍/綠)+ `PAY_MARK` 未收紅框 + `CANCELLED_TONE` 虛線框 + `isRisk` 實心深紅;共用形狀 `order-list-view.ts:149` `STATUS_CAPSULE`;渲染在 `orders-table.tsx:335` |

🔴 **Sean 說「差很多」的那張截圖是 08-14 早、正式站吃到 Vercel 建置快取舊 CSS 的狀態**
(`docs/handoff/2026-08-14-morning-window-rotation.md` §7-1:同一顆 commit 線上 `orders-grid` 只有 29 條規則、本機 82)。
⇒ **有相當機率他看到的是「顏色沒吃到」而不是「沒做」。** 本項**不排片**。

🏁 **後續:探測靶已經跑完了,推論可以升級成觀察。** 欄寬片(`fa6ca0de`)已推上正式站,
Sean 在正式站 Console 貼的原始輸出(主視窗 2026-08-14 轉述):
```
14l166in0fowz.css | 長度65338 | mid×1 | 132×1 | 322×0
content-shared.css | 長度242362 | mid×0 | 132×0 | 322×0
```
⇒ 三個判讀全過(第二支本來就不含這些規則)⇒ **線上跑的是新產物、沒有吃到建置快取。**
**他現在看到的畫面已經不是那張截圖了。** 下次他再提彩色標籤,那是在**新產物**上提的,**那才算真差異**,屆時再開片。
⚠️ 一個未解釋的數字:本機 build **65,346 bytes** vs 線上 **65,338**,**差 8 bytes,沒查、不知道原因**
(對照組:今早那次真故障差 **2,113 bytes**、規則少一半 ⇒ 不是同一個量級)。

### 1-4 操作改「⋯」選單

| | OD | 我們 |
|---|---|---|
| 列表列 | `:985`:`<td class="k-ops">${first&&!o.cancelled?'<button class="kb">⋯</button>':''}</td>`;CSS `:214-216`(26×26 方鈕、hover 才出底) | `orders-table.tsx:375-398`:第一列渲染**兩顆**「取消」`<Link>`(桌機 `data-nav='panel'` / 手機 `data-nav='page'`,由 CSS 分流),已取消顯示「—」 |
| 選單本體 | `:1052`:`<details class="km"><summary class="k">⋯</summary><div class="kmenu">…</div></details>`;CSS `:401` `.km{position:relative;display:inline-block}` | **不存在** |
| 意圖 | `orders-list-directions.html:243`(說明稿)逐字:「最右邊釘住的『操作』欄,一顆 ⋯ 選單鈕(訂單層,跨該單所有品項列一次)。**未來的退款／沖銷／重寄通知全部進同一顆選單,不必再加欄**。已取消的單那格顯示『—』」 | — |
| 欄寬 | **`:124` `.k-ops{width:34px}` + `:127` 內距 2px** —— **OD 的訂單列表列自己就是 34px** | 我們 `col-ops` **也是 34px**、內距也是 2px(`globals.css`)⇒ **兩邊一樣,沒有差** |
| ~~已知坑~~ | 🔴 **我一度引 `:1047` 的「給 38」當成本片前置 —— 那是引錯表。** `:1047` 在**客戶卡/供應商那塊**(`.k-cell` + `<details class="km">`),不是訂單列表列。**已實測推翻**:把 OD `.kb`(26×26、`:214-216` 逐字)放進我們 34px 的格子 ⇒ **0/15 被截**、整表不溢位;改成 38px 反而讓總寬 1412→1416 **造成橫向捲軸**。 | ⇒ **沒有 4px 前置這回事** |

---

## §2 片界拆分建議(**不含 1-3,它先驗不排片**)

| 片 | 內容 | 估時 | 片型 | 鐵則 8 | **改完 Sean 看得到什麼** |
|---|---|---|---|---|---|
| **S1** | 工具列 chip 排的**殼**:`.bar` 版面 + 「全部」與「未到貨」兩顆可用 chip(含 `fulfillment_status` 多值支援 + 白名單) | 40 分 | 標準片 | **會**(page.tsx + 新元件 + `order-list-view.ts` + 測試 = 4 檔)⇒ **先提 plan 等批** | ✅ 明顯:訂單標題旁多一排藥丸,按「未到貨」列表立刻只剩沒到貨的單 |
| **S2** | 「待處理」chip | 20 分 | 輕量片 | 否 | ✅ 多一顆可按的 chip —— **但前提是 Q2 定義先拍** |
| **S3** | 「退貨中」chip | — | — | — | ❌ **不排**:資料面不存在(§1-2)。要嘛等退貨流程,要嘛先做成永遠 0 的假 chip(不建議) |
| **S4** | 操作欄改 ⋯ 選單(`<details>` 原生、零 JS;沿用雙 `<a>` 分流) | 45 分 | 標準片 | 否(orders-table.tsx + globals.css + 測試 = 3 檔,**剛好在線上**,體積若超過就拆) | ✅ 明顯:操作欄從「取消」兩個字變成一顆 ⋯,點開才出功能表 |
| **S5** | 側欄 | — | — | — | ⛔ **不排**:撞 #380(§1-1),**是決策題不是實作題** |

**總估時(可排的三片)= S1 40 + S2 20 + S4 45 = 105 分**,不含 plan 與審查。
🔴 **S2 與 S4 有前置**(S2 等 Q2、S1 等 plan 批准),**實際可立刻開工的只有 S1 的 plan**。

## §3 相依與衝突(排隊順序)

**同檔衝突** —— 下列片會動到我剛做完的欄寬片同一批檔:

| 片 | `orders-table.tsx` | `globals.css` | 說明 |
|---|---|---|---|
| S1 | ✗ | ✗(新元件自帶樣式) | 只動 `page.tsx` + 新元件 + `order-list-view.ts` ⇒ **與欄寬片零衝突** |
| S4 | **✓**(`:375-398` 操作格整段換掉) | **✓**(`col-ops` 寬度 + `.km/.kmenu` 新樣式) | 🔴 **與片5/片6 同檔** |

🔴 **原本這裡寫著「S4 要多 4px、得 Sean 再拍一次」—— 那是我引錯 OD 的表,已實測推翻(見 §1-4)。**
**S4 不需要動欄寬**:OD 的訂單列表列自己就是 `.k-ops{width:34px}`,與我們相同;
實測把 OD `.kb`(26×26)放進我們 34px 的格子是 **0/15 被截**、整表不溢位。
⇒ **S4 只剩「與欄寬片同檔」這一條普通相依**(`orders-table.tsx` + `globals.css`),排在 S1 之後即可。

**與別線的衝突**:S1 動 `order-list-view.ts` 的 param 白名單 —— D 線 `#452` 與 R 線 `#445` 目前都不碰這支
(未逐檔核對 D/R 的在製品,**這句是看 dev 現況說的,不是問過他們**)。

## §4 要 Sean 拍的(三題,我不代拍)

- **Q1 側欄**:OD 是 52px 常駐 4 項純文字 rail;我們是 offcanvas 7 項帶圖示,而 **offcanvas 是他 #380 自己拍的**,
  對齊 OD 等於推翻它、而且要拿掉「總覽 / 退款異常 / 員工管理」三個入口。
  ⇒ 選項該長什麼樣要**產圖**再問(視覺題),本檔不擬選項。
- **Q2 「待處理」是什麼**:OD 只給按鈕沒給定義。這題**不問就做不了 S2**。
- ~~**Q3 操作欄的 4px**~~ 🏁 **這題作廢,不用問 Sean** —— 我引錯 OD 的表,實測 34px 就裝得下(§1-4)。

## §5 我沒盤到的(誠實缺口)

- **`order-detail-directions.html`(749 行)與 `customer-card-*.html`(1018 行)整份沒讀** —— 它們是**詳情面板與客人卡**,不在 Sean 這次點名的四項裡。若殼線之後要做面板,那兩份要另盤。
- **手機/窄容器下這四項長什麼樣:沒盤。** OD 那兩個 stage 都是 1440 桌機(`:604`、`:638`)。卡片模式下 chip 排與 ⋯ 選單怎麼擺,**OD 沒有給,我也沒找**。
- **S1/S2/S4 的估時是我看 diff 面積估的,沒有拆到步驟級。** 標準片 40-45 分是「經驗值」不是量出來的。
- **「待處理」有沒有可能其實在 OD 別處定義過**:我只 grep 了 `overview-desktop.html` 與兩份說明稿的字面,**沒有讀完 `orders-list-directions.html` 全文**(634 行)。定義若藏在那份的敘述裡,我會漏掉。
- **1-3(彩色標籤)我斷言「疑似已完成」是根據 code 與我自己的截圖** —— **我沒有看過 Sean 那張截圖本人**,也沒驗過線上現況。這條要靠部署後探測靶收尾。
- **沒有跟 D/R 兩窗確認在製品** —— §3 最後那句只看了 `dev`。
