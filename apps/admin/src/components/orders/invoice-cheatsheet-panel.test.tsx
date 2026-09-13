// @vitest-environment jsdom
// invoice-cheatsheet-panel.test.tsx — 發票小抄彈窗本體的守門。
//
// 🔴🔴 **這個畫面印的三個數會被抄到【紙本發票】上。** 所以本檔守的是:
//   ① 印的數 = 純函式算的數(畫面上零算式 —— 用一個**兩種算法會分岔**的金額當證人)
//   ② 算不出來 ⇒ **不印數字、印警語**(一個看起來正常的錯數字比一句「算不出來」危險)
//   ③ 二聯 / 三聯只換呈現, **三個數本身不變、零寫入**
//   ④ 字面逐字(「發票上要寫的」/「登記發票號碼與金額」)+ 禁字(「財政部」「開立系統」「平台」)
//
// 🔵 `updateOrderWorkflowAction` mock 掉:它是 server action, jsdom 下 import 會拉 `server-only`。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminOrderDetail } from '@pcm/domain';
import {
  INVOICE_AMOUNT_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_STATUS_FIELD,
  ORDER_ID_FIELD,
  VERSION_FIELD,
} from '../../lib/orders/workflow-form';
import {
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
} from '../../lib/orders/manual-order-form';

const mocks = vi.hoisted(() => ({ lookupInvoiceTitleAction: vi.fn() }));
vi.mock('../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: async () => {},
}));
// 🔴 查抬頭那條 server action mock 掉:fail-open 那格要它【一定失敗】。
vi.mock('@/lib/orders/invoice-title-lookup-action', () => ({
  lookupInvoiceTitleAction: mocks.lookupInvoiceTitleAction,
}));

const { InvoiceCheatSheetPanel } = await import('./invoice-cheatsheet-panel');

// 🔴 用 1100:殘差 ⇒ 1048 / 52;正推 ⇒ 1048 / 52 剛好同值 —— 所以**不能只用它**。
//    分岔的證人在下面 `inclusive 10` 那格(殘差 10/0, 正推 9/1)。
//    這一組 fixture 的用途是「畫面印的 = 函式回的」, 分岔守門在 `invoice-cheatsheet.test.ts`。
const base = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'PCM-2099-0001',
  version: 7,
  invoiceRequested: true,
  invoiceStatus: 'not_issued',
  invoiceNumber: null,
  invoiceAmount: null,
  invoiceRequest: { type: 'company', title: '傑藝有限公司', taxId: '12345678' },
  priceTaxMode: 'inclusive',
  total: { amount: 1100, currency: 'TWD' },
  taxTotal: { amount: 0, currency: 'TWD' },
} as unknown as AdminOrderDetail;

const RETURN = '/orders/11111111-1111-4111-8111-111111111111';

afterEach(cleanup);

/**
 * 讀 `<dl>` 裡的每一行(dt ⇒ dd), 二聯時只有一行。
 *
 * 🔴 **同一個標籤出現兩次 ⇒ 直接 throw**(codex 2026-09-13 nit 1):
 *    舊版用物件收, 後面那列會**蓋掉**前面那列 ⇒ 畫面上兩個不同的「總計」而斷言照樣綠。
 *    這裡的「兩個總計」不是假想:一個沒清乾淨的舊 `<dl>` 疊在新的上面就是這個樣子。
 */
function numbers(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = [...container.querySelectorAll('dl > div')];
  for (const row of rows) {
    const dt = row.querySelector('dt')?.textContent?.trim() ?? '';
    const dd = row.querySelector('dd')?.textContent?.trim() ?? '';
    if (dt in out) throw new Error(`標籤「${dt}」出現兩次(${out[dt]} 與 ${dd})—— 畫面上有兩個不同的數`);
    out[dt] = dd;
  }
  if (Object.keys(out).length !== rows.length) throw new Error('列數與標籤數對不上');
  return out;
}


