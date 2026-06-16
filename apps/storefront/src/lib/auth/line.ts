// lib/auth/line.ts — LINE OAuth 自寫流程共用模組(M-1-14e-f2、Q4=Y 自寫 OAuth)
//
// 對齊 PRD docs/specs/m-1-14-customer-schema.md §8.5(自寫 flow)+ §13(Sean dashboard)+ Sean 拍板
// (2026-05-25 Q1=A service_role 受控小門 / Q2=A line_user_id 唯一鍵不併帳 / Q3=A 合成 email 網域 /
//  Q4=A scope 只開 openid+profile)。
//
// ⚠️ `import 'server-only'`:本檔讀 LINE_CHANNEL_SECRET(getLineConfig / exchangeCodeForToken〔f2-a2 補〕)、
//    絕不可進 client bundle(codex 關卡1 finding-6)。僅 server route handler(/api/auth/line/*)+ line-admin.ts
//    引用;LoginPage 走純導航 window.location.href='/api/auth/line/start'、不 import 本檔。
//
// 已查證(auth-js 2.105.3 + LINE 官方文件、動手前驗證非憑記憶):
// - LINE id_token(OIDC)含 sub(=LINE userId)/ name / email(僅 email scope 已核准且用戶同意);
//   **無 email_verified claim** → 不可 by-email auto-link(改 line_user_id 為唯一身分鍵、見 line-admin.ts〔f2-a2〕)。
// - email scope 需另向 LINE 申請核准 → 合成 email 方案令 email 變可選(scope 只需 openid profile)。

import 'server-only';
import { randomBytes } from 'node:crypto';

// LINE Login v2.1 OAuth 端點(固定常數、非來自請求輸入 → 無 open-redirect 風險;codex 關卡1 finding-e)
const LINE_AUTHORIZE_ENDPOINT = 'https://access.line.me/oauth2/v2.1/authorize';
export const LINE_TOKEN_ENDPOINT = 'https://api.line.me/oauth2/v2.1/token';
export const LINE_VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify';

// scope 只開 openid + profile(Q4=A;email 走合成 email 方案、變可選、不阻塞 LINE email 權限審核)
const LINE_SCOPE = 'openid profile';

// state / nonce cookie(httpOnly + Secure〔prod〕+ SameSite=Lax + path 限縮 /api/auth/line;codex 關卡1 finding-7)
export const LINE_STATE_COOKIE = 'line_oauth_state';
export const LINE_NONCE_COOKIE = 'line_oauth_nonce';
// #190:登入後導回 next path 暫存 cookie(start 寫、callback 讀、sanitize 後導回);同 state/nonce 短效 + 用後即刪。
export const LINE_NEXT_COOKIE = 'line_oauth_next';
export const LINE_OAUTH_COOKIE_PATH = '/api/auth/line';
export const LINE_OAUTH_COOKIE_MAX_AGE = 600; // 10 分鐘、夠走完一趟授權

// 合成 email 網域(Q3=A、固定常數非 env → §13 維持 3 個 LINE env vars;codex 關卡1 finding-3)。
// LINE 用戶 auth.users.email = line_{sub}@此域:命名空間隔離、永不與真實 email 帳號衝突;
// 真實 LINE email(若有)只存 user_metadata.line_email、永不用於對應(line-admin.ts〔f2-a2〕)。
export const LINE_SYNTHETIC_EMAIL_DOMAIN = 'line.pcmmotorsports.local';

// LINE userId(sub)格式:'U' + 32 hex(LINE 規格)。boundary 驗證、防異常 sub 污染合成 email。
const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;

export function isValidLineUserId(sub: string): boolean {
  return LINE_USER_ID_PATTERN.test(sub);
}

/** 由 LINE userId(sub)決定性產生合成 email。呼叫前須先 isValidLineUserId 驗證(line-admin.ts boundary)。 */
export function lineSyntheticEmail(lineUserId: string): string {
  return `line_${lineUserId}@${LINE_SYNTHETIC_EMAIL_DOMAIN}`;
}

export type LineConfig = {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
};

/**
 * 讀 LINE OAuth 三 env vars(Sean 端 .env.local 設、§13.3)。缺則 throw(fail fast、對齊 supabase/server.ts requireEnv 模式)。
 *
 * @throws 若 LINE_CHANNEL_ID / LINE_CHANNEL_SECRET / LINE_REDIRECT_URI 未 set
 */
export function getLineConfig(): LineConfig {
  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const redirectUri = process.env.LINE_REDIRECT_URI;
  if (!channelId) throw new Error('LINE_CHANNEL_ID not set');
  if (!channelSecret) throw new Error('LINE_CHANNEL_SECRET not set');
  if (!redirectUri) throw new Error('LINE_REDIRECT_URI not set');
  return { channelId, channelSecret, redirectUri };
}

/** 產生密碼學隨機 state(防 CSRF)。 */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/** 產生密碼學隨機 nonce(OIDC replay 防護、id_token 驗證時比對)。 */
export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 組 LINE authorize URL。URL 各參數均來自 env(channelId / redirectUri)或本次產生的 state / nonce、
 * 不取自請求輸入 → 無 open-redirect 風險。
 */
export function buildAuthorizeUrl({ state, nonce }: { state: string; nonce: string }): string {
  const { channelId, redirectUri } = getLineConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: LINE_SCOPE,
    nonce,
  });
  return `${LINE_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

// LINE 用戶身分(verifyIdToken 抽出):sub = LINE userId(唯一鍵);email 僅 scope 核准 + 用戶同意時有、否則 null。
export type LineIdentity = {
  sub: string;
  name: string;
  email: string | null;
};

/**
 * 用 authorization code 換 LINE token(含 OIDC id_token)。POST x-www-form-urlencoded、帶 channel_secret。
 *
 * @throws 若 LINE 回非 2xx 或缺 id_token
 */
export async function exchangeCodeForToken(code: string): Promise<{ idToken: string }> {
  const { channelId, channelSecret, redirectUri } = getLineConfig();
  const res = await fetch(LINE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE token exchange failed: ${res.status}`);
  }
  const data: unknown = await res.json();
  const idToken = (data as { id_token?: unknown }).id_token;
  if (typeof idToken !== 'string' || !idToken) {
    throw new Error('LINE token response missing id_token');
  }
  return { idToken };
}

/**
 * 驗 LINE id_token:走 LINE verify 端點(LINE 端驗簽名 / aud / exp / nonce)。
 * 額外防禦性核對 sub 存在 + aud === channelId。nonce 傳入 → LINE 端比對 id_token 內 nonce(replay 防護)。
 *
 * @throws 若 LINE 回非 2xx(含 nonce 不符)、缺 sub、或 aud 不符
 */
export async function verifyIdToken(idToken: string, nonce: string): Promise<LineIdentity> {
  const { channelId } = getLineConfig();
  const res = await fetch(LINE_VERIFY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId, nonce }),
  });
  if (!res.ok) {
    throw new Error(`LINE id_token verify failed: ${res.status}`);
  }
  const payload = (await res.json()) as { sub?: unknown; aud?: unknown; name?: unknown; email?: unknown };
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('LINE id_token missing sub');
  }
  if (payload.aud !== channelId) {
    throw new Error('LINE id_token aud mismatch');
  }
  return {
    sub: payload.sub,
    name: typeof payload.name === 'string' ? payload.name : '',
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}
