# TapPay 金流整合參考(前台 SDK + 後端 REST API + 官方資源盤點)

> **用途**:PCM 網站 TapPay 金流線(M-3)的權威參考,供 S3(sandbox 3DS 測試)/ S4(正式金鑰)/ S5(1 元真刷)/ S6(退款)逐片使用。避免重造輪子或走錯路。
> **建立**:2026-07-23。**來源**:官方文件 `docs.tappaysdk.com`(前台 tutorial/en/home.html、後端 tutorial/zh/back.html、reference.html)+ 官方 GitHub `github.com/orgs/tappay`(WebFetch DOM 逐字核對)+ Sean 提供的前台 SDK 文件。
> **紀律**:enum/欄位/端點皆對照官方 DOM 逐字;查無的(如 webhook 簽章)明標「官方無」、不杜撰。金額一律整數(分),不用 float。
> 相關:上位 plan `docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md`;金流不變量見該檔 §2。

---

## 0. 一句話結論

**TapPay 沒有活躍維護的官方 Node/TS server SDK**(唯一候選 `tappay-nodejs` 官方明標 Deprecated、且不含 3DS)→ **PCM 自寫 `TapPayChargeAdapter` 的方向正確、繼續自寫**。~~經逐字核對,PCM 現有 Record Query / webhook 實作與官方文件一致、無落差~~ 🔴 **2026-07-30 更正(backlog #301)**:這句在 Record Query 上**是錯的** —— `amount` / `original_amount` / 交易時間欄三處與官方及實回應不符,已修(見 §2.2)。webhook 部分未發現落差。**另一個缺口 = `refund()` 未實作**(現 `throw`),規格見 §2.3。

---

## 1. 前台 Web SDK(TPDirect,PCM 已用 v5.1.0)

### 1.1 載入 + SetupSDK
```html
<script src="https://js.tappaysdk.com/tpdirect/v5.1.0"></script>
<script> TPDirect.setupSDK(APP_ID, 'APP_KEY', 'sandbox') </script>
```
- `appID` / `appKey`:見 TapPay 後台。
- `serverType`:測試 = `'sandbox'`;上線 = `'production'`。🔴 **S4 切正式時,前台 `NEXT_PUBLIC_TAPPAY_ENV` 與後端 `TAPPAY_ENV` 各自獨立讀、兩處都要換**(見上位 plan §3-b)。

### 1.2 CardView + card.setup
```html
<div id="cardview-container"></div>
```
```js
TPDirect.card.setup('#cardview-container', defaultCardViewStyle, { isUsedCcv: true })
```
- `element`:CSS selector 或 DOM element。
- `style`:`color / fontSize / lineHeight / fontWeight / errorColor / placeholderColor`。
- `config.isUsedCcv`:CCV 有輸入才驗;不想顯示 CCV 欄位則不設 ccv object 即可(`isUsedCcv:false`)。

### 1.3 onUpdate(callback) — 卡片輸入狀態
Callback 物件欄位:
| 欄位 | 內容 |
|---|---|
| `cardType` (String) | `'mastercard'` / `'visa'` / `'jcb'` / `'amex'` / `'unknown'` |
| `canGetPrime` (boolean) | true = 全欄位正確、可呼叫 getPrime |
| `hasError` (boolean) | true = 任一欄位有錯 |
| `status.number` / `status.expiry` / `status.ccv` (int) | 各欄 status code(見官方 reference) |

### 1.4 getPrime(callback) — 取 prime 字串
```js
TPDirect.card.getPrime(function (result) {
  if (result.status !== 0) { console.error('getPrime error'); return }
  var prime = result.card.prime   // 傳後端呼叫 Pay by Prime
})
```
`result.card` 欄位:
| 欄位 | 類別(Max) | 內容 |
|---|---|---|
| `prime` | String(64) | Pay by Prime 交易用 |
| `bincode` | String(6) | 卡前六碼 |
| `lastfour` | String(4) | 卡後四碼 |
| `issuer` | String | 發卡銀行 |
| `funding` | int | 0=信用卡 / 1=簽帳卡 / 2=預付卡 |
| `type` | int | 1=VISA / 2=MasterCard / 3=JCB / 4=UnionPay / 5=AMEX |
| `level` | String | 卡片等級 |
| `country` / `countrycode` | String | 發卡行國家 / 國碼 |
| `card_identifier` | String | 信用卡識別碼(每張卡對一組) |

### 1.5 🔴 Sandbox 測試卡(固定)
`4242 4242 4242 4242`,到期 `01/23`(即 `01/(當年+)`,官方範例寫 01/23),CCV `123`。測試環境**一律用此卡**。

### 1.6 對照 PCM
- 前台掛載 = `apps/storefront/src/components/checkout/TapPayCardFields.tsx`(+ `useTapPayCard`);`canGetPrime` / `getPrime` 流程已接。
- 付款鏈:`confirmProceedIfInflight → getPrime → charge.submit`(server action `charge-actions.ts`)。

---

## 2. 後端 REST API(對照 zh/back.html + reference.html 逐字)

> 共通:POST + `Content-Type: application/json`;header 帶 `x-api-key`(= `partner_key`)。Sandbox 主機 `sandbox.tappaysdk.com`、正式 `prod.tappaysdk.com`。

### 2.1 Pay by Prime(charge)
PCM **已自寫實作**(`packages/adapters/src/tappay/TapPayChargeAdapter.ts`)、走**強制 3DS**(redirect 型);端點/欄位以 adapter 為準。3DS 交易**必帶 `backend_notify_url`**(見 §2.4)。本參考不重述 charge 欄位,聚焦缺口(refund)與對帳(record query)。

### 2.2 Record Query API — `/tpc/transaction/query`(sweeper 對帳用,已核對一致)
- 必要:`partner_key`。選填:`records_per_page`(預設 50、上限 200)、`page`(預設 0)、`filters`(JSONObject)、`order_by`(預設 time 遞減)。
- `filters` 可用:`time`(起訖最大 90 天)/ `amount` / `cardholder`(phone·name·email)/ `merchant_id` / `record_status` / `rec_trade_id` / `order_number` / `bank_transaction_id` / `auth_code` / `currency` / `tsp` / `card_identifier`。
- 回應:`status`(**0=成功且有更多分頁 / 2=成功且無更多分頁**,兩者皆「查詢成功」≠交易狀態)、`msg`、`records_per_page`、`page`、`total_page_count`、`number_of_transactions`、`trade_records`(JSONArray)。
- 🔴 **`record_status` enum(7 值、逐字)**:`-1` ERROR / `0` AUTH(已授權未請款)/ `1` OK(完成)/ `2` PARTIALREFUNDED / `3` REFUNDED / `4` PENDING / `5` CANCEL。
- 🔴 **`trade_records[]` 金額三欄與時間欄(官方逐字、2026-07-30 backlog #301 重查)**:
  - `amount` int —「交易金額,**會因退款而減少**」⇒ 全額退款後為 **0**,**不是**授權金額。
  - `original_amount` int —「一筆交易的原始金額 **此金額不會因款項被退款而受影響**」⇒ 對帳要比「本來收多少」一律用這欄。
  - `refunded_amount` int —「**退款金額**」(已退多少)。全額退款時它 = `original_amount`、`amount` = 0(2026-07-30 實測 0102/0104 的 `amount`=0、`refunded_amount`=101/1180、`record_status`=3、`is_captured`=false **是觀察值**;🔴 `original_amount` 與 `time` 的**值當時未被保存**,只確認鍵存在)。
  - `time` long —「交易時間,**單位為毫秒**」= 本 API 的交易時間欄。
  - 🔴 **`transaction_time_millis` 不屬於本 API** —— 官方 reference 該詞條的 Related topics 只列 payByPrime / payByToken;pay-by-prime 回應與 backend notify payload 確有此欄(PCM 那兩處用法正確),但 `trade_records` 沒有,正式商戶實回的 33 個鍵亦無。
- **PCM 對照(2026-07-30 更正)**:`record_status` 7 值 + top status 0/2 語意與官方逐字一致;🔴 **但金額/時間四欄一度不一致** —— 舊 `wire.ts` 把 `amount` 當授權金額、未解析 `original_amount`、且讀了不存在的 `transaction_time_millis`(⇒ `settleCharge` 弱識別時間窗恆 fail-closed)。已於 backlog #301 修正並補真實形狀 fixture 測試(`wire.test.ts`)。**此處不再宣稱「無落差」——落差要逐欄列、由測試背書。**
- **`settleCharge` 的 `record_status` 實際映射(2026-07-30 對程式碼實查更正;舊句「只在 −1/5 才 markFailed、其餘保留 pending」把 0/1 講錯了)**:`0` AUTH / `1` OK → **paid**(S1「授權即成立」)/ `-1` ERROR、`5` CANCEL → **markFailed 釋鎖** / `4` PENDING → pending / `2`、`3` 退款態 → pending + 告警(不自動放行)/ 未知碼 → pending。**且任何 terminal 前都要先過識別+金額閘**(#301 後:身分比 `original_amount`;**非退款態**另要求 `amount` 完好且 `refunded_amount` 為 0)。🔴 `amount + refunded_amount = original_amount` 這條等式是**從三欄語意推導**的、**官方欄位表沒有明文**,故不作為退款態的擋門(否則多次部分退款若回單次金額,合法紀錄會被擋在告警之前)。

### 2.3 🔴 Refund API — `/tpc/transaction/refund`(S6 目標;PCM 現為 stub)
- Sandbox `https://sandbox.tappaysdk.com/tpc/transaction/refund` / 正式 `https://prod.tappaysdk.com/tpc/transaction/refund`。
- **必要**:`partner_key`(String 64)、`rec_trade_id`(String 20,要退款的交易 id,自任一成功交易回應取得)。
- **選填**:
  - `amount`(int)— **不帶=全額退款;帶=部分退款**(非 TWD 幣別需兩位小數精度)。
  - `bank_refund_id`(String 20)— 商戶自訂退款識別碼,**不可重複**。
  - `additional_data`(JSONString 3000)、`merchandise_details`(JSONObject)。
- **回應**:`status`(0=成功)、`msg`、`refund_id`、`refund_amount`(int,非 TWD ×100)、`is_captured`(bool)、`bank_result_code`(String 40)、`bank_result_msg`(String 300)。
- 🔴 **關鍵注意**:
  - **部分退款支援**(官方原句「如果你有部分退款需求,必須呼叫此 API」),**但分期付款與 T2P 交易不支援部分退款**。
  - 建議 **timeout 30 秒**(避尖峰狀態不同步)。
  - 🔴 **退款「隔日」才真正生效** → 須用 Portal 或 Record API 覆核;**對帳/sweeper 邏輯若假設退款即時生效會踩雷**。
    - 🏁 **2026-08-14 加註(這句被誤讀過一次,差點擋掉一個正確的 UI 文案):這句講的是「錢的清算」,不是「Record 的反映」。**
      **Record 是當場就變的**,實測逐字:`docs/handoff/2026-08-03-day-refund-wire.md:473` 同一 session 20:0x 退 1 元後
      「事後 `record_status 1→2(PARTIALREFUNDED)`、`amount 6→5`、`refunded_amount 0→1`」;同檔 `:481-483`
      「`amount` 與 `refunded_amount` **在同一筆真資料上同時驗證**:6→5 與 0→1 各自對上」;
      §2.3a 的 08-01 序列也是同一場 probe 內「剩 4 送 5 → `10051`」⇒ TapPay 的餘額在同一 session 內已扣減。
      內部一致性佐證:本句下半自己寫「**須用 … Record API 覆核**」—— 若 Record 要隔日才反映,那句話會自相矛盾。
      ⚠️ **誠實邊界**:以上全是 **sandbox** —— 依據 = 本檔 **§2.3b 結論 7 第 ① 點**(現行 `:195-196`)逐字
      「正式商戶(非 sandbox)的請款時點與批次行為 …**不得寫進 UI 文案**」,以及 §2.3b **P6** 那格(現行 `:174`)
      逐字「中信批次時點,**sandbox 觀測值**、非正式商戶承諾」。
      (🔴 引段落名 + 行號,不只引行號:本註解第一版寫的 `:186-187` 是**我插入這段之前**量的,
       插入 9 行之後那個座標就指到別的東西了 —— D 窗審查抓到,同族第二次。)
      正式站目前只有 Sean 2026-08-14
      退兩筆真錢的**口述**正向實例(「這時候同時可以查 tappay 是否退款完成」),**我方未以 API 實測正式站**。
      ⇒ 給員工看的文案可以講「退款完成」,但**入帳時間只能講條件、不能講時長或時點**(依各家銀行而定)。
  - 銀行請款有時間限制,退款前應先確認交易狀態、避開請款處理中的時間窗。
  - Sandbox 可測(同一套 partner_key/merchant_id)。
#### 2.3a ✅ Sandbox 實測結論(2026-08-01 深夜,交易 `D202607314b3cIL`,本金 6 元)

**不是讀文件推論,是逐發打 API 打出來的**;腳本 `scripts/tappay-sandbox-refund-probe.py`。

| # | 動作 | API 回應 | 交易狀態變化 |
|---|---|---|---|
| 0 | `query` | `is_captured=True` / `record_status=1 (OK)` | `amount=6` `refunded_amount=0` |
| 1 | `refund 1` | `status=0 Success` | `record_status`→**2 (PARTIALREFUNDED)**、`amount=5`、`refunded=1` |
| 2 | `refund 1` | `status=0 Success`、`refund_id=DR20260801bHUZv8` | `amount=4`、`refunded=2` |
| 3 | `refund 5`(剩 4 ⇒ 超額) | **`status=10051`** `'Out of range : amount (refund amount must be less than or equal to remained amount)'` | **完全沒動**(`amount=4`、`refunded=2`) |

- ✅ **API 支援「多次」部分退款** —— 同一筆交易可反覆呼叫 refund,每次各自回一個 `refund_id`,
  `refunded_amount` 累加、`amount` 遞減,`record_status` 停在 `2 (PARTIALREFUNDED)`。
- ✅ **超額退款會被 API 擋下**,錯誤碼 **`10051`**,且是**乾淨拒絕、零副作用**(狀態一格都沒變)。
- 🔴 **`is_captured=false` 時不要送部分退款**(必回 `10024`)。本次是等請款完成才測的。
- ~~🔴🔴 **邊界:這只證明「單發超額」被擋,不證明「併發重複退」被擋。**~~
  **2026-08-03 已補測(§2.3b P4):barrier 併發全額×2,一發成功一發 `10050` 拒、無雙退(n=1)。**

##### 🔴🔴 本次測試自身踩到的事故(**同一筆交易被兩個 agent 同時退款**)

**同一個 22:04 的 one-shot cron 被排在兩個視窗**(`44b7ba58` 與 `e4739b3a`),兩邊都真的送出退款。

| 誰 | 動作 | 直接證據 |
|---|---|---|
| 本視窗 | `query`(`refunded=0`)→ `refund 1` → `refund 1` → `refund 5`(被 `10051` 拒) | 逐發 API 回應,`refunded_amount` 0→1→2 |
| 另一視窗 | 看到 `refunded=2` 後仍繼續打,並用「剩 2 送 3」測超額(同樣 `10051`) | 對方 memory `feedback_duplicate-cron-double-fires-external-writes` |
| **對不上** | 交易最終 `refunded_amount=4`;本視窗確定只退 2,對方自陳退 1 ⇒ **1 元無法歸屬** | 事後 `query` |

🔴 **本視窗的三發是乾淨的**(對方是在我 `refunded=2` 之後才動作),故上表的 API 結論成立;
但「六元交易被兩輪吃掉四元、1 元不知道是誰打的」這件事**與結論的可信度無關,是流程事故**。
🟡 意外收穫(**不抵銷錯誤**):兩輪在**不同邊界值**各自撞到 `10051`(剩 4 送 5、剩 2 送 3),
等於獨立重複驗證 ⇒ 「超額被擋」比單次觀察硬。**但那是撞出來的,不是設計的。**
🔴 **規則**:cron / 排程的**內容**若含對外部系統的寫入(退款、寄信、下單、部署),
**重排不再是免費的**。排程可以冪等,**動作不冪等**。平行視窗時這種排程只留一份、並在交接檔
寫明「由哪個視窗持有」。動手前先 query 現況並與交接檔宣稱比對,**不符就停**。
落檔 memory `feedback_duplicate-cron-double-fires-external-writes`。
- 🔴 **Portal 畫面不是 API 的證據**(兩個方向都成立):按鈕消失不代表 API 會拒,
  按鈕可按也不代表 API 會過。上表每一格都是 API 原文回應。

#### 2.3b ✅ Sandbox 硬閘 probe(2026-08-03 日間;Sean Q3=A 核准;腳本 `scripts/tappay-sandbox-refund-probe2.py`)

補證 08-01 遺留的「未證、設計不得依賴」清單:`bank_refund_id` 冪等語意、併發重複退、
`refund_amount` 語意。每發**先寫預測再打**;交易 = 舊 `D202607314b3cIL`(T1,剩 2 元)+
官方 sandbox 測試 prime 新建 `D202608034SFpuL`(T2,6 元)/ `D20260803QkAvlo`(T3,6 元)。

| # | 交易 | 動作 | API 回應 | 定案 |
|---|---|---|---|---|
| P1 | T1(已請款) | 部分退 1,鍵 `pcm-p1_20260803aaaaa`(恰 20 字、小寫+數字+`-`+`_`) | `0 Success`、`refund_id=DR202608039iw1lT`、**`refund_amount=1`** | 格式/20 字上界接受;**`refund_amount`=「本次退款額」非累計**(累計會是 5) |
| P2 | T1 | 同鍵再退 1 | **`6002 'Duplicate bank_refund_id'`**、零副作用 | **TapPay 強制同鍵唯一、乾淨拒絕** |
| P2b | T2(未請款) | 拿 P1 已用鍵退 1 | 同 `6002`(不是 10024) | 唯一性=**商戶全域**;重複鍵檢查**先於**請款狀態檢查 |
| P3 | T2 | 新鍵 `pcm-p3-20260803` 退 1 | `10024`,**回應帶 `refund_id=DR20260803PvpSL9`**、零副作用 | 被拒的嘗試在 TapPay 端被配了退款編號 |
| P3b | T2 | P3 同鍵立即重試 | **`6002`** | 🔴🔴 **10024 拒絕也消耗鍵** ⇒ deferred 後重試**必須換鍵** |
| P5a | T1(剩 1) | 新鍵 `pcm-p5-over` 超額退 2 | `10051`、零副作用、**回應無 `refund_id`** | 10051 在管線更早處被擋 |
| P5b | T1 | P5a 同鍵退 1 | `0 Success`;T1 累計 6/6、`record_status 2→3` | **10051 不消耗鍵**(與 10024 不對稱);「剛好退完剩餘額」可行(補 08-01 🟡);**部分退累計到 0 時 record_status 轉 3 (REFUNDED)** |
| P4 | T3(未請款) | **barrier 併發**全額退×2、異鍵 | 一發 `0`(`refund_amount=6`)、一發 **`10050 'Out of range : amount'`**;事後 `refunded=6` 非 12 | **併發重複退被序列化、無雙退**(⚠️ n=1 單次取樣);全額退撞「已無可退」= `10050`(≠10051) |
| **P6** | T2(**已請款**;08-03 20:0x 實測) | 先 `query` 確認 | `record_status=1(OK)`、`is_captured=True`、`amount=6`、`refunded_amount=0` | 18:00 送批 → 20:00 後確認請款成立(中信批次時點,**sandbox 觀測值**、非正式商戶承諾) |
| **P6a** | T2(已請款) | **P3 的消耗鍵** `pcm-p3-20260803` 退 1 | **`6002`**;前後 `refunded_amount` 皆 0 | 🔴🔴 **鍵消耗恆久、跨「請款」狀態變化不重置**(無 TTL)⇒ 結論 2 的 rotation-always 是**必要**而非保守;at-most-once 防線可依賴 |
| **P6b** | T2(已請款) | **新鍵** `pcm-night-fresh1` 退 1 | `0 Success`、`refund_id=DR20260803gvcV5i`、`refund_amount=1`;事後 `record_status 1→2(PARTIALREFUNDED)`、`amount 6→5`、`refunded_amount 0→1` | **「deferred→請款→換鍵重試」正向鏈端到端閉合**;`amount`=剩餘可退額(G3 全額凍結額來源)、`refunded_amount`=累計(S2 baseline / RW4 差額判定來源),兩者在真資料上同時驗證 |

**設計結論(A7c 接線片消費)**:

1. 🔴 **`6002` ≠「錢動過」** —— 只證明「這把鍵曾有嘗試送達 TapPay」(可能被受理、也可能被 10024 拒)。
   崩潰恢復收到 `6002` **必須走 Record API 比 `refunded_amount` 差額對帳**,不得假設成功、不得換鍵盲重送。
2. 🔴 **換鍵政策一律「每次嘗試都配新鍵」** —— 10024 消耗鍵、10051 不消耗,不對稱;依賴「哪類拒絕
   消耗鍵」的細節太脆,rotation-always 在兩種情形下都安全。
   **✅ P6a 強化(08-03 晚)**:被 10024 消耗的鍵在該交易**請款完成後**重試仍是 `6002` ——
   鍵消耗**恆久、無 TTL、不隨交易狀態重置**。⇒ ①rotation-always 從「保守選擇」升格為**必要**
   (不換鍵的重試必然撞 6002、且 6002 依結論 1 要走對帳=昂貴);②反面是好消息:
   `bank_refund_id` 的 at-most-once 性質**可被設計依賴**(RW1a G2 一列一鍵的前提成立)。
3. `refund_amount` 語意已定案=本次額(adapter JSDoc「語意未證」字面待接線片同步改)。
4. `6002`/`10050` 均不在 adapter allowlist ⇒ 現行 `refund()` 一律 throw(unknown-state)——
   對 6002 這是**正確的 fail-closed**(理由見 1);接線片不得為它們開自動分流。
5. 官方 sandbox 固定測試 prime 可直接建 AUTH 交易(`charge` 模式),probe 不再依賴既有交易餘額。
6. ✅ **殘項已收案(08-03 20:0x;P6/P6a/P6b)** —— 兩發**預測全中**、零意外:消耗鍵請款後仍
   `6002`(結論 2 已強化)、新鍵退 1 成功(正向鏈閉合)。**probe 全案結束**,「未證、設計不得依賴」
   清單清空;`refund()` 三態契約與 RW1a 帳本設計的每一條 TapPay 側前提皆有實測支撐。
7. 🟡 **仍未證(登記,勿當已知)**:①正式商戶(非 sandbox)的請款時點與批次行為 —— P6 的
   「18:00 送批/20:00 可退」是 sandbox 觀測,**不得寫進 UI 文案**(plan §3 fable N5 同此);
   ②併發仍是 n=1 單次取樣(P4),不當防線、只當 signal;③已請款交易的**併發部分退**未測
   (非必要:S5 single-flight 在 DB 端已擋同單並行)。

- **PCM 對照**:`TapPayChargeAdapter.refund()` 目前 `throw new Error('TapPay refund 未實作(Phase 2)')`(約 `TapPayChargeAdapter.ts:211-213`)。此組規格即該補的目標介面。🔴 現況退款走 **Sean 手動 Portal + 手動改本地 `orders.payment_status`**(07-17 拍板);S6 只寫 SOP、不自動化(見上位 plan §5 S6)。實作 `refund()` 時務必 sandbox 先測「全額」與「部分」兩路徑 + 處理「隔日生效」。

### 2.4 Backend Notify(webhook)— `backend_notify_url`(已核對,PCM 做法方向正確)
- 機制:建交易時帶 `backend_notify_url`(**e-payment 與 Direct Pay 3D 交易為必填**);TapPay 完成後主動 POST 通知。
- URL 限制:必須 `https://`、僅 443 port。
- Retry:未回 HTTP 200 → 間隔 **1/2/4/8/16 分鐘重試最多 5 次**;全失敗寄信通知商戶。
- Payload 關鍵欄位:`rec_trade_id`、`bank_transaction_id`、`order_number`、`amount`、`status`(0=成功);e-payment 另有 `pay_info`;其餘 `auth_code`/`acquirer`/`instalment_info`/`redeem_info`/`card_identifier`/`merchant_reference_info`。
- 🔴 **簽章驗證:官方文件查無任何 HMAC/簽章機制**(WebFetch 讀 back.html 全文未見 signature 段;如需更保守可再人肉複查原始 HTML)。
- **PCM 對照**:webhook 路由 `apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts` 用「路徑帶隨機 secret 段」取代簽章 → 在「官方無簽章機制」前提下是**合理替代防護**(URL 本身即需保密)、方向正確。🔴 S4 須在 TapPay 後台登記此 notify URL(見上位 plan §3-j)。

---

## 3. 官方 GitHub repo 盤點(14 個;`github.com/orgs/tappay/repositories`)

**對後端金流有意義的只有 2 個**,其餘為 iOS/Android/Java SDK、AI-agent 購物(2026 新出但走 MCP 自動購物、非傳統 adapter)、Apple Pay wrapper 等,均與本線無關。

| Repo | 用途 | 語言 | 最後更新 | 對後端有用? |
|---|---|---|---|---|
| **tappay-nodejs** | Node SDK(payByPrime/payByToken/**refund**/record query/綁卡/刪卡) | TS | **2022-12(核心 2020-08 停更)** | 🔴 **官方明標 Deprecated「please do not use」+ 不含 3DS** → 不採用 |
| tappay-web-example | 前台 Web SDK(TPDirect)範例 | HTML | 2026-01-21 | 次要:核對前台用法有無過時 |
| tappay-ios/android/java-* | 行動端 SDK/範例 | ObjC/Java | 2020–2026 | 否 |
| tappay-agentic-commerce / tappay-agent-wallet | AI agent 購物 / MCP 自動付款 | — | 2026 | 否(場景不對口) |
| appr-wrapper | Apple Pay JS wrapper | TS | 2018 | 否 |

🔴 **`tappay-nodejs` README 原文**:「Deprecated - 20200824 updated. This module is not longer maintained, please do not use this module.」→ 官方自己叫你別用;且**不含 3DS**(PCM 走強制 3DS 就算沒棄用也接不上)。

---

## 4. PCM 現況對照 + 缺口

| 面向 | 官方 | PCM 現況 | 狀態 |
|---|---|---|---|
| 前台 SDK | TPDirect v5.1.0 | `TapPayCardFields` + `useTapPayCard` | ✅ 已用 |
| Pay by Prime + 3DS | REST + redirect | 自寫 `TapPayChargeAdapter` | ✅ 已實作 |
| Record Query(對帳) | `/tpc/transaction/query` | `wire.ts` parser + `settleCharge` | ✅ 逐字一致 |
| Backend Notify | `backend_notify_url` 無簽章 | 路徑帶 secret 段 route | ✅ 合理替代 |
| **Refund** | `/tpc/transaction/refund` | `refund()` **throw 未實作** | 🔴 **缺口 = S6** |

---

## 5. 逐片使用指引(S3–S6)

- **S3(sandbox 3DS 測試)**:無官方 3DS 測試工具;續用 PCM sandbox 卡號流程(§1.5);`tappay-web-example` 可核對前台呼叫沒過時。
- **S4(正式金鑰)**:無額外官方資源;換 `partner_key`/`merchant_id` + serverType `production`(前後端兩處)+ 後台登記 notify URL(§2.4)。
- **S5(1 元真刷)**:無專屬工具;走 Record API 覆核(§2.2),adapter 已對。
- **S6(退款)**:照 §2.3 規格實作 `refund()`(**不參考已棄用的 tappay-nodejs**);sandbox 先測全額 + 部分兩路徑;🔴 **記得「隔日生效」**——對帳邏輯勿假設即時。Phase 1 先走 Sean 手動 Portal + 手動改 `payment_status`(SOP),自動化 refund 屬後續。

---

*本檔為靜態參考;官方 API 若改版以 `docs.tappaysdk.com` 現況為準,更新時同步本檔並註記日期。*
