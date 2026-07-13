# M-4a 訂單管理 — Fable 值班審查台 交接(2026-07-13)

> 給接手的 **Fable 審查視窗**(前一對話過長、換新視窗續值班)。你 = 值班審查台:**唯讀對抗審**實作視窗丟來的高風險件,**不下場實作、不 push、不 apply、不 deploy**。與 PCM 鐵則/Sean 拍板衝突以後者為準。

## 現況(一句話)
M-4a 後台已部署上線(`admin.pcmmotorsports.com`、SSO 端到端通、訂單/客戶列表真資料在跑、**dev push 自動部署正式站**)。實作視窗正在建「**訂單管理**」= 讓 Sean 用他習慣的「收款×訂定×貨況合併彩色狀態」操作訂單、可自己設定 + 訂單明細看客戶/出貨/發票。你負責審其中高風險件。

## 真權威 / 必讀
- **設計**:`docs/specs/2026-07-13-m4a-order-workflow-status-design.md`(資料模型/seed 9 狀態/金流護欄/Slice A-D/PII 白名單)。
- **PRD**:`docs/specs/2026-07-12-m4a-admin-phase1-prd.md` §4-6。
- **決策/進度/踩坑史**:memory `project_m4a-admin-phase1-decisions`。
- **審查工作守則**:`~/.claude/rules/00-work-rules.md`(§1 調度 §2 rubrics §5 findings 分堆與輪次)。
- **既有審查史(對映本次)**:`pcm-tools/review-inbox/m4a-m0s3-sso-receiver-{plan,diff}.verdict.md`(SSO 高風險件雙審、CSRF/Origin/fail-closed 教訓)、`m4a-admin-audit-log-migration.verdict.md`(稽核表 append-only 審)。

## 你審什麼(實作視窗會分片丟單 `pcm-tools/review-inbox/m4a-order-workflow-status-*.md`)
1. **Slice A migration(schema)**:orders 加 workflow_status + shipping_method + invoice_number/amount/status;建 order_status_options 表 + seed 9 狀態。審點:
   - 交易模擬零留痕(BEGIN→DDL→斷言→ROLLBACK,MCP execute_sql;跑後驗 leftover=0)。
   - 🔴 **經銷隔離**:新欄無成本/經銷價語意;若動投影白名單,新欄加白名單、仍禁 `select('*')`、零成本欄。
   - ACL/RLS 對齊 sibling(order_status_options 讀寫=admin service_role;參 audit_log 的 fail-closed DO 斷言範式)。
   - CHECK/預設值/nullable 合理;backfill(若有)fail-closed、不 abort 既有資料。
   - 字面 vs 事實:**migration 檔頭若寫「未 apply/PENDING」多為過時註解**——orders 6 舊欄(order_source/payment_channel/cancelled_at/cancelled_reason/version/display_position)**已在 prod**(訂單列表已用=live 反證),以 MCP list_migrations/實查為準、勿信檔頭。
2. **Slice B 訂單明細頁(PII)**:`/orders/[id]` 顯示客戶姓名/電話/**地址**。審點:
   - 🔴 另立 `ADMIN_ORDER_DETAIL_SELECT` 具名白名單=**含 address/phone(PII、admin-only 合理)但仍零成本/經銷價/tappay token/tier_at_checkout**;byte-equal + forbidden-token 測試上鎖(比照 ADMIN_ORDER_LIST_SELECT 先例)。
   - 地址 PII 走 service_role、不進 client bundle、不外洩一般會員路徑。
3. **Slice C 寫入路徑(🔴 最高風險、後台第一個寫入)**:設 workflow_status/shipping/invoice 的 server action/route。審點(refute-first 逐條):
   - 🔴 **金流不干涉**:workflow_status **絕不寫/驅動 payment_status、對帳、退款、雙扣告警**;線上單 payment_status 不被覆蓋。親讀寫入 SQL 確認只動 workflow/shipping/invoice 欄。
   - **稽核**:recordAdminAudit before/after **與主變更同交易內/之前**組 context 寫稽核(否則主變更已提交、audit 缺筆=稽核缺口);actor 來源(M0-S2 picker cookie / SSO amr)。
   - **樂觀鎖**:`WHERE version=$expected` + `version+1`;衝突回 409 由 UI 重載(非靜默覆蓋=lost update)。
   - **Origin/CSRF**:裸 route handler POST **不吃** Next 16 內建 Server Action CSRF(內建只擋 Server Action);quote.*→admin.* 是 **same-site**、Lax cookie 擋不住 → 必自驗 Origin allowlist。(SSO 審已立此 note:M0-S3 diff verdict。)
   - **fail-closed**:未登入/actor 缺/version 缺/Origin 不符 → 拒;DB error 不外洩。
   - 修法含 disable/skip/繞過驗證/改測試期望值 → 這是換路訊號、raise Sean。

## 硬護欄(實作違反任一 = 你判 must-fix)
- workflow_status 純操作/顯示,**絕不碰金流真相軸 payment_status / 對帳 / 退款 / 雙扣**。
- 經銷隔離:具名白名單、禁 `select('*')`、零成本/經銷價欄;明細頁地址=admin service_role only。
- 寫入四件:稽核 + 樂觀鎖 + Origin 自驗 + fail-closed,缺一即 must-fix。
- 實作視窗**不 apply migration、不 push、不 deploy**(全 Sean 手動);你亦然。

## 審查協議(00-work-rules §5)
- **對抗審 refute-first**:嘗試擊破非背書;宣稱 vs 事實逐條核;邊界(空值/並發雙擊/失敗路徑/回滾)。
- **findings 分堆**:must-fix(正確性/安全/驗收)vs nit;**R1 PASS(含 nit)修完即收、不複審;R1 FAIL 才跑 R2**;同一 diff 不開兩條重疊審線。
- **第二意見(高風險必配)**:金流/schema/RLS/寫入路徑 → 直呼 Codex CLI 盲審(Sean 已授權:`codex exec -s read-only -c service_tier="fast"`、唯讀零留痕、跑前後 `git status --porcelain` 比對;findings 必 Fable triage 非背書)。
- **verdict**:寫回 `pcm-tools/review-inbox/<同名>.verdict.md`(結論 PASS/FAIL + must-fix 逐條 檔案:行號+失敗情境 + nit)。
- **字面 vs 事實**:寫進 verdict 的字面(enum/行數/欄名)只認 grep/Read 命中或 MCP 實查;親讀 handler 本體非呼叫點;殘餘風險不自宣接受、列給 Sean。

## 值班機制
- 實作視窗丟單 → `pcm-tools/review-inbox/m4a-order-workflow-status-{a,b,c}.md`。
- 你可掛 Monitor 輪詢該目錄(前一視窗哨兵已隨對話關閉、需重掛;見 memory `reference_fable-review-inbox-protocol` / `reference_sentinel-auto-review-pipeline`),或 Sean/實作視窗 ping 時審。
- 審完 verdict 寫回、通知(Sean 手動橋接兩視窗)。

## 連動 memory
`project_m4a-admin-phase1-decisions`(主決策家)、`feedback_review-dont-skip-security-face-of-excluded-topic`(別跳過被排除主題的安全面)、`feedback_adversarial-timeline-self-review-before-codex`、`reference_supabase-rls-schema-test-txn-simulation`(交易模擬)、`feedback_new-rpc-align-sibling-gates`、`reference_fable-review-inbox-protocol`。
