import { describe, it, expect } from 'vitest';
import type { OrderStatusOption } from '@pcm/domain';
import { buildWorkflowSelectOptions, resolveDefaultWorkflowValue } from './workflow-select-options';
import { WF_CLEAR_VALUE, WF_RECEIVED_UNCONFIRMED } from './workflow-form';

const opt = (over: Partial<OrderStatusOption>): OrderStatusOption => ({
  code: 'shipped',
  label: '出貨完成',
  color: '#DCE8D8',
  textColor: 'dark',
  sortOrder: 1,
  isActive: true,
  ...over,
});

const active = [opt({}), opt({ code: 'paid', label: '已收款', color: '#FBE4A6' })];
const byCode = new Map(active.map((o) => [o.code, o]));

// 既有孤兒/上色案:用 'refunded'(不過濾、全給)隔離,專測孤兒與策展色、不受半邊過濾干擾。
describe('buildWorkflowSelectOptions — 孤兒落點/策展色', () => {
  it('should put neutral 未設定 sentinel first', () => {
    const r = buildWorkflowSelectOptions(null, byCode, active, 'refunded');
    expect(r[0]).toEqual({ value: WF_CLEAR_VALUE, label: '未設定', color: null, textColor: null });
    expect(r).toHaveLength(3);
  });

  it('should carry curated color/textColor for active options', () => {
    const r = buildWorkflowSelectOptions('shipped', byCode, active, 'refunded');
    expect(r.find((o) => o.value === 'shipped')).toMatchObject({
      label: '出貨完成',
      color: '#DCE8D8',
      textColor: 'dark',
    });
    expect(r).toHaveLength(3);
  });

  it('should add orphan fallback with curated color when current code is inactive', () => {
    const disabled = opt({ code: 'legacy', label: '舊狀態', color: '#111111', textColor: 'light', isActive: false });
    const map = new Map([...byCode, ['legacy', disabled]]);
    const r = buildWorkflowSelectOptions('legacy', map, active, 'refunded');
    expect(r[1]).toEqual({
      value: 'legacy',
      label: '舊狀態(已停用)',
      color: '#111111',
      textColor: 'light',
    });
  });

  it('should add neutral orphan fallback for unknown code without inventing color', () => {
    const r = buildWorkflowSelectOptions('ghost', byCode, active, 'refunded');
    expect(r[1]).toEqual({ value: 'ghost', label: 'ghost(已停用)', color: null, textColor: null });
  });
});

// ── 付款半邊過濾(已收未定 A 案、Sean 2026-07-24 Q1/Q2 拍板)────────────────────
// 真實 9 狀態:已收半邊 4(received_*/shipped_done/instock_available)、未收半邊 4(unpaid_*)、
// 中性 cancelled。順序=activeOptions 傳入順序(函式不排序)。
const REAL: OrderStatusOption[] = [
  opt({ code: 'received_confirmed', label: '已收已定', sortOrder: 10 }),
  opt({ code: 'received_unconfirmed', label: '已收未定', sortOrder: 20 }),
  opt({ code: 'shipped_done', label: '出貨完成', sortOrder: 30 }),
  opt({ code: 'unpaid_confirmed', label: '未收已定', sortOrder: 40 }),
  opt({ code: 'unpaid_shipped', label: '未收出貨', sortOrder: 50 }),
  opt({ code: 'unpaid_unconfirmed', label: '未收未定', sortOrder: 60 }),
  opt({ code: 'unpaid_instock', label: '未收現貨', sortOrder: 70 }),
  opt({ code: 'instock_available', label: '現貨在庫', sortOrder: 80 }),
  opt({ code: 'cancelled', label: '已取消', sortOrder: 90 }),
];
const realByCode = new Map(REAL.map((o) => [o.code, o]));
const codesOf = (r: ReturnType<typeof buildWorkflowSelectOptions>): string[] =>
  r.filter((o) => o.value !== WF_CLEAR_VALUE).map((o) => o.value);

