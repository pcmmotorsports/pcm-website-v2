# Stage-3-onboarding Codex Review Packet

> **Mode:** 唯讀審查,不要修改檔案。只回 findings / 風險 / 是否可繼續。
> **產出:** Claude Code(Stage-3-onboarding slice 收工、commit 前)/ 2026-05-22
> **對齊鐵則 12:** 重大改動(跨 18 檔基礎建設)+ 進度單元結束(新工作流落地)→ 必產 Packet 給 Sean 貼 chatgpt.com/codex 唯讀審查
> **本 Packet 自帶上下文:** Codex 無 repo 存取、§7 摘錄相關規則 + §2 commit 序列 + 重點 diff,讓 Codex 無需 repo 即可審。

---

## 1. 範圍

- **目標:** 落檔 PCM 新工作流(Stage 3 終版 v4)全套基礎建設,0 程式碼 / 0 業務邏輯改動,純工作流 + 工具 + 規範。
- **本 packet 範圍 commit:** 2 個(`786a52c` + `81ba671`、Codex 審查對象);本機另有 1 個 docs handoff commit(`6bb41da`、純 docs、out-of-scope 不影響審查、由本 fix slice 一同收尾)
- **branch / HEAD:** dev / `6bb41da`(handoff commit、out-of-scope);Codex 審查 HEAD = `81ba671`(Stage 3 工作流升級 commit);STATUS.md 因 busboy-end 雙 amend 自參考特性記錄為 `0c764e1`、屬已知 1-step 偏移、Stage 3 fix slice 結束會 amend 對齊。本機 ahead = 3(實況 2026-05-22 Cowork session)
- **Repo:** /Users/sean_1/pcm-website-v2

---

## 2. Commit 序列

| # | hash | subject | 重點 |
|---|---|---|---|
| 1 | `786a52c` | chore: 收 2026-05-22 session 遺留(CLAUDE.md 工具索引段 + handoff) | 上 session 留下的 CLAUDE.md 工具索引段(+21 行)+ handoff 交接文,Sean 拍 A「先單獨 chore 收乾淨再開 Stage 3」 |
| 2 | `81ba671` | chore(workflow): Stage 3 終版 v4 工作流升級基礎建設 | 13 deliverable + 5 設計紀錄 + STATUS;含 A2/B1/C1 三個 Code 起手抓到、Sean 拍板的偏離修正 |
| 3 | `6bb41da` | docs(handoff): 2026-05-22 Stage 3 工作流升級 Cowork session 收工 | 本 packet out-of-scope、純 handoff 字面、Sean push 時一併推 |

### 本 packet diff stat(Codex 審查範圍 origin/dev..81ba671 快照)

(注:本 stat 為 Codex 審查範圍 `origin/dev..81ba671` 快照;本機目前 HEAD=`6bb41da`、額外含 handoff +209 行純 docs、不在 Codex 審查範圍。)

```
.claude/agents/code-reviewer.md                    |  89 +++   (新)
.claude/settings.json                              |  31 +     (新、A2)
.gitignore                                         |   6 +-    (C1 white-list)
AGENTS.md                                          |  60 +-    (五方分工 + 六件套 + 校正錯字)
CLAUDE.md                                          |  81 +-    (五方分工 + 六件套)
STATUS.md                                          |  14 +-
docs/design-storefront-manifest.yaml               | 316 +++++ (新、14 元件)
docs/handoff/2026-05-22-end-of-session.md          | 177 +++   (chore commit 收)
docs/patterns/codex-review-packet.md               |  40 +     (擴張 manifest 異動段)
docs/patterns/cowork-review-chain.md               | 122 +++   (新)
docs/patterns/slice-checkpoint.md                  |  33 +     (擴張 manifest sync 段)
docs/proposals/stage-1.7-...md                     | 384 +++   (設計紀錄)
docs/proposals/stage-3-bundle-code-deliverables.md | 778 +++   (字面源)
docs/proposals/stage-3-bundle-docs-deliverables.md | 537 +++   (字面源)
docs/proposals/stage-3-master-and-onboarding.md    | 318 +++   (slice 指令 + amend §L.2)
docs/proposals/stage-3-self-audit.md               | 264 +++   (Cowork 自審 14 條)
package.json                                       |   1 +     (devDep yaml ^2.6.0)
pnpm-lock.yaml                                     |   6 +-
scripts/design-mirror.mjs                          | 267 +++   (新、B1 ESM fix)
```

