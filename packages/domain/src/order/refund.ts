/**
 * @module @pcm/domain/order/refund — 退款金額 + 運費重算引擎(純函式、stateless)
 *
 * 🔴 **本檔是退刷線「該退客人多少錢」的唯一 TS 權威**。消費端:
 *   - RF2b 退款 RPC(以 SQL 鏡像重算、只做驗證不做權威)
 *   - RF5 server action(呼 TapPay refund 帶本檔算出的 `refundAmount`)
 *   - RF6 後台退款 UI(預覽)
 *
 * Sean 拍板(`docs/specs/2026-07-24-refund-automation-line-prd.md` §0/§0b/§0c):
 *   - **D1=B 部分退款(依品項)+ 運費重算**:`退款額 = 退品項金額 −(新運費 − 舊運費)`
 *   - **Q3=B 支援部分數量退**(同品項量 3 可只退 1)
 *   - 邊界①**重算基準 = 退款當下剩餘餘額**(非原始訂單)→ 本引擎 stateless、由呼叫端每次傳當下剩餘
 *   - 邊界②**全退時回退運費**(剩餘為 0 → 運費歸 0、退還先前為補運費保留的金額)
 *   - 邊界④**運費是訂單層級單一數字**(Sean 明確否決 per-item 運費欄)
 *   - **Q6=B 用下單凍結的運費規則**(不是今天的常數)→ `shippingRule` 為必填輸入
 *
 * 🔴 **對外零 throw**:所有壞輸入回 `{ ok: false, kind }`,不讓任何例外逸出到金流呼叫端。
 *   (`calculateShippingFee` 對壞 method 會 throw → 本檔呼叫前先自驗白名單。)
 *
 * 錯誤 code 命名對齊 `errors.ts` 既有慣例(`invalid_quantity` / `invalid_amount` /
 * `currency_mismatch` / `subtotal_mismatch` 在該檔本就各自獨立),不混塞成一種。
 *
 * @see docs/specs/2026-07-25-m3-rf1-refund-engine-plan.md(本片 plan **v7**;**五輪審查**=codex 關卡1 R1/R2
 *   + code-reviewer(opus)+ codex 關卡2 R1/R2/R3〔R3 經 Sean 特別授權破例〕,**30 must-fix + 9 nit 全折入**;
 *   另 1 條 codex 誤判經實查駁回。突變自驗 20 組全數有效,詳 plan §10e)
 */

import type { Money } from '../shared/types';
import { toMoneyAmount } from '../shared/types';
import type { ShippingMethod } from './types';
import { calculateShippingFee, type ShippingRule } from './shipping';

/**
 * DB `integer` 上限。
 *
 * 🔴 為何自己守(codex 關卡1 R2-F5):`toMoneyAmount()` 只驗「整數 + 非負」、**不驗
 * `Number.isSafeInteger` 也不驗 DB 上限**;而 `create_order` RPC 用 bigint 中間值 +
 * `IF v_total > 2147483647 THEN RAISE` 擋溢位。TS 側若不守,算得出 JS 安全但寫不進 DB 的數。
 */
const DB_INT_MAX = 2147483647;

