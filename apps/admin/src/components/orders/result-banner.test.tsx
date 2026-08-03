// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ResultBanner } from './result-banner';
import { NOTE_ADDED_RESULT_CODE } from '../../lib/orders/note-action-state';
import { REFUND_SUBMITTED_RESULT_CODE } from '../../lib/payment/refund-action-state';

// M-4b E10 A9d2-1:本片只加一個成功碼 ⇒ 本檔只測那一格 + 既有行為不被打壞。
//
// 🔴 **刻意不測原型鏈那組向量**(`?r=__proto__` 等):那個修正 Sean 2026-08-02 拍板 **B 退回**
//    (見本元件 `:29-40` 的註解),把它寫成測試等於用測試把「已被退回的修法」釘成規格。
//    本檔測的是「加了一個 key 之後,那個 key 真的顯示得出來、其他 key 沒被打壞」。

afterEach(cleanup);

describe('ResultBanner — A9d2-1 新增的備註成功碼', () => {
  // 🔴 關卡2 MF1:action 組 URL 與本元件查表**共用同一個常數** ⇒ typo 在結構上不可能。
  //    本條再從渲染面確認那個 key 真的有一則訊息(常數存在 ≠ 表裡有它)。
  it('備註成功碼渲染得出文字(action 與本元件共用同一個常數)', () => {
    const { container } = render(<ResultBanner code={NOTE_ADDED_RESULT_CODE} />);
    expect(container.textContent).toContain('備註已新增');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // M-3 RW2c:退款成功碼(關卡2 兩線同抓:漏掛/空白/tone 錯都不會有別的守門紅)。
  it('退款成功碼渲染得出文字,且措辭守「受理 ≠ 已入帳」口徑(plan §3 第一列)', () => {
    const { container } = render(<ResultBanner code={REFUND_SUBMITTED_RESULT_CODE} />);
    expect(container.textContent).toContain('退款已送出');
    expect(container.textContent).toContain('受理不等於已入帳');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('既有改單碼未被打壞(加 key 不該動到別人)', () => {
    expect(render(<ResultBanner code='saved' />).container.textContent).toContain('已儲存變更');
    cleanup();
    expect(render(<ResultBanner code='denied' />).container.textContent).toContain('沒有權限');
  });

  it('缺 code → 不渲染', () => {
    expect(render(<ResultBanner code={undefined} />).container.textContent).toBe('');
  });
});
