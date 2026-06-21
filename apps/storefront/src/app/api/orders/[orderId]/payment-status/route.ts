// app/api/orders/[orderId]/payment-status/route.ts — 會員自查單一訂單付款狀態(M-3 3DS-S2 輪詢 + S2b 主動結算)
//
// 用途:3DS callback 完成頁(/checkout/callback)停在「處理中」時,client 端 PollOrderStatus 背景輪詢本端點;
//   背景(webhook after / sweeper cron)或 **本端點自身**(S2b)把訂單推成立後,輪詢讀到 paid → callback 頁
//   router.refresh() 自動跳成功頁。
//
// 🔴 鐵則 12(payment 讀路徑 + 會員可觸發 settleCharge 入口 + IDOR + 威脅模型;plan §⑤/§6.4 安全紅線):
//   1. **IDOR own-only(唯一歸屬防線)**:雙軸 —— ① RLS `orders_select_own`(auth.uid()=customer_user_id、DB 層)
//      ② 應用層縱深 `.eq('customer_user_id', userId)`(RLS 萬一誤設/停用亦不洩他人單;userId=getUser 驗過的 auth.uid())。
//      `getUser()` 向 auth server 驗 JWT(不信任 client 送欄);throw/無 → 401。偽造他人 orderId 只查到自己單(無 row→404)。
//      🔴 settleCharge 必在 own-only 第一讀「**後**」才可能被呼;偽造他人 orderId(404)/未登入(401)硬 early-return、
//      **絕不呼 throttle/settleCharge**(不觸發任何結算)。
//   2. **經銷價零洩漏**:select **只取 `payment_status` 單欄**;回應**只含 `{ status: 'paid'|'pending' }`**(零金額/零
//      displayId/零 PII/零價格欄)。settleCharge 回的 displayId/金額/outcome **絕不入回應**;狀態 100% 由重讀
//      `orders.payment_status` 反映。client 只需「成立了沒」,不需任何金額。
//   3. **fail-closed(不偽 paid/不偽 failed)**:第一讀查無/非本人 → 404;DB error → 500;throttle RPC / settleCharge
//      throw → skip、不 500、不偽;非 paid → `{status:'pending'}`(不細分)。500/404/401 一律 **null body**(零洩漏)。
//   4. **S2b 主動結算 + durable throttle(Sean Q1=B)**:own-only 閘後、訂單 raw `payment_status==='unpaid'` 時,
//      過 `claim_order_poll_settle` per-order throttle 閘(同 orderId 窗內最多放行一次、防會員 spam 打爆 TapPay Record)
//      後呼一次 `settleCharge`(= 三路共呼模型第四路 caller、**不改 settleCharge 內部**、cookieless 主軌、與 callback
//      page 同呼法)→ Record 同步後即成立。partiallyPaid/refunded **不觸發 settle**(對齊 throttle RPC unpaid 閘、
//      不干擾 4a-2 sweeper 回收路徑)。throttle 走 payment_confirmer 窄權主軌(getPollSettleThrottle)。
//
// ⚠️ 誠實中間態:throttle migration(claim_order_poll_settle)在 Q2=A 下未 db push;正式暫無此 RPC 時 throttle 呼叫
//    throw → 端點 fail-closed skip settle = 退回只讀行為(正式結帳 flag 鎖、此端點 S6 前幾無真流量;plan §5.3)。
//
// @see docs/specs/2026-06-21-m3-3ds-s2b-poll-settle-throttle-plan.md §6.4
// @see apps/storefront/src/app/checkout/callback/page.tsx(IDOR 歸屬閘同 pattern + settleCharge 同呼法)
// @see apps/storefront/src/components/PollOrderStatus.tsx(client 輪詢方)

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPollSettleThrottle, getSettleChargeDeps } from '@/lib/payment/composition';
import { settleCharge } from '@pcm/use-cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** orderId = orders.id uuid;零信任形狀過濾(非 UUID 不查、不洩;對齊 callback page L48)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 動態狀態、不快取(含錯誤碼;避免瀏覽器/中介快取 401/404/500)。 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** 🔴 per-order poll-settle throttle 窗(秒;Sean Q3=A):同單窗內最多放行一次 settle/打一次 Record。 */
const POLL_SETTLE_THROTTLE_SECONDS = 10;

