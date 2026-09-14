// @vitest-environment jsdom
//
// order-edit-form:**開票狀態三態中文只能有一份來源** 的守門(2026-08-21 W9e 建)。
//
// 🔴 **這一檔守得到什麼、守不到什麼(先講,因為它決定你能拿它說什麼)**:
//   ✅ 守得到:①渲染出來的三個 option 與 `INVOICE_STATUS_LABEL` **逐項相同**(值、字面、順序)
//             ②本元件原始碼裡**不再出現**那三個中文字面
//   ❌ 守不到:有人用**別的方式**把中文帶進來 —— 自建一份 const、字串拼接、
//             或 import 另一個 label map。②只認那三個字面本身。
//   ⇒ 它擋的是**最可能發生的那一種**(直接把 `<option>未開立</option>` 寫回去),
//     不是所有可能。**不要把它讀成「這裡不可能再硬寫」。**
//
// 為什麼要兩種斷言、少一種都不夠:
//   · 只有①(渲染)⇒ 有人硬寫**一模一樣的三個字**,渲染結果完全相同 ⇒ **①永遠是綠的**。
//   · 只有②(掃原始碼)⇒ 有人接了共用來源但接錯欄位(例如接成付款狀態那份)⇒ **②看不到**。
//   ⇒ 兩個各自都有一個對方看得見而自己看不見的世界。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminOrderDetail } from '@pcm/domain';
import { INVOICE_STATUS_LABEL } from '../../lib/orders/order-list-view';
import { INVOICE_STATUS_FIELD,
  INVOICE_ISSUED_AT_FIELD } from '../../lib/orders/workflow-form';

vi.mock('../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: async () => {},
}));

const { OrderEditForm } = await import('./order-edit-form');

const detail = {
  id: 'ord-1',
  version: 1,
  shippingMethod: 'home',
  invoiceStatus: 'issued',
  invoiceNumber: null,
  invoiceAmount: null,
  // 🔴 2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 2 步:本 fixture 用 `as unknown as` 繞過型別
  //    ⇒ 少一欄不會被 typecheck 抓到, 而**少了它整組會走進「此單不開發票」那一枝**
  //    ⇒ 上面那幾格測的是【正常那一格】, 所以這裡必須明寫 `true`。
  //    📌 **而那正是 `as unknown as` 的代價** —— 它把「這個型別要什麼」這件事變成人要記得的。
  invoiceRequested: true,
} as unknown as AdminOrderDetail;

/** 決定【不開發票】的那張單。 */
const notRequested = { ...detail, invoiceRequested: false } as unknown as AdminOrderDetail;

// 第 5 代(20260915070000):收件人 / 電話 / 地址三格預設帶現值、三格 required、有「已建的箱不會跟著改」那一句。
describe('第 5 代:收件人 / 電話 / 地址', () => {
  it('三格在、預設帶現值、required;箱不跟著改那一句在', () => {
    const withAddr = { ...detail, shippingAddress: { name: '王小明', phone: '0987654321', line: '高雄市左營區博愛二路 1 號' } } as unknown as AdminOrderDetail;
    const { container } = render(<OrderEditForm detail={withAddr} returnTo='/orders' />);
    const name = container.querySelector('input[name="ship_to_name"]') as HTMLInputElement | null;
    const phone = container.querySelector('input[name="ship_to_phone"]') as HTMLInputElement | null;
    const line = container.querySelector('input[name="ship_to_line"]') as HTMLInputElement | null;
    expect(name?.value).toBe('王小明');
    expect(phone?.value).toBe('0987654321');
    expect(line?.value).toBe('高雄市左營區博愛二路 1 號');
    expect(name?.required && phone?.required && line?.required).toBe(true);
    // 🔴 codex must-fix ②:沒勾「改收件資料」⇒ 三格 disabled(不進 FormData ⇒ 只改發票不會被舊地址擋);那一句也不印。
    expect(name?.disabled && phone?.disabled && line?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="ship-to-boxes-note"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="ship-to-edit-toggle"]')!);
    expect(name?.disabled || phone?.disabled || line?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="ship-to-boxes-note"]')?.textContent).toContain('已建的箱不會跟著改');
  });
});

afterEach(cleanup);

