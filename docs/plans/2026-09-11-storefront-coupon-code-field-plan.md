# Plan · 顧客站結帳的【券碼輸入框】⛔ ~~(Sean 2026-09-11 拍乙:券整條線一次通到底)~~

> 🛑🛑 **[2026-09-11 定案:本 plan 【停在這裡】,券整包排上線後]**
>
> **Sean 2026-09-11 改拍乙 = 券整包停在這裡,排上線後再做。** ⇒ 🛑 **§3 那四片一片都不要開工。**
> 🎯 **而他改主意的依據是 §0 那個頭條**(逐字):貼那兩支**不會**解除封鎖 ⇒ 要新開一支
> `create_order` 世代 = 第 8 支;而**片 D 不做,前面三片就是做了一個會讓客人結不了帳的框**。
> 📌 **⇒ 本 plan 的價值不是「找到一個 bug」,是【把一件事的真實範圍量出來】,而那改變了決定。**
> 🔵 **本檔不刪、不撤回** —— 排上線後撿起來的人,要的就是 §0 與 §4 這兩節。
> ⚠️ 而 §1 的讀數會過期(`APPLIED.tsv` / `coupons` 列數 / 稿版本)⇒ **撿起來的第一件事是重量一次,不要照抄。**
>
> ---
>
> **本片讓客人打得了券碼。** 而 `couponCode` 從 domain 到 adapter 到 RPC **今天已經全通**,
> 缺的只是「把值放進去」的那個框 —— 那是 2026-09-11 窗 A 量出來的(七支檔清單在 §3)。
>
> · 命中**鐵則 8**(動 `packages/schemas` 共用元件 + 動 RPC)⇒ **plan 交主視窗批准才動手。**
> · 片型 = **高風險片**(鐵則 12 ①錢:券折的是客人付的金額)⇒ commit 前 codex 唯讀審一輪。
> · **Sean 本人沒有看過本 plan。** 他授權的是方向(乙 = 一起做),不是做法。
> · 🛑 **本 plan 一個字都還沒動到碼。**

---

## 0. 🔴🔴 頭條:**貼那兩支扣券 migration【不會】解除封鎖 —— 沒有人的清單有這一格**

主視窗給的七支檔清單(也是我自己上一輪交的)**少了最重要的一支**。逐字量:

```
【量的】哪些 migration 建 create_order(尺放寬到跨行寫法):
   … 20260904020000 · 20260906500000 · 20260907040000       ⇐ 最新一代
   ⚠️ 我第一把尺(只認 `CREATE OR REPLACE FUNCTION public.create_order`)漏掉 20260907040000
      —— 它用的是 `DROP` + `CREATE FUNCTION`(:142-145 / :668)。**這一格我留著不遮。**

【量的】最新那一代 20260907040000 ⇒ APPLIED.tsv 命中 1(已貼)
        而它裡面 `優惠券結帳尚未啟用` ⇒ **命中 2 處**(仍在)

【量的】券片 3b 那兩支(20260901021000 / 20260901030000)建了什麼:
   20260901021000 ⇒ 只建 coupon_redeem_on_paid()                  ← 沒有 create_order
   20260901030000 ⇒ coupon_redeem_on_paid() · settle_zero_total_order() · admin_compute_order_settlement()
                                                                   ← 也沒有 create_order
```

> ## 🎯 **⇒ 今天線上的 `create_order` 收到券碼會 `RAISE EXCEPTION`,而【3b 那兩支不會把它換掉】。**
> ## 📌 **⇒ 要解除封鎖,必須【新開一支 create_order 世代】。那是第 8 支檔,而它是鐵則 8 的正中心。**

### 🟢 [2026-09-11 補上正式庫實查 —— 這一格現在是**硬的**]

> ⛔ ~~原本這一格只建在 `APPLIED.tsv` 上,而 CLAUDE.md 明文「`APPLIED.tsv` 的 0 不是答案」。~~
> ✅ **2026-09-11 由主視窗在正式庫跑唯讀查詢(窗 A 產 SQL、主視窗跑,不自驗),兩本帳都說沒有。**

