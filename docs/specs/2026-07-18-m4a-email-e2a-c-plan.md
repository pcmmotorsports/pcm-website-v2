# M-4a Email 片 E2a-c(接線層:sweeper route + server-only composition + 單測)plan

> 真權威 = `docs/specs/2026-07-16-m4a-email-notify-plan.md` v3.3 §5 E2a-c 欄。本檔 = 該片的施工 plan(接線層,零 DDL、零新 use-case、零 port 改動)。
> 前置片:E2a-a(lease 回收零件)✅ / E2a-b(退避政策+`sweepEmailOutbox` use-case)✅=`a691a9d`。

## 目標與範圍

把 E2a-b 立好的 `sweepEmailOutbox(deps, opts)` use-case 接上一個受 CRON_SECRET 保護的 HTTP GET route,並用 server-only composition 注入 `IEmailOutbox`(Supabase service_role)+ `IEmailSender`(Resend)兩個 adapter。**排程本身不在本片**(走 E2b 的 pg_cron;🔴 不進 `vercel.json` crons)。

staged 檔(5 個 = 4 實作檔全新增 + 本施工 plan):
1. `apps/storefront/src/lib/email/composition.ts` — server-only、受控注入 email 兩 adapter(鏡像 `lib/payment/composition.ts` + `lib/auth/line-admin.ts`)。
2. `apps/storefront/src/lib/email/composition.test.ts` — 真 factory 單測(只 mock adapter 建構子;codex 關卡2 must-fix:route mock 證不了 composition 退化)。
3. `apps/storefront/src/app/api/cron/email-sweep/route.ts` — GET-only cron route(骨架抄 `anomaly-alert`/`settle-sweep`)。
4. `apps/storefront/src/app/api/cron/email-sweep/route.test.ts` — route 單測(鏡像 `settle-sweep/route.test.ts` + source-contract + PII allowlist 斷言)。
5. `docs/specs/2026-07-18-m4a-email-e2a-c-plan.md` — 本施工 plan。

零 migration、零 schema、零 env schema、零 UI、零既有檔行為變更(不動 `server.ts` barrel=email adapter 已於 E1b export;不動 `vercel.json`)。

## 三條硬紅線(CURRENT / STATUS / memory `project_m4a-email-e2a-decisions` Q13)

1. **`maxRunSeconds` = route `maxDuration` 同一字面**:route `export const maxDuration = 60`,GET 內 `sweepEmailOutbox(deps, { maxRunSeconds: maxDuration, ... })` **直接引用同一 const**(單一來源,不寫兩個字面 → 物理上不可能漂移)。`leaseSeconds = 3600`(通過 use-case 硬下界 `max(3600, maxRunSeconds+300)=3600`;違反即 use-case throw)。`errors > 0 → 503`。
2. **不進 `vercel.json` crons**(排程走 E2b 的 pg_cron;Hobby cron 一天一次放不了 `*/5`)。本片不碰 `vercel.json`。
3. **零告警**(Q13=A):五訊號全歸 E2a-2 獨立管道;本 route 只回 counts、不推任何 LINE/Email 告警。`deferred > 0` 只是調參訊號、非錯誤、不 503。

## 設計要點

### route(`email-sweep/route.ts`)

- `runtime='nodejs'` / `dynamic='force-dynamic'` / `export const maxDuration = 60`(=`anomaly-alert`/`settle-sweep` 骨架)。
- 認證:`CRON_SECRET` Bearer 硬驗 + `timingSafeEqual`(`safeEqual`/`requireCronSecret` 抄骨架);env 未設/<32 → 500;Bearer 缺/錯 → 401。
- 應用層限流:`checkCronRateLimit('email-sweep')`(認證後、建 deps 前;超限 → 429)。
- 🔴 **不設 `*_ENABLED` gate**(與兩 sibling 不同、理由見「決策與偏離」;codex 關卡2 must-fix 後定案):真寄前的自然閘 = ①`ORDER_EMAIL_FROM` 必填未設 → `requireEnv` throw → 503(Sean 設 env 即 go)②E2b pg_cron 未排程 → 無人呼叫(本片不進 vercel.json)③E3 未落地 → 表零列 → sweep 全零。
- 認證+限流過 → `getSweepEmailOutboxDeps()` 建 deps → `sweepEmailOutbox(deps, { claimLimit: 50, maxRunSeconds: maxDuration, leaseSeconds: 3600 })`。
- `result.errors > 0` → 503 + 結構化 counts log(零 PII);否則 200 + counts。🔴 **counts = 顯式 allowlist**(`pickCounts` 挑 7 個數值欄、**不 blind spread `...result`**;codex 關卡2 must-fix:防上游日後誤增 PII 欄洩進 log/HTTP)。
- deps/factory throw(env 缺 → `requireEnv` throw)→ 503 + 固定 reason code(不入 raw `err.message`)。
- 排序契約:認證 → 限流 → deps(與 sibling 一致,route.test 鎖死)。

route 端常數(不採信外部輸入、揭示可調):
- `CLAIM_LIMIT = 50`(每輪認領上限;PCM 量級 10-30 封/日 << 50,concurrency=1 順序寄送單輪遠 < maxDuration;對齊 settle-sweep per-round 50)。
- `LEASE_SECONDS = 3600`(建議值;use-case 硬下界驗證)。

### composition(`lib/email/composition.ts`)

