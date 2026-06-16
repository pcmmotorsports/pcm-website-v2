# Slice 收工三綠 Checkpoint 規範(C5 L1 規則層)

> **狀態:** 生效 2026-05-01
> **拍板人:** Sean(C5 拍板選 L1+L2、本檔落地 L1 層)
> **層級:** docs/patterns/、衝突仲裁在 CLAUDE.md 之下、其他 .md 之上
> **影響範圍:** Phase 1 全部 ~75 slice
>
> 配合閱讀:
> - `CLAUDE.md` 鐵則 11(本檔規範外掛入 CLAUDE.md)
> - `CLAUDE.md`「快速自檢清單(slice 結束前)」(本檔規範外掛入清單)
> - `docs/lessons-learned.md`「build pass ≠ runtime pass」教訓
> - `docs/phase-1-backlog.md` #6(M-0-01a 字面 vs 事實事件)、#7(GitHub Actions CI gate L3)

---

## 1. Why(背景)

### 1.1 觸發事件

M-0-01a commit `dd7b606` 訊息聲稱「建 root TS 環境 + turbo typecheck pipeline」、實際只建設定檔、typescript 套件本身未裝。M-0-01b Phase A 跑 `pnpm typecheck` 才暴露 — 6 packages 全部 `tsc: command not found`。

字面 vs 事實 drift 不是偶發、是 systemic:Claude.ai 寫 slice 指令無 sandbox、靠邏輯推斷;Claude Code 執行時若不主動跑工具鏈驗證、commit 訊息會聲稱完成超過實際。

### 1.2 已知 lessons

從第一輪累積、整理進 `docs/lessons-learned.md`:

- **build pass ≠ runtime pass**:Vercel build 不跑 ESLint、`ignoreBuildErrors` 只擋 TypeScript、settings 檔通過不代表工具鏈跑得起來
- **commit 訊息字面要對應實際**:抽象語(「建 X 環境」)易產生 drift、具體事實(「裝了什麼套件 + 實跑哪個命令通過」)才能 audit

### 1.3 為何需要規則 + 工具雙保險

L1 規則層(本檔)+ L2 工具層(busboy-end pre-flight)+ L3 設施層(GitHub Actions CI gate)三層保險缺一不可:

- L1 靠 Code 自律、若 Code session 漏跑 / 跳過、L1 失守
- L2 在 commit / amend STATUS 邊界自動跑、L1 失守時 L2 攔
- L3 在 push / PR 邊界自動跑、L1 + L2 雙失守時 L3 攔(且 Vercel preview URL 是 runtime 真實驗、本地 build 過 ≠ runtime 過)

本檔處理 L1。L2 在 M-0-09(busboy-end pre-flight)落地、L3 在 backlog #7 待 follow-up slice。

---

## 2. Three-Green 定義

### 2.1 三綠項目

| 項目 | 命令 | 通過條件 |
|---|---|---|
| typecheck | `pnpm typecheck` | no error / no warning(turbo 跑全 workspace) |
| lint | `pnpm lint` | no error / no warning |
| build | `pnpm build` | 所有動到 .ts / .tsx 的 package / app 跑通 |

### 2.2 三項缺一不可

- 三項全綠才允許 commit、不允許「typecheck 過、lint 紅、之後修」一類延期
- build 在純文件 slice(只動 .md / .json schema)可省、但 typecheck + lint 仍跑(確認 monorepo 設定未被前一輪副作用波及)
- 三項任一紅 → 修紅再 commit、不繞道、不 disable / skip / ignore

### 2.3 為何要 build 也跑

- TypeScript `tsc --noEmit` 不抓 build-time issue(Next.js / Vite 自家 transpile pipeline)
- ESLint 不抓 type-aware error(`@typescript-eslint` 部分規則需 type-aware build)
- Vercel build 是 production-like 環境、本地不跑、上 CI 才發現太晚

純文件 slice 可省 build 因為純 .md 不影響 build pipeline。

---

## 3. Slice 結束強制流程(L1)

### 3.1 順序

