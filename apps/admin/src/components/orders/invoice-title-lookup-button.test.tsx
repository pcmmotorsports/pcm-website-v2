// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ lookupInvoiceTitleAction: vi.fn() }));
vi.mock('@/lib/orders/invoice-title-lookup-action', () => ({
  lookupInvoiceTitleAction: mocks.lookupInvoiceTitleAction,
}));

import {
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
} from '@/lib/orders/manual-order-form';
import { InvoiceTitleLookupButton } from './invoice-title-lookup-button';

// invoice-title-lookup-button.test.tsx — ⟦b4-INVOICE5PCT⟧三 片三的守門。
//
// 🔴🔴 **這一份是 codex R1 must-fix ① 的靶。**
//    病:查 A ⇒ 等待中他把統編改成 B(或自己把抬頭打好)⇒ A 回來**無條件覆寫**
//    ⇒ 📌 **畫面上統編是 B 而抬頭是 A —— 一張會開錯抬頭的發票。**
//    ⚠️ 而這個洞在來源接上之前**走不到**(成功分支到不了)⇒ 📌 **接來源那一片把它啟用了。**

function renderInForm() {
  return render(
    <form>
      <input name={MANUAL_ORDER_INVOICE_TAX_ID_FIELD} defaultValue='' />
      <input name={MANUAL_ORDER_INVOICE_TITLE_FIELD} defaultValue='' />
      <InvoiceTitleLookupButton />
    </form>,
  );
}
const taxIdEl = () =>
  document.querySelector<HTMLInputElement>(`[name="${MANUAL_ORDER_INVOICE_TAX_ID_FIELD}"]`)!;
const titleEl = () =>
  document.querySelector<HTMLInputElement>(`[name="${MANUAL_ORDER_INVOICE_TITLE_FIELD}"]`)!;
const click = () => fireEvent.click(screen.getByRole('button'));

describe('查抬頭那顆鈕', () => {
  beforeEach(() => {
    mocks.lookupInvoiceTitleAction.mockReset();
  });
  afterEach(cleanup);

  it('🟢 正向:查到了 ⇒ 抬頭那一格被填上', async () => {
    mocks.lookupInvoiceTitleAction.mockResolvedValue({ ok: true, title: '派達有限公司' });
    renderInForm();
    fireEvent.input(taxIdEl(), { target: { value: '90003020' } });
    click();
    await waitFor(() => {
      expect(titleEl().value).toBe('派達有限公司');
    });
  });

  it('🔴🔴 **[must-fix ①] 等待中他改了統編 ⇒ 舊答案【不准】寫進去**', async () => {
    let resolve!: (v: unknown) => void;
    mocks.lookupInvoiceTitleAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderInForm();
    fireEvent.input(taxIdEl(), { target: { value: '90003020' } });
    click();

    // 他等不及, 改成另一家的統編
    fireEvent.input(taxIdEl(), { target: { value: '22099131' } });
    resolve({ ok: true, title: '派達有限公司' });

    // 🔵 用 DOM 屬性判「那一發回來了」—— 本專案沒有裝 jest-dom 的 `toBeDisabled`。
    await waitFor(() => {
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    });
    // 🔴 承重:拿掉那一行比對 ⇒ 這裡會是「派達有限公司」, 而統編是 22099131。
    expect(titleEl().value).toBe('');
  });

  it('🔴🔴 **[must-fix ①] 等待中他自己把抬頭打好了 ⇒ 舊答案【不准】蓋掉他打的**', async () => {
    let resolve!: (v: unknown) => void;
    mocks.lookupInvoiceTitleAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderInForm();
    fireEvent.input(taxIdEl(), { target: { value: '90003020' } });
    click();

    fireEvent.input(titleEl(), { target: { value: '我自己打的抬頭' } });
    resolve({ ok: true, title: '派達有限公司' });

    // 🔵 用 DOM 屬性判「那一發回來了」—— 本專案沒有裝 jest-dom 的 `toBeDisabled`。
    await waitFor(() => {
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    });
    // 🔴 承重:這一格是「他的字被機器蓋掉」—— 比上面那一格更難發現, 因為統編是對的。
    expect(titleEl().value).toBe('我自己打的抬頭');
  });

  it('🔴🔴 **[R2 must-fix ①] 改掉【再改回原值】⇒ 舊答案照樣不准寫** —— 值一樣不等於沒動過', async () => {
    let resolve!: (v: unknown) => void;
    mocks.lookupInvoiceTitleAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderInForm();
    fireEvent.input(titleEl(), { target: { value: '員工確認的抬頭' } });
    fireEvent.input(taxIdEl(), { target: { value: '90003020' } });
    click();

    // 他改了一個字, 又改回來 —— 而 R1 那個「比值」的折法【比得過】
    fireEvent.input(titleEl(), { target: { value: '員工確認的抬頭X' } });
    fireEvent.input(titleEl(), { target: { value: '員工確認的抬頭' } });
    resolve({ ok: true, title: '派達有限公司' });

    await waitFor(() => {
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    });
    // 🔴 承重:把 editSeq 換回「比值」⇒ 這裡會變成「派達有限公司」。
    expect(titleEl().value).toBe('員工確認的抬頭');
  });

  it('🔴 **[R2 nit④] 舊的【錯誤訊息】也不准貼到新輸入上**', async () => {
    let resolve!: (v: unknown) => void;
    mocks.lookupInvoiceTitleAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderInForm();
    fireEvent.input(taxIdEl(), { target: { value: 'x' } });
    click();

    fireEvent.input(taxIdEl(), { target: { value: '22099131' } });
    resolve({ ok: false, reason: 'invalid' });

    await waitFor(() => {
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    });
    // 🔴 承重:失敗那一條沒有問 stale ⇒ 畫面會對一個【合法】統編說「統編要 8 碼數字」。
    expect(screen.queryByText('統編要 8 碼數字')).toBeNull();
  });

  it('🔴🔴 **[must-fix ②] 那一發【自己 reject】⇒ 畫面降級成手打, 而不是一個沒有人接的例外**', async () => {
    mocks.lookupInvoiceTitleAction.mockRejectedValue(new Error('Failed to fetch'));
    renderInForm();
    fireEvent.input(taxIdEl(), { target: { value: '90003020' } });
    click();
    // 🔴 承重:少了那個 catch, 這裡什麼都不會出現, 而 console 有一個沒人看的錯。
    expect(await screen.findByText('查不到 —— 請自己打抬頭')).toBeDefined();
    expect(titleEl().value).toBe('');
  });

  it('🔵 查不到 ⇒ 說一句話, 而抬頭那一格【什麼都不做】', async () => {
    mocks.lookupInvoiceTitleAction.mockResolvedValue({ ok: false, reason: 'lookup_failed' });
    renderInForm();
    fireEvent.input(taxIdEl(), { target: { value: '00000000' } });
    click();
    expect(await screen.findByText('查不到 —— 請自己打抬頭')).toBeDefined();
    expect(titleEl().value).toBe('');
  });
});
