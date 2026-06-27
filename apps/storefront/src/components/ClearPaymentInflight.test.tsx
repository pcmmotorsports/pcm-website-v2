// @vitest-environment jsdom
//
// ClearPaymentInflight test(P3)。驗:mount → 清 in-flight 記號(localStorage 被移除)、零 UI(回 null)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ClearPaymentInflight } from './ClearPaymentInflight';

const KEY = 'pcm-payment-inflight';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ClearPaymentInflight', () => {
  it('mount → 清 in-flight 記號、零 UI', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ cartSessionId: 'x', ts: Date.now() }));
    const { container } = render(<ClearPaymentInflight />);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('無記號時 mount 亦安全(no-op、不炸)', () => {
    expect(() => render(<ClearPaymentInflight />)).not.toThrow();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
