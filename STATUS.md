# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅、餘 13e-b/f/g + M-1-14~16)
**當前 slice:** M-1-13e-a ProductPage 補 pd-price-block + Buy row + Services + Mobile sticky bar(addToCart stub、Mobile sticky tier 字面簡化、免運門檻字面 storefront 偏離 design 統一 NT$ 5,000)✅(Sean 2026-05-21 拍板 Q-13e-split=A 拆 13e-a / 13e-b + Q-13e-a-scope=C scope 含 pd-price-block + Mobile 簡化 + Q-shipping-threshold=B 兩處免運 5,000 統一 + Q-codex=B 自評低風險直接 commit;四綠 typecheck/lint/build/test 128 全 pass、smoke test sed 加 tier="general" prop 18 處不破)

**Branch:** dev

## 最後更新
2026-05-21 — Claude Code [M-1-13e-a 完成]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `478b7b2` | feat(storefront): ProductPage 補 pd-price-block + Buy row + Services + Mobile sticky bar (addToCart stub) [M-1-13e-a] | 2026-05-21 |
| `0a0f533` | feat(storefront): ProductCard 沒貨徽章移除 + 現貨 filter UI 隱藏(邏輯保留) [M-1-13e-pre-3] | 2026-05-21 |
| `37ec8b5` | feat(adapters): 抽 availabilityToBool / boolToAvailability mapper、lib/products 接上 [M-1-13e-pre-2] | 2026-05-20 |

## 下一步
M-1-13e-b 補 CartContext + useCart hook + addToCart 真實作(localStorage mock、無後端、對齊 Phase 1 結帳 M-3 範圍)+ Mobile sticky bar tier price 完整字面顯示(對齊 design L527-532 memberTier conditional)+ ProductInfo / ProductPage 兩處 stub addToCart 改 useCart 統一(estimated 15-25 分鐘、Q-13e-split=A 拍板 13e-a 後接續);後續 M-1-13f Tabs(spec/desc/faq/review)/ M-1-13g Related + Toast + Responsive(Codex Review Packet 鐵則 12 觸發機率 ↑);接著 M-1-14 Customer schema(audit 階段主動 raise #156 店家申請 PRD + #158 MobileTabBar)/ M-1-15 LoginPage·RegisterPage(順帶 #156 + 強推 #158 同期落地)/ M-1-16 200 SKU 種子(audit 階段主動 raise #157 促銷系統 PRD);M-1 收尾跑 premortem 應對 step-2

## Sean 待決策
#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 / Mobile sticky bar tier 簡化短期偏離 design L527-532)、待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步)

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
