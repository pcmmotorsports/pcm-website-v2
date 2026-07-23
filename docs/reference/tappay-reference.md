# TapPay 金流整合參考(前台 SDK + 後端 REST API + 官方資源盤點)

> **用途**:PCM 網站 TapPay 金流線(M-3)的權威參考,供 S3(sandbox 3DS 測試)/ S4(正式金鑰)/ S5(1 元真刷)/ S6(退款)逐片使用。避免重造輪子或走錯路。
> **建立**:2026-07-23。**來源**:官方文件 `docs.tappaysdk.com`(前台 tutorial/en/home.html、後端 tutorial/zh/back.html、reference.html)+ 官方 GitHub `github.com/orgs/tappay`(WebFetch DOM 逐字核對)+ Sean 提供的前台 SDK 文件。
> **紀律**:enum/欄位/端點皆對照官方 DOM 逐字;查無的(如 webhook 簽章)明標「官方無」、不杜撰。金額一律整數(分),不用 float。
> 相關:上位 plan `docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md`;金流不變量見該檔 §2。

---

## 0. 一句話結論

**TapPay 沒有活躍維護的官方 Node/TS server SDK**(唯一候選 `tappay-nodejs` 官方明標 Deprecated、且不含 3DS)→ **PCM 自寫 `TapPayChargeAdapter` 的方向正確、繼續自寫**。經逐字核對,PCM 現有 Record Query / webhook 實作**與官方文件一致、無落差**;**唯一缺口 = `refund()` 未實作**(現 `throw`),規格見 §2.3,照官方文件補即可。

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
- **PCM 對照**:`packages/adapters/src/tappay/wire.ts` 的 parser 欄位命名/型別 + record_status 7 值 + top status 0/2 語意**與官方逐字一致、無落差**。sweeper(`settleCharge`)只在 `record_status` −1/5 才 markFailed、其餘保留 pending(見上位 plan §2 金流不變量)。

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
  - 銀行請款有時間限制,退款前應先確認交易狀態、避開請款處理中的時間窗。
  - Sandbox 可測(同一套 partner_key/merchant_id)。
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