describe('開票狀態:三態中文只有一份來源', () => {
  it('🔴 渲染出來的三個 option = INVOICE_STATUS_LABEL 逐項相同(值/字面/順序)', () => {
    const { container } = render(<OrderEditForm detail={detail} returnTo='/orders/ord-1' />);
    const select = container.querySelector(`select[name="${INVOICE_STATUS_FIELD}"]`);
    expect(select, '開票狀態那個 select 不見了 ⇒ 下面的斷言會恆綠').not.toBeNull();

    const rendered = [...(select as HTMLSelectElement).options].map((o) => [o.value, o.textContent]);
    const expected = Object.entries(INVOICE_STATUS_LABEL);
    expect(rendered).toEqual(expected);
  });

  it('🔴 本元件原始碼裡沒有硬寫的三態中文(硬寫回去要當場紅)', () => {
    // 🔴 讀原始碼、不讀渲染結果 —— 因為「硬寫一模一樣的字」在渲染結果上與接了共用來源【完全相同】。
    const src = readFileSync(join(__dirname, 'order-edit-form.tsx'), 'utf8');

    // 只掃 `<option ...>中文</option>` 這個形狀,不掃整支檔 ——
    // 🔴 檔內註解**刻意**提到「未開立」等字面來解釋為什麼不能硬寫;
    //    掃整支檔的話,那段解釋自己會把守門打紅(而那正是本 repo 記過的「偵測字串自命中」)。
    const optionLiterals = [...src.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g)]
      .map((m) => m[1])
      .filter((t): t is string => t !== undefined);

    // 正向對照:量具真的抓到 <option> 了。抓到 0 個時下面那條會恆綠。
    expect(optionLiterals.length, '一個 <option> 字面都沒抓到 ⇒ 這支尺沒在量東西').toBeGreaterThan(0);

    for (const label of Object.values(INVOICE_STATUS_LABEL)) {
      const hit = optionLiterals.find((t) => t.includes(label));
      expect(
        hit,
        `<option> 裡出現硬寫的「${label}」⇒ 三態中文又有第二份副本了。` +
          '接 INVOICE_STATUS_LABEL(照同檔出貨方式那格的 Object.entries 形狀)。',
      ).toBeUndefined();
    }
  });
});

