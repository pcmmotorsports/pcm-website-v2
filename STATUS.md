# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1 ✅、餘 13e-pre-2 + 13e/f/g + M-1-14~16)
**當前 slice:** M-1-13e-pre-1 抽 resolveTierFromRequest helper(從 app/page.tsx L42-58 抽 + 檔頭 server-only)+ 首頁 + 商品頁接上 + backlog #130 markdone + #160 新增 ✅(Sean Q1=B 業務拍板覆寫 Defer 第 3 處撞 + Q5=A 商品頁短期顯一般零售價接受 + 商品頁 route 改 dynamic 是預期;四綠 typecheck/lint/build/test 124 全 pass、5 新 test + 既有 119)

**Branch:** dev

## 最後更新
2026-05-20 — Claude Code [M-1-13e-pre-1 完成]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `81909b7` | feat(storefront): 抽 resolveTierFromRequest helper、首頁與商品頁接上 [M-1-13e-pre-1] | 2026-05-20 |
| `59b4517` | docs(backlog): 新增 #159 filter-top.css 手機 responsive 字級漏(design 缺、M-1-13d 收工肉眼驗發現) | 2026-05-20 |
| `3414741` | fix(storefront): ProductsPage ProductCard href 補帶 vehicle param [M-1-13d-fix-1] | 2026-05-20 |

## 下一步
M-1-13e-pre-2 抽 availability mapper(Q2=A 位置 `packages/adapters/src/storefront-mappers/availability.ts`、估時 15-20 分鐘);後續 M-1-13e Buy row + Buy now + Services + Mobile sticky buy bar + CSS sec 6+7+13(13e 開工前 raise「有貨顯示交期 3-5 工作天 / 沒貨空白」design 字面 gap、Sean 補述 vs design 字面無對應、需拍 design 端補 or storefront 自加);M-1-13f Tabs(spec/desc/faq/review)/ M-1-13g Related + Toast + Responsive(Codex Review Packet 鐵則 12 觸發);接著 M-1-14 Customer schema(audit 階段主動 raise #156 店家申請 PRD + #158 MobileTabBar)/ M-1-15 LoginPage·RegisterPage(順帶 #156 + 強推 #158 同期落地)/ M-1-16 200 SKU 種子(audit 階段主動 raise #157 促銷系統 PRD);M-1 收尾跑 premortem 應對 step-2

## Sean 待決策
M-1-13e 開工前 raise design 字面 gap「Sean 補述『有貨:交期 3-5 工作天 / 沒貨:空白』vs design ProductPage.jsx 字面僅按鈕『加入購物車/補貨中·通知我』無交期、需拍板 design 端補 or storefront 自加(違鐵則 1)」;#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片、Sean Q3 補述)13f Tabs / Phase 2 啟動前 audit)

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
