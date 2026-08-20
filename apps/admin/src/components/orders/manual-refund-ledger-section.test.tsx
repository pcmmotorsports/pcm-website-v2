// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ManualRefundRow } from '../../lib/payment/manual-refund-read';
import { ManualRefundLedgerSection } from './manual-refund-ledger-section';

// M-4b E10 D3:非卡退款登記列表(server component,jsdom 直接 render —— 無 hook 無 context)。
//
// 🔴 [3] 是主視窗 2026-08-20 明點的那格:「有一筆已登記的退款時,畫面上真的看得到它」
// ——這正是主視窗 grep `order_manual_refunds` ⇒ 0 命中所指的那件事(員工今天完全看不到
// 已登記的非卡退款)。這一格不依賴沖銷 RPC(`#787`),可以在那片落地前先驗過。

function row(over: Partial<ManualRefundRow> = {}): ManualRefundRow {
  return {
    id: 'mr-1',
    rail: 'cash',
    refundAmount: 500,
    reason: '商品缺貨,現金退還客人',
    actor: 'sean',
    occurredAt: '2026-08-20T10:00:00.000Z',
    createdAt: '2026-08-20T10:05:00.000Z',
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe('ManualRefundLedgerSection — D3', () => {
  it('[1] 零列且未失敗 → 整區不渲染(同 RefundLedgerSection 的立場)', () => {
    const { container } = render(<ManualRefundLedgerSection rows={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('[2] 載入失敗 → 警告(不靜默)', () => {
    const { container } = render(<ManualRefundLedgerSection rows={[]} loadFailed />);
    expect(container.textContent).toContain('載入失敗');
    expect(container.textContent).toContain('勿在此期間重複登記');
  });

  it('[2b] 列被截斷 → 整區不顯示任何一列(Sean 2026-08-17 Q2=甲 同款立場)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} rowsTruncated />,
    );
    expect(container.textContent).toContain('不顯示任何一列');
    // 🔴 truncated 分支必須排在渲染之前:即使 rows 非空,也不得把那一列印出來。
    expect(container.textContent).not.toContain('缺貨');
  });

  it('[3] 🔴 有一筆已登記的退款 → 畫面上真的看得到它(管道/金額/原因/經手人/時間全部出現)', () => {
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[
          row({
            rail: 'bank_transfer',
            refundAmount: 1200,
            reason: '客人要求匯款退款',
            actor: 'sean',
          }),
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('匯款');
    expect(text).toContain('1,200');
    expect(text).toContain('客人要求匯款退款');
    expect(text).toContain('sean');
  });

  it('[3b] 多筆列 → 全部各自渲染(不是只顯示最新一筆)', () => {
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[
          row({ id: 'mr-1', rail: 'cash', refundAmount: 300 }),
          row({ id: 'mr-2', rail: 'bank_transfer', refundAmount: 700 }),
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('300');
    expect(text).toContain('700');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});
