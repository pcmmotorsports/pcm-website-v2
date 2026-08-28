// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
// action 只是 `<form action={...}>` 的值 ⇒ 換成一個假的,避免把 'use server' 那條鏈拉進來。
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: vi.fn() }));
// 🔴 picker 換成探針:本檔要驗的是**表單本體遞了什麼下去、以及它的形狀**,
//    picker 自己的行為(就地搜尋 / 就地建)在 `manual-customer-picker.test.tsx`。
//    **兩件事不得互相冒充。**
vi.mock('./manual-customer-picker', () => ({
  ManualCustomerPicker: (props: { customerRequestId: string }) => (
    <div data-testid='picker-stub' data-customer-key={props.customerRequestId} />
  ),
}));

import { ManualOrderFormBody } from './manual-order-form-body';

/**
 * 🔴 **分母守門** —— 本檔有一族斷言是「畫面上【不得】出現 X」,
 * 而 `queryBy*` / `querySelector` 零命中都回 `null` ⇒ **整張表單沒渲染時它們全部恆真**
 * (2026-08-28 實測:元件插一發空渲染 ⇒ 16 格裡 4 格照樣綠,那 4 格全是這一族)。
 *
 * ⚠️ **用【結構數量】不用文案字面**:`<form>` 是本元件的固定骨架(停用態也照樣渲染,
 *    見「讀不到也不該讓他送出」那格拿得到「建立訂單」鈕)⇒ 文案改一個字不該讓這幾格紅。
 * ⚠️ 這裡刻意用 `toBeGreaterThan(0)` 而不是 `toBe(1)` —— 「恰好一張 form」是**另一格**在守的
 *    不變式(「整張畫面只有【一張】form」),分母守門不該偷偷替它再守一次:
 *    那樣兩格會一起紅,而下一個人分不出壞的是哪一件。
 */
const expectFormRendered = (c: HTMLElement) =>
  expect(
    c.querySelectorAll('form').length,
    '整張表單一個 form 都沒有 ⇒ 根本沒渲染 ⇒ 下面的負向斷言恆真',
  ).toBeGreaterThan(0);

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_KEY = '33333333-3333-4333-8333-333333333333';
const STAFF = [{ id: 'alice', label: '小愛' }];

function renderForm(over: Partial<Parameters<typeof ManualOrderFormBody>[0]> = {}) {
  return render(
    <ManualOrderFormBody
      manualRequestId={REQUEST_ID}
      customerRequestId={CUSTOMER_KEY}
      activeStaff={STAFF}
      staffLoadFailed={false}
      {...over}
    />,
  );
}

afterEach(cleanup);

describe('🔴🔴 沒有啟用中的員工 ⇒ 表單停用 + 一句話指路(Sean 2026-08-24 裁甲)', () => {
  it('員工空 ⇒ 送出鈕不能按', () => {
    renderForm({ activeStaff: [] });
    // 🔴 停用是掛在包住它的 `<fieldset disabled>` 上,不是按鈕自己的屬性
    //    ⇒ 量按鈕自己的 `disabled` 屬性會【永遠是 false】= 一格恆綠。要量那個 fieldset。
    const btn = screen.getByRole('button', { name: '建立訂單' });
    expect(btn.closest('fieldset')?.hasAttribute('disabled')).toBe(true);
  });

  it('員工空 ⇒ 那句話在畫面上,而且指向一個真的能做那件事的地方', () => {
    renderForm({ activeStaff: [] });
    const notice = screen.getByTestId('manual-order-no-staff');
    expect(notice.textContent).toContain('還沒有建立員工');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/settings/staff');
  });

  it('🔴🔴 負對照:有一位啟用中的員工 ⇒ 送出鈕【可以按】, 而那句話【不在畫面上】', () => {
    renderForm({ activeStaff: STAFF });
    const btn = screen.getByRole('button', { name: '建立訂單' });
    expect(btn.closest('fieldset')?.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('manual-order-no-staff')).toBeNull();
  });
});

describe('🔴 名單讀不到 ≠ 沒有員工(codex R1 nit)', () => {
  it('讀不到 ⇒ **不出**「還沒有建立員工」那一句(兩句同時在畫面上會互相矛盾)', () => {
    const { container } = renderForm({ activeStaff: [], staffLoadFailed: true });
    expectFormRendered(container);
    expect(screen.queryByTestId('manual-order-no-staff')).toBeNull();
  });

  it('🔴 而它仍然停用(讀不到也不該讓他送出)', () => {
    renderForm({ activeStaff: [], staffLoadFailed: true });
    const btn = screen.getByRole('button', { name: '建立訂單' });
    expect(btn.closest('fieldset')?.hasAttribute('disabled')).toBe(true);
  });

  it('🔴 負對照:真的沒有員工(不是讀不到)⇒ 那一句要在', () => {
    renderForm({ activeStaff: [], staffLoadFailed: false });
    expect(screen.getByTestId('manual-order-no-staff')).toBeTruthy();
  });
});

