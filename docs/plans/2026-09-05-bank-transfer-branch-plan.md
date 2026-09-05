# 匯款分岔:把 fail-closed 換成「已建單、待匯款」 — plan(重寫版)

> 板列 `⟦b4-BANKCHARGESCARD⟧`(`docs/launch-todo.md`,態 `open`)。鐵則 12①(錢)+ 鐵則 8 ⇒ **批准前不動碼**。
> 🔴🔴 **這是【第二版】。第一版的前提是假的, 而那不是小錯**:我照板列寫了「現行碼沒有任何一行會停下來」,
> 而 codex 關卡 1 第一件事就去開檔,抓到**那道 fail-closed 早就在了**。第一版已刪,訂正在板列(`8fdd0c962`)。
> ⚠️ **本檔所有座標用【字面錨】不用行號** —— 行號會隨別條線漂,而上一輪已經因此讓一個窗對錯帳。

## 1. 今天實際是什麼樣子(當場開檔,不是讀板列)

```
charge-actions.ts
  flag 閘                      bank_transfer && !isBankTransferCheckoutEnabled() ⇒ 擋
  placeOrder                   建單(寫入 order / items / legal consent)
  findPaymentChannel read-back 存的與送的不符 ⇒ formError
  ⑤c fail-closed               storedChannel === 'bank_transfer'
                               ⇒ safeLog + return { formError: MSG.generic }   ← 🔴 停在這裡
  initiatePayment / confirmPayment                                             ← 匯款到不了
```
字面錨:`fail-closed:一張匯款單, 絕不往下走進扣款` · 守門 `送出與回讀【皆為 bank_transfer】⇒ 建了單, 而 TapPay 入口全部 0 次`

✅ **所以「翻 flag 就會扣卡」不是今天的病。**
🔴 **今天的病是它的【結局】**:`formError: MSG.generic` = 一句**通用錯誤訊息**,
而客人的**單已經建好了** ⇒ 🛑 **他會以為沒買成,而他可能再下一次。**
🔵 codex 掃過全 repo:`confirmPayment` / `initiatePayment` 的 production caller **只有這一支** ⇒ 沒有第二條扣款路。

## 2. 改什麼

把那道 fail-closed 的 **`return`** 換掉(**位置不動** —— 它已經在對的地方):
```ts
return { ok: false, payment: 'awaiting_remittance', displayId: placed.displayId };
```

🔴🔴 **為什麼是 `ok: false` + `payment`,而不是新的 `ok: true` 變體**(codex 關卡 1 ③,我核過):
`useChargePayment` 的判斷順序是 **`if ('ok' in res && res.ok)` 在 `payment` switch 【之前】**
⇒ 🛑 一個 `{ok:true, payment:'…'}` 會**先命中 `ok` 那一支** ⇒ `clear()` 清車、`regenerateCartSession()`、
`setState({status:'paid'})` ⇒ 📌 **typecheck 不會紅,客人會看到一個假的付款成功頁。**
✅ 而走 `payment` switch 這條路**有機械保護**:那個 switch 的 `default` 裡有 **`res satisfies never`**
⇒ **多一個 `payment` 值而沒有 case ⇒ 當場 typecheck 紅。**
🔵 **而那道窮舉是【為了這一片】先加的** —— 它的註解逐字寫著
「我發現它是因為我正要加一個(匯款那條路的 `awaiting_remittance`)」
⇒ 📌 **名字都取好了,本 plan 沿用 `awaiting_remittance`,不另發明。**

## 3. 影響面

| 檔 | 改什麼 |
|---|---|
| `charge-actions.ts` | union 加 `{ ok:false; payment:'awaiting_remittance'; displayId }`;fail-closed 的 return 換掉 |
| `useChargePayment.tsx` | switch 加 case + `ChargeState` 加一個 status |
| `CheckoutTerminalScreen.tsx` | 🆕 **它另有【兩道】窮舉**(codex R2 ④,我核過):`FULL_PAGE_BY_STATUS` 是 `Record<ChargeState['status'], boolean>`(漏列即紅)、結尾 `const exhaustive: never = state`。新 status 不補這裡 ⇒ **tsc 紅** |
| 那一頁的畫面本身 | 🆕 「訂單已成立、請依匯款資訊付款」+ 連到訂單詳情 |

