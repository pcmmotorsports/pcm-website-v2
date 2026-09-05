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
import type {
  OrderCreatedEmailPayload,
  OrderShippedEmailPayload,
  ShipmentTrackingCorrectedEmailPayload,
} from '@pcm/ports';

/**
 * subject 固定模板(唯一允許的動態欄 = display_id)。
 * ⚠️ 文案 L2(Sean 07-16 拍 Q4):字面由 E3 定案、**寄出前給 Sean 過目**;本片先立模板機制與佔位字面。
 */
export function orderCreatedSubject(displayId: string): string {
  return `PCM 訂單 ${displayId} 付款成功通知`;
}

/** order_created 事件版本(payload 消費端依此收斂形狀;改欄位 = bump 版本)。 */
export const ORDER_CREATED_EVENT_VERSION = 1 as const;

/**
 * runtime 欄位檢查(REQUIRED-E1b:型別層擋不住 `as` 硬轉,落表前再驗一次)。
 *
 * 🔴 **`event` 這個參數是 2026-08-22 E4-a 加的,而它修的是一個真的缺陷**:
 * 原版把事件名寫死成 `order_created`。出貨組裝也共用本支之後,
 * **一封出貨信組裝失敗會回報「order_created 組裝失敗」** —— 而錯誤訊息是這條路上
 * 唯一會被讀到的東西(零 PII 政策讓它不能帶值)⇒ 讀的人會去查錯的那條線。
 */
function requireNonEmptyString(value: unknown, field: string, event: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    // 🔴 錯誤訊息只含事件名與欄位名、不含值(值可能是誤傳的 PII)。
    throw new Error(`${event} 組裝失敗:${field} 必須是非空字串`);
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
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'order_created'),
    paid_at: requireNonEmptyString(src.paidAt, 'paidAt', 'order_created'),
  };
}

/**
 * 出貨通知信的 subject 固定模板(M-4b E4-a)。
 *
 * 🔴 **動態欄有兩個,而第二個非有不可**:同一張訂單分批出貨會寄多封,
 * 只帶 display_id 的話**兩封信的主旨一模一樣** —— 客人的信箱裡會看到兩封長得相同的通知,
 * 分不出哪一封講哪一箱(而信裡的品項是不同的)。
 * ⚠️ 文案 L2(同 `orderCreatedSubject` 那條):字面**寄出前給 Sean 過目**;本片先立模板與佔位字面。
 * 🔴 主旨仍然**只由固定模板 + 這兩個非 PII 欄**組成,不夾任何客戶欄。
 */
export function orderShippedSubject(displayId: string, shipmentReference: string): string {
  return `PCM 訂單 ${displayId} 出貨通知(包裹 ${shipmentReference})`;
}

/** order_shipped 事件版本(payload 消費端依此收斂形狀;改欄位 = bump 版本)。 */
export const ORDER_SHIPPED_EVENT_VERSION = 1 as const;

/**
 * 組裝 order_shipped 的 payload(顯式四欄 allowlist + runtime 驗證;來源多餘欄位到不了這裡)。
 *
 * 🔴 **參數裡沒有追蹤碼,也沒有品項 —— 那是刻意的。** 兩者都是「可後台改」的欄,
 * 存進 payload 會凍住入列當下的值;員工事後改過,信裡帶的就是舊的,而**信寄出去收不回來**。
 * ⇒ 它們在寄送當下經 `IShippedEmailContext` 即時查主表(見該 port 檔頭)。
 * ⚠️ 想在這裡「順手把追蹤碼一起存起來」的人:那正是這一層要擋的事。
 */