```
1. typecheck 跑
   ├── 全綠 → 下一步
   └── 任一紅 → 停下修紅 → 重跑 → 再判斷

2. lint 跑
   ├── 全綠 → 下一步
   └── 任一紅 → 停下修紅 → 重跑 → 再判斷

3. build 跑(若 slice 動 .ts / .tsx)
   ├── 全綠 → 下一步
   └── 任一紅 → 停下修紅 → 重跑 → 再判斷

4. 三項全綠 → 才允許 commit

5. commit 訊息對應 commit 實際內容、不超過實際做的事
```

### 3.2 任一紅 → 修紅、不繞道

修紅原則:

- 找根因、不對症 disable
- 若紅是「規則本身錯」(例:eslint rule 與 design 字面實質衝突)、改規則設定 + commit body 註明、不 disable 個別 line
- 若紅是「規則對、但本 slice 修法超出 scope」、用個別 `eslint-disable-line` 或 `@ts-expect-error` 帶註解 + 寫 backlog 條目追蹤、不擴張 slice
- 若紅是「測試 mock 與實作不符」、改 mock、不 skip 測試
- 若紅是「外部 SDK breaking change」、開新 slice 處理升級、本 slice 暫不 commit

### 3.3 commit 訊息字面 vs 事實守則

- 訊息對應 commit 實際內容、不聲稱完成超過實際做的事
- 抽象語(「建 X 環境」)避免、具體事實(「裝了什麼套件 + 實跑哪個命令通過」)優先
- 若 commit 含「部分完成 / 邊界情況 / 工具鏈異常」、commit body 註明字面 vs 事實偏離
- 若 git diff 數字(commit 數 / 檔數 / 行數)跟 Claude.ai 寫的指令字面數字不符、Code 以 git rev-list / wc -l 等實際數字為準寫進 commit body、不盲從指令字面

### 3.4 收工後(動程式碼才跑):graphify 知識地圖增量重建

commit 後、若本 slice 動到程式碼,順手跑 `/graphify --update` 增量重建 `graphify-out/` 知識地圖(只重算改動檔、便宜)。目的:讓「結構地圖」隨專案保持新鮮——**舊圖比沒圖危險**(會給過期連結誤導後續 session)。

- 自律執行(非 hook;對齊 settings.json `_deferred_hooks_note`)。
- 純文件 slice(只動 .md / .json)可跳(graphify code 走 AST、文件改動才需語意重抽,視情況)。
- 安全屏障由 repo 根 `.graphifyignore` 把關(track 在 git;擋 `.env*` / `.claude/` / `supabase/.temp/` / 憑證)。產物 `graphify-out/` 本機重建、不入 git。
- **設計截圖目前不收**(`.graphifyignore` 排除圖檔;第一次建圖 Sean 拍板省 vision 成本)。要加回:刪 `.graphifyignore` 圖檔段 + 重建。

---

## 4. 不能 disable / skip / ignore 的清單

### 4.1 禁用(觸發即視為 L1 失守)

| 行為 | 為何禁 |
|---|---|
| `tsc --skipLibCheck` 之類繞過 | skip lib 真的有 bug 時找不到 |
| `eslint --no-warn-ignored` 之類繞過 | warning 累積成技術債 |
| 大量散撒 `eslint-disable-next-line`(無註解、無 backlog 對應) | 規則失效、無 audit trail |
| `// @ts-ignore` 不寫原因 | 類型錯誤被吞、未來不知道為何 ignore |
| `// @ts-expect-error` 不寫原因 | 同上、且若錯誤被修復、`expect-error` 反而變成 lint error 連鎖 |
| `tsc --build --force` 強制過 | 強制過 = 下次 cache 不一致 |
| `next build` 加 `ignoreBuildErrors`(若 next.config 已加、本檔規範移除) | 對齊 lessons-learned「build pass ≠ runtime pass」 |
| 整個 slice 不跑 typecheck / lint 直接 commit | L1 完全失守 |

### 4.2 允許(必有對應追蹤)

