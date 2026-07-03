# Slice 指令格式 — 六件套(完整規格)

> 2026-07-03 自 CLAUDE.md 本體原文搬出(瘦身;僅刪指涉原檔語境的「(見下)」二字,其餘零改動);CLAUDE.md 留摘要+路由。
> 六件套 = Cowork 模式規範(Stage 3 v4 / 2026-05-22);**Claude Code 自驅 SOP 為現行預設**。六件套結構被 code-reviewer.md / cowork-review-chain.md / AGENTS.md 強制依賴、**結構與「— 禁止清單結束 —」標記不可改**。

每份指令外包 markdown code block、含六件套:① 任務目標(1-2 句)② 前置檢查(`git branch/status/log` 全綠才繼續)③ 執行模式+Subagent 模式 ④ Manifest Impact+Review 觸發 ⑤ 執行步驟 ⑥ 驗收條件(明確 yes/no)+ 禁止清單。

```
③ 執行模式: mode A|B(預設 B)/ conductor: main session / subagent_chain: code-reviewer(commit 前必跑)/ fix_attempt_max: 2 / /slice-checkpoint: 跑(純 docs 跳)/ /codex-review: 觸發|不觸發(理由)
④ Manifest Impact: 動到的 storefront 元件[design-mirror.mjs --target 抽] / 對應 design 源 / 業務 override / 未解決偏離 / 最近設計同步;review_triggers: prd_review / slice_review / code_review / security_review_required / codex_review_required
禁止清單(基線): 不改 scope 外檔 / 不變 env·deployment / 不改 schema·infra(除非明確要求)/ 不用 git add .·-A(精準 add)/ 不自動 push / 不動 .env*(settings.json deny 硬攔)/ 不繞 design-mirror.mjs
— 禁止清單結束 —
```
結尾固定「— 禁止清單結束 —」(Sean 確認訊息沒被截斷)。
