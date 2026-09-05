/**
 * @pcm/adapters/server subpath — server-only exports
 *
 * **本檔只能在 server 端 import**(對齊 ADR-0005 §7 service_role key 紀律 +
 * docs/specs/M-1-03-main-b-PRD.md §7.3)。
 *
 * 對齊:
 * - sub-slice B-1:packages/adapters/src/supabase/client.ts 檔頭 import 'server-only'
 *   編譯期擋 client component import(transitively)
 * - sub-slice B-2(本 sub):subpath exports 拆 root(public)+ ./server(server-only)、
 *   import path 級隔離
 * - sub-slice B-3:ESLint rule 擋 'use client' 標記檔 import @pcm/adapters/server
 *   寫 code 即時警示
 *
 * 引用:
 * - 從 @pcm/adapters/server import:server file(apps/storefront/src/lib/*.ts、
 *   server component、route handler、middleware)
 * - 不可從 'use client' 標記檔 import(編譯期會 throw、ESLint 會警告)
 */
import 'server-only';

export { createSupabaseServiceClient } from './supabase/client';

// M-1-14d-2:SupabaseWalletAdapter 走 server-only subpath(addEntry 需 service_role writeClient
// 寫 ledger、金流敏感、絕不入 client bundle;listEntries / getBalance 用 authenticated readClient)。
// 對齊本檔 service_role 隔離紀律 + codex 關卡2 must-fix(不從 root public @pcm/adapters export)。
export { SupabaseWalletAdapter } from './supabase/SupabaseWalletAdapter';

// M-1-14e-1:SupabaseAuthAdapter 走 server-only subpath(register / login 走 server action、
// 對齊「會員驗證在 server」鐵則 + wallet adapter 前例;失敗映射 domain AuthError、不上洩 Supabase error)。
export { SupabaseAuthAdapter } from './supabase/SupabaseAuthAdapter';

// M-3 階段②-②a:TapPayChargeAdapter 走 server-only subpath(持 Partner Key、x-api-key server-only secret、
// 絕不進 client bundle;pay-by-prime sandbox/prod by env)。composition root 唯一受控注入點(eslint no-restricted-imports
// 擋全部 storefront import、只剩 composition root inline-disable = 結構守門)。
export { TapPayChargeAdapter, type TapPayChargeConfig } from './tappay/TapPayChargeAdapter';
// RW2a:三端點 URL 純常數與 adapter 同住(storefront 與 admin 兩個 composition 共用同一個
// env→host 綁定點;純 URL 無 secret,掛 server subpath 是「跟著唯一消費面走」不是機密性要求)。
export { tapPayUrlsFor, type TapPayEnv } from './tappay/endpoints';

// M-3 階段②-②b:PaymentConfirmerAdapter 走 server-only subpath(持 PAYMENT_CONFIRMER_DB_URL raw DB
// credential、敏感度 ≥ service_role;pg 走 Supabase session pooler + 完整 CA 驗證)。pg 只在本 subpath
// import = 不污染 root barrel tree-shaking;同 TapPay adapter 結構守門。
export { PaymentConfirmerAdapter, type PgClientLike } from './payment/PaymentConfirmerAdapter';

// M-3 ②-③b:charge 簿記/防雙扣鎖雙軌(主=pg 窄權直連、備=authenticated PostgREST+token;
// 同 PaymentConfirmerAdapter 紀律:server-only subpath、pg 不進 root barrel)。
export { PgChargeAttemptAdapter } from './payment/PgChargeAttemptAdapter';
export {
  SupabaseChargeAttemptFallbackAdapter,
  type ChargeAttemptFallbackRail,
} from './payment/SupabaseChargeAttemptFallbackAdapter';
export { ChargeAttemptStoreWithFallback } from './payment/ChargeAttemptStoreWithFallback';

// M-3 3DS-2a:PgWebhookInboxAdapter 走 server-only subpath(②-⑥ webhook durable inbox 主軌、payment_confirmer
// 同鑰、複用 buildPgConfig 連線縱深、呼 3DS-0a record_webhook_event RPC;同 PaymentConfirmer 紀律 pg 不進 root barrel)。
export { PgWebhookInboxAdapter, type WebhookInboxError } from './payment/PgWebhookInboxAdapter';

