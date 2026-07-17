# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> E1c 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`(⚠️ **僅供 E1c 追溯、不是開工依據**——其「下一步」字面已被 E2a-a 超越〔E2a 已拆三片、§⑩ 已定案、port method 已存在〕;**開工入口 = 本檔 + `STATUS.md`「下一步」**)。

## 交接資訊

- Updated: 2026-07-17,Asia/Taipei
- Agent: Claude Code 實作視窗(**E2a-b 退避政策模組+sweeper use-case**〔`email-backoff.ts`+`sweep-email-outbox.ts`+49 測〕)
- Branch / HEAD: `dev` = E2a-b commit(🔴 hash/未推數**不寫死**,實跑取得:`git log --oneline -1` / `git rev-parse --short origin/dev` / `git rev-list --count origin/dev..HEAD`;本檔寫定當下 = origin/dev `6025a37`、本地 ahead 2〔`c257679` CURRENT docs + E2a-b〕)。`origin/main` = `13ce3a9`(production、本線未上)
- DB: migrations 至 `20260717020000` **全 apply**;E1c-2(§⑨)與 **E2a-a(§⑩)**皆 = **純註解增補、零 DDL**(獨立驗證:剔除 `--` 行後 byte-identical → **無需 re-apply、無漂移**);無新 migration

## 目前目標

**M-4a 第一期收口 ②Email 通知片**。E1a(表)✅ → E1b(port/adapter)✅ → E1c(429 三分+退避合約)✅ 已推 → **E2a 拆三片(Sean Q12=A)**:E2a-a ✅ 已推(`6a8b155`)→ **E2a-b(退避政策+sweeper use-case)✅ code 收工、未推** → **下一=E2a-c(route+server-only composition)** → E2a-2(對帳+**五訊號**)→ E2b(pg_cron/pg_net/Vault)→ E3(order_created)→ E4。
> 🔴 **Sean Q13=A:E2a 三片皆不做告警**(全歸 E2a-2 獨立管道;plan §5「E2a + failed 告警」字面**已作廢**——sweeper 不可自我監看)。

## 🔴 下一個最小動作(E2a-c 執行視窗)

> 🔴 **寫 E2a-c plan 前必查 graphify 連動面**(Sean 07-17 當場抓、memory `feedback_graphify-query-before-planning-is-mandatory`):在 repo 根跑 `graphify query "<E2a-c 相關問題>"`(用本 repo `graphify-out/`)查 route/composition/`sweepEmailOutbox`/`anomaly-alert` 的連動邊,plan **必附「相關既有紀錄與連動面」一節**,否則 Sean 看不到你有沒有跳步。注意:**查(每片必做)≠ 刷 `--update`(milestone/每日收工才跑)**。(E2a-b 實證有效:圖抓到偵察清單外的 `sweepSettlements` 鏡像。)

1. 讀 migration `20260717020000` 頭註 **§⑦+§⑨+§⑩**(仲裁序 §⑦ < §⑨ < §⑩)+ `packages/ports/src/IEmailOutbox.ts` JSDoc + **`packages/use-cases/src/sweep-email-outbox.ts` 與 `email-backoff.ts` 檔頭合約**(E2a-b 新立)+ memory `project_m4a-email-e2a-decisions`(Q1-Q15)+ plan **v3.3** §3.5b/§3.6/§4.2。
2. **E2a-c**(route + server-only composition + 單測):骨架抄 `anomaly-alert/route.ts`(`route.ts:37-40` runtime/dynamic/maxDuration、CRON_SECRET+`timingSafeEqual`、503 不吞錯 `:126/:130/:137`);composition 抄 `line-admin.ts:19-21`(`import 'server-only'` + `eslint-disable-next-line no-restricted-imports` 受控例外);窄 cast `createSupabaseServiceClient() as unknown as EmailOutboxClient`。
3. 🔴 **E2a-b 立的注入合約(漏傳直接 throw)**:`sweepEmailOutbox` opts = `claimLimit` + **`maxRunSeconds` = route `maxDuration` 同一字面**(申告單輪硬上界;平台 kill 是物理保證來源)+ `leaseSeconds ≥ max(3600, maxRunSeconds+300)`(建議 3600)。`errors>0 → 503`(counts-only、零 PII 回應);`deferred>0` 只是調參訊號、非錯誤。
4. 🔴 **不進 `vercel.json` crons**(排程走 E2b 的 pg_cron;Hobby cron 一天一次放不了 `*/5`)。🔴 **零告警**(Q13=A;五訊號全歸 E2a-2)。
5. 審查閘=code-reviewer + codex 關卡2(plan §5 明定、**勿省**;quota 牆已解除=Sean 07-17 補額度、E2a-a/E2a-b 皆真跑兩輪。⚠️ `EXIT=0` 仍是假訊號、**必讀輸出內容**;`codex exec` 一律背景跑+porcelain 前後比對)。

## 流程紀律(沿用)

- 執行 session 不 push(07-17 三推皆 Sean 明說);動 schema commit 壓住等 db push+驗;dev:main 恆 Sean 明說。
- ⚠️ `dev` = pcm-admin 的 **production** 分支(推 dev = admin 後台直接上線);storefront 才守 `main`。
- 拍板即落檔;codex 全程 `-s read-only`+porcelain 前後比對。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`、`docs/progress-roadmap.html`(pre-existing modified、刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*` kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值。
- migration db push=Sean 操作;`email_outbox.recipient_email`=PII、client 零權限;經銷價不進非 admin client;金額整數;audit 不可繞。

## 相關入口

- 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`
- plan 真權威:`docs/specs/2026-07-16-m4a-email-notify-plan.md` **v3.3**
- memory:`project_m4a-email-e2a-decisions`(**Q1-Q13** 拍板+Resend 事實+E1c/E2a-a 審查紀錄)/ `project_refund-line-two-stage`(Q8)/ `project_m4a-email-e1a-decisions`(E1a+E1b+REQUIRED-E2a/E3 義務)
- backlog:**#285**(未知 429 精準退避)/ **#286**(死信人工重送工具)
