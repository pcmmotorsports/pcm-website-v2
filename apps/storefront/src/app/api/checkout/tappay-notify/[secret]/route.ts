// app/api/checkout/tappay-notify/[secret]/route.ts — ②-⑥ TapPay backend notify webhook(M-3 3DS-2b)
//
// notify **不可信**(無簽章、WebFetch 官方核實)→ 本 route 只「安全收 + durable 去重落地 + 踢給 settleCharge」、
// **不採信 notify 欄位做成交判斷**(成交權威 100% 在 settleCharge 內 Record API record_status=1 && is_captured)。
//
// 🔴 處理序(plan §4、codex 關卡1 r2 PASS):
//   1. 祕密路徑段:requireNotifySecret() 強度 enforce(≥32 URL-safe)+ safeEqual timing-safe;不符 → 404(不揭存在)。
//   2. body:size cap(413、不解析)→ **hash-before-parse**(raw sha256、不存原文 = PII 零落地)。
//   3. defensive parse(JSON 主 / form fallback)→ 取 0a 白名單欄。
//   4. 廉價 drop(無 DB):缺 rec_trade_id/order_number、order_number 非 UUID、長度越界 → 200 ack drop(不重送垃圾)。
//   5. 🔴 本機 active attempt 存在性閘:findActiveByOrderId throw → 503(fail-closed、TapPay 重送);null → 200 drop
//      (對不上本機單 → 不 insert、不打 Record);found → 續(satisfies「對不上直接丟」、inbox 不膨脹)。
//   6. durable insert(0a record_webhook_event 去重):throw → 503(沒落 DB 不可回 200、令 TapPay 重送)。
//   7. best-effort 快路徑 settleCharge(僅首見;after() 非 durable queue → 最終保證交 3DS-4 sweeper)。
//   8. 回 200。
//
// ⚠️ 誠實邊界(plan §1/§3.2):本 route 只「durable 捕獲 + best-effort 快路徑」;最終結算保證 = 3DS-4 sweeper(未實作)。
//    3DS-4 前不設 TapPay backend_notify_url、不開 TAPPAY_3DS_ENABLED、不開放 prod 結帳(master §2 中間態誠實)。
// 🔴 端點 hard 限流 = Vercel WAF(plan §14 prod 前置、Sean Q1=A);本 route 不寫 code 限流。
//
// @see docs/specs/2026-06-14-m3-3ds-2-webhook-route-plan.md §4/§5/§8
// @see supabase/migrations/20260613120000_m3_3ds_0a_webhook_events.sql

import { timingSafeEqual, createHash } from 'node:crypto';
import { after } from 'next/server';
import { getWebhookInbox, getSettleChargeDeps, getChargeAttemptReader } from '@/lib/payment/composition';
import { requireNotifySecret } from '@/lib/payment/notify-secret';
import { settleCharge } from '@pcm/use-cases';
import type { WebhookEventInput } from '@pcm/domain';

export const runtime = 'nodejs';

/** notify payload 上限(notify 小、防 oversized body 灌儲存/記憶體;codex 關卡1 consider 3)。 */
const MAX_BODY_BYTES = 16 * 1024;
/** orderId = orders.id uuid → 形狀過濾(擋非 UUID order_number、避免後續 $1::uuid cast throw → 503 loop)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 0a 欄長度界(rec_trade_id/bank_transaction_id BETWEEN 1 AND 128;route 先擋避免 RPC RAISE → 503 loop)。 */
const MAX_FIELD_LEN = 128;
/** PG int4 範圍(reported_status/amount 欄;超界選填值省略 → NULL、避免 cast throw → 503)。 */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/** 等長 constant-time 比對;長度不等先回 false(timingSafeEqual 要求等長 Buffer、否則 throw;沿用 line callback)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type ParsedNotify = {
  recTradeId?: string;
  orderNumber?: string;
  reportedStatus?: number;
  amount?: number;
  bankTransactionId?: string;
  transactionTimeMillis?: number;
};

/** 非空字串(trim 後)→ 值;否則 undefined(對齊 0a btrim()='' RAISE、規範化 dedup 鍵;form 值皆字串、JSON 可能他型)。 */
function asStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}
/** 整數(JSON number / form 數字字串)→ number;非整數 / 超 safe-int → undefined(防 PG cast throw → 503 loop)。 */
function asInt(v: unknown): number | undefined {
  let n: number;
  if (typeof v === 'number' && Number.isInteger(v)) n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v)) n = Number(v);
  else return undefined;
  return Number.isSafeInteger(n) ? n : undefined;
}
/** int4 欄(reported_status/amount):超 int4 範圍 → undefined(NULL 落地、非 503;畸形選填欄省略不擋整筆)。 */
function asInt4(v: unknown): number | undefined {
  const n = asInt(v);
  return n !== undefined && n >= INT4_MIN && n <= INT4_MAX ? n : undefined;
}

