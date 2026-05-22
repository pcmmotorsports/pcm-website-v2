# Stage 3 終版 v4 — Bundle Docs Deliverables(字面源)

> **產出者:** Cowork
> **位置:** outputs/ Cowork scratchpad、Code 跑階段 0 onboarding 時 Read
> **內容:** 7 個 docs / config 類 deliverable 完整字面
>   - §G-1 `~/.claude/skills/slice-checkpoint/SKILL.md` 擴張段
>   - §G-2 `~/.claude/skills/codex-review/SKILL.md` 新建完整字面
>   - §H-1 `docs/patterns/slice-checkpoint.md` 擴張段
>   - §H-2 `docs/patterns/codex-review-packet.md` 擴張段
>   - §I `docs/patterns/cowork-review-chain.md` 新建完整字面
>   - §J Cowork Projects instructions(放 Cowork app、不入 repo)
>   - §K-1 / K-2 `CLAUDE.md` / `AGENTS.md` diff

---

## §G-1 `~/.claude/skills/slice-checkpoint/SKILL.md` 擴張段(append 既有檔末段)

> 既有 SKILL.md 已實作 typecheck + lint + 條件 build 三綠跑手(對齊 CLAUDE.md L155-167)。本 Stage 3 擴張 = 加 manifest sync 驗證 step。
> Code 若 Sean 本機 ~/.claude/skills/slice-checkpoint/SKILL.md 不存在、Write 完整字面對齊本擴張段精神。

