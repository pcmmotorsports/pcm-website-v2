// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
// action 只是 `<form action={...}>` 的值 ⇒ 換成假的,避免把 'use server' 那條鏈拉進來(同 form-body 測試)。
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: vi.fn() }));
// 🔴 picker 換成「**已經選好一位客人**」的探針 —— 那顆 radio 就是送出去的值,
//    沒有它 `ManualOrderSubmit` 會把「確認」鈕停用,這幾格就按不下去。
vi.mock('./manual-customer-picker', () => ({
  ManualCustomerPicker: () => (
    <input
      type='radio'
      name='customer_user_id'
      value='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      defaultChecked
      readOnly
      aria-label='探針客人'
    />
  ),
}));

import { ManualOrderFormBody } from './manual-order-form-body';

/**
 * 收件那三格空白時,員工看得到**我們自己那句中文**、而且游標會跳到那一格。
 *
 * 🔴🔴 **這一支為什麼要真的按那顆按鈕(而且欄位不可以是 `hidden`)**
 *
 *   `manual-order-submit.test.tsx` 那幾格是 `new Event('submit', …)` + `dispatchEvent` —— 那條路
 *   **真實使用者永遠走不到**,而且它**繞過瀏覽器的必填檢查**。
 *   ⇒ 2026-09-16 的病就躲在那裡:收件三格帶原生 `required`,瀏覽器在 `submit` 事件**之前**
 *     就中止送出(jsdom 26.1.0 `HTMLFormElement-impl.js:107-130` 逐字
 *     `if (!hasAttributeNS(null,'novalidate') && !reportValidity()) return;`,真瀏覽器同規格)
 *     ⇒ 我們那段「跑一次解析器、把中文畫出來」**永遠跑不到**,而那幾格測試照樣全綠。
 *   📌 **一份會過的測試,配一條真人走不到的路** —— 洞不是沒被測到,是被測試蓋住了。
 *
 *   ⚠️ **下一個人:不要把這裡改回自己造事件**,那會讓這一支跟著失明。
 *   ⚠️ 也**不要把欄位換成 `type='hidden'`** —— 隱藏欄位不受必填檢查,那同樣會繞過這條路。
 *
 * 🔵 拿掉 `manual-order-form-body.tsx` 那個 `noValidate`,這三格會當場紅(連那句話都不會出現)。
 */
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_KEY = '33333333-3333-4333-8333-333333333333';

function renderForm() {
  return render(
    <ManualOrderFormBody
      manualRequestId={REQUEST_ID}
      customerRequestId={CUSTOMER_KEY}
      activeStaff={[{ id: 'alice', label: '小愛' }]}
      staffLoadFailed={false}
    />,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const fill = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
/** 真的按下去 —— 不是自己造 submit 事件(見檔頭)。 */
const pressConfirm = () => fireEvent.click(screen.getByRole('button', { name: '確認' }));
const problem = () => screen.queryByTestId('manual-order-submit-form-problem')?.textContent ?? '';

afterEach(cleanup);

describe('收件資料沒填 ⇒ 說出是哪一格, 而且游標跳過去', () => {
  it('🔴 三格都空 ⇒ 先講姓名, 游標在姓名那一格', () => {
    renderForm();
    pressConfirm();
    expect(problem()).toContain('收件人姓名沒有填');
    expect(document.activeElement).toBe(field('收件人'));
  });

  it('🔴 只有電話沒填 ⇒ 講電話, 游標在電話那一格', () => {
    renderForm();
    fill('收件人', '王小明');
    fill('收件地址', '台北市中正區某路 1 號');
    pressConfirm();
    expect(problem()).toContain('收件人電話沒有填');
    expect(document.activeElement).toBe(field('收件人電話'));
  });

  it('🔴 只有地址沒填 ⇒ 講地址, 游標在地址那一格(B 窗 2026-09-16 實測的那一發)', () => {
    renderForm();
    fill('收件人', '王小明');
    fill('收件人電話', '0912345678');
    pressConfirm();
    expect(problem()).toContain('收件地址沒有填');
    expect(document.activeElement).toBe(field('收件地址'));
  });

  it('🔵 對照組:三格補齊 ⇒ 不再是收件那三句(不得變成永遠攔在同一句)', () => {
    renderForm();
    fill('收件人', '王小明');
    fill('收件人電話', '0912345678');
    fill('收件地址', '台北市中正區某路 1 號');
    pressConfirm();
    // 🔵 這裡**刻意不斷言「完全不被攔」**:這張單還沒有品項,下一句會換成品項那條。
    //    要走到「真的送出去」會撞 jsdom 的 `notImplemented`(`requestSubmit` 最後一行),
    //    那條路的正對照在 `manual-order-submit.test.tsx`,本檔不重複一份。
    expect(problem()).not.toContain('收件人姓名沒有填');
    expect(problem()).not.toContain('收件人電話沒有填');
    expect(problem()).not.toContain('收件地址沒有填');
  });
});
