# 2026-05-22 Stage 3 工作流升級 — Cowork Session 收工 Handoff

> Cowork session 收工交接文(本日第 2 個 Cowork session、第 1 個是 M-1-13H 完成後的 handoff)。下個 Cowork session 進來第一件事讀這份對齊。

---

## §1 Session metadata

| 欄位 | 值 |
|---|---|
| 日期 | 2026-05-22(同日兩 Cowork session、本份是第 2 個 / 工作流升級 session) |
| Cowork Session 重點 | Stage 3 工作流升級轉換(Claude.ai → Cowork、加 5 階段對抗審查鏈 + manifest 對照表 + code-reviewer subagent + Codex Review Packet) |
| Branch | `dev` |
| HEAD | `81ba671`(Stage 3 全套工作流升級)、**未 push、ahead=2** |
| 前一 commit | `786a52c`(chore 收上 session 遺留 CLAUDE.md 工具索引段 + handoff 檔) |
| design-reference submodule | `637dafc`(未動) |
| 工作樹 | clean(本 handoff 未 commit、untracked、屬本 session 末產出、Sean push Stage 3 兩 commit 後另開 Code session commit 收進 git) |

---

## §2 本 session 做了什麼

Cowork 端產出(全在 `docs/proposals/`、已 commit):
1. `stage-1-cowork-transition-recon-and-proposal.md`(現況偵察 + 提案大綱、揭示概念說明書 vs 實況 6 處 drift)
2. `stage-1.5-completeness-audit.md`(完整度 audit 5 critical + 7 一般 findings)
3. `stage-1.7-second-opinion-and-simplified-plan.md`(2 Agent second-opinion 整合 + 大幅簡化方案)
4. `stage-3-self-audit.md`(end-to-end 模擬找 14 條漏缺 + Cowork 自決補案)
5. `stage-3-master-and-onboarding.md`(終版 v4 + 階段 0 Code 落檔指令)
6. `stage-3-bundle-code-deliverables.md`(manifest YAML + design-mirror.mjs + code-reviewer.md + settings.json 字面)
7. `stage-3-bundle-docs-deliverables.md`(2 skills + 2 patterns 擴張 + 1 patterns 新 + Cowork Projects instructions + CLAUDE.md/AGENTS.md diff 字面)

Code 端落地(階段 0、commit 81ba671):
- 13 個 deliverable:manifest YAML + design-mirror.mjs + code-reviewer.md + .claude/settings.json + 2 skills + docs/patterns/slice-checkpoint.md 擴 + codex-review-packet.md 擴 + cowork-review-chain.md 新 + CLAUDE.md 升五方分工+六件套 + AGENTS.md 同步 + package.json yaml devDep + .gitignore white-list
- 5 份設計紀錄 git tracked(docs/proposals/)
- Codex Review Packet:`docs/reviews/2026-05-22-stage-3-onboarding-packet.md`(untracked、本 slice scope 鎖)

Code 跑 Stage 3 起手 3 個 raise + Sean 拍板:
| Raise | 議題 | Sean 拍 | 處置 |
|---|---|---|---|
| 起手 5 綠 | 工作樹不乾淨(CLAUDE.md +21 行未 commit + handoff untracked) | A | 786a52c 單獨 chore commit 收遺留 |
| §F hook 配置 | Claude Code 2026-05 SubagentStop / PreToolUse 語法字面未驗 | A2 | settings.json 用 permissions.deny 硬擋 .env、兩 hook 延後 M-1-13I 補腳本 |
| §D 字面 | design-mirror.mjs 內 `require()` 在 .mjs ESM 模塊不合 | B1 | 改 top-level `import { execSync } from 'node:child_process'` |
| §L.2 字面缺口 | `.gitignore` L33 .claude/ blanket 跟 §F/§E 入 git 衝突 | C1 | white-list pattern:`.claude/*` + `!agents/` + `!settings.json` + scratch/ |

