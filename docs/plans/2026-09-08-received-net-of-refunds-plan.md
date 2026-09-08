# 「已收」扣掉退款只顯示淨額 —— plan v2(**Sean 2026-09-08 拍【乙】**)

> 線【退款】`-refund` · **鐵則 12①(錢)⇒ 動碼後 codex 不降級。本檔只寫 plan, 一行碼都沒動。**
> 🔴 **v1 已作廢** —— 它要新寫一支 SQL 自己 SUM 兩張表, 而那個形狀**有一道專門擋它的守門**(§3)。
>    v1 的字面留在 git 史裡, **不要照 v1 動手。**

## §0 拍板逐字, 而【他把代價一起複製了】

```
甲 多一格「已退」⇒ 總額 / 已收 / 已退 三個數
乙 「已收」直接扣掉退款 ⇒ 只顯示淨額(而看不出收過多少)
```
**Sean 逐字答**:「**乙 「已收」直接扣掉退款 ⇒ 只顯示淨額(而看不出收過多少)**」
🛑 **括號裡那個代價他一起複製了** ⇒ **讀過才選的**, 不是漏看。主視窗推甲 —— **照拍板走。**

## §1 病(而兩個數字【各自都沒算錯】)

**Sean 看到的**(`X5F8WG` · 洪紹閔 · NT$10,500):狀態徽章【已退款】, 而「總額 / 已收」= 10,500 / 10,500。

**DB(唯讀查 · 🟢 正對照 4 列 / ⚪ 負對照 0)**:
```
orders               payment_status = refunded · total 10500 · paid_at 09-07 15:41
order_payments       cash 10500(一列, 非沖銷列)
order_refunds        0 列
order_manual_refunds 2 列(actor 都是 sean, reason 都是 test):
   6eb598e2… 10500 · voided_at 非 NULL(**已作廢**)
   f632697a… 10500 · voided_at NULL(**有效**)
```

**畫面那兩個數的來源(開檔量)**:
```
order-focal-row.tsx:297-302   總額 = detail.total.amount · 已收 = payment.received
payment-list-view.ts:273-275  sumReceived = rows.reduce((acc,r) => acc + r.amount, 0)
🔬 OrderPaymentRow 型別裡【沒有任何 refund 欄位】⇒ 已收那個數**天生碰不到退款**
```
🎯 **⇒ 不是算式錯, 是【那一格從來沒有退款這個輸入】。**

## §2 🔴 而那筆資料【已經在畫面的 props 裡了】—— 不用新查詢

```
🔬 order-detail.tsx:171 逐字
   /** M-3 RW3:`pcm_order_refundable_remaining`(措辭鐵律=「帳本未登記額」)。 */
   refundUnregisteredAmount?: number | null;
🔬 lib/payment/refund-read.ts:144  已經在 .rpc('pcm_order_refundable_remaining', …)
🔬 GRANT 20260801120000:483 / 20260820010000:275 → TO service_role(先 REVOKE ALL 再 GRANT)
🔬 而那條路走 createSupabaseServiceClient() ⇒ **叫得動, 而且【已經在叫了】**
```

**那支函式算什麼(最新代 20260820100000:224-262 逐字讀)**:
```
remaining = orders.total
          − order_refunds(status in processing, confirmed)
          − order_refunds(failed + 事後更正成 money_moved)
          − order_manual_refunds(**AND m.voided_at IS NULL**)
```
🎯 ⇒ **已退 = detail.total.amount − refundUnregisteredAmount**。**純算術恆等式, 零新 SQL。**
✅ X5F8WG 代入:remaining = 10500 − 0 − 0 − 10500 = **0** ⇒ 已退 = 10500 − 0 = **10500**
   ⇒ 淨額 = 10500 − 10500 = **0** ✅ 對上。
✅ 「已作廢的不算」**不用我實作** —— 那句 `AND m.voided_at IS NULL` 已經在函式裡。

## §3 🛑 v1 為什麼作廢:有一道守門專門擋「自己 SUM」

