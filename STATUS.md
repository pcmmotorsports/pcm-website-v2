# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-3 結帳**(階段① ✅;階段②-① confirm RPC + payment_confirmer ✅ 上 prod;階段②-②a TapPayChargeAdapter ✅;②-②b confirmer+use-case 開工)
**當前 slice:** **M-3 階段②-②b PaymentConfirmerAdapter(pg 直連)+ confirm-payment use-case** — 接 ②-②a charge adapter;IPaymentConfirmer port + pg 直連 5432 呼 confirm_order_payment + 孤兒契約 outcome 編排 charge→confirm。**②-②a ✅**(TapPayChargeAdapter pay-by-prime sandbox + TapPayChargeResult 補 amount〔PF-X3〕+ Cardholder.phoneNumber 必填 + order_number 對帳;鐵則8 pg 已批 A1=A、本片 plan 落實 BLOCKER+3MUST-FIX+8SHOULD)。

**Branch:** dev

## 最後更新
2026-06-12 — Claude Code 執行 session(寫審分離 ROLE=A 執行側)[**階段②-②a TapPayChargeAdapter ✅**:pay-by-prime sandbox charge adapter(server-only Partner Key 走 @pcm/adapters/server subpath、PII mask #16、wire→domain)+ domain TapPayChargeResult 補 amount:Money〔BLOCKER PF-X3〕+ Cardholder.phoneNumber 必填 + order_number TapPay 對帳;鐵則8 pg 已批 A1=A、寫 ②-② plan 落實 BLOCKER+3MUST-FIX+8SHOULD;三綠 753 + code-reviewer PASS + codex 關卡2(round1 3 findings〔order_number/phone必填/plan字面〕全修、round2 唯一 doc-NIT 已修、code 本體 round2 零 finding)→ 開工 ②-②b PaymentConfirmerAdapter+use-case]
前序 2026-06-11 — [階段②-① confirm RPC + payment_confirmer 窄權角色 ✅ db push 上 production + env 就緒(TapPay 金鑰 + payment_confirmer 密碼/PAYMENT_CONFIRMER_DB_URL)]

## 最近 3 commit
> 下表列近期可達 commit(挑有意義的、非機械 git log -3;表頂 `c11ec9c` 為本 ②-②a slice commit 提交時 dev 可達父、本 slice commit 自身 hash 不入表〔避 off-by-one orphan、busboy-end 或 ②-②b 時補真 hash〕)。
| Hash | 訊息 | 時間 |
|---|---|---|
| `c11ec9c` | docs(status): 階段②-① db push 上 prod + env 就緒、下一步 ②-② [m-3] | 2026-06-11 |
| `2e071aa` | feat(schemas): M-3 階段②-① confirm_order_payment RPC + payment_confirmer 窄權角色 [m-3] | 2026-06-11 |
| `b241a82` | style(storefront): #223 商品詳情頁文案全形標點+換行寬統一+手機段落靠左 [#223] | 2026-06-10 |

## 下一步
**🆕 M-3 階段②-②b PaymentConfirmerAdapter + confirm-payment use-case**(接 ②-②a charge adapter):IPaymentConfirmer port + pg 直連 5432〔非 pooler、SECDEF 不斷〕呼 confirm_order_payment + finally end()+ 連線/RPC RAISE 失敗分類 + use-case 編排 charge→confirm 回孤兒契約 outcome〔付款已收勿重刷〕+ composition root 受控注入 + package.json 加 pg + master plan §3.2 webhook override 更新。鐵則8 pg **已批 A1=A**(不需再提)。續 ②-③ charge action〔PF-X1/X2/X3 落地〕/ ②-④ 前端 TapPay Fields / ②-⑤ 完成頁 / ②-⑥ webhook。詳 docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md + kickoff §7

**前序(整合線/OD,多已完成):** **OD 商品頁改造 Phase A(OD-5~11)已合併進 dev ✅**(merge cf630b2、與 S6 fitments 共存、合併後三綠 + 完整 pnpm test 531 全綠;整合線 S0–S6 + OD Phase A 皆完成;下一步 **OD-12 適用車款表**接 S6 plumb 的 fitments[]〔D1=A 真 3 欄、post-merge〕、Sean 肉眼驗 :3001 後推)。 **資料線 S0–S6 全完 + 已上線自動運轉 ✅(報價單↔網站整合 Phase 1 收尾)**。Sean 已設對 service_role secret + rpm-sync workflow_dispatch 首跑綠;每天台灣 03:00 自動同步運轉中;action 升 Node24 v6。**下一步**:**OD 商品頁改造線**(並行 workstream、附屬區)續做(OD-F1 可接 S6 plumb 的 fitments[])。正式 codex k1/k2 留 OpenAI quota 恢復(7/2)或 Sean 貼 web Codex 補(S5 本輪走 Claude fallback 對抗審查 2 輪 PASS + code-reviewer PASS)。**description 不在同步 scope**(中文化 backlog #209);<5% 靜默截斷持久基線 backlog #210。整合線 brief/S2/S1 + docs hygiene 已 push(origin/dev=00c1107);S3a/S3b-1/fix/nit + S3b-2-STATUS + S4 + S6 + S5-pre + S5-plan + S5 + STATUS + OD 線待推。proper variantSku cart key〔多供應商前〕/ supplier_slug DEFAULT 移除〔多供應商前〕/ #203/#205/#209/#210 留 backlog;g-7 wallet HOLD #202 不變。

## Sean 待決策
**🆕 M-3 結帳（寫審分離進行中）**：拍板已記 plan §0（Q1=A 完整 M-3 / Q2=A TapPay sandbox / 安全鑰匙=丙 / 經銷價=A 直接搬報價單算好的兩價、premiumStore 暫=store）。**待 Sean 後續**：⓪ **M-3-S2-a migration `supabase db push`**（哨兵獨立 codex/MCP 複驗最終版 PASS 後、Sean 手動 push + db push）+ **S2-b1 運費片：自取 store 是否也收 100**（design 自取免運 vs flat 100 衝突、偏離則 override）；① 階段⓪ 報價單側依賴（我出規格、Sean 橋接另一 session）= bump `STOREFRONT_CATALOG_CONTRACT.md`（釘 price_listing→price_general、price_store→price_store）+ 最小權限唯讀 role/protected view 曝兩價（不含 cost/shopee/PII）+ secret 只給 rpm-sync GHA；三者就緒前階段⓪ 硬 gate 不解、先做階段①。② 階段② 前 TapPay sandbox 金鑰。③ 發票 A3 / premiumStore 再折時機 M-3 中途拍。**前序：**
**🆕 M-3 階段②-② pg 依賴已批 ✅**(2026-06-12 Sean A1=A 條件式批准引入 pg〔node-postgres〕、confirm RPC 直連 payment_confirmer;批准前置 BLOCKER+3MUST-FIX+8SHOULD 已寫進 ②-② plan、②-②a 落實 charge 側、②-②b 落 confirmer 側);**無新待決策**。前序:②-① ✅ 上 prod。
**報價單↔網站整合**:✅ **S5 已上線、資料線無待決策**(Sean 設對 service_role secret + workflow_dispatch 首跑綠、每天 03:00 自動運轉;原誤貼 anon key 已修;action 升 Node24 v6)。~~S5 啟用 / 平台 / S3b-2 sign-off / S3a db push / QUOTE_*~~ ✅ 全已就緒。**前序:**
**⏸ g-7 儲值金 wallet 頁 HOLD**(2026-05-31 Sean 拍:台灣「儲值」踩電子支付/儲值法規邊緣、商業模式未定、**deposit 不做**〔連 mock 不做〕、g-7 推延;WalletTab 維持 stub、別主動排儲值進度、Sean 解 hold 才動;讀路徑技術可行〔g-2 pattern authenticated 直查〕但不接;backlog #202 + memory project_wallet-deposit-taiwan-legal-hold)。**前序:**
**backlog #193 跨 provider identity linking 已拍 ✅**(2026-05-28 Sean g-1 肉眼驗時 + 戳到「3 方法=3 帳號」+ 拍 **C 中庸引導**:LoginPage 引導文案 + Email/Google 註冊 server-side 撞處置 + 不 auto-link);**架構決策依賴已拍 ✅**(2026-05-31 Sean g-6 規劃時拍 **路徑 c = DB unique constraint + helper view**〔view 對 anon 受控 SELECT 只 expose email+provider 兩欄、不需 service_role、最貼 Supabase pattern;需寫 migration + RLS〕;#193 實作為獨立 auth slice〔鐵則 8+12、走 plan + codex 雙關卡〕、技術上不擋 g-6〔愛車只讀寫自己資料、不碰跨 provider identity〕;原「最晚 g-5/g-6 前必修」死線已解);LINE 端非對稱(無 email 不可自動偵測)、補綁走 backlog #179。**另:新增 backlog #200**(我的愛車車款 → products filter 快速帶入、Sean ③.5=A 拍綁 Phase 2 結構化 vehicles、graphify 證 Identity↔Catalog 跨 bounded context 零邊)。**前序:**
**M-1-14e-f2 LINE OAuth 已拍 ✅**(2026-05-25 Sean Q1-Q4):**Q1=A** service_role 受控小門進 storefront〔line-admin.ts、ADR-0005 §8.4 護欄四條:server-only + runtime=nodejs + 受控 eslint-disable + commit 前 grep client bundle〕/ **Q2=A** line_user_id 唯一鍵不併帳〔身分鍵實作改存 app_metadata、codex 關卡2 must-fix:user_metadata 可偽造〕/ **Q3=A** 合成 email 固定常數網域 line.pcmmotorsports.local / **Q4=A** scope 只 openid+profile〔email 可選、不等 LINE email 權限審核〕。**f2 肉眼驗卡 Sean dashboard 前置**:§13 LINE Developers channel 註冊 + Callback URL〔localhost:3000/api/auth/line/callback + 線上〕+ .env.local 3 env vars〔Code 端不驗 .env、Q4=A 稱已就緒〕。**M-1-14e 架構決策 A ✅**(2026-05-24 Sean+陪審:守 boundary use-cases ⊥ schemas、表單驗證在 delivery 層;不改 config / 不改 ADR)。**Q1=A ✅**(註冊後直接登入;**Sean 須在 Supabase 後台關「Confirm email」**;代價 backlog #173)。**f1 已拍 ✅**(2026-05-24 Sean + 陪審 + codex 4 輪):D-a=A 地圖代號維持〔#178 留 M-1-14 收尾對齊〕/ D-b=A composition root 單檔 inline-disable〔不搬 public〕/ D-d=A deposit·vehicle 留 stage g / D-e design 無 Register 社交鈕 / **D-f=A** Header 會員圖示 NAV_ROUTE_MAP.account→/login〔否則 /login 孤兒頁、stage g 補登入態判斷〕/ **D-g=A** email 註冊手機必填〔鐵則 1 design override + 前端必填 affordance;OAuth 會員 phone 可空〔DB DEFAULT ''〕、補 phone 留 g〕。**f1 Sean 端 dashboard 前置〔卡肉眼驗、非卡 infra〕**:① Confirm email OFF〔f1-b 直登〕② §13.1 Google OAuth client〔f1-c〕③ Supabase Auth → URL Configuration → Redirect URLs 含 `http://localhost:3000/auth/callback`〔f1-c 本地;preview/prod 留部署 #4〕。**f1 g-scope follow-up → backlog #179**〔Header 登入態條件路由 / ap-page·ap-mono shared base 抽取 / OAuth 會員補 phone / requireEnv dedup〕。**M-1-14a 決策已清**:(a)✅ rls_auto_enable Sean Q1=A 拍「該做」→ backlog #172(納管補 migration + REVOKE EXECUTE)— **AUDIT-AC-CLOSE-1 確認仍開、Q3=A 拍板維持不急、折入 e-3/M-1-16 下個 migration、不另開專門 slice**;**另:AUDIT-AC-CLOSE-1 發現會員 migration 線上版本時間戳漂移、Q1=B 已 supabase migration repair 對齊回 repo〔詳見 docs/audits/2026-05-24-supabase-db-reconciliation.md〕、地雷解除**;(b)✅ Codex Packet Q2=A 放 docs/reviews、PRD M3 入 repo。(c)✅ `docs/specs/m-1-14-code-execution.md` 已 track(Sean Q=A、M-1-14 一夜跑 runbook 入版控)。 #1 發票自動化 / #3 TapPay sandbox / #4 部署(Vercel+Railway)（premortem 應對 step-2 將為這 3 項設「最晚拍板日」;#2 測試覆蓋率已由 WO-1~3 順手補 smoke test 落地、coverage% 數字仍留 G2/M-6;#149 pcm-line-bot 共用 DB 已 2026-05-19 處置完成;Q-1=B / Q-2=B 已 2026-05-20 拍板「不急、判斷時機追加」、memory project_phase-1-scope-expansion-2026-05-20 已記、M-1-14/15/16 audit 階段 raise;#81 variants schema 已 2026-05-20 M-1-13d Q1=A 推延至 M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節;#130 tier helper 2026-05-20 M-1-13e-pre-1 Sean Q1=B 業務拍板立即抽完成 ✅、13e-a tier prop 傳遞鏈接通 ProductPage / ProductInfo;#82 availability mapper 2026-05-20 M-1-13e-pre-2 Sean Q2=A 拍板執行完成 ✅;#160 ProductInfo 擴張清單(說明書 / 適用車款列表 / 影片 / 圖片)13f Tabs / Phase 2 啟動前 audit;#161 storefront 偏離 design 字面 2026-05-21 M-1-13e-pre-3 起 + M-1-13e-a / 13e-b 延伸(不顯庫存 4 處 disabled / 補貨中字面 / 免運門檻 design L302 NT$ 4,000 + L358 NT$ 3,000 storefront 統一 NT$ 5,000 — **Q1 已 2026-05-21 M-1-13H plan 拍板 NT$5,000 永久(業務拍板、屬鐵則 1 例外、方向反轉 storefront 為準)** / Mobile sticky bar tier 13e-b 已補完整字面對齊 design L527-532、但 mock 路徑 product.price 仍 retail、tier='store'/'premiumStore' 顯「· 經銷」字面 tag 對齊 design 但價格未真經銷化、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)、餘項待 Sean 在 Claude Design 補對齊後 storefront submodule update 同步);**M-1-13H Phase 2 supabase 6 表 LOG**(鐵則 9 先 LOG 對沖落地、HANDOFF L398-401 + Codex review 補列、M-1-16 後接表真區分各 SKU 內容):product_highlights(slice-4 Highlights 3 卡 hardcoded)/ product_spotlights(slice-4 Spotlight 4 段 + 3 stats + hasSpotlight 欄位)/ product_specs(slice-5 specs 8 欄、4 hardcoded)/ product_installs(slice-5 install 4 steps + meta hardcoded)/ site_services(slice-3 服務承諾 4 條 hardcoded)/ site_policies(slice-5 warranty 3 段 hardcoded、與 site_services 分開因語義不同:服務承諾 vs 退換貨/保固政策)

## Blocker
**M-3 階段⓪（經銷價同步 / 店家價 checkout）硬 gate 待報價單側三件就緒**（合約 bump v2 + protected dealer view + least-privilege 憑證；**非硬 blocker** — 階段①〔訂單地基〕先行、不卡 M-3-S2 migration）。**前序：**
**M-3 階段②-② 前置 ✅ 就緒**(TapPay sandbox 金鑰 Partner Key/Merchant/APP_ID/APP_KEY + payment_confirmer 密碼/PAYMENT_CONFIRMER_DB_URL 已設 .env.local;非 blocker)。⚠️ **②-③ 真連線前 Sean 須確認 `PAYMENT_CONFIRMER_DB_URL` = 直連 5432**(`db.<ref>.supabase.co:5432`、**非 6543 pooler**;pooler 呼 SECURITY DEFINER 已證必斷、SHOULD ①)。
**資料線 S0–S6 全完 ✅**(S3b-2 上線 §8.5 PASS + MCP 全綠;S4 下架對賬交易模擬驗 scope/零留痕;S6 fitments + vitest 508;S5 排程實作 W1 維度 BLOCKER 經 fallback 對抗審 2 輪修正 PASS + code-reviewer PASS、三綠 + W1 實測)。無硬 blocker。**S5 啟用待 Sean dashboard**(設 4 secret + workflow_dispatch 驗、非 Code 端、見 plan §10);正式 codex k1/k2 留 OpenAI quota 恢復(7/2)或 web Codex 補。
## 緊急 backlog
無

---

## OD 商品頁改造線(並行 workstream、Claude-Code 自驅、不入主表)

> 與報價單資料線(S3a/S3b)並行的另一條線。**主表 7 欄由報價單線擁有**、OD 線狀態記此附屬區 + manifest `od_redesign`(Sean 2026-06-02 拍 A)。寫審分離 ROLE=A(施工 session 實作、審查 session 哨兵盯 dev 自動 fresh-context 複驗)、**不跑 busboy-end**(避 clobber 報價單線)、Sean 手動推。

- **視覺真權威:** OD 模板 `product-detail-rpm-template.html`(open-design "Website V2")+ `HANDOFF-rpm-template.md`。鎖定決策見 manifest `od_redesign.decisions`(決定一=A OD=視覺真權威 / D1=A 適用車款表全車種 3 欄無車系 / D3=A 12K 收進紋路無消光、由真資料 disable / Q1 override:N°03 留相關商品 + FAQ→N°04)。
- **當前 slice:** **Phase A 完成 ✅ + 已合併進 dev(merge cf630b2)**。OD-5 服務橫條 / OD-6 N°01 / OD-7 N°02 紋路牆+預覽卡+圖庫聚合 / OD-8 分頁碳纖維化 / OD-9 N°03 相關商品 / OD-10 N°04 FAQ+JSON-LD(保固共用 rpm-policies 單一真相)/ OD-11 buybar OD §12+響應式≤1079,共 11 片(OD-5~11)+ 先前 OD-1~4 全完。合併後三綠 + 完整 pnpm test 531 全綠,OD 元件 × S6 fitments 共存確認。
- **下一步:** **OD-12 適用車款表(post-merge、接 S6 plumb 的 fitments[])** —— 真 3 欄(車廠/車型/年式、D1=A、非 OD 模板 4 欄含車系);mock 只有單一 fits 字串、故等合併取 S6 真資料才做(Sean 2026-06-03 拍 A)。Sean 肉眼驗 :3001 後推 OD 線。
- **Phase A 連續做(Sean 拍 B):** OD-3~OD-11 全速連續 commit、Sean Phase A 全完肉眼驗一次、哨兵每片自動審 FAIL 即通知。
- **分片清單:** Phase A(現做、不等 S3)OD-1→OD-11(地基/Hero/右欄/Picker+預覽/服務橫條/N°01/N°02紋路牆/分頁/N°03相關/N°04 FAQ/buybar+響應式);Phase B(等 S3b)OD-F1 適用車款表(接 fitments[])/ OD-F2 真資料收口。完整 OD區塊↔元件對照 + 計畫見對話 OD-0 偵察報告(待 Sean 點頭存 docs/specs/)。
- **⚠️ 跨線紀律:** OD 線不碰 `scripts/rpm-*.ts`(報價單線 WIP)、`docs/reviews/integration-phase1-review-log.md`(審查 session)、`docs/specs/*S3*`(報價單線)。

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
