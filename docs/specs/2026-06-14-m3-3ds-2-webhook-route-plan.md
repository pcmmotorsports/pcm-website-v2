# Slice Plan:3DS-2 ②-⑥ webhook route(`app/api/checkout/tappay-notify`)

> 作者:Claude Code(執行側、自驅 SOP step 2)/ 日期:2026-06-14
> 真權威:`docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` v5 §2(3DS-2 列)/ §3(webhook 規格)/ §7(TapPay 坑)/ §9(prod 前置)
> 鐵則:**8**(新 API route + 新 port `IWebhookInbox` + 新 adapter `PgWebhookInboxAdapter` + composition factory + 新 env)+ **12**(payment / 對帳 / **未驗證公開寫入口**)→ codex 關卡1(本檔)+ 關卡2(diff)+ code-reviewer
> 決定來源:Sean 2026-06-14 拍 **B**(照原計畫做 3DS-2、db push 等整批 3DS Phase I + cart_session_id 整合都好再一次做、最小偏離、保持節奏、零急迫)
> **codex 關卡1 r1 = FAIL**(2 must-fix〔inbox 膨脹/sweeper 真空〕+ 4 consider)→ **v2 全 fold**(見 §13)。
> **狀態:v2、待 codex 關卡1 r2 複審 + Sean 批(§7 決策 Q1 + 起手檢查處置 + env 前置)。批准前不寫 code。**

---

## ① 任務目標(1-2 句)

建 TapPay backend notify 的 webhook route `app/api/checkout/tappay-notify/[secret]`:notify **不可信**(無簽章)→ 驗祕密路徑段 → **對得上本機 active attempt 才 durable insert inbox 去重**(0a `record_webhook_event` RPC、by rec_trade_id)→ **先落 DB 再快回 200**(令 TapPay 不重送)→ best-effort 背景 `settleCharge`(3DS-1b 已就緒)快路徑結算。

🔴 **誠實邊界(codex r1 must-fix 2)**:3DS-2 只提供 **durable 捕獲(inbox)+ best-effort 快路徑結算**;**最終結算保證 = 3DS-4 sweeper(尚未實作)**。3DS-4 完成前:**不設 TapPay backend_notify_url、不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳**(master §2 中間態誠實);此期間零真實 notify 流量。

## ② 背景與既有依賴(全已就緒、零新增 DB)

- **0a inbox 已就緒**(migration `20260613120000`、在 db push bundle):`payment_webhook_events` 表(rec_trade_id PK 去重 / 白名單欄 + raw sha256 hash 不存原文 / processed·attempt_count·next_retry_at 供 sweeper / RLS 零 policy)+ `record_webhook_event(p_rec_trade_id, p_order_number, p_raw_hash, p_reported_status?, p_amount?, p_bank_transaction_id?, p_transaction_time_millis?) → boolean`(INSERT ON CONFLICT DO NOTHING、回 inserted;唯 `payment_confirmer` EXECUTE;入口 fail-closed 長度/格式 CHECK)。
- **3DS-1b settleCharge 已就緒**(`packages/use-cases/src/settle-charge.ts`、commit 28425e1):`settleCharge(deps, { orderId, recTradeIdHint? })`。step 1 `findActiveByOrderId(orderId)` 為 null → 回 `no_attempt`(**對不上本機單 → 不打 Record API**);全 throw fail-closed → pending。
- **cookieless 注入已就緒**:`getSettleChargeDeps()`(`lib/payment/composition.ts:108`、主軌-only `PgChargeAttemptAdapter`〔含 `findActiveByOrderId`〕+ `getPaymentConfirmer` + `getTapPayAdapter`、無 cookie 依賴)。
- **連線縱深已就緒**:`buildPgConfig`(session pooler + 完整 CA + host 釘死 + 顯式 servername、剝 SSL 參數;`PaymentConfirmerAdapter.ts:80`)。新 webhook inbox adapter **複用** buildPgConfig、零新連線安全面。
- **既有 route 慣例**:`app/api/auth/line/callback/route.ts`(`runtime='nodejs'`、`timingSafeEqual` 等長先檢 `safeEqual`、相對 redirect 不上洩、try 外單點)。本片沿用 nodejs runtime + timing-safe 比對慣例。
- **既有缺口**:codebase **無任何 rate-limit 實作**(grep 0 命中)→ §5/§7 Q1 決策。
- **Next 16.2.6**:`after()`(`next/server`)穩定 → 回 200 後背景 settleCharge 的標準原語(⚠️ best-effort、見 §3/§8、非 durable queue)。