```
🔬 packages/domain/src/order/refund-remaining-single-source.test.ts:1085-1091 逐字:
   「🔴 有新的 TS 位置自己聚合退款金額(reduce / sum / total)…
     DB 側的更正扣減對 app 層自己算的數**完全無效**…
     請改成讀 pcm_order_refundable_remaining, 或在 TS_ALLOWLIST 補一筆並寫清楚 why。」
```
⇒ **v1 那支 readOrderRefundedTotal 會被這道守門紅**, 而它紅得有道理:
   自己 SUM 看不到「更正成 money_moved」那一段 ⇒ **報出的數比實際多 ⇒ 重複退款。**
📌 **⇒ 這一片正確的形狀是【讀已經在手上的那個數】, 不是算第二份。**

## §4 落點 —— **而 §4 原本的「甲/乙」兩案我量完之後【兩案都不對】**

### 量到的(全 repo grep, 30 命中逐條分類過)
```
真呼叫端 4 個(其餘 26 是定義 / 註解 / 測試):
  ① order-focal-row.tsx:182        頭條「總額 / 已收」    ← Sean 看到的就是這一格
  ② payment-list.tsx:191           付款卡「已收 Y」        ← **同一頁, 也叫已收**
  ③ shipment-section.tsx:128       出貨區尾款             ← 🔴 語意是「**還欠多少**」
  ④ shipping/shipment-balance-warning.ts:60  出貨尾款警示 ← 🔴 同上
🔬 而有一道守門盯著這個數:payment-amount-due-single-source.test.ts:114 逐字
   「🔴 `toPaymentSummary` 恰有 4 個呼叫端 —— 多一個就要有人看過這條不變式」
```

### 🛑 所以【改共用函式】是錯的, 不是因為麻煩, 是因為它會改到別的語意
```
改 toPaymentSummary 簽章 ⇒ ③④ 兩個出貨尾款跟著吃淨額
⇒ 而「客人被退了錢」與「客人還欠我們多少」**不是同一件事**
⇒ 那是 Sean 沒有拍的一個連動 ⇒ **超出拍板範圍**(而它會安靜地生效)
```

### ✅ 形狀丙(本 plan 採用)
```
不動 toPaymentSummary(⇒ 不動守門那條不變式、不碰出貨那兩處)
新增一支純函式 receivedNetOfRefunds(received, refundedTotal) —— **一處定義**
在【顯示「已收」的那兩處】各叫一次:① order-focal-row  ② payment-list
🔵 為什麼不只改 ①:兩處在**同一頁**且都寫「已收」⇒ 只改一處 = 製造本 bug 的同一個形狀
```

### ⚠️ 而【要不要含 ②】我沒有問過 Sean
```
他看到的是頭條那一格。而 ② 就在同一頁下面, 也叫「已收」。
🔵 預設做 ②(理由:同頁同名兩個數不一致, 正是本 bug 的形狀)
🛑 而這是**我判的範圍, 不是他拍的** ⇒ 寫在這裡讓下一個人看得到、不藏在 diff 裡。
   ⇒ 我是施工窗 ⇒ 要確認的話走主視窗, 不自己端 Sean。
```

## §5 🔴 三格 fail-closed(每一格都是錢的方向)

```
① refundUnregisteredAmount === null(讀不到)
   ⇒ 🛑 **不得顯示一個數字**。null 在本 repo 的既有語意是 fail-closed
      (order-detail.tsx:167-169 逐字:「null = 讀不到 ⇒ 退款入口 fail-closed」)
   ⇒ 本片照同一個方向:顯示「未知」, **不是顯示未扣的原值**(那會讓人以為錢還在)
② refundUnregisteredFailed === true ⇒ 同上, 走「未知」
③ payment.kind === 'unknown' ⇒ 現行就已經印「未知」, 不動它
④ 🔴 **淨額可以是【負的】** —— 這格是探針量出來的, 不是想出來的:
   種子 PCM-2026-9001 ⇒ 收 1,000 · 有效退 1,500 ⇒ **淨額 = -500**
   ⇒ 畫面要印「已收 -500」嗎? 那對值班是什麼意思?
   🔵 而 DB 是**容許**它的:20260810200000:168 只擋 <= 0 的單筆, 不擋總額超額
      (payment-list-view.ts:157-159 逐字「溢收在業務上是合法的…這裡只負責讓它看得見」)
   ⇒ 📌 **本片不自己發明一個字面** —— 併進 §7-R 那題一起端上去。
⑤ 🔴 **衍生標籤會跟著說謊** ——「已收足」是 `summary.kind === 'settled'` 印的
   (payment-list.tsx:143-147), 而 kind 由**未扣退款的** received 算
   ⇒ 只換顯示的數字 ⇒ 畫面會同時出現「已收 600」與「已收足」
   ⇒ 同理 short 的「還差 X」(:150)也會是舊口徑
   🛑 **⇒ 形狀丙不是「減一個數」那麼小** —— 凡吃 kind 畫出來的字面都在射程內。
```

