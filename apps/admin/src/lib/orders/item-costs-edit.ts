// item-costs-edit.ts — 老闆成本格【就地改】的純函式(A2,2026-09-14 設計窗;plan §1-d / §5)。
// 無 'use client'、無 DOM,item-costs-cells island 與測試共用。金額一律【字串】(不做算術;算術在 RPC 與 item-costs-view)。

import { COST_ROWS_MAX, parseCostAmountInput, isCostCurrency, type CostWriteRow } from './item-costs-view';

export type CostDraftValues = { costPrice: string; costShipping: string; costTax: string; currency: string };
export type CostDraft = {
  orderItemId: string;
  /** 畫面用:確認框列「單 / 商品 / 欄 / 舊 → 新」。 */
  orderDisplayId: string;
  itemTitle: string;
  /** 從 server 拿到的當下值(還沒設過 ⇒ 金額 ''、幣別 '')。 */
  baseline: CostDraftValues;
  current: CostDraftValues;
};

export const COST_FIELD_LABEL: Record<keyof CostDraftValues, string> = {
  costPrice: '原價',
  costShipping: '運費',
  costTax: '稅金',
  currency: '幣值',
};

/** 兩個字串值「算不算改了」:金額比的是正規化後的字面('' 與 '0' 同義、'12.50' 與 '12.5' 同義)。 */
export function amountEquals(a: string, b: string): boolean {
  const na = parseCostAmountInput(a);
  const nb = parseCostAmountInput(b);
  if (na === null || nb === null) return a.trim() === b.trim();
  return Number.parseFloat(na) === Number.parseFloat(nb);
}

/** 這一列改了哪幾格。 */
export function dirtyFields(d: CostDraft): (keyof CostDraftValues)[] {
  const out: (keyof CostDraftValues)[] = [];
  for (const k of ['costPrice', 'costShipping', 'costTax'] as const) {
    if (!amountEquals(d.baseline[k], d.current[k])) out.push(k);
  }
  if (d.baseline.currency !== d.current.currency) out.push('currency');
  return out;
}

export function dirtyCellCount(drafts: readonly CostDraft[]): number {
  return drafts.reduce((n, d) => n + dirtyFields(d).length, 0);
}

export type CostSubmitCheck =
  | { ok: true; rows: CostWriteRow[]; changed: number }
  | { ok: false; reason: 'nothing' | 'too_many' | 'bad_amount' | 'no_currency'; orderItemId?: string };

/**
 * 髒列 → 送 RPC 的列(只送改過的列,整列四個值都送;空金額當 0 —— 表的 DEFAULT 就是 0)。
 * 幣別沒選 / 金額打壞 ⇒ 不送,回原因給畫面講人話(server action 那邊還會再驗一次,這裡是為了在按之前就講)。
 */
export function buildCostSubmit(drafts: readonly CostDraft[]): CostSubmitCheck {
  const dirty = drafts.filter((d) => dirtyFields(d).length > 0);
  if (dirty.length === 0) return { ok: false, reason: 'nothing' };
  if (dirty.length > COST_ROWS_MAX) return { ok: false, reason: 'too_many' };
  const rows: CostWriteRow[] = [];
  let changed = 0;
  for (const d of dirty) {
    const price = parseCostAmountInput(d.current.costPrice);
    const shipping = parseCostAmountInput(d.current.costShipping);
    const tax = parseCostAmountInput(d.current.costTax);
    if (price === null || shipping === null || tax === null) return { ok: false, reason: 'bad_amount', orderItemId: d.orderItemId };
    if (!isCostCurrency(d.current.currency)) return { ok: false, reason: 'no_currency', orderItemId: d.orderItemId };
    rows.push({ orderItemId: d.orderItemId, costPrice: price, costShipping: shipping, costTax: tax, currency: d.current.currency });
    changed += dirtyFields(d).length;
  }
  return { ok: true, rows, changed };
}

export const COST_SUBMIT_REASON_TEXT: Record<Exclude<CostSubmitCheck, { ok: true }>['reason'], string> = {
  nothing: '沒有改到任何一格。',
  too_many: `一次最多存 ${COST_ROWS_MAX} 列,先存一部分。`,
  bad_amount: '有一格金額打壞了(只能是數字,最多 4 位小數)。',
  no_currency: '有一列還沒選幣別。',
};
