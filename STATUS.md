# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~09 ✅、餘 M-1-10~16)
**當前 slice:** M-1-09 ✅;工作流優化 WO-1~4 + WO-6 ✅(WO-5 待續)
**Branch:** dev

## 最後更新
2026-05-19 — Claude Code [工作流優化 WO-6]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `0c48c70` | docs(workflow): STATUS.md 瘦身 — 變更紀錄移 PROGRESS、速查抽出 [WO-6] | 2026-05-19 |
| `27a0271` | refactor(storefront): 抽 dev-preview 共用骨架 PreviewHarness [WO-4] | 2026-05-19 |
| `7c70aca` | test(storefront): 補 11 個前台元件 smoke test + vitest @ alias [WO-3] | 2026-05-19 |

## 下一步
工作流優化 WO-5 待續(backlog 123 條分 4 流、估 ~1hr、開工前先拆 2-3 子 slice;詳見 plan 檔 `~/.claude/plans/skill-radiant-dragon.md`);之後 M-1-10 FilterTop.tsx(含 CascadeFilterTop、可複用 WO-4 的 PreviewHarness);#146 / #138 待排

## Sean 待決策
#1 發票自動化 / #2 測試覆蓋率 / #3 TapPay sandbox / #4 部署(Vercel+Railway)

## Blocker
無
## 緊急 backlog
無

---

## 速查 / 歷史(已外移、降低本檔讀取成本)

- **速查**(Phase 1 範圍 / 技術棧 / 關鍵路徑)→ `docs/quick-reference.md`
- **變更紀錄**(slice 逐筆歷史)→ `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段

## 文件交叉引用

每次新對話依此順序對齊上下文:

1. **`STATUS.md`** ← 本檔(每次先讀)
2. `docs/PHASE-1-NORTHSTAR.md` v2 — Phase 1 真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `CLAUDE.md` — Claude Code 工作規則
5. `docs/PHASE-1-MILESTONES.md` — milestone 排程
6. `docs/decisions/` — 重大決策記錄
7. `docs/patterns/` — 通用 + PCM 專屬規矩
8. `docs/phase-1-backlog.md` — 未決事項
9. `docs/features/*.md` — PRD
10. `design-reference/` — 視覺真權威字面(submodule)
11. `PROGRESS.md` — 歷史紀錄
12. `docs/quick-reference.md` — 速查(Phase 1 範圍 / 技術棧 / 關鍵路徑)

衝突仲裁順序:
- STATUS.md 與其他 md 衝突 → STATUS.md 為準
- 其他 md 與對話歷史衝突 → md 為準
- 視覺 / 結構 / 路由 / 元件命名衝突 → design-reference 為準
- 業務邏輯(訂單流程、權限、價格、Medusa schema)衝突 → docs/decisions/ 為準

## Busboy 機制(沿用第一輪)

- **busboy-start.js:** Sean 在 Terminal 跑、輸出貼新 Claude Code session 第一則訊息
- **busboy-end.js:** Claude Code 在 session 最後跑、自動更新本檔 5 個欄位(最後更新 / Phase Milestone slice Branch / 最近 3 commit / 下一步 / Sean 待決策)、commit、不 push(Sean 手動推當 review checkpoint)
- ⚠️ WO-6 後「變更紀錄」已移 `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段、不再寫本檔;busboy-end.js 若仍寫 STATUS 變更紀錄表需同步改寫(pcm-tools 外部 repo、待 Sean 處理)
- repo 參數:`pcm`(本 repo)/ `tools`(pcm-tools)

第一次 busboy-end 跑之前、本檔欄位手動填(start template 用、由 Claude.ai 維護)。

busboy-end 跑完後 amend 進 slice 主 commit、不另開 commit。

— END —
