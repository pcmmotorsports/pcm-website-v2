# 優惠券:**假如照現在的理解做出來,它長這樣**

> 🔴 **這不是 PRD,也不是規格。** 券是 L3(鐵則 9)⇒ 要 Sean 先答才寫 PRD。
> **而不要問他「你要哪些欄位」** —— 那是要他做我們的工作。
> 本頁給他**一個具體的東西讓他改**。
>
> 🔴 **每一格旁邊都標它從哪來**:
> `[design]` design 已經定了 / `[Medusa]` Medusa 有這個欄位 / `[我們加的]` /
> **`[❓沒人決定過]`** ← **這一類就是要問他的題,它們自己浮出來,我沒有另外編問卷**

---

## 1. 客人那一邊 —— 🔴 **design 已經做好了,連細節都定了**

**畫面**(`design-reference/components/CheckoutPage.jsx:487-494` 逐字):
```jsx
<div className="cart-coupon co-coupon">
  <div className="cart-coupon-row">
    <input placeholder="輸入優惠碼(試試 PCM100)" value={couponCode} … />
    <button onClick={applyCoupon}>套用</button>
  </div>
  {couponApplied && <div className="cart-coupon-ok">已套用 {couponApplied} · 折抵 NT$ 500</div>}
</div>
```
⇒ **一個輸入格 + 一顆「套用」+ 套用後一行綠字。就這樣。**

### 1-1 而 design 連這三件都替我們決定了(**不要重新想**)
```
① 大小寫與空白 [design]
   :114 逐字  couponCode.trim().toUpperCase() === 'PCM100'
   ⇒ **前後空白吃掉、大小寫不分**。我上一份調研列的那個坑,design 已經處理了。

② 🔴 折抵順序 [design] —— 這一格是【錢】,不是 UI
   :94-98 逐字:
     const couponDiscount = couponApplied === 'PCM100' ? 500 : 0;
     const beforeWallet   = Math.max(0, subtotal + shipping - couponDiscount);
     const total          = Math.max(0, beforeWallet - effectiveWallet);
   ⇒ **券先折,儲值金後折。** 而且兩層都有 Math.max(0, …) 地板。
   ⇒ 🔴 那決定了「券折完之後儲值金能扣多少」——**順序反過來金額會不同。**

③ 後端端點名 [design]
   design-handoff/HANDOFF-v2.0.md:440 逐字:後端 `/api/coupons/validate`
```

---

## 2. 後台那一頁 —— **員工要開一張券,畫面上有這幾格**

> 🔴 **不畫 HTML**(鐵則 1)。下面是**欄位清單 + 每格填什麼的例子**。
> 後台的視覺真權威是 `docs/design/admin-design-system.md`(BMW M),**不是 design-reference**
> —— 因為 design-reference **整個只有顧客站**(20 個元件沒有一個是後台)。

```
【基本】
  優惠碼            [design] 例:PCM100          ← design 的範例碼就長這樣
                    ❓ 要不要讓系統自動產?還是員工自己打?     [❓沒人決定過]

  說明(給自己看)   [Medusa] 例:雙十一活動      ← Woo/Medusa 都有

【折多少】
  折扣方式          [design 定了一半]
                      ○ 折 NT$ ___ 元          ← 🔴 design 只做了這一種(hard-coded 折 500)
                      ○ 打 ___ 折              ← [Medusa] ApplicationMethod.type='percentage'
                    ❓ 第一版要不要就做兩種?              [❓沒人決定過]

【什麼時候能用】
  開始日期 / 結束日期  [Medusa 那頁沒寫、Woo 有 Coupon expiry date]
                    ❓ 只要結束日,還是也要開始日?         [❓沒人決定過]

【能用幾次】—— 🔴 Sean 講了兩次,而它是【兩個】欄位
  總共可用 ___ 次    [Woo: Usage limit per coupon / Medusa: Promotion.limit]
  每人可用 ___ 次    [Woo: Usage limit per user]
                    🔴 Medusa 那頁**沒有**這個 ⇒ 若照 Medusa 抄會漏掉它

【門檻】
  最低消費 NT$ ___   [Medusa: item_subtotal + gte / Woo: Minimum spend]
                    ❓ 第一版要不要?                      [❓沒人決定過]

【開關】
  啟用 / 停用        [我們加的]
                    🔴 理由見下面 §4 —— **不能用「刪除」代替**
```

---

## 3. 🔴 兩個他一定會撞到、而上面還沒有的(各一句白話)

