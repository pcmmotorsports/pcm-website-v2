# Plan · 段 1-C:結帳分岔出「匯款」那條路(建單, 不扣款)

> 🔴 **片型 = 高風險片**(鐵則 12①【錢】+ 鐵則 8【動共用金流路徑】)⇒ 全 9 步、對抗審查不降級。
> 🔵 **內容分級 = L1**(付款方式是結構不是內容;帳號字面在 `remittance-info.ts`, 段 2 已定)。
> 🔵 **授權**:Sean 2026-09-04 拍「匯款這整條路 ⇒ 甲 要 —— 上線前一定要能匯款」⇒ **【要不要做】已批。本 plan 是【怎麼做】。**

---

## 0. 為什麼要這一片 —— 一句話, 而它是量到的

```
🔬 charge-actions.ts:180   const parsedPrime = TapPayPrimeInput.safeParse(raw.prime);
🔬 charge-actions.ts:181-183 if (!parsedPrime.success) return { formError: '付款資訊缺失,請重新進行刷卡' };
🔬 而它在 placeOrder(:318)【之前】, 而且【零分支】
🔬 而 placeOrder 在整個顧客站【只有這一個呼叫點】(掃 apps/storefront/src、排除測試)
```
🎯 **⇒ 客人選了匯款 ⇒ 沒有卡 ⇒ 沒有 prime ⇒ 在建單之前就被擋掉,**
⇒ ⇒ **而他看到的字面逐字是「付款資訊缺失,請重新進行刷卡」—— 叫一個選了匯款的人去刷卡。**

📌 **⇒ 所以缺的不是一個 radio, 是那條路的【分岔】。**
🛑 **⇒ 而這也是為什麼「解除隱藏」聽起來像一行, 而它不是。**

---

## 1. 要改什麼(檔案清單, 而它是分岔不是新路)

| # | 檔 | 改什麼 |
|---|---|---|
| 1 | `apps/storefront/src/app/checkout/charge-actions.ts` | prime 那一格**之前**分岔;匯款 ⇒ 跳過 prime / charge / confirm;回新變體 |
| 2 | 同上(型別) | `ChargePaymentActionResult` 加一個**頂層**變體 `{ pendingTransfer: true; displayId }` |
| 3 | `apps/storefront/src/hooks/useChargePayment.tsx` | 收那個變體(排在 `ok` **之前**判);`status` union 加一格 |
| 4 | `apps/storefront/src/components/CheckoutStep2.tsx` | 解除 ATM 選項隱藏(**照稿搬**, 見 §5) |
| 5 | `apps/storefront/src/components/CheckoutView.tsx` | 兩處寫死的 `'tappay' as const` ⇒ 改讀真的選擇 |
| 6 | `apps/storefront/src/lib/checkout/validate-checkout-payment.ts` | 匯款時**不驗卡欄** |

🔵 **`packages/` 一支都不動** —— 段 1-B 已經把 `paymentChannel` 一路接到 RPC 了。

---

## 2. 🔴 f0 要求的第①格:那 6 段驗證「一行都不動」**要怎麼證**

> 「我沒動它」不算證。

```
✅ 驗法 = 一發突變, 而它要【兩條路都紅】:
   拿掉共用段其中一段(例:agreed 那一格)
   ⇒ 刷卡那條的測試必須紅  ∧  匯款那條的測試必須紅
   ⇒ 🛑 只有一邊紅 ⇒ 那不是共用, 那是【位置上的共用】
🟢 而正對照:不突變時兩條路都綠(否則紅是別的原因)
```
📌 **⇒ 這一格寫進驗收條件, 不是寫進「我會注意」。**

---

## 3. 🔴 f0 要求的第②格:匯款那條**回傳什麼形狀**

```
🛑 不能回扣款結果 —— 沒有扣款
🛑 不能沿用 { ok: true } —— 那是 paid, client :261 會送他去【完成頁】
🛑 不能掉進 payment: 'unknown' 那種死路畫面
```
✅ **新增一個頂層變體, 與 `redirect` 平行**:
```ts
| { pendingTransfer: true; displayId: string }
```
🔵 **為什麼是頂層而不是 `payment` 的一個 case**:
`payment` 那個 union 的每一格都是**扣款的結果**, 而這一格**沒有扣款發生**。
放進去會讓 `satisfies never` 那道窮舉守門**替一個不是扣款結果的東西背書**。

🔵 **client 判斷順序**:`redirect` → **`pendingTransfer`** → `ok` → `switch(payment)`。
   ⇒ 排在 `ok` **之前**, 否則 `'ok' in res` 的既有分支會先吃掉它。

