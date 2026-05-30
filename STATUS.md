# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** M-1(M-0 ✅ + M-1-01~12 ✅ + M-1-13a~d ✅ + M-1-13e-pre-1/2/3 ✅ + M-1-13e-a ✅ + M-1-13e-b ✅ + M-1-13e-b-2 ✅ + M-1-13f-1 ✅ + M-1-13f-2 ✅ + **M-1-13H ✅(商品頁全面改版 6 slice 完成 + Codex Review findings 4 處 fix)** + 13g(Toast 推延)+ **Stage-3-onboarding ✅ + Stage-3-codex-fix ✅(工作流升級 + Codex 4 findings 應對)** + **M-1-13I ✅(車種跨頁傳遞 3 bug 修 + V1 manifest audit、新工作流第 2 次實證)** + **M-1-13Z ✅** + M-1-14-recon ✅ + **M-1-14a ✅(Supabase customers 4 表 + RLS + 5 trigger / 3 function + 對帳 view)** + **M-1-14b ✅(domain Customer 10 欄 + address/vehicle/wallet 3 子 entity + ports ICustomerRepo 改寫 + 3 子 port)** + **M-1-14a-patch ✅(Codex FAIL 處置:invoice NOT NULL + ledger COMMENT Q1=B + PRD 入 repo + #170/#171)** + **M-1-14c ✅(packages/schemas 6 組 zod v4 表單驗證 schema + z.infer + zod 入 catalog)** + **M-1-14d ✅(packages/adapters customer/address/vehicle 3 Supabase adapter + 3 mapper + 3 mapper test;wallet 拆 M-1-14d-2)** + **M-1-14d-2 ✅(SupabaseWalletAdapter 雙 client〔讀 authenticated / 寫 service_role〕+ wallet mapper + 7 test、server-only export)** + **M-1-14e-1a ✅(IAuthService port + SupabaseAuthAdapter + auth-error boundary mapper + domain AuthError/AuthResult 型別、server-only export)** + **M-1-14e-1b ✅(register/login/logout/update-profile use-cases、架構決策 A 守 boundary 收 domain 型別、驗證移 delivery 層)** + **M-1-14e-2a ✅(address CRUD 4 use-cases〔add/update/delete/setDefault〕+ helper + 25 test、設預設兩步守 design、三寫入路徑 ownership 統一驗、boundary A、code-reviewer + codex 雙關卡 PASS)** + **M-1-14e-2b ✅(vehicle CRUD 4 use-cases〔add/update/delete/setPrimary〕+ helper + 43 test、鏡像 e-2a、設主車兩步守 design、三寫入路徑 ownership 統一、boundary A、雙關卡 PASS;service ''→null 歸 backlog #177)** + **M-1-14e-3 ✅(depositWallet 錢包儲值 mock use-case:單筆 immutable deposit ledger insert 走 d-2 service_role writeClient、餘額靠 DB trigger 同步不手改;boundary A、amount guard 只守正整數〔業務界線留 f1〕、entryDate 台灣時區、note 對齊 design;code-reviewer PASS + codex 雙關卡 PASS)** + **M-1-14e-f1-pre ✅(f1 登入註冊 infra:@supabase/ssr + lib/supabase/{server,browser} + lib/auth/composition.ts 受控小門、D-b=A;三綠 + code-reviewer PASS;plan v4 codex 4 輪 PASS-with-comments)** + **M-1-14e-f1-a ✅(登入頁:LoginPage 直接搬 design + auth.css + Header→/login〔D-f=A〕+ login server action 信任邊界;三綠 + test 14/14)** + **M-1-14e-f1-b ✅(註冊頁:RegisterPage 搬 design L256-308〔無社交鈕 D-e〕+ 手機必填 D-g=A〔鐵則 1 override〕+ register server action 直登;三綠 + test 135/135、manifest 記可達祖先修 2 orphan #180)** + **M-1-14e-f1-c ✅(Google OAuth 閉環:LoginPage Google 鈕接 signInWithOAuth + /auth/callback exchangeCodeForSession 相對 redirect + /login?error 顯示;codex 關卡2 round1 FAIL open-redirect→修→round2 PASS;三綠 + test 140/140)** + **#181 ✅(註冊/登入表單 UX 強化、PCM 自驅:全欄必填標「（必填）」6 欄〔Q1=B〕+ 逐欄 inline error 雙通道〔Q2=B〕、codex 關卡2 round1 FAIL→修 3、round2 程式 PASS + 2 文件字面修齊)** + **M-1-14e-f2 ✅(LINE 自寫 OAuth〔Supabase 不內建 LINE、Q4=Y〕、PCM 自驅 3 sub-slice:f2-a1 /start route + line.ts〔state/CSRF cookie〕、f2-a2 /callback 全閉環 + service_role 受控小門〔ADR-0005 §8.4、Q1=A〕、f2-b LoginPage LINE 鈕接線 + 錯誤文案分流;line_user_id 唯一鍵不併帳〔Q2=A、合成 email @line.pcmmotorsports.local Q3=A〕、身分鍵存 app_metadata〔codex 關卡2 must-fix:user_metadata 可被公開 signUp 偽造〕、scope openid+profile〔Q4=A〕;codex 關卡1 FAIL→修 + 關卡2 round1 FAIL〔app_metadata〕→round2 PASS;#170 ✅〕**、餘 M-1-14e-g/h ~16)
**當前 slice:** **g-5c ✅(收件地址編輯/刪除 + updateAddressAction/deleteAddressAction、CRUD 閉環、PCM 自驅、未 push)**(g 第十片;g-5 拆三片第三片 = 編輯/刪除。AddressTab 重構單一 addrEdit state〔null=關 / 無id=新增 / 有id=編輯、強制單一表單對齊 design L347/L639/L646/L655〕+ .acc-addr-actions 編輯〔toggle〕/刪除鈕〔搬 design L638-641〕+ 刪除前 confirm('確定要刪除這筆地址？')〔搬 design L362-363〕+ 兩 inline-form 包裹層 scrollIntoView ref〔L644/L654〕。編輯重用 InlineAddressForm〔addr=該筆完整 CustomerAddress、heading「編輯地址」、onSubmit=(input)=>updateAddressAction(id,input)、id 綁 parent closure〕。新增 actions.ts updateAddressAction/deleteAddressAction〔鏡像 addAddressAction 信任邊界:① getUser user.id ② AddressInput safeParse 含巢狀 invoice〔delete 無表單驗證〕③ use-case 用 user.id 驗 ownership〔update isDefault→verifyOwnedThenUnsetOthers / delete listByCustomer 驗本人 + 刪後遞補首筆預設〕④ RLS addresses_update_own/_delete_own ⑤ DB CHECK;catch 不洩原始 error〕。設預設無獨立鈕〔design 卡片僅編輯/刪除、靠編輯表單「設為預設」勾選 swap、setDefaultAddress UI 不接〕。審查 session 抓漏搬 confirm + 假陳述「design 無 confirm」→ fix1 補回〔Sean Q1/Q2/Q3=A〕;codex 關卡2 提 plain-update 僅 RLS 守 ownership→Sean 接受 RLS 邊界、defense-in-depth 留 #199。三綠 typecheck 7/7 + lint 10/10 + build /account ƒ + vitest 71 檔/434〔+actions.test 10 + AddressTab +5〕。manifest 擴 g-5c + business_override addressUpdateDeleteSessionWriteTrustBoundary。前序 g-5b〔g 第九片〕= 新增表單 + addAddressAction、見 git history)

**Branch:** dev

## 最後更新
2026-05-31 — Claude Code [g-5c ✅(收件地址編輯/刪除 + update/deleteAddressAction、CRUD 閉環、PCM 自驅;fix1 補搬 design L362-363 confirm + 改正假陳述「design 無 confirm」、Sean Q1/Q2/Q3=A;三綠 typecheck 7/7 + lint 10/10 + build + vitest 71 檔/434;manifest 擴 g-5c + business_override + backlog #199;未 push、等 Sean 手動推)]

## 最近 3 commit
> 下表列近期 3 個有意義的可達 commit(挑有意義的、非機械 git log -3;本 g-5c slice commit〔HEAD〕記可達祖先 304d399 為表頂、g-5c commit 自身 hash 不入表〔避 busboy 雙 amend orphan、見 memory project_status-top-hash-off-by-one-normal + backlog #180〕;busboy 步驟 7 例外:STATUS 已在 slice 主 commit 手動更新、不再 amend)
| Hash | 訊息 | 時間 |
|---|---|---|
| `304d399` | docs(config): codex-adversary 觸發收緊預設不跑+硬上限2輪+成本校正 [E+B] | 2026-05-30 |
| `722e3f0` | feat(storefront): g-5b 收件地址新增表單 + 發票三 tab + addAddressAction [M-1-14e-g-5b] | 2026-05-29 |
| `22a0a92` | feat(storefront): g-5a 收件地址 tab 讀地基 + getAddressRepo [M-1-14e-g-5a] | 2026-05-29 |

## 下一步
**g-5c ✅(收件地址編輯/刪除、CRUD 閉環、未 push)→ g-6**:收件地址 CRUD 完成〔新增〔g-5b〕/ 編輯 / 刪除〔confirm 確認〕/ 設預設靠編輯表單勾選 swap〕。**下一片 = g-6**〔vehicles tab 接 e-2b 4 use-case〔add/update/delete/setPrimary vehicle、鏡像 e-2a address、isPrimary〕〕→ g-7〔wallet 接 getBalance/listEntries〕。**g-5c 肉眼驗卡 Sean**(等 push 後實機驗):登入 /account 收件地址 → 每卡「編輯/刪除」鈕;點編輯 → 表單帶入該筆舊值〔收件人/手機/地址/發票模式〕→ 改值儲存 → 不重新整理即見更新;點刪除 → 跳「確定要刪除這筆地址？」→ 確定則卡片消失〔刪掉預設則首筆遞補〕、取消則不刪;編輯表單勾「設為預設」儲存 → 該卡變預設、原預設取消;桌機 + 手機。**g-5a/g-5b 肉眼驗仍卡 Sean**(同前、等 push 實機)。

## Sean 待決策
**backlog #193 跨 provider identity linking 已拍 ✅**(2026-05-28 Sean g-1 肉眼驗時 + 戳到「3 方法=3 帳號」+ 拍 **C 中庸引導**:LoginPage 引導文案 + Email/Google 註冊 server-side 撞處置 + 不 auto-link);**架構決策依賴待拍**:auth admin lookup 路徑三選一(a 服務 storefront 開 service_role 受控小門 / b 改 apps/api / c DB unique constraint + helper view、見 backlog #193 詳細);**最晚 g-5(地址)/g-6(愛車)前必修**(g-2/g-3/g-4 不擋);LINE 端非對稱(無 email 不可自動偵測)、補綁走 backlog #179。**前序:**
**M-1-14e-f2 LINE OAuth 已拍 ✅**(2026-05-25 Sean Q1-Q4):**Q1=A** service_role 受控小門進 storefront〔line-admin.ts、ADR-0005 §8.4 護欄四條:server-only + runtime=nodejs + 受控 eslint-disable + commit 前 grep client bundle〕/ **Q2=A** line_user_id 唯一鍵不併帳〔身分鍵實作改存 app_metadata、codex 關卡2 must-fix:user_metadata 可偽造〕/ **Q3=A** 合成 email 固定常數網域 line.pcmmotorsports.local / **Q4=A** scope 只 openid+profile〔email 可選、不等 LINE email 權限審核〕。**f2 肉眼驗卡 Sean dashboard 前置**:§13 LINE Developers channel 註冊 + Callback URL〔localhost:3000/api/auth/line/callback + 線上〕+ .env.local 3 env vars〔Code 端不驗 .env、Q4=A 稱已就緒〕。**M-1-14e 架構決策 A ✅**(2026-05-24 Sean+陪審:守 boundary use-cases ⊥ schemas、表單驗證在 delivery 層;不改 config / 不改 ADR)。**Q1=A ✅**(註冊後直接登入;**Sean 須在 Supabase 後台關「Confirm email」**;代價 backlog #173)。**f1 已拍 ✅**(2026-05-24 Sean + 陪審 + codex 4 輪):D-a=A 地圖代號維持〔#178 留 M-1-14 收尾對齊〕/ D-b=A composition root 單檔 inline-disable〔不搬 public〕/ D-d=A deposit·vehicle 留 stage g / D-e design 無 Register 社交鈕 / **D-f=A** Header 會員圖示 NAV_ROUTE_MAP.account→/login〔否則 /login 孤兒頁、stage g 補登入態判斷〕/ **D-g=A** email 註冊手機必填〔鐵則 1 design override + 前端必填 affordance;OAuth 會員 phone 可空〔DB DEFAULT ''〕、補 phone 留 g〕。**f1 Sean 端 dashboard 前置〔卡肉眼驗、非卡 infra〕**:① Confirm email OFF〔f1-b 直登〕② §13.1 Google OAuth client〔f1-c〕③ Supabase Auth → URL Configuration → Redirect URLs 含 `http://localhost:3000/auth/callback`〔f1-c 本地;preview/prod 留部署 #4〕。**f1 g-scope follow-up → backlog #179**〔Header 登入態條件路由 / ap-page·ap-mono shared base 抽取 / OAuth 會員補 phone / requireEnv dedup〕。**M-1-14a 決策已清**:(a)✅ rls_auto_enable Sean Q1=A 拍「該做」→ backlog #172(納管補 migration + REVOKE EXECUTE)— **AUDIT-AC-CLOSE-1 確認仍開、Q3=A 拍板維持不急、折入 e-3/M-1-16 下個 migration、不另開專門 slice**;**另:AUDIT-AC-CLOSE-1 發現會員 migration 線上版本時間戳漂移、Q1=B 已 supabase migration repair 對齊回 repo〔詳見 docs/audits/2026-05-24-supabase-db-reconciliation.md〕、地雷解除**;(b)✅ Codex Packet Q2=A 放 docs/reviews、PRD M3 入 repo。(c)✅ `docs/specs/m-1-14-code-execution.md` 已 track(Sean Q=A、M-1-14 一夜跑 runbook 入版控)。 #1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

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
