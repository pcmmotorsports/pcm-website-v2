import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/audit/context';
import {
  ADMIN_SESS_COOKIE,
  adminSessionCookieOptions,
  buildAdminSession,
  signSession,
  ssoChainExpired,
  verifySession,
} from '@/lib/session/session';
import { planStaffGate } from '@/lib/session/read-gate';
import { resolveActiveStaffById } from '@/lib/staff';

// B5-b′ 片二:**靜默續期**。前端在票快到期時 `fetch` 這裡,拿一張新的 15 分鐘票。
//
// 🔴🔴 **為什麼可以自己重簽,而不用跑一趟報價單**(plan §1,附行號):
//    `buildAdminSession` 要的三個東西(`amr` / `auth_time` / `sub`)**舊票上都有**,
//    而 `is_active` 查的是**我們自己的 `staff` 表** ⇒ 這一趟不需要上游參與。
//    ⇒ **零 redirect** ⇒ 使用者頁面狀態不會掉。
//
// 🔴 **本路由【不進】`SSO_OPEN_PATHS`** —— 它自己驗票,
//    不是「未登入可達」的第三條白名單。proxy 的登入閘照樣先擋一次。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 回應形狀 —— **前端要分得出這三種,而它們的處置完全不同。**
 *
 * 🔴 這是本片的**硬需求**,不是 nice-to-have。理由是 2026-08-26 實測到的那條鏈:
 * ```
 * 票過期 ⇒ proxy 回 303 ⇒ /api/sso/start ⇒ 302 ⇒ 跨來源到報價單站
 * 而 fetch() 【預設會跟著 redirect 走】⇒ 跟到跨來源那一跳 ⇒ CORS 擋住
 * ⇒ fetch 失敗, 而失敗是【不透明的】:拿不到狀態碼、看不出發生什麼
 * ```
 * ⇒ 📌 **「靜默續期」只在票還沒過期時成立。晚一秒,失敗會是無聲且看不懂的那種。**
 * ⇒ 所以前端呼叫時要用 `redirect: 'manual'`(見 `components/session/session-renew.tsx`),
 *   而本端點對「還能不能續」給出**明確的、可分辨的**答案。
 */
type RenewOutcome = 'renewed' | 'chain-expired' | 'not-active';

function json(outcome: RenewOutcome, status: number, requestId: string): NextResponse {
  const res = NextResponse.json({ outcome }, { status });
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  // 🔴 回報用的編號要跟得回 log —— 片一那顆的教訓:
  //    一個「請附上編號」的畫面配一個查不到編號的 log, 比不給編號更糟。
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = await getRequestId();
  const payload = await verifySession(req.cookies.get(ADMIN_SESS_COOKIE)?.value);

  // 🔴 票已經無效(過期/簽章不符/缺)⇒ **401,而不是導向。**
  //    導向會讓 fetch 跟到跨來源那一跳 ⇒ 失敗變不透明(見上方那條鏈)。
  //    ⚠️ 而實務上走不太到這裡:proxy 的登入閘會先把它 303 掉。
  //       留著它是因為**「今天走不到」與「這裡有處理」是兩件事** ——
  //       proxy 的 matcher 改一個字,這裡就會變成第一線。
  if (!payload) return json('not-active', 401, requestId);

  // 🔴 **票鏈的絕對上限** —— 續期不經報價單 ⇒ 沒有這道天花板,一張被偷的票可以永遠續。
  //    這一格回 `chain-expired`,而前端**不該靜默重試** —— 它要讓使用者走一次完整登入。
  if (ssoChainExpired(payload)) return json('chain-expired', 401, requestId);

  const gate = planStaffGate(payload.v === 2 ? payload.sub : undefined);
  if (gate.kind === 'require-active-staff') {
    // 🔴 與片一走**同一支** `resolveActiveStaffById` —— 兩邊語意一旦漂掉,
    //    「簽票時算數、續期時不算數」這種狀態會出現,而沒有測試看得到。
    if ((await resolveActiveStaffById(gate.staffId)) === null) {
      return json('not-active', 403, requestId);
    }
  }

  const next = buildAdminSession(
    payload.amr,
    payload.auth_time,
    payload.v === 2 ? payload.sub : undefined,
    // 🔴 **`sso_at` 原封抄過去** —— 讓它重新開始 = 那個 12 小時上限永遠不會到,
    //    而它是本片唯一的天花板。
    { ssoAt: payload.sso_at ?? payload.iat },
  );
  const token = await signSession(next);
  // 簽不出 = 設定壞了(secret 缺)⇒ 不是「他不能續」⇒ 500,讓前端知道是我們壞了。
  if (!token) {
    const res = NextResponse.json({ outcome: 'error' }, { status: 500 });
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const res = json('renewed', 200, requestId);
  res.cookies.set(ADMIN_SESS_COOKIE, token, adminSessionCookieOptions());
  return res;
}
