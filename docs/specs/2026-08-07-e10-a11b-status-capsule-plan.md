# A11b — 訂單列表三軸膠囊 slice plan v1

> **狀態:自寫 plan、不回核**(`E-133-A` 授權:預期 2-3 檔=標準片自判鐵則 8)。
> **真權威 = 母 plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:452`(row 60)逐字:**
>
> > | 60 | **A11b** | U | 列表桌機:**三軸膠囊元件**(付款單層 / 訂貨·出貨品項層,`n/m` 顯示;出貨軸唯讀灰) | — |
>
> 🔴 **派工單 `E-133-A:7` 寫的軸是「付款/出貨/工作流」,與真權威不符** —— 真權威是
> **付款 / 訂貨 / 出貨**,沒有「工作流」(九碼已於 A11a-1 全面下架,列表側零渲染面)。
> 依鐵則 1 精神以真權威為準,不照派工單字面。
> 事實親查於 `pcm-refund-wire`(ff 追平 `origin/dev` @ `1047ff1c`),引用附 `檔案:行號`。

---

## §1 ⛔ 片界的實質變更:三軸**今天只做得了兩軸**

| 軸 | 層級 | 資料在不在 | 本片 |
|---|---|---|---|
| **付款** | 訂單層 | ✅ `AdminOrderSummary.paymentStatus`(5 態,`types.ts:40-45`)| ✅ 做 |
| **訂貨** | 品項層 | ✅ `quantitySummary.orderedQuantity / quantity`(A9c 已正規化為非 nullable)| ✅ 做 |
| 🔴 **出貨** | 品項層 | ❌ **不存在** | ⛔ **不做,見下** |

**出貨軸做不了,三條獨立證據**:

1. `packages/domain/src/order/types.ts` 的 `AdminOrderItemQuantitySummary` 只有
   `quantity / orderedQuantity / instockQuantity / cancelledQuantity / cancellableQuantity`
   —— **沒有 shipped**。列表讀模型拿不到出貨量。
2. `types.ts:555-557`:`shipped_quantity` 是**有拍板的契約債**(Sean 2026-08-05 Q1=A/Q2=A
   「出貨必先到貨、無直送」⇒ `shipped ⊆ instock`),本式不改 —— 也就是說出貨量至今未進本式。
3. A11a plan `:106` 逐字:出貨欄「🔴 **無** —— 第 2 批才建表(母 plan §5.2);
   **A11b(row 60,`:452`)定「唯讀灰」**」⇒ **連欄位都還沒有**(A11a-6 未落地)。

⇒ 硬要畫出貨膠囊 = 畫一個**沒有資料來源的 UI**,比不畫更糟(它會長得像「已出貨 0 件」)。
**本片交付兩軸,出貨軸掛回 A11a-6 之後**;這是**縮範圍,不是我可以自己拍的板**
⇒ 照實作、照實報,收工 STOP 明列給主視窗/Sean 裁要不要另立片。

---

## §2 現況(要改的兩處長什麼樣)

| 軸 | 桌機現況 | 手機卡片現況 |
|---|---|---|
| 付款 | `orders-table.tsx:117-121` 純文字小字,**只有 `unpaid` 上紅**、其餘一律灰 | `:241-245` 同一條 |
| 訂貨 | `:169-171` 純文字 `n/m` | `:273-276` 同一條 |

🔴 **付款軸有一個已登記的病**(`orders-table.tsx:115-116` 逐字;🔴 v1 原寫 `:119-120` 是**錯的**,
那兩行是 `>` 與標籤本身 —— 階段 C 抓到,已對 HEAD 實查更正):
「`refunded` / `partiallyRefunded` 目前與 `paid` 同灰 = **訊號塌陷**,已列交棒決策題、
**不在本片自行加色**」—— 那個「本片」指 A11a-1。**A11b 就是來加色的片**,
所以本片處理它**不是範圍擴張、正是它的職責**。

**既有膠囊慣例(照抄、不自創)**:
- 形狀:`inline-flex rounded-full px-2 py-0.5 text-xs`(`customer-detail-sections.tsx:23` 等 4 處同款)
- **Record 驅動配色的先例**:`notes-timeline.tsx:15-19`
  `{ notified: 'bg-emerald-100 text-emerald-700', not_notified: 'bg-muted text-muted-foreground',
  unknown: 'bg-amber-100 text-amber-700' }`,用法 `:89`。
  ⇒ 語彙 = **綠=完成 / 琥珀=進行中或要注意 / 灰=中性或未開始 / 紅=要處理**。

---

## §3 要做什麼

| # | 內容 |
|---|---|
| **S1** | `order-list-view.ts` 加兩張 `Record` 配色表 + 一個共用 class 常數(**不是新元件**:兩份 markup 各自套 class,避免多一層抽象)|
| **S2** | 付款軸:桌機與卡片都改成膠囊,5 態各自配色(§4)|
| **S3** | 訂貨軸:桌機與卡片都改成膠囊,依 `n/m` 完成度配色(§4)|
| **S4** | 🔴 **兩份 markup 一致性守門**:同一筆資料在桌機與卡片要拿到**同一個 class 字串**(見 §5-4)|
| **S5** | 出貨軸**不做**;在 `orders-table.tsx` 檔頭寫明「A11b 只落兩軸、出貨軸前置=A11a-6」|

**不做**:不碰 `AdminDataTable`、不動欄位數、不加 client 邊界、不改 `shouldMergeAmount`、
不預埋 A13 操作欄、**不動任何金額/tier 的呈現**(鐵則 12 面)。

## §4 配色(照既有語彙,非自創視覺)

**付款軸**(`PAYMENT_STATUS_LABEL` 五態,`order-list-view.ts:77-84`):

| 態 | 顏色 | 理由 |
|---|---|---|
| `paid` 已付款 | 綠 `bg-emerald-100 text-emerald-700` | 完成 |
| `unpaid` 待付款 | 紅 `bg-destructive/10 text-destructive` | **要處理**;沿用現行唯一上紅的那態,顏色不變 |
| `partiallyPaid` 付款確認中 | 琥珀 `bg-amber-100 text-amber-700` | 進行中 |
| `refunded` 已退款 | 灰 `bg-muted text-muted-foreground` | 已結案但非正向 |
| `partiallyRefunded` 已退部分 | 琥珀 | 仍有未結事項 |

⇒ **訊號塌陷解除** = 退款系不再與 `paid` 同色(這正是 `orders-table.tsx:119-120` 登記的那個病)。
🔴 **v1 更正(實作時自己發現)**:上一版寫「五態**兩兩可辨**」是**假的** —— 本表只用了 4 個色相,
而 `partiallyPaid` 與 `partiallyRefunded` **同為琥珀**。兩者標籤不同(付款確認中 / 已退部分)⇒ 讀得出來,
且都屬「未結、要看一下」;但**顏色上確實不可辨**。要五色互異得引入 repo 目前沒有的第 5 個色相
= 視覺決定,**不由我拍** ⇒ 維持 4 色、把事實寫準,列進 STOP 給 Sean 否決。

**訂貨軸**(依 `orderedQuantity` vs `quantity`):

| 情形 | 顏色 |
|---|---|
| `ordered === 0` | 灰(還沒開始)|
| `0 < ordered < quantity` | 琥珀(部分)|
| `ordered >= quantity` | 綠(齊了)|

🔴 **配色屬視覺,Sean 有否決權** —— 但它照的是 repo 既有語彙、且改一行常數就能換,
不值得為它停工等拍板。**收工 STOP 列進肉眼驗清單。**

## §5 驗收(每條可 yes/no)

1. 付款軸五態**各自**有測試;並有一格直接釘死**登記在案的那個塌陷**:
   `refunded` / `partiallyRefunded` / `unpaid` 三者**皆不得與 `paid` 同色**、`refunded ≠ unpaid`、
   相異色數 **≥ 4**。~~顏色兩兩不同~~(v1 更正:4 色相下不可能,見 §4)。
2. 訂貨軸三種完成度各有測試,**邊界值** `ordered === quantity` 與 `ordered === quantity - 1` 都測。
3. **桌機與卡片拿到同一個 class**:同一筆 fixture 下,兩份 markup 的膠囊 class 字串**相等**
   —— 這是雙 markup 一致性的直接觀察面(`orders-table.tsx` 檔頭那條警告的第一次實踐)。
4. 既有測試**全綠**;若有格因膠囊改動而失去判別力(A11c 的教訓),**鎖範圍不放寬**,並在 plan 記。
5. 三綠 `--force`(貼 `Cached: 0`)+ 全套;**Δ 用實數對帳**(基準已落 scratchpad)。
6. **突變證**:①把某一態的顏色改成與另一態相同 ⇒ 「相異色數 ≥ 4」那格紅;
   ②把卡片的膠囊 class 改掉 ⇒ 一致性格紅;③拿掉訂貨軸的完成度分流 ⇒ 邊界格紅。**各自只紅該紅的。**
7. 真瀏覽器 390×844 + 1280 實看(真 CSS + 真實渲染輸出),**負向對照**證明探針抓得到顏色差異。
8. 零 client 邊界守門續綠。

## §6 鐵則判定

- **鐵則 8**:預期 **2-3 檔**(`order-list-view.ts` + `orders-table.tsx` + 其測試,可能加 `order-list-view.test.ts`)
  ⇒ 未達「跨 3+ 檔」門檻,且 `E-133-A` 明授自判 ⇒ **自寫 plan、不回核**。
- **鐵則 12**:**不觸發** —— 零 `packages/ui`、零 schema/金流/權限/平台設定;
  金額與 tier 的呈現**一個字元不動**;零 client 邊界(守門格續存)。
- **鐵則 9(L 分級)**:**配色 = L1**(年 0-1 次)hardcode 可;**標籤沿用既有 L2 登記**
  (`order-list-view.ts:75` 逐字「L2 hardcode、未來移後台 CMS」),本片**零新增文案** ⇒ 不改其分級。
- **鐵則 5**:Tailwind class 與 TSX 同檔同 slice。
- **鐵則 6**:`orders-table.tsx` 現 333 行;本片預估 +30~50 ⇒ **可能破 400**。
  🔴 破了就**當場拆**(把兩張配色表與 class 常數移進 `order-list-view.ts` 正是為此)。
- **片型 = 標準片** ⇒ 全 9 步、含 code-reviewer;不需 codex。

## §7 假設(不確認不准施工)

| # | 假設 | 怎麼驗 |
|---|---|---|
| A1 | 出貨軸真的沒有資料 | ✅ 已驗(§1 三條證據)|
| A2 | 五個付款態在列表都可達 | 施工前確認 `AdminOrderSummary.paymentStatus` 型別即全集(已見 `types.ts:40-45`)|
| A3 | 加膠囊不會讓既有測試失去判別力 | 🔴 **A11c 剛踩過**:改動後必須**逐族**盤既有斷言(`getByText` / `querySelector` / `innerHTML` 計數 / `textContent` 正向),不只看有沒有轉紅 |

## §8 誠實邊界

1. **出貨軸不做**(§1)—— 縮範圍,交主視窗/Sean 裁。
2. 配色是**照 repo 既有語彙推的**,不是視覺設計;Sean 可否決,列進肉眼驗清單。
3. 實作**照 `E-132-A` 授權派 sonnet**,diff 與承重斷言由我主對話親核親跑;subagent 宣稱一律不採信。

— E 窗(九碼退場窗),2026-08-07
