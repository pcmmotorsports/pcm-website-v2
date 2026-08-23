import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/audit/context';
import {
  ADMIN_SESS_COOKIE,
  adminSessionCookieOptions,
  buildAdminSession,
  signSession,
} from '@/lib/session/session';
import { getSsoConfig } from '@/lib/sso/config';
import { exchangeCode } from '@/lib/sso/exchange';
import { identityDropTrace } from '@/lib/sso/identity-drop-trace';
// 🔴 M-4b:改叫 `recordSsoLogin`(它自己會先寫 console 再 best-effort 進 DB)。
//    ~~原本直接叫 `logSsoLogin`~~ —— 兩個分開叫的話,下一個人加第五處失敗路徑時
//    很可能只叫其中一個,而**那時 DB 少一列不會有任何東西紅**。
import { recordSsoLogin } from '@/lib/sso/login-event';
import {
  SSO_STATE_COOKIE,
  clearStateCookieOptions,
  decodeStateCookie,
  safeReturnTo,
} from '@/lib/sso/state';

// M-4a M0-S3 SSO 收端 — callback:收 opaque code。
//   驗 state cookie 相符(login CSRF)→ server-to-server 兌換 → 簽 admin session(新 sid=旋轉)
//   → set session cookie + 清 state cookie → 303 導向乾淨相對 returnTo(allowlist)。
//   🔴 失敗路徑只清 state cookie、**絕不清 session cookie**(防並發/prefetch:另一個成功請求剛設好的 session
//      被 401 分支清掉;code 一次性、雙擊必一 200 一 401)。proxy 閘放行本路徑(未登入必須可達,否則無限迴圈)。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 失敗:303 到錯誤頁、清 state cookie、no-referrer;不動 session cookie。 */
function failResponse(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/?sso=error', req.url), 303);
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** 設定缺漏 500(帶與其他回應一致的安全標頭;不動任何 cookie)。 */
function configError(): NextResponse {
  const res = NextResponse.json({ error: '設定缺漏' }, { status: 500 });
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = await getRequestId();

  const config = getSsoConfig();
  if (!config) {
    await recordSsoLogin('fail', { requestId, reason: 'config-missing' }, req.headers);
    return configError();
  }

  const decoded = decodeStateCookie(req.cookies.get(SSO_STATE_COOKIE)?.value);
  const code = req.nextUrl.searchParams.get('code');
  const queryState = req.nextUrl.searchParams.get('state');

  // state 綁定:cookie 必須存在且 === query.state(cookie 缺 = 拒),code 必填。
  if (!decoded || !code || !queryState || decoded.s !== queryState) {
    await recordSsoLogin('fail', { requestId, reason: 'state-mismatch' }, req.headers);
    return failResponse(req);
  }

  const result = await exchangeCode(code, decoded.s, config);
  if (!result) {
    await recordSsoLogin('fail', { requestId, reason: 'exchange-failed' }, req.headers);
    return failResponse(req);
  }

  const session = buildAdminSession(result.amr, result.auth_time);
  const token = await signSession(session);
  if (!token) {
    // 🔴 簽不出 = ADMIN_SESSION_SECRET 缺(設定缺漏)→ 顯式 500,不導 /start(否則未登入→/start→…→再簽不出=無限迴圈,Fable REQ4)。
    await recordSsoLogin('fail', { requestId, reason: 'sign-failed-config' }, req.headers);
    return configError();
  }

  const res = NextResponse.redirect(new URL(safeReturnTo(decoded.r), req.url), 303);
  res.cookies.set(ADMIN_SESS_COOKIE, token, adminSessionCookieOptions());
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  const loginEvent = { requestId, amr: result.amr };
  // 🔴 **中間契約(2026-08-23,主視窗裁定)**:B5-a 之前我們【還沒接】`sub`,
  //    而「還沒接」不可以是**安靜**的 —— 上游一開始送,這一行就是唯一的**痕**。
  //    🔴 **是「痕」不是「訊號」(R3 更正)**:全 repo 沒有任何告警接線在讀 console
  //       ⇒ 加了它**仍然沒有任何東西會響**。它買到的是【出事之後查得到】,不是【有人會被通知】。
  //    ⚠️ 既有那兩顆 fuse 看的是**原始碼結構** ⇒ 它們只在「我們做到一半」時響,
  //       對「我們沒開始而上游已經送」這個世界**恆綠**(見 `lib/sso/identity-drop-trace.ts` 檔頭)。
  //
  // 🔴 **只掛 session 這一本(codex must-fix 4)**:route 看得到的 `loginEvent` 是**傳進去的參數**,
  //    **不是 `login-event.ts` 實際 insert 的那個物件**。掛它會出現「**提早退場**」——
  //    B5-a 只把 `sub` 加進參數 ⇒ 本 trace 安靜下來,而 DB 仍然沒有那一欄、身分照樣掉。
  //    ⚠️ **而「安靜」會被讀成「已經好了」,那比每次都印更危險。**
  //    ⇒ DB 那一半由 `login-event-identity-drop-fuse.test.ts` 的原始碼守門接(見該檔)。
  //    ✅ 而「上游送了、兩邊都沒接」這個**今天的**世界仍然叫得出來:session 這本也沒有 `sub`。
  //
  // ✅ **它會自己退場,而前提寫在 `identity-drop-trace.ts` 檔頭** —— 那裡也寫了它不成立的那條路。
  let identityDrop: string | null = null;
  try {
    identityDrop = identityDropTrace(result.sub, [
      { name: 'session cookie', payload: session, identityKey: 'sub' },
    ]);
  } catch {
    // 守門自己壞掉 ⇒ 吞掉,登入照常完成(同 login-event.ts 的 best-effort 紀律)。
    identityDrop = null;
  }
  if (identityDrop) {
    // 🔴 **只送一個參數(codex must-fix 5)**:第二個參數一樣會進 Vercel log,
    //    而 PII 那道守門只看回傳字串 ⇒ `console.warn(msg, result.sub)` 會**兩邊照綠而洩漏 staff_id**。
    //    ⇒ 這裡**永遠只送 `identityDrop` 一個字串**,而測試釘住呼叫的參數個數。
    // 🔴 **走 `warn` 不走 `error`(codex nit)**:`security-log.ts` 逐字「成功=info、失敗=warn
    //    (值班撈 warn 即異常登入候選)」—— 一次**成功登入但身分掉了**正是那個分類。
    //    而 `error` 會污染 error 篩選、Log Drain 全量轉送時多花錢,**卻不會觸發 Vercel 的 5xx 告警**
    //    ⇒ 它買不到告警,只買到雜訊。
    console.warn(identityDrop);
  }
  await recordSsoLogin('success', loginEvent, req.headers);
  return res;
}
