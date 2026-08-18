# 調研 — 優惠券代碼(coupon code)

> **這是調研,不是 plan。** Sean 2026-08-19 睡前提的新需求,而他自己說「**應該可以參考很多購物車系統**」
> ⇒ 他要的是**先看別人怎麼做**。照 `docs/reviews/2026-08-19-product-admin-template-research.md` 的形狀寫。
> **零 code、零 schema、零規格。**

---

## 0. 🔴🔴 最重要的一格:**design 早就有優惠券,而它是【被刻意不搬的】**

Sean 的逐字是「**這個我們目前沒有,我今天想到的**」。
⇒ 🔴 **前半對(code 裡沒有),後半要更正 —— design 裡有,而且合約寫好了。**

```
design-reference/design-handoff/HANDOFF-v2.0.md:440 逐字(那張「mock vs 真接」對照表):
  | 優惠券 `PCM100` | hard-coded 折 NT$500 | 後端 `/api/coupons/validate` |

同檔 :92-93,結帳 state 的形狀:
  "couponCode": null,
  "couponApplied": null
```
⇒ **design 已經定了三件事**:①結帳頁有輸入格 ②範例碼 `PCM100` ③**後端端點名 `/api/coupons/validate`**

**而它是刻意沒搬的,不是漏掉的**(我們自己的 CSS 檔寫著理由):
```
apps/storefront/src/styles/cart.css:8-9 逐字:
  「優惠券 .cart-coupon / -row / -ok 不搬(plan v6 §3.2「優惠券」不做、#202 wallet HOLD);
   對應 .cart-row-discount 折扣列亦不搬(無 coupon = 無折扣)。」
apps/storefront/src/styles/checkout.css:21 逐字:
  「不搬(plan v6 §3.2 不做):co-wallet-*(儲值金 #202)/ co-coupon(優惠券)。」
```
📌 **這改變了這件事的形狀**:
```
不是「從零設計一個新功能」,是「**把一個已經設計好、當初刻意延後的東西接上**」
⇒ 鐵則 1(design 是真權威、直接搬不翻譯)在這裡是【有東西可搬】
⇒ 鐵則 2(design 的 mock 是合約)⇒ couponCode / couponApplied 兩個欄位名已經定了
```
⚠️ **而我沒有查的**:`plan v6 §3.2` 那份檔在哪、當初「不做」的理由是什麼。
**那個理由可能仍然成立** —— 引用本節時不要跳過這句。

---

## 1. 我們現在有什麼可以接(第 4 格)

### 1-1 ✅ **金額欄位已經在 domain 裡了**
```
packages/domain/src/order/errors.ts:20 逐字:
  「total_mismatch:total ≠ subtotal + shippingFee − discountTotal」
⇒ **discountTotal 已經是訂單模型的一部分,而且有不變式守著。**
```
⇒ 優惠券的「折多少錢」**有地方放**,不必新增訂單層欄位。
⚠️ 而 `discountTotal` 是**一個總數** ⇒ 「這 500 元是哪張券折的」**現在記不下來**。

### 1-2 🔴 而 code 層的 `coupon` **只存在於 CSS 註解**
```
git grep -li "coupon" -- 'packages/*' 'apps/*' 'supabase/migrations/*'  ⇒ **2 檔**
而那 2 檔是 cart.css / checkout.css,內容是上面那兩句「不搬」的註解
⇒ **零資料表、零型別、零 API。**
負向對照(同一把尺對確定有結構的東西):
  git grep -li "discount" 同範圍 ⇒ 48 檔 ⇒ 尺會動
```

### 1-3 ⚠️ 可能撞到的既有線(**我只看了名字,沒有開檔核**)
```
· 特價功能 —— 已知依賴「商品編輯調研片」(memory project_product-editing-admin-research-templates-first)
· 儲值金 #202 —— 與優惠券在同一句「不搬」裡,而 Sean 2026-08-18 明說【儲值金現在不開】
  ⇒ 🔴 兩者被綁在同一個 HOLD 裡,而**只有其中一個被解凍** ⇒ 解券不解錢包,要確認 CSS 那兩塊拆得開
```
🔴 **標未確認:我沒有查特價功能的 backlog 編號,也沒有開 plan v6 §3.2。**

---

## 2. 別人怎麼做(第 1、2 格)

### 2-1 Medusa(**最重要,因為鐵則 2:我們的後台 schema 對應 Medusa**)
來源:https://docs.medusajs.com/resources/commerce-modules/promotion/concepts(2026-08-19 取)
```
實體:Promotion(type: standard | buyget)/ PromotionRule / PromotionRuleValue / ApplicationMethod
百分比 vs 定額:ApplicationMethod 的 `type`(例 "percentage")+ `value`
總次數上限:Promotion 的 `limit`(**v2.12.0 起才有**)
最低消費:PromotionRule 用 `item_subtotal` + 運算子 `gte`
會員限定:`customer.groups.id` + `eq` / `in`
```
🔴 **而 Medusa 文件【沒有】明講的兩格**(我讀到的那頁沒有,標未確認):
```
· 有效期間的欄位名 —— 那頁沒寫
· **每人幾次** —— 那頁只有總次數 `limit`,沒有 per-customer
```
⚠️ 疊加:該頁只說「同一次計算裡,總額不反映其他促銷的折扣」,**沒有明講疊加設定**。

### 2-2 WooCommerce(**欄位名最完整,拿它當清單基準**)
來源:https://woocommerce.com/document/coupon-management/(2026-08-19 取)
```
折扣型別:Percentage discount / Fixed cart discount / Fixed product discount
期間:    Coupon expiry date
門檻:    Minimum spend / Maximum spend
次數:    **Usage limit per coupon**(總共幾次)
         **Usage limit per user**(每人幾次)      ← 🔴 兩個【不同】欄位
         Limit usage to X items
疊加:    **Individual use only**(勾了就不能跟別張一起用)
其他:    Allow Free Shipping / Exclude sale items / Products / Exclude products
         Product categories / Exclude categories / Allowed Emails
```