## ③ 🔴 架構決策(最小偏離、零新 migration)

1. **3DS-2 = 純 code、零 migration**(對齊 Sean B「最小偏離」+ 不再加東西進已卡的 db push bundle)。inbox 表 + record RPC 全在 0a;3DS-2 只**消費** 0a RPC。
2. **inbox processed 生命週期(mark RPC)歸 3DS-4 sweeper**(其天然擁有者)。3DS-2 route 走「**對得上本機單才** insert + 200 + `after(settleCharge)` 快路徑」、**不寫回 processed**。
   - 🔴 **誠實(codex r1 must-fix 2)**:`after()` 在 Vercel serverless 為 **best-effort**(只保證 function max duration 內跑、timeout 會被取消、**非 durable queue**)→ **不可當最終保證**。最終結算保證 = **3DS-4 sweeper(尚未實作)** 掃 inbox `processed=false` 重跑 settleCharge。3DS-4 完成前 3DS-2 **單片不具最終結算保證**,只具「durable 捕獲 + best-effort 快路徑」。因 3DS-4 前不會有真 notify 流量(§1 硬 gate),此中間態零實害、且誠實揭示。
   - 快路徑只賺延遲(webhook 到後幾秒內結算、不等下次 cron tick);settleCharge 冪等(markCharged FOR UPDATE + rec unique / confirm paid no-op / step2 已 paid 短路不打 Record)→ 快路徑與 sweeper 重跑零副作用。→ **3DS-2 不碰 db push bundle**。(§7 Q3=A、我判定。)
3. **分層**:delivery route → composition factory → adapter,守 eslint boundaries(§附錄)。route 不直接碰 `@pcm/adapters/server`(eslint 擋)、改 import composition `getWebhookInbox()` / `getSettleChargeDeps()` + `@pcm/use-cases` settleCharge(charge-actions 既有同款 import)。
4. **新 port + adapter**(對齊 hexagonal):`IWebhookInbox.recordEvent(input) → Promise<boolean>` + `PgWebhookInboxAdapter`(payment_confirmer 窄權、複用 buildPgConfig、呼 0a record RPC)。markProcessed 不在本片(3DS-4 加)。

## ④ 改點(精準檔案清單)

**新增:**
1. `packages/domain/src/payment/*.ts`(既有 payment 型別檔)+ barrel:`WebhookEventInput`(recTradeId / orderNumber / rawHash / reportedStatus? / amount? / bankTransactionId? / transactionTimeMillis?,皆對齊 0a 白名單)。
2. `packages/ports/src/IWebhookInbox.ts`:`interface IWebhookInbox { recordEvent(input: WebhookEventInput): Promise<boolean> }`(回 inserted:true=首見、false=重送)+ `packages/ports/src/index.ts` 加 `export type * from './IWebhookInbox'`。
3. `packages/adapters/src/payment/PgWebhookInboxAdapter.ts`(server-only、複用 `buildPgConfig`、`SELECT public.record_webhook_event($1..$7) AS result`、parse boolean、per-request connect/finally end、PF-E 不轉傳 pg 原文)+ `packages/adapters/src/server.ts` export + `PgWebhookInboxAdapter.test.ts`。
4. `apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts`(POST、`runtime='nodejs'`)+ `route.test.ts`。

**修改:**
5. `apps/storefront/src/lib/payment/composition.ts`:加 `getWebhookInbox(): IWebhookInbox`(`new PgWebhookInboxAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'))`、同受控 eslint-disable 門)。
6. docs:`docs/design-storefront-manifest.yaml`(新 route 登記、如適用)+ 本 plan 標實作後狀態 + STATUS 7 欄。

