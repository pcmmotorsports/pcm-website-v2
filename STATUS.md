# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅ + **M-1-13H ✅(商品頁全面改版 6 slice 完成 + Codex Review findings 4 處 fix)** + 13g(Toast 推延)+ **Stage-3-onboarding ✅ + Stage-3-codex-fix ✅(工作流升級 + Codex 4 findings 應對)** + **M-1-13I ✅(車種跨頁傳遞 3 bug 修 + V1 manifest audit、新工作流第 2 次實證)** + **M-1-13Z ✅** + M-1-14-recon ✅ + **M-1-14a ✅(Supabase customers 4 表 + RLS + 5 trigger / 3 function + 對帳 view)** + **M-1-14b ✅(domain Customer 10 欄 + address/vehicle/wallet 3 子 entity + ports ICustomerRepo 改寫 + 3 子 port)** + **M-1-14a-patch ✅(Codex FAIL 處置:invoice NOT NULL + ledger COMMENT Q1=B + PRD 入 repo + #170/#171)** + **M-1-14c ✅(packages/schemas 6 組 zod v4 表單驗證 schema + z.infer + zod 入 catalog)** + **M-1-14d ✅(packages/adapters customer/address/vehicle 3 Supabase adapter + 3 mapper + 3 mapper test;wallet 拆 M-1-14d-2)** + **M-1-14d-2 ✅(SupabaseWalletAdapter 雙 client〔讀 authenticated / 寫 service_role〕+ wallet mapper + 7 test、server-only export)** + **M-1-14e-1a ✅(IAuthService port + SupabaseAuthAdapter + auth-error boundary mapper + domain AuthError/AuthResult 型別、server-only export)** + **M-1-14e-1b ✅(register/login/logout/update-profile use-cases、架構決策 A 守 boundary 收 domain 型別、驗證移 delivery 層)** + **M-1-14e-2a ✅(address CRUD 4 use-cases〔add/update/delete/setDefault〕+ helper + 25 test、設預設兩步守 design、三寫入路徑 ownership 統一驗、boundary A、code-reviewer + codex 雙關卡 PASS)** + **M-1-14e-2b ✅(vehicle CRUD 4 use-cases〔add/update/delete/setPrimary〕+ helper + 43 test、鏡像 e-2a、設主車兩步守 design、三寫入路徑 ownership 統一、boundary A、雙關卡 PASS;service ''→null 歸 backlog #177)** + **M-1-14e-3 ✅(depositWallet 錢包儲值 mock use-case:單筆 immutable deposit ledger insert 走 d-2 service_role writeClient、餘額靠 DB trigger 同步不手改;boundary A、amount guard 只守正整數〔業務界線留 f1〕、entryDate 台灣時區、note 對齊 design;code-reviewer PASS + codex 雙關卡 PASS)**、餘 M-1-14e-f1/f2/g/h ~16)
**當前 slice:** **M-1-14e-3 ✅**(M-1-14e 倒數第 2 段:`packages/use-cases` 落地 `depositWallet` 錢包儲值 mock use-case。**mock 記帳、真金流 M-3**〔PRD `docs/specs/m-1-14-customer-schema.md` L72 已點名 deposit-wallet.ts mock、不接 TapPay〕:單筆 `addEntry` deposit ledger entry〔entryType 固定 'deposit'、amount 正、relatedOrderId null〕走 d-2 SupabaseWalletAdapter **service_role writeClient**;**餘額 customers.wallet_balance/total_deposit 靠 DB AFTER INSERT trigger 同步、use-case 不手改不自算**。**Sean 拍板**:D1a 不另包 getBalance/listEntries use-case + D1b 只回那筆 entry + D2 entryDate/note use-case 內部產 + D3 entryDate 台灣時區〔Asia/Taipei、`formatToParts` 自組 YYYY-MM-DD〕+ D4 amount 最小 guard **只守正整數**〔業務界線 ≥100/≤1M 留 f1 delivery DepositInput〕。**boundary A**〔只 import domain+ports、零新跨層、lint boundaries 綠〕;信任邊界 customerUserId 用 currentUserId 填、entryType caller 無法覆寫、relatedOrderId null。三綠 typecheck 7/7 + lint 10/10 + build 1/1 + deposit-wallet.test 5/5。**SOP**:鐵則 8〔3 檔〕Sean 明確批 plan 才實作;codex 關卡1 FAIL→修 3 must-fix〔內容分級改 L3〔已有 PRD+RLS+trigger 支撐、不停補〕/ 鐵則8判重大 / amount 驗證落點明確 = f1 delivery DepositInput.parse〕;code-reviewer PASS 0 must-fix;codex 關卡2 PASS→採 3 consider/nit〔formatToParts 健壯化 + D1b not-called 驗 + mock 回傳字面對齊〕。**f1 阻擋驗收**:f1 deposit 路徑必做 server-side DepositInput.parse + 信任邊界測試〔架構決策 A、e-3 use-case 只守正整數、完整驗證留 f1、DB CHECK 為最後防線非主驗證〕。未 push。**前序 AUDIT-AC-CLOSE-1 ✅**(任務 A graphify 結構稽核 + 任務 C Supabase 線上 DB 對帳、2 份報告入 `docs/audits/`〔graphify-structural-audit + supabase-db-reconciliation〕。**Q1=B 已執行 `supabase migration repair`** 把線上 schema_migrations 對齊回 repo 版本號 `20260523034911`/`20260523052537`〔reverted 035648/052624 + applied 034911/052537、雙重驗證〕;**schema / 資料 / repo .sql / 14 處版本號引用全未動、`db push` 撞「已存在」地雷解除**。報告字面修正:§二根因「已坐實」降「推測」+ stmt_count 更正〔承認 2 個 product migration 也 1 句、非 MCP 可靠判據〕+ graphify §七.1 去重數改以 graph_diff〔114 新/227 移除/淨 −113〕自洽。**Q3=A** #172 維持不急、折入 e-3/M-1-16 下個 migration〔CREATE OR REPLACE + REVOKE EXECUTE〕。graphify `--update` 已納 e-2a/2b〔1633→1520 節點、自我去重〕。三綠 typecheck 7/7 + lint 10/10〔純 docs、build 跳〕;code-reviewer FAIL 1〔graphify L22 殘留 239〕→修→PASS;未 push。**前序 M-1-14e-2b ✅**(M-1-14e 第 2 段 e-2b〔vehicle〕鏡像 e-2a 完成:`packages/use-cases` 落地 addVehicle/updateVehicle/deleteVehicle/setPrimaryVehicle + helper `_vehicle-primary.ts`。**3 行為對齊 design AccountPages.jsx**〔L388/L391-393/L401-406〕:設主車兩步 unset→set、刪除遞補最舊、add 不強制首台;三寫入路徑 ownership 統一 verifyOwnedThenUnsetOtherPrimary;**service〔string|null、DB date 欄〕use-case pass-through、''→null 正規化歸 delivery/schema〔backlog #177、f1 wiring 前必修〕**;boundary A、型別收窄;三綠 7/7+10/10+1/1、use-cases 12 檔/43 test;codex 關卡1 FAIL→修 2 must-fix、code-reviewer PASS、codex 關卡2 PASS;順手 backlog #176〔ownership 違規統一 typed error〕;未 push。前序 M-1-14e-2a ✅(M-1-14e 第 2 段拆 e-2a〔address〕先做、e-2b〔vehicle〕鏡像下一個:`packages/use-cases` 落地 addAddress/updateAddress/deleteAddress/setDefaultAddress + 內部 helper `_address-default.ts`。**3 行為逐字對齊 design AccountPages.jsx**〔已 grep L352/L356/L364-365〕:設預設先 unset 舊→再 set 新〔best-effort 兩步、Sean Q2=A、非 DB transaction、set 失敗拋讓 UI 重試、零預設可接受、不補償〕、刪除遞補第一筆、add 不強制首筆。**信任邊界**:currentUserId server session、add 覆寫 customerUserId;**三寫入路徑〔setDefault/update-isDefault/delete〕統一 verifyOwnedThenUnsetOthers 先驗 ownership**〔codex 關卡2 must-fix:不驗先 unset 致越權 id 留零預設〕+ RLS。守 boundary A〔use-cases ⊥ schemas、型別收窄 Omit customerUserId/Partial<Pick>〕。三綠 typecheck 7/7 + lint 10/10 + build 1/1;use-cases 8 檔/25 test〔swap 順序/遞補/ownership throw/set 失敗不補償/add 不強制首筆〕。SOP:codex 關卡1 FAIL→修 5 項〔拆/對齊 design 刪除遞補+不強制首筆/型別收窄/best-effort/L3〕、code-reviewer PASS、codex 關卡2 FAIL〔ownership must-fix〕→抽共用 helper→round2 PASS;未 push。前序 M-1-14e-1b ✅(M-1-14e 第 1 段「auth+profile use-cases」收尾〔e-1 拆 e-1a 接線 + e-1b use-cases〕:`packages/use-cases` 落地 register/login/logout/update-profile 4 use-case。**架構決策 A**〔Sean+陪審 2026-05-24:守 eslint boundaries ADR-0002 §4.2「use-cases ⊥ schemas」;原 handoff『use-cases 用 @pcm/schemas re-parse』與 boundary 衝突、已更正〕→ use-case **只收已驗證 domain 型別**(register→AuthSignUpParams、login→AuthCredentials、update-profile→Partial<Pick<Customer,name/phone/birthday>>),表單 @pcm/schemas parse / strip 未知欄 / 取 session userId **移 delivery 層**(f1 server action、server 端、不信 client);register 靠 trigger 不顯式 insert;updateProfile currentUserId 獨立參數 + 型別白名單 + DB GRANT 三層守 codex #5 信任邊界。順帶修 e-1a `domain/identity/auth.ts` + `use-cases/index.ts` JSDoc 對齊 A。deps 只加 @pcm/domain + @pcm/ports〔**無 schemas**〕。三綠 typecheck 7/7 + lint 10/10〔boundaries 綠〕+ build 1/1 + test 219〔8 新 delegation test〕;**code-reviewer PASS 0 must-fix**;**codex 關卡2 PASS**〔consider:patch 改 Partial 對齊 port、logout 補 reject test〕;未 push)。前序 e-1a ✅(commit fc45926、auth 接線 port+adapter+mapper)+ skill chore a1c2542。前序 M-1-14d-2/d/c/a/b ✅(詳見 PROGRESS)

**Branch:** dev

## 最後更新
2026-05-24 — Claude Code [M-1-14e-3 ✅(depositWallet 錢包儲值 mock use-case、code+STATUS 同 commit):單筆 `addEntry` deposit ledger〔走 d-2 service_role writeClient、餘額 DB trigger 同步、use-case 不手改不自算〕;Sean 拍 D1a 不包讀 use-case / D1b 只回帳 / D2 內部產 entryDate+note / D3 台灣時區 formatToParts 自組 / D4 guard 只守正整數〔業務界線留 f1〕;boundary A〔零新跨層〕;三綠 typecheck 7/7 + lint 10/10 + build 1/1 + test 5/5;**SOP**:鐵則 8〔3 檔〕Sean 明確批 plan;codex 關卡1 FAIL→修 3 must-fix〔分級改 L3 / 鐵則8判重大 / 驗證落點明確〕、code-reviewer PASS 0 must-fix、codex 關卡2 PASS→採 3 consider/nit〔formatToParts 健壯化 / D1b not-called 驗 / mock 回傳字面對齊〕;f1 阻擋驗收:server-side DepositInput.parse + 信任邊界測試〔架構決策 A〕。未 push:本 e-3 commit。下一段 = f1 登入註冊頁。— 前一筆 —— AUDIT-AC-CLOSE-1 ✅(稽核收尾、純 docs):任務 A graphify 結構稽核(0 真缺漏/0 真重複/0 懸空邊;3 個未實作 port = M-3/M-5 計畫內)+ 任務 C Supabase 線上 DB 對帳(8 表/RLS/欄位/防越權鎖全對得上)、2 報告入 docs/audits。**Q1=B:跑 supabase migration repair 把線上 tracking 對齊回 repo 034911/052537、schema/資料/.sql 未動、雙重驗證、db push 地雷解除**;Q3=A #172 折入未來 migration;報告 2 處字面修正(根因降推測 + stmt_count 更正 + graphify 去重數自洽)。三綠 7/7+10/10〔build 跳〕;code-reviewer FAIL 1→修→PASS。未 push:本 STATUS/audit commit。前序同 session(已推送):M-1-14e-2b afd3e7e / e-2a 6af312e / 地圖 4d5661d / e-3 handoff 732d9fb。下一段不變 = e-3 deposit-wallet(見 handoff)。— 前一筆 —— M-1-14e-2b ✅(vehicle CRUD 4 use-cases + helper、commit afd3e7e、鏡像 e-2a):3 行為對齊 design AccountPages.jsx〔設主車兩步 unset→set、刪除遞補最舊、add 不強制首台〕;三寫入路徑 ownership 統一 verifyOwnedThenUnsetOtherPrimary;service〔string|null date 欄〕use-case pass-through、''→null 歸 delivery/schema〔backlog #177〕;boundary A、型別收窄;Sean Q2=A best-effort、不補償;三綠 7/7+10/10+1/1、use-cases 12 檔/43 test;SOP codex 關卡1〔FAIL→修 2 must-fix〕+ code-reviewer PASS + codex 關卡2 PASS;backlog #176 typed error。前序同 session:M-1-14e-2a ✅(6af312e、address CRUD)/graphify 採用 ✅(36ac988、1633 節點、backlog #175)/M-1-14e-1b ✅(0e088f2)。+ 刷新進度地圖〔Option A、M-1-14 展開後端 9 段、commit 4d5661d、backlog #178 會員 UI 歸屬待決〕+ 寫 e-3 handoff〔docs/handoff/2026-05-24-m-1-14e-3-handoff.md〕。未 push:6af312e e-2a / afd3e7e e-2b / 4d5661d 地圖 / + 本 STATUS commit〔graphify 36ac988/15d9861 稍早已推送〕——**等 Sean 推完即交接新 session(審查 + 執行都換)**;下一段 e-3 deposit-wallet(見 handoff)]

## 最近 3 commit
> 本 M-1-14e-3 commit 為當前 HEAD(`feat(use-cases): M-1-14e-3 depositWallet…`);下表列其 3 個可達祖先(避免 amend 後 self-hash orphan、見 memory project_status-top-hash-off-by-one-normal、已 git merge-base --is-ancestor 驗)。
| Hash | 訊息 | 時間 |
|---|---|---|
| `adc886e` | docs(audits): 任務 A/C 收尾 — 線上 migration tracking 採 B 對齊 repo + 稽核報告字面修正 | 2026-05-24 |
| `732d9fb` | docs(handoff): e-3 deposit-wallet mock handoff + STATUS 下一步更到位 | 2026-05-24 |
| `4d5661d` | docs: 刷新進度地圖 M-1-14 展開後端 9 段(Option A)+ backlog #178 | 2026-05-24 |

## 下一步
**M-1-14e-3 ✅(depositWallet 錢包儲值 mock use-case、code+STATUS 同 commit、未 push、停等 Sean 推)。** 下一段 = **f1 登入註冊頁(第一個肉眼看得到的會員 UI)**。**f1 開工前須定**:composition point〔storefront 怎麼 wire 注入 adapter:ESLint 禁 storefront import @pcm/adapters/server、@supabase/ssr 未裝、PRD §8.4 偏離〕+ f1 承接驗證 / strip / session userId / trust-boundary 測試〔架構決策 A 從 use-case 移此〕**+ e-3 接續:f1 deposit 路徑必做 server-side DepositInput.parse〔整數 / ≥100 / ≤1,000,000 / paymentMethod〕+ 信任邊界測試;e-3 use-case 只守正整數、完整業務驗證留 f1〔DB CHECK 為最後防線非主驗證、codex 雙關卡 must-fix〕**。→ f1 含 Login·Register·Google OAuth UI〔第一個肉眼看得到〕後接 f2(LINE OAuth、Sean 須先做 PRD §13 dashboard checklist)/g(AccountPage 7 tab 拆檔)/h(MobileTabBar #158)。**M-1-13I 肉眼驗**(仍待 Sean 驗):首頁選車按搜尋 → 列表車種不丟 / 選車進商品頁 → 麵包屑回列表帶車 / vehiclePill 本體點→列表帶車、× 點→留本頁清車(雙格式 `?vehicle=yamaha:mt-07:2024` 與 `?brand=&model=&year=` 皆驗;dev 驗 tier 用 cookie `pcm-tier` 繞 env、見 #163)。**M-1-13H 收尾**(若未完成):肉眼驗商品頁完整流程 + 業務流程(加入購物車 / tier 條件渲染)+ Claude Design 端 explorations 刪除(Q6、push pcm-website-design → submodule update)。接著 **M-1-15** LoginPage·RegisterPage(順帶 #156 + 強推 #158)/ **M-1-16** 200 SKU 種子(#157 促銷 PRD + Supabase findBySlug + toUIProduct(p, tier) 處理 #161 經銷價 + #162 brand.country + Phase 2 supabase 6 表)。M-1 收尾跑 premortem step-2。Stage 3 收尾殘項:Cowork app 貼 bundle-docs §J(Sean、不入 repo)

## Sean 待決策
**M-1-14e 架構決策 A ✅**(2026-05-24 Sean+陪審:守 boundary use-cases ⊥ schemas、表單驗證在 delivery 層;不改 config / 不改 ADR)。**Q1=A ✅**(註冊後直接登入;**Sean 須在 Supabase 後台關「Confirm email」**;代價 backlog #173)。**f1 待拍**:SupabaseAuthAdapter 在 storefront 的 composition point + ESLint allowlist + @supabase/ssr〔PRD §8.4 偏離〕。**M-1-14a 決策已清**:(a)✅ rls_auto_enable Sean Q1=A 拍「該做」→ backlog #172(納管補 migration + REVOKE EXECUTE)— **AUDIT-AC-CLOSE-1 確認仍開、Q3=A 拍板維持不急、折入 e-3/M-1-16 下個 migration、不另開專門 slice**;**另:AUDIT-AC-CLOSE-1 發現會員 migration 線上版本時間戳漂移、Q1=B 已 supabase migration repair 對齊回 repo〔詳見 docs/audits/2026-05-24-supabase-db-reconciliation.md〕、地雷解除**;(b)✅ Codex Packet Q2=A 放 docs/reviews、PRD M3 入 repo。(c)✅ `docs/specs/m-1-14-code-execution.md` 已 track(Sean Q=A、M-1-14 一夜跑 runbook 入版控)。 #1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

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
