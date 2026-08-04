// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RefundExceptionRow } from '../../../lib/payment/refund-read';

// M-3 A7c RW3 清單 + RW4 操作(對帳判定/人工結案)。
// refund-read / recovery-actions transitively 拉 server-only ⇒ 整支 mock
// (refund-wiring.test.tsx 同紀律:page graph 每支 server 模組都要 mock)。

const mocks = vi.hoisted(() => ({ listRefundExceptions: vi.fn() }));
vi.mock('../../../lib/payment/refund-read', () => ({
  listRefundExceptions: mocks.listRefundExceptions,
}));
vi.mock('../../../lib/payment/refund-recovery-actions', () => ({
  judgeRefundExceptionAction: vi.fn(),
  resolveRefundExceptionAction: vi.fn(),
}));
// 列操作元件用 useRouter(bfcache refresh);jsdom 無 app router context ⇒ 假 router。
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import RefundExceptionsPage from './page';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function exceptionRow(over: Partial<RefundExceptionRow> = {}): RefundExceptionRow {
  return {
    id: 'r-1',
    kind: 'partial',
    status: 'processing',
    refundAmount: 100,
    reason: '缺貨退款',
    actor: 'sean',
    createdAt: '2026-08-04T03:00:00+00:00',
    failedReason: null,
    failedDetail: null,
    providerEvidence: null,
    orderId: ORDER_ID,
    orderDisplayId: 'PCM-2026-0001',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage(search: Record<string, string> = {}) {
  return render(await RefundExceptionsPage({ searchParams: Promise.resolve(search) }));
}

describe('/orders/refund-exceptions — RW3', () => {
  it('[1] 空清單 → 空態;頁面明寫勿重複發起', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [], truncated: false });
    const { container } = await renderPage();
    expect(container.textContent).toContain('目前沒有滯留的退款');
    expect(container.textContent).toContain('勿重複發起');
  });

  it('[2] 列渲染:訂單連結回明細頁、金額、證據標示', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), exceptionRow({ id: 'r-2', providerEvidence: 'DR999', refundAmount: 4500 })],
      truncated: false,
    });
    const { container } = await renderPage();
    const link = container.querySelector(`a[href="/orders/${ORDER_ID}"]`);
    expect(link?.textContent).toBe('PCM-2026-0001');
    expect(container.textContent).toContain('4,500');
    // 證據列=G7-hold 優先處理;無證據列=滯留逾時。兩種標示都要在。
    expect(container.textContent).toContain('TapPay 已受理,優先處理');
    expect(container.textContent).toContain('無(滯留逾時)');
  });

  it('[2b] 截斷旗標 → 顯「較新的異常未列出」橫幅(codex MF1)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [exceptionRow()], truncated: true });
    const { container } = await renderPage();
    expect(container.textContent).toContain('較新的異常未列出');
  });

  it('[3] 讀取失敗 → 錯誤態 200(不 500、不靜默)', async () => {
    mocks.listRefundExceptions.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.textContent).toContain('清單載入失敗');
  });

  it('[4] 🔴 措辭鐵律同頁適用:不得出現「還能退」「剩餘可退」', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [exceptionRow()], truncated: false });
    const { container } = await renderPage();
    expect(container.textContent).not.toContain('還能退');
    expect(container.textContent).not.toContain('剩餘可退');
  });
});

describe('/orders/refund-exceptions — RW4 操作接線', () => {
  it('[5] 每列掛「執行對帳判定」入口;結案按鈕**不**直接渲染(判定成立後才出現)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), exceptionRow({ id: 'r-2' })],
      truncated: false,
    });
    const { container } = await renderPage();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.filter((t) => t.includes('執行對帳判定'))).toHaveLength(2);
    // 量按鈕不量 textContent(頁首 prose 也提「標記失敗/恢復結案」;量錯東西=恆紅假訊號)。
    expect(buttons.filter((t) => t.includes('標記失敗'))).toHaveLength(0);
    expect(buttons.filter((t) => t.includes('恢復結案'))).toHaveLength(0);
  });

  it('[6] PRG 結果碼 → 兩則成功橫幅(result-banner 註冊)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [], truncated: false });
    let rendered = await renderPage({ r: 'refund_marked_failed' });
    expect(rendered.container.textContent).toContain('已標記失敗結案');
    cleanup();
    rendered = await renderPage({ r: 'refund_recovered' });
    expect(rendered.container.textContent).toContain('已恢復結案');
  });

  it('[7] 讀取失敗 → 不渲染任何操作入口(loadFailed 分支零列=零按鈕;頁首 prose 提到判定不算入口)', async () => {
    mocks.listRefundExceptions.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
