// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminForm, AdminFormField } from './admin-form';

// E11-2 積木 smoke test。重點不在欄位業務規則,在共用外框不能靜默改壞的契約:
//   ① hidden 欄位順序 ② card/section 與 2/3 欄版面分派 ③選配 heading/footerHint
//   ④呼叫端保留欄位控制項與 client island actions 的插槽。

const ACTION = async () => {};

function setup({
  variant = 'card',
  columns,
  heading,
  hidden,
  footerHint,
}: {
  variant?: 'card' | 'section';
  columns?: 2 | 3;
  heading?: string;
  hidden?: Record<string, string | number>;
  footerHint?: string;
} = {}) {
  return render(
    <AdminForm
      action={ACTION}
      variant={variant}
      columns={columns}
      heading={heading}
      hidden={hidden}
      footerHint={footerHint}
      actions={<button type='submit'>儲存</button>}
    >
      <AdminFormField label='出貨方式'>
        <input name='shipping_method' />
      </AdminFormField>
    </AdminForm>,
  );
}

afterEach(cleanup);

describe('AdminForm', () => {
  it('should render hidden inputs in insertion order with the original names and values', () => {
    const { container } = setup({
      hidden: { order_id: 'order-1', version: 7, return_to: '/orders/order-1' },
    });
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')];
    expect(inputs).toHaveLength(3);
    expect(inputs.map(({ name, value }) => [name, value])).toEqual([
      ['order_id', 'order-1'],
      ['version', '7'],
      ['return_to', '/orders/order-1'],
    ]);
  });

  it('should omit the heading when absent and render it when provided', () => {
    const absent = setup();
    expect(absent.container.querySelector('h2')).toBeNull();
    absent.unmount();

    const present = setup({ heading: '編輯訂單' });
    const heading = present.container.querySelector('h2');
    expect(heading?.textContent).toBe('編輯訂單');
    expect(heading?.className).toBe('mb-3 text-sm font-semibold');
  });

  it('should omit the footer hint when absent and render it with mr-auto when provided', () => {
    const absent = setup();
    expect(absent.container.querySelector('.mr-auto')).toBeNull();
    absent.unmount();

    const present = setup({ footerHint: '變更會寫入稽核紀錄。' });
    const hint = present.container.querySelector('.mr-auto');
    expect(hint?.textContent).toBe('變更會寫入稽核紀錄。');
    expect(hint?.className).toContain('text-muted-foreground');
    expect(hint?.className).toContain('text-xs');
  });

  it('should use the two-column grid by default and a different grid for columns=3', () => {
    const defaultColumns = setup();
    const defaultGrid = defaultColumns.container.querySelector('form > div');
    expect(defaultGrid?.className).toBe('grid gap-3 sm:grid-cols-2');
    defaultColumns.unmount();

    const threeColumns = setup({ columns: 3 });
    const threeColumnGrid = threeColumns.container.querySelector('form > div');
    expect(threeColumnGrid?.className).toBe('grid gap-3 sm:grid-cols-2 lg:grid-cols-3');
  });

  it('should use different form classes for card and section variants', () => {
    const card = setup({ variant: 'card' });
    expect(card.container.querySelector('form')?.className).toBe(
      'rounded-lg border bg-card p-4 text-card-foreground',
    );
    card.unmount();

    const section = setup({ variant: 'section' });
    expect(section.container.querySelector('form')?.className).toBe('mt-3 border-t pt-3');
  });

  it('should render AdminFormField as a label, label text span, and child control', () => {
    const { container } = setup();
    const label = container.querySelector('label');
    expect(label?.className).toBe('flex flex-col gap-1 text-sm');
    expect(label?.querySelector('span')?.textContent).toBe('出貨方式');
    expect(label?.querySelector('span')?.className).toBe(
      'text-muted-foreground text-xs font-medium',
    );
    expect(label?.querySelector('input[name="shipping_method"]')).toBeTruthy();
  });

  it('should render actions inside the action row', () => {
    const { getByRole } = setup();
    const button = getByRole('button', { name: '儲存' });
    expect(button.parentElement?.className).toBe('mt-4 flex items-center justify-end gap-2');
  });
});
