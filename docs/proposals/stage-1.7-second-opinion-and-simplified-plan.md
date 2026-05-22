# Stage 1.7 — Second-Opinion 整合 + 簡化方案

> **觸發:** Sean 要求 Stage 3 前用其他 skill / brainstorm 再審一次、Cowork 跑 2 個獨立 Agent 並行 + 自查 chrome MCP 能力
> **產出者:** Cowork 整合(Agent 1 general-purpose audit + Agent 2 Plan 替代設計 + Cowork chrome MCP 自查)
> **日期:** 2026-05-22
> **位置:** outputs/ Cowork scratchpad
> **結論:** Stage 2 方案有 5 個大盲點 / Stage 3 前必補。整合兩方視角後**簡化:4 subagent → 2 subagent + 加 L3 自動視覺驗層**(Playwright headless + design-reference/screenshots/ 既有 89 張真權威)

---

## §1 TL;DR(一句話)

**整合後最終方案 = 2 subagent + 2 hook + 2 skill + 3 .mjs script(視覺驗自動化)**。Code 自己跑 Playwright headless 截圖比對 design-reference + 字面 grep、Sean 只在拍板 / Codex 貼 / push 介入、不肉眼來回。Token 省 ~30%、drift 風險面減半、視覺驗 100% 自動化。

---

## §2 兩 Agent 視角整合(對比 + 共識 + 分歧)

### 2.1 共識點(兩方完全一致)

| # | 共識 | Stage 2 漏在哪 |
|---|---|---|
| C1 | **視覺驗自動化是最大盲點** | Stage 2 通篇 0 字提 chrome MCP / Playwright / screenshot diff |
| C2 | **planner subagent 多餘** | Cowork 寫的 slice 指令本身就是 strategy + metadata、planner 等於重做一次 |
| C3 | **靠 Cowork slice 指令當 strategy、Code 主 session 直接跑** | 不需新層 |
| C4 | **A mode 風險高、不該預設** | M-1-13H automode 已實證偷跑事故(handoff §9)、預設 B mode 較穩 |
| C5 | **靠既有 husky + lint-staged + 既有 screenshots/ + patterns、不重複造輪** | 加 .mjs 腳本 + 改既有 skill 即可 |

### 2.2 分歧點(兩方差異)

