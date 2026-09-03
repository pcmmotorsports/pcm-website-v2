// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: vi.fn() }));
vi.mock('./manual-customer-picker', () => ({
  ManualCustomerPicker: () => <div data-testid='picker-stub' />,
}));

import { ManualOrderFormBody } from './manual-order-form-body';
import { MANUAL_ORDER_FORM_ID, ManualOrderLeaveGuard } from './manual-order-leave-guard';

// manual-order-leave-guard.test.tsx — Q32 甲(Sean 2026-09-03 拍)。
//
// 🔴🔴 **本檔的分母是【真的那張表單】, 不是我手搭的一張** ——
//    R1 抓到:我第一版用手搭的 form(只放一格空 text)當負對照 ⇒ 那格恆綠,
//    而真表單的運費欄 `defaultValue='0'` 讓「空表單」在生產環境**恆為髒** ⇒ 誤報率 100%。
//    📌 **⇒ 尺沒接到被量的對象, 而它印的是好消息。**
//
// 🔵 量的是 `preventDefault` 有沒有被呼叫,不是畫面上那句話 ——
//    現代瀏覽器不顯示自訂字串(它顯示自己的通用句)⇒ 斷言字面會斷言到客人看不到的東西。

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_KEY = '33333333-3333-4333-8333-333333333333';
const STAFF = [{ id: 'alice', label: '小愛' }];

/** 🔴 render **真的**表單 + guard。這一格就是 R1 finding 2 的修法。 */
function renderReal() {
  return render(
    // 🔴🔴 **這裡【不掛】guard** —— R2 finding 1:我上一版在這裡自己又掛了一顆,
    //    ⇒ 把 `form-body` 那一行刪掉, 下面四格【照樣全綠】⇒ 接線測試變成假的。
    //    ✅ 現在它靠的是 `ManualOrderFormBody` 自己掛的那一顆 ⇒ 拆掉它, 那四格會紅。
    <ManualOrderFormBody
      manualRequestId={REQUEST_ID}
      customerRequestId={CUSTOMER_KEY}
      activeStaff={STAFF}
      staffLoadFailed={false}
    />,
  );
}

