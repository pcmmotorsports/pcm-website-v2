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
//        paid       → 訂單已成立 + 清品項(A4)
//        pending    → 處理中     + 清品項(A4;可能已扣款、鎖仍持 → 清車防雙扣)
//        no_attempt → 處理中     + 🔴 不清車(必然未扣款〔failed/never〕、清車無收益且摧毀失敗付款的車;codex K2 r1 must-fix、Sean A)
//        failed     → 付款未完成  + 不清車(Sean D4、車保留可立即重結帳;CTA 返回購物車)
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
import { PollOrderStatus } from '@/components/PollOrderStatus';
import { ClearPaymentInflight } from '@/components/ClearPaymentInflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '訂單結果 — PCM Motorsports',
  robots: { index: false, follow: false }, // 個別訂單結果頁、不索引
};

/** orderId = orders.id uuid → 零信任形狀過濾(非 UUID 不打 Record、不查歸屬)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 中性處理中文案(泛用態 / no_attempt 用);**不斷言已收款** —— no_attempt ⟺ failed/never 必然未扣款、泛用態未歸屬
 * (S2 codex 關卡1 must-fix:原為單一共用常數,若改成「已收到付款」會讓此二態謊稱已收款=UX 偽付款確認)。
 * 不引用單號(泛用態無 displayId、歸屬態 displayId 由 CheckoutSuccess 區塊另顯)。
 */
const PROCESSING_MSG =
  '我們正在確認你的付款結果,若已扣款將自動為你成立訂單,請稍候片刻或留意 email 通知。';
/**
 * owned pending 文案(S2、§5.5 三要點:已收到付款語意 + 銀行授權成功為正常 + 勿重複付款);**只給已歸屬 + pending 變體**
 * (= 可能已扣款、鎖仍持),可斷言;搭配 PollOrderStatus 背景輪詢、成立自動跳成功頁。
 */
const OWNED_PENDING_MSG =
  '你的付款正在確認中。若銀行已授權扣款(你可能已收到銀行簡訊),系統會自動為你成立訂單,請勿重複付款;可稍候片刻,或留意 email 通知。';
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
    return (
      <>
        <CheckoutSuccess variant="failed" displayId={displayId} message={FAILED_MSG} />
        {/* 🔴 P3:付款明確失敗、不再進行中 → 清 in-flight 記號(避免重結帳被誤提醒)。 */}
        <ClearPaymentInflight />
      </>
    );
  }
  if (outcome.kind === 'paid') {
    return (
      <>
        <CheckoutSuccess variant="paid" displayId={displayId} />
        {/* 🔴 3DS-7 Q4=A:DB 確定 paid → regenerate 換新 key(防下次重購撞已 paid sibling 被誤擋)。 */}
        <ClearCartOnSuccess regenerate />
        {/* 🔴 P3:付款成交、不再進行中 → 清 in-flight 記號。 */}
        <ClearPaymentInflight />
      </>
    );
  }
  // 🔴 no_attempt → 處理中、**不清車**(codex 關卡2 r1 must-fix、Sean 拍 A)。
  // settleCharge 契約(settle-charge.ts L54-71):findActiveByOrderId 找 active=pending|charged|released(R1b3/R2a);**無 active 才**
  //   回 no_attempt;「order 已 paid → paid」短路(L68-71)在 findActive「之後」、且 charged 仍屬 active → 已付款單
  //   回 paid、不會落 no_attempt。故 no_attempt ⟺ attempt 已 markFailed(僅 TapPay 確認 final-failed -1/5)或從未
  //   建立 → **必然未扣款**。A4「可能已扣款 → 清車防雙扣」前提對 no_attempt 不成立 → 清車零安全收益、卻會在失敗
  //   付款(常見 webhook vs redirect 競態打首屏)摧毀購物車 → 故保留車(= A4 真意=防雙扣、非機械式清)。
  // ⚠️ 已知文案瑕疵:no_attempt 顯「處理中」而非「付款未完成」(顯真 failed 需 failed-state reader、留讀路徑/3DS-4)。
  if (outcome.kind === 'no_attempt') {
    return (
      <>
        <CheckoutSuccess variant="processing" displayId={displayId} message={PROCESSING_MSG} />
        {/* 🔴 P3:no_attempt ⟺ 必然未扣款、不再進行中 → 清 in-flight 記號。 */}
        <ClearPaymentInflight />
      </>
    );
  }
  // pending(owned)→ 處理中 + 清品項 + 背景輪詢。pending(record_unreachable/auth_or_pending/unverified)= **可能已扣款**、
  //   鎖仍持 → 清車防殘車誘導重複扣款(對齊既有 useChargePayment processing 清車政策);文案用 OWNED_PENDING_MSG
  //   (已歸屬可斷言、§5.5 三要點;S2 codex K1 must-fix 文案拆分)。PollOrderStatus 背景輪詢付款狀態、成立→自動跳成功頁(S2)。
  return (
    <>
      <CheckoutSuccess variant="processing" displayId={displayId} message={OWNED_PENDING_MSG} />
      {/* 🔴 3DS-7:pending=可能已扣未定 → 清品項但**不 regenerate**(保留 key 讓 dedup 守既有單、防雙扣;plan §3 7b 表)。 */}
      <ClearCartOnSuccess />
      <PollOrderStatus orderId={orderId} />
    </>
  );
}