export function buildOrderShippedPayload(src: {
  displayId: string;
  shipmentId: string;
  shipmentReference: string;
  shippedAt: string;
}): OrderShippedEmailPayload {
  return {
    event_version: ORDER_SHIPPED_EVENT_VERSION,
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'order_shipped'),
    // 🔴 這一欄多驗一道【形狀】:它是寄送時去主表撈脈絡的唯一鍵,
    //    而型別層擋不住 `as` 硬轉、也擋不住上游傳一個箱【號】(BCDF23)進來。
    //    傳錯的症狀不是報錯,是**撈不到 ⇒ 整包 null ⇒ 那封信永遠寄不出去**,而每輪都吵。
    shipment_id: requireUuid(src.shipmentId, 'shipmentId', 'order_shipped'),
    shipment_reference: requireNonEmptyString(src.shipmentReference, 'shipmentReference', 'order_shipped'),
    shipped_at: requireNonEmptyString(src.shippedAt, 'shippedAt', 'order_shipped'),
  };
}

/**
 * uuid 形狀檢查(8-4-4-4-12 十六進位)。
 * ⚠️ **它只驗形狀,不驗那個箱存不存在** —— 後者只有查 DB 才知道,而那是寄送時的事。
 */
/**
 * 更正單號的信主旨(⟦5b-TRACKNUMGAP1⟧ 片 C)。
 *
 * 🔴 **主旨要自己說得出「這是更正」** —— 客人收件匣裡會有兩封講同一箱的信,
 *    而他多半**只看主旨**就決定要不要點開。
 * 🛑 **所以「更正」兩個字不能只寫在內文。**
 */
export function trackingCorrectedSubject(displayId: string, shipmentReference: string): string {
  return `PCM 訂單 ${displayId} 貨運單號更正(包裹 ${shipmentReference})`;
}

export const SHIPMENT_TRACKING_CORRECTED_EVENT_VERSION = 1 as const;

export function buildShipmentTrackingCorrectedPayload(src: {
  displayId: string;
  shipmentId: string;
  shipmentReference: string;
  trackingNumber: string;
  trackingCorrectedKey: string;
}): ShipmentTrackingCorrectedEmailPayload {
  return {
    event_version: SHIPMENT_TRACKING_CORRECTED_EVENT_VERSION,
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'shipment_tracking_corrected'),
    shipment_id: requireUuid(src.shipmentId, 'shipmentId', 'shipment_tracking_corrected'),
    shipment_reference: requireNonEmptyString(
      src.shipmentReference,
      'shipmentReference',
      'shipment_tracking_corrected',
    ),
    // 🔴 **空字串在這裡要當場炸** —— 這封信的全部內容就是這個號碼;
    //    一封「正確的單號是(空白)」比不寄糟, 而寄出去收不回來。
    tracking_number: requireNonEmptyString(
      src.trackingNumber,
      'trackingNumber',
      'shipment_tracking_corrected',
    ),
    // 🔴 空的也當場炸:少了它, 寄送當下那道「還是不是最新那次更正」的比對**沒有一端**
    //    ⇒ 而它 fail-closed ⇒ 那封信會永遠卡著。寧可在組裝時炸給人看。
    tracking_corrected_key: requireNonEmptyString(
      src.trackingCorrectedKey,
      'trackingCorrectedKey',
      'shipment_tracking_corrected',
    ),
  };
}

function requireUuid(value: unknown, field: string, event: string): string {
  const v = requireNonEmptyString(value, field, event);
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
    // 🔴 只講欄位名,不講值(零 PII 政策;而且值可能是誤傳的別的東西)。
    throw new Error(`${event} 組裝失敗:${field} 必須是 uuid 形狀`);
  }
  return v;
}

/**
 * 未付款取消信的 subject 固定模板(Q1 拍乙:未付款那種另開一條線)。
 *
 * 🔴 **唯一允許的動態欄是 `display_id`** —— 與另外兩封同一條紀律:
 *    subject 是客人在信箱列表看到的那一行,而它**不夾任何客戶欄**(檔頭 §2)。
 * 🛑 **不寫「退款」二字** —— 這條線的客人**從來沒有付過錢**,提退款會讓他等一筆不存在的錢。
 */
/**
 * 🔴 取消信(`order_cancelled`)—— 刷卡且已全額退款的整單取消。
 * 🛑 主旨與 `orderUnpaidCancelledSubject` **逐字相同**, 而那是刻意的:
 *    客人看到的是「這張單取消了」, 而**為什麼取消不該從主旨分辨**。
 *    ⇒ 📌 兩支分開存在的理由是【內容不同】(這一封多一段退款金額), 不是主旨不同。
 */