### 2-3 Shopify ⚠️ **我沒查到細節,標未確認**
我抓的那頁(https://help.shopify.com/en/manual/discounts/discount-types)**只講三種折扣型別,
沒有列出可設定欄位** ⇒ 🔴 **不要把 Shopify 那一格當成查過了。**

### 2-4 🔴 Sean 點名的五個維度,對照結果
```
設定方式        Medusa=ApplicationMethod / Woo=三種 type      ⇒ 兩家都把「折法」做成一個列舉
期間            Woo=Coupon expiry date                        ⇒ 🔴 Medusa 那頁沒寫、未確認
折 % 或折多少   兩家都有,而 Woo 多一種「單一商品定額」        ⇒ 我們要不要第三種?未決
次數 / 能用幾次 🔴🔴 **Sean 講了兩次,而它是兩個欄位**:
                Woo 說得最清楚:Usage limit per coupon(總共)/ per user(每人)
                Medusa 只有總數 `limit`
⇒ **這一格是他自己講出來的第一個歧義,而兩家的做法可以直接回答他。**
```

---

## 3. 🔴 他沒講、而一定會撞到的(第 3 格,本節最有價值)

```
① 能不能跟【會員等級價】疊加?
   🔴 我們有三級會員價(經銷價線)⇒ **這題非答不可,而且它是錢的問題不是 UI 問題**
   Woo 的對應設定叫 "Exclude sale items"(排除特價品)⇒ 別人把它做成【一個開關】
   ⚠️ 而我們的會員價**不是特價**,是身分價 ⇒ **Woo 那個開關對不上我們的模型**,要自己想

② 最低消費門檻?免運券算不算一種?
   Woo:Minimum spend / Maximum spend / **Allow Free Shipping**(免運是獨立勾選,不是折扣型別)

③ 過期了怎麼辦 —— 停用 vs 刪除?
   🔴 **已用過的券刪掉 ⇒ 舊訂單的金額對不起來**
   而我們的 total_mismatch 不變式(errors.ts:20)會不會因此紅?**我沒有查**,標未確認
   ⇒ 傾向:**只能停用不能刪**,而那要做成 schema 層的約束不是 UI 的

④ 同一張單能不能用兩張?
   Woo 有 "Individual use only" ⇒ 別人把它做成【每張券自己的開關】,不是全站設定

⑤ 🔴 併發:同一張限量券兩個人同時結帳 ⇒ 誰拿到?
   **那是 DB 層的事,不是 UI**。這個 repo 對這類問題有既有做法
   (attempts 那條線用 FOR UPDATE SKIP LOCKED + 原子 claim)⇒ **有前例可抄,不必發明**
   ⚠️ 而我沒有查那個做法能不能直接套用,標未確認

⑥ 🔴 **我自己加的一格**:券碼是**客人打字輸入**的
   ⇒ 大小寫、全形半形、前後空白 —— 那是這個 repo 踩過的坑
     (`composition.ts` 的 `.trim()` 註解逐字「Vercel dashboard 貼值很容易帶到尾隨空白」)
   ⇒ 而更硬的一格:**猜碼**。短碼 + 無限次嘗試 = 有人可以掃出所有券
     ⇒ 需要速率限制,而這 repo 已有 `lib/cron/rate-limit.ts` 的形狀可參考
```

---

## 4. 分級(第 5 格)

```
券的【內容】(碼、折多少、期間、次數)⇒ 🔴 **L3**
理由:員工每週都會開新券 ⇒ 鐵則 9 的 L3 定義(週多次)⇒ **必後台 CRUD**
券的【規則種類】(有沒有「最低消費」這種條件)⇒ L1~L2:加一種新條件是改 code
```
⚠️ 而鐵則 9 寫著「L3 發現立即停、寫 PRD 後再動」⇒ **這件事要先有 PRD,不是先有 plan。**

---

## 5. 體積分檔(第 6 格)

```
最小可用版:一種折法(定額)+ 期間 + 總次數 + 停用開關
           ⇒ 動:一張表 + 一支驗證 RPC + 結帳頁一個輸入格 + 後台一頁 CRUD
完整版:    再加 百分比 / 每人次數 / 最低消費 / 免運券 / 排除商品 / 能不能疊加
           ⇒ 每一項都是「一個欄位 + 一段驗證 + 後台一個欄位」
```
🔴 **而 Sean 2026-08-18 常設令是「不准做一半」** ——
**那不表示要做完整版,表示【選定的那一版要自己完整】**:
```
最小可用版若選了「只有定額」⇒ 那就要:
  · 後台開得出來、客人用得掉、金額對得起來、過期用不掉、次數用完擋得住
  · 而**不是**「先做輸入格、驗證之後再補」
⇒ 判準:**這一版交出去之後,員工能不能自己跑完一張券的一生?**
```

---

## 6. 我沒有查的(不要當已驗)
```
· plan v6 §3.2 那份檔在哪、當初「優惠券不做」的理由 —— 🔴 **那個理由可能仍然成立**
· 特價功能的 backlog 編號與它的狀態
· Shopify 的可設定欄位(我抓的那頁沒有)
· Medusa 的有效期間欄位名、per-customer 次數 —— 我讀的那頁沒寫
· total_mismatch 不變式會不會因為「券被刪掉」而紅
· 併發那格:attempts 線的 SKIP LOCKED 做法能不能直接套
· 🔴 **後台 UI 長什麼樣 —— 我一格都沒查**(design 有沒有後台的券管理頁?)
```
