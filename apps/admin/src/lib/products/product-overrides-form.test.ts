import { describe, expect, it } from 'vitest';
import {
  OVERRIDE_FIELD_FIELD,
  OVERRIDE_HIGHLIGHT_FIELD,
  OVERRIDE_INTENT_FIELD,
  OVERRIDE_PRODUCT_ID_FIELD,
  OVERRIDE_RETURN_TO_FIELD,
  OVERRIDE_VALUE_FIELD,
  parseOverrideForm,
} from './product-overrides-form';

const PID = '11111111-2222-3333-4444-555555555555';

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  f.set(OVERRIDE_PRODUCT_ID_FIELD, PID);
  f.set(OVERRIDE_RETURN_TO_FIELD, `/products/${PID}`);
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe('商品文字「我們的版本」表單解析(丙方案片 2)', () => {
  it('存標題:去前後空白', () => {
    expect(parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'title', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_VALUE_FIELD]: '  我們的標題 ' }))).toEqual({
      ok: true, productId: PID, field: 'title', value: '我們的標題', returnTo: `/products/${PID}`,
    });
  });

  it('還原:不管欄位裡打了什麼,value 都是 null(刪鍵)', () => {
    const r = parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'subtitle', [OVERRIDE_INTENT_FIELD]: 'restore', [OVERRIDE_VALUE_FIELD]: '還有字' }));
    expect(r).toMatchObject({ ok: true, field: 'subtitle', value: null });
  });

  it('存空白標題 = 還原(value null),不會存一個空白標題', () => {
    const r = parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'title', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_VALUE_FIELD]: ' 　 ' }));
    expect(r).toMatchObject({ ok: true, value: null });
  });

  it('賣點:多欄位、空白那幾行丟掉;全空白 ⇒ null', () => {
    expect(parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'highlights', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_HIGHLIGHT_FIELD]: [' a ', '', ' b'] })))
      .toMatchObject({ ok: true, field: 'highlights', value: ['a', 'b'] });
    expect(parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'highlights', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_HIGHLIGHT_FIELD]: ['', ' '] })))
      .toMatchObject({ ok: true, value: null });
  });

  it('上限:標題 200、副標 300、賣點每點 200、最多 12 點(超過 ⇒ invalid)', () => {
    const t = (field: string, v: string) => parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: field, [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_VALUE_FIELD]: v }));
    expect(t('title', '字'.repeat(200)).ok).toBe(true);
    expect(t('title', '字'.repeat(201)).ok).toBe(false);
    expect(t('subtitle', '字'.repeat(300)).ok).toBe(true);
    expect(t('subtitle', '字'.repeat(301)).ok).toBe(false);
    const h = (items: string[]) => parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'highlights', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_HIGHLIGHT_FIELD]: items }));
    expect(h(['字'.repeat(201)]).ok).toBe(false);
    expect(h(Array.from({ length: 12 }, (_, i) => `點${i}`)).ok).toBe(true);
    expect(h(Array.from({ length: 13 }, (_, i) => `點${i}`)).ok).toBe(false);
  });

  it('不合法:欄位不在白名單(description 走說明鎖)、intent 不對、product_id 不是 uuid', () => {
    expect(parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'description', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_VALUE_FIELD]: 'x' })).ok).toBe(false);
    expect(parseOverrideForm(form({ [OVERRIDE_FIELD_FIELD]: 'title', [OVERRIDE_INTENT_FIELD]: 'delete', [OVERRIDE_VALUE_FIELD]: 'x' })).ok).toBe(false);
    const bad = form({ [OVERRIDE_FIELD_FIELD]: 'title', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_VALUE_FIELD]: 'x' });
    bad.set(OVERRIDE_PRODUCT_ID_FIELD, 'not-a-uuid');
    expect(parseOverrideForm(bad).ok).toBe(false);
  });

  it('return_to 只收 /products 底下,其他一律退回 /products', () => {
    const f = form({ [OVERRIDE_FIELD_FIELD]: 'title', [OVERRIDE_INTENT_FIELD]: 'save', [OVERRIDE_VALUE_FIELD]: 'x' });
    f.set(OVERRIDE_RETURN_TO_FIELD, 'https://evil.example/');
    expect(parseOverrideForm(f)).toMatchObject({ ok: true, returnTo: '/products' });
  });
});
