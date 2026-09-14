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

  it('🔴 選了客人 ⇒ 啟用, 預設 = 那位的等級;三個選項字面 會員 / 車行 / 經銷', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store'], ['c2', 'premiumStore']]} />);
    fireEvent.click(getByLabelText('c1'));
    const s = select(container);
    expect(s.disabled).toBe(false);
    expect(s.value).toBe('store');
    expect([...s.options].map((o) => o.textContent)).toEqual(['會員', '車行', '經銷']);
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
    fireEvent.change(select(container), { target: { value: 'premiumStore' } });
    expect(select(container).value).toBe('premiumStore');
    fireEvent.click(getByLabelText('c2'));
    expect(select(container).value).toBe('store');
  });

  it('🔴 送出的就是畫面上的值:FormData 帶選中的等級;沒選客人時(disabled)FormData 沒有這個鍵', () => {
    const { container, getByLabelText } = render(<Harness tiers={[['c1', 'store']]} />);
    const form = container.querySelector('form')!;
    expect(new FormData(form).has(MANUAL_ORDER_TIER_FIELD)).toBe(false);
    fireEvent.click(getByLabelText('c1'));
    fireEvent.change(select(container), { target: { value: 'premiumStore' } });
    expect(new FormData(form).get(MANUAL_ORDER_TIER_FIELD)).toBe('premiumStore');
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