**新 env(Sean 設):** `TAPPAY_NOTIFY_PATH_SECRET`(祕密路徑段、高熵亂數 ≥32 字元 URL-safe;只告訴 TapPay backend_notify_url、外人猜不到)。`PAYMENT_CONFIRMER_DB_URL` / `TAPPAY_*` 既有。

**route POST 處理序(精準、含 codex r1 修正)**:
1. `safeEqual(params.secret, requireNotifySecret())` 不符 → **404**(generic、不揭存在)。`requireNotifySecret()` = `requireEnv` + 強度斷言(長度 ≥32、URL-safe `[A-Za-z0-9_-]`、不含 `/`)、弱 secret → **500 fail-closed**(設定錯不得放行;codex consider 2)。
2. 讀 raw body **text**(先設 body size cap、超過 → 413、不解析、不落地;codex consider 3);**先**算 raw body sha256 hex(`node:crypto`、hash-before-parse)。
3. 解析(content-type 實作前官方核實、見 §10 step 2)→ 取白名單欄 `rec_trade_id` / `order_number` / `reported_status` / `amount` / `bank_transaction_id` / `transaction_time_millis`。🔴 **malformed/unparseable body**(JSON/form 解析失敗、codex r2 consider 5)→ 取不到 rec_trade_id/order_number → 直接落入 step 4 缺鍵 drop = **200 ack drop**(不 4xx、不重送垃圾、不落地);解析失敗本身不上洩、不 log payload。
4. 廉價 drop(無 DB):`rec_trade_id` 缺 / `order_number` 缺 / `order_number` 非 UUID 形狀 / body malformed 取不到鍵 → **200 ack drop**(不 insert、不打 Record、不重送垃圾)。
5. 🔴 **本機 order 存在性閘(codex r1 must-fix 1)**:`deps = getSettleChargeDeps(); attempt = await deps.attempts.findActiveByOrderId(order_number)`。throw → **503**(fail-closed、TapPay 重送);`null` → **200 ack drop**(對不上本機單 → 不 insert、不打 Record);found → 續(satisfies master §3.6「對不上直接丟」字面、inbox 不膨脹)。
6. `inserted = await getWebhookInbox().recordEvent({...})`:throw → **503**(durable 落 DB 失敗 → 令 TapPay 重送、絕不丟失)。
7. `if (inserted) after(() => settleCharge(deps, { orderId: order_number }).catch(logErr))`(best-effort 快路徑;重送 inserted=false → 不重觸)。
8. 回 **200**。

## ⑤ 🔴 Hardening C(Sean、未驗證公開寫入口三件;master plan §3.6)

公開無簽章端點 = 任何人可 POST → 縱深:

1. **自定祕密路徑段 + 強度 enforce**:`/[secret]`,route 內 `safeEqual(params.secret, requireNotifySecret())`(timingSafeEqual 等長先檢、沿用 line callback `safeEqual`)。不符 → **404**。🔴 `requireNotifySecret()` **程式碼強制** secret 長度 ≥32 + URL-safe + 不含 `/`,弱/誤設 → 500 fail-closed(codex consider 2:env 誤設短字串時 `safeEqual` 仍會接受、故 code 端把關)。→ 擋掉所有不知密的匿名灌入。
2. **對不上本機 order 的 rec 直接丟(不打 Record + 不落 inbox)**:三層 ——
   - route 廉價過濾(§4 step 4):`rec_trade_id`/`order_number` 缺 或 `order_number` 非 UUID → 200 drop、零 DB。
   - 🔴 **本機 active attempt 存在性閘(§4 step 5、codex r1 must-fix 1)**:insert「前」`findActiveByOrderId`;`null` → 200 drop **不 insert**(故 UUID 形狀的假單**不膨脹 inbox**、真正滿足 master §3.6);讀失敗 → 503 fail-closed(不誤 drop 真 notify)。
   - settleCharge step 1 backstop:即使漏網,`findActiveByOrderId` null → `no_attempt`,Record API step 3 才呼 → 永不對不上本機單打 Record(1b 既有)。