### 🎯 而**這一格就是段 1 與段 3 的交界**, 畫在這裡
```
段 1(本片)負責:把客人送到【那一頁】, 並帶著單號
段 3      負責:那一頁上【印什麼】(中國信託 / 城北分行 / 派達 / 帳號 / 備註填單號 / 期限)
⇒ 🔴 本片【不】印帳號 —— 而本片要保證那一頁【拿得到單號】, 否則段 3 印不出「備註填訂單編號」
```

---

## 4. 🔴 f0 要求的第③格:零元單 / 券 / 儲值金,匯款走不走得到

✅ **答案:走不到 —— 而它們今天在顧客站這條路【本來就不存在】。**
```
🔬 `placeOrderInput`(:282-317)逐欄:lines / addressId / shippingMethod / invoice /
   cartSessionId / paymentChannel / termsVersion / clientIp / clientUserAgent / notificationEmail
   ⇒ 🛑 **沒有 couponCode · 沒有 wallet · 沒有零元分支**
🔬 而 `coupon` 在本檔的唯一命中是 :424 的一行【註解】(列 create_order 參數名)
   ⇒ 顧客站從來沒有送過 p_coupon_code
⚠️ **訂正射程(自審抓到)**:`create_order` 這支函式**本身是收券的**
   —— 我的 A migration 逐字帶著 `p_coupon_code text DEFAULT NULL::text`
   (`20260904020000:110`), 而 2026-09-01 有三支券/零元的 migration。
   🎯 **⇒ 所以正確的說法是「顧客站【沒有送】」, 不是「這個系統沒有券」。**
   🛑 兩者差很多:前者是本片射程, 後者會是一句假話。
```
📌 **⇒ 所以本片不會「讓匯款走進那些分支」—— 那些分支在這條路上不存在。**
⚠️ **射程**:這只答顧客站。**後台 `admin_create_manual_order` 那條路沒有量**, 不在本片。

---

## 5. 🔴 鐵則 1:稿上那一格,逐字

`design-reference/components/CheckoutPage.jsx:427-436`:
```jsx
<label className={`co-pay ${paymentMethod === 'atm' ? 'is-on' : ''}`}>
  <input type="radio" name="pay" checked={paymentMethod === 'atm'}
    onChange={() => setPaymentMethod('atm')} />
  <span className="co-pay-radio"/>
  <div className="co-pay-body">
    <div className="co-pay-label">ATM 轉帳</div>
    <div className="co-pay-desc">下單後 3 個工作天內未繳款,訂單自動取消</div>
  </div>
</label>
```

### 🔴🔴 而稿與 Sean 的拍板【衝突】, 而這是本 plan 唯一要他點頭的一格
```
稿逐字   :「下單後 3 個工作天內未繳款,訂單自動取消」
Sean 拍板:「乙 5天」(2026-09-03 本人打字)+ 現金「甲 跟匯款一樣 5 天」
🔬 而碼那一半【已經是 5 天】:20260903080000 migration 逐字 interval '5 days'
```
### ✅ 而它**不是**「授權覆蓋」—— Sean 明示要改稿(f0 2026-09-04 裁, 附原話)
```
🔬 Sean 2026-09-04 原話逐字:「**A: 甲 5 天(改稿上那句)**」
⇒ 🎯 **⇒ 括號裡那四個字就是授權** —— 他不是「批准 5 天而稿留著」, 他說**去改稿**。
```
🔵 **⇒ 所以這不是一筆 manifest 偏離, 是一件【要有人去改 OD 稿】的事。**
🔴 **⇒ 而【不是我去改】** —— 那是 Design 那條線 ⇒ ✅ 本片**落一列板子給那條線**, 元件照 5 天寫。
🛑 **⇒ 而「3 個工作天 → 5 天」不是四捨五入**:工作天遇週末會比 5 天長, 兩者**不等價**
   ⇒ 📌 **⇒ 而正因為不等價, 稿留著那句就是一個【會誤導的字面】, 不只是舊。**

---

## 6. 預期影響面

```
✅ 刷卡那條路:一個字不動(分岔在 prime 之前, 刷卡走原路)
🔴 而「不動」要用 §2 那發突變證, 不是用宣稱
🔵 DB:零改動(段 1-A 已把欄位與函式做好)
🔵 後台:零改動(它讀 payment_channel 的路早就在)
⚠️ 而**匯款單建出來之後**, 既有的 expire sweeper 會用 5 天去掃它(20260903080000)⇒ 那是**要的**
```

---

## 7. Rollback

```
① 本片全是 TS ⇒ revert 那顆 commit 即可, 零 DB 動作
② 而**若已有客人建了匯款單**:revert 之後那些單【仍在 DB 裡】、仍是 payment_channel='bank_transfer'
   ⇒ 🔴 它們不會消失, 而顧客站會變回「選不了匯款」⇒ 那些單靠後台處理
   ⇒ ⇒ 📌 **⇒ 所以 rollback 的真正成本不是碼, 是【已經匯了款的客人】** ⇒ 上線後 revert 要先問 Sean
③ 段 1-A 的 migration **不 rollback**(它是 forward-only, 且舊簽名還在 ⇒ 刷卡不受影響)
```

