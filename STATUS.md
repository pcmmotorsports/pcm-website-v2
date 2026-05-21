# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅、餘 商品頁全面改版(M-1-13H plan ✅、實作 slice-1~6 待跑) + 13g(暫停) + M-1-14~16)
**當前 slice:** design-reference 同步至 637dafc(VariantCFull.jsx 13KB + explorations.css 32KB + design-handoff/PRODUCT-PAGE-HANDOFF.md 14KB + design-handoff/SUPABASE-PRODUCT-PAGE.md 10KB)✅;Sean 2026-05-21 拍板 Q2=A 暫停 13g、接續商品頁全面改版(Apple/Aritzia 現代派、VariantCFull = Phase 1 真權威字面;Phase 2 supabase product_spotlights 後台先 LOG 不動;HANDOFF.md 列保留清單 breadcrumb 路徑記憶 / vehiclePill / lightbox / hero swipe / addToCart toast / getPriceForTier / mobile buybar 不可拆);範圍預估 4-6 slice 跨多 session、需 plan + 鐵則 8 + 內容分級 L1/L2/L3 + 鐵則 12 觸發評估;13g(Related + Toast + Responsive)推延、卡片改完後 Related 自動繼承新設計、剩 Toast + Responsive 時機定;chore: 工作樹整理(.gitignore 補 .claude/+spikes/、commit 6 份 untracked docs、checkout next-env.d.ts);M-1-13H plan 階段完成(Sean Q1-Q7 拍板:Q1=NT$5,000 永久業務 / Q2=B hasSpotlight 欄位 / Q3=B mobile bar 紅色保留 / Q4=既有 ProductCard + 容器標題改、糾正 self / Q5=A 6 slice / Q6=A 結束後 Sean Claude Design 端動 / Q7=A 全拆、PRD docs/specs/M-1-13H-product-page-overhaul-plan.md + lessons §12-37 落地、Code 等待 slice-1 crumbs+Gallery 指令);docs-recon: commit slice-0 偵察報告 docs/recon/M-1-13H-product-page-recon-2026-05-21.md(475 行、audit trail、對齊偵察報告 commit 慣例)

**Branch:** dev

## 最後更新
2026-05-21 — Claude Code [M-1-13H docs-recon commit slice-0 偵察報告]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `455f969` | docs(M-1-13H): commit slice-0 偵察報告 (M-1-13H 真權威偵察 audit trail) | 2026-05-21 |
| `271d22b` | docs(M-1-13H): plan PRD + lessons §12-37 (M-1-13H plan 階段完成) | 2026-05-21 |
| `0cf711c` | chore: 整理工作樹 untracked + 補 .gitignore | 2026-05-21 |

## 下一步
M-1-13H slice-1 crumbs 樣式對齊 design + Gallery 1:1 / 18px radius / arrow 72px / counter / thumb 移下方(估 30-40 分;對應 HANDOFF #1+#2+#3;動 ProductGallery + product-page.css crumbs/hero/thumb 段;PRD docs/specs/M-1-13H-product-page-overhaul-plan.md 已落地、Cowork 依 PRD 字面骨架寫 slice 指令);接著 slice-2 Info 上半(SKU line / title 28px Inter sans / 副標 / 移除 fits banner)→ slice-3 Buy block(色票圓 24px / 價格 22px 黑 / 圓 pill CTA 48px / services 移圖示)→ slice-4 新增 ProductHighlights 子元件(3 卡 hardcoded)→ slice-5 新增 ProductSpotlight 子元件(條件渲染 hasSpotlight 欄位)→ slice-6 Tabs pill + 內容微調 + Related 容器標題 + 收尾(估累計 3-5 小時、跨多 session);全改版完成後評估 13g 殘餘(Toast + Responsive 是否仍需、Sean 在 Claude Design 端動 explorations 檔刪除);接著 M-1-14 Customer schema(audit 階段主動 raise #156 店家申請 PRD + #158 MobileTabBar)/ M-1-15 LoginPage·RegisterPage(順帶 #156 + 強推 #158 同期落地)/ M-1-16 200 SKU 種子(audit 階段主動 raise #157 促銷系統 PRD + 接 Supabase findBySlug + toUIProduct(p, tier) 處理 backlog #161 經銷價真區分 + 處理 13f-2 tabs L3 內容問題:specs 8 hardcoded 欄位 / description 文案 / install steps / warranty 政策真實應後台 CRUD);M-1 收尾跑 premortem 應對 step-2

## Sean 待決策
#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步)

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