| 行為 | 條件 |
|---|---|
| 個別 `eslint-disable-line` 帶註解 | 註解寫清楚 why、必有 backlog 條目對應 |
| 個別 `// @ts-expect-error` 帶註解 | 同上 |
| 純文件 slice(只動 .md)省 build | typecheck + lint 仍跑 |
| 暫時 skip 單個 unit test 用 `.skip` | 必有 backlog 條目對應 + commit body 註明、不長期保留 |

### 4.3 例外:外部 SDK breaking change

若 typecheck 紅是因為外部 SDK 升級而 breaking、開新 slice 處理升級。本 slice 不 commit、進 working tree stash、待升級 slice 完成後 rebase。

---

## 5. 字面 vs 事實守則(細則)

### 5.1 commit 訊息對應實際

- 不聲稱「建 X 環境」、改寫「裝 X 套件 + 實跑 Y 命令通過」
- 不聲稱「全部完成」、改寫「完成 X / 部分 Y / 待 Z」
- 不省略邊界情況、commit body 列出「跑了什麼、跑通什麼、有什麼特殊情況」

### 5.2 數字一致

- commit 訊息聲稱「3 個套件」、實際 git diff 必須 3 個套件
- commit 訊息聲稱「45 min」、實際時長若 90 min、commit body 註明「實測 90 min vs 指令字面 45 min」
- 不盲從指令字面、以實測為準

### 5.3 不假裝完成沒做的事

- 若 slice 中途遇 timeout / 中斷、commit body 註明「partial restart 後 X 步驟完成、Y 步驟未動」
- 若指令要求改檔但發現該段已被前一 slice 改過、commit body 註明「指令第 X 步驟字面已被前 slice 完成、本 slice no-op」
- 不複述指令字面、寫實際做了什麼

---

## 6. 與 L2(busboy-end pre-flight)、L3(GitHub Actions CI gate)關係

### 6.1 三層保險定義