3. **端點 rate-limit**:見 §7 Q1。secret 路徑(強度 enforce)+ 存在性閘 + 去重 + 長度 CHECK 已大幅界定濫用面;hard 端點限流 = **平台層 Vercel Firewall/WAF**(對 `/api/checkout/tappay-notify/*`)、列 **「啟用任何 TapPay notify URL 前」硬 gate**(§14 Prod 前置 checklist;與 PAY-06 請款 velocity rate-limit 為**不同**防線、codex consider 1)。

**為何 §3.2 durable-first 與 §3.6 drop-unmatched 不衝突**:secret 路徑 + UUID 過濾 + 本機存在性閘在 insert「前」確認「對得上本機單」(真 notify 不漏:initiate〔3DS-5b〕在送 charge 前 durable 存 attempt → 任何合法 notify 抵達時 attempt 必已存在、不會誤 drop);通過者才 durable insert;對不上者零 insert 零 Record。三者分工、不互斥。

## ⑥ 影響面 + rollback(鐵則 8)

- **新增**:1 route(Vercel function)+ 1 port + 1 adapter + 1 composition factory + 1 domain 型別 + 1 env。**零 schema 變動、零 migration、零 db push bundle 影響**(§3.2)。
- **無權限/RLS/GRANT 變動**:inbox 表/RPC 權限全在 0a(payment_confirmer EXECUTE);route 走 PAYMENT_CONFIRMER_DB_URL 既有鑰、零新密碼。
- **無前端變動**(webhook 為後端對 TapPay 入口);**不碰** charge-actions / CheckoutView / useChargePayment(那些在 3DS-3/3DS-6)。
- **影響部署**:新 serverless function(`/api/checkout/tappay-notify/[secret]`);新 env `TAPPAY_NOTIFY_PATH_SECRET`。
- 🔴 **硬 gate(codex r1 must-fix 2、master §2 中間態誠實)**:3DS-4 sweeper 完成前 **不設 TapPay backend_notify_url、不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳**;Vercel Firewall/WAF 在「啟用任何 notify URL 前」必設。此前 3DS-2 純為 Phase I 基建、零真實流量。
- **rollback**:forward;route + adapter + port + composition factory 為新增、單 commit 可 reset;未 push、未部署 → 對 prod 零影響。

## ⑦ 決策 forks

**🔴 Q1(唯一需 Sean 拍 — 業務/infra)— webhook 端點 rate-limit 現在怎麼做?**
- **A【建議】平台層 hard 限流(WAF)+ 應用層廉價防濫用,3DS-2 不寫 code 限流**:3DS-2 靠「祕密路徑段〔強度 enforce〕+ orderId UUID 過濾 + **本機 active attempt 存在性閘**〔不落 inbox〕+ rec_trade_id 去重 + 0a 長度 CHECK」;hard 端點限流交 **Vercel Firewall/WAF**(對 `/api/checkout/tappay-notify/*`)、列 **「啟用任何 TapPay notify URL 前」硬 gate**(§14 Prod 前置 checklist、與 §1/§6 中間態 gate 同時點)。理由:Phase I flag off 零 3DS 流量、secret 路徑已擋匿名、serverless 無共享記憶體(robust 限流本就需平台/外部 store)。🔴 釐清:此「端點 WAF」≠ PAY-06「請款 velocity rate-limit」(防 card testing、§9 另列、Phase II 接 charge 時做)。
- **B** 現在接 Upstash/Redis 分散式限流(新相依 + Vercel marketplace + 新 env、擴 scope)。
- **C** 現在加 best-effort 記憶體限流(per-instance、serverless 跨實例不可靠、價值低)。

**Q2(我判定 = 拆,鐵則 4)**:3DS-2 拆 **2a**(domain 型別 + `IWebhookInbox` port + `PgWebhookInboxAdapter` + composition + adapter test)/ **2b**(route + route test + Hardening C + 存在性閘)兩 slice、各 15-45min,對齊 0a/0b/0c + 1a/1b 拆法。**除非 Sean 反對、預設拆。**