/** 引擎拒絕原因(kind-union;呼叫端只看 kind、不解析文字) */
export type RefundQuoteRejection =
  /** `refundItems` 為空陣列(🔴 僅此情形;任何 quantity ≤ 0 走 `invalid_quantity`) */
  | 'empty_refund'
  /** 要退的品項不在 `remainingItems` 內 */
  | 'unknown_item'
  /** `refundItems` 內同一 `orderItemId` 出現多次 */
  | 'duplicate_refund_item'
  /** `remainingItems` 內同一 `orderItemId` 出現多次 */
  | 'duplicate_remaining_item'
  /** 數量非安全整數 / ≤ 0 / 超 DB 上限(兩個輸入陣列都檢) */
  | 'invalid_quantity'
  /** 退款數量 > 該品項剩餘可退數量 */
  | 'quantity_exceeds_remaining'
  /** 金額非安全整數 / 負數 */
  | 'invalid_amount'
  /** 跨輸入金額 currency 不一致 */
  | 'currency_mismatch'
  /** 配送方式非 home/store(不讓 `calculateShippingFee` throw 逸出) */
  | 'invalid_shipping_method'
  /** 凍結運費規則欄非安全整數 / 負 / 超上限 */
  | 'invalid_shipping_rule'
  /** 任一輸入或乘 / 加 / 減中間值超過 DB integer 上限 */
  | 'amount_overflow'
  /** `currentDiscountTotal` ≠ 0(Phase 1 折扣恆 0;非 0 → fail-closed 走人工 SOP) */
  | 'discount_unsupported'
  /** `currentSubtotal` ≠ Σ(unitPrice × remainingQuantity)= orders 欄與品項漂移 */
  | 'subtotal_mismatch'
  /** 退後小計為 0 但非全退(零元品項殘留)→ 運費語意未經拍板、fail-closed */
  | 'zero_value_remainder_unsupported'
  /** 算出退款額 ≤ 0(例:退小額品項卻要補更多運費差)→ 拒、改整單取消或多退品項 */
  | 'non_positive_refund'
  /** 結構性壞輸入:`remainingItems` / `refundItems` 非陣列(命名對齊 `errors.ts:36` `invalid_field`) */
  | 'invalid_field';

/** 訂單當下某一剩餘品項 */
export interface RefundRemainingItem {
  orderItemId: string;
  unitPrice: Money;
  /** 當下還可退的數量(> 0) */
  remainingQuantity: number;
}

/** 本次要退的品項與數量(Q3=B 部分數量退) */
export interface RefundRequestItem {
  orderItemId: string;
  quantity: number;
}

export interface RefundQuoteInput {
  /** 🔴 DB `orders.shipping_method` 為無 CHECK 的 text → 本引擎自行白名單驗 */
  shippingMethod: ShippingMethod;
  /** 🔴 Q6=B:該訂單**下單當時凍結**的運費規則;呼叫端必給、引擎不 fallback 到常數 */
  shippingRule: ShippingRule;
  /** `orders.shipping_fee` 當下值 */
  currentShippingFee: Money;
  /** `orders.subtotal` 當下值(= 剩餘有效小計) */
  currentSubtotal: Money;
  /** `orders.discount_total`(Phase 1 恆 0) */
  currentDiscountTotal: Money;
  remainingItems: ReadonlyArray<RefundRemainingItem>;
  refundItems: ReadonlyArray<RefundRequestItem>;
}

/** 逐筆退款明細(供 RF2a 帳本 / RF6 預覽 / audit) */
export interface RefundQuoteLine {
  orderItemId: string;
  /** 本次退的數量 */
  quantity: number;
  unitPrice: Money;
  /** unitPrice × quantity */
  lineAmount: Money;
  /** 本次退完後該品項剩餘數量 */
  remainingQuantityAfter: number;
}

/**
 * 運費調整方向 + 非負金額。
 *
 * 🔴 為何不用 signed delta(codex 關卡1 R1-F1):`Money.amount` 走 `toMoneyAmount()`、
 * **實測禁負數**(`shared/types.ts` throw on negative)→ 「新運費 − 舊運費」為負時型別上不可成立。
 */
export interface RefundShippingAdjustment {
  /** `charge` = 新運費 > 舊(自退款額扣回);`refund` = 新 < 舊(回退給客人);`none` = 相等 */
  direction: 'charge' | 'refund' | 'none';
  /** 非負差額絕對值 */
  amount: Money;
}

export interface RefundQuote {
  /** 打 TapPay refund 的 `amount`(保證 > 0) */
  refundAmount: Money;
  /** 退品項金額小計 */
  refundedItemsAmount: Money;
  refundedLines: ReadonlyArray<RefundQuoteLine>;
  previousShippingFee: Money;
  /** 重算後的**訂單層級**運費(邊界④:單一數字) */
  newShippingFee: Money;
  shippingAdjustment: RefundShippingAdjustment;
  newSubtotal: Money;
  /** = newSubtotal + newShippingFee − discountTotal(鏡像 `orders_total_balances` CHECK) */
  newTotal: Money;
  /**
   * 是否為全退。
   *
   * 🔴 定義 = **每個剩餘品項的退款量都等於其 `remainingQuantity`**(全部退光),
   *   **不是** `newSubtotal === 0`(codex 關卡1 R1-F2):`order_items.unit_price CHECK (>= 0)`
   *   允許 0 → 留 NT$0 品項而退光付費品項時小計也是 0,若以金額判定會誤走全退、把運費歸零 = 少收運費。
   */
  fullRefund: boolean;
}