describe('三個數 = 純函式算的, 畫面上零算式', () => {
  it('🔴 inclusive 1100 ⇒ 銷售額(未稅)1,048 / 營業稅 52 / 總計 1,100(預設三聯)', () => {
    const { container } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    expect(numbers(container)).toEqual({
      '銷售額(未稅)': '1,048',
      營業稅: '52',
      總計: '1,100',
    });
  });

  it('🔴 exclusive:稅直接讀 tax_total, 不重算(subtotal 1000 / 運費 200 / 稅 60 / 總計 1260)', () => {
    // 🔬 這一組正是規格 §6-13 逐字做會錯的那一組:未稅要含運費 ⇒ 1,200 不是 1,000。
    const d = {
      ...base,
      priceTaxMode: 'exclusive',
      total: { amount: 1260, currency: 'TWD' },
      taxTotal: { amount: 60, currency: 'TWD' },
    } as unknown as AdminOrderDetail;
    const { container } = render(<InvoiceCheatSheetPanel detail={d} returnTo={RETURN} />);
    expect(numbers(container)).toEqual({
      '銷售額(未稅)': '1,200',
      營業稅: '60',
      總計: '1,260',
    });
  });

  it('🔴🔴 分岔證人:inclusive 10 ⇒ 10 / 0 / 10(畫面若自己算正推會印 9 / 1)', () => {
    const d = { ...base, total: { amount: 10, currency: 'TWD' } } as unknown as AdminOrderDetail;
    const { container } = render(<InvoiceCheatSheetPanel detail={d} returnTo={RETURN} />);
    expect(numbers(container)).toEqual({ '銷售額(未稅)': '10', 營業稅: '0', 總計: '10' });
  });
});

describe('算不出來 ⇒ 不印數字、印警語(fail-closed 到畫面)', () => {
  it.each([
    ['priceTaxMode 讀不到', { priceTaxMode: null }],
    ['inclusive 而 tax_total ≠ 0(矛盾資料)', { taxTotal: { amount: 49, currency: 'TWD' } }],
  ])('🔴 %s ⇒ 零個數字、一句 role=alert、提到單號', (_label, override) => {
    const d = { ...base, ...override } as unknown as AdminOrderDetail;
    const { container } = render(<InvoiceCheatSheetPanel detail={d} returnTo={RETURN} />);
    expect(container.querySelector('dl'), '算不出來還印了 <dl> ⇒ 有數字會被抄走').toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('PCM-2099-0001');
    expect(alert!.textContent).toContain('不要照這個畫面開發票');
    // 🔴 codex nit 2:「沒有 <dl>」只證明那個 <dl> 不在, 不證明畫面上沒有別的地方印出金額。
    //    掃上塊(唯讀區)整段:統編 12345678 是八碼**不含逗號**, 而金額 ≥ 1,000 一定帶千分位
    //    ⇒ 用「千分位」當金額的指紋。⚠️ 三位數以下的金額這一格抓不到, 那由 <dl> 那格兜底。
    const sheetSection = container.querySelector('section')!;
    const leaked = sheetSection.textContent?.match(/\d{1,3}(,\d{3})+/);
    expect(leaked?.[0], '算不出來而上塊仍印出一個金額 ⇒ 它會被抄走').toBeUndefined();
  });

  it('🔴 invoiceRequested=false ⇒ 整個彈窗只剩既有那句, 三個數與登記欄都不出現', () => {
    const d = { ...base, invoiceRequested: false } as unknown as AdminOrderDetail;
    const { container } = render(<InvoiceCheatSheetPanel detail={d} returnTo={RETURN} />);
    expect(container.textContent).toContain('此單不開發票');
    expect(container.querySelector('dl')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector(`input[name="${INVOICE_NUMBER_FIELD}"]`)).toBeNull();
  });
});

describe('二聯 / 三聯:只換呈現', () => {
  it('🔴 預設三聯(三行都在), 切二聯 ⇒ 只剩總計、而總計的值不變', () => {
    const { container, getByRole } = render(
      <InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />,
    );
    const three = getByRole('button', { name: /三聯/ });
    const two = getByRole('button', { name: /二聯/ });
    expect(three.getAttribute('aria-pressed')).toBe('true');
    expect(Object.keys(numbers(container))).toHaveLength(3);

    fireEvent.click(two);
    expect(two.getAttribute('aria-pressed')).toBe('true');
    expect(numbers(container)).toEqual({ 總計: '1,100' });

    fireEvent.click(three);
    expect(numbers(container)).toEqual({ '銷售額(未稅)': '1,048', 營業稅: '52', 總計: '1,100' });
  });

  it('🔴 兩顆鈕帶說明字(Sean 答 Q1 甲), 而且**不寫「含稅 / 未稅」當標籤**', () => {
    const { getByRole } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    expect(getByRole('button', { name: /二聯/ }).textContent).toContain('含稅一個數');
    expect(getByRole('button', { name: /三聯/ }).textContent).toContain('未稅 + 稅 + 總計');
  });

  it('🔴 切換是 type=button ⇒ 按它不會送出(零寫入);而它【沒有 name】⇒ 也不會進 FormData', () => {
    // 🔵 Q3 甲之後整個上塊在 <form> 裡, 「不在 form 裡」那道守不住了 ⇒ 改守兩件結構上的事。
    const { container, getByRole } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    const two = getByRole('button', { name: /二聯/ });
    expect(two.getAttribute('type')).toBe('button');
    expect(two.getAttribute('name')).toBeNull();
    fireEvent.click(two);
    const fd = new FormData(container.querySelector('form') as HTMLFormElement);
    expect([...fd.keys()].some((k) => /lian|聯/.test(k)), '聯式跑進 FormData ⇒ 它會被送出去').toBe(false);
  });
});

