# SESSION HANDOFF — 2026-06-15 M-3 3DS-4a-2 attempt sweeper RPC(執行側、寫審分離 ROLE=A)

> 一句話結果:**3DS-4a-2 attempt sweeper migration 完成並全推 origin/dev**(MCP 模擬 + 三綠 + code-reviewer + codex 關卡2 + Ultracode 6-lens 對抗複驗 全 PASS、0 must-fix)+ 2 副任務(iOS 16px 卡欄 / Gemini 結帳廣度落 backlog)。**全程 5 commit 全 push、無待推、未 db push。** ⚠️ graphify 地圖**未刷**(增量 build_merge re-pollute、見 §4)。
> 環境:repo `/Users/sean_1/pcm-website-v2` · Supabase `bmpnplmnldofgaohnaok`(website DB)· branch `dev` · mode=engineering。HEAD=`a2dc05e`、origin/dev=`a2dc05e`(同步、ahead-by 0)。
> 接手先讀:本檔 + `docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md`(§5.2 = 4b 規格、§5.1b = 4a 已成)+ master plan v5 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §2/§9 + STATUS.md + 記憶 `3ds-db-push-bundle-blocked-until-cart-session-integration`。審查側 log:`docs/reviews/m3-3ds-review-log.md`(刻意未 commit)。

## 1. 做了什麼(按時序)

- **3DS-4a-2 attempt sweeper migration**(`1d82623`、主任務)— `supabase/migrations/20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql`。`payment_charge_attempts` ALTER 加 4 欄(`settle_attempt_count`/`next_settle_at`/`needs_manual_review`/`last_settle_error` 零 PII)+ 4 窄權 SECDEF RPC(payment_confirmer):`claim_stuck_unsettled_attempts`(原子 lease FOR UPDATE OF a SKIP LOCKED + token + ceiling + age-gate + charged-unpaid 群1)/ `expire_stuck_attempts_at_ceiling`(防孤兒 + lease 條件)/ `flag_non_unpaid_active_attempts`(refunded/partiallyPaid→manual 群2)/ `mark_attempt_settle_retry`(token+manual guard 對齊 4a-1 codex K2 r1、退避 2^(count-1) 封頂 16、達 ceiling→manual、不 ++)。對稱已簽核 4a-1 inbox 版。
  - **2 處對 plan §5.1b 字面精化(檔頭誠實揭示)**:〔A〕第 4 欄 `last_settle_error`(plan §5.1b L79「+ last reason_code」+ p_reason_code 需 durable 落點 + 鏡像 inbox `last_error`);〔B〕`expirer`/`mark` 的 manual 寫路徑加 `o.payment_status='unpaid'` 閘(防平行結清的已付款單在 ceiling 後誤標 manual)。+ 2 安全補強〔C〕`FOR UPDATE OF a`〔D〕age-gate fail-closed。
