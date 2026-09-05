# Plan · ⟦b4-BANKCHARGESCARD⟧ 片 2 —— 結帳頁讓客人選「匯款」

> 線 `-f3` · 2026-09-05 深夜 · **盤點階段, 一行碼都沒動**
> 片型:**高風險片**(鐵則 12 ①錢)· 鐵則 8(跨 3+ 檔)⇒ 本檔就是要批准的那份 plan。
> 🔴 動碼要等 **mail 片 1 的 R2 過**;邊界在 §3。

---

## §0 🔴 **先講一件會改變這份 plan 的事:交辦時的前提已經過期了**

主視窗交辦逐字:「`CheckoutView.tsx:105` 預設 `'tappay'` + flag 沒設 ⇒ 顧客站今天送不出 `bank_transfer`」。
🔬 **我開檔量了,那一半已經做掉了**(不是我做的 —— 碼裡的註解指向另一條線 + 2026-09-05 主視窗裁【丙】):

| 交辦說「還沒有」的東西 | 實況 | 位置 |
|---|---|---|
| flag 接線 | ✅ **在** | `app/checkout/page.tsx:107` `bankTransferEnabled={isBankTransferCheckoutEnabled()}` |
| 第二顆 radio | ✅ **在** | `CheckoutStep2.tsx:336-352`(`bankTransferEnabled &&` 包著) |
| 選了之後送得出去 | ✅ **在** | `CheckoutView.tsx:114-116` `effectiveChannel`, 一路送到 `create_order` |
| 「flag 關掉而 state 還留著」那個坑 | ✅ **已擋** | 同上 —— `effectiveChannel` 是**推導**的不是記住的 |
| 稿上「3 個工作天」與系統 5 天不一致 | ✅ **已擋** | `CheckoutStep2.tsx` 用 `PCM_REMITTANCE_EXPIRE_DAYS` 算, 不寫死 |

⇒ 🎯 **片 2 剩下的其實只有兩件**,而它們的性質完全不同:
- **A. 跳過 `getPrime`**(碼)—— 而它**不能單獨落地**,見 §3
- **B. 把 flag 在正式站打開**(不是碼)—— 那是 Sean 在 Vercel 上的一個動作

📌 **這一節寫在最前面, 因為它把「片 2」從一片變成兩件, 而其中一件不是寫碼。**

---

## §1 設計真權威(鐵則 1;附掃過的分母)

```
本樹 design-reference 分母 176 支檔(design-ref-check.sh 正對照 README.md 在)
本次掃的可讀檔        44 支
  「付款方式」 ⇒ 4 支    「ATM」 ⇒ 4 支    「轉帳」 ⇒ 3 支
  「匯款」     ⇒ 0 支    「信用卡」 ⇒ 5 支
```
✅ **真權威在** `design-reference/components/CheckoutPage.jsx:427-435` —— 一組 `co-pay` radio,
第二顆逐字 `ATM 轉帳` + 說明 `下單後 3 個工作天內未繳款,訂單自動取消`。

🔴 **而稿與我們的系統有兩處字面衝突, 兩處都【已經在碼裡處理掉了】——本 plan 不重做, 只記錄**:
1. **3 個工作天 vs 5 天** —— 系統真的做的是 5 天(Sean 2026-09-03 逐字「乙 5天」+ cron `interval '5 days'`)
   ⇒ 碼用常數算。📌 **照抄稿會印一個假的期限給客人。**
2. **「ATM 轉帳」這個標籤** —— 我們做的是**匯到公司固定帳號 + 備註填單號**,不是 ATM 虛擬帳號
   ⇒ 兩者不是同一種東西。**暫用稿的字面, 而它已列入待答**(不是本片新開的題)。

---

## §2 要改什麼(範圍鎖死;主視窗 2026-09-05 深夜定 client 半全歸本片)

