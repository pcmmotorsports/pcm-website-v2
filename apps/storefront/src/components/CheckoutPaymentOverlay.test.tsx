// @vitest-environment jsdom
//
// CheckoutPaymentOverlay test(M-3 兩步結帳 U5 付款中遮罩)。
// jsdom 只驗「open 控制 showModal/close + 文案 + Esc(cancel)被擋」;真 modal 行為
// (top layer / inert 背景鎖鍵盤 / ::backdrop)不是 jsdom 能驗的 → 留 agent-browser 真瀏覽器。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { CheckoutPaymentOverlay } from './CheckoutPaymentOverlay';

// jsdom 未實作 <dialog> 的 showModal/close → 補最小 stub(僅切 el.open)讓 useEffect 可跑;
// 真 modal / inert 背景 / ::backdrop 非 jsdom 能驗、留 agent-browser 真瀏覽器。
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    if (this.open) throw new DOMException('dialog already open', 'InvalidStateError');
    this.open = true;
  };
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };
}

afterEach(cleanup);

// showModal/close 直接 mock 控制 el.open —— 不依賴 jsdom 對 <dialog> 的實作程度。
function spyDialog() {
  const showModal = vi
    .spyOn(HTMLDialogElement.prototype, 'showModal')
    .mockImplementation(function (this: HTMLDialogElement) {
      // 比照 HTML 規範(Fable F4):已 open 再 showModal 即 throw → 抓「拿掉 !el.open 守門」的突變。
      if (this.open) throw new DOMException('dialog already open', 'InvalidStateError');
      this.open = true;
    });
  const close = vi
    .spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.open = false;
    });
  return { showModal, close, restore: () => { showModal.mockRestore(); close.mockRestore(); } };
}

describe('CheckoutPaymentOverlay(U5 付款中遮罩)', () => {
  it('open=true → 以 modal 開啟(showModal)、顯示付款處理中文案', () => {
    const d = spyDialog();
    const { container, getByText } = render(<CheckoutPaymentOverlay open={true} />);
    expect(container.querySelector('dialog.co-pay-overlay')).toBeTruthy();
    expect(d.showModal).toHaveBeenCalledTimes(1);
    expect(getByText('付款處理中…')).toBeTruthy();
    expect(getByText(/請勿關閉/)).toBeTruthy();
    d.restore();
  });

  it('open=false → 不呼叫 showModal(付款前 / 非付款中無遮罩)', () => {
    const d = spyDialog();
    render(<CheckoutPaymentOverlay open={false} />);
    expect(d.showModal).not.toHaveBeenCalled();
    d.restore();
  });

  it('open false→true→false → showModal 後 close(付款結束遮罩收掉)', () => {
    const d = spyDialog();
    const { rerender } = render(<CheckoutPaymentOverlay open={false} />);
    expect(d.showModal).not.toHaveBeenCalled();
    rerender(<CheckoutPaymentOverlay open={true} />);
    expect(d.showModal).toHaveBeenCalledTimes(1);
    rerender(<CheckoutPaymentOverlay open={false} />);
    expect(d.close).toHaveBeenCalledTimes(1);
    d.restore();
  });

  it('🔴 Esc(cancel 事件)被 preventDefault → 付款中不可關閉遮罩', () => {
    const d = spyDialog();
    const { container } = render(<CheckoutPaymentOverlay open={true} />);
    const dialog = container.querySelector('dialog.co-pay-overlay') as HTMLDialogElement;
    const cancel = new Event('cancel', { cancelable: true });
    const notPrevented = dialog.dispatchEvent(cancel);
    expect(notPrevented).toBe(false); // dispatchEvent 回 false = preventDefault 已呼叫
    d.restore();
  });

  it('🔴 Fable F1:付款中被 close(Esc×2/close-request 穿透)關掉 → 仍付款中即自動重新蓋回', () => {
    const d = spyDialog();
    const { container } = render(<CheckoutPaymentOverlay open={true} />);
    const dialog = container.querySelector('dialog.co-pay-overlay') as HTMLDialogElement;
    expect(d.showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    // 模擬 Esc×2 穿透:dialog 被關(open→false)並派 close 事件(jsdom close stub 不自動派 → 手動)。
    dialog.close();
    dialog.dispatchEvent(new Event('close'));
    // prop open 仍 true(仍付款中)→ close handler 立刻重呼 showModal 蓋回,遮罩不被關掉。
    expect(d.showModal).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(true);
    d.restore();
  });

  it('a11y:aria-busy + aria-labelledby/describedby 連到標題與說明', () => {
    const d = spyDialog();
    const { container } = render(<CheckoutPaymentOverlay open={true} />);
    const dialog = container.querySelector('dialog.co-pay-overlay') as HTMLDialogElement;
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('checkout-pay-overlay-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('checkout-pay-overlay-note');
    expect(container.querySelector('#checkout-pay-overlay-title')?.textContent).toContain('付款處理中');
    d.restore();
  });
});
