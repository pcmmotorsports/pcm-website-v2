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
import type { ApplyOrderIneligibleGateDeps, EnqueueOrderCreatedEmailsDeps, SweepEmailOutboxDeps } from '@pcm/use-cases';
// eslint-disable-next-line no-restricted-imports -- 受控例外(鏡像 payment/composition.ts):composition root 注入 email server-only adapter;SupabaseEmailOutboxAdapter 持 service_role client(email_outbox 含 recipient_email PII)、ResendEmailSenderAdapter 持 RESEND_API_KEY、皆 server-only 不進 client bundle。
import {
  SupabaseEmailOutboxAdapter,
  SupabasePaidOrderScannerAdapter,
  SupabaseIneligibleOrderEmailScannerAdapter,
  SupabaseShippedEmailContextAdapter,
  ResendEmailSenderAdapter,
  createSupabaseServiceClient,
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
 * - outbox = SupabaseEmailOutboxAdapter + service_role client(**2026-08-11 #415 窄 cast 已拆**:
 *   `EmailOutboxClient` 現在就是 `SupabaseClient<Database>`,`email_outbox` 的表名/欄名/回傳形狀
 *   由生成型別直接把關);syntheticEmailDomain 注入單一字面來源。
 * - sender = ResendEmailSenderAdapter(RESEND_API_KEY 與告警管道共用同一把 key、from=ORDER_EMAIL_FROM 交易信專用寄件者
 *   〔E1 定案 orders@pcmmotorsports.com,兩 Vercel project 都要設;缺 → requireEnv throw → route 503 fail-closed〕)。
 */
export function getSweepEmailOutboxDeps(): SweepEmailOutboxDeps {
  // 🔴 **一個 service_role client,兩個 adapter 共用**(2026-08-22 E4-b)。
  //    ⚠️ 原本這裡只有一個消費端,所以直接內聯呼叫;加第二個時**不要再呼叫一次** ——
  //    既有測試有一格釘住 `createSupabaseServiceClient` 在本 factory 內**只被呼叫一次**,
  //    而那一格守的是「本 factory 不會偷偷多開一條連線」。
  const serviceClient = createSupabaseServiceClient();
  const outbox = new SupabaseEmailOutboxAdapter(serviceClient, {
    syntheticEmailDomain: LINE_SYNTHETIC_EMAIL_DOMAIN,
  });
  const sender = new ResendEmailSenderAdapter({
    apiKey: requireEnv('RESEND_API_KEY'),
    from: requireEnv('ORDER_EMAIL_FROM'),
  });
  // 🔴 **M-4b E4-b(2026-08-22):這一行就是那份 plan 講了很久的「刻意沒接的那一行」。**
  //    它讓 sweeper 在寄出貨信時**查得到主表**(品項 / 追蹤碼 / 箱號)。
  //
  // 🔴🔴 **而它【不會】讓任何一封信被寄出去。** 打開閘的是 `buildEmailText` 對 `order_shipped`
  //    的那個 case,而它今天仍然 `throw`(片3 才動)。
  //    ⇒ `sweep-email-outbox.test.ts` 有一格特別釘住這件事:**給了 `shippedContext` 也一樣不寄**。
  //    ⚠️ 少了那一格,「接上這一行」與「開始寄信」在交件上分不出來。
  //
  // 🔴 service_role 的第三個用途:它讀 shipments / shipment_items / order_items / orders,
  //    其中 `orders` 含 PII。回傳只進信件內文,不進 log / result(adapter 檔頭明文)。
  const shippedContext = new SupabaseShippedEmailContextAdapter(serviceClient);
  return { outbox, sender, shippedContext };
}

/**
 * 建 `EnqueueOrderCreatedEmailsDeps`(M-4a B-5 掃描式 enqueue;email-sweep route 在 sweeper **之前**跑)。
 *
 * 🔴🔴 **刻意【不共用】`getSweepEmailOutboxDeps()`**(plan §3.1,這是本 factory 存在的全部理由):
 *    那支會 `requireEnv('RESEND_API_KEY')` 與 `requireEnv('ORDER_EMAIL_FROM')`,缺就 throw ⇒ route 503。
 *    若 enqueue 共用它,**Resend 還沒設 env 的那段期間,連「把信排進 outbox」都不會發生**
 *    —— 而那正是今天的狀態(那兩顆 env 在正式站的現值我量不到、repo 側無管道)。
 *    ⇒ 分開的 deps ⇒ **信先排進去,寄的那半晚點再開**,兩件事互不綁死。
 *    ⚠️ 改動這裡之前先問:我是不是又把「排信」綁回「寄信」的前置條件上了?
 *
 * 🔴 lazy 契約同檔頭:env 在此讀、非 module-top(本 factory 其實一顆 env 都不讀,更不該破例)。
 * 🔴 scanner 與 outbox **共用 service_role** —— scanner 讀 orders / email_outbox / customers 三張表,
 *    其中兩張含 PII;它回的 email 只准被交給 `outbox.enqueue`(port 檔頭明文)。
 */
export function getEnqueueOrderCreatedDeps(): EnqueueOrderCreatedEmailsDeps {
  return {
    outbox: new SupabaseEmailOutboxAdapter(createSupabaseServiceClient(), {
      syntheticEmailDomain: LINE_SYNTHETIC_EMAIL_DOMAIN,
    }),
    scanner: new SupabasePaidOrderScannerAdapter(createSupabaseServiceClient()),
  };
}

/**
 * 建 `ApplyOrderIneligibleGateDeps`(M-4a E2a-2、W3-G 拆出:寄送前 ineligible gate;
 * **獨立 cron route,不掛 email-sweep**——歸屬邊界見 sweep-email-outbox.test.ts:53)。
 *
 * 🔴🔴 **刻意【不共用】`getSweepEmailOutboxDeps()`**(同 `getEnqueueOrderCreatedDeps` 的理由):
 *    那支會強制檢查 Resend 兩顆 env、缺就 throw。本片只需要 claimById/markSkippedOrderIneligible,
 *    不寄任何信,不該被 Resend env 卡住。
 * 🔴 lazy 契約同檔頭:本 factory 零 env 讀取。
 * 🔴 outbox 與 scanner 共用 service_role(scanner 讀 email_outbox + orders,零 PII 回傳——只回
 *    id/orderId,見 port 檔頭)。
 */
export function getApplyOrderIneligibleGateDeps(): ApplyOrderIneligibleGateDeps {
  return {
    outbox: new SupabaseEmailOutboxAdapter(createSupabaseServiceClient(), {
      syntheticEmailDomain: LINE_SYNTHETIC_EMAIL_DOMAIN,
    }),
    scanner: new SupabaseIneligibleOrderEmailScannerAdapter(createSupabaseServiceClient()),
  };
}
