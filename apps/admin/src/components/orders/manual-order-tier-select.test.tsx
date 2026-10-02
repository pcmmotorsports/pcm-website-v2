// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualOrderTierSelect } from './manual-order-tier-select';
import { MANUAL_ORDER_CUSTOMER_FIELD, MANUAL_ORDER_TIER_FIELD } from '../../lib/orders/manual-order-form';

// T2(2026-09-14):那格「會員等級」的三件事 —— 沒選客人 disabled / 預設 = 選中那位的等級 / 換客人跟著換。
afterEach(cleanup);

function Harness({ tiers }: { tiers: Array<[string, string]> }) {
  return (
    <form>
      {tiers.map(([id, tier]) => (
        <input key={id} type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD} value={id} data-customer-tier={tier} aria-label={id} />
      ))}
      <ManualOrderTierSelect />
    </form>
  );
}
const select = (c: HTMLElement) => c.querySelector<HTMLSelectElement>(`select[name="${MANUAL_ORDER_TIER_FIELD}"]`)!;

describe('ManualOrderTierSelect', () => {
  it('🔴 沒選客人 ⇒ disabled(不進 FormData, server 端「沒有選客人」那道先擋)', () => {
    const { container } = render(<Harness tiers={[['c1', 'store']]} />);
    expect(select(container).disabled).toBe(true);
  });

  // 2026-10-02 Sean:建單這一格先拿掉「經銷」, 只留一般和車行(之後他再決定要不要加回)。舊訂單與列表篩選不動。
  it('🔴 選了客人 ⇒ 啟用, 預設 = 那位的等級;選項只有 會員 / 車行(經銷先拿掉)', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store'], ['c2', 'premiumStore']]} />);
    fireEvent.click(getByLabelText('c1'));
    const s = select(container);
    expect(s.disabled).toBe(false);
    expect(s.value).toBe('store');
    expect([...s.options].map((o) => o.textContent)).toEqual(['會員', '車行']);
  });

  it('🔴 那位客人帳號本來就是經銷 ⇒ 經銷那一項還在、預設選它(不得因為選項拿掉就靜靜改成一般)', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c2', 'premiumStore']]} />);
    fireEvent.click(getByLabelText('c2'));
    expect(select(container).value).toBe('premiumStore');
    expect([...select(container).options].map((o) => o.textContent)).toEqual(['會員', '車行', '經銷']);
  });

  it('🔴 換客人 ⇒ 跟著換成那位的;員工改過的選擇在【同一位】底下不被蓋掉', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store'], ['c2', 'premiumStore']]} />);
    fireEvent.click(getByLabelText('c1'));
    fireEvent.change(select(container), { target: { value: 'general' } });
    expect(select(container).value).toBe('general');
    fireEvent.click(getByLabelText('c2'));
    expect(select(container).value).toBe('premiumStore');
  });

  it('🔴 換到【同級】的另一位客人也要重設(codex R1 MF1:只記等級的話, 替甲改的選擇會沿用到乙)', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store'], ['c2', 'store']]} />);
    fireEvent.click(getByLabelText('c1'));
    fireEvent.change(select(container), { target: { value: 'general' } });
    expect(select(container).value).toBe('general');
    fireEvent.click(getByLabelText('c2'));
    expect(select(container).value).toBe('store');
  });

  it('🔴 送出的就是畫面上的值:FormData 帶選中的等級;沒選客人時(disabled)FormData 沒有這個鍵', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store']]} />);
    const form = container.querySelector('form')!;
    expect(new FormData(form).has(MANUAL_ORDER_TIER_FIELD)).toBe(false);
    fireEvent.click(getByLabelText('c1'));
    fireEvent.change(select(container), { target: { value: 'general' } });
    expect(new FormData(form).get(MANUAL_ORDER_TIER_FIELD)).toBe('general');
  });

  it('掛載時已經有一位被勾著(剛建好的客人 defaultChecked, 不發 change)⇒ 一掛上就讀到', () => {
    const { container } = render(
      <form>
        <input type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD} value='c9' data-customer-tier='premiumStore' defaultChecked />
        <ManualOrderTierSelect />
      </form>,
    );
    expect(select(container).disabled).toBe(false);
    expect(select(container).value).toBe('premiumStore');
  });

  it('不認得的 tier(`vip`)/ 沒帶 data-customer-tier(舊候選)⇒ 倒向 general, 而不是鎖住', () => {
    const { container, getByLabelText } = render(
      <form>
        <input type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD} value='c1' data-customer-tier='vip' aria-label='c1' />
        <input type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD} value='c2' aria-label='c2' />
        <ManualOrderTierSelect />
      </form>,
    );
    fireEvent.click(getByLabelText('c1'));
    expect(select(container).disabled).toBe(false);
    expect(select(container).value).toBe('general');
    fireEvent.click(getByLabelText('c2'));
    expect(select(container).value).toBe('general');
  });
});

