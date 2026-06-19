import 'server-only';

// lib/payment/notify-secret.ts — TapPay backend_notify 祕密路徑段強度驗(M-3 3DS-6a、Q1=A 單一真相)
//
// 🔴 從 3DS-2 webhook route(app/api/checkout/tappay-notify/[secret]/route.ts)**byte 等價抽出**:
//   原 route 內聯 requireNotifySecret 同時被「驗收到的 secret 段」與「3DS-6 組 backend_notify_url」需要 →
//   抽成單一真相(同 MIN_SECRET_LEN / URL_SAFE_RE / throw 條件)、route 與 three-ds-urls 同源 import、零漂移。
// - route 端:不符 → 500 fail-closed(不放行)。
// - three-ds-urls 端:不符 → throw → charge-actions catch → MSG.generic、零扣款(builder 用弱 secret 組的 URL
//   會指向會 500 的端點 → 同步 fail-closed 才誠實)。
//
// 🔴 server-only:祕密 env 讀只在 server route / server action;靜態 process.env(非 computed member、不觸 #182)。

/** 祕密路徑段最小長度(code enforce、防 env 誤設短字串;codex 關卡1 consider 2)。 */
const MIN_SECRET_LEN = 32;
/** URL-safe 字元集(base64url:不含 `/`、不破壞路徑)。 */
const URL_SAFE_RE = /^[A-Za-z0-9_-]+$/;

/** 讀 + 強度驗祕密路徑段;未設 / <32 / 非 URL-safe → throw(caller fail-closed:route→500、builder→零扣款)。 */
export function requireNotifySecret(): string {
  const s = process.env.TAPPAY_NOTIFY_PATH_SECRET;
  if (!s || s.length < MIN_SECRET_LEN || !URL_SAFE_RE.test(s)) {
    throw new Error('TAPPAY_NOTIFY_PATH_SECRET 未設或強度不足(需 ≥32 URL-safe)');
  }
  return s;
}
