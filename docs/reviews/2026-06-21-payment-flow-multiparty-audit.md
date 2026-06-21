# 金流交易流程 四方安全審查(2026-06-21)

> **觸發:** Sean「審視一次我們整個金流交易流程有無漏洞、多方對抗審查、多方資訊交互驗證」(起因:S4 in-flight 時間鎖該縮多久 → 退一步問「業界怎麼解 3DS pending 雙扣」)。
> **方法:** 四方交叉驗證,不單方採信。
> - **Claude(親讀 code)** — 逐檔讀 use-cases / adapters / migrations / storefront,驗「PCM 是否已實作 X」。
> - **Codex(跨模型 code 對抗)** — fresh context、`-s read-only`、自己翻 repo 讀全部金流檔,zero-trace 驗證(`git status --porcelain` 跑前後一致)。
> - **Gemini 3.1 Pro(業界廣度第三眼)** — 以 Stripe/Adyen/Shopify/Braintree 標準對照,業務/UX 視角,plan 模式零留痕。
> - **業界基準** — Stripe idempotency key + PaymentIntent 狀態機 = 北極星。
> **嚴重度判定以 Claude 親讀 code 為準**(Gemini 不讀 code、提原則;Codex/Claude 讀 code 定屬實與否)。
> **狀態:** prod 結帳尚未開放(flag-gated 僅 sandbox),以下皆「prod 開放前要補」、非「現在燒」。

---

## 一、結論一句話

**業界(Stripe/Adyen)防 3DS pending 雙扣不靠「時間鎖」,靠「冪等鍵(idempotency key,綁購物車意圖、存活 24h)+ PaymentIntent 狀態機」。** PCM 的 `cart_session_id` 就是這個機制的雛形,目前**休眠**(前端每次給隨機 UUID)。因此 S4「把 in-flight 時間鎖縮短」是**治標補丁**;**治本是修 `cart_session_id` 成穩定冪等鍵(= 既有 3DS-7),這會讓時間鎖整個可廢除。**

---

## 二、真漏洞分級表

| # | 嚴重 | 漏洞 | 哪方抓 | 交互驗證狀態 | 治本去向 |
|---|---|---|---|---|---|
| **1** | 🔴 最高/治本 | `cart_session_id` 冪等休眠 → 同購買意圖 >10 分鐘可再建單再授權=雙扣 | 四方一致 | ✅ 三方 code 證實 dormant | **3DS-7**(既有、升治本) |
| **2** | 🟠 High(縱深) | confirm RPC 不綁「扣款證據」→ payment_confirmer 憑證若外洩可標任意未付單為已付 | Codex 獨抓 | ✅ Claude 親讀屬實 | **backlog #243** |
| **3** | 🟠 中高 | 四路 settleCharge 無共用節流鎖 → Record API 查詢放大(非雙扣) | Codex + Gemini | ✅ 互補驗證 | **backlog #244** |
| 4 | 🟡 Medium | webhook 限流靠 Vercel WAF、無應用層 rate limit | Codex | 已知設計選擇 | prod 開放前補(本檔 §六) |
| 5 | 🟡 Medium | user_in_flight 是 time lock(偏離業界 idempotency)、且傷轉換率 | Gemini + 業界 | = S4 在碰的 | 由 #1 治本後廢除 |
| 6 | 🟢 Low | 3DS `payment_url` 只驗 HTTPS、未限 TapPay 網域 | Codex | 需 TapPay 回應鏈污染 | prod 開放前補(本檔 §六) |

---

## 三、各漏洞詳述

### 🔴 #1 cart_session_id 冪等休眠(四方一致、治本最高優先)

- **機制:** `create_order`(5-param RPC)設計用 `cart_session_id` 防「同購物車重複建單」(begin_charge_attempt 的 cart-instance dedup,migration `20260613130000` D4:同 cart 已 paid→duplicate、有扣款跡象→needs_settle 交 settleCharge)。但前端 `apps/storefront/src/app/checkout/charge-actions.ts` 每次結帳呼 `randomUUID()` 產新 key → 同一購物車重複結帳也是不同 key → **去重永遠 0 sibling、機制休眠**。`packages/use-cases/src/confirm-payment.ts` L52-53 已自行文件化此 dormancy。
- **後果:** 目前防雙扣只剩 `user_in_flight` 10 分鐘時間鎖這塊遮羞布。情境:消費者進 3D 驗證頁拖延 >10 分鐘、鎖過期,他回頭重結帳 → 系統建第二張單、發第二次 TapPay 授權 → 第 15 分鐘他在舊頁輸 OTP 成功 → **雙扣**。
- **嚴重度:** 🔴 最高(四方一致;Claude 親讀 + Codex code + Gemini 業界 + Stripe 北極星全指此)。
- **治標:** 縮短 user_in_flight 時間鎖(= S4)。脆弱、且 codex 在 S4 plan K1 已證縮窗會引入新雙扣縫(3D 頁仍活著的 pending)。
- **治本:** 修 `cart_session_id` 成穩定 client cart key(購物車生命週期內穩定、成功頁才 regenerate)+ 後端 DB 對 `(customer_user_id, cart_session_id)` 冪等裁決 24h。**= 既有 3DS-7,本審查升為治本最高優先。** 修好後 time lock 可廢除(對齊業界)。