// M-3 3DS-S2b:PgPollSettleThrottleAdapter 走 server-only subpath(輪詢端點主動 settleCharge 的 per-order Record
// 限流、payment_confirmer 同鑰、複用 buildPgConfig、呼 3DS-S2b claim_order_poll_settle RPC;同紀律 pg 不進 root barrel)。
export { PgPollSettleThrottleAdapter } from './payment/PgPollSettleThrottleAdapter';

// M-3 3DS 乙路 R2b-1:立即重刷 preflight 兄弟單反查 + release CAS 兩 adapter(server-only subpath)。
// SupabaseSiblingLookupAdapter = authenticated own-only(find_active_sibling_own、需 user JWT、同 fallback 紀律);
// PgReleaseSiblingAdapter = payment_confirmer 窄權(mark_charge_attempt_released_for_user、複用 buildPgConfig、pg 不進 root barrel)。
export {
  SupabaseSiblingLookupAdapter,
  SiblingLookupParseError,
} from './payment/SupabaseSiblingLookupAdapter';
export { PgReleaseSiblingAdapter, type ReleaseSiblingError } from './payment/PgReleaseSiblingAdapter';

// M-3 #250 雙扣 anomaly 主動告警:聚合讀 adapter(payment_confirmer 窄權、SECDEF 受控窗)+ 兩推播管道
// (LINE Messaging API / Email Resend、皆 server-only 持管道密鑰、原生 fetch 零新依賴)。
export {
  PgAnomalyAlertReaderAdapter,
  type AnomalyAlertReaderError,
} from './payment/PgAnomalyAlertReaderAdapter';
export {
  LineAlertNotifierAdapter,
  type LineAlertNotifierConfig,
  type FetchLike,
} from './payment/LineAlertNotifierAdapter';
export {
  EmailAlertNotifierAdapter,
  type EmailAlertNotifierConfig,
} from './payment/EmailAlertNotifierAdapter';

// M-4a Email 通知片 E1b:交易信 outbox 狀態機 + Resend 寄送 + 組裝層(plan v3.1 §5)。
// 全走 server-only subpath:outbox 表含 recipient_email(PII、client 零權限)、Resend 持 API key、
// outbox client = service_role 注入(composition 於 E2a/E3 走 line-admin 式受控模組)。
// 🔴 `#858` 片0-a:假信箱**判斷式**改由 composition 注入(`@pcm/schemas` 的 `isSyntheticEmailDomain`),
//    本 package 不再自己實作那條規則 ⇒ 原本 export 的 `isSyntheticEmail` **已刪除**
//    (它是那條規則的第二份實作,而它與 `@pcm/schemas` 那份已經分岔過一次)。
export {
  SupabaseEmailOutboxAdapter,
  type EmailOutboxClient,
  type SupabaseEmailOutboxAdapterConfig,
} from './email/SupabaseEmailOutboxAdapter';
// 🔴 M-4a B-5(掃描式 enqueue):「已付款但還沒排過 order_created」的窄讀 adapter。
// 同樣走 server-only subpath —— 它回兩個 email 欄(PII),client 注入 service_role。
export {
  SupabasePaidOrderScannerAdapter,
  ScanQueryError,
  type PaidOrderScannerClient,
  type ScanStage,
} from './email/SupabasePaidOrderScannerAdapter';

// 未付款被【員工】取消的通知信 —— 掃描端(Sean 2026-09-03 拍甲;逾時那批不在射程內)
export {
  SupabaseUnpaidCancelledOrderScannerAdapter,
  UnpaidCancelledScanQueryError,
  type UnpaidCancelledOrderScannerClient,
} from './email/SupabaseUnpaidCancelledOrderScannerAdapter';