---

## 8. 驗收條件(逐條 yes/no)

```
□ 1. 選匯款 ⇒ 建得出單, 而 payment_channel = 'bank_transfer'(走真的那條路, 不是直呼函式)
□ 2. 選匯款 ⇒ 零 charge、零 confirm、零 payment_charge_attempts
□ 3. 選匯款 ⇒ 不被 prime 那一格擋(而【沒選匯款又沒 prime】仍要被擋 = 負對照)
□ 4. 選刷卡 ⇒ 行為與今天逐字相同(既有測試零修改通過)
□ 5. 🔴 突變:拿掉共用驗證任一段 ⇒ 【兩條路都紅】
□ 6. client 收到 pendingTransfer ⇒ 不進完成頁、不清購物車判斷要明寫
□ 7. 三綠(TURBO_FORCE=1)+ 連跑兩發比四個數
□ 8. manifest 記下「3 個工作天 → 5 天」那筆授權覆蓋
```

---

## 8b. 🔴🔴 而我自己審 plan 時抓到一個【它原本沒寫】的洞:**匯款沒有重複下單防護**

```
🔬 刷卡那條的去重住在 `begin_charge_attempt` 的 advisory lock 裡
⇒ 🛑 **而匯款【永遠走不到那裡】**(它不 charge)
🔬 而 preflightReleaseSibling 只在 `if (threeDSConfig)` 底下跑 ⇒ 匯款也走不到
🔬 而 `cart_session_id` 在 DB 層**沒有 UNIQUE 約束** —— 當場量:
   `CREATE UNIQUE INDEX .*cart_session_id` / `UNIQUE (cart_session_id` ⇒ **0**
   🟢 正對照 `CREATE UNIQUE INDEX` 全庫 ⇒ **72** ⇒ 尺會動, 那個 0 有意義
   ⚠️ **而第一把尺是錯的**:`grep cart_session_id | grep -i unique` ⇒ **9**,
      而**九個全是註解**(逐字「其他 unique violation(例如 cart_session_id 去重…」)
      ⇒ 📌 差點把一個假宣稱寫進 plan。
```
🎯 **⇒ 客人連按兩下 ⇒ 兩張匯款單、兩個不同單號。**
⇒ ⇒ 🔵 **錢不會被扣兩次**(沒有扣款)⇒ 所以它不是鐵則 12 的「重複扣款」
⇒ ⇒ 🛑 **而它更難查**:客人**匯一筆款、備註填了其中一個單號**
   ⇒ 另一張單五天後自動取消 ⇒ 而**客服看到的是「他下了兩單只匯一筆」**

### ⇒ 而我不自己拍這一格, 因為兩個修法的代價不同族
```
甲 只靠 client 鎖按鈕(hook 今天就會鎖)
   ✅ 零 DB 改動、零風險  🔴 而**重新整理 / 開兩個分頁就繞過去了**
乙 建單前用 cart_session_id 反查「這個購物車已經有未付款的匯款單了嗎」
   ✅ 真的擋得住  🔴 而它是**一次 DB 讀 + 一個新的 own-only 查詢**⇒ 要新函式或新 RPC 參數
```
### ✅ f0 2026-09-04 裁:**走甲, 而配一發量測 + 一列板**
```
🔵 ① 段 1 走**甲**(client 鎖按鈕, 零 DB 改動)—— 而 hook 今天就會鎖
🔴 ② 而**量那一格**, 它便宜, 而它是**段 3 的第一格**(不另外開一趟):
   🎯 客人結完帳、關掉、再回到結帳頁(同一個購物車)⇒ **他看到什麼?**
   · 看到那張未付款的單 ⇒ ✅ **甲夠了** ⇒ 乙不做
   · 又給他一張新的     ⇒ 🔴 **乙是必要的** ⇒ 那時再開
🔵 ③ 落一列板(見下)
```
🛑 **而不選乙的理由不是它不對, 是【我們還不知道需不需要它】** ——
   那個動線沒有人量過 ⇒ 📌 **現在做乙, 可能是在解一個不存在的問題。**

---

## 9. 我沒查的(明寫, 不假裝涵蓋)

```
🛑 客人匯款【之後】誰把單子改成已付款 —— 不在本片(那是對帳, 後台那半)
🛑 後台 admin_create_manual_order 那條路 —— 沒量
🛑 「選了匯款當下就看到帳號」那一頁長什麼樣 —— 段 3, 而它需要 Design
🛑 現金(cash)那條 —— DB 認, 而顧客站要不要開,沒有人拍過
```
