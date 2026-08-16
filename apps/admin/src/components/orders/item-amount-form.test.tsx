// @vitest-environment jsdom
// item-amount-form.test.tsx — 改單價表單(M-4b E10 #13 片1c-2)。
//
// 🔴 action **刻意不 mock 成別的東西**:只換掉 server action 本身(它有 'use server'、測試環境載不動),
//    其餘走真元件、真 DOM。

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, fireEvent } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/amount-actions', () => ({
  updateOrderItemAmountAction: vi.fn(),
}));

import { ItemAmountForm, ZERO_PRICE_REASON_DEFAULT } from './item-amount-form';
import {
  AMOUNT_ORDER_ID_FIELD,
  AMOUNT_ORDER_ITEM_ID_FIELD,
  AMOUNT_RETURN_TO_FIELD,
  AMOUNT_UNIT_PRICE_FIELD,
  AMOUNT_VERSION_FIELD,
  AMOUNT_ZERO_PRICE_REASON_FIELD,
} from '../../lib/orders/amount-form';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function setup(currentUnitPrice = 1200) {
  return render(
    <ItemAmountForm
      orderId={ORDER}
      expectedVersion={3}
      orderItemId={ITEM}
      currentUnitPrice={currentUnitPrice}
      returnTo={`/orders/${ORDER}`}
    />,
  );
}

const hidden = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

// 🔴 一律用 `container` 查,不用 `screen`。
//    `screen` 查的是**整個 document**,而本檔沒有逐格 cleanup ⇒ 前一格 render 的按鈕還在,
//    `getByRole` 會回「找到多個」。**那種紅指向的是測試寫法,不是行為** —— 第一版就是這樣紅的。
const submitBtn = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('button[type="submit"]');

describe('ItemAmountForm — 送出去的欄位', () => {
  it('四個 hidden 欄都在,且版本用的是【訂單層】那個值', () => {
    const { container } = setup();
    expect(hidden(container, AMOUNT_ORDER_ID_FIELD)?.value).toBe(ORDER);
    expect(hidden(container, AMOUNT_ORDER_ITEM_ID_FIELD)?.value).toBe(ITEM);
    // 🔴 3 = `AdminOrderDetail.version`。品項自 A9w3 起沒有 version 欄,拿錯對象會拿不到值。
    expect(hidden(container, AMOUNT_VERSION_FIELD)?.value).toBe('3');
    expect(hidden(container, AMOUNT_RETURN_TO_FIELD)?.value).toBe(`/orders/${ORDER}`);
  });

  it('單價欄預設帶現值,可改', () => {
    const { container } = setup(1200);
    const input = container.querySelector<HTMLInputElement>(
      `input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`,
    );
    expect(input?.value).toBe('1200');
    fireEvent.change(input!, { target: { value: '900' } });
    expect(input?.value).toBe('900');
  });
});

