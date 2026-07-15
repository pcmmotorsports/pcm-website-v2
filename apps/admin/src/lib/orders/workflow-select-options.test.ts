import { describe, it, expect } from 'vitest';
import type { OrderStatusOption } from '@pcm/domain';
import { buildWorkflowSelectOptions } from './workflow-select-options';
import { WF_CLEAR_VALUE } from './workflow-form';

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

describe('buildWorkflowSelectOptions', () => {
  it('should put neutral 未設定 sentinel first', () => {
    const r = buildWorkflowSelectOptions(null, byCode, active);
    expect(r[0]).toEqual({ value: WF_CLEAR_VALUE, label: '未設定', color: null, textColor: null });
    expect(r).toHaveLength(3);
  });

  it('should carry curated color/textColor for active options', () => {
    const r = buildWorkflowSelectOptions('shipped', byCode, active);
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
    const r = buildWorkflowSelectOptions('legacy', map, active);
    expect(r[1]).toEqual({
      value: 'legacy',
      label: '舊狀態(已停用)',
      color: '#111111',
      textColor: 'light',
    });
  });

  it('should add neutral orphan fallback for unknown code without inventing color', () => {
    const r = buildWorkflowSelectOptions('ghost', byCode, active);
    expect(r[1]).toEqual({ value: 'ghost', label: 'ghost(已停用)', color: null, textColor: null });
  });
});
