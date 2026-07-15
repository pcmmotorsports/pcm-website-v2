// @vitest-environment jsdom
//
// WalletTab smoke(W8:開發註記不外洩)— 對齊 ProfileTab.test.tsx「stub 字面退場」慣例。
// 驗:對客文案=中性「尚未開放」;開發註記「(本段於 g-7 接入)」不再出現在 DOM(g-7=法規 HOLD、#202)。

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WalletTab } from './WalletTab';

describe('WalletTab', () => {
  it('對客顯示中性文案、開發註記不外洩(W8)', () => {
    const { container } = render(<WalletTab />);
    expect(screen.getByText('儲值金')).toBeTruthy();
    expect(screen.getByText('儲值金服務尚未開放。')).toBeTruthy();
    expect(screen.queryByText('（本段於 g-7 接入）')).toBeNull();
    expect(container.querySelector('.acc-stub[data-tab="wallet"]')).toBeTruthy();
  });
});
