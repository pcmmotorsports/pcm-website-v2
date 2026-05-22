# Stage 3 終版 v3 — Cowork Self-Audit

> **觸發:** Sean 拍 sign-off 原則 OK、要求 Cowork 重新確認流程 + 檢查漏缺、再開始落地
> **方法:** Cowork 自己跑端到端 mental simulation(階段 0 → 1 → 2 → ... → 8)、對齊 lessons §12 全套 + working-style 全套 + 鐵則 1-12、找漏缺、Cowork 自決補案(不丟 Sean 拍工程細節)
> **結論:** 找到 14 條漏缺、Cowork 自決補案、補進 Stage 3 終版 v4。本檔給 Sean 確認補案合理、然後 Cowork 寫完整字面 + Code 落檔指令。

---

## §1 端到端流程(本次模擬走一遍、找漏)

```
階段 0    本輪 Cowork session 後 — Cowork 寫完整字面 + Code 落檔指令 → Code 跑 commit → Sean 推
階段 1    M-1-13I session 開:Cowork 讀 handoff + manifest → 寫 slice 指令(六件套)
階段 1.B  slice-reviewer agent 跑(Cowork 用 Agent tool spawn fresh)— PASS / FAIL → Cowork 改
階段 1.C  Sean 拍 Q1+Q2 業務 → 貼 Code session
階段 2    Code 5 綠 → Read manifest → 改字面 → design-mirror.mjs inspect → /slice-checkpoint
階段 2.C  code-reviewer subagent 跑(Code 用 Task tool spawn fresh)— PASS / FAIL 自修 ≤2 輪
階段 2.D  commit + amend manifest sync + busboy-end → 不 push
階段 3    M-1-14 跑(同上、若 A mode milestone 級 PRD、加階段 1.A PRD-reviewer)
階段 4    M-1-15 跑
階段 5    /codex-review skill 自動產 Packet(對齊鐵則 12 milestone 結束)
階段 6    Sean 貼 Codex(階段 D)、收 findings → fix slice(若需)
階段 7    Sean 肉眼驗(階段 E、對齊 Q2=B)
階段 8    Sean push、Cowork 寫 handoff 收工
```

---

## §2 找到的 14 條漏缺 + Cowork 自決補案

### 🔴 漏缺 1:PRD-reviewer 觸發條件未明

**漏:** 階段 A PRD-reviewer 只在 A mode milestone 級才跑、B mode 單 slice 跳過、但 v3 spec 沒明寫觸發條件。

**Cowork 補案:**
- A mode(milestone 級 PRD、多 slice)→ Cowork 寫完 PRD 必跑 PRD-reviewer、不允許跳
- B mode(單 slice、直接寫指令)→ 跳 PRD-reviewer、直跳 slice-reviewer
- manifest 第一版 + 重大改動 manifest → 比照 A mode、必跑 PRD-reviewer 級 audit
- 觸發條件寫進 `docs/patterns/cowork-review-chain.md` §1

---

### 🔴 漏缺 2:slice-reviewer 每個 slice 是否強跑

**漏:** v3 沒寫 slice-reviewer 是「每 slice 強跑」還是「Cowork 主動判斷跑」。

**Cowork 補案:**
- **每個 slice 指令發給 Sean 拍前必跑、不允許 Cowork 自判跳過**(對齊 working-style 第 11 / 13 條 不憑記憶寫具體技術字面)
- 純 docs slice(只動 .md / .json、不動 .ts·.tsx·.css·.sql)可跳過、對齊 working-style 第 30 條
- 寫進 `docs/patterns/cowork-review-chain.md` §2

---

### 🔴 漏缺 3:code-reviewer prompt 帶什麼

**漏:** v3 沒寫 code-reviewer subagent 收到的 prompt 必含哪些字面、fresh context 怎麼拿到必要資訊。

