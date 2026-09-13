// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('../../lib/orders/item-costs-actions', () => ({ setOrderItemCostsAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { CostCellInputs, CostEditProvider, CostUnsavedBar, CostsBulkDialog } from './item-costs-cells';

afterEach(cleanup);

describe('🔴 R1 成本外洩紅線:CostCellInputs 的 props 只有純量', () => {
  it('props 型別區塊裡每一個欄位都是 string(不收物件 / 陣列 / Map)', () => {
    const src = readFileSync(join(__dirname, 'item-costs-cells.tsx'), 'utf8');
    const start = src.indexOf('export function CostCellInputs({');
    const typeStart = src.indexOf('}: {', start);
    const typeEnd = src.indexOf('\n}) {', typeStart);
    const block = src.slice(typeStart, typeEnd);
    const fields = [...block.matchAll(/^\s+([a-zA-Z]+)\??:\s*([^;]+);/gm)].map((m) => [m[1], m[2]!.trim()] as const);
    expect(fields.length, '沒解析到任何 prop ⇒ 這把尺失去判別力').toBeGreaterThan(5);
    for (const [name, type] of fields) {
      expect(type, `prop \`${name}\` 的型別是 ${type} —— 只准純量字串`).toBe('string');
    }
  });
});

function Harness({ price = '10', currency = 'EUR' }: { price?: string; currency?: string }) {
  return (
    <CostEditProvider>
      <CostUnsavedBar returnTo='/orders?boss=1' />
      <table>
        <tbody>
          <tr>
            <CostCellInputs
              orderItemId='11111111-2222-4333-8444-555555555555'
              orderDisplayId='ABC123'
              itemTitle='油杯蓋'
              costPrice={price}
              costShipping='0'
              costTax='1.5'
              currency={currency}
              fxRate='35.2'
              currencies='EUR,USD,TWD'
              tdClass='boss-cell'
            />
          </tr>
        </tbody>
      </table>
    </CostEditProvider>
  );
}

describe('就地改 → 浮條 → 確認框 → 隱形表單', () => {
  it('沒改 ⇒ 沒有浮條;改一格 ⇒ 「已改 1 格」+ 那格 dirty;取消變更 ⇒ 退回、浮條消失', () => {
    const { queryByTestId, getByLabelText, getByText } = render(<Harness />);
    expect(queryByTestId('costs-unsaved-bar')).toBeNull();
    const price = getByLabelText('油杯蓋 原價') as HTMLInputElement;
    fireEvent.change(price, { target: { value: '12' } });
    expect(queryByTestId('costs-unsaved-bar')!.textContent).toContain('已改 1 格');
    expect(price.closest('td')!.className).toContain('costs-dirty');
    fireEvent.click(getByText('取消變更'));
    expect(queryByTestId('costs-unsaved-bar')).toBeNull();
    expect(price.value).toBe('10');
  });
  it('確認全部 ⇒ 確認框列出 單 / 商品 / 欄 / 舊 → 新,隱形表單帶 JSON 列 + return_to', () => {
    const { getByLabelText, getByText, container } = render(<Harness />);
    fireEvent.change(getByLabelText('油杯蓋 原價'), { target: { value: '12' } });
    fireEvent.change(getByLabelText('油杯蓋 幣值'), { target: { value: 'USD' } });
    const dlg = container.querySelector('dialog.costs-confirm')!;
    (dlg as HTMLDialogElement).showModal = vi.fn();
    fireEvent.click(getByText('確認全部'));
    expect((dlg as HTMLDialogElement).showModal).toHaveBeenCalled();
    expect(dlg.textContent).toContain('ABC123');
    expect(dlg.textContent).toContain('油杯蓋');
    expect(dlg.textContent).toContain('原價');
    expect(dlg.textContent).toContain('10 → 12');
    expect(dlg.textContent).toContain('EUR → USD');
    const rows = JSON.parse((dlg.querySelector('input[name="cost_rows"]') as HTMLInputElement).value);
    expect(rows).toEqual([{ orderItemId: '11111111-2222-4333-8444-555555555555', costPrice: '12', costShipping: '0', costTax: '1.5', currency: 'USD' }]);
    expect((dlg.querySelector('input[name="return_to"]') as HTMLInputElement).value).toBe('/orders?boss=1');
    expect(getByText('確認(2 格)')).toBeTruthy();
  });
  it('🔴 幣別沒選就按確認全部 ⇒ 不開框、浮條講人話', () => {
    const { getByLabelText, getByText, container, queryByTestId } = render(<Harness price='' currency='' />);
    fireEvent.change(getByLabelText('油杯蓋 原價'), { target: { value: '5' } });
    const dlg = container.querySelector('dialog.costs-confirm') as HTMLDialogElement;
    dlg.showModal = vi.fn();
    fireEvent.click(getByText('確認全部'));
    expect(dlg.showModal).not.toHaveBeenCalled();
    expect(queryByTestId('costs-unsaved-bar')!.textContent).toContain('還沒選幣別');
  });
  it('幣別改了 ⇒ 匯率那格改印「存檔時帶」(存的匯率是那個幣別的抄本,不能沿用)', () => {
    const { getByLabelText, container } = render(<Harness />);
    expect(container.textContent).toContain('×35.2');
    fireEvent.change(getByLabelText('油杯蓋 幣值'), { target: { value: 'USD' } });
    expect(container.textContent).not.toContain('×35.2');
    expect(container.textContent).toContain('匯率存檔時帶');
  });
});


