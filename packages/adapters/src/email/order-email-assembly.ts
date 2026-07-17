/**
 * @module @pcm/adapters/email/order-email-assembly — 交易信組裝層(M-4a E1b;REQUIRED-E1b 本體)
 *
 * 🔴 這層是 PII 不落表的**真防線**(migration `20260717020000` §⑤:DB 只約束 payload 為 jsonb object、
 * 無 key allowlist;subject/dedup_key 皆自由 text → 一次 DTO spread 就能把 email/電話/地址永久複製進表):
 * 1. payload **顯式逐欄 allowlist 組裝** + runtime 型別檢查——只收 `display_id`/`paid_at`/
 *    `event_version`,來源物件上的任何多餘欄位(含 PII)物理上不會進 payload。**禁 spread、禁整包轉存。**
 * 2. subject 只由**固定模板 + display_id** 組,不夾任何客戶欄。
 * 3. 🔴 呼叫位置=`SupabaseEmailOutboxAdapter.enqueue` **內部**(codex 關卡2 R1 must-fix 後收緊:
 *    port 不收 payload/subject,呼叫端無法繞過本層;本模組 export 僅供落表邊界與測試)。
 *
 * 品項/金額/地址等渲染資料**寄信時即時查主表**(E2a/E3),不進 payload(可後台改的欄存了會過期)。
 */
import type { OrderCreatedEmailPayload } from '@pcm/ports';

/**
 * subject 固定模板(唯一允許的動態欄 = display_id)。
 * ⚠️ 文案 L2(Sean 07-16 拍 Q4):字面由 E3 定案、**寄出前給 Sean 過目**;本片先立模板機制與佔位字面。
 */
export function orderCreatedSubject(displayId: string): string {
  return `PCM 訂單 ${displayId} 付款成功通知`;
}

/** order_created 事件版本(payload 消費端依此收斂形狀;改欄位 = bump 版本)。 */
export const ORDER_CREATED_EVENT_VERSION = 1 as const;

/** runtime 欄位檢查(REQUIRED-E1b:型別層擋不住 `as` 硬轉,落表前再驗一次)。 */
function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    // 🔴 錯誤訊息只含欄位名、不含值(值可能是誤傳的 PII)。
    throw new Error(`order_created 組裝失敗:${field} 必須是非空字串`);
  }
  return value;
}

/**
 * 組裝 order_created 的 payload(顯式三欄 allowlist + runtime 驗證;來源多餘欄位到不了這裡)。
 */
export function buildOrderCreatedPayload(src: {
  displayId: string;
  paidAt: string;
}): OrderCreatedEmailPayload {
  return {
    event_version: ORDER_CREATED_EVENT_VERSION,
    display_id: requireNonEmptyString(src.displayId, 'displayId'),
    paid_at: requireNonEmptyString(src.paidAt, 'paidAt'),
  };
}