export type RefundQuoteResult =
  | { ok: true; quote: RefundQuote }
  | { ok: false; kind: RefundQuoteRejection };

function reject(kind: RefundQuoteRejection): RefundQuoteResult {
  return { ok: false, kind };
}

/** 金額欄守門:安全整數、非負、不超 DB 上限 */
function badAmount(m: Money): RefundQuoteRejection | null {
  if (!Number.isSafeInteger(m.amount)) return 'invalid_amount';
  if (m.amount < 0) return 'invalid_amount';
  if (m.amount > DB_INT_MAX) return 'amount_overflow';
  return null;
}

/** 數量守門:安全整數、> 0、不超 DB 上限 */
function badQuantity(q: number): RefundQuoteRejection | null {
  if (!Number.isSafeInteger(q)) return 'invalid_quantity';
  if (q <= 0) return 'invalid_quantity';
  if (q > DB_INT_MAX) return 'invalid_quantity';
  return null;
}

/** 中間運算結果守門(乘 / 加 / 減皆過) */
function badComputed(n: number): RefundQuoteRejection | null {
  if (!Number.isSafeInteger(n)) return 'amount_overflow';
  if (n > DB_INT_MAX) return 'amount_overflow';
  return null;
}

/**
 * 算「本次退款該退客人多少錢」+ 訂單三金額欄新值 + 逐筆明細。
 *
 * stateless:多次連續部分退 = 呼叫端每次傳「退款當下剩餘」(邊界①)。
 * 整單取消 = 把全部剩餘品項與全部剩餘數量當 `refundItems` 傳入(走 `fullRefund` 路徑)。
 *
 * 🔴 對外零 throw;所有拒絕情形回 `{ ok: false, kind }`。
 */
export function computeRefundQuote(input: RefundQuoteInput): RefundQuoteResult {
  // 🔴 **零 throw 的最外層機制保證**(codex 關卡2 must-fix)。
  //   前一版只對「literal 壞值」做逐欄守門,但仍有多條會 throw 的路徑:
  //   `input` 本身為 null/undefined(解構即 throw)、欄位是 throwing getter、
  //   Proxy 的 `get`/iterator trap throw、巢狀 `Money` 為 null(讀 `.amount` throw)。
  //   逐欄防禦永遠追不完病態輸入 → **用 try/catch 當機制底線**,任何逸出的例外一律轉
  //   `invalid_field`。金流呼叫端(RF5)因此可以無條件信任「本函式不會拋」。
  try {
    return computeRefundQuoteUnsafe(input);
  } catch {
    return reject('invalid_field');
  }
}

