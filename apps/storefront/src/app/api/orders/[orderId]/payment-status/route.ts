// app/api/orders/[orderId]/payment-status/route.ts — 會員自查單一訂單付款狀態(M-3 3DS-S2 callback 自動輪詢)
//
// 用途:3DS callback 完成頁(/checkout/callback)停在「處理中」時,client 端 PollOrderStatus 背景輪詢本端點;
//   背景(webhook after / sweeper cron)把訂單推成立後,輪詢讀到 paid → callback 頁 router.refresh() 自動跳成功頁。
//
// 🔴 鐵則 12(payment 讀路徑 + IDOR + 威脅模型;plan §⑤ 安全紅線):
//   1. **IDOR own-only(唯一歸屬防線)**:雙軸 —— ① RLS `orders_select_own`(auth.uid()=customer_user_id、DB 層)
//      ② 應用層縱深 `.eq('customer_user_id', userId)`(RLS 萬一誤設/停用亦不洩他人單;userId=getUser 驗過的 auth.uid())。
//      `getUser()` 向 auth server 驗 JWT(不信任 client 送欄);throw/無 → 401。偽造他人 orderId 只查到自己單(無 row→404)。
//   2. **經銷價零洩漏**:select **只取 `payment_status` 單欄**;回應**只含 `{ status: 'paid'|'pending' }`**(零金額/零
//      displayId/零 PII/零價格欄)。client 只需「成立了沒」,不需任何金額。
//   3. **fail-closed(不偽 paid/不偽 failed)**:查無/非本人 → 404;DB error → 500;非 paid(unpaid/partiallyPaid/
//      refunded)→ `{status:'pending'}`(不細分、不偽 paid)。500/404/401 一律 **null body**(零 raw error.message 洩漏)。
//   4. **不改 settleCharge**:本端點**只讀 `orders.payment_status`、不呼叫 settleCharge**(S2 default A、不碰成立判定)。
//      payment_status 由背景(webhook after / sweeper)推進;本端點純反映。
//
// ⚠️ 誠實中間態(plan §⑦ Q1):default A 下「Record 延遲同步」情境的「幾秒即時成立」依賴生產 sweeper 升頻或 webhook
//    即時收斂(S6/§5.4);本端點只負責「輪詢機制 + fail-closed」本身,不承諾即時成立。
//
// @see docs/specs/2026-06-21-m3-3ds-s2-callback-polling-plan.md §⑤/§⑥ 步驟1
// @see apps/storefront/src/app/checkout/callback/page.tsx(IDOR 歸屬閘同 pattern)
// @see apps/storefront/src/components/PollOrderStatus.tsx(client 輪詢方)

import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** orderId = orders.id uuid;零信任形狀過濾(非 UUID 不查、不洩;對齊 callback page L47)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 動態狀態、不快取(含錯誤碼;codex 關卡2 consider:避免瀏覽器/中介快取 401/404/500)。 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** 錯誤回應:null body(零洩漏面、零 raw error.message)+ no-store(防快取狀態碼)。 */
function fail(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
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

  // 2. 建 client(env/cookie factory throw → 500 fail-closed;codex 關卡2 consider:不繞過 500 null body 政策)。
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
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

  // 4. 🔴 RLS own-only 讀 payment_status(雙軸縱深 `.eq('customer_user_id', userId)`);查無/非本人 → 404 fail-closed。
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('payment_status')
      .eq('id', orderId)
      .eq('customer_user_id', userId)
      .maybeSingle();
    if (error) {
      // DB 錯 → 500(null body、零內部訊息洩漏);client 計入次數續試/最終 fail-closed。
      return fail(500);
    }
    if (!data) {
      // 查無 / 非本人(RLS 擋)→ 404 fail-closed(不偽 paid、不洩他人單存在性)。
      return fail(404);
    }
    // 🔴 只回 status 字串(零金額/零 PII)。非 paid(unpaid/partiallyPaid/refunded)一律 pending(不偽 paid)。
    const status = (data as { payment_status: string }).payment_status === 'paid' ? 'paid' : 'pending';
    return Response.json({ status }, { status: 200, headers: NO_STORE });
  } catch {
    // 連線層 throw → 500 fail-closed(null body)。
    return fail(500);
  }
}