### 🟠 #2 confirm RPC 不綁「扣款證據」(Codex 獨抓、Claude 親讀屬實)

- **機制:** `supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql` 的 `confirm_order_payment` PF-D 冪等樹(L149-184)只驗:① order 為 unpaid ② `p_amount = orders.total`(整數)③ `rec_trade_id` 非空且未跨單重用。**不要求「同 order/rec 存在一筆 charged 的 payment_charge_attempt」當扣款證據。**
- **設計脈絡(誠實):** migration header L20-24 明白標示 PF-X1/X2/X3「charge 編排層責任、本片純 DB RPC 無法獨力解」—— 設計**刻意**把扣款證據驗證委派給 use-case 編排層(settleCharge 走 Record API record_status∈{0,1};confirmPayment 走 charge 成功 + PF-X3 金額)。正常運作下,confirm 被編排層的扣款驗證保護。
- **後果(縱深缺口):** 若 `payment_confirmer` 憑證(server-only env)外洩,攻擊者**繞過 use-case 直連 DB** 呼 confirm,只要給「正確 order_id + 正確 amount(可從 order 讀)+ 任一未用過的 rec_trade_id」就能把任意未付單翻 paid —— 沒有「DB 層自證真有扣款」。同步路徑下 markCharged 失敗後仍會續呼 confirm(Codex 點)。
- **嚴重度:** 🟠 High(縱深;**前提是憑證外洩**、非無前提可利用 → 非 critical)。payment_confirmer 已是零 table 權限 + 雙向 never-GRANT-role + search_path='' 的窄權角色,本 finding 是「把扣款證據檢查也拉進這道防線」。
- **治本:** confirm RPC 改收 `attempt_id`、`FOR UPDATE` 驗該 attempt 屬同 order + status='charged' + rec 相符;或更佳——把 markCharged + confirm 併成單一原子 `settle_paid_attempt` RPC(一個臨界區內驗扣款證據 + 翻 paid,消除兩步之間的信任缺口)。**= backlog #243。**

### 🟠 #3 四路 settleCharge 無共用節流鎖(Codex + Gemini 互補)

- **機制:** settleCharge 由四路共呼(callback / webhook / sweeper / 輪詢)。只有**輪詢**那路有 durable per-order throttle(`claim_order_poll_settle`,S2b migration `20260621120000`);callback / webhook / sweeper **沒有**共用 lease。
- **後果:** 四路在 OTP 成功瞬間幾乎同時觸發,各自打 TapPay Record API 反查 → **Record API 查詢放大、配額消耗、卡單**。⚠️ **這不是「雙重標 paid」**(那層已防,見 §四),是「Record 查詢放大」。Gemini 擔心的是雙重 settle 競態(已防),Codex 點更精準=查詢放大(只輪詢有 throttle)。
- **嚴重度:** 🟠 中高(非資金安全、是穩定性/配額;高併發下會放大)。
- **治本:** 抽共用 `claim_order_settle(order_id, caller, throttle)` RPC,四路都先 claim 再 settle(對齊 S2b 輪詢已有的 per-order throttle family)。**= backlog #244。**

### 🟡 #4 webhook 限流靠 WAF(Codex)
- `apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts` 只有密路徑 + 靠 Vercel WAF 限流,無應用層 rate limit。secret 若洩漏 → 灌 inbox / 耗 Record 配額 / 推 manual review。prod 開放前補:應用層 rate limit + per-order/per-rec 配額 + TapPay IP allowlist。

### 🟡 #5 user_in_flight time lock 偏離業界(Gemini + 業界)
- per-user 10 分鐘鎖(`begin_charge_attempt`,最新版 migration `20260613140000` 0c)是 time-based,業界用 idempotency。副作用:消費者刷卡失敗想立刻換卡/改買被鎖 10 分鐘 = 傷轉換率。**由 #1 治本後整個廢除。** S4 縮窗只是治標(見 §五)。

### 🟢 #6 payment_url 網域 allowlist(Codex)
- 3DS `payment_url` 目前只驗 `isHttpsUrl`(N1、較鬆),未限 TapPay 網域。低風險(需 TapPay 回應鏈被污染)。prod 開放前補:依 `TAPPAY_ENV` 設 TapPay host allowlist。

