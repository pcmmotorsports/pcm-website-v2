// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/products/product-overrides-actions', () => ({ setProductOverrideAction: vi.fn() }));

const { ProductOverridesEditor } = await import('./product-overrides-editor');
const { readProductOverrides } = await import('../../lib/products/product-overrides-view');

const PID = '11111111-2222-3333-4444-555555555555';
const SUPPLIER = { title: 'Brake Lever', subtitle: '6-position adjustable', highlights: ['CNC machined', 'Folding tip'] };

afterEach(cleanup);

function card(field: string) {
  const el = document.querySelector(`[data-override-field="${field}"]`);
  expect(el, `找不到 ${field} 那張卡`).not.toBeNull();
  return el as HTMLElement;
}

describe('readProductOverrides', () => {
  it('合法形狀照讀;非預期形狀一律當沒填(頁面不壞)', () => {
    expect(readProductOverrides({ title: '我們的', highlights: ['a'] })).toEqual({ title: '我們的', subtitle: null, highlights: ['a'] });
    for (const bad of [null, undefined, '字串', [], { title: 1, subtitle: '', highlights: [1] }, { highlights: [] }]) {
      expect(readProductOverrides(bad)).toEqual({ title: null, subtitle: null, highlights: null });
    }
  });
});

describe('ProductOverridesEditor(丙方案片 2,照設計稿 設計稿-商品編輯-基本資料-20260927.html)', () => {
  it('沒填任何我們的版本 ⇒ 三張卡都標「網站顯示：供應商的」,沒有還原鈕', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({})} />);
    for (const f of ['title', 'subtitle', 'highlights']) {
      const c = card(f);
      expect(c.textContent).toContain('網站顯示：供應商的');
      expect(within(c).queryByRole('button', { name: '還原成供應商的' })).toBeNull();
    }
    expect(card('title').textContent).toContain('Brake Lever');
    expect(card('highlights').textContent).toContain('CNC machined');
  });

  it('標題有我們的版本 ⇒ 標「網站顯示：我們的版本」、輸入框帶值、有還原鈕;還原鈕送 intent=restore', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ title: '煞車拉桿組' })} />);
    const c = card('title');
    expect(c.textContent).toContain('網站顯示：我們的版本');
    expect((within(c).getByRole('textbox') as HTMLInputElement).value).toBe('煞車拉桿組');
    const restore = within(c).getByRole('button', { name: '還原成供應商的' }) as HTMLButtonElement;
    expect([restore.name, restore.value]).toEqual(['intent', 'restore']);
    const save = within(c).getByRole('button', { name: '儲存標題' }) as HTMLButtonElement;
    expect([save.name, save.value]).toEqual(['intent', 'save']);
    // 每張卡自己一個 form,帶 product_id / field / return_to
    const form = c.querySelector('form')!;
    expect(new FormData(form).get('product_id')).toBe(PID);
    expect(new FormData(form).get('field')).toBe('title');
    expect(new FormData(form).get('return_to')).toBe(`/products/${PID}`);
    // 副標沒填 ⇒ 仍是供應商的
    expect(card('subtitle').textContent).toContain('網站顯示：供應商的');
  });

  it('賣點:我們的每一點各一格,另外多兩格空白可以新增;欄位名都是 highlight', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ highlights: ['一', '二'] })} />);
    const inputs = card('highlights').querySelectorAll('input[name="highlight"]');
    expect([...inputs].map((i) => (i as HTMLInputElement).value)).toEqual(['一', '二', '', '']);
  });

  it('賣點已經 12 點 ⇒ 不再多給空白格', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `點${i}`);
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ highlights: twelve })} />);
    expect(card('highlights').querySelectorAll('input[name="highlight"]')).toHaveLength(12);
  });
});
