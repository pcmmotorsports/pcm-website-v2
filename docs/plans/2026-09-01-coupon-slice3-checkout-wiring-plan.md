# 片3 · 把優惠券兌換接進結帳 —— plan(等主視窗批,未動手)

> 線【客人帳戶區】`-7a` · 2026-09-01 夜跑
> 🔴 **命中鐵則 12①(錢,結帳那條路)** ⇒ 全 9 步、codex 不降級、plan 批准才動手。
> 前置(昨晚交的)已全解:predicate `coupon_redeem_order_problem()` + 那道落點分母閘。

---

## 0. 🔴 偵察量到的兩件事 —— 它們決定了這一片的形狀

```
① create_order 的參數列【沒有任何折扣/券的欄位】
   最後一代 20260825130000:… 逐字 9 個參數:
   p_lines / p_address_id / p_shipping_method / p_invoice / p_cart_session_id
   / p_terms_version / p_client_ip / p_client_ua / p_notification_email
   而它 INSERT orders 時 discount_total 是【寫死的 0】(同檔 :394 那一行)
② 付款成功那一步是 public.confirm_order_payment(20260810170000:328)
```

## 🔴 ⇒ 所以這一片有【兩個時刻】, 而那是 Sean 拍的板逼出來的

片1 `:7` 逐字:**「Q『用掉一次』什麼時候算 ⇒ 乙:付款成功才算」**
片1 `:11` 逐字:**「片2 落點:寫 redemption 的時機綁付款成功那一步, 不綁建單」**

```
時刻 A 建單(create_order)  ⇒ 客人要看到折扣、要付折後的錢
                             ⇒ orders.discount_total / total 必須反映它
時刻 B 付款成功(confirm_order_payment)⇒ 才寫那一列 redemption(Sean 拍乙)
```
🛑 **⇒ 這兩個時刻之間有一個【客人已經看到折扣、而券還沒被用掉】的窗口。**

## 🔴 而 Sean 已經看過這個代價並接受了 —— 不要重問

片1 `:8` 逐字:**「而他是看過代價才選的 —— 選項裡逐字寫著
『限量券沒辦法先保留,兩個人同時結帳可能都成功』」**
⇒ ✅ **兩人同搶最後一張券 ⇒ 兩人都看到折扣, 而只有一個兌得到。這是已拍板的行為, 不是缺陷。**
🛑 而 plan 要答的是:**那個沒兌到的人, 付款那一刻會發生什麼?**(見 §3)

---

## 1. 客人在哪一步輸入券碼 ⇒ **結帳頁, 不做購物車**

```
甲 結帳頁(推薦)· 乙 購物車 · 丙 兩者
```
🔵 **推薦甲**,理由是量到的不是偏好:
```
· 券的規則要 subtotal 才算得出來(低消 / 百分比), 而購物車那一頁的小計是 client 自管的
  (apps/storefront/src/app/cart/actions.ts:27-31 逐字「qty 由 client 自管」)
  ⇒ 在購物車算折扣 = 拿一個 client 說了算的數字去算錢
· 而結帳頁走 server action(charge-actions.ts), 小計是 server 算的
🛑 代價寫清楚:客人在購物車看不到折後價 ⇒ 到結帳才知道。**這是取捨, 不是疏漏。**
```

## 2. 🔴 券失效時客人看到什麼 —— **稿查了, 而稿沒有文案**

### 查稿的分母(鐵則 1;`list_projects` 命中那個已知形狀)
```
🔴 OD list_projects ⇒ **回 0 個專案**;而磁碟 ⇒ **12 個**
   ⇒ 命中 CLAUDE.md 鐵則 1 逐字寫的那一格 ⇒ **以磁碟為準**, 我直接掃磁碟
   數法 ls ~/Library/Application\ Support/Open\ Design/…/projects | wc -l ⇒ 12
```
掃過的分母與結果:
```
12 個 OD 專案全掃 ⇒「優惠券」只在 pcm-home-redesign{,-codex,-opus5} 三個, 而**全是同一句註解**:
   「優惠券 .cart-coupon / -row / -ok **不搬**(plan v6 §3.2「優惠券」不做、#202 wallet HOLD)」
   ⇒ 🔴 那三個是【已搬過的版本】, 券被刻意排除 ⇒ **它們不是券的真權威**
✅ 真權威在 repo 的 submodule `design-reference/`:
   styles/account.css:173-200      .cart-coupon / -row / input / button 的實際樣式
   components/CheckoutPage.jsx:63,64,94-98   couponCode / couponApplied 狀態與算式
   HANDOFF.md:202                  "couponDiscount": 500  // 若 coupon 無效則 0 + invalidCoupon: true
🛑 而 design-reference 在【我這棵工作樹是空的】(0 檔)——
   🔴 我一度在那裡 grep 出 0, 而**正對照 `checkout` 也是 0** ⇒ 那把尺是死的, 那些 0 不算數。
   ⇒ 真的有內容的是主樹 /Users/sean_1/pcm-website-v2/design-reference(181 檔, 正對照 checkout ⇒ 9)
   📌 **一個 submodule 沒初始化時, 它與「那裡什麼都沒有」印同一個 0。**
```

