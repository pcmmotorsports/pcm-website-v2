// M-4a M0-S3 admin session 簽 / 驗 —— SSO 收端成功兌換後,admin 發給瀏覽器的「登入票證」。
//
// ★runtime-neutral 硬規則★(對齊報價單 lib/session.ts 已驗模式):只用 globalThis.crypto.subtle,
//   絕不 import 'node:crypto' 或 '@supabase/supabase-js'。proxy.ts 的 runtime 只是註解宣稱、未證實
//   (盲點掃描指名),用 subtle 則 edge / node 皆可驗,規避該不確定性。也★不在 top-level await★。
//
// Cookie 值 = base64url(payloadJSON) + '.' + base64url(HMAC_SHA256(payloadJSON, ADMIN_SESSION_SECRET))。
// 🔴 過期釘死在 payload.exp、verifySession 檢 exp(Fable MF1);cookie Max-Age 只是 UX,cookie 值一旦外洩,
//    唯有 payload.exp 到期或換 ADMIN_SESSION_SECRET 才失效(stateless、phase1 無 server 端撤銷,見殘餘風險)。
//
// 具名身分不在此 payload:報價單=共用密碼登入,SSO 只帶認證(amr/auth_time)、無 per-user 身分。
//   「操作者是誰」仍走 lib/session/actor.ts 的 picker(到 M-4b 真帳號)。SSO=認證,不是身分綁定。
//
// 相對 import(非 @/):root vitest.config 的 @ alias 指 storefront,被單測引用的 lib 檔必須相對路徑。
import { b64urlFromBytes, b64urlToBytes } from '../base64url';

/** 報價單 exchange 回傳並經 admin 端自驗過的 amr 值(對齊報價單 lib/session.ts SessionAmr)。 */
export type AdminSessionAmr = 'pwd' | 'totp' | 'bootstrap' | 'recovery';

export interface AdminSessionPayload {
  v: 1;
  sid: string; // 128-bit hex;每次簽發新產 = §3.1「旋轉 session id」(stateless 下為衛生,非撤銷)
  iat: number; // unix sec:admin 簽發時刻
  exp: number; // unix sec:iat + TTL;🔴 verifySession 以此欄判過期(非靠 cookie 屬性)
  amr: AdminSessionAmr[]; // 報價單傳來、admin 已白名單過濾
  // 報價單 session.iat。⚠️ 語意=隨 sliding refresh 更新的時刻,非不變登入時刻(報價單端自述)。
  //   step-up「近期驗證過」比對前置=報價單側改存不變值,否則形同虛設;本 slice 只忠實存放。
  auth_time: number;
}

export const IS_PROD = process.env.NODE_ENV === 'production';
// 🔴 secret 最小長度(<32 視為未設、fail-closed):弱 ADMIN_SESSION_SECRET → 離線暴破 HMAC → 偽造任意 admin session(Fable/Codex MF5)。
const MIN_SECRET_LEN = 32;
const strongSecret = (s: string | undefined): string | null => (s && s.length >= MIN_SECRET_LEN ? s : null);
// prod: __Host- 前綴要求 secure + path=/ + 無 Domain;dev(http)不能用 __Host-、且不加 Secure(localhost 全瀏覽器可收)。
export const ADMIN_SESS_COOKIE = IS_PROD ? '__Host-pcm_admin_sess' : 'pcm_admin_sess_dev';
export const ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 12; // 12h(後台、比報價單 24h 稍緊)

/** login / SSO 收端發 cookie 的統一選項。SameSite=Lax:callback 後 303 為同源;Lax 足夠防跨站 CSRF、
 *  且跨站進站(從報價單點連結)不會誤判未登入。 */
