# Email 通知片 規劃 + outbox schema 草稿(2026-07-13 Fable)

> ⚠️ **歷史底稿，禁止直接開工。** 2026-07-18 已轉為通知線修正版 D′；
> 現行真權威是 `docs/specs/2026-07-18-b0-order-notification-email-prd.md`，本檔只保留供來源追溯。

> Fable 過夜規劃(Sean「可以做就先做」)。第一期範圍:下單成功 + 出貨通知(PRD §6.6 加項)。
> **含一個觸發點決策要 Sean 拍(碰不碰金流 RPC)。** 訂單線第 7 片,獨立於部署/客戶線。

## 目標
事務信第一期兩封:①下單成功(order_created)②出貨通知(order_shipped)。寫 outbox 表 + 背景送 + 重試,**不在訂單交易內直呼 Resend**(PRD §6.6:Resend 慢/失敗不可拖垮或回滾建單)。

## 復用既有(不重造輪子)
- **Resend 送信**:`packages/adapters/src/payment/EmailAlertNotifierAdapter.ts`——原生 fetch POST `api.resend.com/emails`、零新依賴、server-only、錯誤只含 status 不洩 key。訂單通知擴展它(告警是零 PII 純文字給 Sean;訂單信要 recipient=客人、含訂單資訊+模板)。
- **背景 cron**:`apps/storefront/src/app/api/cron/anomaly-alert/route.ts`——CRON_SECRET Bearer + timingSafeEqual fail-closed + feature flag gate + Vercel cron。email-outbox-sweep cron 照這套。
- Resend 網域已驗(pcmmotorsports.com,#250);env `RESEND_API_KEY`/`ALERT_EMAIL_FROM` 已有,訂單信寄件者可共用或另設 `ORDER_EMAIL_FROM`。

## outbox 表 schema 草稿(對齊 audit_log 的 client 全鎖 pattern)
```sql
CREATE TABLE public.email_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     text NOT NULL CHECK (event_type IN ('order_created','order_shipped')),
  recipient_email text NOT NULL,                    -- 客人 email(PII)
  subject        text NOT NULL,
  payload        jsonb NOT NULL,                     -- 渲染用(display_id/品項摘要/狀態);🔴 含訂單 PII
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts       int  NOT NULL DEFAULT 0,
  max_attempts   int  NOT NULL DEFAULT 5,
  last_error     text,
  correlation_id text,                               -- 貫穿(§6.7)
  created_at     timestamptz NOT NULL DEFAULT now(),
  next_retry_at  timestamptz,                        -- 指數退避排程
  sent_at        timestamptz
);
-- RLS + ACL(payload 含 PII → client 全鎖,同 audit_log):
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;  -- zero-policy
REVOKE ALL ON public.email_outbox FROM PUBLIC, anon, authenticated, service_role;
-- 🔴 與 audit_log(僅 INSERT)不同:outbox 需 cron 讀+改狀態 → service_role 要 INSERT+SELECT+UPDATE(不給 DELETE=留軌;清理另 job)。
GRANT INSERT, SELECT, UPDATE ON public.email_outbox TO service_role;
-- 索引:cron 掃待送(status+next_retry_at)、correlation。
CREATE INDEX email_outbox_due_idx ON public.email_outbox (status, next_retry_at) WHERE status IN ('pending','failed');
CREATE INDEX email_outbox_correlation_idx ON public.email_outbox (correlation_id);
```
(migration 正式寫時加 fail-closed DO 斷言 ACL,同 audit_log；此為 schema 草稿。)

## 架構:寫入—送出解耦
1. **寫入**(觸發時):寫一列 email_outbox(status=pending)。**不呼 Resend**。
2. **送出**(cron `email-outbox-sweep`、每 1-5 分):掃 status∈(pending,failed) AND next_retry_at<=now → 取客人 email/payload → 渲染 → Resend 送 → 成功 status=sent+sent_at;失敗 attempts++ / 設 next_retry_at(指數退避)/ 到 max_attempts → status=failed 停。
3. **冪等**:cron 送前先 UPDATE status='sending'(或用 SELECT FOR UPDATE SKIP LOCKED)防兩個 cron 重送同封。

## 🔴 觸發點決策(要 Sean 拍 — 碰不碰金流 RPC)
```
Q: order_created 的 outbox 寫入放哪?(order_shipped 無爭議=後台改 fulfillment_status 時 app 層寫)

A(Fable 推薦): order 表 AFTER INSERT trigger 寫 outbox(DB 層原子、不動 create_order RPC body)。
   優:建單即保證有信、不碰金流 RPC(create_order 是高風險件、少動);trigger join customers 取 email。
   慮:trigger 內 join+insert 複雜度;散客單(customer_user_id NULL)無 email → trigger 內判 skip。

B: create_order RPC 內同交易寫 outbox。優:同交易最原子。
   代價:動金流 RPC(鐵則 12、要 Fable+codex 審);create_order 已很複雜。

C: app 層 placeOrder 成功後寫 outbox(非 DB 原子)。優:不碰 RPC/trigger、最簡。
   慮:order 建了但 app 崩→漏信(可靠性低於 A/B)。
```
Fable 推 A(原子+不碰金流)；散客單無 email 的處理三案都要顯式判。

## 驗收 / 風險
- 三綠 + 完整 vitest;outbox adapter 單測(寫入/掃描/重試/冪等)。
- 🔴 **PII**:payload/recipient 含客人 email+訂單 → client 全鎖(同 audit_log 驗證:anon/authenticated 零權限)。
- 🔴 **金流**:若選 B 碰 create_order → 高風險件、Fable+codex 雙審;A/C 不碰。
- Resend 送失敗不可拖垮 cron(告警 pattern:計 error→route 503 可見,但單封失敗走重試不 503)。
- 散客單(NULL customer)無 email → 不建 outbox / 標 skip。

## 連動
[[250-email-alert-resend-verified-domain]](Resend 基建+網域)、[[m4a-admin-phase1-decisions]](email 進第一期)、EmailAlertNotifierAdapter(送信復用)、anomaly-alert route(cron 復用)。PRD §6.6(outbox 不在交易內呼 Resend)。