**Q3(我判定 = A)**:inbox processed mark RPC 歸 **3DS-4 sweeper**(§3.2)→ 3DS-2 零 migration、不碰 db push bundle。

**起手檢查處置(codex r1 consider 4 + 鐵則「不綠停下」)**:工作樹現有 [CheckoutView.tsx](apps/storefront/src/components/CheckoutView.tsx) 2 行純縮排未提交(Sean 既存)+ `.playwright-mcp/` 未追蹤。**code slice(2a/2b)開工前須回到 clean**,請 Sean 拍板處置(見對話決策題)。本 plan doc 與 2a/2b commit 無關、可先存。

## ⑧ 安全 / 鐵則 12 要點(codex 關卡 1/2 請重點審)

- **durable-first fail-closed**:`findActiveByOrderId` throw / `recordEvent` throw → route **回 5xx(非 200)** 令 TapPay 重送(at-least-once)→ 絕不「沒落 DB 卻回 200」丟失 notify。唯有 durable insert 成功(或明確 drop:secret 不符 404 / 缺鍵·非 UUID·無本機單 200)才回非-5xx。
- **best-effort 邊界誠實**:`after(settleCharge)` 非 durable queue → 3DS-2 不宣稱最終結算保證;最終保證 = 3DS-4 sweeper(硬 gate §1/§6)。
- **不採信 notify 任何欄位做成交判斷**:route 只取白名單欄落 inbox(稽核)+ 觸發 settleCharge;成交權威 100% 在 settleCharge 內 Record API(record_status=1 && is_captured)。
- **PII 零落地**:route 算 raw body sha256 落 `raw_hash`(**hash-before-parse**)、**不存原文**(避 masked_credit_card_number / card_identifier);白名單欄僅 rec_trade_id/order_number/status/amount/bank_transaction_id/time;**body size cap**(超過 413、不解析);**log 零 raw/parsed payload**(只 orderId/rec/error label)。
- **卡資料 / 經銷價 / 密鑰**:route 零碰卡資料、零經銷價、TAPPAY/DB 鑰 server-only(runtime nodejs + composition 受控門 + 不進 client bundle)。
- **背景錯誤吞並 log**:`after(settleCharge)` 內 throw 全 catch + log(orderId 級、零 PII)、不影響已回的 200;sweeper(3DS-4)為保證。
- **冪等**:重送同 rec_trade_id → 0a ON CONFLICT DO NOTHING(inserted=false)→ 不重複 settleCharge 快路徑(只首見觸發);settleCharge 自身亦冪等(雙保險)。

## ⑨ 測試計畫

- **adapter**(`PgWebhookInboxAdapter.test.ts`、fake PgClientLike):① 首見 → true ② 重送 → false ③ RPC 回非 boolean → throw ④ connect/query throw → 傳遞(PF-E 不洩內部)⑤ 7 參數正確繫結(含 null 選填)。
- **route**(`route.test.ts`、mock composition + settleCharge + after):
  - secret:① 不符 → 404、零 DB、零 settle ② 弱/誤設 secret(<32 / 含 `/`)→ 500、不放行。
  - drop:③ rec_trade_id 缺 → 200 drop、零 DB ④ order_number 缺 / 非 UUID → 200 drop、零 DB ⑤ findActiveByOrderId null → 200 drop、**不 insert**、零 Record。
  - happy:⑥ 合法首見 + 本機單存在 → recordEvent 呼、200、after(settleCharge) 排程 ⑦ 重送(inserted=false)→ 200、**不**排 settleCharge。
  - fail-closed:⑧ findActiveByOrderId throw → **503** ⑨ recordEvent throw → **503**(令 TapPay 重送)。
  - PII / parse(codex consider 3):⑩ raw_hash = body sha256(**parse 前**算)⑪ content-type matrix(JSON / form-urlencoded / malformed body → 安全 ACK 策略)⑫ oversized body → 413、不解析、不落地 ⑬ log assertion:無 raw/parsed payload ⑭ settleCharge throw(after 內)→ 已回 200 不受影響。