### ⇒ 稿對「失敗」只給一個布林, 沒有給文案
`HANDOFF.md:202` 逐字:**`若 coupon 無效則 0 + invalidCoupon: true`**
```
🔴 全 181 檔掃「券.*(無效|過期|用過|不能|找不到)」⇒ **0 檔**
⇒ ✅ **查無, 而這是帶著分母的查無** ⇒ 依主視窗授權, 文案由我擬, 而擬完要回報
```
文案草案(每一句要說得出下一步):
```
below_min_spend        「這張券要滿 NT$X 才能用,你目前 NT$Y」   ← 唯一可行動的
expired                「這張券已經過期了」
inactive               「這張券目前停用中」
not_found              「找不到這張券,請確認輸入」
already_used_by_account「這張券你已經用過了」
exhausted              「這張券已經被領完了」
tier_conflict          「這張券不能和會員價一起用」
🛑 而 predicate 那十個碼(cancelled / refunded / …)客人【看不到】——
   它們代表「這張單本身有問題」, 走既有的訂單錯誤路徑, 不是券的文案
```
🛑 **而「下一步做什麼」只有第一句答得出來** —— 其餘六個的正確下一步都是「換一張券或不用券」。
**不要為了句式一致而編出假的行動。**

---

## 3. 🔴🔴 而查稿撞出一個【稿與拍板衝突】的格 —— 這一格要決定

```
稿(CheckoutPage.jsx:95)逐字:
  const beforeWallet = Math.max(0, subtotal + shipping - couponDiscount);
  ⇒ **券折的是「小計 + 運費」** ⇒ 折扣可以吃掉運費

而我的 RPC(20260831160000:216)逐字:
  v_calc := least(v_calc, p_subtotal);   ⇒ **券的上限 = 小計** ⇒ 吃不到運費
```
🔵 **兩者在多數情況同值, 而在【折扣 > 小計】時分岔**:
```
例:小計 300 · 運費 100 · 一張定額 500 的券
  稿  ⇒ total = max(0, 300+100-500) = **0**    客人運費也不用付
  我  ⇒ 折 min(500,300)=300 ⇒ total = **100**  客人還要付運費
```
🛑 **而 Sean 2026-08-31 拍的甲【只涵蓋 0 元商品那一種】**
(題目逐字:「商品 0 元贈品 + 運費 100 的單」⇒ 拒掉)
⇒ **「小計 > 0 而折扣 > 小計」那一段, 他沒有被問到。**
```
甲 照稿:券可以吃運費 ⇒ 要改 RPC 那一行的上限(從 subtotal 改成 subtotal + shipping)
乙 照現況:券的上限 = 小計, 運費一定要付
```
🔵 **我推薦乙**, 而理由與他拍甲時的理由同一條:
**「券的規則(低消 / 百分比)整套是對【商品金額】定義的」** —— 低消比的是小計, 百分比乘的是小計。
⇒ 讓它吃運費 = 那張券在「滿 NT$X」與「折幾成」兩處用小計, 而在上限那一處用另一個基準。
🛑 **而這是【錢】+ 【稿與拍板衝突】⇒ 我不自己拍。主視窗判要不要端 Sean。**
📌 而不論選哪個, **稿那一行要標「已被 2026-09-01 的決定取代」** —— 否則下一個人照稿改回去。

## 3b. 🔴 兌換與扣款的順序 ⇒ 主視窗已裁【丙】, 而它要我寫死「誰看得到那個告警」

```
建單時:  以【試算】結果寫 orders.discount_total(p_order_id = NULL, 不鎖不寫)
付款成功:confirm_order_payment 之後呼叫 redeem_coupon(帶 order_id)
```
主視窗 2026-09-01 裁定逐字:
> 丙 付款成功 + 告警 + 訂單標記待人工。**而我裁, 不端 Sean** ——
> 「端他的條件不是【這件事很重要】, 是【存在兩個他有資格選的結果】;
>  乙客觀更糟(錢已經動了), 而甲是丙去掉告警
>  ⇒ **那不是取捨, 是一個對的做法與一個把它弄瞎的做法**」

