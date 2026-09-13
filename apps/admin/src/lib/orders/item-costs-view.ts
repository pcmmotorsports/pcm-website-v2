import { FX_CURRENCIES } from '../fx/fx-rate-view';

// item-costs-view.ts — 「老闆:成本」的純函式層(admin-only;plan `docs/plans/2026-09-14-order-item-cost-columns-plan.md` §1-a / §1-c)。
//
// 🔴 成本型別**不進 `packages/domain`**:那裡的型別顧客站也 import(`types.ts:80/102/136` 三條紅線)。住這裡。
// 🔴 金額一律**字串**,不過 JSON number:`numeric(14,4)` 過 JSON number 會掉精度,而 4 位小數 × 匯率 × 數量的乘積
//    要在最後才 round 一次(Sean 09-13:三欄外幣,乘匯率才是台幣;原價 / 運費整列一個數、稅金 × 數量)。
//    算術用 `BigInt` 定點(scale 4 + 匯率 scale 6 = 10 位小數),不用 float。
// 🔴 台幣總計 / 利潤**不存 DB**,讀時算(`20260914010000` 檔頭同一句):
//    cost_twd   = round((cost_price + cost_shipping + cost_tax × qty) × fx_rate)   四捨五入到整數元,只 round 一次
//    profit_twd = line_total − cost_twd                                           line_total 是 integer 元

/** 一列品項成本(`order_item_costs` 一列;金額 `::text` 取回,不過 number)。 */
export type OrderItemCost = {
  orderItemId: string;
  /** 外幣,`numeric(14,4)` 的字串形。 */
  costPrice: string;
  costShipping: string;
  costTax: string;
  currency: string;
  /** 寫入當下抄的匯率(`numeric` 字串)。 */
  fxRate: string;
  fxRateId: number | null;
  updatedBy: string;
  updatedAt: string;
};

/** 算出來的台幣數(整數元)。`null` = 這一項沒填成本(不是 0)。 */
export type OrderItemCostTwd = {
  costTwd: number;
  profitTwd: number;
};

export const COST_CURRENCY_CODES: readonly string[] = FX_CURRENCIES.map((c) => c.code);

/** 表單輸入(老闆打的字)→ 送 RPC 的字串;`null` = 不合法。最多 4 位小數、非負、不是 NaN / 空。缺 = 0(RPC 同款)。 */
export function parseCostAmountInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return '0';
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return '0';
  if (!/^\d{1,10}(\.\d{1,4})?$/.test(s)) return null;
  return s;
}

export function isCostCurrency(raw: unknown): raw is string {
  return typeof raw === 'string' && COST_CURRENCY_CODES.includes(raw);
}

/** 十進位字串 → 定點 BigInt(scale 位小數);不合法 ⇒ null。 */
function toFixed(s: string, scale: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (m === null) return null;
  const digits = (m[2] ?? '').replace(/0+$/, ''); // 尾 0 不是精度(`35.1234560` = `35.123456`;DB numeric 會這樣吐)
  if (digits.length > scale) return null; // 超過 scale 的「有效」小數 = 不是這一層該吞的精度
  const frac = digits.padEnd(scale, '0');
  return BigInt(m[1]!) * 10n ** BigInt(scale) + BigInt(frac || '0');
}

/** 四捨五入到整數(定點 BigInt, 非負值);負數本函式不會遇到(三欄 + 匯率都 >= 0)。 */
function roundHalfUp(value: bigint, scale: number): bigint {
  const unit = 10n ** BigInt(scale);
  const q = value / unit;
  const r = value % unit;
  return r * 2n >= unit ? q + 1n : q;
}

const AMOUNT_SCALE = 4;
const RATE_SCALE = 6;

/**
 * 台幣總計 / 利潤。`null` = 算不出來(欄位不合法 / 匯率不合法);呼叫端印「—」不印 0。
 * 🔴 只在最後 round 一次(plan §1-a 逐字);中間全部定點整數,零 float。
 * 🔴 `fxRate` 超過 6 位【有效】小數的世界 ⇒ null(fx_rates 那頁最多收 6 位;RPC 抄的就是那個值);尾 0 不算。
 */
export function computeItemCostTwd(
  row: Pick<OrderItemCost, 'costPrice' | 'costShipping' | 'costTax' | 'fxRate'>,
  item: { quantity: number; lineTotal: number },
): OrderItemCostTwd | null {
  const price = toFixed(row.costPrice, AMOUNT_SCALE);
  const shipping = toFixed(row.costShipping, AMOUNT_SCALE);
  const tax = toFixed(row.costTax, AMOUNT_SCALE);
  const rate = toFixed(row.fxRate, RATE_SCALE);
  if (price === null || shipping === null || tax === null || rate === null) return null;
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) return null;
  if (!Number.isSafeInteger(item.lineTotal)) return null;
  const foreign = price + shipping + tax * BigInt(item.quantity); // scale 4
  const twd = roundHalfUp(foreign * rate, AMOUNT_SCALE + RATE_SCALE); // scale 10 → 整數元
  if (twd > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const costTwd = Number(twd);
  return { costTwd, profitTwd: item.lineTotal - costTwd };
}

/** 顯示用:外幣金額去掉多餘的尾 0(`100.5000` → `100.5`、`0.0000` → `0`)。 */
export function trimAmount(s: string): string {
  if (!/^\d+(\.\d+)?$/.test(s)) return s;
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

// ── 表單 → RPC 列(server action 用;住這裡因為 'use server' 檔只能 export async function)──────────
export const COST_ROWS_FIELD = 'cost_rows';
/** 一發最多幾列(批次「改成本(勾選的列)」的上限;超過 ⇒ invalid,不靜靜截斷)。 */
export const COST_ROWS_MAX = 200;

export type CostWriteRow = {
  orderItemId: string;
  costPrice: string;
  costShipping: string;
  costTax: string;
  currency: string;
};

export type CostResultCode =
  | 'cost_saved'
  | 'cost_denied'
  | 'cost_invalid'
  | 'cost_no_fx'
  | 'cost_rejected'
  | 'cost_error';

/**
 * `COST_ROWS_FIELD` 的 JSON 字串 → RPC 列;任何一列不合法 ⇒ 整包 `null`(不寫一半)。
 * 金額走 `parseCostAmountInput`(空 / 缺 = '0'),幣別白名單,id 要像 uuid(RPC 再嚴驗一次)。
 */
export function parseCostRowsField(raw: unknown): CostWriteRow[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > COST_ROWS_MAX) return null;
  const out: CostWriteRow[] = [];
  for (const el of parsed) {
    const o = el as Record<string, unknown>;
    if (typeof o !== 'object' || o === null) return null;
    if (typeof o.orderItemId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(o.orderItemId)) return null;
    const costPrice = parseCostAmountInput(o.costPrice);
    const costShipping = parseCostAmountInput(o.costShipping);
    const costTax = parseCostAmountInput(o.costTax);
    if (costPrice === null || costShipping === null || costTax === null) return null;
    if (!isCostCurrency(o.currency)) return null;
    out.push({ orderItemId: o.orderItemId.toLowerCase(), costPrice, costShipping, costTax, currency: o.currency });
  }
  return out;
}
