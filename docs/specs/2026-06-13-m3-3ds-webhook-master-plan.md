# M-3 ②-⑥ + 3DS 重設計 — master plan v5(2026-06-13、鐵則 8、Sean 批准開工)

> **真權威**:kickoff `docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md` + 審查側 5 段交辦 + 業界紮根研究
> `docs/specs/2026-06-13-m3-checkout-industry-research-synthesis.md`(全球+台灣+稽核 84 findings)。
> **Sean 拍**:D-範圍=A / 庫存 Phase 1 不做 / S1=B(發票 fast-follow 手開)/ S2=B(退款 Phase 2)/ S3=B(ATM Phase 2)/ **🔴 D4 override(v5):orphan-pending 改「retry 即時 settleCharge 裁決」、不永久擋**(§1(d)/§4)。
> **v4 = codex 關卡1 三輪(r1 8 + r2 4 + r3 1must+3consider)全收斂**(見 §11);TapPay notify/Record API 機制經 WebFetch 官方文件核實(notify 無簽章、Record record_status=1+is_captured 為已付款權威)。
> **流程**:本 plan → codex 關卡1 r2 → Sean 批 → 子片逐一實作(各自三綠 + code-reviewer + 鐵則 12 codex 關卡2)。

---

## 0. 為什麼

- **3DS production 必經**:正式 4 merchant 全「3D 驗證」、sandbox 亦已開(env 備)。現行 `TapPayChargeAdapter.charge` 同步、零 3DS。
- **3DS 打斷同步**:3DS charge **回 `payment_url`(跳轉網址、非扣款結果)**→ 銀行 OTP → (a) redirect `frontend_redirect_url` (b) POST `backend_notify_url`。**沒 webhook/callback 收不了單** → 對帳層是 3DS 必要零件、非加值。
- **雙扣盤點**:同分頁/回應遺失/webhook 重送(rec_trade_id UNIQUE)已解;**唯 cross-tab(兩分頁→兩張單→兩筆不同 rec_trade_id)未解** → cart_session_id 解。

---

## 1. 架構:同步六態 → 啟動/結算 雙半段 + 🔴 共用結算路徑

```
〔啟動半段·結帳當下〕(Phase II、feature-flag 後切)
chargePaymentAction → placeOrder(寫 cart_session_id)→ findTotal
  → confirmPayment.initiate:begin(cart_session_id dedup 三態)→ charge(three_domain_secure=true,
    result_url{frontend_redirect_url, backend_notify_url}, 唯一 bank_transaction_id)
    → 存 pending attempt(rec_trade_id〔3DS charge 回〕/bank_transaction_id)→ 回 { redirectUrl }
  → client window.location 跳 payment_url(TapPay 3DS 頁 + 銀行 OTP)

〔結算半段·TapPay 回程〕(Phase I、先建好)
🔴 三路(callback / webhook / sweeper)全部呼叫 **同一條 idempotent settleCharge({ orderId, recTradeIdHint? })**(codex r2 #2):
   1. 🔴 `bank_transaction_id` 由 initiate **在送 charge「前」產生並 durable 存** attempt(非從回應取 → 即使回應遺失本機仍有可查鍵;codex r3 must-fix)。
      by orderId 找該單 pending attempt;Record 查詢**優先序**:attempt.rec_trade_id → attempt.bank_transaction_id → recTradeIdHint(僅 hint、Record 驗)→ order_number + 窄時間窗(attempt.created_at)。
   2. 🔴 Record API 反查 = **唯一權威**(notify 無簽章不可信)。判 paid **需全中**:
      - top-level query `status`=0(**查詢成功、非交易狀態**;`top status !== 0` → 不 confirm)+ `number_of_transactions`=1(命中恰一筆)
      - 🔴 **條件比對**:只比對本機**有**的鍵 —— 有 rec_trade_id 比 rec、有 bank_transaction_id 比 bank_txn;且恆比 `order_number`===orderId + `merchant_id`;**僅靠 order_number 的最後 fallback** 須同時限 merchant_id + amount/currency + attempt.created_at 窄窗 + number_of_transactions=1(防誤命中他單)。
      - 🔴 `record_status`=1(OK 交易完成)**且** `is_captured`=true 才算 paid(record_status=0=AUTH 僅授權未請款 → **視 pending、不 confirm**)
      - `amount`/`currency` 嚴格對 orders.total(整數、TWD)
   3. idempotent 補 attempt.rec_trade_id(已 charged → no-op)
   4. markCharged(attempt_id, orderId, rec_trade_id)〔rec_unique_idx + FOR UPDATE 冪等〕→ confirm RPC〔FOR UPDATE + paid no-op 冪等樹〕
   5. 已 paid → no-op 回 paid;top status≠0 / record_status≠1 / 查不到 / Record 失敗 → **pending(保留、不釋鎖)**;Record 明確 final-failed/cancel → failed
   (a) callback route:Record 查證 → settleCharge → 查得 paid 才渲染 OrderComplete、否則「處理中」
   (b) webhook route:notify 不可信 → durable inbox 去重 → 快回 200 → 背景 settleCharge
   (c) sweeper cron:掃 pending attempt + 未處理 inbox → settleCharge;Record 明確 final-failed/cancel 才判 failed
   (d) 🔴 retry 情境(Sean D4 override、§4):begin 回 needs_settle → action 層(**lock 外**)跑 settleCharge 三裁決:
       paid → confirm 既有單 + 回 duplicate+existingDisplayId / 明確未成功 → markFailed 既有 attempt + 允許**立即** re-begin+charge /
       模糊·查不到·Record 失敗 → **短暫 hold**(「付款確認中、請稍候幾秒再試」、非 10-20 分)
```

