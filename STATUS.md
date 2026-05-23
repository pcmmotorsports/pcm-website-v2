# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅ + **M-1-13H ✅(商品頁全面改版 6 slice 完成 + Codex Review findings 4 處 fix)** + 13g(Toast 推延)+ **Stage-3-onboarding ✅ + Stage-3-codex-fix ✅(工作流升級 + Codex 4 findings 應對)** + **M-1-13I ✅(車種跨頁傳遞 3 bug 修 + V1 manifest audit、新工作流第 2 次實證)** + **M-1-13Z ✅** + M-1-14-recon ✅ + **M-1-14a ✅(Supabase customers 4 表 + RLS + 5 trigger / 3 function + 對帳 view)** + **M-1-14b ✅(domain Customer 10 欄 + address/vehicle/wallet 3 子 entity + ports ICustomerRepo 改寫 + 3 子 port)** + **M-1-14a-patch ✅(Codex FAIL 處置:invoice NOT NULL + ledger COMMENT Q1=B + PRD 入 repo + #170/#171)** + **M-1-14c ✅(packages/schemas 6 組 zod v4 表單驗證 schema + z.infer + zod 入 catalog)** + **M-1-14d ✅(packages/adapters customer/address/vehicle 3 Supabase adapter + 3 mapper + 3 mapper test;wallet 拆 M-1-14d-2)**、餘 M-1-14d-2~16)
**當前 slice:** **M-1-14d ✅**(packages/adapters:3 mapper〔`supabase/mappers/customer.ts` / `address.ts` / `vehicle.ts`、camelCase domain ↔ snake_case DB、nullable text 欄〔phone / invoice_carrier / vehicles.year·engine·km·mods〕標 `string | null` + read `?? ''` 還原、invoice 巢狀 ↔ 攤平 5 欄三型〕+ 3 adapter〔`SupabaseCustomerAdapter`〔findById/findByEmail/update、PGRST116→null〕 / `SupabaseAddressAdapter` / `SupabaseVehicleAdapter`〔listByCustomer/create/update/delete〕、全單一 authenticated client〔RLS 守自己 row〕、thin adapter:第二筆 is_default/is_primary 撞 partial unique index 直接 throw、unset 舊值 transaction 邏輯歸 M-1-14e〕+ 3 mapper test〔23 案例:invoice 三型攤平/還原 + nullable coalesce + 重命名〕+ index.ts export 3 adapter。**Sean 拍板:Q1=B** wallet adapter 拆 **M-1-14d-2**〔混合 auth〔讀 authenticated / 寫 service_role〕+ 金流、獨立 codex 雙關卡審;handoff `docs/handoff/2026-05-23-m-1-14d-2-wallet-handoff.md`〕、**Q2=A** 寫 mapper test。**codex 關卡1**〔審 plan〕FAIL → 自修 2 must-fix〔wallet 雙 client〔促成 Q1=B 拆出〕+ row nullable `string | null`〕+ 3 consider〔listByCustomer 穩定排序/getBalance 查無 throw〔留 d-2〕/thin adapter 邊界〕。**codex 關卡2**〔審 diff〕round1 FAIL〔customer JSDoc 寫「authenticated UPDATE 只開 3 欄」、但 migration GRANT L231 實含 updated_at — 字面 vs 事實偏離〕→ 修 2 處註解〔GRANT 含 updated_at、但 trigger 強制覆寫 now()、user 送值無效、adapter 不送〕round2 PASS。三綠 typecheck 7/7 + lint 10/10 + build 1/1 storefront + mapper test 23/23;**code-reviewer PASS 0 must-fix**〔逐欄核 migration 行號/GRANT/RLS policy 名一致、business override 無誤判〕;未 push)。前序 **M-1-14c ✅**(packages/schemas 6 組 zod v4 schema + z.infer + zod 入 catalog;code-reviewer PASS;低風險跳 codex 關卡2)。前序 M-1-14a/a-patch/b ✅(Supabase 4 表 + RLS + GRANT + domain 10 欄 + ports 4 介面、Codex 終審 PASS;詳見 PROGRESS)。前序 M-1-14-recon / M-1-13Z / M-1-13I/13H ✅(詳見 PROGRESS)