```
                                   APPLIED.tsv   正式庫實查
20260901021000  coupon_redeem_on_paid     0      不存在(0)
20260901030000  settle_zero_total_order   0      不存在(0)
🟢 正對照 public.coupon_revert_on_full_refund 存在(期望1)      ⇒ 1   ← 尺是活的、連的是對的庫
⚪ 負對照 現造物件名 / 現造函式名(期望0)                        ⇒ 0
rc=0 · 真錯誤 0 格
```
🎯 **⇒ 兩本帳一致 ⇒ §0 的結論站得住,而 Sean 2026-09-11 拍乙的依據是硬的。**

#### 🔴 而那份查詢裡有【兩把壞尺】—— 寫在這裡,給下一個用 `is-migration-applied.sh` 的人

那支 SQL 是 `bash scripts/is-migration-applied.sh` **產的**,不是手寫的;而它自己檔頭就寫「**這是猜的**,
每一個候選都要你自己開檔核」。🛑 **而窗 A 照抄了它產的東西,沒有逐條核判別力 —— 那一格是窗 A 的。**

```
① 失敗的正對照:`030000` 那份把 public.coupon_redeem_on_paid 標成【正對照 期望1】
   ⇒ 而那正是 030000【自己要建的東西】⇒ 實跑回 0
   ⇒ 🛑 照那支腳本自己的規矩「正對照回 0 ⇒ 下面每一格的 0 都不算數」
   ⇒ 📌 若不是全域那個 coupon_revert 正對照另外撐著,這一整份的結論會【全部作廢】。

② 沒有判別力的 19 條:39 條查詢裡, 19 條「body 含 …(1=已貼)」量的是
   admin_compute_order_settlement, 而它們全部回 1。
   🔴 而成因【不是「它早就存在」】—— 是 2026-09-07 有人把那一段【抽出去單獨貼了】:
      `20260907170000_m4b_settlement_split_from_zero_total.sql`(APPLIED = 1)
      檔頭逐字「把 admin_compute_order_settlement 從 76 抽出來單獨貼」,
      而它產生的內容 md5 `f134e95d…` = **76(本支 030000)`:1051` 那一版**。
   ⇒ 🎯 所以那 19 條量到的字面【已經在線上了】, 而 76 本身沒貼
   ⇒ 📌 它們在【貼與沒貼】兩個世界印同一個 1 ⇒ **判別力 = 0**, 而它們印的字是「1=已貼」。
```
> ## 🎯 **⇒ 一份 39 條查詢的輸出裡,19 條沒有判別力、1 條是失敗的正對照,而它整份看起來全綠。**
> ## 📌 **救它的是那個【形狀不同的】全域正對照 —— 兩把尺,其中一把破了而另一把還站著。**
> 🛑 **⇒ 用那支工具產的 SQL,要先逐條問「這一格在【貼與沒貼】兩個世界會不會印同一個值」。**

3a 那段封鎖的逐字(`20260906500000:502` / `:957`,而同形也在 `20260907040000`):
```sql
RAISE EXCEPTION
  'create_order: 優惠券結帳尚未啟用(券片3b 未上線)—— 本次請不要帶券碼(收到 %)',
  pg_catalog.btrim(p_coupon_code);
```
🔵 **而那個封鎖【當初是刻意的、而且理由很好】,原字保留**(`20260901003000:428-437`):
> 判準是【忘記的時候會發生什麼】:寫清單忘了 ⇒ **券可以無限次用**(洞);封住忘了 ⇒ **券結帳不會啟用**(惰性)。
> 📌 **一個被遺忘的 3a 是【惰性的】,不是【有洞的】。**

🛑 **⇒ 所以解除它不是「刪一段」,是【把那個安全預設換成一次試算呼叫】** —— 而換的時候
`20260901003000:442-448` 逐字交代要一起帶回兩道前置閘:① `redeem_coupon(text,uuid,integer,boolean,uuid)` 存在
② `create_order` 的 owner 對它有 `EXECUTE`(它被 REVOKE 到只剩 `service_role`)。

---

## 1. 今天的世界(全部量過,不是推的)

