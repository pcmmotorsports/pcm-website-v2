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

## 7. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-01 | 初始化 slice-checkpoint 規範(C5 拍板 L1+L2、L1 落地) | Claude.ai + Sean / 由 Claude Code(M-0-07)落地 |

— 規範結束 —
