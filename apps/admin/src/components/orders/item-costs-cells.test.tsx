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
              currencies='EUR,USD,TWD,JPY'
              tdClass='boss-cell'
              quantity='2'
              lineTotal='5000'
              totalTwd='458'
              profitTwd='4,542'
              rates='EUR:35.2,USD:31.5,TWD:1'
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
    // 🔴 四格都要浮在整列 stretched link 上面(`relative z-10`),不然滑鼠點不到 input(Sean 09-14 線上「打字沒反應」)。
    //    (總計 / 利潤兩格是純顯示,不浮上來 ⇒ 點它們照舊打開那張單;這裡只量有輸入框的四格。)
    const inputTds = [...price.closest('tr')!.querySelectorAll('td')].filter((td) => td.querySelector('input,select') !== null);
    expect(inputTds).toHaveLength(4);
    for (const td of inputTds) expect(td.className).toContain('relative z-10');
    fireEvent.click(getByText('取消變更'));
    expect(queryByTestId('costs-unsaved-bar')).toBeNull();
    expect(price.value).toBe('10');
  });
  it('確認全部 ⇒ 確認框每個商品一列(單號 / 商品 / 改後原價+幣值+匯率 / 總計 / 利潤),隱形表單帶 JSON 列 + return_to', () => {
    const { getByLabelText, getByText, container } = render(<Harness />);
    fireEvent.change(getByLabelText('油杯蓋 原價'), { target: { value: '12' } });
    fireEvent.change(getByLabelText('油杯蓋 幣值'), { target: { value: 'USD' } });
    const dlg = container.querySelector('dialog.costs-confirm')!;
    (dlg as HTMLDialogElement).showModal = vi.fn();
    fireEvent.click(getByText('確認全部'));
    expect((dlg as HTMLDialogElement).showModal).toHaveBeenCalled();
    // 改了兩格(原價、幣值)仍然只有一列
    expect(dlg.querySelectorAll('tbody tr')).toHaveLength(1);
    const row = dlg.querySelector('tbody tr')!.textContent!;
    expect(row).toContain('ABC123');
    expect(row).toContain('油杯蓋');
    expect(row).toContain('12 USD');
    expect(row).toContain('×31.5');
    // (12 + 0 + 1.5×2) × 31.5 = 472.5 ⇒ 473;利潤 5000 − 473 = 4,527
    expect(row).toContain('473');
    expect(row).toContain('4,527');
    expect(dlg.querySelectorAll('p')).toHaveLength(1);
    const rows = JSON.parse((dlg.querySelector('input[name="cost_rows"]') as HTMLInputElement).value);
    expect(rows).toEqual([{ orderItemId: '11111111-2222-4333-8444-555555555555', costPrice: '12', costShipping: '0', costTax: '1.5', currency: 'USD' }]);
    expect((dlg.querySelector('input[name="return_to"]') as HTMLInputElement).value).toBe('/orders?boss=1');
    expect(getByText('確認儲存')).toBeTruthy();
    expect(getByText('回去修改')).toBeTruthy();
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
  it('沒改 ⇒ 總計 / 利潤印存檔的值;一打字 ⇒ 同一列馬上算出來(淡色 = 尚未儲存)', () => {
    const { getByLabelText, container } = render(<Harness />);
    const total = () => container.querySelector('td.boss-total')!;
    const profit = () => container.querySelector('td.boss-profit')!;
    expect(total().textContent).toBe('458');
    expect(profit().textContent).toBe('4,542');
    expect(total().querySelector('.costs-pending')).toBeNull();
    fireEvent.change(getByLabelText('油杯蓋 原價'), { target: { value: '12' } });
    // (12 + 0 + 1.5×2) × 35.2 = 528;利潤 5000 − 528 = 4,472
    expect(total().textContent).toBe('528');
    expect(profit().textContent).toBe('4,472');
    expect(total().querySelector('.costs-pending')).not.toBeNull();
    expect(profit().querySelector('.costs-pending')).not.toBeNull();
  });
  it('幣別改了 ⇒ 匯率那格印新幣別現在的匯率(存檔時抄的就是它),不再是「匯…」', () => {
    const { getByLabelText, container } = render(<Harness />);
    expect(container.querySelector('td.boss-fx')!.textContent).toContain('×35.2');
    fireEvent.change(getByLabelText('油杯蓋 幣值'), { target: { value: 'USD' } });
    expect(container.querySelector('td.boss-fx')!.textContent).toContain('×31.5');
    expect(container.textContent).not.toContain('匯率存檔時帶');
    // (10 + 0 + 1.5×2) × 31.5 = 409.5 ⇒ 410
    expect(container.querySelector('td.boss-total')!.textContent).toBe('410');
  });
  it('幣別還沒設匯率 ⇒ 匯率格說「未設匯率」、總計 / 利潤印 —', () => {
    const { getByLabelText, container } = render(<Harness />);
    fireEvent.change(getByLabelText('油杯蓋 幣值'), { target: { value: 'JPY' } });
    expect(container.querySelector('td.boss-fx')!.textContent).toContain('未設匯率');
    expect(container.querySelector('td.boss-total')!.textContent).toBe('—');
    expect(container.querySelector('td.boss-profit')!.textContent).toBe('—');
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
