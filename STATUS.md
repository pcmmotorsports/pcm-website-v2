# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅、餘 13e-b-2/f/g + M-1-14~16)
**當前 slice:** M-1-13e-b CartContext + useCart hook + ProductInfo/ProductPage 兩處 stub addToCart 接真實作(localStorage mock、無後端、對齊 Phase 1 M-3 結帳前 stub)+ Mobile sticky bar tier 字面完整對齊 design L527-532 ✅(Sean 2026-05-21 拍板 Q-13e-b-scope=C 完整 + Q-13e-b-header=B Header cart badge 拆 13e-b-2 + Q-13e-b-codex=A commit 前產 Codex Review Packet + Q-13e-b-commit=A Codex findings 處理完直接 commit;Codex review 三 finding 全處理:P1 CartItem.id:number → productId:string 用 slug 對齊 domain ProductId + Supabase uuid、P2 removeItem/updateQty 改接 CartLineKey object 三方一致、P2 補 CartContext.test.tsx 12 個行為 test、小風險 qty MAX_QTY=99 + clampQty 三入口統一;四綠 typecheck/lint/build/test 27 files 140 passed 原 128 + 新 12 cart 行為 test 無 regression)

**Branch:** dev

## 最後更新
2026-05-21 — Claude Code [M-1-13e-b 完成]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `b964d2e` | feat(storefront): CartContext + useCart 接真實作 + Mobile sticky tier 字面 [M-1-13e-b] | 2026-05-21 |
| `7930920` | feat(storefront): ProductPage 補 pd-price-block + Buy row + Services + Mobile sticky bar (addToCart stub) [M-1-13e-a] | 2026-05-21 |
| `0a0f533` | feat(storefront): ProductCard 沒貨徽章移除 + 現貨 filter UI 隱藏(邏輯保留) [M-1-13e-pre-3] | 2026-05-21 |

## 下一步
M-1-13e-b-2 Header cart badge 從 useCart 拿(替代寫死 cartCount=4、useCart().totalQty 取數字、不動 Header 視覺、estimated 10-15 分鐘、Q-13e-b-header=B 2026-05-21 拍板);後續 M-1-13f Tabs(spec/desc/faq/review、ProductInfo 339→必拆 ProductServices 子元件 Codex review 提醒)/ M-1-13g Related + Toast + Responsive(Codex Review Packet 鐵則 12 觸發機率 ↑);接著 M-1-14 Customer schema(audit 階段主動 raise #156 店家申請 PRD + #158 MobileTabBar)/ M-1-15 LoginPage·RegisterPage(順帶 #156 + 強推 #158 同期落地)/ M-1-16 200 SKU 種子(audit 階段主動 raise #157 促銷系統 PRD);M-1 收尾跑 premortem 應對 step-2

## Sean 待決策
#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步)

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