describe('A2-b 批次「套用到勾選的 N 列」:留空 = 不動、同一支 action', () => {
  const items = JSON.stringify([
    { orderItemId: '11111111-2222-4333-8444-555555555555', orderDisplayId: 'AAA111', itemTitle: '甲', costPrice: '10', costShipping: '0', costTax: '0', currency: 'EUR' },
    { orderItemId: '22222222-2222-4333-8444-555555555555', orderDisplayId: 'BBB222', itemTitle: '乙', costPrice: '', costShipping: '', costTax: '', currency: '' },
  ]);
  it('全留空 ⇒ 確認鎖住 + 「沒有改到任何一格」', () => {
    const { getByText, container } = render(<CostsBulkDialog closeHref='/orders' returnTo='/orders?boss=1' itemsJson={items} currencies='EUR,USD' />);
    expect(getByText('套用到勾選的 2 列')).toBeTruthy();
    expect(container.textContent).toContain('沒有改到任何一格');
    // 取消鈕也是 type=submit(form= 指回殼)⇒ 抓確認那顆(.costs-btn--p)
    expect((container.querySelector('[data-testid="costs-bulk-form"] button.costs-btn--p') as HTMLButtonElement).disabled).toBe(true);
  });
  it('只填運費 ⇒ 兩列都送、其餘欄用現值補;乙沒幣別 ⇒ 擋下並講人話', () => {
    const { getByLabelText, container } = render(<CostsBulkDialog closeHref='/orders' returnTo='/orders?boss=1' itemsJson={items} currencies='EUR,USD' />);
    fireEvent.change(getByLabelText('運費(整列 · 外幣)'), { target: { value: '5' } });
    expect(container.textContent).toContain('還沒選幣別');
    fireEvent.change(getByLabelText('幣值'), { target: { value: 'USD' } });
    const rows = JSON.parse((container.querySelector('input[name="cost_rows"]') as HTMLInputElement).value);
    expect(rows).toEqual([
      { orderItemId: '11111111-2222-4333-8444-555555555555', costPrice: '10', costShipping: '5', costTax: '0', currency: 'USD' },
      { orderItemId: '22222222-2222-4333-8444-555555555555', costPrice: '0', costShipping: '5', costTax: '0', currency: 'USD' },
    ]);
    expect(container.textContent).toContain('會改 4 格(2 列)');
    expect((container.querySelector('input[name="return_to"]') as HTMLInputElement).value).toBe('/orders?boss=1');
  });
});
