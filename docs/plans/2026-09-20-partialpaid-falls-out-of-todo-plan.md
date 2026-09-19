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

---
# 追查結果(2026-09-20 · 窗 shop-6 · 唯讀)—— **§5 的推薦翻面:改推薦甲**

## 查到什麼

**「還差多少」是 DB 算的,不是 TS 逐單算** —— 這一格是好消息:
```
🔬 order_balance_base_v.balance_due(migration 20260906150000_m4b_order_balance_base_v.sql)
   那支 view 的 COMMENT 逐字:「**應付餘額那條【錢的規則】的唯一一份**」
   +「🛑 要改應付餘額的算法, 改這裡, 不要在別處再寫一份」
🔬 正式庫實查:SELECT … FROM order_balance_base_v ⇒ **permission denied for view**
   ⇒ 🎯 **那是「存在而我讀不到」, 不是「不存在」。**
   ⚠️ 而 information_schema 對它與對一支已知存在的 view **都回 0 列**
      ⇒ 📌 那張表**依權限過濾**, 它的 0 什麼都不代表(memory reference_view-truth-is-in-the-live-db-not-the-migration)。
      🟢 我的對照組就是為了抓這件事而擺的, 它抓到了。
```

## 🔴 而【壞消息在接線那一層】,它把丙的成本拉回去

```
🔬 packages/adapters/src/supabase/SupabaseOrderAdapter.ts:1484 逐字:
   「收款欄的第二發:order_balance_base_v」
🔬 同檔 :1494 逐字寫了為什麼是第二發:
   「**order_balance_base_v 與 admin_order_list_v 之間沒有 PostgREST 認得的關聯 ⇒ embed 不進去**」
```
⇒ 🎯 **餘額是在【分頁與篩選都做完之後】才第二發撈回來的。**
⇒ 📌 **所以「還差錢」今天【篩不動】** —— 要拿它當篩選條件,就得讓它進第一發:
  · 把 `balance_due` 加進 `admin_order_list_v`,或
  · 造一個 PostgREST 認得的關聯
  ⇒ **兩條都是改 view = migration = 鐵則 8。**
🔵 而 `order-list-view.ts:1104` 早就把這一格寫下來了:「那要改 view = migration = 鐵則 8 要 Sean 批」。
   **我查到的不是新洞,是那一行註解講的正是這件事。**

## ⇒ 結論:**推薦甲**,而丙仍然是對的終點

| | 要動 migration | 要動共用型 | 解掉本病 | 解掉整族 |
|---|---|---|---|---|
| 甲 | ❌ 不用 | ✅ `AdminOrderFilter.paymentStatus` 單值 → 多值 | ✅ | ❌ |
| 乙 | ❌ 不用 | ❌ | 🟡 縮小 | ❌ |
| 丙 | ✅ **要**(`admin_order_list_v`) | ✅ | ✅ | ✅ |

**選甲的理由(三條,缺一我就會選丙)**:
1. **丙今天要動 `admin_order_list_v`** —— 那是訂單列表的核心 view,**整個後台最常走的那一條**。
   把「修一張卡片」與「改核心 view」綁成同一片,**兩個風險一起上**。
2. **甲不是繞路** —— 篩選層改多值之後,丙那一天把 `balance_due` 接進第一發時,
   **上層照樣是那顆 chip**,甲的改動不用回退。
3. **甲今天就讓員工看得到那張單**,而那正是本病的全部。

🛑 **而選甲要連兩顆 chip 的關係一起拍** —— `order-toolbar-view.ts:69` 逐字寫著
「按『尾款未收』會讓『待收款』熄掉,那是對的(兩者互斥)」⇒ **甲會讓它們部分重疊,那句話要跟著改。**

## 我這一輪【仍然】沒查的
1. `balance_due` 的實際分佈 —— **唯讀角色讀不到那支 view**,沒查成(不是查無)。
2. `pendingOnly` 那條「排除已取消 / 已退款」對 `partiallyPaid` 的行為 —— 仍未驗。
3. 首頁那格與列表頁是不是同一發查詢 —— 仍未查。