describe('登記那三格:既有欄名、部分表單、樂觀鎖', () => {
  it('🔴 三格 name 用既有常數 + 隱藏的 order_id / version(沒有 shipping_method = 刻意)', () => {
    const { container } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    const form = container.querySelector('form')!;
    for (const name of [INVOICE_STATUS_FIELD, INVOICE_NUMBER_FIELD, INVOICE_AMOUNT_FIELD]) {
      expect(form.querySelector(`[name="${name}"]`), `缺 ${name}`).not.toBeNull();
    }
    expect(form.querySelector<HTMLInputElement>(`input[name="${ORDER_ID_FIELD}"]`)?.value).toBe(base.id);
    expect(form.querySelector<HTMLInputElement>(`input[name="${VERSION_FIELD}"]`)?.value).toBe('7');
    // 🔴 部分表單:沒有 shipping_method ⇒ RPC 不動那一欄(workflow-form.ts:181)。
    expect(form.querySelector('[name="shipping_method"]')).toBeNull();
    // 🔴 codex nit 3:return_to 沒送 ⇒ 解析器退回 /orders/<id>, 面板與列表位置全丟。
    //    用 FormData 讀, 不用 querySelector —— 前者才是真的會送出去的東西。
    const fd = new FormData(form as HTMLFormElement);
    expect(fd.get('return_to')).toBe(RETURN);
    expect(fd.get(VERSION_FIELD)).toBe('7');
  });

  // 🔴🔴 codex must-fix:草稿與版本必須是同一份快照。
  //    沒有 key={version}:收到新版 detail ⇒ hidden version 更新、三格 defaultValue 不動
  //    ⇒ 送出「新版本號 + 舊草稿」⇒ 樂觀鎖過、別人剛存的被靜默蓋掉。
  it('🔴🔴 收到新版 detail ⇒ 表單重建, 舊草稿不會搭新版本號送出', () => {
    const { container, rerender } = render(
      <InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />,
    );
    const number = container.querySelector<HTMLInputElement>(`input[name="${INVOICE_NUMBER_FIELD}"]`)!;
    fireEvent.change(number, { target: { value: 'AA-12345678' } });
    expect(number.value).toBe('AA-12345678');

    // 別人先存了:version 7 → 8, 而且號碼變了
    const newer = { ...base, version: 8, invoiceNumber: 'ZZ-00000001' } as unknown as AdminOrderDetail;
    rerender(<InvoiceCheatSheetPanel detail={newer} returnTo={RETURN} />);

    const form = container.querySelector('form') as HTMLFormElement;
    const fd = new FormData(form);
    expect(fd.get(VERSION_FIELD)).toBe('8');
    // 🔴 這一行是整格的重點:號碼必須是**新版的值**, 不是員工在版本 7 打的草稿。
    expect(fd.get(INVOICE_NUMBER_FIELD), '版本 8 搭著版本 7 的草稿送出 ⇒ 樂觀鎖形同虛設').toBe('ZZ-00000001');
  });

  it('🛑 發票金額那格**不預填**小抄的數 —— 「該寫多少」與「實際開了多少」是兩件事', () => {
    const { container } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    const amount = container.querySelector<HTMLInputElement>(`input[name="${INVOICE_AMOUNT_FIELD}"]`);
    expect(amount?.value).toBe('');
  });
});