export function orderCancelledSubject(displayId: string): string {
  return `PCM 訂單 ${displayId} 已取消`;
}

export const ORDER_CANCELLED_EVENT_VERSION = 1 as const;

export function buildOrderCancelledPayload(src: {
  displayId: string;
  cancelledAt: string;
  cancelledReason: string | null;
  refundedAmount: number;
  refundKind: string;
}): {
  display_id: string;
  cancelled_at: string;
  cancelled_reason: string | null;
  refunded_amount: number;
  refund_kind: string;
  event_version: typeof ORDER_CANCELLED_EVENT_VERSION;
} {
  return {
    // 🔴 兩個必填欄過 `requireNonEmptyString` —— 空的 displayId 會寄出主旨是
    //    「PCM 訂單  已取消」的信;空的 cancelledAt 會被永久寫進 outbox。
    //    (姊妹那三支都過, 而 unpaid 那支的註解記著「我鏡像它們的時候漏了這一格」。)
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'order_cancelled'),
    cancelled_at: requireNonEmptyString(src.cancelledAt, 'cancelledAt', 'order_cancelled'),
    // 🔵 `cancelled_reason` 選填(null = 那一段不印)。
    cancelled_reason: src.cancelledReason,
    // 🔴 金額**原樣帶**:它在 view 那一層就與 payment_status 判定同源, 這裡不重算。
    //    📌 重算 = 第二個來源 ⇒ 兩份會漂, 而漂掉的症狀是「信上的數字與後台對不起來」。
    refunded_amount: src.refundedAmount,
    refund_kind: src.refundKind,
    event_version: ORDER_CANCELLED_EVENT_VERSION,
  };
}

export function orderUnpaidCancelledSubject(displayId: string): string {
  return `PCM 訂單 ${displayId} 已取消`;
}

/** 事件版本(與另外兩封同形)。 */
export const ORDER_UNPAID_CANCELLED_EVENT_VERSION = 1 as const;

/**
 * 未付款取消信的 payload。
 *
 * 🔴 **allowlist 就是這幾個欄** —— 呼叫端物理上塞不進別的東西(檔頭 §3 那道紀律)。
 * ⚠️ `cancelled_reason` 是**員工打的自由文字**,而它會原封進到客人眼前
 *    ⇒ **整形在模板層**(`sanitizeCustomerFacingReason`),不在這裡 ——
 *    這裡只負責「不讓不該落表的欄位進來」,不負責語意。
 */
export function buildOrderUnpaidCancelledPayload(src: {
  displayId: string;
  cancelledAt: string;
  cancelledReason: string | null;
}): {
  display_id: string;
  cancelled_at: string;
  cancelled_reason: string | null;
  event_version: typeof ORDER_UNPAID_CANCELLED_EVENT_VERSION;
} {
  return {
    // 🔴🔴 **兩個必填欄要過 `requireNonEmptyString`, 而我第一版沒過**(codex 第二輪 must-fix)——
    //    ⇒ 空的 `displayId` 會寄出一封主旨是「**PCM 訂單  已取消**」的信(中間兩個空格),
    //      而空的 `cancelledAt` 會被**永久寫進 outbox**。
    //    📌 **⇒ 而本檔檔頭宣稱「落表邊界有 runtime 防線」—— 那句話對另外兩封成立, 對我這封不成立。**
    //    🎯 兩支姊妹(`:52-53` / `:89-94`)都過, 而我鏡像它們的時候**漏了這一格**。
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'order_unpaid_cancelled'),
    cancelled_at: requireNonEmptyString(src.cancelledAt, 'cancelledAt', 'order_unpaid_cancelled'),
    // 🔵 而 `cancelled_reason` **刻意不過** —— 它是選填(`null` = 沒有理由 ⇒ 信裡那段不印)。
    cancelled_reason: src.cancelledReason,
    event_version: ORDER_UNPAID_CANCELLED_EVENT_VERSION,
  };
}