/** 發一發 beforeunload,回報 preventDefault 有沒有被呼叫。 */
function blocked(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  const spy = vi.spyOn(e, 'preventDefault');
  window.dispatchEvent(e);
  return spy.mock.calls.length > 0;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ManualOrderLeaveGuard(Q32 甲:離開前提醒)', () => {
  // 🔵🔵 **這一格是本檔最重要的** —— R1 抓到的誤報就住在這裡。
  // 🧬 突變:把 `isDirty` 換回「非空就算」(`el.value.trim() !== ''`)⇒ 本格必須紅
  //    (真表單的運費欄 defaultValue='0' ⇒ 恆為髒)。
  it('🔵 什麼都沒動就離開 ⇒ 不得攔(而真表單的運費欄預設就是 "0")', () => {
    renderReal();
    expect(blocked()).toBe(false);
  });

  // 🧬 突變:拿掉 addEventListener ⇒ 本格必須紅。
  it('🔴 改了收件人就離開 ⇒ 攔下來', () => {
    renderReal();
    const el = screen.getByPlaceholderText('收件人') as HTMLInputElement;
    el.value = '王小明';
    expect(blocked()).toBe(true);
  });

  // 🔴 R1 finding 4:四個下拉(訂單來源/付款方式/取貨方式/發票類型)原本被整族跳過 ⇒ 零提醒。
  // 🧬 突變:把 HTMLSelectElement 那一段改回 `continue` ⇒ 本格必須紅。
  it('🔴 只改了下拉(匯款 ⇒ 現金)就離開 ⇒ 也要攔', () => {
    renderReal();
    const sel = document.querySelector('select[name="payment_channel"]') as HTMLSelectElement;
    expect(sel.options.length).toBeGreaterThan(1);
    const second = sel.options[1];
    if (!second) throw new Error('付款方式下拉少於兩個選項 —— 這一格的前提不成立');
    second.selected = true;
    expect(blocked()).toBe(true);
  });

  // 🔴 R1 finding 1 的另一半:運費【真的被改過】要攔得到,否則上一格會被讀成「運費不算」。
  it('🔴 把運費從 0 改成 150 ⇒ 攔下來(而不是因為它非空)', () => {
    renderReal();
    const fee = document.querySelector('input[name="shipping_fee"]') as HTMLInputElement;
    expect(fee.defaultValue).toBe('0');
    fee.value = '150';
    expect(blocked()).toBe(true);
  });

  // 🔴 R2 抓到的三種【出生即髒】(今天表單裡沒有 ⇒ 這一格守的是【未來】)。
  // 🧬 突變:把 bornIndex 換回「都沒 defaultSelected 就回 0」⇒ 本格必須紅。
  it.each([
    ['第一項 disabled(請選擇 placeholder)', (sel: HTMLSelectElement) => {
      const a = document.createElement('option'); a.disabled = true; a.value = '';
      const b = document.createElement('option'); b.value = 'x';
      sel.append(a, b);
    }],
    ['multiple', (sel: HTMLSelectElement) => {
      sel.multiple = true;
      const a = document.createElement('option'); a.value = 'x';
      sel.append(a);
    }],
    ['size > 1', (sel: HTMLSelectElement) => {
      sel.size = 3;
      const a = document.createElement('option'); a.value = 'x';
      sel.append(a);
    }],
  ])('🔵 %s 的下拉, 出生時不得被判髒', (_label, fill) => {
    const form = document.createElement('form');
    form.id = MANUAL_ORDER_FORM_ID;
    const sel = document.createElement('select');
    sel.name = 'future_field';
    fill(sel);
    form.appendChild(sel);
    document.body.appendChild(form);
    render(<ManualOrderLeaveGuard formId={MANUAL_ORDER_FORM_ID} />);
    expect(blocked()).toBe(false);
  });

  // 🔴 R1 finding 6:沒有東西守「它有被掛上去」⇒ form-body 那兩行被刪掉, 上面全部照樣綠。
  it('🔴 表單本體真的掛了 guard 與那個 id(刪掉那兩行 ⇒ 本格紅)', () => {
    const src = readFileSync(join(HERE, 'manual-order-form-body.tsx'), 'utf8');
    expect(src).toMatch(/<ManualOrderLeaveGuard\s+formId=\{MANUAL_ORDER_FORM_ID\}/);
    expect(src).toMatch(/<form\s+id=\{MANUAL_ORDER_FORM_ID\}/);
  });

  // 🔴 R1 finding 5:「不存值」那個承諾, 最可能破的不是 useState —— 是把值送出去。
  it('🔴 本檔零 state / 零儲存 / 零外送(不存值那個承諾)', () => {
    for (const banned of [
      /useState/,
      /localStorage|sessionStorage|indexedDB/,
      /FormData/,
      /sendBeacon/,
      /fetch\s*\(/,
      /document\.cookie/,
      // 🔴 R2 finding 2:上面六條**一條都沒禁到【回寫】** —— 而本檔手上握著
      //    `form.elements` 裡的每一顆節點 ⇒ 有人在這裡寫一行 `el.value = …`,
      //    那道不變式就破了, 而六條全綠。這一條才是守著它的那把尺。
      /\.value\s*=[^=]/,
    ]) {
      expect(CODE).not.toMatch(banned);
    }
  });

  it('🟢 正對照:剝註解之後【真的碼還在】(否則上一格是假綠)', () => {
    expect(CODE).toMatch(/addEventListener\('beforeunload'/);
    expect(CODE).toMatch(/function isDirty/);
    // 🔴 而一把「多剝」的尺會把整段碼吃掉、只留這兩行 ⇒ 再釘一個長度下界
    //    (形狀取自 manual-order-lines.test.tsx 的正對照那一格)。
    expect(CODE.length).toBeGreaterThan(600);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'manual-order-leave-guard.tsx'), 'utf8');
/**
 * 只看程式碼、不看註解 —— 本檔的註解裡就寫著 `useState` / `localStorage`(在解釋為什麼不能用)。
 * 🔵 而這裡**用 filter 整行剝**(不是 `replace(/\/\/.*$/)`)—— 後者會砍掉字串字面裡的 `//`,
 *    例如將來有人在碼裡寫一個 URL。形狀取自 `manual-order-lines.test.tsx` 的 CODE 區塊。
 */
const CODE = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');