export function adminSessionCookieOptions(maxAgeSec: number = ADMIN_SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

// ── HMAC key:依 secret 值快取(secret 變則重載 → 單測可換 env;prod secret 穩定即長快取)。缺 secret → null,fail-closed 絕不 throw。──
let cachedSecret: string | null | undefined;
let cachedKey: Promise<CryptoKey | null> | null = null;
function getKey(): Promise<CryptoKey | null> {
  const secret = strongSecret(process.env.ADMIN_SESSION_SECRET);
  if (secret !== cachedSecret || !cachedKey) {
    cachedSecret = secret;
    cachedKey = (async () => {
      if (!secret) return null;
      return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      );
    })().catch(() => null);
  }
  return cachedKey;
}

/** ADMIN_SESSION_SECRET 是否已設。callback 用來把「簽不出」判為設定缺漏 500(非登入失敗導 /start,防無限迴圈,Fable REQ4)。 */
export function adminSessionSecretConfigured(): boolean {
  return strongSecret(process.env.ADMIN_SESSION_SECRET) !== null;
}

/** 128-bit hex sid。 */
export function newSid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 組 payload(每次新 sid = 旋轉;iat=now、exp=now+TTL)。 */
export function buildAdminSession(
  amr: AdminSessionAmr[],
  authTime: number,
  maxAgeSec: number = ADMIN_SESSION_MAX_AGE_SEC,
): AdminSessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return { v: 1, sid: newSid(), iat: now, exp: now + maxAgeSec, amr, auth_time: authTime };
}

/** 簽出 cookie 字串。ADMIN_SESSION_SECRET 缺 → null(callback 據此回 500,見 REQ4)。 */
export async function signSession(payload: AdminSessionPayload): Promise<string | null> {
  const key = await getKey();
  if (!key) return null;
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return `${b64urlFromBytes(data)}.${b64urlFromBytes(sig)}`;
}

const VALID_AMR = new Set<AdminSessionAmr>(['pwd', 'totp', 'bootstrap', 'recovery']);
const isSafeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

/** 嚴格形狀檢查:缺欄 / 型別不對 / 非安全整數 / v≠1 / sid 非 32-hex / amr 空或不在白名單 / auth_time≤0 → reject。 */
function isPayload(p: unknown): p is AdminSessionPayload {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.sid !== 'string' || !/^[0-9a-f]{32}$/.test(o.sid)) return false;
  if (!isSafeInt(o.iat) || o.iat < 0) return false;
  if (!isSafeInt(o.exp) || o.exp <= 0) return false;
  if (!isSafeInt(o.auth_time) || o.auth_time <= 0) return false;
  if (!Array.isArray(o.amr) || o.amr.length === 0) return false;
  if (!o.amr.every((x) => typeof x === 'string' && VALID_AMR.has(x as AdminSessionAmr))) return false;
  return true;
}

/**
 * 驗 cookie。回 payload 或 null。
 * fail-closed:ADMIN_SESSION_SECRET 缺 / 簽章不符 / 任一欄缺 / 形狀不對 / 過期(exp≤now)→ null。
 * 🔴 phase1 stateless、無 server 端 token_version 撤銷:被竊 cookie 於 exp 前有效,緩解=短 TTL + 換 secret 全域失效。
 */
export async function verifySession(token: string | undefined | null): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  const key = await getKey();
  if (!key) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  let data: Uint8Array;
  let sig: Uint8Array;
  try {
    data = b64urlToBytes(token.slice(0, dot));
    sig = b64urlToBytes(token.slice(dot + 1));
  } catch {
    return null;
  }
  // crypto.subtle.verify 本身常數時間 — 不先手寫字串比(Fable REQ6)。
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', key, sig as BufferSource, data as BufferSource);
  } catch {
    return null;
  }
  if (!valid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
  if (!isPayload(parsed)) return null;
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
  return parsed;
}

/** amr 是否含完整 2FA(totp/recovery);供未來 step-up slice 判斷,本 slice 不強制。 */
export function isFull2faSession(p: AdminSessionPayload): boolean {
  return p.amr.includes('totp') || p.amr.includes('recovery');
}
