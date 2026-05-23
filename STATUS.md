# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅ + **M-1-13H ✅(商品頁全面改版 6 slice 完成 + Codex Review findings 4 處 fix)** + 13g(Toast 推延)+ **Stage-3-onboarding ✅ + Stage-3-codex-fix ✅(工作流升級 + Codex 4 findings 應對)** + **M-1-13I ✅(車種跨頁傳遞 3 bug 修 + V1 manifest audit、新工作流第 2 次實證)** + **M-1-13Z ✅** + M-1-14-recon ✅ + **M-1-14a ✅(Supabase customers 4 表 + RLS + 5 trigger / 3 function + 對帳 view)** + **M-1-14b ✅(domain Customer 10 欄 + address/vehicle/wallet 3 子 entity + ports ICustomerRepo 改寫 + 3 子 port)** + **M-1-14a-patch ✅(Codex FAIL 處置:invoice NOT NULL + ledger COMMENT Q1=B + PRD 入 repo + #170/#171)** + **M-1-14c ✅(packages/schemas 6 組 zod v4 表單驗證 schema + z.infer + zod 入 catalog)** + **M-1-14d ✅(packages/adapters customer/address/vehicle 3 Supabase adapter + 3 mapper + 3 mapper test;wallet 拆 M-1-14d-2)** + **M-1-14d-2 ✅(SupabaseWalletAdapter 雙 client〔讀 authenticated / 寫 service_role〕+ wallet mapper + 7 test、server-only export)** + **M-1-14e-1a ✅(IAuthService port + SupabaseAuthAdapter + auth-error boundary mapper + domain AuthError/AuthResult 型別、server-only export)** + **M-1-14e-1b ✅(register/login/logout/update-profile use-cases、架構決策 A 守 boundary 收 domain 型別、驗證移 delivery 層)**、餘 M-1-14e-2/3~16)
**當前 slice:** **M-1-14e-1b ✅**(M-1-14e 第 1 段「auth+profile use-cases」收尾〔e-1 拆 e-1a 接線 + e-1b use-cases〕:`packages/use-cases` 落地 register/login/logout/update-profile 4 use-case。**架構決策 A**〔Sean+陪審 2026-05-24:守 eslint boundaries ADR-0002 §4.2「use-cases ⊥ schemas」;原 handoff『use-cases 用 @pcm/schemas re-parse』與 boundary 衝突、已更正〕→ use-case **只收已驗證 domain 型別**(register→AuthSignUpParams、login→AuthCredentials、update-profile→Partial<Pick<Customer,name/phone/birthday>>),表單 @pcm/schemas parse / strip 未知欄 / 取 session userId **移 delivery 層**(f1 server action、server 端、不信 client);register 靠 trigger 不顯式 insert;updateProfile currentUserId 獨立參數 + 型別白名單 + DB GRANT 三層守 codex #5 信任邊界。順帶修 e-1a `domain/identity/auth.ts` + `use-cases/index.ts` JSDoc 對齊 A。deps 只加 @pcm/domain + @pcm/ports〔**無 schemas**〕。三綠 typecheck 7/7 + lint 10/10〔boundaries 綠〕+ build 1/1 + test 219〔8 新 delegation test〕;**code-reviewer PASS 0 must-fix**;**codex 關卡2 PASS**〔consider:patch 改 Partial 對齊 port、logout 補 reject test〕;未 push)。前序 e-1a ✅(commit fc45926、auth 接線 port+adapter+mapper)+ skill chore a1c2542。前序 M-1-14d-2/d/c/a/b ✅(詳見 PROGRESS)

**Branch:** dev

## 最後更新
2026-05-24 — Claude Code [M-1-14e-1b ✅ 收尾(register/login/logout/update-profile use-cases;**架構決策 A** 守 boundary〔use-cases ⊥ schemas、原 handoff 偏離已更正〕→ use-case 收 domain 型別、表單驗證移 delivery 層 f1;codex 關卡1 #5 信任邊界落點改 f1 + 型別白名單 + DB 三層;三綠 219 test、code-reviewer PASS、codex 關卡2 PASS);本 session commit〔fc45926 e-1a / a1c2542 skill / 0e088f2 e-1b / + 本 STATUS hash 校正 commit 指向可達 0e088f2〕未 push;陪審 raise busboy orphan 根因 → backlog #174;下一段 e-2 address/vehicle CRUD use-cases〔含 default/primary 兩步 transaction、注意原子性〕]

## 最近 3 commit
| Hash | 訊息 | 時間 |
|---|---|---|
| `0e088f2` | feat(use-cases): M-1-14e-1b register/login/logout/update-profile use-cases [M-1-14e-1b] | 2026-05-24 |
| `a1c2542` | chore(skills): codex-adversary 補 codex exec < /dev/null + STATUS hash 校正 | 2026-05-24 |
| `fc45926` | feat(adapters): M-1-14e-1a IAuthService port + SupabaseAuthAdapter + error mapper [M-1-14e-1a] | 2026-05-24 |

## 下一步
**M-1-14e-1b ✅(M-1-14e 第 1 段 auth+profile 完)、停等 Sean 推**(本 session 3 commit fc45926 / a1c2542 / e-1b 未 push)。下一段 = **M-1-14e-2**(packages/use-cases address/vehicle CRUD use-cases:add/update/delete-address + add/update/delete-vehicle;**default/primary 兩步 transaction 邏輯在此層**〔unset 舊→set 新〕,吃注入 IAddressRepository/IVehicleRepository〔M-1-14d〕;守 boundary 同 e-1b〔收 domain 型別、驗證移 delivery〕;**注意 default/primary 兩步原子性**:撞 partial unique index〔customer_addresses_one_default_per_customer / vehicles_one_primary_per_customer〕、unset 舊→set 新 之間失敗留無預設 / 順序錯撞 index → 評估 DB transaction/RPC 原子交換、或接受短暫無預設並在 codex 關卡1 講清;e-2 有真邏輯 → code-reviewer + codex 雙關卡不跳)→ **e-3**(deposit-wallet mock、走 d-2 SupabaseWalletAdapter writeClient service_role)。**f1 開工前須定**:composition point〔storefront 怎麼 wire 注入 adapter:ESLint 禁 storefront import @pcm/adapters/server、@supabase/ssr 未裝、PRD §8.4 偏離〕+ f1 承接驗證 / strip / session userId / trust-boundary 測試〔架構決策 A 從 use-case 移此〕。→ 再 f1(Login·Register·Google OAuth UI、第一個肉眼看得到)/f2(LINE OAuth、Sean 須先做 PRD §13 dashboard checklist)/g(AccountPage 7 tab 拆檔)/h(MobileTabBar #158)。**M-1-13I 肉眼驗**(仍待 Sean 驗):首頁選車按搜尋 → 列表車種不丟 / 選車進商品頁 → 麵包屑回列表帶車 / vehiclePill 本體點→列表帶車、× 點→留本頁清車(雙格式 `?vehicle=yamaha:mt-07:2024` 與 `?brand=&model=&year=` 皆驗;dev 驗 tier 用 cookie `pcm-tier` 繞 env、見 #163)。**M-1-13H 收尾**(若未完成):肉眼驗商品頁完整流程 + 業務流程(加入購物車 / tier 條件渲染)+ Claude Design 端 explorations 刪除(Q6、push pcm-website-design → submodule update)。接著 **M-1-15** LoginPage·RegisterPage(順帶 #156 + 強推 #158)/ **M-1-16** 200 SKU 種子(#157 促銷 PRD + Supabase findBySlug + toUIProduct(p, tier) 處理 #161 經銷價 + #162 brand.country + Phase 2 supabase 6 表)。M-1 收尾跑 premortem step-2。Stage 3 收尾殘項:Cowork app 貼 bundle-docs §J(Sean、不入 repo)

## Sean 待決策
**M-1-14e 架構決策 A ✅**(2026-05-24 Sean+陪審:守 boundary use-cases ⊥ schemas、表單驗證在 delivery 層;不改 config / 不改 ADR)。**Q1=A ✅**(註冊後直接登入;**Sean 須在 Supabase 後台關「Confirm email」**;代價 backlog #173)。**f1 待拍**:SupabaseAuthAdapter 在 storefront 的 composition point + ESLint allowlist + @supabase/ssr〔PRD §8.4 偏離〕。**M-1-14a 決策已清**:(a)✅ rls_auto_enable Sean Q1=A 拍「該做」→ backlog #172(納管補 migration + REVOKE EXECUTE、專門 slice、不急);(b)✅ Codex Packet Q2=A 放 docs/reviews、PRD M3 入 repo。(c)✅ `docs/specs/m-1-14-code-execution.md` 已 track(Sean Q=A、M-1-14 一夜跑 runbook 入版控)。 #1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

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
