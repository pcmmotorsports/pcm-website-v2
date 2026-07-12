// M-4a M0-S2 correlation id(PRD §6.7):貫穿 admin 請求 → 稽核 → DB → 外部服務 log。
// 🔴 純模組、不 import next/headers,故 middleware(edge/node)與單測皆可安全引用;
//    讀「當前請求」的 correlation id 走 audit/context.ts getRequestId()(那裡才碰 next/headers)。

/** middleware 戳 + handler 讀的 header 名。 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 產生 correlation id。prefixed uuid(`req_<uuid>`)方便在 log 中目視辨識。
 * 全域 crypto.randomUUID()(admin = Node>=22 + Next runtime,edge/node 皆有;
 * 先例 apps/storefront/src/contexts/CartContext.tsx:164)。
 */
export function generateRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

/**
 * 安全的 correlation id 形狀:英數 + . _ -、長度 1-200。
 * 用於 proxy 邊界:合法上游(如 Vercel)帶進來的 id 保留,含換行 / 控制字元 / 超長的注入嘗試
 * (會灌進 admin_audit_log.request_id 與外部服務 log = log injection)一律棄用、改新產。
 */
export function isSafeRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(value);
}
