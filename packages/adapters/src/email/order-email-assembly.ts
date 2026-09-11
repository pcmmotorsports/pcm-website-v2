import { createHash } from 'node:crypto';
/**
 * @module @pcm/adapters/email/order-email-assembly — 交易信組裝層(M-4a E1b;REQUIRED-E1b 本體)
 *
 * 🔴 這層是 PII 不落表的**真防線**(migration `20260717020000` §⑤:DB 只約束 payload 為 jsonb object、
 * 無 key allowlist;subject/dedup_key 皆自由 text → 一次 DTO spread 就能把 email/電話/地址永久複製進表):
 * 1. payload **顯式逐欄 allowlist 組裝** + runtime 型別檢查,來源物件上的任何多餘欄位(含 PII)
 *    物理上不會進 payload。**禁 spread、禁整包轉存。**
 * 2. subject 只由**固定模板 + display_id** 組,不夾任何客戶欄。
 * 3. 🔴 呼叫位置=`SupabaseEmailOutboxAdapter.enqueue` **內部**(codex 關卡2 R1 must-fix 後收緊:
 *    port 不收 payload/subject,呼叫端無法繞過本層;本模組 export 僅供落表邊界與測試)。
 *
 * 🔴 **payload 能收什麼 —— 判準,不是欄名清單**(2026-09-11 付款信凍金額改寫;plan §10 ③):
 *   ① 事件時點已定、之後不會再改的事實:金額、數量、料號、時戳、編號
 *   ② 描述性字串要**具名來源 + 長度上限**,並登記在下面的「自由文字例外」
 *   ③ 🛑 禁客人識別欄:信箱 / 電話 / 地址 / 姓名 / 統編 —— 一欄都不行
 *   ④ 可後台改的欄不存(如 `shipping_method`、收件信箱),存了會過期
 *   ⑤ 每加一欄就 bump 那個事件的 `event_version`,並在這裡登記
 *
 * 自由文字例外(只有這兩種):
 *   #1 `cancelled_reason` —— `buildOrderCancelledPayload` 與 `buildOrderUnpaidCancelledPayload`(員工打的字)
 *   #2 `order_created` v2 每列 `title` —— 來源 `order_items.product_snapshot.title`
 *      (`SupabasePaidEmailContextAdapter.snapshotTitle`),只存前 120 字(Sean 2026-09-11 Q2 甲)。
 *      🔴 手動單的品名是員工手打,可能夾客人姓名 / 刻字;而 `email_outbox` 沒有清除機制(#281)
 *      ⇒ 它是永久副本。背景:同一段字早就永久存在 `order_items`;`email_outbox` 只有 service_role 讀得到。
 *
 * 其他事件的品項/金額/地址仍**寄信時即時查主表**(E2a/E3)。`order_created` v2 例外見 `buildOrderCreatedPayload`。
 */
import type {
  OrderCreatedEmailPayload,
  PaidEmailContext,
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

/** order_created 帶金額凍結快照的版本(plan-paid-amount-frozen 凍-C)。 */
export const ORDER_CREATED_SNAPSHOT_EVENT_VERSION = 2 as const;

/** 自由文字例外 #2 的長度上限(Sean 2026-09-11 Q2 甲)。以字元(code point)算,不切半個字。 */
export const PAID_SNAPSHOT_TITLE_MAX_CHARS = 120;

/** 🔴 `Number.isSafeInteger` 而不是 `Number.isInteger`:1e20 也是 integer, 而它進 jsonb 會失真。 */
function requireNonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`order_created 組裝失敗:${field} 必須是非負整數`);
  }
  return value;
}

function requireStringOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`order_created 組裝失敗:${field} 必須是字串或 null`);
  return value;
}

/**
 * 組裝 order_created 的 payload(顯式 allowlist + runtime 驗證;來源多餘欄位到不了這裡)。
 *
 * - 沒有 `paidSnapshot` ⇒ v1 三欄(寄出當下現查金額,今天的行為)
 * - 有 ⇒ v2:五個金額 + 每列四欄,**逐欄具名挑**(不 spread `PaidEmailContext`,
 *   它的 `orderDisplayId` / `linesTruncated` 不落表;信上的編號只有 `display_id` 一個來源)
 * 🔴 截斷或 0 項的快照在這裡**拒收**(throw)—— 半份快照比沒有快照糟。
 *    呼叫端(`enqueueOrderCreatedEmails`)在帶進來之前就先篩過,這裡是第二道。
 * 🔵 `p3_seal` 是唯一允許事後合併進 order_created payload 的鍵(`20260905440000:225-226`
 *    用 `payload || jsonb_build_object('p3_seal', …)`),不經本支;讀取端不看它。
 */
