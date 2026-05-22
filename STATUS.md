# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅ + **M-1-13H ✅(商品頁全面改版 6 slice 完成 + Codex Review findings 4 處 fix)** + 13g(Toast 推延)、餘 M-1-14~16)
**當前 slice:** M-1-13H ✅ 商品頁全面改版完成(Apple/Aritzia 現代派、6 slice + slice-7 page.tsx searchParams hydrate fix 累積:crumbs+Gallery / Info 上半 SKU·title·副標 / Buy block+Services+免運 5,000 / Highlights+Spotlight 新子元件+hasSpotlight 欄位 / Tabs pill+4 panel / Related+Responsive+收尾 / page.tsx tier override hydrate);Codex Review findings 4 處併 slice-6 fix(ProductTabs a11y 完整 ARIA tablist + ArrowKey/Home/End + 3 regression test [Sean Q1=B] / dealer tag .pd-price-tag-dealer CSS / STATUS Phase 2 LOG 6 表 / Highlights·Spotlight 註解改 [Sean Q2=Yes]);slice-7:修 M-1-13e-a 歷史 bug(page.tsx 傳空物件給 resolveTierFromRequest、URL ?tier= override 失效)、Codex fix Q2 .pd-price-tag-dealer 配套、Sean 2026-05-22 肉眼驗時發現、bash grep 確認、屬 M-1-13H 收尾合理延伸非範圍擴張;13g Toast 推延;**待 Sean 肉眼驗(URL ?tier=store/premiumStore + PCM_DEV_TIER_OVERRIDE=1)+ push origin dev(本 session ahead=6、slice-2~7)+ 在 Claude Design 端動 explorations 刪除(Q6、push pcm-website-design → 本地 submodule update)**;接著 M-1-13I 預備修 3 個車款狀態持續傳遞 bug(ProductsPage 不讀 URL / 麵包屑 href 不帶 vehicle / vehiclePill button onClick 一律 clear、Cowork 寫 plan + Sean 拍板)→ M-1-14 Customer schema / M-1-15 LoginPage·RegisterPage / M-1-16 200 SKU 種子

**Branch:** dev

## 最後更新
2026-05-22 — Claude Code [M-1-13H-7 page.tsx searchParams hydrate fix(Codex Q2 配套)、ahead=6 待 Sean 肉眼驗 tier override + push]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `1b61a9d` | fix(storefront): page.tsx searchParams hydrate (Codex fix Q2 配套) [M-1-13H-7] | 2026-05-22 |
| `1d4b4e8` | feat(storefront): Related + Codex fix + 收尾 [M-1-13H-6] | 2026-05-22 |
| `0d5cb99` | refactor(storefront): ProductTabs pill 改造 + 4 panel 內容微調 [M-1-13H-5] | 2026-05-22 |

## 下一步
**M-1-13H 收尾待 Sean 動作**:(1) 肉眼驗商品頁完整流程(crumbs / vehiclePill / Gallery 1:1 / SKU line / 副標 / 價格 22 黑 / swatch 圓 24 / pill CTA / services / Highlights / Spotlight 條件渲染 lightech-1·akrapovic-6·brembo-7 / pill Tabs 鍵盤 ←→/Home/End / Related grid 同分類 / Mobile sticky bar 紅色;特別確認 .pd-main 桌機比例改 1.2fr:1fr 後 gallery+info 欄排版 + 經銷價 tag 樣式 + Related categoryMain filter 卡片非空)+ 業務流程(加入購物車 → cart / tier 條件渲染 / hero swipe / Lightbox ESC·Arrow;slice-7 後 URL ?tier=store/premiumStore + PCM_DEV_TIER_OVERRIDE=1 才顯經銷 tag);(2) push origin dev(ahead=6、slice-2~7);(3) 在 Claude Design 端動 explorations 刪除(Q6、push pcm-website-design → 本地 submodule update + commit);接著 M-1-13I 修 3 個車款狀態持續傳遞 bug(Cowork 寫 plan + Sean 拍板)→ M-1-14 Customer schema(audit 階段主動 raise #156 店家申請 PRD + #158 MobileTabBar)/ M-1-15 LoginPage·RegisterPage(順帶 #156 + 強推 #158 同期落地)/ M-1-16 200 SKU 種子(audit 階段主動 raise #157 促銷系統 PRD + 接 Supabase findBySlug + toUIProduct(p, tier) 處理 backlog #161 經銷價真區分 + #162 brand.country 真區分 + 處理 Phase 2 supabase 6 表:product_highlights / product_spotlights / product_specs / product_installs / site_services / site_policies — L3 內容真區分各 SKU);M-1 收尾跑 premortem 應對 step-2

## Sean 待決策
#1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

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