describe('🔴 零元:原因欄與二次確認', () => {
  it('非零元時,原因欄與確認框都不出現(不要求員工做無關的事)', () => {
    const { container } = setup(1200);
    expect(hidden(container, AMOUNT_ZERO_PRICE_REASON_FIELD)).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('改成 0 之後,原因欄與確認框出現,且送出鈕先是停用的', () => {
    const { container } = setup(1200);
    fireEvent.change(container.querySelector(`input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`)!, {
      target: { value: '0' },
    });
    expect(container.querySelector(`input[name="${AMOUNT_ZERO_PRICE_REASON_FIELD}"]`)).not.toBeNull();
    expect(submitBtn(container)?.disabled).toBe(true);
  });

  it('勾了確認之後才放行', () => {
    const { container } = setup(0);
    expect(submitBtn(container)?.disabled).toBe(true);
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(submitBtn(container)?.disabled).toBe(false);
  });

  it('🔴 二次確認【只】在零元時要求 —— 一般改價不該被擋', () => {
    // 每次都要打勾會把員工訓練成無意識點擊,那道防呆就退化成一個手勢。
    const { container } = setup(1200);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(submitBtn(container)?.disabled).toBe(false);
  });

  it('🔴 離開零元再回來,確認要重來一次(codex R1 nit)', () => {
    // 不清的話,上一輪的勾會讓第二次零元直接可送 —— 而畫面看起來一切正常。
    const { container } = setup(0);
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(submitBtn(container)?.disabled).toBe(false);

    const price = container.querySelector<HTMLInputElement>(
      `input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`,
    )!;
    fireEvent.change(price, { target: { value: '100' } });
    fireEvent.change(price, { target: { value: '0' } });

    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(submitBtn(container)?.disabled).toBe(true);
  });

  it('`000` 這種寫法也算零元(判的是字面,不是數值運算)', () => {
    const { container } = setup(1200);
    fireEvent.change(container.querySelector(`input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`)!, {
      target: { value: '000' },
    });
    expect(container.querySelector(`input[name="${AMOUNT_ZERO_PRICE_REASON_FIELD}"]`)).not.toBeNull();
  });
});

describe('🔴 F2 / F3 / F7:不能改時、client 驗證、送出中鎖', () => {
  it('🔴 F2 有阻擋原因時:不畫表單,改成就地說明(**不隱藏**)', () => {
    const { container } = render(
      <ItemAmountForm
        orderId={ORDER}
        expectedVersion={3}
        orderItemId={ITEM}
        currentUnitPrice={1200}
        returnTo={`/orders/${ORDER}`}
        blockedReason='這張單已經有收款紀錄,不開放改金額。'
      />,
    );
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector(`input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`)).toBeNull();
    // 🔴 而那句話**必須看得到** —— 隱藏會讓員工找不到而懷疑自己。
    expect(container.textContent).toContain('已經有收款紀錄');
  });

  it('🔴 F3 單價欄有 required + pattern(`inputMode` 只是鍵盤提示,不是驗證)', () => {
    const { container } = setup(1200);
    const input = container.querySelector<HTMLInputElement>(
      `input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`,
    );
    expect(input?.required).toBe(true);
    expect(input?.getAttribute('pattern')).toBe('[0-9]+');
  });

  it('🔴 F3 零元原因欄是 required(忘填是最常發生的那種)', () => {
    const { container } = setup(0);
    const reason = container.querySelector<HTMLInputElement>(
      `input[name="${AMOUNT_ZERO_PRICE_REASON_FIELD}"]`,
    );
    expect(reason?.required).toBe(true);
  });

  it('🔴 F7 送出之後按鈕鎖住(雙擊的第二發會帶 stale version)', () => {
    const { container } = setup(1200);
    expect(submitBtn(container)?.disabled).toBe(false);
    fireEvent.submit(container.querySelector('form')!);
    expect(submitBtn(container)?.disabled).toBe(true);
    expect(submitBtn(container)?.textContent).toContain('儲存中');
  });
});

describe('🔴🔴 原因欄不得預填(母 plan `:562` 的源碼契約守門)', () => {
  // 預填一個常數會讓零元防呆退化成「按 Enter 就過」——擋不住任何事,卻讓畫面看起來有在守。
  it('渲染出來的原因欄是空的', () => {
    const { container } = setup(0);
    const input = container.querySelector<HTMLInputElement>(
      `input[name="${AMOUNT_ZERO_PRICE_REASON_FIELD}"]`,
    );
    expect(input?.value).toBe('');
  });

  it('🔴 源碼契約:那顆 default 常數是空字串,而且 `defaultValue` 綁的就是它', () => {
    // ⚠️ 行為格(上面那格)擋不住「有人把 defaultValue 改成別的常數但剛好也是空字串」那種漂移,
    //    也擋不住「改成一個常數再在別處清空」;源碼格釘的是**寫法**。兩格互補不是主次。
    expect(ZERO_PRICE_REASON_DEFAULT).toBe('');
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'item-amount-form.tsx'),
      'utf8',
    );
    expect(src).toContain('defaultValue={ZERO_PRICE_REASON_DEFAULT}');
    // 正向對照:掃的是活的檔(否則檔名打錯時上面那個 toContain 也會以另一種方式紅,但指向錯地方)
    expect(src).toContain('export const ZERO_PRICE_REASON_DEFAULT');
  });

  // 🔴 **這道守門的限度,寫在這裡不是寫在信裡**(母 plan §6a L3 逐字):
  //    **它擋得住常數,擋不住動態產生的字串** —— 沒有機械方法分辨「員工打的字」與「程式組的字」。
  //    ⇒ **這條沒有觸發器。** 不要因為有這兩格就以為那一面被守住了。
});