export function buildOrderCreatedPayload(src: {
  displayId: string;
  paidAt: string;
  paidSnapshot?: PaidEmailContext;
}): OrderCreatedEmailPayload {
  const display_id = requireNonEmptyString(src.displayId, 'displayId', 'order_created');
  const paid_at = requireNonEmptyString(src.paidAt, 'paidAt', 'order_created');
  const snap = src.paidSnapshot;
  if (snap === undefined) {
    return { event_version: ORDER_CREATED_EVENT_VERSION, display_id, paid_at };
  }
  if (snap.linesTruncated || snap.lines.length === 0) {
    throw new Error('order_created 組裝失敗:快照品項被截斷或為空 ⇒ 不帶快照');
  }
  return {
    event_version: ORDER_CREATED_SNAPSHOT_EVENT_VERSION,
    display_id,
    paid_at,
    subtotal: requireNonNegativeSafeInteger(snap.subtotal, 'subtotal'),
    shipping_fee: requireNonNegativeSafeInteger(snap.shippingFee, 'shippingFee'),
    discount_total: requireNonNegativeSafeInteger(snap.discountTotal, 'discountTotal'),
    tax_total: requireNonNegativeSafeInteger(snap.taxTotal, 'taxTotal'),
    total: requireNonNegativeSafeInteger(snap.total, 'total'),
    lines: snap.lines.map((l) => {
      const title = requireStringOrNull(l.title, 'lines.title');
      return {
        variant_sku: requireStringOrNull(l.variantSku, 'lines.variantSku'),
        quantity: requireNonNegativeSafeInteger(l.quantity, 'lines.quantity'),
        line_total: requireNonNegativeSafeInteger(l.lineTotal, 'lines.lineTotal'),
        title: title === null ? null : Array.from(title).slice(0, PAID_SNAPSHOT_TITLE_MAX_CHARS).join(''),
      };
    }),
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

/**
 * 🔴 **部分退款通知信**(`order_partially_refunded`)—— Sean 2026-09-08 QB-16 拍甲。
 *
 * 🛑 **主旨【不能】與那兩封取消信相同** —— 那兩封逐字「PCM 訂單 X 已取消」,
 *    而本封信的單子**通常還活著**(部分退款不代表取消)。
 *    ⇒ 📌 用「已取消」當主旨會讓客人以為整張單沒了, 而那是**在信箱列表就會發生的誤解**
 *      —— 他可能連信都不會打開。
 * 🔴 **唯一允許的動態欄仍是 `display_id`**(subject 不夾任何客戶欄, 檔頭 §2)。
 * 🔵 **文案是 Sean 的** —— 這一行是可寄出的最小字面, 他核過再改;
 *    改字面時記得 `scripts/literal-sweep.sh` 掃舊字面。
 */
export function orderPartiallyRefundedSubject(displayId: string): string {
  return `PCM 訂單 ${displayId} 已退款`;
}

export const ORDER_PARTIALLY_REFUNDED_EVENT_VERSION = 1 as const;

/**
 * 🔴🔴 **金額與時點【兩個都是必填】, 而那與 `order_cancelled` 刻意不同。**
 *    那一封對讀不到的金額是「說有退、不說多少」;
 *    ⇒ 📌 **本封信存在的唯一理由就是講那個金額** ⇒ 說不出金額的信**比不寄糟**
 *      (A 2026-09-08 收 plan §④)。
 * ⇒ 所以這裡用 `requireNonEmptyString` / 正整數斷言把它擋在**落表邊界**,
 *   而不是讓它進 outbox 之後在寄送時才發現 —— outbox 那一列會**永久**留著。
 */
export function buildOrderPartiallyRefundedPayload(src: {
  displayId: string;
  refundId: string;
  refundedAmount: number;
  refundedAt: string;
}): {
  display_id: string;
  refund_id: string;
  refunded_amount: number;
  refunded_at: string;
  event_version: typeof ORDER_PARTIALLY_REFUNDED_EVENT_VERSION;
} {
  const amount = src.refundedAmount;
  // 🔴 `Number.isSafeInteger` 而不是 `> 0` 單條:`NaN` / `Infinity` / 小數都要擋
  //    —— 它們會被寫進 payload 而在模板那層變成一句奇怪的話。
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(
      'order_partially_refunded:refundedAmount 必須是正整數(金額讀不到就不寄 —— 本封信的唯一理由就是那個數字)',
    );
  }
  return {
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'order_partially_refunded'),
    // 🔴 `refund_id` **也進 payload** —— 它是 dedup_key 的來源, 而回頭解析 `dedup_key`
    //    那條路被刻意堵死(DB 層對它零格式 CHECK)。理由與 `order_shipped` 的 shipmentId 相同。
    refund_id: requireNonEmptyString(src.refundId, 'refundId', 'order_partially_refunded'),
    refunded_amount: amount,
    refunded_at: requireNonEmptyString(src.refundedAt, 'refundedAt', 'order_partially_refunded'),
    event_version: ORDER_PARTIALLY_REFUNDED_EVENT_VERSION,
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

/**
 * 🔴 ⟦b4-BANKNOEMAIL⟧ 匯款單成立信(`bank_order_created`)—— 顧客站選匯款而**尚未付款**的單。
 *
 * 🛑 **主旨與另外幾支【刻意不同】**:那幾封講的是「已經發生了什麼」,
 *    而這一封講的是「**請你去做一件事、而且有期限**」⇒ 主旨要看得出那件事。
 *    字面來自 Sean 核可的那一份(`docs/specs/2026-09-06-bank-order-created-email-copy.md`)。
 */
export function bankOrderCreatedSubject(displayId: string): string {
  return `訂單 ${displayId} 已成立,請於期限內完成匯款`;
}

export const BANK_ORDER_CREATED_EVENT_VERSION = 1 as const;

/**
 * ⟦b4-BANKNOEMAIL⟧ 的 `dedup_key` —— **`orderId` + 快照指紋**(codex R1-#4, 45f 那一半)。
 *
 * 🔴🔴 **為什麼不是單純的 `orderId`**:
 *   寄送當下發現快照過期 ⇒ 標 `bank_order_snapshot_stale` ⇒ 45f 讓那張單**重新進得了掃描面**,
 *   而 `UNIQUE (event_type, dedup_key)` 會讓**第二次 INSERT 撞唯一鍵** ⇒ 📌 **那張單永遠停在那裡。**
 *   ⇒ ✅ 指紋一變, 它就是**另一把鑰匙** ⇒ 新快照排得進去。
 *
 * 🛑 **而指紋要涵蓋【會讓那封信變得不一樣】的每一個值** —— 今天是三個:
 *   `total` / `balanceDue` / `recipientEmail`。
 *   ⚠️ **少涵蓋一個的後果很具體**:那個值變了而指紋沒變 ⇒ **撞唯一鍵 ⇒ 那張單從此排不進來**
 *   (不是「寄了舊的」—— 寄送前重驗會擋下, 而擋下之後就再也補不回來)。
 *   ⇒ 📌 **這三個值與寄送前重驗比對的那三個【必須是同一組】**, 兩邊漂掉的症狀是**永久漏信**。
 *
 * 🔵 `createdAt` **不進指紋**:它是不可變的(下單時刻), 進去只會讓字串更長而不會多分辨任何東西。
 */
export function bankOrderCreatedDedupKey(src: {
  orderId: string;
  total: number;
  balanceDue: number;
  recipientEmail: string;
}): string {
  // 🔵 `\u0000` 當分隔 —— 三個欄位裡都不可能出現它, 所以
  //    `a|b` 與 `ab|` 這種「不同輸入撞同一個字串」的情況構造不出來。
  const fingerprint = createHash('sha256')
    .update([src.total, src.balanceDue, src.recipientEmail].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
  return `${src.orderId}:${fingerprint}`;
}

/**
 * 🔴🔴 **payload 是【下單當下的快照】**(R3-C1, 主視窗 2026-09-06 裁採納)——
 *   與 `order_cancelled` 同形, 而它一刀解掉「表頭與明細兩次查詢之間被改」那個混版問題:
 *   📌 **不是「被解掉了」, 是那個問題【不存在】** —— 只有一次讀。
 *
 * ⚠️ **而快照有它自己的問題, 寫在這裡不寫在別處**:客人隔天匯了一半 ⇒ 快照仍是舊的
 *   ⇒ 🔴 **寄送前那道 `balanceDue` 重驗非留不可**(它在 claim 之後、send 之前)。
 *
 * 🛑🛑 **帳號常數【不得】進 payload** —— payload 會落 DB。
 *   帳號住在 `@pcm/domain` 的 `PCM_REMITTANCE_*`, 由模板在**寄送當下**讀
 *   ⇒ 📌 **換銀行的那一天, 佇列裡還沒寄出去的信會印【新帳號】而不是舊的。**
 */
export function buildBankOrderCreatedPayload(src: {
  displayId: string;
  createdAt: string;
  total: number;
  balanceDue: number;
}): {
  display_id: string;
  created_at: string;
  total: number;
  balance_due: number;
  event_version: typeof BANK_ORDER_CREATED_EVENT_VERSION;
} {
  return {
    // 🔴 空的 displayId 會寄出主旨是「訂單  已成立…」的信 ⇒ 與姊妹幾支同一道閘。
    display_id: requireNonEmptyString(src.displayId, 'displayId', 'bank_order_created'),
    // 🔴 空的 createdAt ⇒ 期限句算不出來 ⇒ 客人少掉唯一知道「什麼時候會被取消」的那一行。
    created_at: requireNonEmptyString(src.createdAt, 'createdAt', 'bank_order_created'),
    // 🔴 金額**原樣帶**:它在 view 那一層就與 `order_balance_base_v` 同源, 這裡不重算。
    //    📌 重算 = 第二個來源 ⇒ 兩份會漂, 而漂掉的症狀是「信上的數字與訂單頁對不起來」。
    total: src.total,
    balance_due: src.balanceDue,
    event_version: BANK_ORDER_CREATED_EVENT_VERSION,
  };
}
