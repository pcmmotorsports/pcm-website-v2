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