## §6 🔴 措辭:淨額涵蓋的是【我們記過的退款】

```
🔬 refund-ledger-view.ts:10-14 措辭鐵律逐字:
   「Sean 直接在 TapPay Portal 退的錢完全不在其中 ⇒ 真實剩餘可退額 ≤ 此值」
```
⇒ 同一個道理套到本片, **而方向要自己推一次不要照抄**:
   我算的「已退」**只含帳本記過的** ⇒ 真實已退 **≥** 我算的
   ⇒ 我顯示的淨額 **≥** 真實淨額 ⇒ 🔴 **會讓人以為錢比實際多。**
⇒ 📌 **那句限定寫在算式旁邊**(不是檔頭)—— 理由與那條鐵律同源:
   **一個保守的名字, 防的是「值班照著錯的名字按下去」。**
⚠️ 本片**不改「已收」那兩個字** —— 改標籤文字是另一個決定, 要 Sean 拍。

## §7 🛑 動手前的擋門(**沒過就不動碼**)

主視窗指出乙案的代價有一半不成立:「看不出收過多少」⇒ 那資訊在下面「收款 · 退款」那一頁。
🔴 **而我量到一件會讓那句不成立的**:下面那區 `manual-refund-ledger-section` 列的是
**退款列不是收款列** ⇒ **收過 10,500 到底還在不在畫面上, 我還沒有看過。**
```
✅ 擋門動作:REFUND_UI_ENABLED=1 bash scripts/admin-probe/up.sh
           + psql < scripts/admin-probe/seed-manual-refund-cap.sql(今天兩支都跑通)
           ⇒ 真瀏覽器看「收過多少」在不在下面那一頁
📌 若不在 ⇒ 那才是真的丟失資訊 ⇒ **停下來回報, 不自己改成甲案**(那是推翻拍板)
```

## §7-R 🛑 **擋門跑完了, 而它【沒過】—— 停在這裡, 不自己往下**

**做法**:`REFUND_UI_ENABLED=1 bash scripts/admin-probe/up.sh`(port 3011)
+ `psql -p 55534 -f scripts/admin-probe/seed-manual-refund-cap.sql`(三態全對 -500/600/1000)
+ 真 Chrome 開 `PCM-2026-9002`(total 14300 · 收 1000 · 有效退 400)· 讀 `document.body.innerText`

### ① 「收過多少」**看得到** —— 而那不是好消息
```
行 40  總額 / 已收 14,300 / 1,000        ← 頭條(Sean 看到的那格)
行 54  應收 14,300 元 / 已收 1,000 元     ← 下面「收款 · 退款」那一頁
```
🔴 **兩處【都叫「已收」】, 而且是【同一個數】。**
⇒ 主視窗那句「資訊沒消失, 它在下面那一頁」—— **量到的是:那一頁上的名字也是「已收」。**
```
只改頭條      ⇒ 下面仍看得到 1,000, 而同一頁兩個「已收」數字【不一樣】
              ⇒ 🛑 那正是本 bug 的形狀(兩份真相), 只是換了一組數字
兩處都改      ⇒ 「收過 1,000」**在整頁上消失** ⇒ Sean 那句括號【完全成立】
甲案(多一格)⇒ 他沒選
```
🛑 **⇒ 照 §7 自己寫的:停下來回報, 不自己改成甲案(那是推翻拍板)。**
🔵 而我**沒有**替他決定 —— 我是施工窗, 這題走主視窗。