- 動共用 port/adapter → 跑**完整 pnpm test**(非子集、memory `run-full-vitest-after-shared-component-change`)。

## ⑩ 執行步驟(Sean 批 + codex 關卡1 r2 PASS + 起手檢查回綠 後)

1.(若 Q1 需)依 Sean 拍定 rate-limit 路線定稿 §5/§7。
2. 親讀 TapPay 官方 backend notify payload 格式(content-type + 欄位名)逐字核實(memory `webfetch-money-enum-hallucination-read-dom`:錢/enum 欄位不信小模型萃取);欄位集已由 0a 白名單鎖定、本步確認 wire 對映 + content-type(JSON / form)→ 鎖進 §9 ⑪ parse 測試。sandbox 端到端最終驗在 3DS-3(Sean D)。
3.(2a)domain 型別 + port + adapter + composition + adapter test。
4.(2b)route + Hardening C + 存在性閘 + body cap + route test。
5. /slice-checkpoint 三綠(動 .ts → typecheck+lint+build)。
6. code-reviewer(必跑)+ codex 關卡2(鐵則 12)。
7. commit(精準 add、STATUS 7 欄、busboy-end);**不 push、不 db push**。

## ⑪ 驗收(yes/no)

- [ ] secret 不符 → 404、零 DB、零 settle;弱/誤設 secret → 500、不放行。
- [ ] 合法首見 + 本機單存在 → durable insert(0a RPC)→ 200 → 背景 settleCharge 排程。
- [ ] 重送同 rec_trade_id → inserted=false、200、不重觸快路徑。
- [ ] order_number 缺/非 UUID / rec_trade_id 缺 → 200 drop、零 DB。
- [ ] **findActiveByOrderId null → 200 drop、不 insert(inbox 不膨脹)、零 Record**(codex r1 must-fix 1)。
- [ ] findActiveByOrderId throw / recordEvent throw → route 回 5xx(TapPay 重送)、不丟失。
- [ ] raw_hash = body sha256(parse 前算、不存原文、PII 零落地);oversized → 413;log 零 payload。
- [ ] route 零碰卡資料/經銷價;TAPPAY/DB 鑰不進 client bundle(grep)。
- [ ] 零 migration、零 schema 變動、db push bundle 不變。
- [ ] **plan/STATUS 不宣稱 3DS-2 單片具最終結算保證**;3DS-4 前不設 notify URL / 不開 flag / 不開 prod 結帳硬 gate 入文(codex r1 must-fix 2)。
- [ ] 三綠 + 完整 pnpm test + code-reviewer PASS + codex 關卡2 PASS。

## ⑫ 禁止清單(基線)

- 不採信 notify 欄位做成交判斷(一律 settleCharge Record 反查)/ 不存 webhook raw 原文(白名單 + sha256 hash)/ 不弱化 rec_trade_id 去重 / durable insert 失敗不可回 200 / **對不上本機 active attempt 不可 insert inbox**。
- 🔴 不宣稱 3DS-2 單片具最終結算保證(只 durable 捕獲 + best-effort 快路徑);3DS-4 前不設 TapPay backend_notify_url、不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳、不省 Vercel Firewall/WAF。
- 不碰 charge-actions / CheckoutView / useChargePayment(3DS-3/6 範圍)/ 不碰 CheckoutView.tsx(Sean 既存未提交)。
- 不加 migration / 不動 schema / 不碰 db push bundle / 不動權限·RLS·GRANT(全在 0a)。
- 不動 .env*(Sean 自設 TAPPAY_NOTIFY_PATH_SECRET)/ 不繞 eslint boundaries(route 走 composition、不直 import @pcm/adapters/server)。
- 不 git add . / -A(精準 add)/ 不自動 push / 不自行 db push。
- 卡資料零進 state·DOM·server·log / 金額整數零浮點 / 經銷價零外洩 / 密鑰 server-only。
— 禁止清單結束 —

## ⑬ codex 關卡1 r1 收斂紀錄(FAIL 2 must-fix + 4 consider → v2 全 fold)

