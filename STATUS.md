# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a/b/c/d ✅、餘 M-1-13e~g + M-1-14~16)
**當前 slice:** M-1-13d Info column + Options state(size/color)+ CSS sec 4+5 + 拆 ProductInfo 子元件 + 補 ProductGallery test(13c 違鐵則 11 補回)+ #81 處置時程更新 ✅(合一版 328 行超鐵則 6 警戒、Q3=A 觸發即拆 ProductInfo 173 行 + ProductPage 192 行 + ProductGallery 230 行;Q1=A / Q2=A / Q3=A 拍板 + 8 自審漏點全修;3 file test 拆分:ProductGallery 6 case + ProductInfo 10 case + ProductPage 7 case(原 8 - 3 gallery + 2 整合)= 119 全 pass)

**Branch:** dev

## 最後更新
2026-05-20 — Claude Code [M-1-13d 完成]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `3c34f71` | feat(storefront): ProductPage 拆 ProductInfo + Options state + CSS sec 4+5 + ProductGallery test + #81 處置 [M-1-13d] | 2026-05-20 |
| `e3d5ac2` | docs(backlog): 新增 #158 MobileTabBar 漏元件追蹤(M-1-13c 收工肉眼驗發現) | 2026-05-20 |
| `df30fdd` | feat(storefront): ProductPage gallery + lightbox 拆 ProductGallery 子元件 + CSS sec 3+12 [M-1-13c] | 2026-05-20 |

## 下一步
M-1-13e Buy row + Buy now + Services + Mobile sticky buy bar(tier helper #130 第 3 處撞 trigger + #82 inStock↔availability mapper Q2=A trigger)+ CSS sec 6+7+13;後續 M-1-13f Tabs(spec/desc/faq/review)/ M-1-13g Related + Toast + Responsive(Codex Review Packet 鐵則 12 觸發);接著 M-1-14 Customer schema(audit 階段主動 raise #156 店家申請 PRD + #158 MobileTabBar)/ M-1-15 LoginPage·RegisterPage(順帶 #156 + 強推 #158 同期落地、5 tab 中 3 個指向 M-1-15 後可用頁)/ M-1-16 200 SKU 種子(audit 階段主動 raise #157 促銷系統 PRD);M-1 收尾跑 premortem 應對 step-2

## Sean 待決策
#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節)

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
