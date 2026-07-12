// M-4a M0-S3 SSO state cookie —— 防 login CSRF 的綁定值 + 回程 returnTo 載體。
//
// 🔴 SameSite=Lax(絕非 Strict):callback 那一跳是「從報價單網域導回 admin」的跨站頂層 GET 導航,
//    Strict cookie 在跨站頂層導航中不會被送出(dev 用 lax 會過、prod 用 strict 才炸的典型陷阱)。
// 🔴 TTL 與報價單 code 的 60s 脫鉤:使用者可能先點「網站管理」才去登入報價單,那段可能 >60s;
//    state cookie 用分鐘量級,否則「先點連結再登入」這條真實路徑會常態失敗。
// 🔴 returnTo 全程只存在本 cookie(admin 網域、不出境),callback 取用前再驗一次(Fable MF3):
//    不隨 URL 帶去報價單繞一圈,否則回程值可被中間節點竄改、start 時驗過的 regex 管不到 = open redirect 繞過。
// 相對 import 見 session.ts 註解。
import { b64urlDecodeString, b64urlEncodeString } from '../base64url';
import { IS_PROD } from '../session/session';

export const SSO_STATE_COOKIE = IS_PROD ? '__Host-pcm_sso_state' : 'pcm_sso_state_dev';
export const SSO_STATE_MAX_AGE_SEC = 60 * 10; // 10 分鐘(與 code 60s 脫鉤)
const MAX_STATE_COOKIE_LEN = 1024; // 塞爆防護(state 128-bit + returnTo ≤512,base64url 後仍遠小於此)

/** state cookie set 選項(SameSite=Lax、httpOnly、prod 才 Secure/__Host-)。 */
export function stateCookieOptions() {
  return { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/', maxAge: SSO_STATE_MAX_AGE_SEC };
}

/** 清除 state cookie 選項(maxAge=0;成功 / 失敗路徑都清)。 */
export function clearStateCookieOptions() {
  return { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/', maxAge: 0 };
}

/** 128-bit hex state(login CSRF 綁定值;報價單側以 state_hash 綁進 code)。 */
export function newState(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// returnTo 嚴格白名單:須 `/` 開頭且第二字非 `/`|`\`(擋 //evil、/\evil 的 open-redirect 繞過),
//   全程只允許 [A-Za-z0-9/_-](無 scheme、無 `@`、無 `.`〔目前 admin 路由皆無副檔名,擋掉是保守面,見 Fable nit-10〕)。
const RETURN_TO_RE = /^\/(?![/\\])[A-Za-z0-9/_-]*$/;

/** 驗 returnTo;不合法 / 過長 / 指回 SSO 控制路徑 → 預設 '/'。start 與 callback 兩處都呼叫(取用前再驗)。 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length > 512 || !RETURN_TO_RE.test(raw)) return '/';
  // 🔴 擋 next=/api/sso/*(Fable nit-6):登入成功又導回 SSO 入口 = 連結可觸發的重導迴圈 / 登入 DoS。
  if (raw.startsWith('/api/sso/')) return '/';
  return raw;
}

/** state cookie 值 = base64url(JSON{s:state, r:returnTo})。非加密 transport 編碼:整合性由 callback 的
 *  「s===query.state」比對 + returnTo 再驗提供,故不需簽章。 */
export function encodeStateCookie(state: string, returnTo: string): string {
  return b64urlEncodeString(JSON.stringify({ s: state, r: safeReturnTo(returnTo) }));
}

/** 解 state cookie。形狀不對 / 解碼失敗 → null(callback 據此拒)。returnTo 於此再過一次 safeReturnTo。 */
export function decodeStateCookie(value: string | undefined | null): { s: string; r: string } | null {
  if (!value || value.length > MAX_STATE_COOKIE_LEN) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecodeString(value));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.s !== 'string' || !/^[0-9a-f]{32}$/.test(o.s)) return null;
  return { s: o.s, r: safeReturnTo(typeof o.r === 'string' ? o.r : null) };
}