describe('🔴 冪等鍵:表單只是帶著走,不自己鑄', () => {
  it('隱藏欄位的值 = 傳進來的那顆', () => {
    const { container } = renderForm();
    expect(
      container.querySelector('input[name="manual_request_id"]')?.getAttribute('value'),
    ).toBe(REQUEST_ID);
  });

  it('🔴🔴 建客人那顆是【另一顆】,不得共用建單那顆', () => {
    const { container } = renderForm();
    const key = container.querySelector('[data-testid="picker-stub"]')?.getAttribute('data-customer-key');
    expect(key).toBe(CUSTOMER_KEY);
    // 🔴 這一發才是重點:兩顆不得相等。共用一顆正是 R3 那條 must-fix 的根
    //    (「為什麼建帳號的冪等鍵要跟建單的冪等鍵是同一顆」)。
    expect(key).not.toBe(REQUEST_ID);
  });
});

describe('🔴🔴 兩段式【已經結束】—— 建單表單一開始就在(Sean 2026-08-28「一個頁面搞定」)', () => {
  it('沒有任何前置條件:一 render 就有建單表單與品項列', () => {
    const { container } = renderForm();
    expect(container.querySelector('form')).toBeTruthy();
    expect(screen.getByTestId('manual-order-lines')).toBeTruthy();
  });

  it('🔴 那句「先選一位客人,才會出現建單表單」不得再出現', () => {
    const { container } = renderForm();
    expectFormRendered(container);
    expect(screen.queryByTestId('manual-order-pick-first')).toBeNull();
    expect(screen.queryByText(/先選一位客人/)).toBeNull();
  });

  it('🔴 而那條死路的文案也不得再出現(它指到一個沒有那顆按鈕的頁面)', () => {
    const { container } = renderForm();
    expectFormRendered(container);
    expect(screen.queryByText(/請先到【客人】頁建立這位客人/)).toBeNull();
  });

  it('🔴🔴 整張畫面只有【一張】form —— 客人那塊不再是第二張表單', () => {
    const { container } = renderForm();
    // 🔴 兩張 form 的世界正是舊形狀(搜尋一張、建單一張)⇒ 這一格在新舊兩個世界印不同的數字。
    expect(container.querySelectorAll('form').length).toBe(1);
  });

  it('🔴 而客人那一塊在那張 form 【裡面】(不然那顆 radio 送不出去)', () => {
    const { container } = renderForm();
    expect(container.querySelector('form [data-testid="picker-stub"]')).toBeTruthy();
  });
});

describe('🔴 inPanel:同一份表單長在面板裡時, 送出之後要留在面板裡', () => {
  it('面板版 ⇒ 帶 in_panel 旗標', () => {
    const { container } = renderForm({ inPanel: true });
    expect(container.querySelector('input[name="in_panel"]')?.getAttribute('value')).toBe('1');
  });

  it('🔴 負對照:整頁版(預設)一格 in_panel 都不得出現', () => {
    const { container } = renderForm();
    expectFormRendered(container);
    expect(container.querySelector('input[name="in_panel"]')).toBeNull();
  });
});

describe('🔴 表單送不出 actor —— 那一格在型別與 DOM 上都不存在', () => {
  it('🔴 畫面上【完全沒有】經手人這個欄位(codex R1 must-fix:會說謊的欄位比沒有糟)', () => {
    const { container } = renderForm();
    const names = Array.from(container.querySelectorAll('[name]')).map((el) =>
      el.getAttribute('name'),
    );
    // 🔴 逐字列出現在該有的欄名 ⇒ 多一個沒被歸類的欄就會紅。
    //    (客人那一格住在 picker 裡,本檔把它換成探針 ⇒ 不在這張清單上。)
    expect(names.sort()).toEqual(
      [
        'manual_request_id',
        'order_source',
        'payment_channel',
        'shipping_method',
        'shipping_fee',
        'ship_to_name',
        'ship_to_phone',
        'ship_to_line',
        'invoice_type',
        'invoice_carrier',
        'invoice_title',
        'invoice_tax_id',
        'invoice_donate_code',
        'line_sku_0',
        'line_title_0',
        'line_qty_0',
        'line_unit_price_0',
        'line_variant_id_0',
        'line_spec_0',
      ].sort(),
    );
    expect(names.some((n) => n?.includes('actor') || n?.includes('staff'))).toBe(false);
  });
});
