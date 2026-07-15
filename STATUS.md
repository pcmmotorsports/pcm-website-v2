# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史.

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4a 後台第一期**(訂單+客戶+SSO;admin.pcmmotorsports.com LIVE)進行中。前一主線 **M-3 結帳 3DS 重設計整線 ✅ 全落地**(Phase I 0a-4d 對帳脊椎/sweeper/cron + Phase II 5a/5b/6 charge-redirect 已 merge dev、逐 commit 審查 PASS;flag 全 false、🔴 prod checkout 仍不可開=真刷卡待 sandbox 3DS E2E + Sean 驗收;原文見 PROGRESS.md「2026-07-16 STATUS.md 瘦身歸檔」)。
**當前 slice(2026-07-16 Day-2):** 🔴 M-4a D-2 per-item 訂單狀態(最高風險硬閘片;Sean Q-A=A)= order_items +workflow_status/version/updated_at+backfill 繼承(`20260716120000`)+ `admin_update_order_item_workflow` owner RPC 鏡像 Slice C 單鍵白名單+同交易 audit target=order_item:{id}(`20260716130000`;§4 同檔**收窄 Slice C RPC**=workflow_status 移出白名單送到即 RAISE=停寫升 DB 強制、Fable REQUIRED-2)+ admin UI 全切 item 層(列表逐列改狀態+整單彙總 badge 全同→該色/混合→多狀態、明細品項表逐列改、訂單編輯表單移除狀態下拉、篩選改打 order_items.workflow_status+!inner、「商品狀態」標籤)。審查鏈:真 DB 交易模擬 ×3 PASS 零留痕+code-reviewer PASS+Codex 盲審 R1 FAIL→修→R2 PASS+Fable 對抗審 R1 FAIL(MF-1 全鏈關死+ACL aclexplode allowlist+5 nit)→全修→R2(見 verdict)。🔴 **部署順序硬規:先 db push 兩支(120000→130000)→ 驗 → 才 git push**(反向=新投影選不存在欄、後台整頁炸)。**未 push、未 apply。**
**Branch:** dev

