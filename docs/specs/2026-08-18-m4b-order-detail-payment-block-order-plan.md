# Plan(小):把「收款」區塊搬到「到貨」之後

> # 狀態:**已批准**
>
> ```
> 誰      Sean（主視窗轉；memory project_0818-sean-eleven-rulings-noon.md:19 我開檔核過）
> 哪一天  2026-08-18 中午
> 原文逐字  `09 收款區搬到到貨之後          = 甲`
> ```
> **作者 = W3。** 樹 `/Users/sean_1/pcm-od-list`(`od-order-list`)。
> 🔴 **這是【另一片】,刻意不併進商品卡 plan 的片 1** —— 兩件分開做、分開驗,出問題才分得出是誰造成的。

---

## §1 一句話

`order-detail.tsx` 裡 **`<PaymentSection>` 從第 4 個位置移到 `<ItemProcurementSection>`(採購 + 到貨)之後**。
**只動渲染順序,零 props 改動、零行為改動、零查詢改動。**

---

## §2 為什麼(量到的,不是覺得)

Sean 2026-08-12 逐字的主流程(memory `project_0812-sean-order-ui-workflow-and-undo-needs` §一):
**收款 → 採購(跟國外下單)→ 等到貨 → 收尾款 → 出貨**。

**同一張 5 品項的單,那五步在畫面上的 y**(真後台 + 真資料 + 真瀏覽器,viewport `1728 × 1117`;
量測環境全文 `docs/specs/2026-08-18-m4b-order-detail-product-card-plan.md` §2-b。
🔴 **拋棄式庫 + 我自己種的資料,不是正式站**):

| 第幾步 | 他要做的事 | y | 這一步要捲多少 |
|---|---|---:|---:|
| 1 | 新增收款(訂金) | 918 | — |
| 2 | 採購(向供應商訂貨) | 1,697 | ↓ 779 |
| 3 | 登錄到貨(最後一個品項) | 3,823 | ↓ 2,126 |
| 4 | **收尾款 —— 回到同一個「新增收款」** | **918** | 🔴 **↑ 2,905** |
| 5 | 出貨 | 4,267 | 🔴 **↓ 3,349** |

⇒ 走完一張單來回捲 **≈ 9,159 px**(= 上表四個位移的絕對值相加 `779+2126+2905+3349`),而整頁只有 4,640 px。
⇒ **第 4 步是折返**:收款區在採購與到貨的**上面**,而他的流程要求它在**下面**。

⚠️ **上表量在片 1 之前。** 🔴 **我已經重量了(片 1 落地後,12:1x CST,同一組量法):**

| 第幾步 | y | 位移 |
|---|---:|---:|
| 1 新增收款(訂金) | 918 | — |
| 2 採購 | 1,697 | ↓ 779 |
| 3 登錄到貨(最後一個品項) | 3,496 | ↓ 1,799 |
| 4 **收尾款 —— 回到同一個「新增收款」** | **918** | 🔴 **↑ 2,578** |
| 5 出貨 | 3,940 | ↓ 3,022 |

```
整頁高 4,640 → 4,313 px      來回捲 9,159 → 8,178 px
🔴 而第 4 步【仍然是折返】：−2,905 → −2,578。變小了 327 px，方向沒變。
⇒ 片 1 縮的是採購區的空品項高度，它【碰不到區塊順序】——
   這正是為什麼這一片必須獨立存在，而不是等片 2/3/4 順便解決。
```

**驗收量具已經寫好並且【先表演過失敗那一邊】**:`/tmp/pcm-probe-w3/flow-check.mjs`
現在跑它 ⇒ 逐字 `驗收判準：第 4 步位移必須 >= 0 ⇒ 實得 -2578 ❌ FAIL（仍在折返）`
🔴 **這一發是【動手前】跑的** —— 一個在修好之前就會綠的量具沒有判別力,所以先讓它紅一次。

---

## §3 🔴 這一片要推翻一段【寫著理由的】既有安排 —— 這是本檔最要緊的一節

`order-detail.tsx` 在 `<PaymentSection>` 上方有一段註解,把現在這個位置**當成一個決定**寫下來(逐字):

> 🔴 位置 = 收款緊跟在付款狀態與發票這一組之後:員工看完付款狀態,下一個問題就是「錢收了哪幾筆」。

**那個理由不是錯的,它只是【看單】的順序,而 Sean 講的是【做事】的順序。**
```
看單   我打開這張單想知道現況 ⇒ 付款狀態 → 錢收了哪幾筆   ← 現行安排服務這個
做事   我要把這張單往前推一步 ⇒ …到貨了 → 收尾款 → 出貨   ← Sean 09=甲 服務這個
```
🔴 **兩個都成立,而 Sean 拍了後者** ⇒ **要把那段註解改寫,不是刪掉**:
留著它才知道「為什麼曾經在上面」,否則下一個人會照同一個理由把它搬回去。

