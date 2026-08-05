// @vitest-environment jsdom
//
// WalletTab smoke(W8:開發註記不外洩)— 對齊 ProfileTab.test.tsx「stub 字面退場」慣例。
// 驗:對客文案=中性「尚未開放」;開發註記「(本段於 g-7 接入)」不再出現在 DOM(g-7=法規 HOLD、#202)。

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WalletTab } from './WalletTab';

// 🔴 本檔原本沒有 cleanup(隔壁 `LineCtaButton.test.tsx` 有)⇒ render 出來的 DOM 留在
//    document 上,`screen.getByText` 是全域查詢 ⇒ **本檔對「同批跑了哪些檔案、什麼順序」敏感**。
//    A 窗 2026-08-05 回報:全套第一次跑時本檔與 `LineCtaButton` 兩支紅、之後三次全綠、單獨跑也綠
//    = 非決定性。無法排除「新增測試檔提高了它的失敗機率」。
//    ⚠️ 為什麼這條非修不可:非決定性的紅會讓「全套 N 綠」這個數字失去意義,
//    而那正是主視窗每次收割時做增量對帳的唯一依據。
afterEach(cleanup);

describe('WalletTab', () => {
  it('對客顯示中性文案、開發註記不外洩(W8)', () => {
    const { container } = render(<WalletTab />);
    expect(screen.getByText('儲值金')).toBeTruthy();
    expect(screen.getByText('儲值金服務尚未開放。')).toBeTruthy();
    expect(screen.queryByText('（本段於 g-7 接入）')).toBeNull();
    expect(container.querySelector('.acc-stub[data-tab="wallet"]')).toBeTruthy();
  });
});
