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

## 🔴🔴 第 2 輪(丁:去看瀏覽器)—— 結論翻了一半:**TapPay 那側是好的,壞的是我們自己**

時間 2026-08-19 00:00:49 → 00:04:01 CST(兩端都是 `date` 實跑值)。

### 量到什麼(三發,每發都可重跑)

**發 1 · 我們自己的結帳,第 2 筆**(00:00:49 按下確認付款)
```
UI            仍是「付款失敗,請稍後再試或聯繫客服 LINE」,3DS 沒跳
dev log       chargePaymentAction 1933ms、無任何 console.error
🔴 瀏覽器 Network 抓到 getPrime 那一發:
   POST https://js.tappaysdk.com/payment/tpdirect/sandbox/getprime  ⇒ 200
   response body 逐字:{"status":0,"msg":"Success", ... "card":{"prime":"77d864…","lastfour":"4563"},
                        "cardinfo":{"bincode":"345454","type":5,"country":"UNITED STATES"}}
⇒ **前端 SDK 完全正常、prime 拿到了。** 失敗在 server action 那半。
```

**發 2 · 拿那把 prime 自己去打 TapPay**(想分辨「server 有沒有用掉它」)
```
回應:{'status': 91, 'msg': 'Expired prime'}
🔴 **這一發【沒有判別力】,不要引用它** —— prime 的壽命約 90 秒,而我隔了兩分多鐘才打。
   「被 server 用掉」與「單純過期」在這個輸出上長得一樣。我換了打法(發 3)。
```

**發 3 · 繞過我們的 code,直接拿一把新 prime 打 TapPay 沙盒**(00:03 前後,90 秒內)
```
取 prime:在結帳頁的瀏覽器裡直接叫 window.TPDirect.card.getPrime()
         ⇒ status 0 / prime 29f95f9b… / lastfour 4563
         🔴 **這條路不會建單** —— 所以這一發【沒有】再產生孤兒訂單。
打 TapPay:POST https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime
         帶本機 .env.local 的 partner_key + merchant_id、amount 1500、
         three_domain_secure:true、result_url 用 NEXT_PUBLIC_SITE_URL 那個 base
回應逐字:
   status          0
   msg             Success
   rec_trade_id    D202608199JvV9j
   payment_url     https://sandbox-redirect.tappaysdk.com/redirect/4c05d5b108ee…
```

### 🔴 所以結論是
```
✅ TapPay 那一側【完全正常】:憑證對、AMEX 收、3DS 開得起來(payment_url 回來了)
✅ 前端 SDK【完全正常】:getPrime status 0
🔴 ⇒ 壞的是【我們自己的 server 端】,而且是在 TapPay 之【前】那一步
   剩下最可能的一格:charge attempts 的 begin
   = PgChargeAttemptAdapter.begin() 走直連 Postgres 打 `SELECT public.begin_charge_attempt($1::uuid)`
     (`packages/adapters/src/payment/PgChargeAttemptAdapter.ts:64-66`)
```
⚠️ **「最可能」不是「量到」** —— 我沒有正式庫的查詢權限,**沒有直接證據指認 begin 這一格**。
   要坐實它,需要主視窗送 Sean 的那條「正式庫唯讀查詢」(甲)。

### 順帶關掉的一格(Sean 那句得到獨立佐證)
```
Sean 逐字「AMEX 這個才有 3D 驗證,之前是很多次了」
⇒ 發 3 拿 AMEX 打 three_domain_secure:true,TapPay **真的回了 payment_url**(3DS 轉導頁)
⇒ 官方文件把 3DS 註記掛在 MasterCard 那一列而 AMEX 那列沒寫 —— **那個「沒寫」確實不代表不會觸發**。
⚠️ 射程限定:這證明「**AMEX 在這個沙盒商戶上叫得出 3DS**」,**不**證明我們的 code 走得到那一步
   (我們的 code 根本還沒送出去就失敗了)。
```

### 🔴 這一輪在 TapPay 沙盒留下的東西(不是訂單,但要記)
```
rec_trade_id  D202608199JvV9j   NT$ 1,500(沙盒假錢)/ 3DS 待轉導、我沒有去點那個 payment_url
🔴 它【不對應任何 PCM 訂單】—— 是我為了診斷繞過 code 打的,PCM DB 裡沒有它的對應列。
   對帳時看到這一筆不要找對應訂單,找不到是正常的。
```

### 訂單流水帳補記
```
第 2 筆結帳(00:00:49)一樣失敗,**而它【真的又建了一張孤兒單】**。
```
量法(可重跑):後台 /orders?show_unpaid_card=1&date_from=2026-08-18&date_to=2026-08-19
              ⇒ 共 2 筆,兩筆都掛在「G3 沙盒測試」名下
  WCYCW5  08/18  (第 1 筆)
  Z6QDV9  08/19  (第 2 筆)
```
🔴 **一次失敗的刷卡 = 一張客人看不到的孤兒單。** 客人重試 N 次就是 N 張。
   這正是下面那條 backlog 的「不修未來會痛在哪」。
```

## 🔴🔴 第 3 輪:「最可能」升級成「量到」—— 我們的 code **從來沒有把東西送到 TapPay**

時間 2026-08-19 00:0x CST。**本輪零刷卡、零新訂單** —— 用的是 TapPay 的查詢 API 與 repo 閱讀。

### 決定性那一發:問 TapPay「這段時間你收到過什麼」
```
打法(可重跑):POST https://sandbox.tappaysdk.com/tpc/transaction/query
              partner_key 取自 .env.local(值不印),時窗 2026-08-18 23:30 → 08-19 00:15
回應:number_of_transactions = 1
      唯一那筆 = D202608199JvV9j / 1500 / details "g3 probe amex 3ds"
```
🔴 **那一筆是我第 2 輪【自己繞過 code】打的那一發,不是我們的結帳打的。**
⇒ 我們的兩次結帳(23:44:48、00:00:49)**在 TapPay 那邊一筆紀錄都沒有**。