| 格 | 讀數 | 出處 |
|---|---|---|
| `couponCode` 型別 | ✅ 在 | `packages/domain/src/order/types.ts:1714` `couponCode?: string` |
| adapter 送不送得出去 | ✅ 送得出去,**有值才送** | `packages/adapters/src/supabase/mappers/order.ts:176-178` |
| 這條路有沒有測試在守 | ✅ 有 | `mappers/order.test.ts:105 / :122 / :131` |
| 前台有沒有框 | 🔴 **沒有** | 結帳欄位全集 = `addressId` · `shippingMethod` · `invoice` · `paymentChannel` · `notificationEmail`(`packages/schemas/src/index.ts:321-335`)⇒ **無券** |
| 退券路徑 | ✅ **2026-09-11 已進正式庫** | `20260901020500_m4b_coupon_revert_on_full_refund.sql` · `APPLIED.tsv:615` 貼板 `@20260911-021655-65465` |
| 扣券 trigger | 🔴 **未貼** | `APPLIED.tsv` `20260901021000` ⇒ 0 · `20260901030000` ⇒ 0 |
| `create_order` 收券碼 | 🔴 **RAISE EXCEPTION** | 見 §0 |
| `coupons` 表 | 🔴 **0 列**(主視窗 2026-09-11 量) | — |
| 後台建不建得了券 | 🔴 **建不了** | `SupabaseCouponAdapter` 方法全集 = **只有 `listCouponsForAdmin`**(`:85`);而檔頭 `:12` 逐字「片1 的兩張底表對 `service_role` 是**零表權限**」⇒ **不是沒做 UI,是 DB 層就寫不進去** |

⚪ 負對照 `zzzCouponClaim20260911` ⇒ 0 · 🟢 正對照 `notificationEmail` ⇒ schemas 7 / Step1 12 ⇒ 尺會動。

---

## 2. design 稿(鐵則 1:先 grep,不憑記憶、不畫預覽 HTML)

🛑 **`design-reference` 是 gitlink** ⇒ 各窗眼前的稿**可能不是同一版,而沒有任何東西會叫**。
**我讀的是這一版**:
```
git ls-tree HEAD design-reference ⇒ 160000 commit a14fdcf9387d0cf0727aa29f276c61a424411d24
該版 HEAD  a14fdcf  2026-08-03  docs: HomePage.jsx 檔頭標記為過期假稿,真權威指向 Open Design
```
稿的落點(逐字):
```
design-reference/components/CheckoutPage.jsx:481-493
  {/* Coupon */}   <div className="ap-mono">N°{walletBalance > 0 ? '06' : '05'} · COUPON</div>
  <div className="cart-coupon co-coupon"><div className="cart-coupon-row">
    <input placeholder="輸入優惠碼(試試 PCM100)" value={couponCode} onChange={…}/>
    <button onClick={applyCoupon}>套用</button>
  </div>
  {couponApplied && <div className="cart-coupon-ok">已套用 {couponApplied} · 折抵 NT$ 500</div>}
樣式  design-reference/styles/account.css:205-213(.cart-coupon-row button:hover / .cart-coupon-ok)
      design-reference/styles/checkout.css:347-348(.co-coupon .cart-coupon-row input 圓角)
```
🔴 **而稿是【按「套用」才算】** —— `applyCoupon` 綁在按鈕的 `onClick`(`:490`),不是 `onChange`。這一格對應 §4 的問題②。

---

## 3. 要動的檔(逐支寫「改什麼 / 為什麼非它不可 / 影響」)

| # | 檔 | 改什麼 | 🔴 為什麼非它不可 | 影響 |
|---|---|---|---|---|
| **0** | 🔴 **新開一支 migration(新 `create_order` 世代)** | 把 §0 那道 `RAISE EXCEPTION` 換成 `redeem_coupon` 試算呼叫 + 帶回兩道前置閘 | **不動它,框做出來客人一打券碼整張單就建不出來** | 🛑 **動 RPC + 動錢 ⇒ 鐵則 8 + 鐵則 12。要 Sean 批、要 codex 審、要貼板** |
| 1 | `packages/schemas/src/index.ts`(`createCheckoutInputSchema` :321-335) | 頂層加 `couponCode`(選填、trim、長度上限) | `charge-actions.ts:15` 逐字「三段 `safeParse`(**strip 未知欄**)」⇒ **不加就被剝掉,值到不了後面** | 🔴 **共用元件 ⇒ 鐵則 8。**兩個 app 都吃這份 schema |
| 2 | `apps/storefront/src/components/CheckoutStep2.tsx` | 框本身(照 §2 稿) | 稿把券放在 `N°05/06`,而 Step2 正是發票/付款那一頁 | 純前台;元件現行 7 個 input ⇒ 變 8 |
| 3 | `apps/storefront/src/app/checkout/charge-actions.ts`(`:381` 組 `placeOrderInput`) | 把 parse 出來的值放進 `PlaceOrderInput.couponCode` | **唯一接得上 adapter 的那一針** —— adapter 已經在等這個鍵 | 成交主線 ⇒ 高風險 |
| 4 | `apps/storefront/src/app/checkout/checkout-form-types.ts` | `CheckoutFieldErrors` 加 `couponCode?` | 否則券碼錯了**沒有欄位可以顯示錯誤** | 純型別 |
| 5 | `apps/storefront/src/styles/checkout.css` | 搬回 `.co-coupon` | `:21` 逐字「不搬(plan v6 §3.2 不做):co-wallet-* / **co-coupon**」 | 純樣式;**舊字面用刪除線留著不刪** |
| 6 | `apps/storefront/src/styles/cart.css` | 搬回 `.cart-coupon` / `-row` / `-ok`;`.cart-row-discount` 折扣列 | `:8-9` 逐字標了不搬 | 同上 |
| 7 | 各自的 `*.test.ts(x)` | 每一支動到的都要有測試在守 | 鐵則 11 | — |

