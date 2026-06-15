// app/checkout/callback/page.tsx — TapPay 3DS frontend_redirect_url 導回完成頁(M-3 3DS-3)
//
// 3DS charge 回 payment_url → 銀行 OTP → 把使用者**瀏覽器 GET 導回**本頁(整頁導航、非 server→server)。
// 故本頁是 **Next Server Component page**(渲染完成頁 HTML),非 api route(master plan §2 字面 `app/api/...`
// 為 label、以本實作為準;理由 plan §5.0)。server→server 的 backend_notify_url = webhook(3DS-2、另檔)。
//
// 🔴 處理序(plan §5.1、零信任 + IDOR 歸屬閘 + Record 唯一權威):
//   1. getUser()(向 auth server 驗 JWT、對齊 checkout/page.tsx)→ throw → 泛用處理中(fail-closed)/ 無 → /login。
//   2. 零信任:searchParams.order = 我方 orderId(orders.id UUID);URL 其他欄(status/rec)一律不採信
//      (成交權威 100% 在 settleCharge 內 Record API)。非 UUID → 泛用處理中(不打 Record、不洩)。
//   3. 🔴 IDOR 歸屬閘(**唯一歸屬防線**、N1):settleCharge 為 cookieless 無 ownership 檢查 → 必先以使用者 cookie
//      讀 orders(RLS orders_select_own:customer_user_id=auth.uid())。無 row(PGRST116/非本人/不存在/throw)
//      → 硬 early-return 泛用處理中:不洩他人 display_id/狀態、不打 Record、不清車。任何 edge 不 fall-through 到 settle。
//   4. 歸屬通過 → settleCharge(getSettleChargeDeps() cookieless 主軌、Record 權威);throw 全 catch → pending
//      (fail-closed、不 500、不偽 paid)。
//   5. outcome → 變體(displayId 一律取自步驟3 歸屬讀、不依賴 settleCharge):
//        paid              → 訂單已成立 + 清品項(A4)
//        pending|no_attempt→ 處理中     + 清品項(A4;N2:真導回應有 attempt、no_attempt 屬異常態、清車=安全優先非 bug)
//        failed            → 付款未完成  + 不清車(Sean D4、車保留可立即重結帳;CTA 返回購物車)
//
// 🔴 Record 重打放大:settleCharge step2「order 已 paid → 不打 Record」短路 → paid 後刷新廉價;pending 重刷仍重打,
//    跨路徑 per-order recently-settled skip 由 3DS-4 統一補(本片不寫限流、誠實邊界、同 webhook)。
// ⚠️ 中間態誠實:本頁 Phase I 建好但無真 3DS 流量(frontend_redirect 在 Phase II 3DS-5b 才構造);部署 ≠ 開放結帳。
//
// @see docs/specs/2026-06-15-m3-3ds-3-callback-route-plan.md §5.0-§5.5
// @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §1(a)/§2(3DS-3)/§4

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettleChargeDeps } from '@/lib/payment/composition';
import { settleCharge } from '@pcm/use-cases';
import type { SettleChargeOutcome } from '@pcm/domain';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';
import { ClearCartOnSuccess } from '@/components/ClearCartOnSuccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '訂單結果 — PCM Motorsports',
  robots: { index: false, follow: false }, // 個別訂單結果頁、不索引
};

/** orderId = orders.id uuid → 零信任形狀過濾(非 UUID 不打 Record、不查歸屬)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 處理中文案(常數單一真相);不引用單號(泛用態無 displayId、歸屬態 displayId 由 CheckoutSuccess 區塊另顯)。 */
const PROCESSING_MSG =
  '我們正在確認你的付款結果,若已扣款將自動為你成立訂單,請稍候片刻或留意 email 通知。';
/** 失敗文案(常數單一真相);失敗不清車、車保留可重結帳。 */
const FAILED_MSG = '這筆付款未完成,購物車已為你保留,可重新結帳。若你已被扣款,請保留下方單號聯繫客服。';

/** 泛用處理中(未確認歸屬:無 displayId、不清車〔避免他人連結清空本人車〕、不打 Record)。N1 硬 early-return 共用。 */
function renderProcessingGeneric() {
  return <CheckoutSuccess variant="processing" message={PROCESSING_MSG} />;
}

/** searchParams 值規範化:取首值(string[] 取 [0]、undefined 透傳)。 */
function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CheckoutCallbackRoute({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createServerSupabaseClient();

  // 1. getUser(throw → fail-closed 泛用處理中;無 → /login)。redirect 在 try 外(NEXT_REDIRECT 須上拋)。
  let userId: string | null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    return renderProcessingGeneric();
  }
  if (!userId) redirect('/login');

  // 2. 零信任:order = 我方 orderId(UUID);非 UUID → 泛用(不打 Record、不查歸屬)。
  const sp = await searchParams;
  const orderId = firstParam(sp.order);
  if (!orderId || !UUID_RE.test(orderId)) {
    return renderProcessingGeneric();
  }

  // 3. 🔴 IDOR 歸屬閘(唯一歸屬防線、N1):RLS orders_select_own 只回本人單;無 row/throw → 泛用(不洩、不 settle)。
  //    🔴 應用層縱深(codex 關卡2):RLS 已守、再顯式 `.eq('customer_user_id', userId)` —— RLS 萬一誤設/停用
  //    亦不洩他人單(belt-and-suspenders;userId=getUser 驗過的 auth.uid()、與 RLS 條件同值)。
  let displayId: string;
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('display_id')
      .eq('id', orderId)
      .eq('customer_user_id', userId)
      .single();
    if (error || !data) {
      return renderProcessingGeneric();
    }
    displayId = (data as { display_id: string }).display_id;
  } catch {
    return renderProcessingGeneric();
  }

  // 4. 歸屬通過 → settleCharge(cookieless 主軌、Record 唯一權威);throw → pending(fail-closed、不 500、不偽 paid)。
  let outcome: SettleChargeOutcome;
  try {
    outcome = await settleCharge(getSettleChargeDeps(), { orderId });
  } catch {
    outcome = { kind: 'pending', reason: 'record_unreachable' };
  }

  // 5. outcome → 變體(displayId 取自步驟3 歸屬讀)。
  if (outcome.kind === 'failed') {
    // 明確未成功(settleCharge markFailed 已釋鎖)→ 失敗、不清車、CTA 返回購物車(Sean D4)。
    return <CheckoutSuccess variant="failed" displayId={displayId} message={FAILED_MSG} />;
  }
  if (outcome.kind === 'paid') {
    return (
      <>
        <CheckoutSuccess variant="paid" displayId={displayId} />
        <ClearCartOnSuccess />
      </>
    );
  }
  // pending | no_attempt → 處理中 + 清品項(A4)。
  // N2:真 3DS 導回應有 active attempt;no_attempt 屬異常態(attempt 已被先前路徑 markFailed / 從未建立)→
  //     此處併入清車為「安全優先」(可能已扣款、防殘車重複扣款),非 bug。
  // ⚠️ A4 已知邊界(codex 關卡2 consider):若前次 callback 已 failed(markFailed 釋鎖),刷新同 URL → attempt
  //    不再 active → 轉 no_attempt → 清車,弱化「failed 保留購物車」體感。屬 A4 字面(no_attempt 清車)、且良性
  //    (失敗未扣款、品項可重加、無雙扣);失敗刷新保留車需 failed-state reader(留 3DS-4/讀路徑、本片不做)。
  return (
    <>
      <CheckoutSuccess variant="processing" displayId={displayId} message={PROCESSING_MSG} />
      <ClearCartOnSuccess />
    </>
  );
}
