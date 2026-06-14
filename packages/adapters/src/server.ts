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