🔵 **切片建議(鐵則 4:一片 15-45 分鐘)**:
```
片 A  1 + 4          schema 與錯誤型別(零畫面, 零行為)
片 B  2 + 5 + 6 + 7  框與樣式(畫面出來, 而還不會送出去 —— 因為 3 還沒接)
片 C  3 + 7          接上那一針  ⇐ 🛑 到這裡為止, 客人打券碼會撞到 §0 那道 RAISE
片 D  0              解除封鎖    ⇐ 🔴 動 RPC, 獨立一片, 獨立審, 獨立貼
```
🎯 **⇒ 片 D 不做,前面三片就是【做了一個會讓客人結不了帳的框】。** 這是問題④的來源。

---

## 4. 要 Sean 答的五題(每題兩選項一推薦;第 ⑤ 題是我加的)

```
Q1 券碼錯了要怎麼跟客人講?
   🔬 DB 那一側 redeem_coupon 回得出【7 種理由】(20260831160000):
      not_found · inactive · expired · tier_conflict · already_used_by_account · exhausted · below_min_spend
A: 甲 前端只講一句籠統的「這張券不能用」(推薦 —— 不洩漏券的存在與規則, 而客人也不需要知道 7 種)
 | 乙 7 種各給一句話(客人清楚, 而「exhausted / already_used」等於告訴外人這張券真的存在)

Q2 要不要【即時試算折抵】(打字就顯示折多少)?
A: 甲 按「套用」才算(推薦 —— design 稿就是這樣, applyCoupon 綁 onClick;而且每打一個字就打一次 DB 太貴)
 | 乙 打字就即時算

Q3 🔴 今天 coupons 0 列, 而後台【建不了券】(adapter 只有一支 listCouponsForAdmin,
   而那兩張底表對 service_role 是零表權限)⇒ 誰來建第一張券?
A: 甲 Sean 自己在 SQL Editor 貼一張(推薦 —— 零工程, 今天就能有第一張券)
 | 乙 先做後台的「建券」功能(要新 UI + 要開 DB 權限 ⇒ 那是另一片, 而且碰權限)

Q4 🔴 框先做, 而扣券(片 D)沒上線, 客人打了券碼會怎樣?
   🔬 【量的】今天會 RAISE EXCEPTION ⇒ **整張單建不出來**, 客人看到「付款失敗, 請稍後再試」,
      而再試一百次都不會成功。
A: 甲 框與片 D 一起上, 不分開放行(推薦 —— 分開放 = 主動製造一個結不了帳的入口)
 | 乙 框先上而把它藏起來(feature flag), 片 D 好了再開

Q5 🔴 而這一題【三週前就掛在那裡沒人答】—— 折扣的上限基準
   🔬 20260901003000:459-467 逐字「上限基準未定案 —— Sean 2026-09-01 待拍」:
      design 稿 CheckoutPage.jsx:95  Math.max(0, subtotal + shipping - couponDiscount)  ⇒ 折【小計 + 運費】
      券 RPC   20260831160000:216    least(v_calc, p_subtotal)                          ⇒ 折【小計】
      例:小計 300 · 運費 100 · 定額 500 券 ⇒ 稿算 total 0 / 現行碼算 total 100
A: ✅✅ 甲 維持現行(上限 = 小計, 運費照收)   ⇐ 🟢 **Sean 2026-09-11 拍甲 · 定案**
 | ⛔ ~~乙 照稿(折扣可以吃掉運費)⇒ 要改三處:create_order 那一行 + 券 RPC 那一行 + 兩處要收運費~~
   🔴 **不採用。舊字面留著不刪** —— 它是「稿與碼分岔過」的紀錄, 刪了下一個人會再撞一次。
```

