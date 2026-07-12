// M-4a M0-S3 SSO 收端設定 —— 報價單發起端 base URL + 換票共享 secret。
// 🔴 authorize / exchange 的目的地一律由**寫死 env base** 組 URL,絕不接受請求參數決定目標(防 SSRF / open-redirect)。
//    對稱於報價單側 authorize 的 PCM_ADMIN_APP_URL allowlist 寫法。
// 相對 import 見 session.ts 註解(root vitest @ 指 storefront)。

export interface SsoConfig {
  /** 報價單發起端 base(如 https://quote.pcmmotorsports.com)。 */
  readonly quoteBase: string;
  /** 與報價單共享的 exchange secret(admin→quote 方向;admin session HMAC 用另一把獨立 secret)。 */
  readonly exchangeSecret: string;
}

/** 共享 secret 最小長度(<32 視為未設,fail-closed;弱 secret→離線暴破 HMAC→偽造 session,Fable/Codex MF5)。 */
export const MIN_SECRET_LEN = 32;

/**
 * 讀 + 驗 SSO env。fail-closed(呼叫端回 500 設定缺漏)於任一:
 *  - quoteBase / exchangeSecret 缺
 *  - 🔴 prod(NODE_ENV=production)quoteBase 非 https(Fable MF4:誤植 http 會使 Bearer secret/code/state 明文出網);dev 才容許 http
 *  - 🔴 exchangeSecret 長度 < MIN_SECRET_LEN(Fable/Codex MF5)
 */
export function getSsoConfig(): SsoConfig | null {
  const quoteBase = process.env.PCM_QUOTE_SSO_BASE;
  const exchangeSecret = process.env.PCM_SSO_EXCHANGE_SECRET;
  if (!quoteBase || !exchangeSecret) return null;
  if (exchangeSecret.length < MIN_SECRET_LEN) return null;
  const isProd = process.env.NODE_ENV === 'production';
  try {
    const u = new URL(quoteBase);
    if (isProd) {
      if (u.protocol !== 'https:') return null;
    } else if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return null;
    }
  } catch {
    return null;
  }
  return { quoteBase, exchangeSecret };
}

/** 組報價單 authorize URL(state 由 URL API 自動編碼;host 固定 quoteBase)。 */
export function buildAuthorizeUrl(quoteBase: string, state: string): string {
  const u = new URL('/api/sso/authorize', quoteBase);
  u.searchParams.set('state', state);
  return u.toString();
}

/** 組報價單 exchange URL(server-to-server POST 目標)。 */
export function buildExchangeUrl(quoteBase: string): string {
  return new URL('/api/sso/exchange', quoteBase).toString();
}
