# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅ + **M-1-13H ✅(商品頁全面改版 6 slice 完成 + Codex Review findings 4 處 fix)** + 13g(Toast 推延)+ **Stage-3-onboarding ✅ + Stage-3-codex-fix ✅(工作流升級 + Codex 4 findings 應對)** + **M-1-13I ✅(車種跨頁傳遞 3 bug 修 + V1 manifest audit、新工作流第 2 次實證)** + **M-1-13Z ✅** + M-1-14-recon ✅ + **M-1-14a ✅(Supabase customers 4 表 + RLS + 5 trigger / 3 function + 對帳 view)** + **M-1-14b ✅(domain Customer 10 欄 + address/vehicle/wallet 3 子 entity + ports ICustomerRepo 改寫 + 3 子 port)** + **M-1-14a-patch ✅(Codex FAIL 處置:invoice NOT NULL + ledger COMMENT Q1=B + PRD 入 repo + #170/#171)** + **M-1-14c ✅(packages/schemas 6 組 zod v4 表單驗證 schema + z.infer + zod 入 catalog)** + **M-1-14d ✅(packages/adapters customer/address/vehicle 3 Supabase adapter + 3 mapper + 3 mapper test;wallet 拆 M-1-14d-2)** + **M-1-14d-2 ✅(SupabaseWalletAdapter 雙 client〔讀 authenticated / 寫 service_role〕+ wallet mapper + 7 test、server-only export)** + **M-1-14e-1a ✅(IAuthService port + SupabaseAuthAdapter + auth-error boundary mapper + domain AuthError/AuthResult 型別、server-only export)**、餘 M-1-14e-1b~16)
**當前 slice:** **M-1-14e-1a ✅**(M-1-14e 拆 3 段〔Sean 拍 A〕第 1 段「auth 接線」:`packages/ports/IAuthService.ts`〔signUp/signInWithPassword/signOut 介面、只依 domain 型別〕+ `packages/domain/identity/auth.ts`〔AuthCredentials/AuthSignUpParams/AuthResult〔含 needsEmailConfirmation〕/ AuthErrorCode〔domain 命名、刻意不重用 supabase wire 字面〕/ AuthError class〕+ `packages/adapters/.../mappers/auth-error.ts`〔mapSupabaseAuthError:supabase wire code→domain code 真 boundary translation〕+ `SupabaseAuthAdapter.ts`〔implements IAuthService、薄包 supabase.auth、metadata 只送 {name,phone}、register 靠 trigger 不顯式 insert customers、失敗映射 AuthError〕。**server-only**〔從 @pcm/adapters/server export、非 root public〕。三綠 typecheck 7/7 + lint 10/10 + build 1/1 + test 211〔含 14 新 auth test〕;**code-reviewer PASS 0 must-fix**;**codex 關卡1** plan FAIL→吸收 5 must-fix〔拆 e-1a/b、client 注入不自建、AuthResult 補 needsEmailConfirmation、AuthError 契約、updateProfile server-only id〕;**codex 關卡2** round1 FAIL〔AuthErrorCode 用了 supabase wire 字面〕→改 domain 命名 round2 FAIL〔註解殘留 wire 字面〕→清註解 round3 PASS。Q1=A 註冊後直接登入代價開 backlog #173;未 push)。⚠️ **e-1b/f1 前置(codex consider)**:storefront server action wire SupabaseAuthAdapter 會撞 ESLint 禁 `apps/storefront/**` import `@pcm/adapters/server` → 須先定 composition point + 精準 allowlist（不放寬到 service_role adapter）。前序 M-1-14d-2 ✅(SupabaseWalletAdapter 雙 client、已 push 0c27321)。前序 M-1-14d/c/a/a-patch/b ✅(詳見 PROGRESS)

**Branch:** dev

## 最後更新
2026-05-24 — Claude Code [M-1-14e-1a ✅ 收尾(Sean 拍 A 把 M-1-14e 拆 3 段、本段 auth 接線:IAuthService port + SupabaseAuthAdapter + auth-error boundary mapper + domain AuthError/AuthResult 型別、server-only;自驅 SOP 全跑:codex 關卡1 plan FAIL→5 must-fix 吸收〔拆段+client注入+AuthResult+錯誤契約+updateProfile id〕、code-reviewer PASS、codex 關卡2 round1/2 FAIL〔wire 字面外洩 union+註解〕→round3 PASS、三綠 211 test;Q1=A 代價開 #173);停等 Sean 推 + 拍 e-1b composition point]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `fc45926` | feat(adapters): M-1-14e-1a IAuthService port + SupabaseAuthAdapter + error mapper [M-1-14e-1a] | 2026-05-24 |
| `0c27321` | feat(adapters): M-1-14d-2 SupabaseWalletAdapter 雙 client + wallet mapper [M-1-14d-2] | 2026-05-23 |
| `870821d` | feat(adapters): M-1-14d customer/address/vehicle adapter + mapper [M-1-14d] | 2026-05-23 |

## 下一步
**M-1-14e-1a ✅、停等 Sean 推 + 拍 e-1b composition point**(d-2 0c27321 已 push;e-1a 未 push)。下一段 = **M-1-14e-1b**(**先讀 handoff `docs/handoff/2026-05-23-m-1-14e-handoff.md`**;packages/use-cases register/login/logout/update-profile use-case:吃注入 IAuthService〔e-1a 已建〕+ ICustomerRepository;register 走 signUp〔trigger 自動建 row、不顯式 insert〕、`updateProfile(currentUserId, rawInput)`〔id 只從 server session、不信 client〕、全 use-case 入口 @pcm/schemas re-parse、tier 不信 client。**開工前須拍**:storefront 怎麼 wire SupabaseAuthAdapter〔ESLint 禁 storefront import @pcm/adapters/server、且 @supabase/ssr 未裝、見 PRD §8.4 偏離〕= composition point + 精準 allowlist〔不放寬到 service_role adapter〕)。接 **e-2**(address/vehicle CRUD、default/primary 兩步 transaction)/ **e-3**(deposit-wallet mock、走 d-2 wallet adapter)→ 再 f1(Login·Register·Google OAuth UI、第一個肉眼看得到)/f2(LINE OAuth、Sean 須先做 PRD §13 dashboard checklist)/g(AccountPage 7 tab 拆檔)/h(MobileTabBar #158)。**M-1-13I 肉眼驗**(仍待 Sean 驗):首頁選車按搜尋 → 列表車種不丟 / 選車進商品頁 → 麵包屑回列表帶車 / vehiclePill 本體點→列表帶車、× 點→留本頁清車(雙格式 `?vehicle=yamaha:mt-07:2024` 與 `?brand=&model=&year=` 皆驗;dev 驗 tier 用 cookie `pcm-tier` 繞 env、見 #163)。**M-1-13H 收尾**(若未完成):肉眼驗商品頁完整流程 + 業務流程(加入購物車 / tier 條件渲染)+ Claude Design 端 explorations 刪除(Q6、push pcm-website-design → submodule update)。接著 **M-1-15** LoginPage·RegisterPage(順帶 #156 + 強推 #158)/ **M-1-16** 200 SKU 種子(#157 促銷 PRD + Supabase findBySlug + toUIProduct(p, tier) 處理 #161 經銷價 + #162 brand.country + Phase 2 supabase 6 表)。M-1 收尾跑 premortem step-2。Stage 3 收尾殘項:Cowork app 貼 bundle-docs §J(Sean、不入 repo)

## Sean 待決策
**M-1-14e Q1=A ✅**(2026-05-24:註冊後直接登入、對齊 design AccountPages.jsx L263-266;**Sean 須在 Supabase 後台關「Confirm email」**;代價已記 backlog #173)。**e-1b/f1 待拍**:SupabaseAuthAdapter 在 storefront 的 composition point + ESLint allowlist(codex 關卡2 consider、非阻 e-1a)。**M-1-14a 決策已清**:(a)✅ rls_auto_enable Sean Q1=A 拍「該做」→ backlog #172(納管補 migration + REVOKE EXECUTE、專門 slice、不急);(b)✅ Codex Packet Q2=A 放 docs/reviews、PRD M3 入 repo。(c)✅ `docs/specs/m-1-14-code-execution.md` 已 track(Sean Q=A、M-1-14 一夜跑 runbook 入版控)。 #1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

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