/** 內部實作;可能對病態輸入 throw,一律由 `computeRefundQuote` 的 try/catch 兜住。 */
function computeRefundQuoteUnsafe(input: RefundQuoteInput): RefundQuoteResult {
  if (input === null || typeof input !== 'object') return reject('invalid_field');
  const {
    shippingMethod,
    shippingRule,
    currentShippingFee,
    currentSubtotal,
    currentDiscountTotal,
    remainingItems,
    refundItems,
  } = input;

  // ── 1. 配送方式白名單(先擋,避免下游 calculateShippingFee throw)──
  if (shippingMethod !== 'home' && shippingMethod !== 'store') {
    return reject('invalid_shipping_method');
  }

  // ── 2. 凍結運費規則守門 ──
  for (const v of [shippingRule?.freeThreshold, shippingRule?.homeFee]) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > DB_INT_MAX) {
      return reject('invalid_shipping_rule');
    }
  }

  // ── 2b. 陣列型別守門 ──
  //
  // 🔴 為何要驗(code-reviewer N3):TS 型別說是陣列,但值來自 DB / RPC / HTTP 邊界。
  //   不驗則 null/undefined 會在下方 `for…of` 與 `.length` 處拋 TypeError、
  //   破壞「對外零 throw」保證,且與已對 shippingMethod / shippingRule 做 runtime 驗的做法不對稱。
  if (!Array.isArray(remainingItems) || !Array.isArray(refundItems)) {
    return reject('invalid_field');
  }

  // ── 3. 訂單層級金額守門 + 幣別一致 ──
  //
  // 🔴 **刻意不驗** `currentShippingFee === calculateShippingFee(currentSubtotal, method, rule)`
  //   (code-reviewer N4):RF2a-0 以欄位 `NOT NULL DEFAULT` 回填既有訂單的凍結規則,
  //   舊單當初成交的 `shipping_fee` 可能與回填的規則不自洽(例:未來調門檻前成交的單)。
  //   若補上這道一致性 gate,會誤擋**所有**舊單退款。⚠️ 未來勿「順手補上」。
  for (const m of [currentShippingFee, currentSubtotal, currentDiscountTotal]) {
    const bad = badAmount(m);
    if (bad) return reject(bad);
  }
  // 🔴 幣別必須是 PCM 唯一合法幣別 TWD(codex 關卡2 must-fix):
  //   `Currency` 型別雖只有 'TWD',但值來自 DB/HTTP 邊界 —— 只驗「彼此相等」的話,
  //   全部欄位都是 'USD' 會通過並產出 USD 的退款 quote(送進 TapPay = 錢算錯)。
  const currency = currentSubtotal.currency;
  if (currency !== 'TWD') return reject('currency_mismatch');
  if (currentShippingFee.currency !== currency || currentDiscountTotal.currency !== currency) {
    return reject('currency_mismatch');
  }

  // Phase 1 折扣恆 0;非 0 的退款語意未經拍板 → fail-closed 走人工
  if (currentDiscountTotal.amount !== 0) return reject('discount_unsupported');

  // ── 4. remainingItems 守門(重複 id / 數量 / 金額 / 幣別)+ 對帳 subtotal ──
  const remainingById = new Map<string, RefundRemainingItem>();
  let remainingSum = 0;
  for (const item of remainingItems) {
    // 🔴 逐筆結構驗(codex 關卡2 must-fix):`orderItemId` 未驗型別時,同一個 `Symbol()`
    //   同放 remaining/refund 可成功產出「含 Symbol 的 quote」→ RF2a 帳本寫入與 JSON 序列化會出事。
    if (item === null || typeof item !== 'object') return reject('invalid_field');
    if (typeof item.orderItemId !== 'string' || item.orderItemId.length === 0) {
      return reject('invalid_field');
    }
    if (item.unitPrice === null || typeof item.unitPrice !== 'object') return reject('invalid_field');
    if (remainingById.has(item.orderItemId)) return reject('duplicate_remaining_item');
    const badQ = badQuantity(item.remainingQuantity);
    if (badQ) return reject(badQ);
    const badU = badAmount(item.unitPrice);
    if (badU) return reject(badU);
    if (item.unitPrice.currency !== currency) return reject('currency_mismatch');

    const line = item.unitPrice.amount * item.remainingQuantity;
    const badLine = badComputed(line);
    if (badLine) return reject(badLine);
    remainingSum += line;
    const badSum = badComputed(remainingSum);
    if (badSum) return reject(badSum);

    remainingById.set(item.orderItemId, item);
  }
  // orders.subtotal 必須等於剩餘品項和;不等 = 資料漂移,絕不硬算退款
  if (remainingSum !== currentSubtotal.amount) return reject('subtotal_mismatch');

  // ── 5. refundItems 守門(空 / 重複 / 未知 / 數量超額)+ 算退款品項金額與明細 ──
  if (refundItems.length === 0) return reject('empty_refund');

  const refundQtyById = new Map<string, number>();
  const lines: RefundQuoteLine[] = [];
  let refundedItemsAmount = 0;

  for (const req of refundItems) {
    if (req === null || typeof req !== 'object') return reject('invalid_field');
    if (typeof req.orderItemId !== 'string' || req.orderItemId.length === 0) {
      return reject('invalid_field');
    }
    if (refundQtyById.has(req.orderItemId)) return reject('duplicate_refund_item');
    const badQ = badQuantity(req.quantity);
    if (badQ) return reject(badQ);

    const remaining = remainingById.get(req.orderItemId);
    if (!remaining) return reject('unknown_item');
    if (req.quantity > remaining.remainingQuantity) return reject('quantity_exceeds_remaining');

    const lineAmount = remaining.unitPrice.amount * req.quantity;
    const badLine = badComputed(lineAmount);
    if (badLine) return reject(badLine);
    refundedItemsAmount += lineAmount;
    const badAcc = badComputed(refundedItemsAmount);
    if (badAcc) return reject(badAcc);

    refundQtyById.set(req.orderItemId, req.quantity);
    lines.push({
      orderItemId: req.orderItemId,
      quantity: req.quantity,
      unitPrice: { amount: remaining.unitPrice.amount, currency },
      lineAmount: { amount: toMoneyAmount(lineAmount), currency },
      remainingQuantityAfter: remaining.remainingQuantity - req.quantity,
    });
  }

  // ── 6. 全退判定:每個剩餘品項都被退光(🔴 非以金額判定,見 RefundQuote.fullRefund)──
  const fullRefund =
    remainingItems.length > 0 &&
    remainingItems.every((it) => refundQtyById.get(it.orderItemId) === it.remainingQuantity);

  const newSubtotalAmount = currentSubtotal.amount - refundedItemsAmount;
  // 上面已擋 quantity_exceeds_remaining 與 subtotal_mismatch,理論上不會為負;仍留守門(fail-closed)
  if (newSubtotalAmount < 0) return reject('invalid_amount');

  // 零元品項殘留:小計歸零但沒全退 → 運費語意未經 Sean 拍板,不由引擎發明
  if (newSubtotalAmount === 0 && !fullRefund) {
    return reject('zero_value_remainder_unsupported');
  }

  // ── 7. 運費重算(邊界②全退回退運費;否則用**凍結規則**重算)──
  const newSubtotal: Money = { amount: toMoneyAmount(newSubtotalAmount), currency };
  const newShippingFee: Money = fullRefund
    ? { amount: toMoneyAmount(0), currency }
    : calculateShippingFee(newSubtotal, shippingMethod, shippingRule);

  const feeDiff = newShippingFee.amount - currentShippingFee.amount;
  const shippingAdjustment: RefundShippingAdjustment = {
    direction: feeDiff > 0 ? 'charge' : feeDiff < 0 ? 'refund' : 'none',
    amount: { amount: toMoneyAmount(Math.abs(feeDiff)), currency },
  };

  // ── 8. 退款額 = 退品項金額 −(新運費 − 舊運費);以非負算術表達 ──
  const refundAmountRaw =
    shippingAdjustment.direction === 'charge'
      ? refundedItemsAmount - shippingAdjustment.amount.amount
      : shippingAdjustment.direction === 'refund'
        ? refundedItemsAmount + shippingAdjustment.amount.amount
        : refundedItemsAmount;

  const badRefund = badComputed(refundAmountRaw);
  if (badRefund) return reject(badRefund);
  // 退小額品項卻要補更多運費差 → 退款額 ≤ 0,拒絕(提示改整單取消或多退品項)
  if (refundAmountRaw <= 0) return reject('non_positive_refund');

  const newTotalAmount = newSubtotalAmount + newShippingFee.amount - currentDiscountTotal.amount;
  const badTotal = badComputed(newTotalAmount);
  if (badTotal) return reject(badTotal);
  if (newTotalAmount < 0) return reject('invalid_amount');

  return {
    ok: true,
    quote: {
      refundAmount: { amount: toMoneyAmount(refundAmountRaw), currency },
      refundedItemsAmount: { amount: toMoneyAmount(refundedItemsAmount), currency },
      refundedLines: lines,
      // 淺拷貝輸入來源的 Money(code-reviewer N6:純函式不把輸入物件參照洩進輸出,
      // 免呼叫端改輸入連帶改 quote)
      previousShippingFee: { amount: currentShippingFee.amount, currency },
      newShippingFee,
      shippingAdjustment,
      newSubtotal,
      newTotal: { amount: toMoneyAmount(newTotalAmount), currency },
      fullRefund,
    },
  };
}