### 3-1 **券能不能跟會員等級價一起用?**(這是**錢**,不是介面)
```
我們有三級會員價(一般 / 經銷 / 高級經銷)。
問題:一個經銷商本來就用比較便宜的價,他再輸入一張九折券 —— 要不要讓他折?
· 讓他折 ⇒ 折上加折,毛利要自己算
· 不讓他折 ⇒ 那張券對經銷商就是【看得到用不到】,客服會被問
🔴 而別人的做法對不上我們:
  Woo 有 "Exclude sale items"(排除特價品)—— 而我們的會員價是**身分價不是特價**
  ⇒ **那個開關套不上來,要自己想。**
```
**[❓沒人決定過]**

### 3-2 **用過的券,能不能刪掉?**
```
🔴 不能。刪了之後,那些用過券的舊訂單,金額會對不起來。
理由(不是我想的,是這個 repo 自己的不變式):
  packages/domain/src/order/errors.ts:20 逐字
    「total_mismatch:total ≠ subtotal + shippingFee − discountTotal」
⇒ 訂單記著「折了多少」,而如果券沒了,那筆折抵就變成一個沒有來源的數字。
⇒ 所以後台要有【停用】,而**不是【刪除】**。
```
⚠️ **而「刪掉會不會真的讓那條不變式紅」我沒有實測** —— 上面是讀不變式推的,標未確認。

---

## 4. 分兩檔,而判準用那句白話

> 🔴 Sean 08-18 常設令「不准做一半」**不表示要做完整版**,
> 表示 **【選定的那一版要自己完整】**。
> ⇒ 具體化成一句可以當場答的:
> ## **「這一版交出去,員工能不能自己跑完一張券的一生?」**
> (開券 → 客人用掉 → 用完了擋住 → 過期了失效 → 需要時停用)

### 甲 · 最小可用版
```
折扣方式:只做「折 NT$ ___ 元」(design 現有的那一種)
期間:    只做結束日
次數:    只做「總共可用 ___ 次」
開關:    啟用 / 停用
⇒ 員工能跑完一張券的一生嗎?**能。**
⇒ 而它【不能】做的:打折、每人限用、最低消費、跟會員價的關係
```

### 乙 · 完整版
```
甲 + 打 N 折 + 每人可用次數 + 最低消費 + 會員價疊加規則
⇒ 每一項都是「一個欄位 + 一段驗證 + 後台一個欄位」,可以逐項加
```

🔴 **而【無論選哪一版】,下面這兩件都要在同一版裡做完**,否則就是做一半:
```
① 停用(不是刪除)—— 否則舊訂單對不起來
② 用完 / 過期 要真的擋得住 —— 否則「次數」那格只是裝飾
```

---

## 5. 這一頁沒有回答的(留給下一輪)
```
· 同一張單能不能用兩張券                          [❓沒人決定過]
· 免運券算不算一種(Woo 把免運做成獨立勾選)        [❓沒人決定過]
· 🔴 併發:限量券兩個人同時結帳誰拿到 —— 那是 DB 層的事
  這個 repo 有前例(attempts 線的 SKIP LOCKED 原子 claim),**而我沒查能不能直接套**
· 🔴 猜碼:短碼 + 無限次嘗試 = 掃得出所有券 ⇒ 要速率限制
  (repo 有 lib/cron/rate-limit.ts 的形狀可參考,**而我沒查它套不套得上結帳路徑**)
· 券要不要能綁特定商品 / 分類(Woo 有,而那會讓資料模型大一圈)
```

---

## 6. 🔴 而在動任何東西之前,有一件要先給 Sean 看
```
優惠券與【儲值金】是同一批被凍結的:
  apps/storefront/src/styles/cart.css:8 逐字
    「優惠券 .cart-coupon / -row / -ok 不搬(plan v6 §3.2「優惠券」不做、**#202 wallet HOLD**)」
而儲值金他 2026-08-18 才剛說「**現在不開**」。
⇒ **他可能沒意識到自己正在拆開那一批。**
⇒ 而那完全可以(兩件本來就是兩件事),**只是要讓他知道他在拆**。
⚠️ 技術上拆不拆得開(CSS 那兩塊的耦合)——**我們還沒查**。
```
📌 而當初排除的理由已經查到,**不是硬擋**:
`docs/specs/2026-06-04-m3-checkout-plan.md:78` 逐字「**原排除僅 Phase-1 省事非硬擋**」。