### 告警誰看得到 ⇒ 查了, 答案分兩半
```
✅ 管道存在且是【真人收得到】的, 不是只寫 log:
   apps/storefront/src/app/api/cron/anomaly-alert/route.ts
   收件人 LINE_ALERT_TO / ALERT_EMAIL_TO(取值處 @/lib/payment/composition.ts)
🔴 而它有一道旗標 `ANOMALY_ALERT_ENABLED`, 該檔 `:18` 逐字「**預設 false** → 認證過後 200 no-op」
   2026-08-21 量到 `enabled:true`(行為量到的, 系統端 + 客人端各一次)
   🛑 **而那之後沒有人重量** —— 距今 11 天
```
### ⇒ 處置(把缺口留在會被讀到的地方, 不假裝有出口)
```
1. 兌換失敗 ⇒ 寫一列 anomaly + 訂單標記待人工 + 走既有告警管道
2. 🔴 plan 明寫:**這條路的可見度押在 ANOMALY_ALERT_ENABLED 上, 而它 11 天沒被重量**
   ⇒ 若它是 false ⇒ **丙 會安靜地退化成甲, 而我們以為做了丙**
3. ⇒ 驗收要有一格:**在拋棄式環境把那個旗標關掉, 證明它會退化**
   ⇒ 那一格的價值不是「紅或綠」, 是**讓退化這件事變成看得見的**
🛑 而【重量那個旗標的現值】不歸本片(要 Production env 存取)⇒ 具名交主視窗
```

## 3c. 🔴 `create_order` ⇒ **收券碼, 不收金額**(2026-09-01 重裁, 取代原本的「只加一個金額參數」)

⛔ ~~主視窗原裁:「多一個 `p_discount_total`, 它只是接受一個已經算好的金額」~~
🔴 **那一版有洞, codex 抓到、主視窗自己去正式庫量過並重裁**:
```
create_order 是 SECURITY DEFINER 且 GRANT EXECUTE … TO authenticated
而 Supabase 把 public schema 的函式全部開成 PostgREST RPC 端點
⇒ 任何登入的客人拿 anon key + 自己的 JWT 就叫得動它, 並自己填那個金額
🟢 正式庫實測:authenticated EXECUTE ⇒ true · anon ⇒ false
   ACL = postgres=X/postgres , authenticated=X/postgres · SECURITY DEFINER ⇒ true
   🟢 對照組 admin_search_customers 對 authenticated ⇒ false(那把尺會說「不」)
🛑 而這條紅線寫在 packages/adapters/src/supabase/mappers/order.ts 上面幾行:
   「永不夾帶 price / …;價 / 運費 / 歸屬 / tier 全 RPC server 權威算」
   ⇒ 而 CLAUDE.md Server 端鐵則逐字:「不信任 client 送的欄位」
```
✅ **改成 `p_coupon_code text DEFAULT NULL`** —— 函式體呼 `redeem_coupon` 試算, 金額由 DB 算。
📌 **那不是把券的邏輯搬進 RPC, 是【不再相信呼叫端算的數】。**
🔴 而**參數是換掉不是加驗證** —— 留著金額參數再加一道閘, 那個洞的形狀還在。
🔵 判準(主視窗採用):**職責分離是設計偏好, 客人填金額是漏洞 —— 兩者不同量級。**

### rollback
```
回捲 = DROP 10 參那支 + 重新 apply 20260825130000 的本體 + **重新 GRANT**(DROP 帶走 ACL)
🔵 而 DEFAULT NULL 讓還沒改的 TS 在新函式上跑得動 ⇒ 上線順序可以【先 DB 後 TS】
```

### ✅ codex R2 那個【3a 單獨上線就是個洞】—— **已解, 主視窗裁「丁」**
```
洞:3a 若早於 3b apply ⇒ authenticated 直接呼 RPC + 有效券碼 ⇒ 建折扣單、付折後價
   而 redemption 不會被寫(那在 3b)⇒ 券的三道上限永遠不被扣 ⇒ **同一張券可無限次用**
```
✅ **丁:3a 收到任何券碼就 RAISE「優惠券結帳尚未啟用」** ——
   3b 的第一件事就是把那道 RAISE 換成 `redeem_coupon` 的試算。
📌 判準是【忘記的時候會發生什麼】:
```
寫進 apply 清單, 忘了 ⇒ 券可無限次用       🔴 洞
封住,           忘了 ⇒ 券結帳不會啟用      ✅ 惰性
```
🔵 **而它零新 DB 物件、零「要記得」** —— 機制不必是新東西,**它可以是【讓預設值變成安全的那一邊】。**
🛑 連帶:3a 不呼叫 `redeem_coupon` ⇒ 那兩道前置閘拿掉(斷言沒用到的相依 = 說謊),
   寫進券碼分支的註解由 3b 帶回來 ⇒ **兩片的關係在碼上看得見。**

### 🔴 apply 前的硬前置條件(codex R3 must-fix①)
```
本檔 DROP + 重建 create_order ⇒ 若正式庫那支身上有一個【沒進 repo 的補丁】, 會被靜默覆蓋
⇒ 影響面 = 每一張訂單
🛑 而檔內那三格錨只證「我依賴的那三行沒漂」, **證不了其餘 300 行沒漂**
⇒ **apply 前必須由有正式庫存取的人比對 md5(pg_get_functiondef(...))。不比對就不要 apply。**
```
