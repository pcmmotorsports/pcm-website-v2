# TapPay 沙盒刷卡 · 訂單流水帳(2026-08-18 夜,G3)

> 🔴 **這份檔的存在理由 = Sean 授權的條件。** 他逐字:
> 「可以 —— 直接刷，窗會當場記下訂單編號讓你事後找得到」(經 MAIN 轉述)
> ⇒ **這些單會真的躺在正式站後台**,他事後要找得到 ⇒ 每刷一筆【當場】寫進這裡,不是事後補。
> ⚠️ 授權來源 = **MAIN 轉述的 Sean 原句**,我沒有直接看到他打字。引用時帶上這個限定。

## 環境(每次開刷前重記一次,因為它會變)
```
TAPPAY_ENV                = sandbox      （鍵名量到;值由 Sean 設定,我沒看)
NEXT_PUBLIC_TAPPAY_ENV    = sandbox      （同上;Sean 2026-08-18 改好)
TAPPAY_PARTNER_KEY / MERCHANT_ID         Sean 逐字「沙盒跟正式都用一樣的」
帳本 DB                   = 🔴 正式站     bash scripts/which-db-am-i-pointed-at.sh ⇒ 紅
用的卡                    = AMEX 3454 5465 4604 563 / CVV 1234 / 到期日填未來任一年月
                            （來源 docs/reference/tappay-sandbox-test-cards.md)
為什麼是 AMEX             = Sean 逐字「AMEX 這個才有 3D 驗證，之前是很多次了」
```

## 流水帳

| # | 時間 | 卡 | 走到哪 | 訂單編號 | payment_status | 有沒有寄信 | 備註 |
|---|---|---|---|---|---|---|---|
| 1 | 2026-08-18 23:44:48 CST | AMEX 3454…563 | **刷不出去**:UI 出現「付款失敗,請稍後再試或聯繫客服 LINE」 | 🔴 **`WCYCW5`**(訂單有建、款沒收) | 未收未定(unpaid) | 未觀察 | 沒有走到 3DS。零扣款(沙盒)。**這是一張孤兒未付款單,躺在正式站** |

## 第 1 筆:量到什麼(2026-08-18 23:44:48 → 23:54 CST,G3)

**結論一句**:**訂單建出來了、款一毛沒收、沒有走到 3DS**,而**失敗原因看不到**——那是刻意的(charge-actions.ts:339-356 的 generic catch 逐字「零原始 error 透傳」)。

### 走到哪(逐格,附證據)
```
註冊測試帳號   ✅ g3-sandbox-test@pcmmotorsports.com(🔴 真的建在正式站 auth,Sean 事後要刪就刪這個)
                  同時建了一筆收件地址(addAddressAction,dev log 有)
加購物車       ✅ cncracing-pr333 下鏈條蓋 黑色 ×1
結帳頁         ✅ 沒有被踢去 /login(登入態成立)
TapPay 欄位    ✅ 三個 iframe 都出得來、填得進去(卡號/有效期/CVV)
按下確認付款   🔴 UI 逐字:「付款失敗,請稍後再試或聯繫客服 LINE」
3DS            ❌ 完全沒跳。沒有離開結帳頁。
```

### 🔴 訂單編號(Sean 授權的條件本身)
```
單號        WCYCW5
orders.id   52d1f82f-89fc-4785-9c4d-613c1f51c814
建立時間    2026-08-18 23:45
客戶        G3 沙盒測試
內容        下鏈條蓋 PR333-PR333B ×1
總計/已收   NT$ 1,500 / NT$ 0
付款狀態    待付款(unpaid)
後台看得到嗎  🔴 **預設看不到** —— 要在 /orders 打開「顯示刷卡未付款(預設隱藏)」才會出現
```
⇒ **這是一張孤兒未付款單,現在躺在正式站。** 它是不是要清、由 Sean 決定(鐵則 12①,我不順手清)。

### 🔴 我自己踩到的一個坑,寫下來免得下一個人重踩
```
顧客站 /account 的「訂單記錄」顯示【目前尚無訂單紀錄】、TOTAL ORDERS 0
—— 而單其實已經建好了。
原因:SupabaseOrderAdapter.listOrders 有一道 `.neq('payment_status','unpaid')`
      (packages/adapters/src/supabase/SupabaseOrderAdapter.ts,#249 治標,藏放棄付款的孤兒單)
⇒ **「客人端看不到單」與「單不存在」在那個畫面上是同一句話。**
   我一度照它下了「沒有建單」的結論,是錯的。要看真相只能開後台並打開那個開關。
```