**樞紐 = settleCharge 共用**(codex #1/#2):webhook 只有 order_number(無本機 attempt_id)、任一路可能先到 → 三路共用同一條冪等結算、以 orderId 為鍵、Record API 為權威 → 解決「notify 早到找不到單」+「callback/webhook 權威矛盾」。

**全留不動**:cardholder server 組裝、建單、findTotal read-back、卡欄 iframe 隔離、金額整數零浮點、經銷價三層、RLS 窄權、CSRF、PII 零落地、同分頁鎖、rec_trade_id UNIQUE + confirm 冪等樹。

---

## 2. 子片分解(🔴 codex #6 重排 + r2 #4 細拆:每片 15-45min 可中斷)

### Phase I — 結算基建(無 3DS 流量、先到位;⚠️ 見下「中間態誠實」)
| 子片 | 內容 | 命中 |
|---|---|---|
| **3DS-0a** | migration:`webhook_events` durable inbox(rec_trade_id PK、processed/attempt_count/last_error/next_retry_at/received_at、**白名單欄位+raw sha256 hash、不存原文**)+ RLS enable 零 policy + service_role REVOKE | migration |
| **3DS-0b** | migration:**cross-tab DB 契約**(照搬 cross-tab plan §3.1/§4.1):`orders.cart_session_id uuid`+index、begin RPC 加 cart_session_id 三態 dedup + 入口 fail-closed、🔴 **orphan-pending 回 `needs_settle` outcome(帶既有 rec_trade_id/bank_transaction_id)而非 block**(Sean D4 override)、create_order 5-param + null nextval 前 RAISE、DROP 舊 4-param、GRANT REVOKE service_role + DO 矩陣 assert + `to_regprocedure` 舊版 DROP assert | migration/RLS/RPC |
| **3DS-0c** | migration:attempt 加 `bank_transaction_id` 欄 + 待開票 durable 表(order_id 唯一冪等鍵、settleCharge paid 重入不重複、codex r2 consider) | migration |
| **3DS-1a** | Record API adapter:`ITapPayAdapter.recordQuery({recTradeId?|orderNumber?})` + wire parse(top status / trade_records / record_status / is_captured / number_of_transactions)+ 單元測 | adapter |
| **3DS-1b** | **共用 settleCharge use-case**(§1 契約:rec 來源優先序 + Record 權威全條件 + markCharged→confirm 冪等 + **retry 情境三裁決** §1(d))+ 單元測(亂序/重送/三路並發/Record 失敗保留 pending/金額不符/已 paid no-op + 🔴 **retry-paid→既有單+duplicate / retry-failed→markFailed 放行 / retry-ambiguous→hold**)。🔴 **安全要害、鐵則 12 codex 關卡2 必覆蓋 retry 三測** | use-case |
| **3DS-2** | ②-⑥ webhook route `app/api/checkout/tappay-notify`:notify **不可信** → durable insert inbox(去重 by rec_trade_id)→ **先落 DB 再快回 200** → 背景 settleCharge(失敗留 inbox 給 sweeper retry);🔴 **加固(Sean C)**:notify_url 帶我方自定**祕密路徑段** + 端點 rate-limit + 對不上本機 order 的 rec 直接丟(不打 Record) | webhook |
| **3DS-3** | callback route `app/api/checkout/tappay-callback`:parse frontend_redirect(零信任)→ settleCharge → paid 渲染 OrderComplete / pending 渲染「處理中」/ failed 渲染失敗(**吸收 ②-⑤ stash**);🔴 **失敗/放棄分支也跑 settleCharge**(Sean D4:無論 TapPay 有無導回都裁決/釋放);🔴 **成功渲染時 client 主動清購物車品項 + regenerate cart_session_id**(Sean B:redirect 殺掉 SPA state、原 clear() 已失效、否則成功後車還在誘導重買);🟡 **sandbox 驗 TapPay 失敗/放棄是否導回**(Sean D) | route + payment |
| **3DS-4** | sweeper(Supabase/Vercel cron):掃 inbox `processed=false`(retry worker、next_retry_at 退避)+ stuck pending attempt → settleCharge;🔴 **只 Record 明確 final-failed/cancel 才判 failed**;查不到/rate-limited/仍 pending → 保留 + 轉人工 + 告警;Record API 節流 + **per-order recently-settled skip**(callback/webhook/sweeper 同時到 → 避免重打 Record 放大 rate-limit;codex r3 consider) | cron + 對帳 |

### Phase II — 3DS 啟動(feature-flag `TAPPAY_3DS_ENABLED`、結算基建就緒後才切)
| 子片 | 內容 | 命中 |
|---|---|---|
| **3DS-5a** | charge adapter 3DS:`three_domain_secure`/`result_url`/**caller 帶入唯一 `bank_transaction_id`**;🔴 **不送 `delay_capture_in_days:-1`**(預設 0=即時請款、避免停在 AUTH;codex r3 consider)+ adapter test;wire 改認 `payment_url`(status=0=3DS 啟動非扣款)+ 解析 rec_trade_id;port `charge` 回 initiation result | payment adapter |
| **3DS-5b** | confirmPayment.**initiate**(begin dedup → 🔴 **產 bank_transaction_id 並存 attempt**(送 charge 前)→ 3DS charge〔帶 bank_txn〕→ 存 pending〔rec_trade_id〕→ 回 redirectUrl、**不**做 markCharged/confirm;結算交給 settleCharge) | use-case |
| **3DS-6** | charge-actions 回 `{ redirectUrl }`;CheckoutView client 跳 payment_url;useChargePayment 六態改寫(啟動成功=跳轉中非終態) | delivery |
| **3DS-7** | cross-tab client:CartContext `cart_session_id` UUID(空車生、clear/成功 regenerate、**TTL 24h**)、checkout 帶上 + 測;🔴 **regenerate 須能由 3DS-3 callback 成功頁觸發**(Sean B:跨 redirect 後在新頁清車+換新 key) | client idempotency |

### ⚠️ 中間態誠實(codex r2 #3:Phase I 對 prod 3DS merchant 不可裝「無破口」)
prod 4 merchant 全要 3DS → **flag 關時的舊同步 charge 在 prod 會被 TapPay 拒 = 付款中斷**。故:
- **不存在「prod checkout 開著但 flag 關走同步」的營運態**。`TAPPAY_3DS_ENABLED` flag **僅供 sandbox/staging** 滾動控制。
- **prod 真實刷卡 checkout 在 Phase I + Phase II 全到位 + flag on + sandbox 3DS 端到端過 + Sean 肉眼驗 之前一律不開放**(現況 stage 2 未上線、0 流量、自然滿足;部署 Phase I 子片到 prod 不等於開放結帳)。
- Phase II 切 3DS 與「開放 prod 結帳」同一決策點(Sean 拍)。

---

## 3. ②-⑥ webhook 規格(codex #3/#4/#8 修正後)

1. **notify 不可信、無簽章**(WebFetch 官方核實:無 HMAC/header/timestamp)→ **不採信 notify 欄位**、只當「該單有動靜」的觸發。
2. **durable inbox 先寫再回 200**(codex #4):收到 → `INSERT webhook_events ON CONFLICT(rec_trade_id) DO NOTHING`(去重、at-least-once、TapPay 重送 1/2/4/8/16 分鐘×5)→ **先 durable 落 DB 再回 HTTP 200** → 背景 settleCharge;背景失敗 → inbox `processed=false`/`attempt_count++`/`next_retry_at` 留給 sweeper(3DS-4)retry(非死信)。
3. **權威 = Record API 全條件**(settleCharge 內、§1 step 2):top query status=0 + number_of_transactions=1 + 鍵全對本機 + **record_status=1 且 is_captured=true** + amount/currency 整數嚴格;**不把「查詢成功」當「已付款」**(codex r2 #1)。
4. **白名單存欄**(codex #8):只存 rec_trade_id/order_number/status/amount/bank_transaction_id/transaction_time_millis + raw sha256 hash;**不存 raw_body**(避 pay_info.masked_credit_card_number / card_identifier 落 DB)。
5. **replay**:靠 inbox 去重(rec_trade_id)+ confirm 冪等樹 + Record 反查(過期/已處理交易 Record 仍回真狀態)。
6. 🔴 **未驗證寫入口加固**(Sean C、無簽章 = 任何人可 POST):backend_notify_url 帶**我方自定祕密路徑段**(只告訴 TapPay、外人猜不到)+ 端點 **rate-limit**;recently-settled skip 只擋同單重打、**擋不住大量不同假 rec 灌 inbox / 打爆 Record 額度** → 需端點層 rate-limit + 僅處理對得上本機 order 的 rec(對不上直接丟、不打 Record)。3DS-2 納。

---

## 4. cross-tab idempotency(codex #5:照搬 cross-tab plan §4.1 完整契約)

- **三鍵分工**:`rec_trade_id`=結算主鎖(DB UNIQUE,**已有 ✓**)/ `cart_session_id`=前段(client UUID、綁 cart、清車/成功 regenerate、**TTL 24h**)、begin RPC advisory lock 內**三態 dedup**(charged/order-paid/orphan-pending)/ `bank_transaction_id`=gateway 第二道(每次唯一)/ `order_number` **不當唯一硬鎖**(TapPay 官方允許重複)。
- **3DS-0 DB 契約**(承 cross-tab plan §3.1/§4.1,不可抄薄):cart_session_id **uuid 型別**、create_order 5-param 版 null 在 nextval 前 fail-closed、DROP 舊 4-param、GRANT REVOKE service_role + DO 矩陣 assert、begin dedup 三態 + 入口 fail-closed。
- 🔴 **D4 改拍(Sean override v5):從「orphan-pending 永久擋 10-20 分」改「retry 當下即時裁決」**:begin 偵測同 cart_session_id orphan-pending → **不 block、回 `needs_settle`**(帶既有 rec_trade_id/bank_transaction_id)→ action 層(lock 外)跑 settleCharge(§1 (d) 三裁決:paid→duplicate+existingDisplayId / 明確未成功→markFailed 釋放+立即重刷 / 模糊→短 hold)。callback(3DS 失敗/放棄)與 retry-action **都**跑 settleCharge → 一試即裁決/釋放、不等 sweeper。**失敗不清車**(只成功清車)→ 車保留可立即重結帳。
- 稽核 PAY-01 下修(單請求 TapPay 同步可分);sweeper(3DS-4)+ TapPay 自身 10-20 分反查 兜底殘餘 orphan。
- 🔴 **此 retry 分支 = 安全要害**:3DS-1b 鐵則 12 codex 關卡2 **必覆蓋**(retry-paid→既有單 / retry-failed→放行 / retry-ambiguous→hold 三測)。

---

## 5. Scope(Sean 已拍)

- **S1 電子發票 = B**:settleCharge 成交點寫「**待開票 durable 表**」(order_id 唯一冪等鍵、3DS-0c、**settleCharge paid 重入不重複開**、非 log;codex r2 consider)+ 告警;發票實作 fast-follow 獨立 plan;初期 Sean 後台手開。
- **S2 退款 = B**:Phase 2 backlog(refund adapter 維持 throw「Phase 2」)。
- **S3 ATM/超商 = B**:Phase 2 backlog(Phase 1 只信用卡 3DS 單段)。

---

## 6. 影響面 + rollback(鐵則 8)

- **改寫**:TapPayChargeAdapter/wire(3DS+payment_url)、ITapPayAdapter port(+recordQuery、charge 回 initiation)、confirmPayment(拆 initiate + 抽 settleCharge)、charge-actions(回 redirect)、useChargePayment(async 六態)、CheckoutSuccess/View(跳轉態)。
- **新增**:webhook_events 表 + orders.cart_session_id + settleCharge use-case + Record API adapter + webhook route + callback route + sweeper cron + CartContext cart_session_id + `TAPPAY_3DS_ENABLED` flag。
- **影響部署**:新 route(Vercel function)+ cron;env 新增 notify/redirect base URL + flag(無新密鑰、TapPay key 已備)。
- **rollback**:forward 重構不 revert f0c359b;Phase I 子片可先 merge/部署(但**不等於開放 prod 結帳**、見 §2 中間態誠實);Phase II 由 `TAPPAY_3DS_ENABLED` flag 控(僅 sandbox/staging)、可關;每子片獨立 commit、未 push 可 reset;migration 走新檔 + rollback SQL;**prod 真實刷卡 = Phase I+II 全到位 + flag on + sandbox 3DS 端到端過 + Sean 肉眼驗**(3DS 啟動與結算同時就緒、無「能刷卡但收不了單」斷層)。

---

## 7. TapPay 實作坑(官方/研究核實、各子片納)

- backend_notify 要 HTTPS 443 + **回 HTTP 200**(否則重送×5)→ handler 冪等。
- payment_url timeout 建議 30 秒(尖峰銀行延遲)。
- 測 3DS **必用未被瀏覽器記住的新卡**(記住的卡跳過 3D)。
- pending 是正常中間態(status=4);TapPay 自己 10-20 分反查(每筆×2)→ 部分 orphan 自動收斂。
- notify **無簽章** → 一律 Record API 反查;**別套綠界 CheckMacValue 式驗章到 TapPay**。
- Record API 有 rate limit(綠界類比打太快 403)→ sweeper 節流 + 隔日批次。
- **Record API 回應(官方 reference.html #record_status anchor 逐字核實、審查側 3DS-1a 複核)**:top `status`(0=查詢成功有紀錄 / 2=無更多)≠ 交易狀態;`trade_records[]` 每筆有 `record_status`(**7 值:-1=ERROR 錯誤 / 0=AUTH 授權未請款 / 1=OK 交易完成 / 2=PARTIALREFUNDED 部分退款 / 3=REFUNDED 完全退款 / 4=PENDING 待付款 / 5=CANCEL 取消交易**)+ `is_captured` + rec_trade_id/order_number/bank_transaction_id/merchant_id/amount/refunded_amount + `number_of_transactions`。**已付款 = record_status=1 且 is_captured=true**(record_status=0 僅授權 → pending)。🔴 **Phase 1(無退款流程)settleCharge 映射:paid=1&&is_captured / pending 保留=0·4·查不到·Record 失敗 / 明確 failed 放行重刷=-1·5 / 2·3 退款=異常走退款片(S2=B backlog)**。filter 支援 rec_trade_id/order_number/bank_transaction_id/time/amount/merchant_id。⚠️ 教訓:錢欄位 enum/wire 的 WebFetch/firecrawl 小模型萃取會幻覺(1a 初版抽出「3=Cancelled」「1=處理中」皆錯)→ 必親讀渲染後 DOM 逐字。

---

## 8. 驗收(yes/no)

- [ ] settleCharge 冪等:三路(callback/webhook/sweeper)任一先到、重入、亂序、**並發**(既有 markCharged FOR UPDATE+rec unique / confirm FOR UPDATE+paid no-op / 待開票 order_id unique 序列化、codex r3 確認足夠)→ 最終一致、不雙 confirm、不雙扣;🔴 **top-level `status !== 0` 不 confirm;`record_status=1 && is_captured=true` 才 confirm;`record_status=0` 保留 pending**(別與 top status 混淆、codex r3)。
- [ ] webhook:notify → durable inbox 去重 → 快回 200 → 背景 settleCharge;背景失敗 sweeper retry(非死信);白名單存欄無 PII raw。
- [ ] callback:Record 查證 paid 才渲染 OrderComplete、否則處理中;redirect 參數零信任。
- [ ] sweeper:Record final-failed/cancel 才判 failed;查不到/pending 保留+告警;rate-limit 節流。
- [ ] cross-tab:兩分頁同 cart→第二筆 begin dedup 擋(回既有單號 processing);clear/成功新 key 不擋;DB 契約完整(null fail-closed/舊版 DROP/GRANT)。
- [ ] 3DS sandbox 端到端(未記住新卡):charge→payment_url→3DS→callback→OrderComplete + webhook 冪等 confirm。
- [ ] 三綠 + 完整 pnpm test + bundle grep(server keys/經銷價零命中)+ 每子片 codex 關卡2 + Sean 肉眼驗。

---

## 9. Prod 上線前硬前置(codex #9)

Phase I 全到位 + 以下:notify 全失敗(×5)告警接入 / Record API 批次對帳節流 / **PAY-06 請款 velocity rate-limit**(防 card testing)/ S1 待開票紀錄+告警 / sandbox 3DS 實刷過 / Sean 肉眼驗。

---

## 10. 禁止清單

— 不改已套用舊 migration(走新檔)/ 不拿掉 paid-exclusion 與同分頁防線 / 不弱化 rec_trade_id UNIQUE / 不採信 notify 欄位(一律 Record 反查)/ 不存 webhook raw 原文(白名單+hash)/ sweeper 不以年齡判 failed / 卡資料零進 state·DOM·server·log / 金額零 client·整數零浮點 / 經銷價零外洩 / 密鑰 server-only / cardholder 零信任 / 不動 .env* / 不 git add .·-A / 不自動 push —
— 禁止清單結束 —

## 11. codex 關卡1 收斂紀錄(r1 FAIL 8 must-fix + 1 consider 全採納)

1. webhook 早到契約沒閉合 → **共用 settleCharge(by orderId、Record 權威)**(§1)。
2. callback/webhook 權威矛盾 → callback 也呼 settleCharge、paid 才渲染(§1/§2 3DS-3)。
3. HMAC 佔位 → WebFetch 核實 **TapPay notify 無簽章**、移除 HMAC、Record API status=0 為唯一權威(§3/§7)。
4. 快回 200 缺 durable 補償 → **durable inbox + sweeper retry worker**(attempt_count/next_retry_at)(§3.2/3DS-4)。
5. cross-tab 契約抄薄 → 3DS-0 照搬 cross-tab plan §4.1 完整(uuid/DROP 舊/null fail-closed/GRANT)(§4)。
6. 子片順序產生不可刷卡中間態 → **Phase I 結算基建先 + feature-flag、Phase II 3DS 啟動最後**(§2)。
7. sweeper 年齡判 failed 誤釋鎖 → **只 Record final-failed/cancel 判 failed**、否則保留+人工(§2 3DS-4/§7)。
8. webhook raw_body PII → **白名單欄位 + hash、不存原文**(§3.4)。
9. (consider)prod 硬前置補 notify 全失敗告警 / Record 節流 / PAY-06 velocity / S1 待開票紀錄(§9)。

### r2(FAIL 4 must-fix + 1 consider → 全採納;關卡1 達 2 輪硬上限、不自動跑 r3、raise Sean)
1. Record API 權威契約不精確 → §1 step 2 + §3.3 + §7 釘死(WebFetch reference 核實:top status≠交易狀態、record_status=1+is_captured=true 才 paid、number_of_transactions=1、鍵全對本機)。
2. settleCharge rec 來源破口(by-orderId-only 無 rec 可查)→ §1 step 1 rec 優先序(attempt 已存 → hint Record-verified → order_number+time window),notify 一律 Record 反查。
3. Phase I 對 prod 3DS merchant 不誠實(flag 關同步 charge 被拒=中斷)→ §2「中間態誠實」:flag 僅 sandbox/staging、prod 結帳 Phase I+II 全到位+flag on 才開、Phase II 切與開放結帳同決策點。
4. 子片過大(鐵則 4)→ 3DS-0 拆 0a/0b/0c、3DS-1 拆 1a(Record adapter)/1b(settleCharge);各 15-45min。
5. (consider)S1 待開票須 durable + idempotent(非 log)→ 3DS-0c 待開票表 order_id 唯一冪等鍵、重入不重複(§5)。
- DB 事實已查證(官方 reference):record_status 0/1/2/3 + is_captured + trade_records 欄位 + top status 語意。

### r3(Sean 授權加跑;FAIL 1 must-fix + 3 consider → 全採納;**收斂 8→4→1**)
1. (must-fix)order_number fallback 沒真閉合(回應遺失本機亦無 bank_txn)→ §1:**bank_transaction_id 送 charge 前產生並 durable 存**、Record 查詢優先序 rec→bank_txn→hint→order_number+窄窗、**條件比對只比本機有的鍵**、純 order_number fallback 加 merchant+amount+created_at 窄窗+count=1 防誤命中。
2. (consider)record_status=0 capture → pay-by-prime `delay_capture_in_days` 預設 0=即時請款、`-1` 才手動 → 3DS-5a **不送 -1**、不需主動 capture、補 test。
3. (consider)驗收「status≠0」易混淆 → §8 改明寫「top status!==0 不 confirm / record_status=1&&is_captured 才 confirm / record_status=0 pending」。
4. (consider)三路並發 Record 重打放大 rate-limit(寫入正確性 codex **確認足夠**:FOR UPDATE+rec unique+paid no-op+待開票 unique)→ 3DS-4 加 per-order recently-settled skip。
- **關卡1 狀態**:r1 8 + r2 4 + r3 1must+3consider 全收斂進 v4;3 輪(含 Sean 授權 r3)收斂 8→4→1、並發正確性 codex 確認、兩臆測(HMAC/record_status)查官方文件正。

### v5(Sean 批准 v4 + D4 override + 4 點折入)
- **A · D4 override**(§1(d)/§4/3DS-0b/3DS-1b/3DS-3):orphan-pending 改「begin 回 needs_settle → action 層 lock 外 settleCharge 三裁決(paid→既有單 / 明確未成功→markFailed 立即重刷 / 模糊→短 hold)」、**失敗不清車**;callback 失敗分支也跑 settleCharge。**安全要害、3DS-1b 關卡2 必覆蓋 retry 三測**。
- **B · 跨 redirect 清車**(3DS-3/3DS-7):3DS 成功是全新 callback 頁、原 useChargePayment.clear() 隨 SPA 消失 → callback 成功渲染時 client 主動清購物車品項 + regenerate cart_session_id。
- **C · webhook 加固**(§3.6/3DS-2):無簽章公開端點 → 自定祕密路徑段 + rate-limit + 對不上本機 order 的 rec 直接丟(不打 Record)。
- **D · 待 sandbox 驗**(3DS-3/3DS-1a):TapPay 失敗/放棄是否導回 frontend_redirect_url;若只成功導回,失敗釋放靠 A 的 retry-action(已覆蓋);非擋批准。
- **流程**:核心架構(initiate/settle 雙半段 + 共用 settleCharge + Record 唯一權威 + feature-flag 中間態誠實)Sean 肯定不動;D4 retry 分支可選 codex 關卡1 複審(Sean 控額度、非強制、3DS-1b 關卡2 亦覆蓋)。Phase I 與 A/B/C/D 不衝突可並行 → 開 3DS-0a。