- `import 'server-only'` + inline `eslint-disable-next-line no-restricted-imports`(受控例外,鏡像 `payment/composition.ts:32`)。
- `requireEnv(name)`(缺則 throw;鏡像 payment composition;`process.env` 行加 `eslint-disable-next-line no-restricted-syntax`)。
- `getSweepEmailOutboxDeps(): SweepEmailOutboxDeps`:
  - `outbox = new SupabaseEmailOutboxAdapter(createSupabaseServiceClient() as unknown as EmailOutboxClient, { syntheticEmailDomain: LINE_SYNTHETIC_EMAIL_DOMAIN })`(窄 cast=E1b 文件化前例;域名注入單一字面來源 `@/lib/auth/line`)。
  - `sender = new ResendEmailSenderAdapter({ apiKey: requireEnv('RESEND_API_KEY'), from: requireEnv('ORDER_EMAIL_FROM') })`。
- **lazy**:env 在 factory 內讀(route 認證/限流未過即在建 deps 前 return → 零 env 依賴;鏡像 sibling 不變式)。

## 相關既有紀錄與連動面(🔴 CURRENT 強制;graphify query 實查)

`graphify query "sweepEmailOutbox route composition SupabaseEmailOutboxAdapter ResendEmailSenderAdapter anomaly-alert settle-sweep cron 連動"`(BFS depth=2、143 nodes)命中的連動面:

- **`sweepEmailOutbox`(E2a-b use-case)** = 本片唯一消費者接點;opts 合約(`maxRunSeconds` 申告制 / `leaseSeconds` 硬下界 / `errors`→503 / `deferred` 非錯誤)由其檔頭 JSDoc 定,照用勿改。
- **`@pcm/adapters/server` barrel(`server.ts:89-103`)** = email 三 adapter 已 export(E1b);本片零 barrel 改動,直接注入。
- **`createSupabaseServiceClient`(`supabase/client.ts:55`)+ `EmailOutboxClient`(`SupabaseEmailOutboxAdapter.ts:138`)** = 窄 cast 注入點。
- **`LINE_SYNTHETIC_EMAIL_DOMAIN`(`lib/auth/line.ts:38`)** = 假信箱 gate 域名單一字面來源;composition 注入(packages 不反向 import app)。
- **`anomaly-alert/route.ts` + `settle-sweep/route.ts`(sibling cron routes)** = 骨架鏡像來源(認證/限流/503/config 段;🔴 **本片不鏡像其 `*_ENABLED` gate**,見「決策與偏離」);**`checkCronRateLimit`(`lib/cron/rate-limit.ts`)** 共用限流器(per-instance best-effort),新 key `'email-sweep'` 與兩 sibling 各自獨立額度。
- **`lib/payment/composition.ts`** = server-only 受控注入 + `requireEnv` + lazy 不變式的鏡像來源。
- **未連動確認**:本片不碰 `vercel.json`(排程 E2b)、不碰 migration/port/use-case、不碰 `EmailAlertNotifierAdapter`(告警管道=E2a-2,與交易信 sender 刻意分港)。

## 決策與偏離(Sean 可否決)

- 🔴 **不設 `*_ENABLED` gate(定案;歷程誠實記錄)**:初版曾加 `EMAIL_SWEEPER_ENABLED` gate(理由=寄客戶信對外不可撤回、鏡像兩 sibling 慣例),但 **codex 關卡2 抓為 must-fix**:①超出 plan §5 與 Q10 手動清單、**未經 Sean 拍板**(等於未批准的架構增項、觸鐵則 8)②預設 false→200 會讓 E2b 排程「看似成功、信卻永不寄」= 新增靜默失敗態。→ **移除 gate**。真寄前的自然閘已足夠:兩 sibling 需 gate 是因為它們掛 `vercel.json` 會自動觸發;本 route **不進 vercel.json**、由 E2b pg_cron 是否存在控制觸發,再加 `ORDER_EMAIL_FROM` 必填未設即 503(Sean 設 env = go)+ E3 未落地表零列 → 三閘疊起 = route 已 deploy 亦零副作用。**若 Sean 仍要一個顯式 go/no-go env 開關**(與 pg_cron 解耦),可另拍再加回。
- **route 名 `email-sweep`**(對齊 `settle-sweep`)、`CLAIM_LIMIT=50`、`maxDuration=60`:皆鏡像 sibling 慣例,route 端常數揭示可調。

## 驗收條件

- ☑ typecheck / lint / build(storefront)三綠 + 完整 vitest 綠。
- ☑ route:GET-only、config 段正確、認證(500/401)、限流(429)、errors>0→503、success→200 counts、deferred>0→仍 200、deps throw→503、零 PII log。
- ☑ `maxRunSeconds` 與 `maxDuration` 同源(runtime `=== route.maxDuration` + source-contract 鎖 `maxRunSeconds: maxDuration` 引用式、無寫死第二字面)。
- ☑ counts allowlist(PII sentinel 不進 200/503/log)+ 認證 source-contract(timingSafeEqual)+ composition 真 factory 測(lazy/adapter/keys/throws)。
- ☑ 排序契約(認證→限流→deps)route.test 鎖死。
- ☑ 審查閘:code-reviewer(R1 PASS)+ codex 關卡2(R1 FAIL 5 must-fix+1 nit → 全修 → R2 待複審;背景跑+讀輸出+porcelain 零留痕)。
- ☐ commit 同步 STATUS 7 欄、不 push。