| 檔 | 改什麼 | 為什麼(每一條都是【不做會怎樣】) |
|---|---|---|
| `CheckoutView.tsx:264-283` | **選匯款時只跳過 `getPrime` 這一段**,`prime` 送 `null` | 匯款客人本來就不該需要一張卡 |
| `useChargePayment.tsx` | 認得新終態;**匯款單建好而回應逾時 ⇒ 不寫假 in-flight** | 見 §2b ③ |
| `useReconcilePayment.tsx:144-155` | `pendingTransfer` 那格拿到的 `displayId` **不得丟掉** | 見 §2b ③ |
| 對應測試 | 見 §4 | |

🛑 **不改**:`charge-actions.ts`(片 1)· `CheckoutStep2` 的 radio 與文案(**已在**)· flag 本身 · 任何 migration。

## §2b 🔴🔴 五格【只跳過該跳的】—— 每一格都指名不可越過的東西

**① 只跳過 `TapPayPrimeInput` 的 parse, 不越過前面那一串**
`CheckoutView.tsx:256` 逐字 `if (!confirmProceedIfInflight()) return;` —— 那是另開分頁的防呆,
而它的註解自己寫著「**後端 preflight 才是雙扣真防線**」。
⇒ 🛑 **繞過 preflight 會【再建一張單】** ⇒ 📌 我們修的是「他以為沒買成」, 繞過去會變成「他真的買了兩次」。
⇒ ✅ 跳過的邊界:**只有 prime 這一段**;`cart` / `session` / `agreed`(`:149,222,291`)/ cardholder / preflight **一個都不動**。

**② `resumeChargeMessage` 不可以一起跳**
`CheckoutView.tsx:285` `payErrors.resumeChargeMessage();` —— 它是把錯誤訊息從「暫停」解回來的那一下。
⇒ 🛑 連它一起跳 ⇒ **新的錯誤會被 stale 機制蓋掉** ⇒ 📌 客人看到的是**上一次**的訊息,而那與「沒有訊息」一樣糟。

**③ 匯款單建好而回應逾時 ⇒ 【不寫假 in-flight】**
`useChargePayment.tsx:242-255` 那個 `catch` 今天無條件 `setPaymentInflight(cartSessionId)`,
而它的註解逐字是「**可能已扣未定**」—— 🔴 **那句話對匯款單是假的:匯款這條路一毛都沒扣。**
⇒ 寫了假 in-flight ⇒ 客人另開分頁再結帳會吃到一個**不存在的**雙扣軟提醒。
⇒ ✅ 匯款路徑要走自己的分支;而 `useReconcilePayment.tsx:144-155` 的 `pendingTransfer` 那格
**已經拿到 `displayId`**(那一格的註解自己寫著「`displayId` 已經拿在手上, 而畫面那一半還沒做」)
⇒ 🔴 **本片就是那「畫面那一半」的第一步:不得再把它丟掉。**

**④ 終態要在【reload 的世界】活著**
🔴 客人按完之後可能重整、可能關掉分頁 ⇒ **一個只活在 React state 裡的終態等於沒有**。
⇒ ✅ 導到 `/account/orders/${encodeURIComponent(displayId)}` —— **那是既有契約, 不是我發明的**:
`components/account/tabs/OrdersTab.tsx:191` 逐字同一個形狀, 而它的註解寫著
「網址段用 **displayId 不是 UUID**(OD 稿檔頭定的契約)」+「`encodeURIComponent` **不可省**:
displayId 兩種格式並存, 而它是使用者可見的識別碼、不保證只有 URL-safe 字元」。
⚠️ **而那一頁看得到帳號與金額嗎** —— 那是 `⟦b4-PARTIALPAIDNOWHERE⟧`(已上線 `ce1451e62` + view 已貼);
   **驗收要真的連過去看一眼**, 不是假設。

