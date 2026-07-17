# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> 當次快照全文:`docs/handoff/2026-07-17-m4a-email-e1b-handoff.md`(E1a 硬閘全關+E1b 收工已推;E2a 開工依據)。

## 交接資訊

- Updated: 2026-07-17,Asia/Taipei
- Agent: Claude Code 實作視窗(E1a MCP prod 驗證+E1b port/adapter)
- Branch / HEAD: `dev` = `origin/dev` = `7b30ced`(E1b);`origin/main` = `13ce3a9`(production、本線未上)
- DB: migrations 至 `20260717020000` **全 apply**;E1a prod 驗證全 PASS(零留痕);E1b 無 migration

## 目前目標

**M-4a 第一期收口 ②Email 通知片**。E1a(表)✅ 全關 → E1b(port/adapter)✅ 已推 → **下一=E2a(sweeper+對帳+dead-man 四訊號+lease 回收)** → E2b(pg_cron/pg_net/Vault)→ E3(order_created)→ E4(order_shipped)。

## 🔴 下一個最小動作(E2a 執行視窗)

1. 讀快照 §5 + plan v3.1 §3.5b/§3.6/§4.2 + migration `20260717020000` 頭註 §⑦§⑧ + **`packages/ports/src/IEmailOutbox.ts` JSDoc(使用合約:照 port 用、勿自寫 SQL 繞過;世代柵欄/attempts guard 已內建)**。
2. E2a 偵察 pass(anomaly-alert route 骨架+「lease 回收落 pending|failed」決策=須回頭過 §3.6 訊號表)→ slice plan → 關卡1 判定 → 動工。
3. 審查閘=code-reviewer+codex 關卡2(plan §5 明定;E1b 經驗:二審真的抓得到洞,勿省)。

## 流程紀律(沿用)

- 執行 session 不 push(07-17 兩推皆 Sean 明說);動 schema commit 壓住等 db push+驗;dev:main 恆 Sean 明說。
- 拍板即落檔;codex 全程 `-s read-only`+porcelain 前後比對。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`、`docs/progress-roadmap.html`(pre-existing modified、刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*` kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值。
- migration db push=Sean 操作;`email_outbox.recipient_email`=PII、client 零權限;經銷價不進非 admin client;金額整數;audit 不可繞。

## 相關入口

- 當次快照:`docs/handoff/2026-07-17-m4a-email-e1b-handoff.md`
- plan 真權威:`/Users/sean_1/pcm-tools/review-inbox/m4a-email-notify-plan.md` v3.1
- memory:`project_m4a-email-e1a-decisions`(E1a+E1b 全紀錄+REQUIRED-E2a/E3 義務)
