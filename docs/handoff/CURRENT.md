# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`，專案進度仍以根目錄 `STATUS.md` 為準。

## 交接資訊

- Updated: 2026-07-14，Asia/Taipei
- Agent: Codex
- Mode: 執行模式，AI foundation docs/config slice 已完成、待 review
- Branch / HEAD: `dev` / `be454f2`
- Remote: local `dev` ahead `origin/dev` 1 commit
- Commit / Push: 本檔與 foundation 內容由同一個 `docs(config)` commit 收錄；實際 hash 以 `git log -1` 為準，未 push

## 目前目標

已把官網從「Claude 永久實作、Codex 永久唯讀」改成 Codex／Claude 雙主力。Codex Review Packet 仍保留，但只在任務明確要求審查時啟用。

## 已確認事實

- M-4a Admin 已部署，SSO production E2E 與登入守門依 `STATUS.md` 已於 2026-07-13 驗證。
- `pnpm typecheck`、`pnpm lint` 通過；`pnpm test` 190 files／2,007 tests 通過，另有 1 todo。
- 本輪沒有執行 production build、資料庫寫入、部署或 push。
- 官網 `STATUS.md` 約 279 KB，瘦身必須另開 docs migration slice，不能在這次順手刪歷史。

## Working tree ownership

### 本次 foundation 開工前已存在，禁止混入或修改

- `.gitignore`
- `admin-orders.png`
- `docs/handoff/2026-07-13-email-notification-slice-plan.md`
- `docs/handoff/2026-07-13-issue-215-tier-server-auth-plan.md`
- `docs/handoff/2026-07-13-m4a-admin-deploy-kickoff.md`
- `docs/superpowers/`

### 本次 foundation slice 新增或修改

- `AGENTS.md`
- `CLAUDE.md`
- `docs/ops/AI_CONTRACT.md`
- `docs/handoff/CURRENT.md`
- `docs/patterns/codex-inspector-role.md`
- `docs/patterns/codex-review-packet.md`
- `docs/patterns/cowork-review-chain.md`
- `docs/working-style.md`
- `.agents/skills/pcm-handoff/`
- `.claude/skills/pcm-handoff`

接手時不得 reset、stash、刪除或把兩組內容混成同一個 commit。

## 尚未修復的產品 P1

1. 結帳與註冊要求同意條款，但條款／隱私連結仍是 `href="#"`。
2. `/brands`、`/install`、`/stores` 沒有 route；新品／特價 filter 與 `new`／`sale` 排序的 client、server 語意不一致。
3. 店家 tier pricing 尚未落地；真正接店家價前必須由 server `auth.uid()` 驗證 `customers.tier`，不能信任 client cookie。
4. TapPay 與 LINE OAuth 外部請求缺 timeout；3DS redirect 也需正式 origin allowlist。
5. 報價單與官網的型錄 contract 已漂移，缺機器可讀 version 與雙 repo CI。
6. 建單冪等、供應商 staging transaction、具名 staff identity、安全 headers 與 production build/E2E gate 仍待獨立 slices。

## 下一個最小動作

1. Sean review 本次 AI contract、角色入口、review-mode 註解與 handoff skill commit。
2. 預設不 push，等 Sean review checkpoint。
3. 產品修復建議先拆：法律／失效導覽／timeout，再做跨 repo contract 與 server-only tier pricing。

## Foundation 驗證

- `git diff --check` 通過。
- `pcm-handoff` 官方 validator 回報 `Skill is valid!`，Claude symlink 可讀同一份內容。
- 官網與報價單 `AI_CONTRACT.md` 使用 `cmp` 驗證 byte-equal。
- 官網與報價單 `pcm-handoff/SKILL.md` 使用 `cmp` 驗證 byte-equal。
- `AGENTS.md`、`CLAUDE.md` 與兩份 review pattern 都能定位新的模式分工文字。

## Sean 待處理

- 確認 Codex／Claude 雙主力文字符合預期。
- 本次 foundation 完成後，決定是否先清理官網既有 dirty worktree，再啟動產品 P1 slices。

## 安全邊界

- 不讀、不輸出 `.env*`、Supabase service role、TapPay／LINE secret、客戶訂單與個資。
- 不動 production env、migration、deploy、merge 或 push。
- 不碰 design-reference 或現有產品程式。
- Obsidian 停用。

## 相關入口

- `STATUS.md`
- `docs/ops/AI_CONTRACT.md`
- `docs/patterns/codex-review-packet.md`
- `docs/patterns/codex-inspector-role.md`
- `docs/handoff/2026-07-13-issue-215-tier-server-auth-plan.md`