### ② 🔴 這台探針**驗不了**「已作廢不扣」那條驗收(而它會紅得很像我的碼壞了)
```
🔬 psql 直接問 pg_get_functiondef ⇒ 探針上的 pcm_order_refundable_remaining
   **沒有** `AND m.voided_at IS NULL`(舊代)
🟢 正對照 同一把尺問 pcm_manual_refund_rail_cap ⇒ voided_at 命中 1 ⇒ **尺是活的**
🔬 成因 /tmp/pcm-admin-probe/apply.log:163 逐字
   20260820100000 apply **FAIL** —— 前置閘 P7 找不到 admin_record_manual_refund 的精確簽章
   ⇒ 那個閘是【對的】, 它拒絕在 D1 沒套的情況下往下走
🔬 讀數對得上這個解釋:9003(退 1500 已作廢)remaining = 12800 = 14300 − 1500
   ⇒ **它把已作廢的也扣了**
```
🛑 **⇒ 在這台上跑「已作廢不扣」那格會【必然紅】, 而歸因會歸到我的碼上。**
   ⇒ 那一格**不在這台驗**;要驗它得先讓 D1 那批套進去, 或改用別的鑽機。

### ③ 這台也看不到已登記的退款列
```
行 67 逐字「非卡退款登記載入失敗——這張單可能有看不見的登記紀錄…」
⇒ 同一批 migration 沒套的下游 ⇒ **退款區塊在這台是壞的**
⇒ 📌 所以「已退多少在不在畫面上」這一題, **這台探針答不出來**
```

## §8 驗收

```
① 單元 · 淨額那一層
   · 有效退款要扣 / 已作廢不扣 —— 🔵 **後者不用我測**(在 DB 函式裡)
     ⇒ 我要測的是「拿到 remaining 之後有沒有算對」, 不是重測 DB
   · 🔴 正對照非有不可:零退款的單 ⇒ 淨額 = 原本的已收
     (否則一個「永遠顯示 0」的實作會全綠)
   · null / failed 兩格 ⇒ 印「未知」不印數字
② 突變 · 每發只退一處 · M0 必綠 · 錨命中必須 =1
   · 減號改加號        ⇒ 該紅
   · refundedTotal 寫死 0 ⇒ 該紅
   · null 那格改成印原值 ⇒ 該紅
③ 🔴 真瀏覽器:X5F8WG 那個形狀(收 10500 · 有效退 10500 · 另一筆已作廢)
   ⇒ 期望「總額 / 已收」= 10,500 / **0**   ✅ 種子已存在, 三態今天逐格對過
④ TURBO_FORCE=1 三綠 + 🔴 **鐵則 11 第四個數**:我餵幾條 vs 它跑幾支
⑤ codex 對抗審查(鐵則 12① 錢, **不降級**)
```

## §9 ⚪ 本 plan 證不到什麼

```
· 「payment_status 為什麼變 refunded」—— 🔴 **設計上查不到, 不是我沒找**
  🔬 20260823020000:33-40 逐字:那支 helper 的 COMMENT 寫「**沒有 actor、不寫 audit**」
     而同一段自己標「片3 的任務清單必須含一格:helper 加 audit 寫入」⇒ **那一格還沒做**
  ⇒ 稽核查 X5F8WG = 0 列(🟢 正對照 同尺對別的訂單 = 4 列 ⇒ 尺是活的)
· 那兩筆 reason 都是 'test' ⇒ 🔵 **那是測試單, 不是真客人的錢**(而機制是真的)
· 我沒讀 pcm_sync_order_refund_payment_status 去推「什麼情況會變 refunded」——
  那會是【推論】不是【讀數】
· ⛔ ~~§4 那兩個形狀我還沒數 toPaymentSummary 的消費端 ⇒ 甲乙未定案~~
  ✅ **已量完(4 個呼叫端, 逐條分類)⇒ 甲乙【兩案都不對】⇒ 改採形狀丙**, 見 §4。
  🔴 舊字面留著加刪除線 —— **讓照這句去「補做那件事」的人同一發撞到訂正。**
· 而形狀丙裡「要不要含付款卡那格」是**我判的範圍, 不是 Sean 拍的** ⇒ §4 末段
```