1. **(must-fix)inbox 膨脹**:UUID 形狀假單只靠 settleCharge no_attempt 擋 Record、未擋 inbox insert、與 master §3.6 drift → **加本機 active attempt 存在性閘**(insert 前 `findActiveByOrderId`、null=200 drop 不 insert、throw=503)。§4 step5 / §5.2 / §11。
2. **(must-fix)sweeper 真空 + after() best-effort**:3DS-4 未實作、`after()` 非 durable queue → **誠實降級**:3DS-2 只宣稱 durable 捕獲 + best-effort 快路徑;硬 gate 3DS-4 前不設 notify URL/不開 flag/不開 prod 結帳。§1/§3.2/§6/§11/§12。
3. **(consider)Q1 措辭**:端點 WAF ≠ PAY-06 velocity → §7 Q1 A 改寫「3DS-2 不寫 code 限流;Vercel Firewall/WAF 對該路徑 = 啟用 notify URL 前硬 gate」+ 標與 PAY-06 區分。§5.3/§7。
4. **(consider)secret 強度**:env 誤設短字串 `safeEqual` 仍接受 → `requireNotifySecret()` code enforce ≥32 + URL-safe + 不含 `/`、弱→500。§4 step1/§5.1/§9。
5. **(consider)parse 行為未鎖測試**:content-type/malformed/oversized/缺欄位 → §9 補 content-type matrix + body size cap + hash-before-parse + log 零 payload;§10 step2 先官方核實 content-type。
6. **(consider)起手檢查不綠**:CheckoutView.tsx/.playwright-mcp → §7 列「code slice 開工前回 clean、Sean 拍處置」。

## ⑭ Prod 前置 checklist(consolidated;codex r2 consider 2 + nit 3)

「啟用任何 TapPay backend_notify_url / 開放 prod 結帳」前,以下**全部**到位(散見 §1/§6/§7/§12 之集中清單):
- [ ] **3DS-4 sweeper 已實作**(最終結算保證;3DS-2 單片只 durable 捕獲 + best-effort)。
- [ ] **Vercel Firewall/WAF** 對 `/api/checkout/tappay-notify/*` 已設(端點 hard 限流;≠ PAY-06 velocity)。
- [ ] `TAPPAY_NOTIFY_PATH_SECRET` 已設(≥32 URL-safe、route `requireNotifySecret()` enforce)。
- [ ] **此前不設 notify URL、不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳**(master §2 中間態誠實)。
- [ ] PAY-06 請款 velocity rate-limit(防 card testing)= 另一防線、Phase II 接 charge 時做(master §9)。

## ⑮ 跨片 follow-up(codex r2 consider 1、不在本片做)

**3DS-5b** plan/test 必明列 **call order**:initiate「**送 TapPay charge 前** durable 建 active attempt」(attempt durable write happens-before charge call)。此為 3DS-2 存在性閘「合法 notify 不誤 drop」的上游契約前提(master §1/§2 已定、3DS-5b 補測證實)。

## 附錄:eslint boundaries 摘錄(餵 codex 關卡1、memory `codex-k1-feed-boundaries-config`)

- `boundaries/dependencies`(eslint.config.js §4.2):adapters → 只 import domain + ports;use-cases → domain + ports;delivery(apps/storefront)可 import use-cases + ports + domain。
- `no-restricted-imports`(L113-126):storefront 任何檔**禁** import `@pcm/adapters/server`(+ `/**`)→ 唯 `lib/payment/composition.ts` 以 inline `eslint-disable-next-line no-restricted-imports` + 意圖註解開「受控小門」。新 `getWebhookInbox` 在同檔同門下、route 只 import composition factory + `@pcm/use-cases`、零違規。
- `PgWebhookInboxAdapter` 屬 adapters element、`import 'server-only'`、只 import pg + `@pcm/ports`(IWebhookInbox)+ domain(WebhookEventInput)+ 同檔 buildPgConfig export → 不違反 adapters 只 import domain+ports(buildPgConfig 為 adapter 內部複用、pg 為外部 SDK 不在 boundaries 範圍)。