describe('抬頭 / 統編:可改、既有欄名、查抬頭鈕在 form 內', () => {
  it('🔴 預帶客人填的抬頭與統編, 兩格可改(不是 readOnly), name 照 MANUAL_ORDER_INVOICE_* 那組', () => {
    const { container } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    const title = container.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_INVOICE_TITLE_FIELD}"]`);
    const taxId = container.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_INVOICE_TAX_ID_FIELD}"]`);
    expect(title?.value).toBe('傑藝有限公司');
    expect(taxId?.value).toBe('12345678');
    expect(title?.readOnly, 'readOnly ⇒ 改了存不進去').toBe(false);
    expect(taxId?.readOnly).toBe(false);
    // 🔴 兩格在同一張 form 裡 —— 送出時與登記三格同一個 version、同一列 audit。
    expect(title?.closest('form')).not.toBeNull();
    expect(title?.closest('form')).toBe(taxId?.closest('form'));
  });

  it('🔴 查抬頭鈕在, 而且在【同一張 form 裡】(它靠 closest(form) 找輸入框, 在 form 外掛了也找不到)', () => {
    const { container, getByRole } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    const btn = getByRole('button', { name: /查抬頭/ });
    expect(btn.closest('form')).toBe(container.querySelector('form'));
  });

  // 🔴🔴 **fail-open(主視窗硬線, 逐字):把查抬頭的來源指到一定失敗的網址 ⇒ 他照樣登記得出去。**
  //    這一格【先紅過】:第一版元件兩格 readOnly、沒有鈕 ⇒ 這一格找不到鈕 ⇒ 紅。
  //    它守的不是「查得到」—— 是「**查不到的時候他不會卡住**」。
  it('🔴🔴 fail-open:查抬頭一定失敗 ⇒ 說一句「查不到」⇒ 自己打的抬頭照樣在 FormData 裡送出', async () => {
    mocks.lookupInvoiceTitleAction.mockResolvedValue({ ok: false, reason: 'lookup_failed' });
    const empty = { ...base, invoiceRequest: { type: 'personal' } } as unknown as AdminOrderDetail;
    const { container, getByRole, findByText } = render(
      <InvoiceCheatSheetPanel detail={empty} returnTo={RETURN} />,
    );
    const taxId = container.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_INVOICE_TAX_ID_FIELD}"]`)!;
    const title = container.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_INVOICE_TITLE_FIELD}"]`)!;

    fireEvent.change(taxId, { target: { value: '12345678' } });
    fireEvent.click(getByRole('button', { name: /查抬頭/ }));
    // ① 失敗那句要看得到
    expect(await findByText('查不到 —— 請自己打抬頭')).toBeDefined();
    await waitFor(() => expect(mocks.lookupInvoiceTitleAction).toHaveBeenCalledTimes(1));
    // ② 抬頭那格沒被鈕動過(仍是空的)
    expect(title.value).toBe('');
    // ③ 他自己打 ⇒ 兩格都在 FormData 裡 ⇒ 送出去的就是他打的
    fireEvent.change(title, { target: { value: '我自己打的公司' } });
    const fd = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(fd.get(MANUAL_ORDER_INVOICE_TITLE_FIELD), '查不到 ⇒ 自己打 ⇒ 存得進去, 這才是 fail-open').toBe('我自己打的公司');
    expect(fd.get(MANUAL_ORDER_INVOICE_TAX_ID_FIELD)).toBe('12345678');
    // ④ 而登記那三格與 version 也在同一份 FormData —— 一發送、一個 version
    expect(fd.get(VERSION_FIELD)).toBe('7');
    expect(fd.has(INVOICE_STATUS_FIELD)).toBe(true);
  });

  it('🔵 查得到 ⇒ 抬頭被帶進去, 而他仍然可以改(帶入的是 input.value, 不是受控 state)', async () => {
    mocks.lookupInvoiceTitleAction.mockResolvedValue({ ok: true, title: '派達有限公司' });
    const empty = { ...base, invoiceRequest: { type: 'personal' } } as unknown as AdminOrderDetail;
    const { container, getByRole } = render(<InvoiceCheatSheetPanel detail={empty} returnTo={RETURN} />);
    const taxId = container.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_INVOICE_TAX_ID_FIELD}"]`)!;
    const title = container.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_INVOICE_TITLE_FIELD}"]`)!;
    fireEvent.change(taxId, { target: { value: '12345678' } });
    fireEvent.click(getByRole('button', { name: /查抬頭/ }));
    await waitFor(() => expect(title.value).toBe('派達有限公司'));
    fireEvent.change(title, { target: { value: '派達有限公司 台北分公司' } });
    const fd = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(fd.get(MANUAL_ORDER_INVOICE_TITLE_FIELD)).toBe('派達有限公司 台北分公司');
  });
});

describe('字面(Sean 逐字)', () => {
  const SRC = readFileSync(join(__dirname, 'invoice-cheatsheet-panel.tsx'), 'utf8');

  it('🔴 「發票上要寫的」與「登記發票號碼與金額」逐字在畫面上', () => {
    const { container } = render(<InvoiceCheatSheetPanel detail={base} returnTo={RETURN} />);
    expect(container.textContent).toContain('發票上要寫的');
    expect(container.textContent).toContain('登記發票號碼與金額');
  });

  // 🛑 這三個詞是「紙本流程」的反面 —— 出現就是把它講成平台開票。掃**原始碼**, 連註解一起擋:
  //    註解裡出現也會被下一個人抄進字面。
  it.each(['財政部', '開立系統', '平台開'])('🛑 原始碼裡不得出現「%s」', (word) => {
    expect(SRC).not.toContain(word);
  });
});