| 議題 | Agent 1(general-purpose) | Agent 2(Plan) | 採用 |
|---|---|---|---|
| **視覺驗工具** | chrome MCP(navigate + screenshot + read_page + read_console + find)main session 跑 | **Playwright headless + pixelmatch + design-reference/screenshots/** Code CLI 自跑 | **Agent 2**(無桌面依賴 / 已有 baseline / Code 純 bash) |
| **元件數** | 2 subagent + 2 hook + 2 skill(簡化版)| 8 元件(含 3 .mjs script 為主、視覺驗為核心) | **融合**:2 subagent + 2 hook + 2 skill + 3 .mjs script |
| **A mode 處置** | 預設 B mode、A mode 留 milestone 獨立 protocol | 不提 A mode、預設線性自治 | **Agent 1**:預設 B、A 模式留 protocol 檔 |
| **scratch 機制** | `.claude/scratch/{slice-id}-*.md` 中介、進 .gitignore | 沒明寫 | **Agent 1**:scratch 機制必要(implementer ↔ reviewer 字面共享)|
| **L2 整合順序** | reviewer → /slice-checkpoint → busboy-end → commit amend | husky pre-commit + pre-push 不動、L3 早於 pre-commit | **融合**:L3 視覺驗 + L1 reviewer 都早於 pre-commit、husky 是最後一道網 |

### 2.3 兩 Agent 各自獨有點

**Agent 1 獨有:**
- Codex findings 接回 implementer 迴圈(同 reviewer 自修)
- metadata schema 沒驗證機制是漂移風險(F-1 + B-5)
- subagent 共享記憶用 scratch 檔
- design drift 兩層判斷(L1 結構 / L2 內容)

**Agent 2 獨有:**
- 完整視覺驗演算法(像素 coarse gate + 字面 fine gate)
- L0-L4 階層架構圖(read-only truth / plan / execute / auto-verify / review)
- 對應 36 條 lessons + 45 條 trigger 防禦點表
- 失敗模式表(9 種失敗 + 處置 + Sean 介入 trigger)

兩方獨有都採用、補進整合方案。

---

## §3 整合後最終方案(L0-L4 階層架構)

```
┌─────────────────────────────────────────────────────────────────┐
│  L0  TRUTH LAYER (read-only, 真權威源)                           │
│      design-reference/ submodule (89 screenshots/ + 20 .jsx)    │
│      + docs/specs/*.md + STATUS.md + 6 ADR + 36 lessons         │
└──────────────┬──────────────────────────────────┬───────────────┘
               │ Cowork 直讀                       │ Code 直讀
               ▼                                  ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│  L1  PLAN  (Cowork)      │         │  L2  EXECUTE  (Code CLI) │
│  ─ 讀 handoff + STATUS   │         │  ─ 5 綠檢查              │
│  ─ 寫 slice 指令五件套   │ slice 指令│  ─ spawn implementer    │
│  ─ Sean multi-select 拍  │ ─────────▶ ─ spawn reviewer        │
│  ─ slice 指令含 metadata │ markdown │  ─ 自修迴圈 ≤2 輪        │
└──────────────────────────┘         └──────────┬───────────────┘
                                                ▼
                            ┌─────────────────────────────────────┐
                            │  L3  AUTO-VERIFY  (Code 自跑)        │
                            │  ① /slice-checkpoint(三綠、既有)   │
                            │  ② vitest smoke(若有改測試)        │
                            │  ③ scripts/visual-verify.mjs(新)   │
                            │     Playwright headless 截圖        │
                            │  ④ scripts/design-diff.mjs(新)     │
                            │     pixelmatch ↔ design-reference   │
                            │  ⑤ scripts/literal-grep.mjs(新)    │
                            │     design .jsx ↔ storefront .tsx   │
                            │     字面雙端 grep                    │
                            └──────────┬──────────────────────────┘
                                       │ pass → commit + busboy-end
                                       │ fail → 自修 ≤2 輪 → raise
                                       ▼
                            ┌─────────────────────────────────────┐
                            │  L4  REVIEW  (Codex Packet, 觸發時) │
                            │  Sean 貼 Codex(read-only)→ findings │
                            │  findings 回 → implementer 迴圈     │
                            └─────────────────────────────────────┘
```

### 3.1 元件清單(8 個、不超)

| # | 元件 | 職責(1-2 行) | 新 / 既有 |
|---|---|---|---|
| 1 | **Cowork(L1 planner)** | 讀真權威 + 寫 slice 指令五件套 + Sean multi-select、不動 code / git | 既有(Cowork desktop app) |
| 2 | **Code CLI(L2 executor + L3 conductor)** | 跑 bash / spawn subagent / 跑 L3 自驗 / commit / 不 push | 既有(Code CLI) |
| 3 | **implementer subagent** | Read/Write/Edit + 精準 git add + commit + 收 reviewer findings 改 | **新**(.claude/agents/) |
| 4 | **reviewer subagent** | 鐵則 1-12 自檢 + design drift 兩層 + security 條件區塊 + 讀 L3 report、唯讀 | **新**(.claude/agents/) |
| 5 | **scripts/visual-verify.mjs** | Playwright headless 啟 next dev + 截圖到 `.visual-snapshots/` | **新** |
| 6 | **scripts/design-diff.mjs** | pixelmatch 比對 `.visual-snapshots/*.png` ↔ `design-reference/screenshots/*.png` + JSON 報告 | **新** |
| 7 | **scripts/literal-grep.mjs** | anchor pattern 對 design .jsx vs storefront .tsx 雙端 grep + 字面 diff | **新** |
| 8 | **Codex Review Packet skill** | L4 觸發時 Code 自產 packet 內嵌 L3 report、Sean 貼 chatgpt.com/codex | **新** skill / 既有 patterns 文件 |

**廢:**
- planner subagent(Cowork slice 指令本身已是 strategy + metadata)
- security-reviewer 獨立 subagent(條件區塊併入 reviewer)
- skill-auditor subagent(Stage 1 已廢、留主 session 跑)

**從 4 subagent → 2 subagent**。

### 3.2 hook 配置(2 個)

| Hook | 觸發 | 行為 |
|---|---|---|
| **PreToolUse** | Write / Edit / Bash 動 .env* | Block + 回 「.env.local 受保護、改 dashboard 或 Sean Terminal 操作」 |
| **SubagentStop / PreToolUse** | implementer 結束、commit 前 | 阻擋 git commit 工具呼叫、檢 reviewer 是否跑過(看 scratch 檔)、未跑過拒絕 commit |

### 3.3 skill 配置(2 個)

| Skill | 內容 | 狀態 |
|---|---|---|
| `/slice-checkpoint` | 一鍵跑 typecheck + lint + 條件 build + **metadata schema 驗證(新)** + **L3 視覺驗 step(新)** | 既有(`~/.claude/skills/slice-checkpoint/`)、擴張 |
| `/codex-review` | 從 commit 序列 + diff + L3 report + 鐵則摘錄 自動產 Packet | **新** |

### 3.4 .mjs script 配置(3 個、視覺驗核心)

| Script | 功能 | 依賴 |
|---|---|---|
| `scripts/visual-verify.mjs` | Playwright headless 啟 `pnpm dev` + 對 slice 指令 metadata.routes 截圖 + 多視口(375/768/1280)+ 存 `.visual-snapshots/` | `playwright`(新 devDep)|
| `scripts/design-diff.mjs` | pixelmatch 比對 baseline(`design-reference/screenshots/`)vs candidate(`.visual-snapshots/`)、threshold ≤2%、輸出 diff PNG + `report.json` | `pixelmatch` + `pngjs`(新 devDep)|
| `scripts/literal-grep.mjs` | 從 slice 指令 anchor 抽 className / 文字節點 / SVG path d、design vs storefront set diff、報缺漏 / 多餘 | 純 Node stdlib |

### 3.5 slice 指令五件套(L1 metadata 升級)

Cowork 寫 slice 指令、第 5 件「Subagent 模式」升級為「執行模式 + L3 verify metadata」:

```yaml
═══════════════════════════════════════════
執行模式 + L3 驗證 metadata
═══════════════════════════════════════════
mode: B  # B mode (預設、線性 implementer→reviewer) / A mode 留 milestone 級 protocol
conductor: main session  # 主 Code CLI 自身、不另 spawn conductor subagent
subagent_chain:
  - implementer
  - reviewer
  # security 議題併入 reviewer 條件區塊、不獨立 subagent
fix_attempt_max: 2  # 超過 raise Sean

l3_verify:
  routes:  # visual-verify.mjs 要截圖的路由
    - /products
    - /products/oil-filter-honda-cbr-650r
  viewports: [375, 768, 1280]
  literal_anchors:  # literal-grep.mjs 的 anchor pattern 來源
    - source: design-reference/components/ProductsPage.jsx
      lines: "L120-L185"
    - source: design-reference/styles/products-page.css
      lines: "L50-L120"
  design_diff_threshold: 0.02

security_review_required: false  # reviewer 內條件區塊、true 時加跑 RLS/GRANT/auth/secret 檢查
codex_review_required: false  # milestone 結束 / 動 schema / pricing 時 true
context_window_estimate: low  # low/mid/high
═══════════════════════════════════════════
```

---

## §4 L3 自動視覺驗詳設(本方案核心、Stage 2 完全缺漏)

### 4.1 為什麼用 Playwright headless 不用 chrome MCP

| 工具 | 採用? | 理由 |
|---|---|---|
| chrome MCP | ❌ | Sean 環境 browser tier = read、Code CLI 無 MCP access、依賴桌面前景視窗、易漂移 |
| computer-use | ❌ | 同 + tier 限制 + 截圖座標不穩定、非 headless |
| **Playwright headless** | ✅ | Code 從 bash 直接跑、headless 不依賴桌面、in repo devDep、CI 友善、Sean 不在場也能跑 |
| pixelmatch + pngjs | ✅ | 純 npm 套件、無系統依賴、diff PNG Sean 只在出問題時開 |

### 4.2 整合流程(Code 自跑、Sean 不介入)

```
slice 收工 commit 前(/slice-checkpoint 三綠後、busboy-end 前):

Step 1  pnpm dev:storefront &              # background、port 3000
Step 2  wait-on http://localhost:3000      # 等 dev server 起來
Step 3  node scripts/visual-verify.mjs \
          --routes /,/products,/products/[sample-slug] \
          --viewports 375,768,1280 \
          --out .visual-snapshots/
Step 4  node scripts/design-diff.mjs \
          --baseline design-reference/screenshots/ \
          --candidate .visual-snapshots/ \
          --threshold 0.02 \
          --report .visual-snapshots/report.json
Step 5  node scripts/literal-grep.mjs \
          --anchors slice-anchors.json \
          --design design-reference/components/ \
          --storefront apps/storefront/src/components/ \
          --report .visual-snapshots/literal.json
Step 6  kill dev server
Step 7  解析 report.json + literal.json → 全綠 commit、紅 → 自修 ≤2 輪
```

### 4.3 對齊 design 字面雙層演算法

**Layer 1: 像素層(coarse gate)**
- baseline:`design-reference/screenshots/{NN}-{name}.png`(既有 89 張、真權威截圖)
- candidate:Playwright 對對應 storefront route 截同視口同尺寸
- 演算法:pixelmatch diff ratio ≤ 2% 通過、> 2% 紅 + 輸出 diff PNG
- 容忍:font hinting / antialias 抖動(pixelmatch `includeAA: false`)

**Layer 2: 字面層(fine gate、防鐵則 1 違反、§12-3 維度 A)**
- anchor 來源:slice 指令 metadata `literal_anchors` 字面寫
- design 端:從指定 .jsx 抽出 className / 文字節點 / SVG path d 屬性
- storefront 端:從對應 .tsx 抽出同類 token
- 演算法:set diff → 缺漏 token 紅、多餘 token 黃(允許但記 backlog)

兩層全綠才允許 commit、任一紅進「自修 ≤2 輪」、超過 raise。

### 4.4 對齊 backlog #161 業務拍板偏離

業務拍板偏離(例如免運門檻 design L302「NT$ 4,000」storefront 統一「NT$ 5,000」)、Cowork 在 slice 指令 `literal_anchors` **排除** 該行;若 reviewer 仍標出偏離、視為「業務拍板未涵蓋」→ raise Sean 拍。

### 4.5 純 docs / 簡單 slice skip 規則

對齊 working-style 第 30 條三條件:
- 純 docs slice → 全 skip L3
- 簡單 slice(<10 行新 code + 非 entity / adapter / API surface / use-case logic + 無新 entity / adapter / schema / API surface)→ skip L3
- 進度單元結束、視覺改動、新增頁面 → **強跑** L3

---

## §5 跟既有工具整合

| 既有工具 | 不動 / 擴張 / 串接 |
|---|---|
| `.husky/pre-commit`(lint-staged ESLint) | **不動**、L3 早於 pre-commit 跑、pre-commit 是最後一道網 |
| `.husky/pre-push`(typecheck + lint) | **不動**、Sean 手動 push 時最後驗 |
| `~/.claude/skills/slice-checkpoint/` | **擴張**:加 L3 step + metadata schema 驗證 |
| `docs/patterns/slice-checkpoint.md` | **擴張**:同步加 L3 規範段 |
| `docs/patterns/codex-review-packet.md` | **擴張**:加 `.visual-snapshots/report.json` 內嵌段 |
| `.gitignore` | **加 1 行**:`.visual-snapshots/`(diff PNG 不入 git) |
| `vitest` | **不動**、單元測 + DOM smoke 走 vitest、視覺走 Playwright、職責切清 |
| `vercel.json` / `turbo.json` | **不動**、L3 跑在 local |
| `design-reference/` submodule | **不動字面**、L3 讀 screenshots/ + components/ 純讀 |
| `package.json` | **加 devDep**:`playwright`(headless)+ `pixelmatch` + `pngjs` |

---

## §6 三視角評估

| 視角 | 評估 |
|---|---|
| **擴充性** | scripts/*.mjs 純 stdlib + 3 npm、新增「mobile flow / tablet flow / a11y axe-core」只需加新 .mjs、不動架構;Playwright 換 trace mode 即支援錄影 debug;design-reference 換 Figma export 也能 reuse pixel diff;metadata 用 key-value、加新欄位只動 metadata schema doc + reviewer prompt 一處 |
| **可維護性** | 8 個元件邊界清楚、L0~L4 單向依賴、每層職責 1 行可述;新增 script 統一 `scripts/` 一目錄;husky / lint-staged 不動;Sean 看不懂時 Cowork 可直接畫 §3 ASCII 圖解釋 |
| **bug 追蹤性** | L3 每輪 `.visual-snapshots/report.json` + diff PNG、commit body 引用;失敗時 Sean 開 `.visual-snapshots/diff-{route}-{viewport}.png` 一眼定位;literal-grep 報告含 `design 字面 L120 vs storefront 字面 L88`、直跳行號;`.visual-snapshots/` 進 .gitignore 不污染 git history;每輪 attempt 寫 `.claude/scratch/{slice-id}-attempt-{N}.md` 含 findings、push 後 commit body 引用、可追 |

---

## §7 防禦點對應(36 條 lessons + 45 條 trigger)

| 防禦點 | 元件 / 機制 | 對應條款 |
|---|---|---|
| 跨 session 字面失憶 | slice 指令必含 `literal_anchors:`、Cowork Projects 持久化 | §12-25、第 34 條 |
| 字面 vs 事實偏離 | literal-grep.mjs 雙端 grep + diff、commit body 強制揭示 | §12-3 維度 A、§12-30、第 39 條 |
| design 翻譯化 | pixel diff > 2% 紅 + 字面 set diff 缺漏紅 | 鐵則 1、§12-21 |
| commit 字面 vs 事實 | slice-checkpoint 三綠 + L3 視覺驗 gate | 鐵則 11、§12-29 |
| 工具能力字面 vs 事實 | scripts/* 自身可 `--dry-run` 驗 | §12-32、第 41 條 |
| zsh 禁忌 | 所有 script 用 .mjs(node 跑、不經 zsh)| §12-20、第 28 條 |
| 立法字面結構誤 | L3 不寫立法、Cowork 寫立法前 view 末條編號 | §12-34、§12-36、第 43 / 45 條 |
| 規劃稿字面 vs code 實況 | Code 在 slice Step 1 必跑 literal-grep raise mismatch | 第 13 條 |
| Claude.ai 詮釋失準 | Cowork 取代 Claude.ai(Projects 持久化)| §12-30 |
| 跨 session 編號漂移 | literal-grep.mjs 順帶 view §12 / 第 N 條末條編號、寫立法前 echo | §12-34、第 43 條 |
| Orchestrator 漂移 | L3 單 session 線性、不開 sub-agent 平行 | 鐵則 7 |
| 跨 3+ 檔重大改動 | visual-verify.mjs 跑前 `git diff --name-only` count > 3 → 強制 Codex Packet | 鐵則 8、鐵則 12 |
| L3 內容分級 | slice 指令必標 L1/L2/L3、L3 hardcode hard fail(literal-grep 找 CMS-like 字串)| 鐵則 9 |
| 鐵則 4 超時 | L3 失敗第 2 輪自動 raise、不無限循環 | 鐵則 4 |
| .env.local 失手改 | PreToolUse hook 硬攔 | 第 25 條、§12-15 |
| metadata YAML drift | /slice-checkpoint 加 schema 驗證 step | F-5 / 新增 |

---

## §8 失敗模式 + Sean 介入 trigger

| 失敗模式 | 自動處理 | Sean 介入 trigger |
|---|---|---|
| pixel diff > 2%、字面 set 缺漏 | Code 自修第 1 輪(看 diff PNG + literal report 改 .tsx / .css) | 第 2 輪仍紅 → Code raise multi-select、貼 diff PNG 路徑 |
| Playwright timeout / dev server 啟不起來 | Code 重啟一次 | 第 2 次仍失敗 → raise、Sean 看 console 判斷 |
| literal-grep anchor pattern 命中 0 | Code raise(對齊 §12-36 meta 第 1 印證) | 立刻、不自修(可能 anchor 字面寫錯) |
| slice 指令字面 vs design 實況偏離 | Code Step 1 偵察階段 raise | 立刻、Cowork 重寫 slice 指令 |
| 鐵則 8 觸發(跨 3+ 檔)| Code 跑 L3 前先停、產 plan | 立刻、Sean 拍板才繼續 |
| 鐵則 12 觸發(milestone / security / migration / pricing)| Code commit 前自動產 Packet | 立刻、Sean 貼 Codex |
| 內容分級發現 L3 hardcode | Code 立刻停 | 立刻、Cowork 寫 PRD 後才繼續 |
| metadata YAML drift | /slice-checkpoint schema 驗證紅 → reviewer raise | 立刻、Cowork 修 slice 指令 metadata |
| .env.local 失手改 | PreToolUse hook 硬攔、回明確訊息 | 不需介入(hook 守) |
| L3 自身漂移(scripts/*.mjs 出錯)| Code raise + stack trace | 立刻、視 §12-29 違反、修腳本不修 slice |

**單一 Sean 介入原則**:L3 第 2 輪後紅、或任一鐵則觸發、或 anchor 字面命中 0。其餘 Code 自治。

---

## §9 Stage 3 簡化版 deliverable

整合後 Stage 3 寫:

| # | 檔 | 狀態 | 內容 |
|---|---|---|---|
| 1 | `.claude/agents/implementer.md` | 新 | YAML frontmatter + prompt + 自檢(跨 package import + .env.local 防 + 收 reviewer findings 改 + amend) |
| 2 | `.claude/agents/reviewer.md` | 新 | YAML frontmatter + prompt + 鐵則 1-12 自檢 + design drift 兩層 + security 條件區塊(metadata-driven)+ 讀 L3 report + 編號區分 + 字面校對 |
| 3 | `.claude/settings.json` | 新 | SubagentStop hook(reviewer 沒跑阻擋 commit)+ PreToolUse hook(.env.local + git commit pre-check)|
| 4 | `~/.claude/skills/slice-checkpoint/SKILL.md` | 擴張(若 Sean 本機沒則新建)| 既有三綠 + 加 L3 視覺驗 step + metadata schema 驗證 step |
| 5 | `~/.claude/skills/codex-review/SKILL.md` | 新 | 從 commit 序列 + diff + L3 report + 鐵則摘錄 自動產 Packet 寫 `docs/reviews/{date}-packet.md` |
| 6 | `scripts/visual-verify.mjs` | 新 | Playwright headless 啟 next dev + 截圖 |
| 7 | `scripts/design-diff.mjs` | 新 | pixelmatch 比對 + JSON 報告 |
| 8 | `scripts/literal-grep.mjs` | 新 | design .jsx vs storefront .tsx 字面雙端 grep |
| 9 | `package.json` | 改 | 加 devDep:`playwright` / `pixelmatch` / `pngjs` |
| 10 | `.gitignore` | 改 | 加 `.visual-snapshots/` + `.claude/scratch/` |
| 11 | `docs/patterns/slice-checkpoint.md` | 擴張 | 加 L3 視覺驗規範段 |
| 12 | `docs/patterns/codex-review-packet.md` | 擴張 | 加 `.visual-snapshots/report.json` 內嵌段 |
| 13 | Cowork context doc(Stage 2 §6 改寫)| 改 | 反映簡化:廢 planner / 廢 security-reviewer 獨立 / 加 L3 視覺驗 / scratch 機制 |
| 14 | CLAUDE.md / AGENTS.md(Stage 2 diff 微調)| 改 | 五件套 metadata schema 升級為含 L3 verify metadata、其他不動 |

---

## §10 跟 Stage 2 對比(簡化前 vs 簡化後)

| 維度 | Stage 2(簡化前) | Stage 1.7 整合(簡化後) | 變化 |
|---|---|---|---|
| subagent 數 | 4(planner / implementer / reviewer / security-reviewer)| 2(implementer / reviewer) | -2 |
| hook 數 | 2(SubagentStop + PreToolUse)| 2(SubagentStop + PreToolUse) | 不變 |
| skill 數 | 2(slice-checkpoint 擴張 + codex-review 新)| 2(同上)| 不變 |
| 新增 .mjs script | 0 | 3(visual-verify + design-diff + literal-grep)| +3 |
| 新增 devDep | 0 | 3(playwright + pixelmatch + pngjs)| +3 |
| 新 .md docs | docs/patterns/subagent-orchestration.md(若選 C)| 不需(集中在 Cowork context doc §6)| -1(避免雙 source) |
| token / slice 估 | 高(4 subagent + skill audit 全跑)| 中(2 subagent + L3 自跑、reviewer 讀 L3 report 不重複跑視覺驗)| **減 ~30%** |
| Sean 肉眼驗 | 仍需開瀏覽器跑頁 | 0(L3 全自動截圖 + pixel + literal)| **減 100%** |
| design drift 防護 | reviewer subagent prompt 內判斷 | reviewer 讀 L3 report(像素 + 字面雙重)| **升級** |
| metadata drift 防護 | 無 schema 驗證 | /slice-checkpoint 加 schema 驗證 step | **新增** |
| A mode 風險 | 預設可開、易偷跑(M-1-13H 事故)| 留 milestone 級獨立 protocol、預設 B mode | **降低** |

---

## §11 推薦下一步

**Q: 進 Stage 3 簡化版?**

| 選項 | 內容 | 三視角 |
|---|---|---|
| **A. 進 Stage 3 簡化版(推薦)** | 14 個 deliverable 依 §9 寫完整字面、Sean 改完 Code 落檔 | 擴充性高 / 可維護性高 / bug 追蹤性高 |
| B. 某幾條不認同、改 Stage 1.7 字面 | Sean 看出某點要調(例:Playwright 改 chrome MCP / scratch 機制改 commit body)、Cowork 改字面再給 | 擴充性中 / 可維護性高(避免事後改字面)/ bug 追蹤性高 |
| C. 簡化還不夠 / 過度設計 | 廢 reviewer 也只留 implementer + 加 L3、最小化 | 擴充性低(失去 PCM 鐵則細粒度檢查)/ 可維護性高 / bug 追蹤性中 |

### 11.1 若選 A 進 Stage 3

Stage 3 跑前 Cowork 必做:
1. **web_search 確認 2026-05 最新**:
   - Claude Code subagent YAML frontmatter 語法
   - SubagentStop hook / PreToolUse hook 配置語法
   - Playwright 1.x stable + Node 22 兼容性
2. **bash grep 確認 Sean 本機**:
   - `ls ~/.claude/skills/` 看 slice-checkpoint 是否真存在(對齊 CLAUDE.md L162 字面)
   - `ls ~/.claude/skills/codex-review/` 看是否未建(理應沒)
3. **Cowork 寫 Stage 3 14 個 deliverable**(分 3-4 個 file、避免單檔過長)

### 11.2 後續實戰驗證

Stage 3 寫完 + Sean 拍 + Code 落檔 + 第一個 milestone(M-1-13I)用新流程跑、收觀察:
- L3 視覺驗實際跑時間(預估 30-60s)、可接受?
- reviewer subagent 自修迴圈實際 token 消耗
- metadata schema 是否真防 drift
- Sean 介入頻率是否真降低

實戰一輪不行就再迭代、不一開始就追完美。

---

— END —