describe('🔴🔴 決定不開發票的單:那三格不出現(⟦b4-INVOICE5PCT⟧ 第 2 步)', () => {
  // 🎯 這一組不是 UX —— 它是那道 DB 鎖的【另一半】。
  //    鎖擋得住錯的資料, **而擋不住員工在財政部平台按下去那個動作** ——
  //    而讓他按下去的正是「開立狀態:未開立」這句話(它與真的在等開票的單逐字相同)。
  it('🔴 false ⇒ 開立狀態 / 發票號碼 / 發票金額 三個 input 都不在', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    for (const name of [INVOICE_STATUS_FIELD, 'invoice_number', 'invoice_amount']) {
      expect(container.querySelector(`[name="${name}"]`), `${name} 不該被渲染`).toBeNull();
    }
  });

  it('🔴 而它要【說出為什麼】—— 一格空白與「這張單不開發票」是兩件事', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    expect(container.textContent).toContain('此單不開發票');
    expect(container.textContent).toContain('作廢重開');
  });

  it('🔴 而它【不得】出現「未開立」—— 那正是會讓員工去開一張真發票的那句話', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    expect(container.textContent).not.toContain('未開立');
  });

  it('🟢 正對照:true 的單那三格【原樣都在】—— 否則上面三格只證明它什麼都不渲染', () => {
    const { container } = render(<OrderEditForm detail={detail} returnTo='/x' />);
    for (const name of [INVOICE_STATUS_FIELD, 'invoice_number', 'invoice_amount']) {
      expect(container.querySelector(`[name="${name}"]`), `${name} 應該在`).not.toBeNull();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 2026-09-13 P2:開立日期那一格
// ══════════════════════════════════════════════════════════════════
describe('開立日期(2026-09-13 P2;Sean Q1 乙 手填 / Q5 甲 必填 / Q6 甲 可覆蓋)', () => {
  it('🔴 是原生 `<input type="date">`, 欄名走常數(wire 值就是 YYYY-MM-DD, 與 DB 的 date 欄同形)', () => {
    const { container } = render(<OrderEditForm detail={detail} returnTo='/x' />);
    const el = container.querySelector(`input[name="${INVOICE_ISSUED_AT_FIELD}"]`);
    expect(el).not.toBeNull();
    expect(el?.getAttribute('type')).toBe('date');
  });

  const dateInput = (d: Record<string, unknown>) =>
    render(<OrderEditForm detail={{ ...detail, ...d } as never} returnTo='/x' />).container.querySelector(
      `input[name="${INVOICE_ISSUED_AT_FIELD}"]`,
    ) as HTMLInputElement;

  it('🔴 issued ⇒ 預填既有日期(改號碼不該逼他重打日期;不轉 Date、不加時區)', () => {
    expect(dateInput({ invoiceStatus: 'issued', invoiceIssuedAt: '2026-04-16' }).defaultValue).toBe('2026-04-16');
  });

  // 🔴🔴 codex 2026-09-13 must-fix 的證人:9/28 開 → 作廢(日期留著)→ 10/5 重開只改狀態號碼金額
  //    ⇒ 表單若自動回送 2026-09-28 ⇒ RPC「必須帶日期鍵」看到鍵在 ⇒ 放行 ⇒ **重開的金額安靜地歸回 9 月**。
  //    RPC 分不出「他打的」與「表單自動送的」—— 只有這裡擋得到。
  it('🔴🔴 voided ⇒ 預填【空】—— 重開必須重填, 舊日期不得被自動回送', () => {
    expect(dateInput({ invoiceStatus: 'voided', invoiceIssuedAt: '2026-09-28' }).defaultValue).toBe('');
  });

  it('🔴🔴 not_issued ⇒ 預填【空】—— ⛔ ~~預設今天~~:9/30 23:59 開表單、10/1 00:01 登記會自動送 9/30(codex R2)', () => {
    const el = dateInput({ invoiceStatus: 'not_issued', invoiceIssuedAt: '2026-01-01' });
    expect(el.defaultValue).toBe('');
  });

  it('🔴 沒有 max —— 跨午夜沒重載的 max 會把合法的今天擋在 RPC 之前(codex must-fix);未來由 RPC 擋', () => {
    expect(dateInput({ invoiceStatus: 'not_issued', invoiceIssuedAt: null }).hasAttribute('max')).toBe(false);
  });

  // 🔴🔴 codex R2 must-fix:這張是 server component 表單, 沒有 key 的話 revalidate 之後 React 只更新 props,
  //    uncontrolled 的 select / date 留著舊 DOM 值 ⇒ 別人剛作廢、甲只改號碼按存 ⇒ 送出 version=8 + issued + 9/28。
  //    ⇒ 版本一變整張重建(與小抄彈窗那張 form 同一個形狀)。這一格用【重渲染】驗, 不是首次掛載。
  it('🔴🔴 版本變了 ⇒ 表單重建:舊 DOM 的日期不會活到下一版', () => {
    const v7 = { ...detail, version: 7, invoiceStatus: 'issued', invoiceIssuedAt: '2026-09-28' } as never;
    const { container, rerender } = render(<OrderEditForm detail={v7} returnTo='/x' />);
    const before = container.querySelector(`input[name="${INVOICE_ISSUED_AT_FIELD}"]`) as HTMLInputElement;
    expect(before.defaultValue).toBe('2026-09-28');
    // 模擬員工打了字(DOM 值), 然後別人把單作廢成 v8 ⇒ revalidate 重渲染
    before.value = '2026-09-28';
    rerender(<OrderEditForm detail={{ ...detail, version: 8, invoiceStatus: 'voided', invoiceIssuedAt: '2026-09-28' } as never} returnTo='/x' />);
    const after = container.querySelector(`input[name="${INVOICE_ISSUED_AT_FIELD}"]`) as HTMLInputElement;
    // 🛑 突變:拿掉 key ⇒ `after` 是同一個 DOM 節點、value 仍是 9/28 ⇒ 這一格紅。
    expect(after).not.toBe(before);
    expect(after.value).toBe('');
  });

  it('🔵 `required` 刻意不加 —— 「已作廢」/「未開立」時可以留空, 必填只在「已開立」, 那條規則住在 RPC', () => {
    const { container } = render(<OrderEditForm detail={detail} returnTo='/x' />);
    const el = container.querySelector(`input[name="${INVOICE_ISSUED_AT_FIELD}"]`) as HTMLInputElement;
    expect(el.hasAttribute('required')).toBe(false);
  });

  it('🔴 決定不開發票的單 ⇒ 這一格也不出現(與那三格同一個條件)', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    expect(container.querySelector(`[name="${INVOICE_ISSUED_AT_FIELD}"]`)).toBeNull();
  });
});