/**
 * defensive 解析 notify body → 0a 白名單欄。JSON 主(content-type application/json 或 body 以 `{` 起)、
 * 否則 form-urlencoded fallback;malformed → 回空物件(→ 廉價 drop)。**不 log payload**。
 */
function parseNotify(raw: string, contentType: string | null): ParsedNotify {
  let obj: Record<string, unknown>;
  try {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.includes('application/json') || raw.trimStart().startsWith('{')) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      obj = parsed as Record<string, unknown>;
    } else {
      obj = Object.fromEntries(new URLSearchParams(raw).entries());
    }
  } catch {
    return {};
  }
  return {
    recTradeId: asStr(obj.rec_trade_id),
    orderNumber: asStr(obj.order_number),
    reportedStatus: asInt4(obj.status),
    amount: asInt4(obj.amount),
    bankTransactionId: asStr(obj.bank_transaction_id),
    transactionTimeMillis: asInt(obj.transaction_time_millis),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  // 1. 祕密路徑段(強度 enforce + timing-safe)。設定錯 → 500;不符 → 404(不揭存在)。
  let expected: string;
  try {
    expected = requireNotifySecret();
  } catch {
    return new Response(null, { status: 500 });
  }
  const { secret } = await params;
  if (!safeEqual(secret, expected)) {
    return new Response(null, { status: 404 });
  }

  // 2. body size cap(413、不解析)→ hash-before-parse(raw sha256、不存原文)。
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new Response(null, { status: 503 }); // body 串流讀取失敗(transport)→ fail-closed、TapPay 重送
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const rawHash = createHash('sha256').update(raw, 'utf8').digest('hex');

  // 3. defensive parse → 白名單欄。
  const fields = parseNotify(raw, request.headers.get('content-type'));
  const { recTradeId, orderNumber } = fields;

  // 4. 廉價 drop(無 DB):缺鍵 / 非 UUID / 長度越界 → 200 ack drop(不重送垃圾、不打 Record)。
  if (
    !recTradeId ||
    !orderNumber ||
    recTradeId.length > MAX_FIELD_LEN ||
    !UUID_RE.test(orderNumber) ||
    (fields.bankTransactionId !== undefined && fields.bankTransactionId.length > MAX_FIELD_LEN)
  ) {
    return new Response(null, { status: 200 });
  }

  // 5. 🔴 本機 active attempt 存在性閘(DB-only reader、解耦 TapPay env;codex consider):throw(設定/連線)→ 503
  //    fail-closed(TapPay 重送、與 step6 一致);null → 200 drop(對不上本機單 → 不 insert、不打 Record;1b no_attempt
  //    為最後 backstop)。🔴 TapPay env 漂移時 webhook 仍能 durable 落 inbox(快路徑 settleCharge 在 after() 才碰 TapPay)。
  let hasAttempt: boolean;
  try {
    hasAttempt = (await getChargeAttemptReader().findActiveByOrderId(orderNumber)) !== null;
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!hasAttempt) {
    return new Response(null, { status: 200 });
  }

  // 6. durable insert(0a 去重)。throw → 503(沒落 DB 不可回 200、令 TapPay 重送、不丟失)。
  const input: WebhookEventInput = {
    recTradeId,
    orderNumber,
    rawHash,
    reportedStatus: fields.reportedStatus,
    amount: fields.amount,
    bankTransactionId: fields.bankTransactionId,
    transactionTimeMillis: fields.transactionTimeMillis,
  };
  let inserted: boolean;
  try {
    inserted = await getWebhookInbox().recordEvent(input);
  } catch {
    return new Response(null, { status: 503 });
  }

  // 7. best-effort 快路徑(僅首見;after() 非 durable queue → 失敗留 inbox 給 3DS-4 sweeper、log 零 payload)。
  //    🔴 full settleCharge deps(含 TapPay env)在此才建 → durable 捕獲(step5/6)不依賴 TapPay;getSettleChargeDeps
  //    或 settleCharge throw 全 catch、不影響已落 inbox(降級交 sweeper)。
  if (inserted) {
    after(async () => {
      try {
        await settleCharge(getSettleChargeDeps(), { orderId: orderNumber });
      } catch {
        console.error('[tappay-notify] 背景 settleCharge 失敗(留 sweeper 3DS-4 重跑)', { orderId: orderNumber });
      }
    });
  }

  // 8. durable 已落(或明確 drop)→ 200 ack(TapPay 不重送)。
  return new Response(null, { status: 200 });
}
