// @vitest-environment jsdom
//
// CheckoutPaymentFeedback.test.tsx — 付款區單一 alert 出口(U3b)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CheckoutPaymentFeedback } from './CheckoutPaymentFeedback';

afterEach(cleanup);

describe('CheckoutPaymentFeedback', () => {
  it('有訊息 → 渲染單一 role=alert,沿用既有 co-submit-error class(零 CSS 變更)', () => {
    const { container } = render(<CheckoutPaymentFeedback message="還有 2 個項目需要確認,已在上方標示" />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe('還有 2 個項目需要確認,已在上方標示');
    expect(container.querySelector('.co-submit-error')).toBeTruthy();
  });

  it('🔴 message=null → 完全不渲染節點(不留空殼 alert 讓螢幕閱讀器讀到空內容)', () => {
    const { container } = render(<CheckoutPaymentFeedback message={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('空字串同樣不渲染', () => {
    const { container } = render(<CheckoutPaymentFeedback message="" />);
    expect(container.firstChild).toBeNull();
  });
});
