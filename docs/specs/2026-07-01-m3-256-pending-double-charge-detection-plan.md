# #256 Plan — pending-based 雙扣偵測(GAP2 靜默盲區治本)

> 真權威 plan(鐵則 8 動 schema/API + 鐵則 12 payment/anomaly → 動手前提 plan 等 Sean 批 + codex 關卡1)。
> 背景:#252 二度確認發現 GAP2(異 cart + >10min + 純 pending 兄弟單)雙扣走 `pending→charged`、不觸發 anomaly genesis(只認 `released→charged`)→ #250/W1 靜默看不見。本片補「pending-based 偵測」讓 GAP2 也會告警。
>
> **Sean 決策鏈(2026-07-01)**:Q1=A 嚴啟發式 / Q2=A 輕量(計數告警 + runbook 查明細、不建持久候選表)/ Q3=A 批准 →(codex K1 round1 FAIL:5 分窗結構性漏 GAP2 + Sean 顧慮「客人真的會買兩個一樣的分兩單」)→ **改良偵測 = 卡住指紋 + 同金額 + 12h 窗**(Sean 拍 A):只在「兩單其一的付款卡住(從結帳到扣款拖 >10min)」才算候選 → 正常「乾脆買兩個」(兩筆秒扣)不誤報。

---

## ① 任務目標(1-2 句)

在既有 #250 每日告警聚合 RPC 上**加第 7 計數** `pending_double_charge_candidate_count`:同 `customer_user_id` + 同 `total` + 兩單 `paid_at` 差 < 窗(預設 12h)+ 皆 `paid` + **其一 charged attempt「卡住指紋」**(`updated_at - created_at` > 卡住門檻〔預設 600s〕)。>0 併入既有告警;W1 runbook 加「Report C:pending 雙扣候選」查詢供人工查證退款。**不建持久表、不新開 cron、不碰刷卡熱路徑。**

## ② 前置檢查

- `git branch --show-current`=dev / `git status` clean / HEAD 對齊 STATUS(開工前確認)。
- flag `TAPPAY_3DS_ENABLED` / `ANOMALY_ALERT_ENABLED` 全程 false(本片不動 flag)。

## ③ 執行模式 + Subagent

- mode B(單 session 順序執行)/ conductor = main session。
- 關卡1 = **codex-adversary `codex exec -s read-only` 審 plan**(鐵則 8+12)→ **round1 FAIL 已折入本 round2 plan** → round2 codex 複審 PASS 才動手。
- 關卡2 = **codex K2 審 diff**(payment/anomaly)+ code-reviewer + adversarial-reviewer + pcm-security-audit L1。
- `/slice-checkpoint` 三綠(動 .ts → 加 build)。鐵則 12 → 產 Codex Packet、commit 前提醒 Sean、不 push。

## ④ Manifest Impact + Review 觸發

- 不動 storefront `components/*`、`styles/*`(無 manifest sync)。
- review_triggers:`security_review_required`(SECDEF/ACL/payment)、`codex_review_required`(鐵則 12)。db push=Sean(`.env*` deny)。

## ⑤ 執行步驟(設計 + 落地)— 🔴 鐵則 4 拆兩片(codex K1 F5)

### 片 1(migration + RPC + DDL MCP 模擬 + 審 + commit)