/** 錯誤回應:null body(零洩漏面、零 raw error.message)+ no-store(防快取狀態碼)。 */
function fail(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
}

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type ReadResult =
  | { kind: 'ok'; paymentStatus: string }
  | { kind: 'notfound' } // 查無 / 非本人(RLS 擋)
  | { kind: 'error' }; //   DB / 連線層失敗

/**
 * 🔴 own-only 讀 raw payment_status(雙軸縱深 `.eq('customer_user_id', userId)`);只取單欄、零金額/零 PII。
 * 回 raw 字串(供 settle 閘判 `unpaid` + 對外折 paid/pending);呼叫端依 kind 映 404/500/狀態。
 */
async function readOwnPaymentStatus(
  supabase: SupabaseClient,
  orderId: string,
  userId: string,
): Promise<ReadResult> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('payment_status')
      .eq('id', orderId)
      .eq('customer_user_id', userId)
      .maybeSingle();
    if (error) {
      return { kind: 'error' }; // DB 錯 → 上層 500(null body、零內部訊息洩漏)
    }
    if (!data) {
      return { kind: 'notfound' }; // 查無 / 非本人(RLS 擋)→ 上層 404 fail-closed
    }
    return { kind: 'ok', paymentStatus: (data as { payment_status: string }).payment_status };
  } catch {
    return { kind: 'error' }; // 連線層 throw → 上層 500 fail-closed
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  // 1. 零信任:orderId 須為 UUID 形狀;否則 400(不查 DB、不洩;與 401/404/500 統一 null body + no-store)。
  const { orderId } = await params;
  if (!orderId || !UUID_RE.test(orderId)) {
    return fail(400);
  }

  // 2. 建 client(env/cookie factory throw → 500 fail-closed;不繞過 500 null body 政策)。
  let supabase: SupabaseClient;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return fail(500);
  }

  // 3. getUser(向 auth server 驗 JWT);throw/無 → 401(不揭、null body)。
  let userId: string | null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    return fail(401);
  }
  if (!userId) {
    return fail(401);
  }

  // 4. 🔴 own-only 第一讀(安全閘、嚴格):查無/非本人 → 404;DB 錯 → 500;paid → 直接回 paid(不結算、不打 Record)。
  const first = await readOwnPaymentStatus(supabase, orderId, userId);
  if (first.kind === 'error') {
    return fail(500);
  }
  if (first.kind === 'notfound') {
    return fail(404); // 偽造他人 orderId / 不存在 → 不呼 throttle/settle、不洩他人單存在性
  }
  if (first.paymentStatus === 'paid') {
    return Response.json({ status: 'paid' }, { status: 200, headers: NO_STORE });
  }

  // 5. 🔴 S2b:訂單 raw `unpaid` 時,過 per-order throttle 閘後主動呼一次 settleCharge(第四路 caller、不改其內部)。
  //    settle 閘用 raw `=== 'unpaid'`(非 `!== 'paid'`):partiallyPaid/refunded 不觸發 settle(對齊 throttle RPC
  //    unpaid 閘、不干擾 4a-2 sweeper flag_non_unpaid_active 回收路徑)。全包 try/catch fail-closed:
  //    throttle RPC / settleCharge throw → skip、不 500、不偽 paid;客人續輪詢(背景 webhook/sweeper 仍會收斂)。
  if (first.paymentStatus === 'unpaid') {
    try {
      const allowed = await getPollSettleThrottle().claimPollSettle(orderId, POLL_SETTLE_THROTTLE_SECONDS);
      if (allowed) {
        await settleCharge(getSettleChargeDeps(), { orderId });
      }
    } catch {
      /* throttle RPC(正式暫無此 RPC)/ settleCharge throw → fail-closed skip(不 500、不偽) */
    }
  }

  // 6. own-only 重讀反映 settle 後狀態(settleCharge confirm 交易性、orders→paid 已 commit;outcome 不入回應)。
  //    第二讀 'error'/notfound 一律 fail-closed → pending(不在 settle 後 500;客人續輪詢無害)。
  const second = await readOwnPaymentStatus(supabase, orderId, userId);
  const status = second.kind === 'ok' && second.paymentStatus === 'paid' ? 'paid' : 'pending';
  return Response.json({ status }, { status: 200, headers: NO_STORE });
}
