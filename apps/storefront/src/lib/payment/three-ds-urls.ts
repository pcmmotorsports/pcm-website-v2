import 'server-only';

// lib/payment/three-ds-urls.ts — 3DS result_url 組裝 + URL 守門(M-3 3DS-6a delivery)
//
// charge-actions(flag on)用本檔組 TapPay charge 的 result_url{frontend_redirect_url, backend_notify_url}:
//   - frontend_redirect_url = <base>/checkout/callback?order=<orderId>  → 對齊 3DS-3 callback 讀 sp.order(UUID)
//   - backend_notify_url     = <base>/api/checkout/tappay-notify/<secret> → 對齊 3DS-2 webhook 祕密路徑段
//
// 🔴 拆兩段(codex 關卡1 #3 preflight):
//   - resolveThreeDSConfig():驗 base + secret(在 placeOrder「前」呼;任一不合 throw → 零扣款 + 零垃圾單)。
//   - buildResultUrls(cfg, orderId):純 interpolate(findTotal 後呼、不 throw、不讀 env)。
//
// 🔴 N1(審查側必折入):base 與 payment_url 用「兩個不同 predicate」、payment_url 較鬆:
//   - resolvePaymentBaseUrl = origin-only(https + hostname + 無 credential + 無 path/query/hash)→ 嚴(preflight)。
//   - isHttpsUrl = https + hostname + 無 credential、🔴 **允許 path/query/hash**(TapPay payment_url 本質帶 ?token=…)。
//     誤用 origin-only 驗 payment_url → 所有合法 redirect 被拒 → 每筆 3DS 都掉 processing、無人能跳轉(happy-path 全壞)。
//
// 🔴 server-only:讀 NEXT_PUBLIC_SITE_URL(非密、復用 SEO env)+ TAPPAY_NOTIFY_PATH_SECRET(密)。
//
// @see docs/specs/2026-06-19-m3-3ds-6-charge-actions-redirect-plan.md §2.2

import { requireNotifySecret } from './notify-secret';

/** 已驗 3DS 設定(base=https origin、secret=≥32 URL-safe);buildResultUrls 純 interpolate 用。 */
export type ThreeDSConfig = { base: string; secret: string };

/** NEXT_PUBLIC_SITE_URL 缺/非合法 https origin 時的固定錯訊(不洩內部、charge-actions catch → MSG.generic)。 */
const BASE_ERR = 'NEXT_PUBLIC_SITE_URL 未設或非合法 https origin(3DS result_url 需公開 https 網域)';

/**
 * base URL(origin-only、嚴):讀 NEXT_PUBLIC_SITE_URL、`new URL()` 驗 https + hostname + 無 credential
 * + 無 path/query/hash(path 須空或 '/')→ 回 origin(無尾斜線);任一不合 / parse 失敗 → throw(fail-closed)。
 * 🔴 不 fallback localhost(http、且 TapPay server 連不到)。preflight 用、不 export。
 */
function resolvePaymentBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) throw new Error(BASE_ERR);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(BASE_ERR);
  }
  const pathOk = u.pathname === '' || u.pathname === '/';
  if (
    u.protocol !== 'https:' ||
    !u.hostname ||
    u.username !== '' ||
    u.password !== '' ||
    u.search !== '' ||
    u.hash !== '' ||
    !pathOk
  ) {
    throw new Error(BASE_ERR);
  }
  return u.origin; // e.g. 'https://host' / 'https://host:8443'(無尾斜線)
}

/**
 * 🔴 payment_url 守門(較鬆、顯式 export;N1):https + 有 hostname + 無 username/password;
 * **允許 path/query/hash**(TapPay payment_url 帶 ?token=…)。parse 失敗 / 非 https / 含 credential → false。
 * 不限定 TapPay 網域(子網域變動容忍);charge-actions mapInitiateOutcome import 本函式驗 redirect。
 */
export function isHttpsUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '';
}

/** preflight:驗 base(origin-only)+ secret(≥32 URL-safe);任一不合 → throw(placeOrder 前呼、零扣款零垃圾單)。 */
export function resolveThreeDSConfig(): ThreeDSConfig {
  return { base: resolvePaymentBaseUrl(), secret: requireNotifySecret() };
}

/** 純 interpolate(已驗 cfg、不讀 env、不 throw);orderId = placeOrder 回的 orders.id(server UUID、URL-safe)。 */
export function buildResultUrls(
  cfg: ThreeDSConfig,
  orderId: string,
): { frontendRedirectUrl: string; backendNotifyUrl: string } {
  return {
    frontendRedirectUrl: `${cfg.base}/checkout/callback?order=${orderId}`,
    backendNotifyUrl: `${cfg.base}/api/checkout/tappay-notify/${cfg.secret}`,
  };
}
