# 匯款分岔:把 fail-closed 換成「已建單、待匯款」 — plan(重寫版)

> 板列 `⟦b4-BANKCHARGESCARD⟧`(`docs/launch-todo.md`,態 `open`)。鐵則 12①(錢)+ 鐵則 8 ⇒ **批准前不動碼**。
> 🔴🔴 **這是【第二版】。第一版的前提是假的, 而那不是小錯**:我照板列寫了「現行碼沒有任何一行會停下來」,
> 而 codex 關卡 1 第一件事就去開檔,抓到**那道 fail-closed 早就在了**。第一版已刪,訂正在板列(`8fdd0c962`)。
> ⚠️ **本檔所有座標用【字面錨】不用行號** —— 行號會隨別條線漂,而上一輪已經因此讓一個窗對錯帳。

## 0. 🔴 R3(opus)判 FAIL,7 must-fix —— 而最重那條是**兩題的交互**

全文:`~/pcm-mailbox/R3-opus-bankcharges-dbd1c036f-20260905.md`。
🔴🔴 **F1:`Q1 甲(清車)` + `Q2 乙(不換 session)` 【合起來】生出一個新洞** ——
單看每一題都無害:清車防重複結帳、不換 session 保住認親。
🛑 **而合起來 ⇒ 同一顆 `cartSessionId` 跨好幾台車存活**
(`clear()` 只 `setItems([])`,**不碰 `cartSessionId`**)
⇒ 客人建匯款單 O1(車 A)→ 車清空、session 不變 → **三天後買別的東西刷卡**
⇒ 那支 supersede 只比 `customer_user_id` + `cart_session_id`
⇒ 🔴 **它會把【車 A 那張】匯款單一起取消。**
📌 **⇒ 我上一輪學到「一致性是錯的軸」, 而這一輪學到的是【逐題正確不等於合起來正確】** ——
   我把三題**各自**問過,**沒有問過它們的組合**。

### 🔬 R3 留的那一題:那兩支 migration 貼了沒 —— **我去量了,都在**
`bash ~/pcm-mailbox/0905查證/run.sh`(唯讀,只下 `SELECT`;寫入類語句 0):
```
① 20260904050000 的 superseded_by_card 在 begin_charge_attempt 的函式體裡  ⇒ true
② find_active_sibling_own(uuid, uuid) 精確簽章                              ⇒ false
②b 同名任何簽章                                                             ⇒ true
🟢 正對照 begin_charge_attempt 這支函式在                                    ⇒ true
🔵 負對照 現造的函式名                                                       ⇒ false
```
⇒ ✅ **兩支都已生效** ⇒ **F1/F2 的射程是真的,不是假設**;Q2 的理由**建立在已生效的東西上**。
🔵 而 ②/②b 那一組本身是個教訓:**我猜的精確簽章是錯的**,只有退一步問 `proname` 才看得到它。
   📌 **一個精確的問法答 `false`,而那個 `false` 的意思是「不是這個簽章」不是「不存在」。**
⚠️ **我動了共用檔** `~/pcm-mailbox/0905查證/query.sql`(它裝著別人 16 小時前的查詢)——
   備份 → 寫我的 → 跑 → **還原並 `cmp` 驗過相同**。已回報主視窗。

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
· 🆕 setPaymentInflight(cartSessionId)  ← 🔴 R3 F4:我上一版漏了它
```
🔴 **F4 為什麼重要**:相鄰的兩個終態(`redirect` / catch-`unknown`)**都有寫它**,
而我照抄時漏掉 ⇒ 🛑 **客人另開一個分頁會被軟提醒「付款處理中」—— 而他根本沒有扣款在途。**
📌 **一個「照抄相鄰那格」的動作,漏掉的永遠是我沒讀到的那一行。**
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

### 🔴🔴 而 R3 發現:**Q1 甲 + Q2 乙【合起來】生出第三個洞**(F1)

`clear()` 只 `setItems([])`,**不動 `cartSessionId`** ⇒ 兩題合起來 ⇒
**同一顆 session 跨好幾台車存活**:
```
建匯款單 O1(車 A) → 清車、session 不變 → 三天後加購別的東西 → 刷卡
⇒ supersede 只比 customer_user_id + cart_session_id
⇒ 🔴 它把【車 A 的】O1 一起取消了
```
📌 **逐題正確不等於合起來正確** —— 我把三題**各自**問過,**沒有問過它們的組合**。
🛑 而這一格**不是我能自己定的**:它等於改變 Sean 2026-09-04 拍板的**分母**(見 Q2 題面)。

### ⚠️ F8:就算 Q2 選乙,那條認親**還是會斷**
`CartContext` 在**登出 / 換人**時 `setCartSessionId(null)` ⇒ 🛑 **「不換 session」是必要條件, 不是充分條件。**
⇒ 📌 **⇒ 「兩邊都付」那個洞【不會】被本片關掉** —— 本片只是不再親手打開它。這一句要留著。

### 🔴 F3:客人重整一次就什麼都沒有了
終態**零持久化**(只活在 React state)+ Q1 清車 ⇒ 重整 ⇒ 購物車空 ⇒ 早退成「繼續購物」
⇒ 🛑 **而此刻【沒有任何一封信】**(R3 核過:`order_created` 的 payload `paid_at` 必填 ⇒ 未付款的單進不了寄信面)
⇒ 📌 **他手上只剩「會員訂單列表」, 而沒有任何人告訴他去那裡。**
✅ **⇒ 那一頁必須把【訂單編號】印得夠明顯, 並直接連到訂單詳情**;
⚠️ **而「重整就沒了」本片修不掉**(要修得有持久化或寄信)—— **已知缺口, 明寫。**

## 4b. 🔴 兩題要 Sean 拍(F2 / F7)

```
Q2(射程): 客人建了匯款單之後, cartSessionId 要不要換新?
A: 甲|乙
甲 = 換 —— 每台車一個 session。而「改刷卡自動取消原匯款單」那支【找不到】舊單
     ⇒ 他刷了卡, 而那張匯款單還活著等他匯(兩邊都付)