describe('buildWorkflowSelectOptions — 付款半邊過濾', () => {
  it('paid:藏未收半邊、留已收半邊 + cancelled', () => {
    const codes = codesOf(buildWorkflowSelectOptions(null, realByCode, REAL, 'paid'));
    expect(codes).toEqual([
      'received_confirmed',
      'received_unconfirmed',
      'shipped_done',
      'instock_available',
      'cancelled',
    ]);
    expect(codes.some((c) => c.startsWith('unpaid_'))).toBe(false);
  });

  it('unpaid:藏已收半邊、留未收半邊 + cancelled', () => {
    const codes = codesOf(buildWorkflowSelectOptions(null, realByCode, REAL, 'unpaid'));
    expect(codes).toEqual([
      'unpaid_confirmed',
      'unpaid_shipped',
      'unpaid_unconfirmed',
      'unpaid_instock',
      'cancelled',
    ]);
    expect(codes.some((c) => !c.startsWith('unpaid_') && c !== 'cancelled')).toBe(false);
  });

  it('partiallyPaid:不過濾、全 9 個都給(Q1=A)', () => {
    const codes = codesOf(buildWorkflowSelectOptions(null, realByCode, REAL, 'partiallyPaid'));
    expect(codes).toHaveLength(9);
  });

  it('refunded:不過濾、全 9 個都給(Q1=A)', () => {
    const codes = codesOf(buildWorkflowSelectOptions(null, realByCode, REAL, 'refunded'));
    expect(codes).toHaveLength(9);
  });

  it('cancelled 雙邊恆在(Q2=A)', () => {
    expect(codesOf(buildWorkflowSelectOptions(null, realByCode, REAL, 'paid'))).toContain('cancelled');
    expect(codesOf(buildWorkflowSelectOptions(null, realByCode, REAL, 'unpaid'))).toContain('cancelled');
  });

  it('當前值落在被藏的半邊仍保留(paid 單、現值 unpaid_confirmed)', () => {
    const r = buildWorkflowSelectOptions('unpaid_confirmed', realByCode, REAL, 'paid');
    const codes = codesOf(r);
    expect(codes).toContain('unpaid_confirmed');
    // 當前值是 active、非孤兒 → 只出現一次、不加「(已停用)」
    expect(codes.filter((c) => c === 'unpaid_confirmed')).toHaveLength(1);
    expect(r.find((o) => o.value === 'unpaid_confirmed')?.label).toBe('未收已定');
  });

  it('當前值落在被藏的半邊仍保留(unpaid 單、現值 received_confirmed)', () => {
    const codes = codesOf(buildWorkflowSelectOptions('received_confirmed', realByCode, REAL, 'unpaid'));
    expect(codes).toContain('received_confirmed');
  });

  it('自訂 code(無 unpaid_ 前綴、非 cancelled)歸已收半邊', () => {
    const custom = [...REAL, opt({ code: 'awaiting_stock', label: '等待進貨', sortOrder: 95 })];
    const map = new Map(custom.map((o) => [o.code, o]));
    // paid 單:自訂碼視為已收半邊 → 出現
    expect(codesOf(buildWorkflowSelectOptions(null, map, custom, 'paid'))).toContain('awaiting_stock');
    // unpaid 單:非未收半邊 → 被藏
    expect(codesOf(buildWorkflowSelectOptions(null, map, custom, 'unpaid'))).not.toContain('awaiting_stock');
  });
});

describe('resolveDefaultWorkflowValue — Q3 預設預選(已收未定 A 案)', () => {
  it('已設值 → 回該值(不受付款狀態影響)', () => {
    expect(resolveDefaultWorkflowValue('unpaid_shipped', REAL, 'paid')).toBe('unpaid_shipped');
  });

  it('paid 且未設值、已收未定在 active → 預選已收未定', () => {
    expect(resolveDefaultWorkflowValue(null, REAL, 'paid')).toBe(WF_RECEIVED_UNCONFIRMED);
  });

  it('防呆:paid 但已收未定未 active → 退「未設定」哨兵、不預選不存在的選項', () => {
    const without = REAL.filter((o) => o.code !== WF_RECEIVED_UNCONFIRMED);
    expect(resolveDefaultWorkflowValue(null, without, 'paid')).toBe(WF_CLEAR_VALUE);
  });

  it('unpaid / partiallyPaid / refunded 未設值 → 一律「未設定」哨兵', () => {
    expect(resolveDefaultWorkflowValue(null, REAL, 'unpaid')).toBe(WF_CLEAR_VALUE);
    expect(resolveDefaultWorkflowValue(null, REAL, 'partiallyPaid')).toBe(WF_CLEAR_VALUE);
    expect(resolveDefaultWorkflowValue(null, REAL, 'refunded')).toBe(WF_CLEAR_VALUE);
  });
});