// 刷卡已退款的整單取消通知信 —— 掃描端(Sean 2026-09-02 拍甲)。
// 🔴 回兩個 email 欄 + 退款金額(PII + 錢)⇒ server-only + service_role。
export {
  SupabaseCancelledOrderScannerAdapter,
  CancelledScanQueryError,
  type CancelledOrderScannerClient,
} from './email/SupabaseCancelledOrderScannerAdapter';
// 🔴 M-4b E4-a(2026-08-22):出貨線的同款窄讀 adapter。**一列 = 一個 (箱, 單) 配對 = 一封信。**
// 同樣回兩個 email 欄(PII)⇒ server-only + service_role。差集在 SQL view 裡(見該檔檔頭)。
export {
  SupabaseShippedOrderScannerAdapter,
  ShippedScanQueryError,
  SHIPPED_EMAIL_PENDING_VIEW,
  type ShippedOrderScannerClient,
} from './email/SupabaseShippedOrderScannerAdapter';
// 🔴 ⟦5b-TRACKNUMGAP1⟧ 片 C(2026-09-04):更正信的同款窄讀 adapter。
// 一列 = 一個 (箱, 號碼) 配對 = 一封信 ⇒ **同一箱改幾次號碼就幾封**(鍵含號碼)。
// 同樣回兩個 email 欄(PII)⇒ server-only + service_role。差集在 SQL view 裡。
export {
  SupabaseTrackingCorrectedScannerAdapter,
  TrackingCorrectedScanQueryError,
  TRACKING_CORRECTED_PENDING_VIEW,
  type TrackingCorrectedScannerClient,
} from './email/SupabaseTrackingCorrectedScannerAdapter';
// 🔴 M-4b E4-b(2026-08-22):出貨通知信的**寄送時讀取** —— `IShippedEmailContext` 的第一份實作
// (那支 port 從 2026-08-18 立好之後一直沒有實作)。server-only + service_role:
// 它讀 shipments / shipment_items / order_items / orders 四張表,回品項與追蹤碼。
export {
  SupabaseShippedEmailContextAdapter,
  ShippedContextQueryError,
  SHIPPED_EMAIL_MAX_LINES,
  type ShippedEmailContextClient,
} from './email/SupabaseShippedEmailContextAdapter';
// 🔴 M-4b(2026-08-24,Sean 拍板信裡要顯示金額之後):付款信的**寄送時讀取**,`IPaidEmailContext` 第一份實作。
// server-only + service_role:讀 orders / order_items 兩張表,回品項與四個金額。
// ⚠️ **今天零注入零呼叫端** —— `composition.ts` 沒有建構它,`sweepEmailOutbox` 沒有呼叫它。
//    這一行**不會**讓任何客人收到不一樣的信;接上它的是模板那一片(合併 plan 的 S4)。
// 🔴 它的 select 是**正面白名單**(經銷價零滲入),而那條有負向斷言在測試裡看著,不是只有註解。
export {
  SupabasePaidEmailContextAdapter,
  PaidContextQueryError,
  PAID_EMAIL_MAX_LINES,
  type PaidEmailContextClient,
} from './email/SupabasePaidEmailContextAdapter';
// 🔴 M-4a E2a-2(W3-G 拆出,2026-08-20):寄送前 ineligible gate 的窄讀 adapter。
// 零 PII(只回 id/orderId),client 注入 service_role,鏡像 SupabasePaidOrderScannerAdapter 的邊界。
export {
  SupabaseIneligibleOrderEmailScannerAdapter,
  type IneligibleOrderEmailScannerClient,
} from './email/SupabaseIneligibleOrderEmailScannerAdapter';
export {
  ResendEmailSenderAdapter,
  type ResendEmailSenderConfig,
  // 🔴 **這兩個一定要出得去**(#876):`EmailAttachmentTooLargeError` 是 adapter **刻意 throw**
  //    而不回 `failed` 的那個東西 —— 它存在的**全部意義**就是讓呼叫端分辨得出
  //    「附件太大(重試不會好)」與「一般可預期失敗(重試會好)」。
  //    ⇒ 不出口 ⇒ 別的 package 拿不到那個 class ⇒ `instanceof` 做不到 ⇒ **那個意義歸零**,
  //      而它會安靜地被當成一般錯誤。上限常數同理:呼叫端要在組附件之前自己先判就得拿得到它。
  EmailAttachmentTooLargeError,
  RESEND_MAX_ATTACHMENTS_BASE64_BYTES,
} from './email/ResendEmailSenderAdapter';
export {
  buildOrderCreatedPayload,
  orderCreatedSubject,
  ORDER_CREATED_EVENT_VERSION,
} from './email/order-email-assembly';