(注:設計紀錄字面源 docs/proposals/* 由 Cowork 寫、Code 純落檔;~/.claude/skills/{slice-checkpoint,codex-review}/SKILL.md 屬 home dir、不入 repo、不在本 diff。)

---

## 3. 字面 vs 事實揭示(鐵則 11、Code 階段 0 起手抓到 3 議題 + Sean 拍板)

Code 落字面前查證 Cowork 字面源,抓到 3 處與現行環境/repo 衝突,raise multi-select、Sean 逐一拍板:

- **A2(`.claude/settings.json`):** 原字面源 §F 用 PreToolUse hook 擋 `.env` 寫/改,讀檔用 `process.env.CLAUDE_TOOL_INPUT_FILE_PATH`。經 claude-code-guide 查證:**現行(2026-05)Claude Code 無此 env var**(工具輸入走 stdin JSON、取 `.tool_input.file_path`;block 須 exit 2 非 exit 1;且 §F 引用的 2 個 hook 腳本 `scripts/hooks/*` 未建)。Sean 拍 **A2**:改用 `permissions.deny` 路徑規則 hard-block(`.env`/`.env.*` 的 Bash+Write+Edit),需腳本的 design-mirror pre-commit + code-reviewer SubagentStop 兩個 hook 延後(見 settings.json `_deferred_hooks_note`、首用在 M-1-13I 起補腳本)。
- **B1(`scripts/design-mirror.mjs`):** 原字面源 §D 在 `.mjs`(ESM)內 `const { execSync } = require('node:child_process')`,ESM 無 `require`、`--update-global-sync` 模式會 ReferenceError(`--validate` / `node --check` 掃不到)。Sean 拍 **B1**:改 top-level `import { execSync } from 'node:child_process'`。
- **C1(`.gitignore`):** L33 既有 `.claude/` blanket-ignore 整個資料夾,與 §F「settings.json 入 git」+ §E「code-reviewer.md 入 git」衝突(`git add` 直接 error)。Sean 拍 **C1**:改 white-list pattern(`.claude/*` + `!.claude/agents/` + `!.claude/settings.json` + `.claude/scratch/`),放行兩共享檔、維持忽略 settings.local.json / worktrees / scratch。Cowork 已 amend master §L.2 字面對齊事實。

其他事實對齊:
- ~/.claude/skills/{slice-checkpoint,codex-review}/SKILL.md 屬 Sean home dir、不入本 repo;codex-review SKILL 補最小 frontmatter(name/description)使 skill 可被 Claude Code 載入(原 §G-2 字面缺 frontmatter)。
- Cowork Projects instructions(bundle-docs §J)由 Sean 手動貼進 Cowork app、不入 repo。
- STATUS「ahead=6 slice-2~7 待 push」為 stale(handoff 確認 M-1-13H 已 push、session 起手 git status = up to date),本 slice 已更正為 ahead=2。

---

## 4. Manifest 異動摘要(本 packet 期間)

本 slice 建 `docs/design-storefront-manifest.yaml` 第一版(14 元件)、`design-mirror.mjs --validate` 全綠(0 broken link)。第一版 LOG 的 business_overrides(均為既有 Sean 業務拍板、本 slice 只是首次寫進 manifest、非新增偏離):

### 已記 business_overrides(來源見各條 decision_source)
- ProductsPage.outOfStockUI:不顯庫存數字(#161、Sean 拍 Phase 1 不顯庫存)
- ProductPage.freeShippingThreshold:NT$5,000(M-1-13H plan §2 Q1、鐵則 1 例外=價格業務邏輯)
- ProductPage.mobileBarColor:紅色加入購物車保留(Q3=B、轉換率)
- ProductPage.relatedGridComponent:用既有 <ProductCard>(Q4、不複製 demo)
- ProductPage.dealerPriceTag:tag 對齊但 mock price 仍 retail(#161 + 待 M-1-16 真經銷化)
- ProductPage.hasSpotlightField:MockProduct 加 hasSpotlight(Q2、Phase 2 對應 product_spotlights)
- ProductHighlights / ProductSpotlight / ProductTabs / ProductServices:Phase 1 hardcoded、對沖 Phase 2 supabase 6 表
- ProductInfo.tierPropPassthrough:tier prop 傳遞鏈(#130 + 13e-a)
- Header.handleNavFallback:保留 onNav fallback(lessons §12-28)

### open_drifts(未解決偏離、等對應 slice)
- ProductsPage / VehicleFinder / ProductPage:M-1-13I 待修 3 車款狀態 bug(URL 不讀 / 麵包屑 href 不帶 vehicle / vehiclePill onClick 一律 clear);URL 格式不一致(3 param vs 1 param)
- AccountPages.loginRegisterPageSplit:M-1-15 待新建

### last_modified_commit 同步狀態
- 本 slice 不動任何 storefront 元件、manifest 各元件 last_modified_commit 沿用既有 hash、無需 amend。
- last_global_sync:design submodule 637dafc(2026-05-21)、未動。

---

## 5. 風險殘餘(Code 自評)

1. **延後的兩個 hook(A2):** design-mirror pre-commit 強制 + code-reviewer SubagentStop 強制目前是「規則自律」非「hook 硬攔」。風險:Code session 漏跑 design-mirror inspect / 漏 spawn code-reviewer 時無設施層攔截。對沖:CLAUDE.md/AGENTS.md 六件套禁止清單已寫成規則;首個真用 slice(M-1-13I)起補腳本(腳本須對齊 claude-code-guide 結論:stdin JSON / exit 2 / existence guard)。**請 Codex 評估:延後是否可接受、或建議本輪就補精簡腳本。**
2. **manifest 第一版只 14 元件:** 其餘 ~20 元件留待觸到才填(規範段已寫 grep 規則)。風險:後續 slice 動到未登錄元件時 design-mirror --target 會 miss。對沖:cowork-review-chain §6 grep 規範 + --target 的 no-entry 提示。
3. **STATUS hash 1-step 偏移:** STATUS 記 `0c764e1`、實際 HEAD `81ba671`。屬 busboy-end 雙 amend 自參考特性(commit 含自身 hash 無法收斂)、歷來如此(上輪 STATUS 記 1b61a9d 實際 ee509fa)、backlog #142 已知。push 後 Sean 推的是 81ba671。**非本 slice 引入、列出供 Codex 知情。**
4. **code-reviewer subagent 本 slice 未自我審:** 因 code-reviewer 是本 slice 才建出、無法對本 slice 跑階段 C(雞生蛋)。本 slice 改以 Code 起手 raise + Codex(本 packet)補審。

---

## 6. Rollback 方式

```
git revert 81ba671        # 回滾 Stage 3 deliverable(保留 chore 收遺留)
git revert 786a52c        # 如需連同遺留收一起回滾
# 或未 push 階段直接 git reset --hard origin/dev(丟 ahead=2 兩 commit)
```
未 push、rollback 無遠端影響。pnpm install 的 yaml devDep 若回滾 package.json 需重跑 pnpm install。

---

## 7. 相關規則摘錄(Codex 無 repo 存取、自帶上下文)

- **鐵則 1:** design 直接搬、不翻譯;業務 override 偏離合法(本 slice 不動 storefront、N/A,但 manifest business_overrides 段即此守則的紀錄載體)。
- **鐵則 8:** 重大改動先 plan(本 slice 跨 18 檔、Cowork 寫的 master 即 plan)。
- **鐵則 11:** 三綠 + 字面 vs 事實(本 slice 純 .md/.json/.yaml/.mjs、typecheck/lint 對其多 N/A、改以 design-mirror --validate + node --check 驗;字面 vs 事實見 §3 A2/B1/C1 揭示)。
- **鐵則 12:** 進度單元結束產 Packet(本 packet 即是)。
- **新工作流核心(本 slice 落地):** 設計↔現場 manifest 對照表 + design-mirror inspect 工具 + 5 階段對抗審查鏈(A PRD-reviewer / B slice-reviewer / C code-reviewer / D Codex / E Sean 肉眼)+ 五方分工(Sean / Cowork / Claude Code / Codex / Claude Design)+ slice 指令六件套。

---

## 8. 預計後續 slice / milestone 範圍

- **即時:** Sean push origin dev(ahead=3、含 Codex findings fix commit);Cowork app 貼 §J Projects instructions(若未貼)。
- **下一 milestone(新工作流首跑):** M-1-13I 修 3 車款狀態傳遞 bug(Cowork 寫 plan + Sean 拍板)。
- **後續:** M-1-14 Customer schema / M-1-15 LoginPage·RegisterPage / M-1-16 200 SKU 種子 + 接 Supabase + Phase 2 supabase 6 表真區分。
- **A2 補腳本:** 2026-05-22 Sean Q3=B 拍板、M-1-13I 完成後獨立 slice 補 scripts/hooks/pre-commit-check.sh + subagent-stop-check.mjs(對齊 Codex「先修 design-mirror 覆蓋面再補 hook」建議、本 fix slice 已修)。

---

## 想請 Codex 重點看

1. **A2 延後判斷:** 把 design-mirror pre-commit + code-reviewer SubagentStop 兩 hook 延後(現為規則自律)是否可接受?還是建議本輪就補精簡腳本?
2. **B1 修正:** top-level `import { execSync }` 是否正確、有無漏改其他 ESM/CJS 混用點?
3. **C1 .gitignore white-list:** pattern 是否正確(放行兩共享檔、確實維持忽略 settings.local.json / worktrees / scratch)?有無漏放行未來 `.claude/agents/` 下新檔的風險?
4. **manifest 設計:** business_overrides / open_drifts schema 是否足以支撐「動一處不爆炸」?第一版只 14 元件是否風險。
5. **五階段 review 鏈 + 五方分工:** 是否有角色邊界漏洞 / 重疊未分清。

**Claude Code 自評:** 可繼續(三項驗證綠:design-mirror --validate 14 元件 OK / node --check syntax OK / settings.json+package.json valid JSON);待 Codex findings 回 Cowork 後決定是否補案。
