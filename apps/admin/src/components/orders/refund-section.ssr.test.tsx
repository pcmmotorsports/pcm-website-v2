// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// 2026-10-02:同 manual-refund-entry-section.ssr.test.tsx 的病(render 當下 setState、seenState 初值 null)。
vi.mock('../../lib/payment/refund-actions', () => ({ initiateRefundAction: async () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { RefundSection } from './refund-section';

describe('RefundSection server 渲染', () => {
  it('server 渲染不會無限重畫', () => {
    const html = renderToString(<RefundSection returnTo='/orders/o-1' orderId='o-1' serverToken='tok-idle' />);
    expect(html).toContain('tok-idle');
  });
});
