# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(⚠️ 主表過時、開工首件重寫,見當次快照 §4)。
> 當次詳細快照:`docs/handoff/2026-07-16-m4a-vline-close-next-phase-kickoff.md`。

## 交接資訊

- Updated: 2026-07-16 中午,Asia/Taipei
- Agent: 值班審查台(Claude Code、Opus 4.8)收尾;V 線執行 session 已結束
- Branch / HEAD: `dev` = `origin/dev` = `origin/main` = **`b6c97fd`**(零待推、零待審)
- Production: `shop.pcmmotorsports.com` READY(sha 驗訖);DB migrations 至 `20260716200000`(全 apply)

## 目前目標

**M-4a V 線 ✅ 全線收工上 production**(V-2h 6 must-fix+V-2f/2g/3b+V-3a 型別閘+MF-1 taxonomy;三模型鏈 Codex 寫→Opus 審→Fable 終審)。下一階段=M-4a 第一期收口:**①客戶線(含 tier 編輯高風險片)②Email 通知片 ③最新商品**,優先序待 Sean 拍(候選表+分工模型表見當次快照 §3/§5)。

## 🔴 下一個最小動作

1. Sean 拍下一階段優先序(快照 §3 標號 1-6;值班台推薦 1→2→3)。
2. 新執行視窗開工首件=**重寫 STATUS.md 7 欄**(主表還停在 D-2/V-1、嚴重過時)。
3. Sean 正式站肉眼驗 `/products`(P4+S4 年份卡片隨本次 FF 一併上線)。
4. Email 片動工前要 Sean 拍「觸發點碰不碰金流 RPC」(07-13 plan 內)。

## 流程紀律(下一階段拍板版)

- 執行/審查分離維持:Claude 主寫(高風險 Opus high/例行 Sonnet high)+ code-reviewer 每片 + 值班台(Opus high)審代推 + **Sol 第三眼僅鐵則 8/12 觸發** + Fable 里程碑終審。不常駐 xhigh、不用 Ultra。
- 執行 session 不 push;動 schema commit 壓住等 db push+驗欄;dev:main 恆 Sean 明說。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`(pre-existing modified、歷來刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*.md` kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資。
- migration db push=Sean 操作;不動 production env/deploy;不碰 design-reference、動前台先 grep design 真權威。

## 相關入口

- `docs/handoff/2026-07-16-m4a-vline-close-next-phase-kickoff.md`(當次詳細+候選表+模型表)
- `docs/handoff/2026-07-13-email-notification-slice-plan.md` / `2026-07-13-issue-215-tier-server-auth-plan.md`
- `pcm-tools/review-inbox/`(V 線全部 verdict 存檔)
- `STATUS.md`(過時待重寫)/ `docs/ops/AI_CONTRACT.md`