| 層 | 機制 | 落點 | 責任 | 狀態 |
|---|---|---|---|---|
| L1 | 規則層 | 本檔 + CLAUDE.md 鐵則 11 + 自檢清單 | Code session 自律遵守 | 🟢 已落地(2026-05-01 / M-0-07) |
| L2 | 工具層 | pcm-tools/scripts/busboy-end.js pre-flight | busboy-end 強制跑、若紅不允許 amend STATUS | 🟡 規劃中(M-0-09) |
| L3 | 設施層 | .github/workflows/ci.yml | GitHub push 自動跑、PR / merge 必綠 | ⏳ 未來(backlog #7) |

### 6.2 為何三層

- L1 靠人、Code session 換手 / 注意力分散時可能漏
- L2 在 amend STATUS 邊界攔、L1 漏跑 L2 攔得到、但 L2 是本機腳本、若被 force-skip 仍可繞過
- L3 在 push 邊界攔、L1 + L2 雙失守時 L3 攔、且 Vercel preview URL 是 runtime 真實驗(本地 build 過 ≠ runtime 過)

### 6.3 L2 預定行為(M-0-09)

busboy-end.js pre-flight 三綠檢查:

- amend STATUS commit 前、自動跑 typecheck + lint
- 任一紅 → 拒絕 amend、輸出紅字提示 Code 修紅
- 純文件 slice 可加 `--docs-only` flag 省 build、但 typecheck + lint 仍跑
- pre-flight 通過才允許 amend、嚴格守 L2 邊界

### 6.4 L3 預定行為(backlog #7)

- push 觸發 GitHub Actions、跑 typecheck + lint + build
- PR 必須全綠才允許 merge 進 main
- Vercel preview URL deploy 起得來為終驗
- main branch protection rule 要求所有 status check 通過

---

## L1 + Stage 3 v4 新加:Manifest sync 驗證(對齊 outputs/stage-3-self-audit.md F-8)

> **加入時點:** Stage 3 v4 落地(2026-05-22)、對齊新工作流「設計 ↔ 現場 對照表」機制
> **規範層:** L1(規則層、本檔)+ L2(/slice-checkpoint skill 工具層、自動跑)+ L3(.husky/pre-commit lint-staged 設施層)

### 規範

每個動 storefront 元件的 slice、commit 前必跑 manifest sync 驗證:

1. **必跑時機:** /slice-checkpoint 三綠後、commit 前(對齊鐵則 11 不動 disable / skip)
2. **驗證內容:**
   - `git diff --staged --name-only` 列動到的檔
   - 任一在 `apps/storefront/src/components/` 或 `apps/storefront/src/styles/`、必有對應 manifest 元件條目 `last_modified_commit` 欄位更新為**案 A「記可達祖先」**(見下「last_modified_commit 寫法」段)
   - 動到 design-reference submodule(submodule update)、必有 manifest `last_global_sync` 段同步更新
3. **失敗處置:** Code raise multi-select、Sean 拍處置(補正可達 hash / 開新 slice / 業務 override 紀錄)、不擅自 PASS

### last_modified_commit 寫法:案 A「記可達祖先」固化(backlog #180)

> **拍板(2026-06-17、#180):** 二案擇一固化為**案 A**;案 B(commit 後非 amend 校正)與 `PENDING_HASH` + amend 寫法皆廢。

**案 A「記可達祖先」(唯一許可寫法):**
- `last_modified_commit` 寫「**前一個已落地、HEAD 可達的 commit**」(通常 = 本 slice commit 的父 commit、即 amend 前 HEAD),**不寫 `PENDING_HASH`、不 commit 後 amend**。
- 語意略 understate(該 slice 本身的 commit 未被記),但永遠可達、無 orphan、零 amend。
- 已於 OD 線(OD-6 起)實踐驗證、效果佳。

**為何廢 `PENDING_HASH` + amend / 案 B:**
- 把「自身 commit 的 hash」amend 進 manifest 在 git 數學上不可能(commit hash 依內容〔含 manifest〕計算)→ 補進去的永遠是 pre-amend hash = amend 後變 orphan/dangling、90 天 `git gc` 清掉 → `git show <hash>` 找不到「最後改此元件的 commit」、design↔code 稽核斷鏈。
- 已復發 2 例(`1b61a9d` ProductsPage/ProductPage、`38001e8` Header/AccountPages),靠人腦順手修易漏(memory `project_status-top-hash-off-by-one-normal`)。

**機械 gate(可達性檢查、design-mirror --validate):**
- `node scripts/design-mirror.mjs --validate` 已加可達性檢查:每個元件 `last_modified_commit`(非佔位字面)必為 HEAD 可達祖先(`git merge-base --is-ancestor <hash> HEAD`);orphan / dangling / 非法 hash 格式 → validate 失敗(exit 1)。
- 佔位字面(以 `(` 開頭、如「(未建)」「(未動於本輪 session)」)跳過、不驗。
- 跑時機:slice 動 storefront 元件、commit 後(案 A 記父 commit、commit 後父已可達)順手跑 `--validate` 確認零 orphan。

### 為什麼需要

對齊 outputs/stage-3-self-audit.md 漏缺 F-8 + 鐵則 1 + 鐵則 3:
- manifest 是「動一處不爆炸」的核心防線
- 動 storefront 但 manifest 未同步 = 設計現場對照表失效、後續 slice 找不到偏離源頭
- 對齊 lessons §12-25 字面內嵌義務、不允許「下次順手」amend

### 跟既有「字面 vs 事實守則」關係

manifest sync 驗證是「字面 vs 事實守則」的具體實作:
- 字面 = manifest 內紀錄
- 事實 = 本 slice 真實 commit + storefront 真實字面
- 兩者不一致 = drift、必修

---

## 7. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-01 | 初始化 slice-checkpoint 規範(C5 拍板 L1+L2、L1 落地) | Claude.ai + Sean / 由 Claude Code(M-0-07)落地 |
| 2026-05-22 | Stage 3 v4 新增「Manifest sync 驗證」段(對齊 self-audit F-8) | Cowork 寫字面 / 由 Claude Code(Stage-3-onboarding)落地 |
| 2026-06-17 | #180 固化 last_modified_commit 案 A「記可達祖先」(廢 PENDING_HASH+amend)+ design-mirror --validate 加可達性 gate | Claude Code 自驅 |

— 規範結束 —