// 🆕 Sean 2026-10-01 Q24 甲:新客人按「確認」時才建 ⇒ 建之前就要能選等級, 建好那一刻不能被重設
describe('新客人(送出時才建)', () => {
  function NewCustomerHarness({ created }: { created: boolean }) {
    return (
      <form>
        {created ? (
          // key 不同:同一個 <input> 節點從 hidden 改成 radio 時 React 會重用它, defaultChecked 就不會生效(picker 裡兩者本來就是不同節點)
          <input key='radio' type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD} value='c-new' data-customer-tier='general' data-just-created='1' defaultChecked aria-label='新' />
        ) : (
          <input key='marker' type='hidden' data-new-customer-pending='1' />
        )}
        <ManualOrderTierSelect />
      </form>
    );
  }

  it('還沒建(只有「新客人」記號)⇒ 可以選, 預設一般', () => {
    const { container } = render(<NewCustomerHarness created={false} />);
    expect(select(container).disabled).toBe(false);
    expect(select(container).value).toBe('general');
  });

  it('🔴 建之前選了車行 ⇒ 建好(radio 換上來)那一刻【仍是車行】, 不被重設回一般', async () => {
    const { container, rerender } = render(<NewCustomerHarness created={false} />);
    fireEvent.change(select(container), { target: { value: 'store' } });
    rerender(<NewCustomerHarness created />);
    await new Promise((r) => setTimeout(r, 0));
    expect(select(container).value).toBe('store');
  });

  it('🔴 中間有一瞬間看不到客人(這格被停用、重掛)⇒ 建好時仍是員工選的車行', async () => {
    const Gap = ({ step }: { step: 0 | 1 | 2 }) => (
      <form>
        {step === 0 && <input key='marker' type='hidden' data-new-customer-pending='1' />}
        {step === 2 && (
          <input key='radio' type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD} value='c-new' data-customer-tier='general' data-just-created='1' defaultChecked aria-label='新' />
        )}
        <ManualOrderTierSelect />
      </form>
    );
    const { container, rerender } = render(<Gap step={0} />);
    fireEvent.change(select(container), { target: { value: 'store' } });
    rerender(<Gap step={1} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(select(container).disabled).toBe(true);
    rerender(<Gap step={2} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(select(container).disabled).toBe(false);
    expect(select(container).value).toBe('store');
  });
});


// 2026-10-02 Sean 拍 Q50 甲:新客人時那格下方加小字, 讓員工知道帳號也會跟著設。
describe('新客人的小字說明', () => {
  it('🔴 新客人(還沒建 / 剛建好)⇒ 那格下方印「新客人的帳號也會設成這個等級」', () => {
    const { container } = render(
      <form>
        <input type='hidden' data-new-customer-pending='1' />
        <ManualOrderTierSelect />
      </form>,
    );
    expect(container.querySelector('[data-testid="manual-order-tier-new-note"]')?.textContent).toBe('新客人的帳號也會設成這個等級');
  });
  it('既有客人 ⇒ 不印(改的只是這張單)', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store']]} />);
    fireEvent.click(getByLabelText('c1'));
    expect(container.querySelector('[data-testid="manual-order-tier-new-note"]')).toBeNull();
  });
});