### 🔴 新 case 的【行為契約】(codex R2 ①:我上一版只寫了型別, 沒寫行為)
```
專用 state(不是沿用 paid / processing)· hook 回 true(終態)· 不釋放 inFlightRef
· clear() 要(Q1 甲)· regenerateCartSession() 🔴 不要(Q2 乙, 見上)
```
🛑 **回 `false` 或釋放鎖 ⇒ 他可以再按一次「確認訂購」⇒ 再建一張匯款單** ——
📌 **而兩張都會等他匯款。這一格是三個產品決定裡唯一會傷到人的那一格。**
| `CheckoutView.tsx` | 新狀態導到哪 |
| `charge-actions.test.ts` | 既有守門那格改釘 **exact result**;加突變 |

🛑 **不動**:flag 閘、`placeOrder`、read-back、fail-closed 的**位置**。

## 4. 🔴 三個產品決定(codex 關卡 1 ⑥ 逼出來的,各給甲/乙)

**它們決定的是【會不會重複建單】,不是體驗。**

```
Q1: 建了匯款單之後, 購物車要不要清空?
A: 甲|乙
甲 = 清空(與 paid 同款)—— 單已經成立, 留著車他會再結一次
乙 = 保留 —— 他還沒付錢, 也許還想改
🔵 推薦甲:單已經建了, 而「留著車」正是重複建單的入口。

Q2: cartSessionId 要不要換新?
A: 甲|乙
甲 = 換(與 paid 同款)
乙 = 🔴 不換
🔴🔴 推薦【乙】—— 而我上一版推薦甲, 那個建議會製造「客人兩邊都付」。
```
🔬 **codex 關卡 1 R2 抓到, 我開檔核過**:「改刷卡 ⇒ 自動取消原匯款單」那支
(`20260904050000_m4b_supersede_bank_order_on_card.sql`)**靠 `cart_session_id` 找那張單**:
```sql
WHERE o.customer_user_id = v_order.customer_user_id
  AND o.cart_session_id  = v_order.cart_session_id   ← 就是這一條
  AND o.payment_channel  = 'bank_transfer'
```
⇒ 🛑 **換掉 session ⇒ 他之後改刷卡, 新單的 session 不同 ⇒ 那支找不到舊匯款單
⇒ 舊單不會被取消 ⇒ 他刷了卡, 而那張匯款單還活著等他匯。**
📌 **那正是 `⟦b4-BANKORDERINVISIBLE⟧` 在講的「兩邊都付」—— 我的建議會製造它。**
🎯 **我錯在哪(這一句要留著)**:我拿「與 paid 一致」當理由 —— **一致性是錯的軸。**
   對的軸是:**下游有誰靠這個值找東西?** 而那個下游**在另一支 migration 裡,
   不在我開的那幾支檔中**。⇒ **一個看起來最無害的「保持一致」, 砍斷了另一片的認親依據。**
⚠️ **⇒ 而 Q1(清車)與 Q3(鎖終態)仍推薦甲** —— 它們不影響認親;
   只有 `cart_session_id` 是別人拿去找單的鍵。

```
Q3: 頁面要不要鎖成終態(不能再按「確認訂購」)?
A: 甲|乙
甲 = 鎖(與 paid / processing 同款)
乙 = 不鎖, 讓他可以改
🔵 推薦甲:不鎖 ⇒ 他再按一次 ⇒ 再建一張匯款單, 而兩張都會等他匯款。
```
🛑 ⛔ ~~三題我都推薦「與 paid 同款」~~ —— **Q2 已翻面(見上)**。
✅ 現在是 **Q1 甲 · Q2 乙 · Q3 甲**,而三題共同的理由是**【重複建單】與【認親】**,
**不是一致性** —— 📌 **而「一致性」正是上一版讓我推薦錯的那個理由。**

## 5. 守門

既有那格(`TapPay 入口全部 0 次`)**保留**,而**加釘 exact result**:
`{ ok:false, payment:'awaiting_remittance', displayId: <那張單> }`。
🔴 **理由是這一列自己的病史**:上一次那格守門**綠著**,而它綠的真正理由是 read-back 不符 ——
📌 **一個為了別的事而綠的綠,掩護了一條會扣錯錢的路。**
⇒ ✅ fixture **必須讓 read-back 回 `bank_transfer`**,否則它會在**還沒走到分岔**的地方就綠。
🧬 **突變(codex R2 ④:上一版兩發不夠)**:
```
① return 改回 formError            ⇒ 分岔那格要紅
② ok:false 改成 ok:true            ⇒ hook 那格要紅(假的付款成功頁那條路)
③ 新 case 回 false / 釋放 inFlightRef ⇒ 要有一格紅(重複建單那條路)
④ 拿掉 clear()                      ⇒ 要有一格紅
⑤ 加上 regenerateCartSession()      ⇒ 🔴 **要有一格紅** —— 這一發守的是「認親不能斷」
```
🛑 **⑤ 是這幾發裡最重要的一發, 而它守的東西【不在本片的碼裡】** ——
它守的是另一支 migration 靠 `cart_session_id` 找單的能力。
📌 **一個跨片的依賴, 只有跨片的突變守得住。**