- **iOS 16px 卡欄字級**(`2d29294`、副任務)— `useTapPayCard.tsx` `card.setup` 加 `styles:{input:{font-size:16px}}` 防 iOS Safari 點卡欄自動放大(年長友善);test ③ 加 16px regression 斷言;manifest CheckoutPage 同步(last_modified_commit/date + 新 override `checkoutCardFieldFontSize16`)。來源=Gemini 廣度 + 審查側 review-log §3 #1。
- **Gemini 結帳廣度 #2-5/#7-8 落 backlog**(`b9f04e2`、副任務)— backlog #232(LINE webview×3DS)/ #233(客服 email 撈 orphan)/ #234(前端付款遙測)/ #235(退換貨+客服 LINE)/ #236(店取 O2O)/ #237(SDK 預載),皆 Phase II `P2-later`。#6 付款方式廣度已 #226 LINE Pay/#228 Apple Pay、**分期不做**(`installment-not-doing`)。
- **對抗複驗收尾 + Sean 拍 A**(`a2dc05e`)— Ultracode 6-lens 對抗 workflow `wbpvvr5b7` 複驗 4a-2(concurrency/privilege/completeness/refinement/math/conformance、逐 finding 反駁 + completeness critic)= **PASS-WITH-NITS、0 confirmed must-fix**;2 nit downgrade(refunded/partiallyPaid+ceiling 唯一靠 flag〔4b 每輪呼〕/ paid+pending 覆蓋盲區、皆 benign 且與 4a-1 對稱)。**結論型決策(Sean 拍板)**:殘餘窄 TOCTOU(已付款單並發結清致誤標 `needs_manual_review`、cosmetic 無雙扣/金錢/安全)= **拍 A 留現狀、Phase II 後台 UI 順手清、非 4b**(記 #231 ⑤);plan §5.2③ 強化 flag 必呼不變式 + #231 ⑥ ACL-assert benign nit forward-note;**migration 0 改、不 amend**。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | push |
|---|---|---|
| `a2dc05e` | docs(specs): 3DS-4a-2 對抗複驗收尾 + Sean 拍 A 殘餘處置 | **已推** origin/dev tip |
| `b9f04e2` | docs(backlog): Gemini 結帳廣度 #2-5/#7-8 落 Phase II backlog | 已推 |
| `2d29294` | fix(storefront): TapPay 卡欄釘 16px 防 iOS 自動放大 | 已推 |
| `1d82623` | feat(schemas): 建 3DS-4a-2 attempt sweeper 退避/上限/轉人工 RPC | 已推 |
| `9bfbde9` | feat(schemas): 建 3DS-4a-1 sweeper inbox claim/mark RPC + 3DS-4 plan | 已推(上 session 產、本 session 推) |
> **全 5 commit 已 push、origin/dev=a2dc05e、ahead-by 0、無待推。** 多 session 共用同工作樹 → 接手先 `git fetch`。審查側檔 `docs/reviews/m3-3ds-review-log.md` + review 側 handoff 刻意未 commit(避 git index 撞執行側)。

## 3. DB / 部署 / 外部足跡(非 git)

- **migration `20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql`(4a-2)= 已 commit+push git、未 apply prod**。入 db push bundle 最末:`0a→0b→0c→1b→#214a→4a-1→4a-2`(時戳 20260615120001 嚴格最末、checkpoint `ls supabase/migrations|sort|tail` 已驗)。
- 🔴 **整包 bundle 受 `cart_session_id` 整合阻擋**(記憶 `3ds-db-push-bundle-blocked-until-cart-session-integration`)→ **不可 `supabase db push`**(0b DROP 4p create_order、部署中 adapter 仍 4p → db push 會弄壞 prod 結帳)。cart_session_id 整合(Phase II 3DS-5b/7)後 Sean 才手動 db push。
- 本 session DB 動作 = **僅 MCP 唯讀交易模擬**(BEGIN + s2d replica + 4a-2 DDL + 行為斷言 + ROLLBACK、零留痕):Call A(DDL + has_function_privilege 矩陣 + role-hygiene assert)+ Call B(claim 原子/token/lease/charged-unpaid/age-gate fail-closed、expirer ceiling+lease+paid-不誤標、flag refunded/partiallyPaid、mark token/stale/manual-guard/ceiling→manual/reason-allowlist/paid-noop 共 5 test)全 PASS;residue 驗證 new_cols/funcs/rows=0、payment_confirmer 全域 tbl/col grants=0。**SET ROLE payment_confirmer literal 受 pooled MCP 斷線限制 → has_function_privilege + owner-run 等價、真連線交 3DS-4c route**。0 寫入、0 apply。
- 部署:無。

## 4. graphify 地圖增量

- ⚠️ **本 session 動了 code(`useTapPayCard.tsx` + 2 個新 migration)但地圖刻意未刷 — blocker**:嘗試 `--update` 增量,`build_merge` 把乾淨圖 **2521→3000 nodes(+479)/ 125 fuzzy dedup**,= 與上次清理(3006→2499)同型的重複孤兒污染。**已 `mv .graphify_old.json graph.json` 還原乾淨基線 `2521 nodes / 3607 edges / 253 communities`、清臨時檔、GRAPH_REPORT.md 未動。無污染殘留。**
- **根因**:既有圖用 **全路徑檔層 node id**(如 `apps_storefront_src_hooks_usetappaycard_test_tsx`),fresh AST 抽取用不同慣例 → `build_merge` 配不上 → 加成近似重複而非就地更新(觸發 fuzzy-dedup)。**`.sql` 完全不 AST-extract**(graphify 無 SQL symbol grammar、AST 0 個 .sql node);既有 23 個 .sql node + 923 個 .md node 是**舊 semantic 殘留**(非本次 deterministic 範圍)。
- 🔴 **連帶發現**:**background post-commit graphify hook 也在慢慢 re-pollute**(基線已從清理後的 2499 漂到 2521 = +22,疑 hook 每 commit 跑同款 build_merge 增量)。
- **未動的真實影響極小**:iOS `.tsx` 改的是 `card.setup` 內參數值(font-size)、不新增 symbol;`.sql` migration 本就不 AST-extract。故乾淨圖只「略 stale」、非缺重要結構。
- 🔴 **待 Sean 決策(§5 開放項)**:graphify 維護策略(留乾淨略 stale / 全 deterministic 重建〔Sean 本輪說「不要全建」〕/ 修 hook+慣例)。

## 5. 開放項(待辦)

- 🔴 **graphify 維護策略 decision(需 Sean 拍板)** — 增量 `--update` 與 background post-commit hook 都會 re-pollute(慣例不對齊)。選項:A=留乾淨略-stale 圖 + **停掉/修 post-commit hook**(防續漂)‖ B=一次性全 deterministic 重建(`/graphify .`、本輪 Sean 暫不要)‖ C=修 graphify node-id 慣例後再增量。建議先 A(至少 `graphify hook status`/uninstall 評估,擋續漂)。
- ⏳ **下一片 = 3DS-4b-1**(執行側、純 code、plan §5.2)— port 擴 + Pg*Adapter:`IWebhookInbox` 加 claimDueEvents/markProcessed/markRetry;`IChargeAttemptStore` 加 `claimStuckUnsettled`/`markSettleRetry`/`flagNonUnpaidActive`;Pg*Adapter 實作(payment_confirmer 同鑰、複用 buildPgConfig)+ adapter 單元測。純 code、不碰 db push bundle。
- 🔴 **4b 不變式硬約束(plan §5.2③、4a-2 對抗複驗釘死)** — `sweepSettlements` use-case **每輪必無條件呼叫** `expire_stuck_attempts_at_ceiling()`(claim 前置、防孤兒)+ `flag_non_unpaid_active_attempts()`(refunded/partiallyPaid+ceiling 殘留 attempt 的**唯一回收路徑**;漏呼=該格永久殘留)。**必補測**「refunded/partiallyPaid + active → flagged」(plan §5.1b L78)+「charged-unpaid 被 markCharged no-op→confirm 補→paid 收斂」+ token guard stale/manual no-op。
- 🔴 **db push bundle 阻擋**(carry-over)— `cart_session_id` TS 整合(Phase II 3DS-5b/7)前不可 `supabase db push`;Sean 手動。
- ⏳ **#231 prod 前置**(carry-over)— `TAPPAY_3DS_ENABLED` flag-on 前必 land:Q4-B 跨路徑 skip / 告警 channel / heartbeat / 轉人工流程 + ⑤ 殘餘 TOCTOU Phase II 後台清 + ⑥ ACL-assert benign nit。
- ⏳ **後續 4c/4d**(carry-over)— 4c cron route(GET + requireCronSecret + CRON_SWEEPER_ENABLED gate、純 code)→ 4d vercel.json crons 啟用(鐵則 8、前置:prod CRON_SECRET 驗 + 4a 進 prod + flag 決策)。

## 6. push 狀態與收尾自檢(接手第一眼)

- **push 狀態**:local `dev=a2dc05e` = `origin/dev=a2dc05e`(同步、ahead-by 0)、**全推、無待推、不需再 push**。
- 收尾自檢:git status 乾淨(僅 untracked `.playwright-mcp/` + 審查側 `docs/reviews/m3-3ds-review-log.md` + 審查側 handoff〔皆刻意未 commit〕+ 本執行側 handoff 檔);secret 0 洩漏(全程 migration=DDL 無 secret、useTapPayCard 走 env 無 literal key、handoff 全文無連線字串);DB 足跡 §3 齊;**graphify §4 = 未刷 + blocker 已記、乾淨圖還原無污染**;驗證留痕:MCP 模擬零留痕 + 三綠(typecheck/lint FULL TURBO、4a-2 build N/A 純 .sql、iOS build PASS)+ full vitest 1002 + code-reviewer(4a-2 PASS / iOS r1 FAIL→修→r2 PASS)+ codex 關卡2 PASS + 6-lens 對抗 workflow PASS。
- **下個 session 進入點**:① 起手三綠(branch=dev / 樹乾淨 / HEAD=a2dc05e 對 STATUS)② 讀 plan §5.2(4b 規格)+ 本檔 §5 不變式 ③ 寫 3DS-4b-1(port+adapter 純 code);審查側重 arm 哨兵接 4b commit。⚠️ graphify 動 code 前先解 §5 decision(別讓增量/hook 續污染)。

## 相關 plan / 記憶 / 文件
- `docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md`(§5.1b 4a 已成 / §5.2 4b 規格 / Q1-Q5)
- `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §2/§9(真權威 + prod 前置硬 gate)
- `docs/reviews/m3-3ds-review-log.md`(審查側 log、全脈絡 §3)
- backlog `docs/phase-1-backlog.md` #231(3DS-4 prod 前置、⑤⑥)/ #232-#237(Gemini Phase II)/ #226·#228(LINE Pay/Apple Pay)
- 記憶:`3ds-db-push-bundle-blocked-until-cart-session-integration`、`supabase-service-role-execute-default-grant`、`pooled-mcp-set-role-secdef-terminates`、`supabase-rls-schema-test-txn-simulation`、`adversarial-timeline-self-review-before-codex`、`sentinel-auto-review-pipeline`、`execution-review-session-split`、`github-branch-rulesets`、`installment-not-doing`、`gemini-breadth-third-eye`、`reference_graphify_codebase_map`
