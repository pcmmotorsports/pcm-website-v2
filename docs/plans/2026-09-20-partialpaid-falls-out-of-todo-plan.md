# plan · 部分收款之後那張單掉出「待收款」—— 三個選項與代價

> 開立:2026-09-20 · 窗 shop-6(後台線)· 來源 = 主視窗 2026-09-20 走查正式站(真訂單 `BZVTGM`)
> 🛑 **本檔只提案,零落筆。** 碰錢 + 碰「今天要做的事」那張卡片的定義 ⇒ 鐵則 8,要 Sean 批。

## 1. 病 —— 一句話

**客人只匯一半就不匯了,那張單【不在任何人的待辦卡片上】。**

主視窗實測(正式站,真訂單):收 5,000(還差 8,800)之後
- 首頁「今天要做的事 → 待收款(匯款)」從 **2 變 1**
- 訂單頁「待收款」chip 撈不到它
- 🟢 而另一顆 chip「尾款未收」找得到它 ⇒ **資料沒有不見,是【沒有人會去按那顆】**

## 2. 成因(碼上的座標,逐格查過)

```
🔬 apps/admin/src/lib/dashboard/today-todo-read.ts:36-39
     unpaidBankTransfer: filter { paymentStatus: 'unpaid', paymentChannels:['bank_transfer'], pendingOnly:true }
🔬 apps/admin/src/lib/orders/order-toolbar-view.ts:42
     { key:'unpaid', label:'待收款', filter:{ paymentStatus:'unpaid', pendingOnly:true } }
🔬 apps/admin/src/lib/orders/order-toolbar-view.ts:102
     { key:'partial', label:'尾款未收', filter:{ paymentStatus:'partiallyPaid' } }
🔬 packages/domain/src/order/types.ts:330
     paymentStatus?: PaymentStatus;   ← **單一值**, adapter 用 .eq 疊
```
⇒ 🎯 **「待收款」的判準是一個【狀態字】,而員工心裡想的是【這張單還差錢】。**
⇒ 📌 收了一塊錢,那個狀態字就從 `unpaid` 變成 `partiallyPaid` ⇒ **它就離開了那張卡片。**

## 3. 今天的曝險 —— 0 張,而那個 0 是【會動的】

```
🔬 2026-09-20 02:1x 唯讀實查(主視窗走查【前】):orders 12 張 · partiallyPaid 0 張
🔬 主視窗走查【中】:BZVTGM 收了頭款 ⇒ partiallyPaid 1 張(主視窗實查)
🔬 2026-09-20 02:5x 唯讀實查(走查【後】):orders 14 張 · unpaid 8 · refunded 4 · paid 2
   · **partiallyPaid 0 張**(它收完尾款變成 paid 了)
   ⚪ 負對照:payment_status = 'pcm_zzq_not_real' ⇒ 0
```
🔴 **所以這條路【一天之內從 0 變 1 再變 0】。**
⇒ 📌 **它一直沒被發現的原因很清楚:在今天之前,`partiallyPaid` 從來沒有出現過。**
🛑 **而「今天 0 張」不是安全** —— 那個狀態的停留時間 = **客人多久沒把尾款匯來**,而那可以是永遠。

## 4. 三個選項

### 甲 —— 「待收款」含 `partiallyPaid`
- 做什麼:`AdminOrderFilter.paymentStatus` 從**單值**改成**可多值**(或加一個 `paymentStatuses`),
  首頁那格與 chip 的 filter 都帶 `['unpaid','partiallyPaid']`。
- 🟢 好:員工不用學新東西,**一格就把「還差錢」全包了**。
- 🔴 代價:
  - 動到 `packages/domain` 的**共用型**與 adapter 的疊條件 ⇒ **鐵則 8 的正中央**。
  - 首頁那個數字**會變大**,而 Sean 每天看它 ⇒ **他看得到的東西變了**。
  - 「待收款」與「尾款未收」兩顆 chip 會**部分重疊**,而 `order-toolbar-view.ts:69` 逐字寫著
    兩者「互斥」是刻意的 ⇒ **要一起重想,不能只改一邊。**

### 乙 —— 首頁多一格「尾款未收 N」
- 做什麼:`TODO_LIST_SPECS` 加第四格,filter `{ paymentStatus:'partiallyPaid', pendingOnly:true }`。
- 🟢 好:**零共用件改動**,只加一格;兩顆 chip 的互斥語意不動。
- 🔴 代價:
  - 「還差錢」這件事**分成兩個數字**,員工要自己加起來。
  - 📌 **那正是本病的形狀**:一件事被切成兩格,而**沒有人負責看第二格**。乙**縮小**了它,沒有**關掉**它。

### 丙(本窗補的)—— 把判準從【狀態字】換成【還差錢】
- 做什麼:卡片與 chip 的判準改成 **`應收 − 已收 > 0`**(而不是 `payment_status = 某個字`)。
- 🟢 好:
  - **一次解掉整族** —— 今天是 `partiallyPaid`,明天任何新增的付款狀態都不會再掉出來。
  - 員工心裡想的就是這個,**判準與人話對齊**。
- 🔴 代價:
  - 要有一個**權威的「還差多少」**。🔵 好消息:**畫面上已經有了** ——
    收款欄今天就印「還差 8,800 / 已收足」(Sean 09-13 拍的獨立收款欄),
    ⇒ 📌 **那個數字已經被算出來了,問題只是【卡片沒有用它】。**
  - 🛑 而它在哪一層算、能不能下推到 SQL 篩選,**我沒有查**(見下面「我沒查的」)。
  - 這是三個裡面**改動面最大**的。

## 5. 我的推薦

**丙,而且先做一件唯讀的事再決定**:把「還差多少」那個數字**目前在哪一層算出來**查清楚。
- 若它**已經在 DB / view 算得出來** ⇒ 丙 的成本會掉到接近乙,**直接做丙**。
- 若它**只在 TS 層、逐單算** ⇒ 丙 要下推成篩選條件,成本高 ⇒ **退回甲**(而甲要連兩顆 chip 的關係一起重想)。

🛑 **而不論哪一個,這一題都要 Sean 拍** —— 因為首頁那個數字是**他每天在看的**,任何一案都會改變它。

## 6. 我沒查的(照實寫,不要讀成已排除)

1. 「還差 8,800」那個數字**在哪一層算**(TS / view / RPC)—— **沒查**。丙的成本完全取決於它。
2. `pendingOnly` 那條「排除已取消 / 已退款」**對 `partiallyPaid` 的行為** —— 沒驗。
3. 首頁那格的數字**與列表頁撈回來的筆數是同一發查詢還是兩發** —— 沒查;若是兩發,改一邊會讓數字與清單對不上。
4. 本檔**零落筆**:沒有動任何碼,沒有跑任何寫入。

## 7. Rollback

三案都只動**篩選條件**,不動資料:改回原本的 filter 字面即可,**零資料遷移**。
🔴 例外是甲:`AdminOrderFilter.paymentStatus` 若改成多值,**那是共用型**,回退要連 adapter 與所有呼叫端一起回。