---

## §3 當前 milestone 全貌

```
M-1-13a ~ 13f-2 ✅
M-1-13g ⏸    暫停(Toast 推延)
M-1-13H ✅   商品頁全面改版完成
Stage 3 工作流升級 ✅(本 session、ahead=2 待 push)
M-1-13I ⏭   3 個車款狀態傳遞 bug(下個任務、用新工作流跑)
M-1-14   ⏭   Customer schema
M-1-15   ⏭   LoginPage·RegisterPage
M-1-16   ⏭   200 SKU 種子
```

---

## §4 Stage 3 工作流升級要點(下個 session 對齊用)

### 4.1 新工作流 5 階段對抗審查鏈

| 階段 | 誰跑 | 抓什麼 |
|---|---|---|
| A. PRD 寫完(A mode) | Cowork Agent tool spawn PRD-reviewer | PRD 字面 vs 真權威 drift / 業務 override 漏記 |
| B. Slice 指令寫完 | Cowork Agent tool spawn slice-reviewer | 指令字面 vs PRD vs 真權威 / 六件套完整 |
| C. Code commit 前 | Code Task tool spawn `.claude/agents/code-reviewer.md` | 鐵則 1-12 + 字面 vs 事實 + manifest 同步 |
| D. Milestone 結束 | Sean 貼 Codex 唯讀審 | milestone 級風險 / 跨 slice 一致性 |
| E. 每 2-3 milestone | Sean 開瀏覽器肉眼 | 商品 / 顯示 / 操作 / 業務流程 |

詳規範:`docs/patterns/cowork-review-chain.md`

### 4.2 設計現場 manifest

`docs/design-storefront-manifest.yaml` — 14 元件對應 design 字面源 + 業務 override 紀錄 + 同步狀態。Cowork / Code 動 storefront 前 Read。
`scripts/design-mirror.mjs` — 動工前 inspect 工具、`--validate` / `--target` / `--update-sync` / `--update-global-sync` 模式。

### 4.3 Slice 指令升六件套

新增「Manifest Impact + Review 觸發」段(對齊 outputs/stage-3-self-audit.md F-9)。Cowork 寫每 slice 指令必填。

### 4.4 .claude/ white-list pattern

新增 .claude/ 內共享檔(agents/ + settings.json)入 git、個人設定 settings.local.json + scratch + worktrees 維持忽略。

---

## §5 下次 session 任務:M-1-13I(用新工作流跑、第一次實證)

### 5.1 任務內容(沿用 2026-05-22-end-of-session.md §5、不變)

3 bug fix:
1. 首頁 VehicleFinder push `?brand=X&model=Y&year=Z` / ProductsPage 不讀 URL → 車種跨頁丟失
2. 商品頁麵包屑 useMemo / vehicle 變數沒用 → crumbs href 不帶 vehicle
3. vehiclePill 整個 button onClick={handleClearVehicle} → 沒拆「pill 本體導航」+「× 清除」兩層

### 5.2 設計拍板題(Cowork 已寫對話內、待 Sean 新 session 拍)

**Q1:URL 格式統一(Bug 1 + 3 解依此決定)**
- A 統一 `?vehicle=brand:model:year` 1 param(推薦、改 VehicleFinder 1 處)
- B 統一 `?brand=X&model=Y&year=Z` 3 param(改 ProductsPage / ProductPage 2 處)
- C 兩格式都支援(冗餘)

**Q2:slice 拆法**
- A 1 刀合一(40-55 分、推薦)
- B 2 刀(URL 格式 + hydrate / 兩 bug)
- C 3 刀(每 bug 一刀、過細)

### 5.3 新工作流第一次跑、Cowork 順帶補的:

1. **補 A2 延後的兩 hook 腳本**:
   - `scripts/hooks/pre-commit-check.sh`(commit 前檢 .claude/scratch/{slice-id}/inspect.json)
   - `scripts/hooks/subagent-stop-check.mjs`(reviewer 沒跑就攔 commit)
   - 補時用 web_search 確認 Claude Code 2026-05 最新 hook 語法、不憑記憶(對齊 lessons §12-32 / §12-41)
2. **跑階段 B slice-reviewer**(Cowork Agent tool spawn、第一次實證對抗審查)
3. **跑階段 C code-reviewer subagent**(Code Task tool spawn、第一次實證)
4. **跑 design-mirror.mjs --target 寫 inspect.json**(commit pre-check hook 用)
5. **slice 結束 amend manifest sync**(對齊 §H-1 規範段)

### 5.4 Codex Review 觸發判斷

- M-1-13I 是 1 slice 範圍、非進度單元結束、不觸發 Codex Review(對齊 handoff 2026-05-22 §5.4)
- 若 M-1-13I 完成 + M-1-14 / M-1-15 跑完、Codex Review 在 3 milestone 結束自動產 Packet

---

## §6 Sean 待決策(沿用 + 本 session 新項)

沿用 2026-05-22-end-of-session.md §6:
- #1 發票自動化 / #3 TapPay sandbox / #4 部署(premortem step-2 設最晚拍板日)
- M-1-13I Q1+Q2 拍板(新 session 開時拍)
- Q6 explorations 刪除(Sean 在 Claude Design 端動)

本 session 新項:
- 無新項(Stage 3 工作流升級已落地、3 個 raise 都拍完)

---

## §7 下個 session 開場 prompt 範本

### 7.1 Cowork(新對話)

**Sean 開新 Cowork session 前必先完成 §10 順序 1-3**(貼 §J / 貼 Codex 審查 / Codex findings 無大議題後 push)。**若以下任一未完成、不要用本開場 prompt、新 Cowork session 會錯誤跳過 Codex 直接進 M-1-13I 拍板**(對齊 lessons §12-25 字面內嵌義務 + 5 階段對抗審查鏈階段 D)。

前置確認(Sean 用本 prompt 前自查):
- [ ] §J 已貼 Cowork app Projects instructions
- [ ] Codex Review Packet 已貼 chatgpt.com/codex 且 findings 已回 + 處置完
- [ ] origin/dev 已 push(ahead=0)

三項全綠才用以下 prompt:

```
請讀 docs/handoff/2026-05-22-stage-3-workflow-upgrade-cowork-session-end.md 對齊上下文、
再讀 STATUS.md + docs/PHASE-1-NORTHSTAR.md + docs/patterns/cowork-review-chain.md(新工作流規範)。

前置確認:Sean 已完成 handoff §10 順序 1-3(§J 貼 / Codex 審完 / push 完)。

接續任務:M-1-13I 3 個車款狀態持續傳遞 bug(用 Stage 3 新工作流第一次實證)。

請給我 Q1(URL 格式統一)+ Q2(slice 拆法)multi-select 拍板、Sean 拍完後:
1. Cowork 寫 slice 指令(六件套含 Manifest Impact 段)
2. Cowork 跑階段 B slice-reviewer(Agent tool spawn fresh)
3. PASS 後給 Sean 貼 Code
4. 順帶提議補 A2 延後的兩 hook 腳本(可併本 slice 或獨立 slice)
```

**若 Codex 仍在審或 findings 待處置、用以下「Codex 處置 prompt」取代:**

```
請讀 docs/handoff/2026-05-22-stage-3-workflow-upgrade-cowork-session-end.md。

Sean 把 Codex Review Packet(docs/reviews/2026-05-22-stage-3-onboarding-packet.md)findings 貼進來、Cowork 評估:
1. 哪些 findings 屬大議題、影響 push(列出 + 處置建議)
2. 哪些 findings 屬小議題、可 push 後追補(列出 + 進 backlog 或下 milestone)
3. 哪些 findings 是 Codex 誤判 / 重複既有規範(列出 + 反駁字面 source)
4. 評估完出三方案:全修 / 部分修 / 全 push 後追、Sean 拍

Codex 處置完才進 M-1-13I 開場 prompt(§7.1 主版本)。
```