**⑤ 終態判別【不可以】用 `ok: true`**
`useChargePayment.tsx:272` 逐字 `if ('ok' in res && res.ok) { clear(); … setState({ status: 'paid' … }) }`
⇒ 🛑 **它排在 `payment` 那個 switch 之前** ⇒ 匯款終態若帶 `ok: true`,**永遠走不到那個 switch**
⇒ 📌 **客人會看到「付款成功」, 而他一毛錢都還沒付。**
⇒ ✅ 判別式要與 `ok` **不同軸**(片 1 的 plan §3 定的終態 kind), 並補一發突變:**改回 `ok:true` ⇒ 必須紅**。

## §3 🔴🔴 與片 1 的邊界 —— **不是一條線, 是一個【順序】**

**主視窗 2026-09-05 深夜定案**:片 1(mail)**只做 server**(`charge-actions` 分岔 + 新終態契約 + 守門);
**client 半全歸本片**。⇒ 這同時解掉了 mail plan 裡 §1b 與 §2 自己打架的那一格
(§1b 說「本片範圍往前延、跳過 prime」而 §2 說「不改 `CheckoutView`(那是片 2)」,
 而 `getPrime` 就住在 `CheckoutView.tsx:279`)。

🔴 **而順序不可反, 理由寫在碼裡**(`CheckoutView.tsx:264-274` 逐字):
> server 那一側 `charge-actions.ts` 的 prime 閘是**無條件**的, 而且排在任何 channel 分岔**之前**
> ⇒ **前端不取 prime ⇒ 一個正要匯款的客人會吃到一句叫他去刷卡的錯誤訊息。**

```
片 1(mail)先把 server 的 prime 閘挪到 channel 分岔之後 + 定出終態契約
   ↓  （不做這一步, 片 2 落地會讓事情【更糟】而不是更好）
片 2(front)才把前端那段 getPrime 跳掉、接上終態
```
⚠️ **終態的形狀以片 1 的 plan §3 為準** —— 本 plan **不自己定**;它定型之後這裡要跟著改。

## §4 行為契約(逐條可驗)

1. **flag 關著** ⇒ 第二顆 radio 不渲染、`effectiveChannel` 恆 `tappay` ⇒ **今天的行為一個字都不變**。
2. **flag 開 + 選匯款** ⇒ `getPrime` **呼叫 0 次**(不是「失敗也沒關係」, 是**沒有呼叫**)。
3. **flag 開 + 選匯款** ⇒ `confirmProceedIfInflight` / `agreed` / preflight **照樣跑過**(§2b ①)。
4. **flag 開 + 選匯款 + 回應逾時** ⇒ **不寫 in-flight**(§2b ③)。
5. **終態** ⇒ 帶得到 `displayId`、導得到 `/account/orders/<displayId>`, 且**不是** `status: 'paid'`。
6. **flag 開 + 選刷卡** ⇒ 照舊取 prime;取不到 ⇒ 照舊那句卡片錯誤。
7. 🔴 **四發負對照**:跳過拿掉 ⇒ 2 紅;`ok:true` 放回去 ⇒ 5 紅;
   in-flight 改回無條件 ⇒ 4 紅;preflight 一起跳 ⇒ 3 紅。**每一發要殺【不同】的格。**

## §5 預期影響面 / rollback

| 面 | 影響 |
|---|---|
| 結帳頁刷卡路徑 | **零改動**(第 3 條契約就是它的鎖) |
| 結帳頁匯款路徑 | 不再需要一張卡 |
| server | **不碰** —— 那是片 1 |
| flag 關著時 | 全站**行為零改動** ⇒ 📌 **這片可以先進 repo、晚點才開 flag** |
| rollback | 單顆 `git revert`;**無 DB、無 env、無對外副作用** |

---

## §6 這份 plan 沒有回答什麼

- **flag 什麼時候開** —— 那是 Sean 在 Vercel 上的動作, 不是這片。
- **「ATM 轉帳」這個標籤要不要改** —— 已在待答清單裡, 不是本片新開的。
- **片 1 的 R2 會不會再改邊界** —— 會的話這份 §3 要跟著改。