**Cowork 補案:**
- code-reviewer prompt 必含:
  - slice 指令字面(對齊鐵則 8 plan + 五件套)
  - `git diff --staged`(實際改動)
  - manifest 異動段(若動到 storefront)
  - 鐵則 1-12 摘錄(避免假設 fresh context 看得到 CLAUDE.md)
  - 業務 override 紀錄(避免誤判業務拍板為誤翻譯、對齊 backlog #161)
- 寫進 `.claude/agents/code-reviewer.md` YAML frontmatter + prompt 段

---

### 🔴 漏缺 4:Manifest 第一版怎麼建、誰建、Cowork 憑記憶 vs grep

**漏:** v3 提「Cowork 寫 manifest 第一版」、但沒寫「禁止憑記憶、必須 grep」、易撞 lessons §12-25 字面內嵌義務。

**Cowork 補案:**
- 寫第一版時 Cowork 自己跑 grep:
  - STATUS L24「Phase 2 supabase 6 表 LOG」抽業務 override
  - backlog #161 + 相關 backlog 條目
  - docs/specs/M-1-13H-product-page-overhaul-plan.md 業務拍板紀錄
  - docs/handoff/2026-05-22-end-of-session.md §4 / §5
  - design-reference/components/ ls 抽元件清單
  - apps/storefront/src/components/ ls 對應現場清單
- 抽完後 Cowork 寫 YAML、跑 PRD-reviewer 級 audit、Sean 確認 1 次(對齊 working-style 第 27 條 — 影響資料結構、丟 Sean sign-off 整份、不丟細節)

---

### 🔴 漏缺 5:design submodule update 後 manifest 同步機制

**漏:** Sean 在 Claude Design 改 → push → Code 跑 git submodule update --remote、manifest 怎麼自動標記「design 端有改、storefront 沒跟」?

**Cowork 補案:**
- 新 design-mirror.mjs --diff-against-storefront 模式:
  - 對比 design submodule 當前 commit vs manifest 紀錄的 last_global_sync
  - 列「design 端有改但 storefront 沒跟」的元件、寫進 manifest open_drifts 段
- 觸發時機:Cowork 跑 `git submodule update --remote design-reference/` 後、必跑 --diff-against-storefront
- 不對齊不允許開新 slice(對齊鐵則 1 + 鐵則 3)
- 寫進 design-mirror.mjs spec

---

### 🟠 漏缺 6:business_overrides 跨檔追蹤

**漏:** v3 範例只列幾條(freeShippingThreshold / Mobile sticky bar / Related grid / tier 三 tier)、實況多得多。

**Cowork 補案:**
- 寫第一版時 Cowork grep 全 STATUS / backlog #161 + 相關 / specs / handoff、抽全清單(估 10-15 條業務 override)
- 每條格式統一:
  - field(欄位名)
  - design_value(原字面)
  - storefront_value(現字面)
  - decided_at(日期)
  - decision_source(docs 路徑)
  - backlog(條目編號)
  - reason(白話)
- 後續業務拍板新偏離、Cowork 在寫 slice 指令時 amend manifest 業務 override 段(對齊鐵則 11 字面 vs 事實)

---

### 🟠 漏缺 7:commit pre-check hook 怎麼知道 design-mirror.mjs 跑過

**漏:** v3 提 hook 攔截「動 storefront 但沒跑 design-mirror」、但檢機制沒寫。

**Cowork 補案:**
- design-mirror.mjs 跑時自動寫 timestamp 到 `.claude/scratch/{slice-id}/inspect.json`
- commit pre-check hook 檢:
  - git diff --staged 有動 apps/storefront/src/components/* → 必有 `.claude/scratch/{current-slice}/inspect.json` 存在 + 時間戳 < 1 小時
  - 否則 block + 回 「動 storefront 必先跑 design-mirror.mjs」
- `.claude/scratch/` 進 .gitignore、本地 audit trail、不入 git
- 寫進 .claude/settings.json hook 配置 + design-mirror.mjs spec

---

### 🟠 漏缺 8:/slice-checkpoint manifest sync 驗證算法

**漏:** v3 提「/slice-checkpoint 加 manifest sync 驗證 step」、但算法沒寫。

**Cowork 補案算法(Cowork 自決細節、不丟 Sean):**
- step 1:git diff --staged --name-only 列動到的檔
- step 2:若任一是 apps/storefront/src/components/* 或 apps/storefront/src/styles/*
  - step 2.a:從 manifest 找對應元件條目
  - step 2.b:檢 git diff --staged 有沒有 amend manifest 該條目的 last_modified_commit / date(用 placeholder 字串 `PENDING_HASH`、commit 後 amend 真 hash)
  - step 2.c:沒 amend → manifest sync 紅
- step 3:回 ✅ / ❌ 進 commit body
- 寫進 ~/.claude/skills/slice-checkpoint/SKILL.md

---

### 🟠 漏缺 9:slice 指令五件套 → 六件套

**漏:** v3 提 slice 指令格式但沒明確升六件套(加 codex_review_required / security_review_required / manifest impact)。

**Cowork 補案:**
- 升六件套:
  1. 任務目標
  2. 前置檢查
  3. 執行步驟
  4. 五件套舊有「Subagent 模式」段(改名「執行模式」)— 含 mode (A/B) / subagent_chain
  5. **新加「Manifest Impact + Review 觸發」段** — 含:
     ```yaml
     manifest_impact:
       动到的 storefront 元件: [...]
       對應 design 源: [...]
       業務 override 不算誤翻譯: [...]
       未解決偏離: [...]
       最近設計同步: ...
     review_triggers:
       prd_review: false  # B mode 跳 / A mode true
       slice_review: true  # 預設 true、純 docs slice false
       code_review: true  # 預設 true、純 docs slice false
       security_review_required: false  # 動 auth/payment/migration/secret true
       codex_review_required: false  # milestone 結束 / 動 schema·pricing·order true
     ```
  6. 驗收條件
  7. 禁止清單(對齊既有基線 + 加「不可動 .env.local」+「不可繞 design-mirror.mjs」)
- 結尾固定「— 禁止清單結束 —」
- 寫進 Cowork context doc §4 + AGENTS.md / CLAUDE.md 同步

---

### 🟠 漏缺 10:A mode vs B mode 切換規範

**漏:** v3 提預設 B mode、A mode 留 milestone 級獨立 protocol、但切換條件沒寫。

**Cowork 補案:**
- Cowork 主動提議切 A mode、Sean 拍板、不擅自切
- 觸發條件:
  - 剩餘 slice ≥ 3 且設計選擇耦合
  - Sean 顯示疲勞訊號(「累」「複雜」「想 automode」)
  - 連續 3+ 輪 Code raise
- A mode 用既有 M-1-13H-automode-protocol.md 模板、Cowork 為新 milestone 寫對應 protocol(避免重複框架)
- 寫進 docs/patterns/cowork-review-chain.md §3

---

### 🟠 漏缺 11:Failure recovery 自修上限規範

**漏:** v3 提「FAIL 2 輪 raise」、但每階段都該明寫。

**Cowork 補案:**
- 階段 A PRD-reviewer 2 輪 FAIL → Cowork raise Sean 拍方向(PRD 重寫 / 改 mode)
- 階段 B slice-reviewer 2 輪 FAIL → Cowork raise Sean 拍方向(slice 指令拆 / 改方向)
- 階段 C code-reviewer 2 輪 FAIL → Code main session raise Sean 拍處置(忽略 finding / 拆 slice / revert)
- 階段 D Codex Review findings → 必 Sean 處置、不自動修
- 階段 E Sean 肉眼驗 → Sean 主動拋議題、不自動
- 寫進 docs/patterns/cowork-review-chain.md §4

---

### 🟠 漏缺 12:Manifest exclude 規範

**漏:** v3 提 manifest 對應 23 元件、但 design-reference/components/explorations/ + 已 deprecated 樣式(.v1.css)沒處置。

**Cowork 補案:**
- explorations/ 整個目錄 exclude manifest(設計探索用、storefront 不對齊)
- .v1.css 等 deprecated 樣式標 `deprecated_in_design: true`、storefront 不需對齊
- 對應規範段寫進 manifest YAML 開頭 註解 + docs/patterns/cowork-review-chain.md

---

### 🟠 漏缺 13:Manifest YAML 解析依賴

**漏:** v3 寫 0 devDep、但 design-mirror.mjs 解析 YAML 需要 `yaml` 套件、Node 22 內建沒 YAML parser。

**Cowork 補案:**
- 選項 1:用 JSON 而非 YAML(0 devDep、但失去 YAML 註解能力、Sean 看可讀性降)
- 選項 2:加 1 個 devDep `yaml`(npm 套件、輕量、無 transitive deps、可信)
- **Cowork 自決選 2** — Sean「不懂程式碼但懂架構 / 邏輯」、YAML 註解能力對 Sean 讀 manifest 重要、1 個輕量 devDep 可接受
- 寫進 package.json devDep + Stage 3 deliverable

---

### 🟢 漏缺 14:code-reviewer 跟 Codex Review 重疊區

**漏:** v3 提兩者分工不重疊、但實況容易重疊報同議題、需明文。

**Cowork 補案:**
- code-reviewer 範圍:slice 級鐵則違反 + 字面 vs 事實 + manifest 同步 + commit message
- Codex Review 範圍:milestone 級 + 跨 slice 一致性 + 業務邏輯 + 視覺
- 重疊區(security / migration / pricing)→ 兩個都跑、Codex 看 milestone 級風險、code-reviewer 看 slice 級實作
- 寫進 docs/patterns/cowork-review-chain.md §5

---

## §3 Stage 3 終版 v3 → v4 變動摘要

| 維度 | v3 | v4 補案 |
|---|---|---|
| Deliverable 數 | 10 | **11**(加 `docs/patterns/cowork-review-chain.md`)|
| devDep | 0 | **1**(`yaml`)|
| slice 指令格式 | 五件套 | **六件套**(加 Manifest Impact + Review 觸發段) |
| .gitignore | 不動 | **加 `.claude/scratch/`** |
| hook 配置 | PreToolUse(.env.local + commit pre-check) | 同 + commit pre-check 加 design-mirror inspect.json 檢驗 |
| /slice-checkpoint | 加 manifest sync 驗證 | 加 manifest sync 算法明寫 |
| 漏缺 14 條補案 | 缺 | 全進 docs/patterns/cowork-review-chain.md + manifest + design-mirror.mjs spec |

---

## §4 Sean 確認

讀完本 audit、確認補案 14 條合理 → Cowork 開始寫 Stage 3 終版 v4 完整字面 + Code 落檔指令。

若補案某條不合理 / 你覺得 Cowork 簡化過頭 / 某條漏掉、回:
- **A. 補案合理、開始寫終版完整字面 + 落檔指令(推薦)**
- **B. 補案某條不對 / 漏掉、說哪條**(Cowork 修 self-audit 再給)

— END —