### 7.2 Code(新 Claude Code session)

```
[貼 busboy-start.js pcm 輸出]
```

Code 跑完起手 5 綠檢查 + 讀套件、回報「我已讀完套件、可以開工」、然後等 Cowork 傳 M-1-13I slice 指令。

---

## §8 5 綠起手檢查預期(新 Code session)

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current     # 預期: dev
git status                     # 預期: clean(若 Sean 已 push、ahead=0;若 Sean 未 push、ahead=2)
git log --oneline -5           # 預期最上面:
                               #   81ba671 chore(workflow): Stage 3 終版 v4 工作流升級基礎建設
                               #   786a52c chore: 收 2026-05-22 session 遺留
                               #   46594ae docs(backlog): #163 dev tier override 機制
git submodule status design-reference  # 預期: 637dafc...
```

STATUS.md 頂列 hash 可能標 `0c764e1`(busboy-end 雙 amend 自參考慣例、對齊 backlog #142、屬正常)、實際 HEAD 81ba671。

---

## §9 本 session Cowork 學到的(寫進 lessons / memory 候選)

| 候選條目 | 對應教訓 |
|---|---|
| Cowork 簡化方案時、別把「Sean 肉眼驗頻率」跟「自動 review 必要性」混為一談(本 session 第一輪簡化把 reviewer subagent 砍掉是錯的、Sean 補回問「不需 subagent 做對抗審查嗎」)| 對齊 lessons §12-30 字面 vs 事實守則延伸 |
| Cowork 該執行 working-style 第 27 條(純 code 題 Cowork 自決、不丟 Sean)、本 session 一度丟太多工程選擇給 Sean、Sean 點出「我不懂程式碼、只懂顯示/操作/架構/邏輯」 | 對齊 working-style 第 27 條再強化 |
| Cowork 寫第一版 .gitignore / hook / setting 字面前必驗:repo 既有 .gitignore 字面、Code 2026-05 hook 語法(本 session 字面缺口 §L.2 被 Code C1 raise 修正)| 對齊 lessons §12-25 + §12-32 + §12-41 |
| 階段 0 落地驗證新工作流第一次跑通:Code 起手 3 個 raise 全合理、Sean 拍板乾淨、commit body 揭示完整、對抗審查精神在第一個 slice 就實踐 | 對齊 5 階段 review 鏈設計意圖 |

具體立法字面留下個 Cowork session 評估、若有 trigger 化價值再加進 docs/working-style.md §6.3 或 docs/lessons-learned.md §12-N。

---

## §10 Sean 在本 session 結束時待做的 3 件事(順序)

1. **貼 Cowork app Projects instructions §J**(從 `docs/proposals/stage-3-bundle-docs-deliverables.md` §J 複製進 Cowork app)— 下次 Cowork session 才會載入新規則
2. **貼 Codex 審查** `docs/reviews/2026-05-22-stage-3-onboarding-packet.md` 整份貼 chatgpt.com/codex、收 findings 回 Cowork(或下個 Cowork session 第一輪處理)
3. **push origin dev**(ahead=2、含 786a52c + 81ba671)— Codex findings 無大議題後再推

本 handoff(本檔)目前 untracked、Sean push 完 Stage 3 兩 commit 後、開新 Code session 順手 commit 本 handoff + push、之後新 Cowork session 才能讀到。

或更簡單:Sean push 前先在當前 Code session(若還活)直接 `git add docs/handoff/2026-05-22-stage-3-workflow-upgrade-cowork-session-end.md && git commit -m "docs(handoff): 2026-05-22 Stage 3 workflow upgrade Cowork session end"`、一次 push 3 commits。

— END —