## 6. Rollback

🔴 **順序寫死(codex R2 ⑤:我上一版寫「revert 即可」, 照做會回到「建單後報錯、誘發重下」)**:
```
① 先關 BANK_TRANSFER_CHECKOUT_ENABLED
② redeploy(⚠️ 刪 env 不會讓功能停下來 —— 本 repo 記過這一條)
③ 確認【無在途】:沒有正在結帳的匯款單
④ 才 git revert
⑤ 盤點【已經建出來的】匯款單 —— revert 清不掉它們
```
🔵 那些單**不會變成孤兒**(codex 核過):顧客明細仍看得到匯款資訊、後台可登記收款、另有逾期路徑。
⚠️ 而 revert 之後回到今天的 fail-closed(**安全,只是話講錯**)。
🔴 ⛔ ~~沒有資料改動~~ —— **不成立**(codex 關卡 1 ⑤):走過這條路會**永久留下** order / items / legal consent,
`revert` **清不掉已經建出來的匯款單**。⇒ 那句要寫進 commit body。
⚠️ 而**退它的人要同時確認 `BANK_TRANSFER_CHECKOUT_ENABLED` 沒有被翻開** ——
📌 **一個「安全的回退」在另一個 flag 狀態下不安全。**

## 7. 🔴 範圍重估 —— **它已經不是一片**(codex R2 ⑥ 之後我重數的)

codex 抓到我上一版漏了兩件,而它們把範圍撐大:
· `CheckoutTerminalScreen.tsx` **另有兩道窮舉**(`FULL_PAGE_BY_STATUS` 是
  `Record<ChargeState['status'], boolean>`、結尾 `const exhaustive: never = state`)⇒ 新 status 要補**兩處**。
· `CheckoutView.tsx` **兩處寫死** `paymentChannel: 'tappay' as const`,
  而且匯款那條路**今天照樣先驗卡、取 prime** ⇒ 🛑 **「甲做完就可用」不成立。**

**當場數的落點**:`charge-actions.ts` · `useChargePayment.tsx` · `CheckoutTerminalScreen.tsx` ·
一支新畫面元件 · `CheckoutView.tsx` · 三支測試 ⇒ **7-8 個落點 + 一支新元件**。
⇒ 📌 **鐵則 4(15-45 分鐘、可肉眼驗)⇒ 這超了, 要拆。**

### 拆法(兩片,各自【自己就是完整的】)

```
片 1「不騙他」= 分岔 + 三道窮舉 + 那一頁 + 守門
   行為:匯款單建完 ⇒ 回 awaiting_remittance ⇒ 專用終態畫面(連到訂單詳情看匯款資訊)
   ✅ 它自己就有價值:今天那條路的結局是「通用錯誤訊息 + 單已經建好」, 片 1 把它變成不騙人
   🔵 而 flag 仍然關著 ⇒ 對線上零影響

片 2「入口」= CheckoutView 真的送得出 bank_transfer(拿掉兩處寫死)+ 匯款不再取 prime
   🛑 它【必須】在片 1 之後 —— 反過來 = 先開門, 而門後那條路還在講錯話
```
🔴 **而 flag 不是這兩片任何一片翻的** —— 那是 `⟦b4-BANKORDERINVISIBLE⟧` 那一列的事,
**它要等兩片都完成 + 那一列自己的條件。**

## 8. 一字題

```
Q: 匯款分岔照上面拆成兩片, 先做片 1?
A: 甲|乙
甲 = 是, 先做片 1(分岔 + 那一頁 + 守門), 片 2 另派
乙 = 不拆, 一片做完
```
🔵 **推薦甲** —— 乙是 7-8 個落點 + 一支新元件,**過鐵則 4 的線**,而且片 2 那半
(`CheckoutView` 拿掉寫死 `tappay`)**碰的是所有客人都會走的結帳主路**,
⇒ 📌 **把它跟片 1 綁在一起, 等於讓一個「只有匯款客人走得到」的改動, 去動所有人走的那條路。**

```
Q: 三個產品決定(Q1 清車 / Q2 換 session / Q3 鎖終態)照 plan 的推薦?
A: 甲|乙
甲 = 照推薦:Q1 清 · Q2 【不換】 · Q3 鎖
乙 = 我要逐題自己看
```
🔴 **Q2 那題請務必看一眼** —— 它是唯一一個「直覺答案是錯的」的:
直覺會說「跟 paid 一樣換掉」,而**換掉會讓客人兩邊都付**(理由在 §4)。
