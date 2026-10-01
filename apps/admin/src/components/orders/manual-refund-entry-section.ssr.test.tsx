// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// 2026-10-02(網站B 回報):訂單有現金或匯款收款時明細頁 500「Too many re-renders」(本元件 :99)。
//   原因同 note-compose-form.ssr.test.tsx:server 端 useActionState 每次渲染都回傳傳進去的初值物件(每次新做一個),
//   而 seenState 初值 null ⇒ 每次渲染都 setSeenState ⇒ server 一直重畫到上限。
vi.mock('../../lib/payment/manual-refund-actions', () => ({ recordManualRefundAction: async () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { ManualRefundEntrySection } from './manual-refund-entry-section';

describe('ManualRefundEntrySection server 渲染', () => {
  it('server 渲染不會無限重畫', () => {
    const html = renderToString(
      <ManualRefundEntrySection orderId='o-1' returnTo='/orders/o-1' serverToken='tok-idle' ledgerSettled={false} />,
    );
    expect(html).toContain('tok-idle');
  });
});