📎 **同一支檔已經有一個正確的先例**:「取消」墊底那段(2026-08-16)也是搬位置,
註解裡寫了**兩個獨立來源都說墊底**、以及「**只動渲染順序,零行為改動**」。**照那個形狀寫。**

---

## §4 要改什麼(逐項)

| 檔 | 改什麼 |
|---|---|
| `apps/admin/src/components/orders/order-detail.tsx` | `<PaymentSection>` 那一段(含它的註解區塊)整塊移到 `<ItemProcurementSection>` 之後、`<ShipmentSection>` 之前;註解改寫成 §3 那個講法 |

**今天的渲染順序**(枚舉出來的,不是憑印象。數法可重跑,回 **11** 行、與下表列數相同):
```bash
grep -nE '^ *<(OrderSummaryCards|NotesTimeline|NoteComposeForm|PaymentSection|OrderEditForm|ItemsTable|ItemProcurementSection|ShipmentSection|OrderCancelBlock|RefundLedgerSection|RefundSection)'   apps/admin/src/components/orders/order-detail.tsx
```
```
:214 OrderSummaryCards      :275 OrderEditForm            :309 OrderCancelBlock
:226 NotesTimeline          :277 ItemsTable               :313 RefundLedgerSection
:227 NoteComposeForm        :280 ItemProcurementSection   :339 RefundSection
:244 PaymentSection  ← 要搬的就是這一個
                            :289 ShipmentSection
```
**移動之後**(`PaymentSection` 從 `:244` 搬到 `ItemProcurementSection` 與 `ShipmentSection` 之間):
```
摘要卡 → 備註 → 編輯訂單 → 品項 → 採購與到貨 → 【收款】 → 出貨
       → 取消 → 退款帳本 → 退款入口          （危險操作沉底那一段完全不動）
```
⚠️ 上面那行**沒有列「標頭」** —— 標頭不是元件、grep 抓不到它,所以我也不把它算進那 11。
**數字與清單要同一把尺量出來**,不然下一個人重跑會對不上。

⚠️ **`cancelled` 那個「已取消」橫幅目前夾在 `<PaymentSection>` 與 `<OrderEditForm>` 之間**
⇒ 搬收款時**它要留在原地**(它是訂單層狀態,不屬收款)。**這是最容易順手一起搬走的一塊。**

### 4-a 鐵則 12 逐條

| 類 | 命中? | 依據 |
|---|---|---|
| ①錢 | **否** | `<PaymentSection>` 的 props(`orderId` / `returnTo` / `payments` / `amountDue`)一個字不動;不碰任何金額算式或 RPC |
| ②權限 | 否 | 不動 auth / RLS / server-client 邊界 |
| ③DB | 否 | 零 migration、零查詢改動 |
| ④平台設定 | 否 | — |
| ⑤對外不可回收 | 否 | 後台畫面 |
| ⑥`packages/ui` | 否 | 不碰 |

⇒ **標準片。** 而**因為它動的是「錢」那一區塊的位置**,我仍會跑 code-reviewer;
🔴 **自評有風險只能加審不能免審** —— 要不要加 codex 由主視窗或 Sean 決定,我不反對。

---

## §5 驗收(每條可 yes/no)

```
1 DOM 順序：採購與到貨【在】收款之前
  量法（可重跑，用 compareDocumentPosition，不用肉眼）：
    採購區標題節點 與 收款區標題節點 比位置 ⇒ 採購在前
2 「已取消」橫幅仍在編輯訂單【之前】，沒有跟著收款一起被搬走
3 <PaymentSection> 的 props 與 order-detail.tsx 其餘部分 zero diff
  量法：git diff -U0 只應命中「整塊搬移」與那段註解
4 重跑 §2 那五步的 y 位移，第 4 步【不再是往回捲】
  🔴 目標先訂在這裡：第 4 步的位移必須 >= 0（往下或原地），不得為負
     （片 1 那次我沒有先訂目標，那是我的疏漏，這次先訂）
5 四綠：TURBO_FORCE=1 typecheck / lint / build ＋ vitest（vitest 不在三綠裡，自己跑）
6 Sean 肉眼驗
```

---

## §6 rollback

```
一顆 commit、只動 order-detail.tsx 的渲染順序與一段註解。
git revert <sha> 即回到今天的樣子，零資料面殘留（因為沒有資料面改動）。
```

---

## §7 這一片**不做**什麼

```
❌ 不動「危險操作沉底」那一段（取消 → 退款帳本 → 退款入口）——那是 2026-08-16 照兩個來源改的
❌ 不動備註的位置 —— 那是 OD 第十二輪定案（overview-desktop.html:1171-1173）＋ 主視窗 MAIN-902-A Q1=A
❌ 不把「收尾款」做成一個獨立的步驟或按鈕 —— 系統裡沒有「尾款」這個概念，
   它就是再登錄一筆收款。要做成獨立步驟是另一題，Sean 沒講過。
❌ 不併進商品卡 plan 的片 1
```