**Migration `20260701130000_m3_256_pending_double_charge_detection.sql`(時戳晚於 #250 120000):**

- `DROP FUNCTION public.get_payment_anomaly_alert_summary(integer)` → `CREATE FUNCTION ...(p_refunding_stuck_seconds integer, p_pending_dc_window_seconds integer, p_pending_dc_stuck_seconds integer)`(SECDEF STABLE SQL、`search_path=''`、逐字保留原 6 計數 + 加第 7)。
- 第 7 計數 `pending_double_charge_candidate_count`(GROUP BY user+total 的「**候選組數**」、非「案件數」— codex F4 語意 COMMENT 標清):
  ```
  (SELECT count(*) FROM (
     SELECT o1.customer_user_id, o1.total
     FROM public.orders o1
     JOIN public.orders o2
       ON o1.customer_user_id = o2.customer_user_id
      AND o1.total = o2.total
      AND o1.id < o2.id
      AND o1.payment_status = 'paid'::public.payment_status
      AND o2.payment_status = 'paid'::public.payment_status
      AND o1.paid_at IS NOT NULL AND o2.paid_at IS NOT NULL
      AND abs(EXTRACT(EPOCH FROM (o1.paid_at - o2.paid_at)))
          < GREATEST(0, LEAST(COALESCE(p_pending_dc_window_seconds, 43200), 30*24*3600))
     WHERE EXISTS (   -- 🔴 卡住指紋:其一 charged attempt 從結帳到扣款拖 > 門檻(正常秒扣、GAP2 abandoned-then-late 才拖)
       SELECT 1 FROM public.payment_charge_attempts a
       WHERE a.order_id IN (o1.id, o2.id)
         AND a.status = 'charged'
         AND EXTRACT(EPOCH FROM (a.updated_at - a.created_at))
             > GREATEST(0, LEAST(COALESCE(p_pending_dc_stuck_seconds, 600), 24*3600)))
     GROUP BY o1.customer_user_id, o1.total) x)
  ```
  - **卡住指紋 = Sean 顧慮的解**:正常「乾脆買兩個」兩筆秒扣(真實資料實測 charged 耗時全 <2min)→ 無指紋 → 不誤報;GAP2 第一筆卡 >10min → 有指紋 → 告警。
  - `paid_at` 為窗時間軸;`updated_at - created_at` 為卡住時長(charged 態近終態、updated_at≈扣款時;誠實限制:非專用 charged_at 欄,updated_at 若後續被動會誇大時長=偏保守多抓非漏)。
  - 窗 clamp [0,30天]、卡住門檻 clamp [0,24h](沿 #250 clamp 範式);預設 43200s(12h)/ 600s(10min)。
  - **零 PII**:只回「組數」計數(對齊 #250 契約)。
- ACL:對**新三參簽名** REVOKE 5 角色 → GRANT payment_confirmer;重跑 #250 的 6 assert(EXECUTE 矩陣 / role_routine_grants 危險殘留 / role-hygiene / effective-privilege)。
  - 🔴 **codex F3 折入**:新 RPC 讀 `orders`(既有 #250 attempt_manual_review 計數本就 JOIN orders、未 assert orders → 本片一併補);先唯讀查 payment_confirmer 對 `orders` 的有效 SELECT 現況 → 若為零則加入 effective-privilege assert;若 payment_confirmer 本有 orders 權(其他 RPC 需)則 COMMENT 誠實說明「orders 讀經 SECDEF、RPC 只回計數零 PII」不強加零權 assert(不製造假承諾)。
- **DDL MCP `BEGIN..ROLLBACK` 零留痕模擬**:合成同 user 同 total 兩 paid、其一 attempt 卡 >10min → 計數=1;窗外/異額/**兩筆皆秒扣(無指紋)**→ 0;殘留=0。三綠(純 .sql → build N/A)。

### 片 2(TS 接線 + runbook + 測 + 審 + commit)

- `packages/domain/src/payment/anomaly-alert.ts`:`AnomalyAlertSummary` 加 `pendingDoubleChargeCandidateCount: number`。
- `packages/ports/src/IAnomalyAlertReader.ts`:`getAlertSummary(refundingStuckSeconds, pendingDcWindowSeconds, pendingDcStuckSeconds)` 三參。
- `packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts`:RPC 呼 `...($1,$2,$3::integer)`、`parseAlertSummary` 加該計數(parseCount)。
- `packages/use-cases/src/check-anomaly-alerts.ts`:`CheckAnomalyAlertsOptions` 加兩參;`shouldAlert` 加 `|| pendingDoubleChargeCandidateCount > 0`;`buildAnomalyAlertMessage` 加「• 疑似重複扣款(同客戶同額、其一付款卡住)N 組 — 請查 Report C 對帳,確認哪一筆為重複再退」;`CheckAnomalyAlertsResult` 加計數。
- `apps/storefront/src/app/api/cron/anomaly-alert/route.ts`:加常數 `ALERT_PENDING_DC_WINDOW_SECONDS=43200`、`ALERT_PENDING_DC_STUCK_SECONDS=600`、傳 opts。
- 測試:reader parse、use-case shouldAlert/訊息、route。三綠(動 .ts → build)+ 完整 vitest。
- **runbook `docs/runbooks/2026-06-26-...refund-runbook.md` 加 Report C**(codex F5 折入退款目標):owner/MCP 查詢列實際訂單對(user_id、兩單 display_id、total、paid_at 差、各 attempt 卡住時長、rec_trade_id);🔴 **退款目標必人工查證**:GAP2 無 released 錨點 → **不可自動「退較晚那筆」**;runbook 明列「Sean 逐對查 TapPay Dashboard 確認哪一筆是重複(通常=卡住那筆的意外成交 or 重付那筆),退真重複的 rec、絕不退客人真的想要的那筆」。

## ⑥ 驗收條件(yes/no)+ 禁止清單

**驗收:**
- ☐ 新 RPC 三參、第 7 計數正確(DDL MCP:同額兩 paid+其一卡住→1;無卡住指紋/窗外/異額/單筆→0);6+ assert 全過。
- ☐ ACL 矩陣 + role-hygiene + effective-privilege(含 orders 決策)全過。
- ☐ TS 鏈三綠 + vitest 全綠;訊息含「請查證哪筆為重複再退」。
- ☐ runbook Report C 可對線上真表跑(唯讀);退款目標「人工查證」寫清楚。
- ☐ 零 PII;codex K1 round2 + K2 + code-reviewer + adversarial + L1 全過;Codex Packet 產出。
- ☐ 未 push、db push=Sean、flag 全 false。

**禁止清單(基線):** 不改 scope 外檔 / 不變 env·deployment / 不改 schema·infra(本片 migration 除外、已宣告)/ 不用 `git add .`·`-A` / 不自動 push / 不動 `.env*` / 不繞 design-mirror。不動 anomaly 兩表 grant 與 claim/resolve/genesis lifecycle RPC(只擴 summary RPC)。不建持久候選表(Q2=A)。**不自動決定退款目標(人工查證)。**
— 禁止清單結束 —

---

## codex K1 round1 findings 折入紀錄

- **F1 [FAIL] 5 分窗結構性漏 GAP2** → Sean 顧慮「客人真的會買兩個」→ 改**卡住指紋 + 窗放寬 12h**(指紋當主篩、窗不再是唯一過濾;真實資料實測 charged 耗時全 <2min、卡住>10min=0 → 指紋精準)。✅ 已改。
- **F2 [FAIL] Report C 退款目標在 GAP2 無 released 錨點易誤導** → runbook 明訂「退款目標人工查證、不自動退較晚那筆」。✅ 已改。
- **F3 [CONCERN] 新 RPC 讀 orders、assert 漏 orders effective-priv** → 片 1 先唯讀查 payment_confirmer orders 現況再決定加 assert or 誠實 COMMENT。✅ 已納。
- **F4 [CONCERN] GROUP BY 組數易誤讀成案件數** → COMMENT + 訊息用「組」字面標清。✅ 已改。
- **F5 [FAIL] scope 超鐵則 4** → 拆片 1(migration+RPC)/ 片 2(TS+runbook)。✅ 已拆。
- **F6 [CONCERN] L3 內容分級 / 退款目標決策未標** → L3 沿 #250/R1b1a PRD(退款營運資料已過 prd_review、本片只加偵測計數 + runbook 查詢、不新增退款 RPC);退款目標決策=人工查證(禁止清單)。✅ 已標。

## 已知誠實邊界(揭示、非隱藏)

- 偵測=**候選**(待人工查證),非已確認雙扣(對齊 #250 open 語意);卡住指紋大幅降誤報但非零(極少數正常客人可能付款也拖很久)。
- 卡住時長用 `updated_at - created_at`(近似、非專用 charged_at);偏保守(多抓非漏)。
- 與 open_count 可能重疊(released 雙扣第二筆亦 paid + 若其一卡住)→ 冗餘偵測非 bug、揭示。
- 窗/卡住門檻皆營運參數(route 常數、揭示可調、非 SLA)。
