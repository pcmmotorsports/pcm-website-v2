# M-3 3DS-5a + 5b — Phase II 3DS charge 啟動半段 plan(2026-06-19、鐵則 8 + 鐵則 12、待 Sean 批准)

> **真權威**:master plan v5 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §1(啟動/結算雙半段)/ §2(Phase II 子片 5a/5b)/ §6(影響面)/ §7(TapPay 坑)。
> **TapPay 官方欄位已逐字核實**(2026-06-19、WebFetch `docs.tappaysdk.com/tutorial/zh/back.html`、memory `webfetch-money-enum-hallucination-read-dom` 紀律):
> - `bank_transaction_id` = **Request + Response 皆有**;Request 選填、原文「強烈建議商戶自訂、但不能與之前重複;若沒自訂則自動產生」→ ✅ **caller 可帶入**(master plan「charge 前產生 bank_txn」機制成立)。
> - 🔴 **格式(reference.html 逐字、codex 關卡1 #1 揪正)**:「由**大寫英文字母及數字**所組成的訂單編號」**不允許小寫/hyphen**;長度**各收單銀行不同**(玉山20/台新23/**中信19**/永豐40/凱基40)、最嚴=19。→ `crypto.randomUUID()`(小寫+hyphen+36字)**不合格** → 改 **≤19 字大寫英數** 產生器(§2.2)。
> - `three_domain_secure` Request Boolean 預設 false、「僅應用於 Direct Pay」(pay-by-prime 適用)。
> - `result_url{frontend_redirect_url, backend_notify_url}` Request、3D 交易必填;frontend 須 https。
> - `payment_url` Response、「付款頁面網址、回傳前端跳轉」。
> - `delay_capture_in_days` Request、預設 0=當天請款、-1=暫不請款 → master plan「不送 -1」正確(省略即預設 0)。
> - 🔴 **5a 實作前再逐字複核一次官方 Request JSON 形狀**(memory 紀律;小模型萃取不作金流定案唯一依據)。

---

## 0. 為什麼(承 master plan §0)

- prod 4 merchant 全強制 3D。現行 `confirmPayment` 走同步 `TapPayChargeAdapter.charge`(零 3DS)→ 在 prod 會被 TapPay 拒(status 75,memory `tappay-merchant-requires-3ds-sync-charge-fails` 已實證)。
- 3DS charge **不回扣款結果、回 `payment_url`(跳轉網址)**→ 銀行 OTP →(a)redirect frontend_redirect_url(b)POST backend_notify_url。結算交給已建好的 Phase I 對帳脊椎(settleCharge / webhook / callback / sweeper)。
- **本 plan = 啟動半段**(charge 帶 3DS、回 redirectUrl);結算半段 Phase I 已全到位(0a→4d、已落 prod)。

## 1. 範圍邊界(本 plan = 5a + 5b only)

| 子片 | 本 plan 做 | 不做(後續) |
|---|---|---|
| **3DS-5a** | charge adapter 3DS 啟動方法 + 新回傳型別 + wire(payment_url/bank_txn)+ adapter 單元測 | — |
| **3DS-5b** | initiate use-case + **新 migration**(寫 bank_txn/rec_trade_id 進 pending attempt 的窄權 RPC)+ port/adapter 寫入方法 + 單元測 | — |
| 3DS-6 | ✗(後續片):charge-actions flag 分岔回 `{ redirectUrl }` + useChargePayment 加 redirect 態 + CheckoutView `window.location` 跳轉 | 接 UI、live 路徑 |
| 3DS-7 | ✗(部分已被 option A 取代):client CartContext cart_session_id;現由 server per-call `randomUUID()` 過渡(charge-actions L136) | client cart key TTL |

**🔴 中間態誠實(master plan §2)**:5a/5b 純建引擎(adapter + use-case + migration + 單元測),**不接 charge-actions / useChargePayment**(那是 6)、不開任何 live 3DS 路徑。`TAPPAY_3DS_ENABLED` flag 本片**僅引入常數/讀取 helper、不被任何 live 路徑消費**(消費在 6)。對齊 Phase I「先建 settleCharge/webhook/callback 引擎、後接線」前例。部署 5a/5b 到 prod ≠ 開放結帳。

**🔴 鐵則 4 拆片(codex 關卡1 #6)**:本 plan 涵蓋 5a+5b,實作時**拆兩個獨立 commit/checkpoint**、各自三綠 + code-reviewer + codex 關卡2:
- **Slice 5a**:domain 型別 + ITapPayAdapter 方法 + TapPayChargeAdapter.initiateThreeDSCharge + wire + bank_txn 產生器 + adapter/wire/產生器測。**零 migration、零 db push**。
- **Slice 5b**:新 migration(2 RPC)+ IChargeAttemptStore/adapter 2 方法 + initiate-payment use-case + flag helper + 測。**帶 migration → db push**。
依賴序:5b 消費 5a 的型別/方法 → 先 5a 後 5b。

## 2. 3DS-5a — charge adapter 3DS 啟動

### 2.1 要改什麼
- **新 port 方法**(不動既有同步 `charge`):`ITapPayAdapter.initiateThreeDSCharge(payload): Promise<TapPayInitiationResult>`。
  - 🔴 **不 overload `charge`**:同步 `charge` 回「已扣款」`TapPayChargeResult`(含實扣 `amount`、PF-X3 比對);3DS 回「啟動」(payment_url + rec_trade_id、**尚未請款無實扣金額**)。語意不同 → 獨立方法 + 獨立型別,既有同步 `charge` 與其全部測試零改、flag-off/sandbox 同步路徑(免3D merchant)續可用。
- **新 domain 型別**(`packages/domain/src/payment/types.ts`):
  - `TapPayInitiationPayload = { prime; amount: Money; orderId; cardholder; bankTransactionId: string; frontendRedirectUrl: string; backendNotifyUrl: string }`。
  - `TapPayInitiationResult = { status: 'pending_3ds'; paymentUrl: string; recTradeId: string; bankTransactionId: string }`(**只有成功一態**;非成功一律 throw、見下)。
- **adapter 實作**(`TapPayChargeAdapter.initiateThreeDSCharge`):組 body = 既有 pay-by-prime 共同欄(partner_key/prime/amount/merchant_id/order_number=orderId/details/cardholder)+ `three_domain_secure: true` + `result_url: { frontend_redirect_url, backend_notify_url }` + `bank_transaction_id: payload.bankTransactionId`;🔴 **不送 `delay_capture_in_days`**(省略=預設 0 當天請款、避免停 AUTH;master plan §7 + r3)。
  - 🔴 **解析(codex 關卡1 #2:不可過寬釋鎖)**:**唯有** `status===0` **且**有 `payment_url`+`rec_trade_id` → 回 `pending_3ds`。**其餘一律 throw**:`status!==0`(含 421 操作逾時/網關 timeout 等**模糊態**、卡拒、缺 payment_url)、HTTP 非 2xx、JSON 格式異常。理由 = 3DS 啟動的非成功**未必「明確未扣款」**(timeout 可能 OTP 後已成交)→ adapter **不自行判 failed**、不給 use-case 釋鎖依據;由 use-case 映 `charge_unknown`(bank_txn 已 durable)、最終由 **settleCharge / Record API 唯一權威** 裁決(record_status -1/5 才 failed 釋鎖)。**移除原 `failed` 態**(消除過寬 markFailed 雙扣風險)。
  - ⚠️ 取捨(誠實揭示):真「壞 prime 等明確零扣款」也走 charge_unknown(短暫顯「狀態確認中」、由 sweeper/Record 收斂釋鎖,非即時重試)→ 換取零誤釋鎖。未來可加「官方驗證過的明確零扣款 status allowlist」放行即時重試(backlog、非本片)。
  - 🔴 #16 PII:logging 只記 orderId/status/recTradeId/bankTransactionId(非 PII);cardholder/rawResponse/payment_url 不入 log(payment_url 含 token query)。
- **wire**(`packages/adapters/src/tappay/wire.ts`):`parseTapPayResponse` 既有解析 status/rec_trade_id/amount/currency,**新增**白名單解析 `payment_url`(string?)+ `bank_transaction_id`(string?)。既有 `parseTapPayResponse` 簽章/同步 charge 用法不變(新欄選填、向後相容)。

### 2.2 bank_transaction_id 產生(🔴 codex 關卡1 #1 修)
- 由 **5b use-case 產**(charge 前)、傳入 payload;adapter 不產(忠實透傳、可測)。
- 🔴 **格式硬約束**(reference.html 逐字、跨銀行最嚴):**≤19 字、純大寫英數 `[A-Z0-9]`**(無小寫/無 hyphen、滿足中信19/國泰「僅大寫英數」/玉山「不可含 `_`」全部)。
- 產生器:`crypto.randomBytes` → 大寫 base32(Crockford,去易混 I/L/O/U)→ 取固定長度,例 `'P'` + 18 字 = 19 字(熵 ≈ 32^18 ≈ 防撞綽綽有餘;前綴便於 log/對帳辨識 PCM 來源)。**獨立純函式 + 單元測鎖「長度=19 / 全 `^[A-Z0-9]{19}$` / 多次產出不重複」**。
- 縱深:DB 端 bank_transaction_id **UNIQUE 部分索引**(WHERE NOT NULL)防萬一撞號(§3.1);TapPay「不能與之前重複」雙保險。

## 3. 3DS-5b — initiate use-case + 新 migration

### 3.1 新 migration(🔴 = 再一次 db push)
**問題根因**:`begin_charge_attempt` 建 attempt 只寫 `(order_id, customer_user_id, fallback_token_hash)`(0b L448-451)、**不寫 bank_txn/rec_trade_id**;`markCharged` 會 pending→**charged**(代表已扣款)→ 不適用「啟動但未請款」的 3DS pending attempt。settleCharge 靠 `findActiveByOrderId` 撈 `bankTransactionId`/`recTradeId` 對帳 → **必須有路徑把這兩鍵寫進仍 pending 的 attempt**。

**新 migration** `supabase/migrations/<ts>_m3_3ds_5b_record_charge_initiation.sql`:
- **DDL**:`payment_charge_attempts` 加 **UNIQUE 部分索引** `ON (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL`(縱深防撞號;對齊既有 rec_unique_idx 慣例)。
- **兩支窄權 SECDEF RPC**(payment_confirmer only、search_path=''、全識別子 schema-qualified;`RETURNS boolean` persisted):
  - `record_charge_bank_txn(p_attempt_id uuid, p_order_id uuid, p_bank_transaction_id text) RETURNS boolean`:charge **前**寫 bank_txn。
    - 🔴 **輸入 guard(codex 關卡1 #4)**:`btrim` 後**非空** + 符 `^[A-Z0-9]{1,19}$`(對齊 §2.2 格式)否則 RAISE 通用錯(對齊既有 RPC「不洩內部」)。
    - `FOR UPDATE` 鎖 attempt;guard `status='pending' AND order_id=p_order_id`(雙鍵驗)。
    - 冪等 = `bank_transaction_id IS NULL`(寫入、回 **true**)或**同值**(no-op、回 **true**=已 durable);**異值** → 不覆寫、回 **false**(防竄改);**非 pending / 查無 attempt** → 回 **false**。
    - `unique_violation`(撞 UNIQUE 索引)→ 收斂為通用 RAISE。
  - `record_charge_pending_rec(p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text) RETURNS boolean`:charge **後**寫 rec_trade_id、**維持 status='pending'**(≠ markCharged)。
    - 輸入 guard:`btrim` 非空 + 長度 ≤ **既有 `mark_charged` RPC 的 rec 上限(64 字、實作前核對確切值)**;同 FOR UPDATE + 雙鍵 + `status='pending'` guard + 冪等(NULL/同值→true、異值→false、非 pending→false);`unique_violation`(撞 rec_unique_idx)→ 通用 RAISE。
- 🔴 **persisted 語意(codex 關卡1 #3)**:bank_txn RPC 回 `false` = **未 durable** → port 方法**必 throw**(use-case 不送 TapPay)。同值冪等回 `true`(成功、非 no-op 混淆)。
- 🔴 設計取捨:兩支單一職責 RPC(本 plan 採)vs 一支 `record_charge_initiation(... DEFAULT NULL)` 呼兩次 → 採兩支:意圖清楚、各自 guard 緊、codex 易逐支推理。
- **ACL**:REVOKE EXECUTE FROM PUBLIC, anon, authenticated, **service_role**(memory `supabase-service-role-execute-default-grant`)+ GRANT payment_confirmer + `has_function_privilege` 矩陣 assert(正負向)+ payment_confirmer 全域 role-hygiene 回歸 assert。
- **MCP 交易模擬**(BEGIN+模擬+SET LOCAL ROLE 等價〔memory `pooled-mcp-set-role-secdef-terminates`〕+ROLLBACK、零留痕):pending 寫 bank_txn/rec → 回 true;**異值 → 回 false 不覆寫**;**空字串/小寫/>19/含 `_` → RAISE**;charged/failed attempt → false;查無 attempt → false;非 payment_confirmer → permission denied;UNIQUE 撞號 → 通用 RAISE;grant 矩陣正負向。

### 3.2 port + adapter 寫入方法
- `IChargeAttemptStore` 加 **主軌-only**(對齊 findActiveByOrderId;3DS 對帳路徑無 user JWT、寫失敗 sweeper 重來無漏寫風險):
  - `recordInitiationBankTxn(attemptId, orderId, bankTxn): Promise<void>` — 🔴 **RPC 回 false(未 durable)即 throw**(codex 關卡1 #3:不可在 bank_txn 未落地時讓 use-case 送 TapPay);連線/parse 失敗亦 throw。
  - `recordInitiationRec(attemptId, orderId, recTradeId): Promise<void>` — best-effort 語意由 use-case 決定(charge 後、bank_txn 已 durable);RPC 回 false 不一定 throw,但連線/parse 失敗 throw(use-case catch→log)。
- `PgChargeAttemptAdapter` 實作(複用 `run<T>`、呼新 RPC、解析 boolean persisted);`ChargeAttemptStoreWithFallback` 主軌-only 委派(對齊 4b-1 expirer/claim 委派)。

### 3.3 新 use-case `initiate-payment.ts`(獨立檔、不動 confirm-payment)
> 🔴 **命名 override(codex 關卡1 #5)**:`initiatePayment` = master plan §1/§2「`confirmPayment.initiate`」的**落地名稱**(conscious override:獨立檔、不拆改重測過的 confirm-payment 同步路徑)。後續 **3DS-6 只能 consume 這個 use-case**(別誤接 confirm-payment 當 3DS 入口)。
```
initiatePayment(deps, input) → InitiatePaymentOutcome
1. begin(orderId)  // 複用既有鎖 + cart dedup
   !acquired:
     duplicate|needs_settle → settlement_required   // 對齊 confirmPayment(交 settleCharge/action 裁決)
     else                    → locked(reason)
2. bankTxn = generateBankTransactionId()   // §2.2:≤19 字大寫英數純函式
3. recordInitiationBankTxn(attemptId, orderId, bankTxn)   // 🔴 charge 前 durable;RPC false / throw 皆 →
     init_failed(零 charge、未送 TapPay → 安全;鎖殘留交 expirer/sweeper 清)   // codex #3
4. initiateThreeDSCharge({ prime, amount, orderId, cardholder, bankTxn, frontendRedirectUrl, backendNotifyUrl })
     throw(status≠0 / 421 timeout / HTTP / 格式 — 見 §2.1) → charge_unknown
              // 🔴 bank_txn 已 durable → settleCharge 經 bank_txn 對帳;**不 markFailed**、pending 續持鎖、勿重刷
     pending_3ds →
       recordInitiationRec(attemptId, orderId, recTradeId)   // best-effort:throw/false 只 log(bank_txn 已可對帳)
       → redirect(redirectUrl: paymentUrl)
```
- 🔴 **無 markFailed 分支(codex 關卡1 #2)**:initiate 全程不釋鎖(charge 非成功一律 charge_unknown);failed-釋鎖是 settleCharge 經 Record(record_status -1/5)的**唯一**權威。
- **新 outcome 型別** `InitiatePaymentOutcome`:`{ kind:'redirect'; redirectUrl }` | `{ kind:'charge_unknown'; orderId }` | `{ kind:'settlement_required' }` | `{ kind:'locked'; reason }` | `{ kind:'init_failed' }`(**無 charge_failed**)。
- **deps**:`{ tappay, attempts }`(initiate 不呼 confirmer — 不 markCharged/confirm;結算全交 settleCharge)。
- **frontendRedirectUrl / backendNotifyUrl** 來源 = delivery 層(action/composition)組 `${base}/checkout/callback?order=${orderId}`(對齊 3DS-3 callback 讀 order param)+ `${base}/api/checkout/tappay-notify/${secret}`(對齊 3DS-2 webhook secret path);本片 use-case **收參數不自組 URL**(URL 組裝 = 6 的 delivery 職責;5b 簽章預留 frontendRedirectUrl/backendNotifyUrl 入參)。

### 3.4 feature flag(僅引入、不消費)
- `TAPPAY_3DS_ENABLED` env helper(server-only requireEnv 風格、預設 false/僅 'true' 認 on)。本片**僅建 helper + 測**,charge-actions 分岔在 6。

## 4. 預期影響面(鐵則 8)

- **新增檔**:`packages/use-cases/src/initiate-payment.ts`(+ test)、`supabase/migrations/<ts>_m3_3ds_5b_record_charge_initiation.sql`、`TAPPAY_3DS_ENABLED` helper(+ test)。
- **改寫檔**(只增不減、向後相容):`packages/domain/src/payment/types.ts`(+ 4 型別)、`packages/ports/src/ITapPayAdapter.ts`(+1 方法)、`packages/ports/src/IChargeAttemptStore.ts`(+2 方法)、`packages/adapters/src/tappay/TapPayChargeAdapter.ts`(+ initiateThreeDSCharge)、`.../tappay/wire.ts`(+ payment_url/bank_txn 解析)、`packages/adapters/src/payment/PgChargeAttemptAdapter.ts` + `ChargeAttemptStoreWithFallback.ts`(+2 方法)、`packages/use-cases/src/index.ts`(export)。
- **不動**:confirm-payment、charge-actions、useChargePayment、CheckoutView(全屬 6)。既有同步 charge 路徑與測試零改。
- **影響部署**:① 新 migration → **Sean 手動 `supabase db push`**(memory `supabase-cli-reads-env-local-blocker`:db push 時暫移開 .env.local)。② env(flag-on 前才需、本片不 live):`TAPPAY_3DS_ENABLED`、result_url 用的 public base URL(查既有 env、無則新增)、`TAPPAY_NOTIFY_PATH_SECRET`(STATUS 已列 Sean 待設)。無新密鑰(TapPay key 已備)。
- **不影響經銷價/RLS/既有 schema**(新 RPC 只動 payment_charge_attempts 既有兩欄、payment_confirmer 窄權)。

## 5. rollback(鐵則 8)

- forward 重構、不 revert 既有 commit。`TAPPAY_3DS_ENABLED` **flag off 只代表「不接 live 3DS 路徑」、非 prod 可刷卡 rollback**(codex 關卡1 #7:prod 4 merchant 全強制 3D、同步 charge 被 status 75 拒 → flag off 在 prod 非可營運態);**prod checkout 仍一律不可開**,直到 5a/5b + 6 + sandbox 3DS E2E + Sean 驗收(下條);flag 僅供 sandbox/staging 滾動控制。
- migration 走新檔 + rollback SQL(DROP 兩新 RPC);RPC 純新增、不改既有 begin/markCharged/create_order。
- 每子片獨立 commit、未 push 可 reset;db push 前 MCP 模擬零留痕。
- 🔴 **prod 真實刷卡 = Phase I + 5a/5b + 6 全到位 + flag on + sandbox 3DS 端到端過 + Sean 肉眼驗**(與「開放 prod 結帳」同一決策點、Sean 拍)。

## 6. 內容分級 + 鐵則判定

- **內容分級**:N/A(純後端結算引擎、無 hardcode 內容)。
- 🔴 **鐵則 8 重大改動**:動 payment adapter/port/use-case + 新 migration + 部署 env/flag → 本 plan 等 Sean 批准才實作。
- 🔴 **鐵則 12**:金流 + 新窄權 RPC + attempt 寫入 → 每子片 commit 前 **codex 關卡2 必跑**;本 plan **codex 關卡1 必跑**(動手前審)。
- 三視角:擴充性(獨立 initiate 方法/型別、不污染同步路徑)、可維護性(單一職責 RPC、flag 隔離)、bug 可追蹤性(bank_txn charge 前 durable → 回應遺失仍可對帳)。

## 7. 驗收(yes/no)

- [ ] 5a:initiateThreeDSCharge 組 body 含 three_domain_secure/result_url/bank_transaction_id、**不送 delay_capture_in_days**;**唯 status=0+payment_url+rec → pending_3ds、其餘(含 421/timeout/HTTP/格式)一律 throw**(無 failed 態);PII 零 log(payment_url 不 log)。
- [ ] bank_txn 產生器:長度=19 / `^[A-Z0-9]{19}$` / 不重複(單元測)。
- [ ] 5b RPC:pending 寫 bank_txn/rec 回 true、維持 pending;**異值回 false 不覆寫**;**空/小寫/>19/含 `_` → RAISE**;charged/failed/查無 attempt → false;非 payment_confirmer denied;UNIQUE 撞號→通用 RAISE;grant 矩陣;MCP 零留痕。
- [ ] 5b use-case:redirect happy / begin dedup→settlement_required / charge throw→charge_unknown(bank_txn 已 durable、**不釋鎖**)/ bank_txn 寫 false→init_failed(**零 TapPay 呼叫**)/ rec 寫 false 只 log 仍 redirect;**不呼 confirmer、無 markFailed**。
- [ ] flag helper 只認 'true';本片不被 live 路徑消費。
- [ ] 三綠 + full vitest + bundle grep(server keys/經銷價零命中)+ 5a/5b 各 codex 關卡2 + code-reviewer PASS。

## 8. 禁止清單(基線 + 本 plan)

— 不改既有同步 `charge` 與其測試 / 不動 confirm-payment·charge-actions·useChargePayment(屬 6)/ 不接 live 路徑(中間態誠實)/ 不送 delay_capture_in_days:-1 / bank_txn 必 charge 前 durable / 不採信 client 送值 / 卡資料零進 state·DOM·server·log / payment_url 不入 log / 金額整數零浮點 / 經銷價零外洩 / 新 RPC REVOKE service_role + 矩陣 assert / 密鑰 server-only / 不改已套用舊 migration(走新檔)/ 不動 .env* / 不 git add .·-A / 不自動 push / 不自行 db push(Sean 手動)—
— 禁止清單結束 —
