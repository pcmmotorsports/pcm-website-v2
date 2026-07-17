# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> 當次快照全文:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`(E1c 兩片收工已推;E2a 開工依據)。

## 交接資訊

- Updated: 2026-07-17,Asia/Taipei
- Agent: Claude Code 實作視窗(E1c-1 429 三分 + E1c-2 合約落 migration §⑨)
- Branch / HEAD: `dev` = `origin/dev` = `55365e6`(E1c-2);`origin/main` = `13ce3a9`(production、本線未上)
- DB: migrations 至 `20260717020000` **全 apply**;E1c-2 = **純註解增補、零 DDL**(已 diff 驗證);無新 migration

## 目前目標

**M-4a 第一期收口 ②Email 通知片**。E1a(表)✅ → E1b(port/adapter)✅ → **E1c(429 三分+退避合約)✅ 已推** → **下一=E2a(sweeper+lease 回收+dead-man 五訊號)** → E2a-2(對帳+訊號)→ E2b(pg_cron/pg_net/Vault)→ E3(order_created)→ E4。

## 🔴 下一個最小動作(E2a 執行視窗)

1. 讀快照 §4(誠實揭示)+ §5(硬合約)+ plan **v3.2** §3.5b/§3.6/§4.2 + migration `20260717020000` 頭註 **§⑦+§⑨**(⚠️ 漂移以 §⑨ 為準;§⑦ 的「四訊號」已被 §⑨ 超越為**五訊號**)+ `packages/ports/src/IEmailOutbox.ts` JSDoc + memory `project_m4a-email-e2a-decisions`。
2. E2a 偵察 pass(anomaly-alert route 骨架 + **回收器需新增 port method** 的簽章 + 訊號 5 落點=獨立 cron 走 LINE、不可放 sweeper)→ slice plan 給 Sean 過目 → 動工。
3. 審查閘=code-reviewer+codex 關卡2(plan §5 明定;E1c 經驗:雙審獨立雙命中一個 Critical 原型鏈洞,**勿省**)。

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
- plan 真權威:`/Users/sean_1/pcm-tools/review-inbox/m4a-email-notify-plan.md` **v3.2**
- memory:`project_m4a-email-e2a-decisions`(Q1-Q11 拍板+Resend 事實+E1c 審查紀錄)/ `project_refund-line-two-stage`(Q8)/ `project_m4a-email-e1a-decisions`(E1a+E1b+REQUIRED-E2a/E3 義務)
- backlog:**#285**(未知 429 精準退避)/ **#286**(死信人工重送工具)