## 最後更新
2026-07-16 — Claude Fable session(**🔴 M-4a D-2 per-item 訂單狀態=Day-2 硬閘片完工**:兩 migration(order_items 3 新欄+backfill 繼承;item owner RPC+收窄 Slice C RPC 停寫升 DB 強制)+TS/UI 全切 item 層(domain/ports/adapter 兩投影白名單+!inner 篩選版/mapper/database.types 手加/列表 ItemWorkflowStatusCell+彙總 badge/明細逐列改/order-edit-form 移除狀態下拉/order 層 workflow 寫入路徑 TS 三層關死)。審查鏈=交易模擬 ×3 PASS 零留痕+code-reviewer R1 PASS+Codex R1 FAIL〔停寫僅 UI 約定〕→修→R2 PASS+Fable 對抗審 R1 FAIL〔MF-1 全鏈+REQUIRED-2 aclexplode allowlist+n1-n5〕→全修→R2。三綠+full vitest 194 檔 2079+build admin/storefront。🔴 部署順序=**先 db push(120000→130000)後 git push**;PostgREST !inner 實際過濾行為=Sean 開站驗收點;picker actor 自報身分殘餘(M0-S2 已拍接受)重申。未 push、未 apply)
2026-07-14 — Claude Fable session(**🎨 M-4a 訂單工作流 Slice A=彩色訂單狀態(Sean Sheet 心智模型搬進後台)、唯讀片完工**:①draft migration `20260714120000`〔新表 `order_status_options` seed Sean 9 狀態逐字+顏色、client 全鎖+service_role UPDATE 收窄 column-level 凍結 code/created_at;orders 加 `workflow_status`+發票紀錄三欄 `invoice_number/amount/status`;既有 30 筆按 §6.1 2×4 矩陣 backfill=24 未收未定+6 已收未定;**交易模擬 PASS ×2+零留痕、Fable 值班台 R1 FAIL 3 must-fix→修→R2 PASS**;🔴 **未 apply、等 Sean db push**〕②admin `/orders` 主欄改 workflow_status 彩色 badge〔NULL=「未設定」中性灰、未知 code 兜底〕+訂單狀態下拉篩選〔含「未設定」;動態選項來自 DB〕、舊雙軸降次要 muted 合欄;新 port `IOrderStatusOptionsRepository`+adapter〔白名單 byte-equal 守門〕;會員側 ORDER_LIST_SELECT/placeOrder/金流路徑**零改**〔code-reviewer R1 PASS 0 must-fix〕。三綠+full vitest 2023+/orders dev 實測 200〔修掉 allSettled 同步 throw 500 bug〕。🔴 偏離設計檔並經 Fable 核可:不加 shipping_method〔prod 實查該欄 20260604 起即存在〕;發票三欄=開票**紀錄**、與既有 invoice jsonb=開票**需求**語意分離。設計真權威=`docs/specs/2026-07-13-m4a-order-workflow-status-design.md`;Slice B 明細頁/C 寫入/D 設定 UI 接續)
2026-07-13 — Claude Code session(**🚀 M-4a 後台部署上線 = M-4a 硬卡點徹底解除**:Sean dashboard 建 Vercel project `pcm-admin`〔Root Directory=`apps/admin` 避 repo root storefront crons/金流 env、**Production Branch=dev**〔用 main 需 merge dev→main 會連帶推 storefront 待上線改動〕〕+ Fable 驗證〔冷 build READY/production、5 env 逐字核源碼、查報價單域名 `quote.pcmmotorsports.com`=`PCM_QUOTE_SSO_BASE`、備 `f1e617e` vercel.json region sin1〕。網域 `admin.pcmmotorsports.com` LIVE〔DNS 託管 Vercel 自動設 CNAME〕。**SSO 端到端 prod 驗收 ✅**〔runtime log `{evt:sso.login,outcome:success,source_app:quote,amr:pwd}`=高風險件#1 全鏈上線〕、登入閘實測未登入 curl `/orders`→`303 /api/sso/start`〔Fable 先誤報公開外洩→讀 proxy.ts+curl 實測當場更正=字面 vs 事實〕。🔴 踩坑=初次只設 `NEXT_PUBLIC_SUPABASE_URL` 漏 `SUPABASE_SERVICE_ROLE_KEY`→ /orders /customers loadFailed、Vercel error log 精準定位 `SUPABASE_SERVICE_ROLE_KEY not set`→Sean 補 key〔同 storefront 值〕+redeploy→**訂單約 30 筆+客戶真實資料顯示 ✅ Sean「看到訂單了」**〔訂單列表+客戶列表真實資料驗收過〕。剩 sin1 push〔`f1e617e` 未推、現 region iad1〕。詳見 memory `project_m4a-admin-phase1-decisions`)

## 最近 3 commit
> dev。C 本 commit 的內容見「最新 slice／最後更新」；下表只列 3 個已可達前序 commit，避免同一 commit 自指 hash 在 amend 後失真。🚀 origin/main = `e8a3c15` production。
| Hash | 訊息 | 時間 |
|---|---|---|
| `eca83bd` | feat(admin): M-4a D-2 訂單狀態切 per-item(item RPC+停寫升 DB 強制) [m-4a] | 2026-07-16 |
| `577cbbe` | feat(admin): M-4a D-3c 訂單狀態選項設定頁新增選項(D-3 CRUD 全備) [m-4a] | 2026-07-16 |
| `66b8a44` | feat(admin): 狀態選項更新寫 admin_audit_log 稽核(D-3b) [m-4a] | 2026-07-16 |

## 下一步
**🔴 M-4a D-2 上線(2026-07-16;硬順序)**:①Sean **先 db push**(`20260716120000`→`20260716130000` 同批;push 前 `supabase migration list` 核 pending 清單)→ ②驗(order_items 3 新欄+40 item 繼承狀態+收窄版 RPC 送 workflow_status 應拒)→ ③**才 git push dev**(自動部署 admin;反向=列表選不存在欄整頁炸)→ ④開 admin /orders 玩 per-item 狀態+驗「商品狀態」篩選(PostgREST !inner 只顯命中品項列=開站驗收點)。續行=V-1 VehicleSelect(三痛點)→ V-2 → 小件穿插(Q2 日期欄/Q3d 佔位圖/Q3a 三佔位頁/W 批次)→ Q3e → V-3(硬閘)→ Q3b/Q3c plan only;D-1b 等 Sean 從 demo 回字母。
**🎨 M-4a 訂單工作流(07-14、Slice A 唯讀片已 commit)**:①Sean `db push` 套 `20260714120000`(workflow_status+order_status_options+發票三欄;🔴 push 前 `supabase migration list` 核 pending 清單、勿誤夾其他線未收尾支)→ ②Sean push dev(自動部署 admin)→ ③開 admin.pcmmotorsports.com/orders 看彩色狀態雛形(24 筆 #249 孤兒單會顯示亮黃「未收未定」=對映正確、多為棄單勿誤讀為待追款;顏色 hex/對映不合意回饋即改)。實作續行=Slice B 明細頁(客戶 PII+品項+出貨+發票,唯讀)→ Slice C 寫入路徑(狀態下拉可改;高風險、Fable 審過才 commit)→ Slice D 狀態自訂 UI。
**🆕 P4+S4 已收整+驗證+雙審 PASS(2026-07-12 之三)→ 下一步 = Sean 操作**:①**依序 apply 兩支 migration 到 prod A庫 `bmpnplmnldofgaohnaok`**——先 `20260712183000`(建 view+RPC+facet)、再 `20260712193000`(RPC 加 fitments);**少 183000 則 193000 建失敗**(讀其 `products_list_public` view)。②apply 後**驗 anon 對 `product_fitments_effective` 有 SELECT**(否則 /products 每請求降級「載入失敗」=R1;有 PDP live 反證、極可能已在)。③push dev→main 部署 → 肉眼驗:同名不同年卡片可區分年份、多款「N 款車型」、手機/桌機卡片等高、換頁/篩選/返回、MT-09 SP 2021。**①②✅ 已完成(Sean db push 兩支上 prod、唯讀驗證全綠);③正式部署 Sean 選 B 暫緩**——dev→main FF 會連帶推別 session M-4a 混批(見 Blocker),先 preview 肉眼驗 + 對齊 M-4a 再一起上。真權威 `docs/specs/2026-07-12-search-vehicle-work-plan.md` §5。
**🆕 S1 變體補足 ✅ 收工(2026-07-12 之二)→ 搜尋線續行**:S1 全驗收過(RPC/網站 124、Y016 命中、原始 fitments 未動、車款篩選走 DB)。續行順序=**S4 目錄卡片年份 ✅ 已收尾+雙審 PASS(待 Sean apply 兩支 migration+部署)** ∥ S2 lightech 上架(#275、吃 S1 展開合約)→ S3 搜尋引擎 MVP(真權威 `docs/specs/2026-07-12-search-vehicle-work-plan.md`);另 #277(車輛下拉只讀 direct、純 inherited 子款選不到)排隊。

## Sean 待決策
**🆕 P4+S4 商品目錄（2026-07-12 之三)**:實作+雙審 PASS(code-reviewer + Fable),**無架構待決策**;剩 Sean 操作項(依序 apply 兩支 migration→驗 anon grant→部署→肉眼驗,見「下一步」)。**一個業務取捨待你拍(非阻擋)**:車款搜尋命中「繼承件」時,卡片年份目前只顯該商品 direct fitments(可能顯母款年段,與既有 `fits` 字串同語意、非回歸;PDP 兩層已補),要不要卡片也併 inherited 年份=R3、日後另議。

## Blocker
**🟡 /products P4 preview gate**:①RPC timeout 已 apply＋驗（generic plan **231.7ms**、anon HTTP **0.38–0.88s**)②**目錄整頁 0 筆回歸已修**（`priceMax=0`,見「最新 slice 之五」;本地 dev 復現＋修＋三綠＋1045 測綠、**未 push**)。待 Sean 推 dev 生新 preview 肉眼驗 `/products` 有商品後,才依 M-4a 混批決策考慮 dev→main。次要:FF 另帶 M-4a 11 commit 需 Sean 對齊。
**🔴 0072 雙扣待 Sean W1 退款**:A1 popup 模型真機實證雙扣(PCM-2026-0072 舊 + 0073 新、各 17,300)→ R1b1c anomaly genesis + W1 報表已偵測為 open anomaly → Sean 依 W1 runbook(claim → TapPay Dashboard 退舊 rec → resolve)退 0072。pivot 整頁後此向量結構性消滅(殘餘靠偵測 + P3 in-flight 防呆);非程式 blocker。
**M-3 階段⓪（經銷價同步 / 店家價 checkout）硬 gate 待報價單側三件就緒**（合約 bump v2 + protected dealer view + least-privilege 憑證；**非硬 blocker** — 階段①〔訂單地基〕先行、不卡 M-3-S2 migration）。**前序：**