```markdown
## 第 N+1 步:Manifest sync 驗證(Stage 3 v4 新加、對齊 docs/patterns/slice-checkpoint.md)

> 觸發條件:本 slice 動到 `apps/storefront/src/components/*` 或 `apps/storefront/src/styles/*`、必跑;純 docs / config slice 跳過。

執行邏輯:
1. `git diff --staged --name-only` 列動到的檔
2. 若任一在 apps/storefront/src/components/ 或 apps/storefront/src/styles/
   2.1 從 `docs/design-storefront-manifest.yaml` 找對應元件條目
   2.2 檢 `git diff --staged docs/design-storefront-manifest.yaml` 有沒有改該元件 `last_modified_commit` 欄位
   2.3 沒改 → manifest sync 紅、列具體元件名 + 期望改的欄位路徑
3. 沒命中對應元件 → 提醒 Cowork amend manifest(加新元件條目)

實作參考:
- `node scripts/design-mirror.mjs --validate`(可選跑、補驗 manifest 整體一致)

✅ / ❌ 輸出貼 commit body 摘要段。

— end manifest sync 驗證段 —
```

---

## §G-2 `~/.claude/skills/codex-review/SKILL.md`(新建完整字面)

```markdown
# Codex Review Packet Generator skill

> **狀態:** 新建 / 2026-05-22 Stage 3 v4 落地
> **觸發:** 鐵則 12 條件成立時(milestone 結束 / security / RLS / migration / pricing / order / Sean 主動要)
> **對應規範:** `docs/patterns/codex-review-packet.md`(完整流程)+ AGENTS.md 鐵則 12(Codex 端收 Packet 唯讀審)

## 用途

從本 slice / 本進度單元的 commit 序列 + diff + manifest 異動段 + 對應規則摘錄、自動產出 Codex Review Packet 寫到 `docs/reviews/{date}-{topic}-packet.md`、Code 停下提醒 Sean 貼 chatgpt.com/codex。

## 觸發條件(對齊 CLAUDE.md / AGENTS.md 鐵則 12)

任一即觸發:
- 進度單元結束(milestone 收尾 / Cowork slice 指令 metadata `codex_review_required: true`)
- 動 security / RLS / GRANT / migration / schema
- 動 pricing / order / payment / 三 tier 邏輯
- 動會員 tier / 經銷價
- Sean 說「Ready for review」
- 本 slice 自評有風險

## 跑時做什麼

1. 收集本 packet 範圍 commit 序列(`git log origin/dev..HEAD --oneline`)
2. 抽 diff 摘要(`git diff origin/dev..HEAD --stat` + 完整 diff)
3. 讀 `docs/design-storefront-manifest.yaml` 對應元件 business_overrides + open_drifts 異動段
4. 從 `CLAUDE.md` / `AGENTS.md` / `docs/lessons-learned.md` 抽相關規則摘錄(對齊 packet 自帶上下文)
5. 組 packet markdown、寫到 `docs/reviews/{YYYY-MM-DD}-{topic}-packet.md`
6. 輸出提示「Packet 已產:路徑 X、請貼 chatgpt.com/codex 唯讀審查、findings 回來後 Cowork 寫修案 slice」

## Packet 內容(對齊 `docs/patterns/codex-review-packet.md`)

```markdown
# {Topic} Codex Review Packet

> 對齊鐵則 12:{觸發條件} → 必產 Packet 給 Sean 貼 Codex 唯讀審查

## 1. 範圍
- 本 packet 範圍 commit:{N} 個
- branch / HEAD:dev / {hash}

## 2. Commit 序列
| # | hash | subject | 重點 |
|---|---|---|---|
... (從 git log 抽)

## 3. 字面 vs 事實揭示
... (從各 commit body 摘錄揭示段)

## 4. Manifest 異動摘要
- 本 packet 期間新加 business_overrides:[列點]
- 新加 open_drifts:[列點]
- last_modified_commit 同步狀態:[列點]

## 5. 風險殘餘
... (Code 自評未解議題、PRD 預期 raise 但未發生、潛在問題)

## 6. Rollback 方式
git revert {start_hash}..{end_hash}(按反序、保留 baseline)

## 7. 相關規則摘錄(Codex 無 repo 存取、自帶上下文)
... (從 CLAUDE.md / AGENTS.md / lessons §12-N / 對應 ADR 摘相關段)

## 8. 預計後續 slice / milestone 範圍
... (從 STATUS L下一步 + handoff §5 抽)
```

## 失敗模式

- git log / git diff 失敗 → raise(可能 branch 狀態異常)
- manifest 讀失敗 → raise(可能 YAML drift、跑 design-mirror.mjs --validate)
- 規則摘錄找不到 → raise(可能 lessons / patterns 文件路徑變動)

— end skill —
```

---

## §H-1 `docs/patterns/slice-checkpoint.md` 擴張段(append 在「## L1 規則層」末尾)

```markdown
## L1 + Stage 3 v4 新加:Manifest sync 驗證(對齊 outputs/stage-3-self-audit.md F-8)

> **加入時點:** Stage 3 v4 落地(2026-05-22)、對齊新工作流「設計 ↔ 現場 對照表」機制
> **規範層:** L1(規則層、本檔)+ L2(/slice-checkpoint skill 工具層、自動跑)+ L3(.husky/pre-commit lint-staged 設施層)

### 規範

每個動 storefront 元件的 slice、commit 前必跑 manifest sync 驗證:

1. **必跑時機:** /slice-checkpoint 三綠後、commit 前(對齊鐵則 11 不動 disable / skip)
2. **驗證內容:**
   - `git diff --staged --name-only` 列動到的檔
   - 任一在 `apps/storefront/src/components/` 或 `apps/storefront/src/styles/`、必有對應 manifest 元件條目 `last_modified_commit` 欄位被 amend(用 `PENDING_HASH` placeholder、commit 後 amend 真 hash)
   - 動到 design-reference submodule(submodule update)、必有 manifest `last_global_sync` 段同步 amend
3. **失敗處置:** Code raise multi-select、Sean 拍處置(補 amend / 開新 slice / 業務 override 紀錄)、不擅自 PASS

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
```

---

## §H-2 `docs/patterns/codex-review-packet.md` 擴張段(append 在末段)

```markdown
## Stage 3 v4 新加:Packet 含 Manifest 異動段(2026-05-22)

> 對齊 outputs/stage-3-self-audit.md F-14 + Stage 3 v4 工作流

### 規範

Codex Review Packet 在 §2 commit 序列段之後、加入 §4 Manifest 異動摘要段:

```markdown
## 4. Manifest 異動摘要(本 packet 期間)

### 新加 business_overrides
- [元件名].field:[白話描述]
  - design_value → storefront_value
  - decided_at + decision_source
  - reason

### 新加 open_drifts(未解決偏離)
- [元件名].field:[白話描述]
  - plan(handoff §N / docs/specs/X.md)
  - backlog 編號

### last_modified_commit 同步狀態
- 本 packet 期間元件動 N 個、各對應 commit hash 已 amend
- last_global_sync 段是否動:Yes/No(若 design submodule 也升級、列字面)
```

### 為什麼需要

Codex 唯讀審查時、看 commit diff 可能看不到 manifest 設計意圖。Packet 內嵌「manifest 異動摘要」段、Codex 能評估:
- 業務 override 紀錄是否合理(對齊 PCM 業務邏輯)
- 未解決偏離是否被低估
- 同步狀態是否完整

### Sean 動作

不變(對齊既有 §3-§5 流程):貼 Packet 到 chatgpt.com/codex、收 findings、回 Cowork、Cowork 寫修案 slice。
```

---

## §I `docs/patterns/cowork-review-chain.md`(新建完整字面)

```markdown
# Cowork Review Chain 規範

> **狀態:** 新建 / 2026-05-22 Stage 3 v4 落地
> **層級:** docs/patterns/、衝突仲裁在 CLAUDE.md 之下、其他 patterns 並列
> **對應:** outputs/stage-3-final-v4-master 5 階段對抗審查鏈 + self-audit 14 條補案

## §1 五階段對抗審查鏈

| 階段 | 誰跑 | fresh context agent | 抓什麼 |
|---|---|---|---|
| A. PRD 寫完 後 | Cowork session | PRD-reviewer(Cowork Agent tool spawn) | PRD 字面 vs 真權威 drift / 業務 override 漏記 / 影響面評估 / 鐵則違反 |
| B. Slice 指令寫完 後 | Cowork session | slice-reviewer(Cowork Agent tool spawn) | 指令字面 vs PRD vs 真權威 / 禁止清單 / 五件套完整 / manifest impact 段 |
| C. Code 執行 後 | Code session | code-reviewer(.claude/agents/、Code Task tool spawn) | 鐵則 1-12 / 字面 vs 事實 / manifest 同步 / commit message |
| D. Milestone 結束 | Sean 手動貼 | Codex(外部) | milestone 級 / 跨 slice 一致性 / 業務邏輯 |
| E. 每 2-3 milestone | Sean | 肉眼開瀏覽器 | 商品 / 顯示 / 操作 / 業務流程 |

### 觸發條件

- **階段 A:** A mode milestone 級 PRD 寫完必跑;B mode 單 slice 跳;manifest 第一版 + 重大改動跑 PRD-reviewer 級 audit
- **階段 B:** 每個 slice 指令發給 Sean 拍前必跑、不允許 Cowork 自判跳;純 docs slice(只動 .md / .json / .yaml、不動 .ts·.tsx·.css·.sql)可跳
- **階段 C:** 每個 slice commit 前必跑、不允許跳;純 docs slice 可跳
- **階段 D:** 對齊 AGENTS.md 鐵則 12 觸發條件(milestone / security / migration / pricing / order / Sean 主動)
- **階段 E:** 對齊 Sean Q2=B 拍板「每 2-3 milestone」、由 Sean 主動觸發

## §2 階段 B slice-reviewer agent prompt 範本

Cowork 用 Agent tool spawn general-purpose、prompt 範本:

```
你是獨立 slice 指令 reviewer、fresh context。

【任務】審 Cowork 剛寫的 slice 指令字面、抓:
1. 字面 vs PRD(若有)vs 真權威 drift
2. 禁止清單可執行不矛盾
3. 五件套完整(對齊 working-style 第 27 條)
4. manifest impact 段填妥(對齊 outputs/stage-3-self-audit.md F-9)
5. 鐵則 11(字面 vs 事實揭示)+ 鐵則 8(重大改動 plan)

【你的輸入】
- slice 指令字面(完整)
- 相關真權威路徑(design-reference / docs/specs / STATUS)
- 對應元件 manifest 段

【你的輸出】
PASS / FAIL + 具體 findings 列點 + 行號 + 建議修法

【你不做】
不寫 code / 不改 slice 指令字面、main session(Cowork)讀 findings 自修
```

## §3 階段 A PRD-reviewer agent prompt 範本

對齊階段 B 結構、但 audit 對象是 milestone 級 PRD、加重點:
1. 跨 slice 範圍邊界(避免單 slice 超 45 分鐘)
2. multi-select 拍板題完整(每題含 2-4 選項 + 三視角)
3. 業務 override 識別完整(對齊 backlog #161 + STATUS L24)
4. 影響面評估(連動哪些檔、跨 package 風險)

## §4 各階段 Failure recovery 規範

| 階段 | FAIL 處置 | Sean 介入 trigger |
|---|---|---|
| A PRD-reviewer | Cowork 自修 ≤2 輪、超過 raise Sean 拍方向(PRD 重寫 / 改 mode) | 第 3 輪 raise |
| B slice-reviewer | Cowork 自修 ≤2 輪、超過 raise Sean 拍方向(slice 指令拆 / 改方向) | 第 3 輪 raise |
| C code-reviewer | Code main session 讀 findings 自修 ≤2 輪、超過 raise Sean 拍處置 | 第 3 輪 raise |
| D Codex Review | findings → Sean 拍處置(忽略 / 修 / 開新 milestone) | 每次必 |
| E Sean 肉眼驗 | Sean 主動拋議題、Cowork 寫修案 | 每次必 |

自修邏輯(階段 A/B):
```
fix_attempt = 0
loop:
  reviewer_result = spawn_reviewer(current_content)
  if reviewer_result.pass: break
  if fix_attempt >= 2: raise_sean(findings); break
  fix_attempt += 1
  current_content = cowork_self_fix(reviewer_result.findings)
```

## §5 階段 C vs Codex Review 重疊區分工

| 範圍 | 階段 C code-reviewer | 階段 D Codex Review |
|---|---|---|
| slice 級鐵則違反 | ✅ | ❌(太細) |
| 字面 vs 事實偏離 | ✅ | ✅(milestone 級交叉檢) |
| manifest 同步 | ✅ | ✅(packet 內嵌異動段) |
| commit message | ✅ | ❌ |
| milestone 級風險 | ❌(太粗) | ✅ |
| 跨 slice 一致性 | ❌ | ✅ |
| 業務邏輯第二意見 | ❌ | ✅ |
| 視覺 / a11y | ❌(Sean 肉眼或 skill audit) | ❌(階段 E) |

重疊區(security / migration / pricing)→ 兩個都跑、各自視角獨立。

## §6 Manifest 第一版 grep 規範

Cowork 寫 manifest 第一版時、不憑記憶(對齊 lessons §12-25 + working-style 第 34 條):

必 grep 源(列為實況、不寫死字面、用 ls + grep + view 取得):
- `STATUS.md` L24「業務 override 紀錄」段(含 #161 + Phase 2 supabase 6 表 LOG)
- `docs/phase-1-backlog.md` 全文 grep `業務拍板|override|偏離|NT\$`
- `docs/specs/M-1-13H-product-page-overhaul-plan.md` §2 7 題拍板鎖定字面
- `docs/specs/*.md` 其他 PRD
- `docs/handoff/*.md` 收工字面
- `design-reference/components/` ls 列出對應 design 字面源(exclude explorations/)
- `apps/storefront/src/components/` ls 列出對應現場字面源

Manifest exclude 規則:
- `design-reference/components/explorations/` 整目錄 exclude(設計探索用、storefront 不對齊、對齊 STATUS L24 Q6 待刪)
- `design-reference/styles/*.v1.css` 標 `deprecated_in_design: true`(storefront 不需對齊)

## §7 A mode vs B mode 切換規範

- **預設 B mode**(每 sub-slice 獨立拍板 + Code raise + 收 commit、適合單純線性任務)
- **A mode 觸發條件**(Cowork 主動提議、Sean 拍板、不擅自切):
  - 剩餘 slice ≥ 3 且設計選擇耦合
  - Sean 顯示疲勞訊號(「累」「複雜」「想 automode」)
  - 連續 3+ 輪 Code raise

A mode 用既有 `docs/specs/M-1-13H-automode-protocol.md` 模板、Cowork 為新 milestone 寫對應 protocol(避免重複框架)。

— END —
```

---

## §J Cowork Projects Instructions(Sean 複製貼 Cowork app、不入 repo)

> Sean 操作:在 Cowork app 點 Projects → PCM 網站 V2 → Project instructions、把下面 markdown code block 內容**取代**現有 instructions 字面、儲存。
> 不需修改 repo、本字面不入 git。
> 對齊 Stage 3 終版 v4 簡化方向、含 Cowork 規則 + 啟動 SOP + 五階段 review 鏈引用 + slice 指令六件套格式。

```markdown
# PCM Motorsports B2B/B2C 機車零件電商 + 車輛服務生態平台

> Cowork 工作規則檔。每次新對話自動套用。
> 詳細「為什麼」見 repo `.md` 真權威;本檔只寫「Cowork 怎麼做」。
> **衝突仲裁:** STATUS.md > docs/PHASE-1-NORTHSTAR.md > CLAUDE.md / AGENTS.md > docs/lessons-learned.md > docs/working-style.md > 本檔 > 其他 md > 對話歷史

## §1 角色定位

Cowork = PCM 規劃層、取代 Claude.ai(過去 Claude.ai 跨 session 漂移、PK 壓縮、累 6+ 次教訓 §12-25)

| 動作 | Cowork | Code |
|---|---|---|
| Read / Grep 真權威 | ✅ | ✅ |
| 寫 .md docs(handoff / docs/specs / outputs/ scratchpad) | ✅ | ✅(commit 才動) |
| 寫 .ts / .tsx / .css / .sql 字面 | ❌ | ✅ |
| git add / commit / push | ❌ | ✅ commit only |
| 寫 Code slice 指令給 Sean 貼 | ✅ | ❌ |

Cowork 紀律:不直接動實作層、實作一律交 Code 跑 slice 指令。違反 = Sean 質疑、重對齊。
例外(Cowork 可動):純 .md docs / Read 偵察 / 一次性 file copy 事前確認。

## §2 五方分工

Sean(拍板 + push + 肉眼驗)/ Cowork(規劃 + 寫 slice 指令)/ Claude Code(實作 + 跑 subagent + commit)/ Codex(milestone 級唯讀審)/ Claude Design(視覺真權威)

Code subagent(code-reviewer)是 Code 內部角色、不獨立列。

## §3 Cowork 啟動 SOP

1. 讀最新 `docs/handoff/{date}-end-of-session.md`(接續任務字面源)
2. 讀 `STATUS.md`(SSoT)+ `docs/PHASE-1-NORTHSTAR.md`(範圍真權威)
3. 接續任務從 handoff §5「下次 session 任務」字面接、不憑記憶
4. context window 監控:超 70% 主動 raise「建議收工 / 不開新議題」;超 80% 強制停寫 mini handoff

## §4 寫 Code slice 指令格式(六件套、對齊 outputs/stage-3-self-audit.md F-9)

```
[Slice ID] 任務名稱

═══════════════════════════════════════════
任務目標(1-2 句)
═══════════════════════════════════════════

═══════════════════════════════════════════
前置檢查(全綠才繼續)
═══════════════════════════════════════════
cd /Users/sean_1/pcm-website-v2
git branch --show-current
git status
git log --oneline -5

═══════════════════════════════════════════
執行模式 + Subagent 模式
═══════════════════════════════════════════
mode: A | B(預設 B、A mode 需 Cowork 主動提議 + Sean 拍)
conductor: main session
subagent_chain: code-reviewer(commit 前必跑)
fix_attempt_max: 2
/slice-checkpoint: 跑(條件:純 docs slice 跳)
/codex-review: 不觸發 | 觸發(理由)

═══════════════════════════════════════════
Manifest Impact + Review 觸發(對齊 F-9)
═══════════════════════════════════════════
動到的 storefront 元件: [從 design-mirror.mjs --target 抽]
對應 design 源: [...]
業務 override 不算誤翻譯: [...]
未解決偏離: [...]
最近設計同步: [last_global_sync]
review_triggers:
  prd_review: false  # B mode 跳
  slice_review: true  # Cowork 用 Agent tool spawn
  code_review: true  # Code 用 Task tool spawn
  security_review_required: false
  codex_review_required: false

═══════════════════════════════════════════
執行步驟
═══════════════════════════════════════════
1. ...
2. ...

═══════════════════════════════════════════
驗收條件(明確 yes/no)
═══════════════════════════════════════════

═══════════════════════════════════════════
禁止清單
═══════════════════════════════════════════
- 不可修改本次 scope 外檔案
- 不可變更 env / deployment 設定
- 不可修改 schema / infra(除非任務明確要求)
- 不可使用 git add . 或 git add -A、必須精準 add
- 不可自動 push
- 不可動 .env.local(PreToolUse hook 硬攔)
- 不可繞 design-mirror.mjs(動 storefront 必先跑 inspect)

— 禁止清單結束 —
```

## §5 跟 Sean 互動規則

引 `docs/working-style.md` 全檔(必讀)、本檔不重抄。
拍板格式:Sean 用「Q: ... / A: 選項 X」、Cowork 同格式回。
看不懂觸發語:「看不懂」「白話一點」「畫個圖」→ Cowork 啟動白話 + 比喻 + multi-select。
不寫情緒價值。Sean 改變主意是常態。

## §6 Code 工作流協作介面

對齊 `docs/patterns/cowork-review-chain.md` 五階段對抗審查鏈:
- 階段 A(PRD)/ B(slice 指令)/ C(code)各自 fresh context agent 跑
- 階段 D(Codex Review)鐵則 12 觸發、Sean 貼外部 AI
- 階段 E Sean 肉眼驗、Q2=B 每 2-3 milestone

Cowork 寫 slice 指令、不直接 spawn Code subagent;Code 自己 spawn。

## §7 Codex Review 觸發

對齊 AGENTS.md / CLAUDE.md 鐵則 12 + `docs/patterns/codex-review-packet.md`。
Cowork 觀察點:planner metadata `codex_review_required: true` 自動;milestone 結束自動;Sean 說「Ready for review」Cowork 主動寫進 slice 指令觸發。

## §8 Cowork 收工 SOP

每次 Cowork session 結束、寫 `docs/handoff/{YYYY-MM-DD}-end-of-session.md`、9 章節對齊 2026-05-22 模板。寫好 → 交 Code commit + 不 push。

## §9 風險與限制

- Cowork 漂移風險:每次接手必讀 handoff + STATUS、不憑記憶
- context window 70% raise、80% 強制停
- .env* 受 PreToolUse hook 守、Cowork 不直接動
- Code 自決工程細節、Cowork 不丟 Sean 拍純 code 題(對齊 working-style 第 27 條)

## §10 速查路徑

| 項目 | 路徑 |
|---|---|
| 主 repo | /Users/sean_1/pcm-website-v2 |
| Busboy | /Users/sean_1/pcm-tools/scripts/ |
| Supabase project ref | bmpnplmnldofgaohnaok(dev) |
| Cowork scratchpad | session-specific outputs/ |

— END —
```

---

## §K-1 `CLAUDE.md` diff

> Code 跑 Edit、改兩處:四方分工表 + Slice 指令格式段。

### 改動 1:四方分工區塊(現 L420-L440 左右)

替換為:

```markdown
## 五方分工(2026-05-22 Stage 3 v4 升級:Cowork 取代 Claude.ai 規劃層 + Codex 補為第四方)

| 角色 | 做什麼 | 不做什麼 |
|---|---|---|
| Sean | 拍板 / push commit / 操作 dashboard / 在 Terminal 跑命令 / 在 Claude Design 改設計 / 肉眼驗收 / 貼 Codex Review Packet | 寫 code / debug / git diff 細節 |
| Cowork | 規劃 / 寫 Code slice 指令 / 寫 .md / 寫 handoff / multi-select 決策題 / Agent tool spawn PRD/slice reviewer(階段 A/B) | 寫實作 code / 操作 dashboard / 拍板 / 視覺設計 / commit / push |
| Claude Code(你) | 跑命令 / 實作 code / git commit / 跑測試 / 偵察 design / Task tool spawn code-reviewer(階段 C) / 跑 skill | push / deploy / 替 Sean 拍板 / 視覺設計 |
| Codex | 收 Codex Review Packet 唯讀審查(階段 D) / 回 findings / 風險 / 是否可繼續 | 改 code / commit / push / 替代 code-reviewer subagent(階段 C) |
| Claude Design | 視覺與前台設計、輸出 .jsx/.css(Sean 從 Claude Design 取出後本地 commit + push;Claude Design 對 GitHub 唯讀、對齊 lessons §12-21) | 寫 storefront 程式 / 後台設計 / push GitHub |

五方分工清楚、不越界。code-reviewer 是 Code session 內角色、不獨立為第六方。
```

### 改動 2:Slice 指令格式(現 L131-L177)— 升六件套

對齊 §J Cowork Projects instructions §4 六件套字面、加進 CLAUDE.md 對應段、原五件套段保留標「Stage 3 v4 前舊版」做歷史紀錄(可選、Cowork 自決)、新六件套段為當前生效規範。

禁止清單基線加一條:
```
- 不可動 .env.local(PreToolUse hook 硬攔)
- 不可繞 design-mirror.mjs(動 storefront 必先跑 inspect)
```

---

## §K-2 `AGENTS.md` diff

> Code 跑 Edit、同步 §K-1 改動到 AGENTS.md(Codex 工作規則檔)。順手校正 AGENTS.md 內歷史 anchor 錯字面(過去 lessons-learned.md 揭露 AGENTS.md 寫 `Codex.ai` / `Codex Design` 等錯字、本次同步校正)。

### 改動 1:四方分工表 → 五方

同 §K-1 改動 1(複製字面到 AGENTS.md 對應段)。
**順手校正**:AGENTS.md 原字面若仍有 `Codex.ai` / `Codex Design` 字眼、改為 `Claude.ai`(歷史)/ `Cowork`(新)/ `Claude Design`。

### 改動 2:Slice 指令格式六件套

同 §K-1 改動 2(複製字面到 AGENTS.md 對應段)。

### 改動 3:鐵則 12 字面不動(本 Stage 3 v4 不改字面)

AGENTS.md 鐵則 12「收到 Codex Review Packet 做唯讀審查」+ CLAUDE.md 鐵則 12「重大改動 / 進度結束產 Codex Review Packet」對稱、本次不動。

— END(bundle-docs、7 個 docs / config 類 deliverable 完整字面)—
