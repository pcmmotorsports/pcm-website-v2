// status-option-form.test.ts — 狀態選項設定純函式核心(M-4a Slice D-3;Origin 白名單複用 + 表單→update 解析)。

import { describe, it, expect } from 'vitest';
import {
  isAllowedOrigin,
  parseStatusOptionEditForm,
  CODE_FIELD,
  LABEL_FIELD,
  COLOR_FIELD,
  TEXT_COLOR_FIELD,
  SORT_ORDER_FIELD,
  IS_ACTIVE_FIELD,
  type FormLike,
} from './status-option-form';

function form(entries: Record<string, string>): FormLike {
  const m = new Map(Object.entries(entries));
  return { get: (k) => m.get(k) ?? null, has: (k) => m.has(k) };
}

const VALID: Record<string, string> = {
  [CODE_FIELD]: 'received_confirmed',
  [LABEL_FIELD]: '已收已定',
  [COLOR_FIELD]: '#FBE4A6',
  [TEXT_COLOR_FIELD]: 'dark',
  [SORT_ORDER_FIELD]: '10',
  [IS_ACTIVE_FIELD]: 'on',
};

describe('isAllowedOrigin — 複用 Slice C(fail-closed)', () => {
  it('缺 Origin 拒 / prod 精確等值 / dev localhost 才放', () => {
    expect(isAllowedOrigin(null, { devBypass: true })).toBe(false);
    expect(isAllowedOrigin('https://admin.pcmmotorsports.com', { devBypass: false })).toBe(true);
    expect(isAllowedOrigin('http://localhost:3213', { devBypass: true })).toBe(true);
    expect(isAllowedOrigin('http://localhost:3213', { devBypass: false })).toBe(false);
  });
});

describe('parseStatusOptionEditForm — 形狀守門(值域權威在 DB CHECK)', () => {
  it('合法整列 → ok、update 全 5 欄', () => {
    expect(parseStatusOptionEditForm(form(VALID))).toEqual({
      ok: true,
      code: 'received_confirmed',
      update: {
        label: '已收已定',
        color: '#FBE4A6',
        textColor: 'dark',
        sortOrder: 10,
        isActive: true,
      },
    });
  });

  it('is_active checkbox 缺(不勾)→ isActive false', () => {
    const noActive: Record<string, string> = {
      [CODE_FIELD]: 'received_confirmed',
      [LABEL_FIELD]: '已收已定',
      [COLOR_FIELD]: '#FBE4A6',
      [TEXT_COLOR_FIELD]: 'dark',
      [SORT_ORDER_FIELD]: '10',
    };
    const r = parseStatusOptionEditForm(form(noActive));
    expect(r.ok && r.update.isActive).toBe(false);
  });

  it('label trim + 空拒 + 上限 32', () => {
    const trimmed = parseStatusOptionEditForm(form({ ...VALID, [LABEL_FIELD]: '  已收  ' }));
    expect(trimmed.ok && trimmed.update.label).toBe('已收');
    expect(parseStatusOptionEditForm(form({ ...VALID, [LABEL_FIELD]: '   ' })).ok).toBe(false);
    expect(parseStatusOptionEditForm(form({ ...VALID, [LABEL_FIELD]: 'x'.repeat(33) })).ok).toBe(false);
  });

  it('color 非 #RRGGBB → false', () => {
    for (const bad of ['red', '#FFF', '#GGGGGG', 'FBE4A6', '#FBE4A6 ']) {
      expect(parseStatusOptionEditForm(form({ ...VALID, [COLOR_FIELD]: bad })).ok).toBe(false);
    }
  });

  it('text_color 僅 light/dark;其餘 → false', () => {
    expect(parseStatusOptionEditForm(form({ ...VALID, [TEXT_COLOR_FIELD]: 'light' })).ok).toBe(true);
    expect(parseStatusOptionEditForm(form({ ...VALID, [TEXT_COLOR_FIELD]: 'medium' })).ok).toBe(false);
  });

  it('sort_order 非負整數;負 / 小數 / 非數 / 空 / 溢位 → false;0 → ok', () => {
    for (const bad of ['-1', '1.5', 'abc', '', '99999999999']) {
      expect(parseStatusOptionEditForm(form({ ...VALID, [SORT_ORDER_FIELD]: bad })).ok).toBe(false);
    }
    expect(parseStatusOptionEditForm(form({ ...VALID, [SORT_ORDER_FIELD]: '0' })).ok).toBe(true);
  });

  it('code 非法形狀 / 保留字(unset / __clear__)/ 空 → false', () => {
    for (const bad of ['UPPER', 'has space', 'unset', '__clear__', '']) {
      expect(parseStatusOptionEditForm(form({ ...VALID, [CODE_FIELD]: bad })).ok).toBe(false);
    }
  });
});