---

## 四、交互驗證擋掉的「假警報」(多方價值的體現)

> 這是「多方資訊交互驗證」的核心收穫:Gemini 提的兩個 Critical 都被 Claude/Codex 親讀 code 推翻。Gemini 不讀 code、靠流程推論,容易把「業界常見坑」直接當成 PCM 的坑。

1. **Gemini「四路並發會雙重標 paid(Critical)」→ 假警報。**
   Claude 親讀:`confirm_order_payment` 已有 PF-B `SELECT ... FOR UPDATE`(L137-142)鎖 row 臨界區 + PF-C `UPDATE ... WHERE payment_status='unpaid'`(L177-184)樂觀鎖 + row_count 守 + PF-D 冪等判斷樹(paid+同 rec+同 amount→no-op)。Codex 也獨立確認「DB confirm 冪等能防偽 paid」。**三方收斂:這層已正確防護**(正是 Gemini 自己開的「治標方案 A/B」,PCM 早已實作)。
2. **Gemini「孤兒帳款:sweeper 盲標 failed + 釋庫存給別人(Critical)」→ 大幅降級。**
   Claude 親讀 `packages/use-cases/src/sweep-settlements.ts` L27:sweeper「不以年齡判 failed、只 Record final-failed/cancel 才 markFailed、不釋已 charged 鎖」=**對帳裁決非盲標**;且 PCM 是**訂貨型**(海外調貨、不鎖庫存,#161)→「釋庫存給別人」不適用。**降級**(「Late Success」對帳由 settleCharge 四路共呼覆蓋;殘留「charged 但 callback/webhook 都漏」由 sweeper 收斂)。

> 另:金額竄改(PF-X3 + confirm 整數比對 `p_amount=orders.total`,雙 server 權威縱深)= 紮實,四方無異議。

---

## 五、S4 重新定位:治標 → 治本

- **S4 原案** = 把 user_in_flight 鎖 10 分鐘縮到 3 分鐘(Sean 原拍 Q1=A 只縮 pending、Q2=3 分)。
- **四方一致結論:time lock 是錯的工具。** 縮窗:① 治標(沒解休眠的 idempotency)② codex S4 plan K1 已證縮窗引入**新雙扣縫**(縮窗後 3D 頁仍活著的 pending,客人縮窗外完成 OTP)③ Gemini:時間鎖傷轉換率。
- **而且 prod 結帳還沒開、現在沒真流量** → 不必急著治標。
- **決議(Sean 2026-06-21 拍 Q1=A):暫停 S4 縮窗,把力氣放治本 idempotency(提前做 3DS-7)。** user_in_flight 維持現況 10 分鐘(不縮、不引入新縫),等 3DS-7 落地後連同 time lock 一起退場。

---

## 六、prod 結帳開放前 top 3(四方共識 + 業界依據)

1. **🔴 修 cart_session_id 成穩定冪等鍵(= 3DS-7)** — 治本雙扣、對齊 Stripe idempotency key;修好才能安全廢除傷轉換率的時間鎖。
2. **🟠 confirm RPC 綁扣款證據(= #243)** — 縱深防 payment_confirmer 憑證外洩偽造 paid;業界 confirm/capture 必以「真實 charge 證據」為前提。
3. **🟠 四路共用 settle lease(= #244)** — 防 Record API 查詢放大(Webhook/Polling at-least-once delivery 是分散式常態)。

**次優先(prod 開放前一併補,目前先記本檔、開放規劃時納入):** #4 webhook 應用層 rate limit + TapPay IP allowlist;#6 payment_url TapPay 網域 allowlist。

---

## 七、後續追蹤

- **#1 → 3DS-7**(既有,本審查升為治本最高優先;STATUS 下一步已重定位)。
- **#2 → backlog #243**(confirm RPC 綁扣款證據 / settle_paid_attempt 原子化)。
- **#3 → backlog #244**(四路共用 settle lease)。
- **#4 / #6** → 本檔 §六 次優先,prod 開放規劃時納入(屆時編號)。
- **每一項實作各為鐵則 8/12 重大改動,須各自走 plan + codex 雙關卡 + Sean 拍板**,本審查只定方向與優先序、不動 code。

## 八、四方原始輸出(zero-trace、不入 git)

- Gemini:`/tmp/gemini-flow-out.txt`(80 行,業界 5 題)。
- Codex:`/tmp/codex-flow-out.txt`(zero-trace OK,逐面 findings)。
- 兩者皆暫存 /tmp、本機 session 內、不提交;findings 已 triage 入本檔。

— END —