**Branch:** dev

## 最後更新
2026-05-23 — Claude Code [M-1-14d ✅ 收尾(customer/address/vehicle 3 Supabase adapter + 3 mapper + 23 mapper test;自驅 SOP 全跑:codex 關卡1+2 + code-reviewer;Sean Q1=B 拆 wallet→M-1-14d-2 / Q2=A 寫 mapper test);+ 產 M-1-14d-2 wallet handoff;停等 Sean push;下一段 M-1-14d-2 wallet adapter(重大/接 DB/金流、codex 雙關卡 + 雙 client 不可跳)]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `8cfdf26` | feat(adapters): M-1-14d customer/address/vehicle 3 Supabase adapter + mapper + test [M-1-14d] | 2026-05-23 |
| `7625f2b` | docs(handoff): M-1-14d 交接 handoff + STATUS 更新 [M-1-14d-prep] | 2026-05-23 |
| `3e67016` | feat(schemas): M-1-14c 填 6 組 zod v4 表單驗證 schema + z.infer [M-1-14c] | 2026-05-23 |

## 下一步
**M-1-14d ✅、停等 Sean 推下一段**。下一段 = **M-1-14d-2**(**新 session 先讀 handoff `docs/handoff/2026-05-23-m-1-14d-2-wallet-handoff.md`**;packages/adapters:`SupabaseWalletAdapter` + `mappers/wallet.ts` + mapper test、接 customer_wallet_ledger 表 + customers 餘額欄;**雙 client DI**〔讀 authenticated / 寫 service_role、codex 關卡1 must-fix〕、getBalance 走 customers 欄 + ledger MAX〔view 不對 authenticated 開〕、amount signed int 禁浮點、ledger immutable;**重大/接 DB/金流 → codex 雙關卡 + code-reviewer 不可跳**)→ 再 e(use-case register/login/CRUD/deposit、server 端用 @pcm/schemas re-parse)/f1(Login·Register·Google OAuth)/f2(LINE OAuth、Sean 須先做 PRD §13 dashboard checklist)/g(AccountPage 7 tab 拆檔)/h(MobileTabBar #158)。**M-1-14a Codex 終審 ✅ PASS**(2026-05-23、2 輪 patch + round-2 STATUS orphan 修;packet `docs/reviews/2026-05-23-m-1-14a-customer-schema-packet.md` 已記終審結果);push readiness 解除、可 push ahead 9。**M-1-13I 肉眼驗**(仍待 Sean 驗):首頁選車按搜尋 → 列表車種不丟 / 選車進商品頁 → 麵包屑回列表帶車 / vehiclePill 本體點→列表帶車、× 點→留本頁清車(雙格式 `?vehicle=yamaha:mt-07:2024` 與 `?brand=&model=&year=` 皆驗;dev 驗 tier 用 cookie `pcm-tier` 繞 env、見 #163)。**M-1-13H 收尾**(若未完成):肉眼驗商品頁完整流程 + 業務流程(加入購物車 / tier 條件渲染)+ Claude Design 端 explorations 刪除(Q6、push pcm-website-design → submodule update)。接著 **M-1-15** LoginPage·RegisterPage(順帶 #156 + 強推 #158)/ **M-1-16** 200 SKU 種子(#157 促銷 PRD + Supabase findBySlug + toUIProduct(p, tier) 處理 #161 經銷價 + #162 brand.country + Phase 2 supabase 6 表)。M-1 收尾跑 premortem step-2。Stage 3 收尾殘項:Cowork app 貼 bundle-docs §J(Sean、不入 repo)

## Sean 待決策
**M-1-14a 決策已清**:(a)✅ rls_auto_enable Sean Q1=A 拍「該做」→ backlog #172(納管補 migration + REVOKE EXECUTE、專門 slice、不急);(b)✅ Codex Packet Q2=A 放 docs/reviews、PRD M3 入 repo。(c)✅ `docs/specs/m-1-14-code-execution.md` 已 track(Sean Q=A、M-1-14 一夜跑 runbook 入版控)。 #1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

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
