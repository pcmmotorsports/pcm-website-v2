# M-3 #250 雙扣 anomaly 主動告警 — 實作真權威(2026-07-01)

> 狀態:✅ 已實作(worktree=dev、未 push、未 db push、`ANOMALY_ALERT_ENABLED` 預設 false 休眠)。
> 真權威來源:canonical `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §7 + W1 runbook `docs/runbooks/2026-06-26-m3-3ds-double-charge-refund-runbook.md`(line150 不杜撰 SLA / line51 open≠確認雙扣)+ backlog #250。
> Sean 拍板:Q1=**A+C**(LINE + Email 雙管道)/ Q2=**不做 heartbeat**(歸未來系統檢測監控面板)/ Q3=**批准開工**。

## 目標
把雙扣偵測 pull(W1 報表有空才查)→ push(發生即主動推播 Sean)。anomaly `open`(雙扣候選)/ `refunding` 卡逾營運門檻 / 死卡列(needs_manual_review + released_manual_review_at)任一踩 → 週期 cron 自動經 LINE+Email 告警。杜絕沉默故障 + 錯過客訴黃金期。

## 分級 / 鐵則
L3(anomaly DB-backed、已過 R1b1a PRD;本片只 ADD 唯讀聚合)。鐵則 8(跨多檔 + 動 schema〔新 SECDEF RPC〕+ 動 vercel.json)→ 已提 plan 過 Sean 批。鐵則 12(payment/migration/security)→ 三綠 + 關卡2 codex K2 + code-reviewer + adversarial-reviewer + pcm-security-audit L1 + DDL MCP 零留痕。

## 安全模型(唯讀 MCP 查證 live)
- anomaly 兩表:只 postgres 有 grant;payment_confirmer/anon/auth/service_role 零表權、RLS enabled。
- cron 跑在 payment_confirmer(`PAYMENT_CONFIRMER_DB_URL` 窄權鑰)→ 對 anomaly 表零權 → 必經 owner-defined SECDEF 聚合 RPC 當受控窗(definer=postgres 內部讀、payment_confirmer 只需 EXECUTE、永不取得 table grant)。**不動** anomaly 表既有 grant 與 claim/resolve/genesis lifecycle RPC。

## 架構(最終實作)
1. **migration** `supabase/migrations/20260701120000_m3_250_anomaly_alert_summary.sql`:
   - SECDEF `public.get_payment_anomaly_alert_summary(p_refunding_stuck_seconds integer)`,owner=postgres,`SET search_path=''`,schema-qualified,STABLE,回 jsonb 6 鍵零 PII 計數:
     - `open_count`(status='open')/ `refunding_count`(status='refunding')
     - `refunding_stuck_count`(status='refunding' 且 refund_claimed_at 逾 clamp(p,[0,30d]);refunding 一致性 CHECK 保 claimed_at NOT NULL)
     - `oldest_open_age_seconds`(最舊 open 年齡、無 open→null)
     - `attempt_manual_review_count`(needs_manual_review=true **且 status='pending'** 且 order unpaid;限 pending 排除 terminal failed 假告警〔markFailed 不清 flag〕)
     - `released_stuck_count`(released_manual_review_at IS NOT NULL 且 status='released' 且 order unpaid;Phase1 producer-gated 0、前瞻)
   - ACL:REVOKE 5 角色(**含 payment_confirmer + service_role**、避 default-grant trap)→ GRANT payment_confirmer;6 fail-closed assert:has_function_privilege 矩陣 + role_routine_grants 危險 grantee=0 + role-hygiene(payment_confirmer 全域 table/col grant=0)+ **effective-privilege**(has_table_privilege payment_confirmer 對 anomaly 兩表 + payment_charge_attempts SELECT=false)。
2. **domain** `@pcm/domain` `AnomalyAlertSummary` + `AnomalyAlertMessage`。
3. **ports** `@pcm/ports` `IAnomalyAlertReader` + `IAlertNotifier`。
4. **adapters** `@pcm/adapters/server`:
   - `PgAnomalyAlertReaderAdapter`(鏡像 PgReleaseSiblingAdapter:buildPgConfig + per-request Client + finally end + sanitizeError 零 pg 原文;snake→camel;count fail-closed parse)。
   - `LineAlertNotifierAdapter`(LINE Messaging API push、原生 fetch)+ `EmailAlertNotifierAdapter`(Resend、原生 fetch);皆 server-only、密鑰只進 Authorization header、非 2xx 只 throw status(不含密鑰)。
5. **use-case** `@pcm/use-cases` `checkAnomalyAlerts`:reader.getAlertSummary → shouldAlert = open>0 || refunding_stuck>0 || attempt_manual_review>0 || released_stuck>0 → 對所有 notifier Promise.allSettled 推播(一管道掛不阻另一);reader throw 上拋、notifier 失敗計 errors、**踩門檻零 notifier→throw**(縱深)。`buildAnomalyAlertMessage` 固定格式零 PII、open 附最舊年齡、文案「候選/待查證」。
6. **composition** `getAnomalyAlertDeps()`(lazy):reader + 依 env 存在性組 LINE/Email notifier(primary 密鑰在→requireEnv 其餘、部分設定 fail-fast);enabled 但零管道→throw。
7. **cron route** `app/api/cron/anomaly-alert/route.ts`(鏡像 settle-sweep):GET + CRON_SECRET Bearer 硬驗(未設/弱→500、缺/錯→401)+ `ANOMALY_ALERT_ENABLED` strict 'true' gate(預設 200 no-op、disabled 零 DB env)+ `ALERT_REFUNDING_STUCK_SECONDS=86400`(營運參數揭示可調非 SLA)+ errors>0→503 不偽 200 + maxDuration 60。
8. **vercel.json**:加 `/api/cron/anomaly-alert` `0 1 * * *`(UTC=台灣 09:00、晚 settle-sweep〔0 0〕1h、讓對帳先收斂再報殘留;Hobby 上限 2 cron/daily=第 2 個剛好上限)。

## env(Vercel Production、Sean launch 前設)
- `ANOMALY_ALERT_ENABLED='true'`(開啟)+ `CRON_SECRET`(已與 settle-sweep 共用)
- LINE:`LINE_CHANNEL_ACCESS_TOKEN` + `LINE_ALERT_TO`(Sean userId/groupId)
- Email:`RESEND_API_KEY` + `ALERT_EMAIL_FROM`(Resend 已驗證網域)+ `ALERT_EMAIL_TO`

## 誠實邊界
- refunding_stuck 秒數 = 營運參數揭示可調、**非 PRD SLA**(不杜撰 SLA)。
- open = 雙扣**候選、待查證**(非已確認雙扣);released_stuck Phase1 恆 0(前瞻)。
- **無 per-anomaly 去重**→ 未解決前每輪持續提醒(刻意)→ #255 follow-up。
- 頻率 daily = 最壞 24h 延遲 vs 黃金期為盡力非保證;真黃金期需 Vercel Pro 改 hourly(launch 決)。
- **db push sequencing**:code 期待、live 未套用 → Sean db push 在驗/部署前。

## 驗證
- DDL MCP BEGIN..ROLLBACK 零留痕:CREATE + 6 assert + 行為 delta(open2→3/refunding0→1/stuck@24h=1/stuck@30d=0)+ residue=0。live effective-privilege 實查三表 SELECT=false。
- 三綠 typecheck 7/7 + lint 10/10 + build 1/1 + 完整 vitest 145 檔 1568。
- 審查:關卡1(Gemini + codex K1 + adversarial、6 findings 折入)+ 關卡2(codex K2 跨模型 PASS〔2 MED+1 NIT 折入〕+ code-reviewer PASS + adversarial-reviewer PASS-with-comments + pcm-security-audit L1〔0 CRITICAL/0 HIGH/1 LOW→#254〕)。
- follow-up:#254(cron 限流)/ #255(去重)。