乙 = 不換 —— 認親保住了, 而 🔴 **分母會從「同一台車」變成「上次刷卡以來的所有匯款單」**
     ⇒ 三天後買別的東西刷卡, 會把三天前【別台車】的匯款單一起取消
⚠️ 2026-09-04 你拍「甲 全部一起取消」時, 那句話的分母是【同一台車】。
   乙會悄悄把那個分母換掉 —— 所以這一題要你點頭, 不是工程判斷。
```

```
Q4(第二張): 清車之後, 客人再加購、又選匯款 ⇒ 會建【第二張】匯款單。擋不擋?
A: 甲|乙
甲 = 擋 —— 已經有一張未付款的匯款單時, 不讓他再建一張
乙 = 不擋 —— 讓他建, 兩張都等他匯(而他可能只匯一張)
🔵 工程面:今天的 preflight 對「已有匯款單」回 proceed ⇒ **不擋是現況**。
   擋要改 preflight ⇒ 那是另一片。
```
🔵 **我不推薦哪一個** —— 這兩題都是**他的分母、他的生意**,而 Q2 那題我已經推薦錯過一次。

## 5. 守門

既有那格(`TapPay 入口全部 0 次`)**保留**,而**加釘 exact result**:
`{ ok:false, payment:'awaiting_remittance', displayId: <那張單> }`。
🔴 **理由是這一列自己的病史**:上一次那格守門**綠著**,而它綠的真正理由是 read-back 不符 ——
📌 **一個為了別的事而綠的綠,掩護了一條會扣錯錢的路。**
⇒ ✅ **沿用既有 fixture、只改斷言**(R3 F10:「必須讓 read-back 回 `bank_transfer`」
   **已經是既有事實**,那格 fixture 本來就這樣設 ⇒ 寫成「必須補」會讓人以為要新加東西)。
🛑 **而五發全紅【不等於線上守住】**(R3 F11,兩句要並排寫):
   **flag 關著 ⇒ 生產世界那條路全不可達,五發在生產上恆綠;測試世界 flag 是 mock 的 ⇒ 全可紅。**
   📌 **這兩句分開講會變成一句誇大。**
🧬 **突變(codex R2 ④:上一版兩發不夠)**:
```
① return 改回 formError            ⇒ 分岔那格要紅
② 🔴 ⛔ ~~ok:false 改成 ok:true ⇒ hook 那格要紅~~ —— **那是一發【永遠不會紅】的突變**
   (R3 F5):hook 的測試**把 action 整支 mock 掉** ⇒ 改 `charge-actions.ts` **到不了它**。
   ✅ 改成:在 **`charge-actions.test.ts`** 釘 exact result(`ok` 必須是 `false`),
   而「假的付款成功頁」那條路**另外**在 hook 測試裡用**手餵的 `{ok:true, payment:…}`** 驗。
   📌 **兩件事要在兩個地方驗 —— 而我把它們寫成一發。**
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
③ 確認【無在途】—— 🔴 **要用機械判準,不是「看一下」**(R3 F9:匯款單零 attempt,
   「在途」在這條路上沒有既有訊號)⇒ 用 `20260905060000` 的 `stuck_bank_orders_health`
   或最新一批 storefront 部署時間之後有沒有新的 `bank_transfer` 單
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
   🔴 ⛔ ~~它自己就有價值:把「通用錯誤訊息 + 單已建好」變成不騙人~~ —— **那句是假的**(R3 F6):
      `CheckoutView` 兩處寫死 `tappay` ⇒ **顧客站今天送不出 `bank_transfer`**
      ⇒ 🛑 **那條路上【零個客人實例】** ⇒ 片 1 修的是一個**今天沒有人走得到**的結局。
   ✅ **片 1 = 純地基**(而地基仍然要先做:片 2 開門之前,門後那條路得先不騙人)。
   📌 **「它自己就有價值」是我想讓它聽起來可以獨立交付 —— 而那是我的期望不是事實。**

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
Q: Q1(清車)與 Q3(鎖終態)照 plan 的推薦?
A: 甲|乙
甲 = 照推薦:Q1 清 · Q3 鎖(兩題的理由都是【重複建單】)
乙 = 我要自己看
```
🔴 ⛔ ~~原本這裡把 Q1/Q2/Q3 綁成一題問~~ —— **Q2 已經升成【要 Sean 拍】的題**(§4b),
不能跟工程判斷綁在一起送。
⚠️ **而 Q1/Q3 我仍推薦甲,同時明寫我沒查的那一格**:
我**沒有跨檔查過**「有沒有別人靠 `clear()` 或靠終態鎖找東西」——
📌 **Q2 就是死在這一格,而我對 Q1/Q3 用的是【另一個理由】(重複建單), 不是重新查過。**
🛑 ⇒ **若 R3 之後還要再一輪, 這一格是我自己指出來的第一個該查的地方。**