## 緊急 backlog
無

---

## OD 商品頁改造線(並行 workstream、Claude-Code 自驅、不入主表)

> 與報價單資料線(S3a/S3b)並行的另一條線。**主表 7 欄由報價單線擁有**、OD 線狀態記此附屬區 + manifest `od_redesign`(Sean 2026-06-02 拍 A)。寫審分離 ROLE=A(施工 session 實作、審查 session 哨兵盯 dev 自動 fresh-context 複驗)、**不跑 busboy-end**(避 clobber 報價單線)、Sean 手動推。

- **視覺真權威:** OD 模板 `product-detail-rpm-template.html`(open-design "Website V2")+ `HANDOFF-rpm-template.md`。鎖定決策見 manifest `od_redesign.decisions`(決定一=A OD=視覺真權威 / D1=A 適用車款表全車種 3 欄無車系 / D3=A 12K 收進紋路無消光、由真資料 disable / Q1 override:N°03 留相關商品 + FAQ→N°04)。
- **當前 slice:** **Phase A 完成 ✅ + 已合併進 dev(merge cf630b2)**。OD-5 服務橫條 / OD-6 N°01 / OD-7 N°02 紋路牆+預覽卡+圖庫聚合 / OD-8 分頁碳纖維化 / OD-9 N°03 相關商品 / OD-10 N°04 FAQ+JSON-LD(保固共用 rpm-policies 單一真相)/ OD-11 buybar OD §12+響應式≤1079,共 11 片(OD-5~11)+ 先前 OD-1~4 全完。合併後三綠 + 完整 pnpm test 531 全綠,OD 元件 × S6 fitments 共存確認。
- **下一步:** ✅ **OD 線已收尾**(2026-06-16 查核更新):OD-12 適用車款表 + OD-12b/c/d 桌機重設計 + OD-13 FAQ + OD-V~V3b 手機/iPad 真機驗收修正**全部完成、併入 dev、已推 origin/dev**(`dev..od-redesign` 空、od-redesign tip `266f5f2` 在 origin/dev、審查 PASS `9cc5bbd` + 交接 `f3d6a42`)。此附屬區先前「OD-12 待做」字面為過時殘留、已更正。後續 OD 強化由 Sean 主導視覺(memory sean-owns-visual-design)。
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