**這一發為什麼有判別力(兩個世界會印不同的東西)**:
```
· 正向對照【自帶】:我自己那筆真的被列出來了 ⇒ 這支查詢【看得見】這個時窗的交易。
  ⇒ 「查無」不是因為尺壞掉。(這正是「0 命中要附分母」那條要的東西:分母=1,而那 1 是我放進去的。)
· 若我們的 code 有送出去而 TapPay 拒絕 ⇒ 仍會有一筆 record(狀態不同)⇒ 也會被列出來。
  ⇒ 「沒送出去」與「送了被拒」在這支查詢上【長得不一樣】。
```

### 第二發:把 `init_failed` 這條岔路排除掉(靠文案字面,不靠猜)
```
initiate-payment.ts:93 的 recordInitiationBankTxn 失敗 ⇒ 回 init_failed(不 throw)
charge-actions.ts:518-520 把 init_failed 映成 MSG.chargeFailedWait
MSG.chargeFailedWait 逐字(charge-actions.ts:86)=「付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試」
而我們畫面上看到的逐字是 MSG.generic(charge-actions.ts:84)=「付款失敗,請稍後再試或聯繫客服 LINE」
⇒ 兩句不同 ⇒ **不是 init_failed,是走到了外層 catch(charge-actions.ts:339)= 有東西 throw 了。**
```

### ⇒ 收斂結果
```
在 TapPay 被呼叫(packages/use-cases/src/initiate-payment.ts:103)之前,會 throw 的只剩一格:
   🔴 attempts.begin(orderId)   packages/use-cases/src/initiate-payment.ts:55
      = PgChargeAttemptAdapter.ts:64-66 的 `SELECT public.begin_charge_attempt($1::uuid)`
```
**這不再是「最可能」,是把其他每一格都用有判別力的檢查關掉之後剩下的那一格。**

### 從 repo 能排除的(全部讀檔,不是猜)
```
✅ 連線角色對:PAYMENT_CONFIRMER_DB_URL 的 user 屬 payment_confirmer 系
   (分類法:只印分類、不印值),而 GRANT EXECUTE 就是給它
   出處 supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql:427(REVOKE)/:430(GRANT)
✅ 那支函式是 SECURITY DEFINER + SET search_path=''(20260809210000:63-67)
   ⇒ 讀 orders / FOR UPDATE 用的是 definer 的權限 ⇒ **不是表權限問題**
✅ ACL 在 apply 當下被斷言過:同檔 :288 有一條 RAISE,除非 EXECUTE grantee 恰為
   payment_confirmer + postgres 且零 GRANT OPTION 否則拒繼續;而它在 supabase/APPLIED.tsv 有列
   ⇒ apply 成功 = 那條斷言當時通過
✅ cart_session_id 不可能是 null:create_order 對它 fail-closed
   (20260730120100:231-233 逐字 RAISE '缺 cart_session_id'),而單建出來了
```

### 🔴 剩下要 DB 才答得出來的(給拿到唯讀權限的人:候選就這四條)
`begin_charge_attempt` 裡會 RAISE 的位置,逐條附行號(檔=`supabase/migrations/20260809210000_m4b_lifecycle_l4a1_begin_in_flight_order_id.sql`):
```
:84-86   隔離閘 —— current_setting('transaction_isolation') <> 'read committed' ⇒ ERRCODE P8C01
         🔴 這條最值得先看:它跟【連線走哪個 pooler / 有沒有設 default_transaction_isolation】有關,
            而那是【本機這條連線特有】的東西,正式站不一定一樣。
:94-96   訂單查無(WHERE id = p_order_id FOR UPDATE ⇒ NOT FOUND)
:101-104 取消守門(cancelled_at 非空 或 order_cancellations 有列)
:107-109 cart_session_id IS NULL(已從 create_order 那側排除)
```
**一次查詢就能砍一半**(主視窗已把這個問法送 Sean):
```
payment_charge_attempts 裡有沒有 WCYCW5 / Z6QDV9 這兩張單的列?
  有 ⇒ begin 過了、壞在更後面(而 TapPay 沒收到 ⇒ 更奇怪,要重看)
  沒 ⇒ 就是 begin,再照上面四條分。
```
⚠️ 我**沒有**正式庫查詢權限;試跑 `scripts/verify-create-order-9param.sh` 時被 harness 權限守門擋下,**沒有繞**。

### 本輪的邊界(主視窗 00:0x 裁的,硬的)
```
🔴 停止再刷卡。每測一次多一張孤兒單在正式站,而已經知道刷不過 ⇒ 再刷不會多知道任何事。
現有留痕全部不動:WCYCW5 / Z6QDV9 / 測試帳號 / 那筆地址 / TapPay 沙盒 D202608199JvV9j
```

## 已知天花板(每次報告都要帶,不因為刷成功而拿掉)
```
· 3DS 態 -1 ERROR 在沙盒【構造不出來】—— 這不是我這一班量的,出處是 backlog #353
  數法(可重跑):`grep -n '^### #353' docs/phase-1-backlog.md` 再開檔讀那條的效度段
  ⇒ 「3DS 每一種狀態都驗過」這句話在沙盒裡講不出來
· 沙盒證明的是「我們送出去的東西對不對」,不證明「真的發卡行會怎麼回」
· 持卡人 email ≤40 字元硬限制 ⇒ 失敗可能跟 3DS 無關,是踩到這條
```