### 🟢 Q5 定案(2026-09-11)—— **這一題掛了三週,現在有答案了**

```
Sean 2026-09-11 拍【甲】= 維持現行:券折【商品小計】, 運費客人自己出。
理由(他的話):券折運費等於虧兩次。
⇒ 稿那一版(折 小計 + 運費, design-reference/components/CheckoutPage.jsx:95)【不採用】。
```
🛑 **而 `20260901003000:459-467` 那段逐字寫著「上限基準未定案 —— Sean 2026-09-01 待拍」⇒ 那個標記現在過期了。**
　 🔴 **本 plan 不去改那支 migration**(它已經貼在正式庫)—— 而**撿起本 plan 的人要知道**:
　 那段註解會告訴你「還沒拍」,**而它已經拍了**。📌 **一個過期的「待拍」,讀起來跟真的待拍一模一樣。**
　 ⇒ ✅ 訂正的落點在**第 8 支**(新 `create_order` 世代)的檔頭:寫那支的人要把這個定案帶過去。
🔵 **Q5 若拍乙, 片 D 的範圍會變大** ⇒ 建議 **Q5 先答**, 它決定片 D 怎麼寫。

---

## 5. rollback

| 片 | 怎麼退 |
|---|---|
| A / B / C | 純 app 碼 ⇒ `git revert`,零 DB 動作 |
| 🔴 D | **不是「貼回去」,是重貼上一代 `create_order`(`20260907040000`)** —— 那一代把封鎖帶回來 ⇒ 退回「不能用券」而不是「券有洞」。📌 **退路的方向與 3a 的設計方向一致:失敗時落在惰性那一邊。** |

---

## 6. 🛑 我證不到什麼(照實列)

- ⛔ ~~**證不到正式庫今天的 `create_order` 定義逐字等於 `20260907040000`**…§0 那個結論要用 `is-migration-applied.sh` 產唯讀 SQL、交有 access 的人跑過才算硬。~~
  ✅ **2026-09-11 關掉了** —— 主視窗在正式庫跑過唯讀查詢,**兩本帳一致**(讀數與那兩把壞尺見 §0 補段)。
  🔴 **而【剩下的那一半仍然證不到】,收窄後留著**:我證到的是「**那兩支 3b 沒貼**」,
  **不是**「線上 `create_order` 的定義逐字等於 `20260907040000`」—— 後者要比 `prosrc` 的 md5,**沒有人比過**。
  📌 **⇒ §0 的結論(貼 3b 不會解除封鎖)靠的是【3b 沒有建 create_order】這個 repo 事實,不靠線上定義比對。**
- **證不到 `coupons` 今天真的 0 列** —— 那是主視窗 2026-09-11 量的,不是我量的。
- **證不到 §1「退券已貼」之後那道 fail-closed 真的會放行** —— 我讀的是 `APPLIED.tsv:615` 與那兩支檔裡的 `RAISE` 字面,**沒有真的貼一次試**。
- **證不到 7 種 reason 會不會【一路傳到前端】** —— 3b 的 `create_order` 試算呼叫要怎麼把 reason 帶回來,**那正是片 D 要設計的東西**,今天不存在 ⇒ Q1 的答案會反過來決定片 D 的回傳形狀。
- **沒有量前端要不要顯示「折抵後金額」的即時預覽** —— 稿有(`:540` / `:627-628` 兩處折扣列),而我沒有把它排進七支檔,因為它動的是總額區塊、範圍不同。**要做要另開一格。**
- **沒有開瀏覽器走過** —— 全程唯讀讀碼。**做完的定義仍然是 Sean 自己走一遍。**

---

## 7. 落點

本 plan 交主視窗 → 端 Sean 答 §4 五題 → 批准後照 §3 切片開工。
🛑 **在 Sean 答 Q4 與 Q5 之前不要動片 D。**