### 已經【排除】的原因(每條都是量到的,不是推的)
```
① 不是憑證 —— TapPay 沙盒端點實測收下了本機這組 partner_key + merchant_id
   打法:POST https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime,故意餵一個假 prime
   回應:{'status': 121, 'msg': 'Invalid arguments : prime'}
   ⇒ 它只嫌 prime 假,**沒有嫌 key/merchant** ⇒ 過了認證那一關。
   🔴 這條同時關掉了兩份既有檔標的「憑證是第一嫌疑」:
      docs/reference/tappay-sandbox-test-cards.md 與 G3-015 STOP ①。Sean 那句
      「沙盒跟正式都用一樣的」在沙盒端**成立**。
② 不是 create_order 8/9 參簽章不符 —— 那條路會 console.error 印 PGRST202 / 42883
   (charge-actions.ts:347-351),dev log 全程**沒有那一行**。
③ 不是 findTotal 回 null —— 後台訂單詳情逐字「總計 NT$ 1,500」⇒ orders.total 有值。
④ 不是 3DS 設定壞掉 —— resolveThreeDSConfig() 若不合會在 **placeOrder 之前** throw
   (three-ds-urls.ts:74 註解 + charge-actions.ts:208-210)⇒ 單建得出來就代表它過了。
⑤ 不是 cardholder 被擋 —— 那條會 console.error '[checkout] cardholder blocked'
   (charge-actions.ts:204),dev log 沒有。
⑥ 不是連不到帳本 DB —— PAYMENT_CONFIRMER_DB_URL 的 host 完整比對
   POOLER_HOST_RE(`^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$`)符合,TCP 也連得上。
⑦ 不是 127.0.0.1 那個坑 —— 全程用 http://localhost:3020;
   hydration 探針量到 **82/82**(掃到 82 個 input/button/a,82 個帶 __reactFiber)。
```

### 🔴 所以卡在哪(誠實版)
```
剩下的可能只有兩格:**TapPay initiatePayment 那一發**,或 **charge attempts.begin 那一發**。
而**我看不到是哪一格,也看不到錯誤內容** —— 因為 charge-actions.ts:355 逐字
「Q2=A 通用字面、零原始 error 透傳」,那是刻意的設計,不是 bug。
```
**要往下走,只有三條路(都需要別人點頭,不是我可以自己決定的)**:
```
甲 給我一次正式庫的唯讀查詢(看 charge_attempts / orders 那筆的 raw 欄位)
   —— 我這一輪試著跑 scripts/verify-create-order-9param.sh 時被 harness 的權限守門擋下,沒有繞。
乙 允許在 charge-actions.ts 的 catch 裡【暫時】多印一行錯誤碼(改 app code ⇒ 鐵則 8/12,要批)
丙 把 TAPPAY_3DS_ENABLED 暫時關掉再刷一次,看同步路徑會不會過
   —— 這會【改 .env.local】,而主視窗這一輪明文禁止改 .env* ⇒ 我沒有做。
```
⚠️ 三條我都**沒有**自己走。這一輪停在這裡。

### 🔴 這一輪【沒有】答到的那件事
```
主視窗交辦的最終目的是「**用這批未推的 dev 再刷一次**,那才是可不可以推的依據」。
本輪連第一筆都沒刷成功 ⇒ **那個問題完全沒有被回答**。
⚠️ 不要把本檔讀成「未推的 dev 驗過了」——它連基線都還沒有。
```

## 已知天花板(每次報告都要帶,不因為刷成功而拿掉)
```
· 3DS 態 -1 ERROR 在沙盒【構造不出來】—— 這不是我這一班量的,出處是 backlog #353
  數法(可重跑):`grep -n '^### #353' docs/phase-1-backlog.md` 再開檔讀那條的效度段
  ⇒ 「3DS 每一種狀態都驗過」這句話在沙盒裡講不出來
· 沙盒證明的是「我們送出去的東西對不對」,不證明「真的發卡行會怎麼回」
· 持卡人 email ≤40 字元硬限制 ⇒ 失敗可能跟 3DS 無關,是踩到這條
```
