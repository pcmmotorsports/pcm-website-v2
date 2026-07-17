// lib/email/composition.ts — 交易信 outbox sweeper composition root(M-4a Email 片 E2a-c;鏡像 lib/payment/composition.ts)
//
// storefront 唯一注入 email server-only adapter(SupabaseEmailOutboxAdapter=service_role / ResendEmailSenderAdapter=
// 持 Resend API key)的「受控單檔」:email-sweep cron route 只 import 本檔 factory、不直接碰 @pcm/adapters/server。
// - eslint.config.js 禁整個 apps/storefront/**/*.{ts,tsx} import @pcm/adapters/server;本檔以 inline eslint-disable +
//   意圖註解開「受控小門」(鏡像 payment/composition.ts:32、line-admin.ts:20;code-reviewer 在 import 點即見例外)。
//
// 🔴 server-only(本檔 import 'server-only'):
//   - SupabaseEmailOutboxAdapter 注入 service_role client(email_outbox 表含 recipient_email=PII、anon/authenticated 零權限)。
//   - ResendEmailSenderAdapter 持 RESEND_API_KEY,皆絕不進 client bundle。
// 🔴 lazy(對齊 payment/composition + N2 sweeper 不變式):env 在 factory 內讀、零 module-top env 讀取 → route 的
//    route 認證/限流未過即在建 deps 前 return 之「零 env 依賴」仰賴此;改本檔前必守 lazy 契約。
// 🔴 假信箱 gate 域名 = 單一字面來源 LINE_SYNTHETIC_EMAIL_DOMAIN(lib/auth/line.ts:38);packages 不可反向 import app,
//    故由本 composition 注入(SupabaseEmailOutboxAdapter 建構參數必填無預設)。

import 'server-only';
import type { SweepEmailOutboxDeps } from '@pcm/use-cases';
// eslint-disable-next-line no-restricted-imports -- 受控例外(鏡像 payment/composition.ts):composition root 注入 email server-only adapter;SupabaseEmailOutboxAdapter 持 service_role client(email_outbox 含 recipient_email PII)、ResendEmailSenderAdapter 持 RESEND_API_KEY、皆 server-only 不進 client bundle。
import {
  SupabaseEmailOutboxAdapter,
  ResendEmailSenderAdapter,
  createSupabaseServiceClient,
  type EmailOutboxClient,
} from '@pcm/adapters/server';
import { LINE_SYNTHETIC_EMAIL_DOMAIN } from '@/lib/auth/line';

/** 讀必要 env、缺則 throw(fail fast、對齊 payment/composition.ts + lib/auth/line.ts requireEnv 模式)。 */
function requireEnv(name: string): string {
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:本檔 server-only(檔頭 import 'server-only')、動態 requireEnv 不進 client bundle、無 env inlining 風險(backlog #182 規則、鏡像 payment/composition.ts requireEnv)
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必要環境變數:${name}`);
  }
  return value;
}

/**
 * 建 SweepEmailOutboxDeps(E2a-c email-sweep cron route 注入 sweepEmailOutbox use-case)。
 *
 * 🔴 lazy(見檔頭):env 在此讀、非 module-top → route 認證/限流未過即不觸發本 factory = 零 env 依賴。
 * - outbox = SupabaseEmailOutboxAdapter + service_role client(文件化窄 cast=E1b 前例 database.types 未含 email_outbox;
 *   regen 後可移除);syntheticEmailDomain 注入單一字面來源。
 * - sender = ResendEmailSenderAdapter(RESEND_API_KEY 與告警管道共用同一把 key、from=ORDER_EMAIL_FROM 交易信專用寄件者
 *   〔E1 定案 orders@pcmmotorsports.com,兩 Vercel project 都要設;缺 → requireEnv throw → route 503 fail-closed〕)。
 */
export function getSweepEmailOutboxDeps(): SweepEmailOutboxDeps {
  const outbox = new SupabaseEmailOutboxAdapter(
    createSupabaseServiceClient() as unknown as EmailOutboxClient,
    { syntheticEmailDomain: LINE_SYNTHETIC_EMAIL_DOMAIN },
  );
  const sender = new ResendEmailSenderAdapter({
    apiKey: requireEnv('RESEND_API_KEY'),
    from: requireEnv('ORDER_EMAIL_FROM'),
  });
  return { outbox, sender };
}
