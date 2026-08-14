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
    expect(container.textContent).toContain('目前沒有滯留或卡住的退款');
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
    // 文案已改成不歸因(兩關 nit:原文把爆量一律說成「滯留量」,但 #473b-2 之後
    // 也可能全是卡住的列)⇒ 這格改守「有東西沒列出來」這個可觀察事實。
    expect(container.textContent).toContain('有退款沒有列出來');
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

describe('/orders/refund-exceptions — #473 卡住的列(看得見、但沒有動作)', () => {
  const stuckRow = (over: Partial<RefundExceptionRow> = {}) =>
    exceptionRow({
      id: 'r-stuck',
      status: 'failed',
      failedReason: 'manual_failed',
      failedDetail: 'Record 差額 0',
      ...over,
    });
  // 🔴 **帶證據**的卡住列(code-reviewer MF4:我原本的 fixture 只有無證據那支,
  //    「有證據」那條分支零覆蓋、刪掉它六格全綠)。
  //    而依 `20260803150000:179` + `:377`,證據非空的列**出口只剩** recovered_confirmed /
  //    manual_failed ⇒ 帶證據的卡住列是**主要形態**,不是邊角。
  const stuckWithEvidence = () => stuckRow({ id: 'r-stuck-ev', providerEvidence: 'DR999' });

  it('[8] 🔴 卡住的列**不掛**任何操作入口 —— 按了只會回「已結案」的按鈕就是誤導', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [stuckRow()], truncated: false });
    const { container } = await renderPage();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('[9] 🔴 同頁混合時,只有可處理那列有按鈕(不是整頁一起關掉)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), stuckRow()],
      truncated: false,
    });
    const { container } = await renderPage();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.filter((t) => t.includes('執行對帳判定'))).toHaveLength(1);
  });

  it('[10] 文案講清楚「這裡改不了」+ 下一步找誰(不叫人去做沒有結果的事)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [stuckRow()], truncated: false });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('這裡沒有可以按的動作');
    expect(text).toContain('請聯絡工程師處理');
    // 🔴 負:不得沿用 processing 那半的兩句 —— 卡住的列既沒滯留逾時、也無「優先處理」可言。
    //    ⚠️ 掃的是**整頁**:fixture 只放一列卡住的 ⇒ 頁面上任何地方出現這兩句都算違反
    //    (含頁首 prose)。日後若頁首要合法地提到它們,這格要改成只掃該列。
    expect(text).not.toContain('滯留逾時');
    expect(text).not.toContain('優先處理');
  });

  it('[10b] 🔴 **帶 TapPay 受理證據**的卡住列:證據要標出來,但不得沿用「優先處理」', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckWithEvidence()],
      truncated: false,
    });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('TapPay 曾受理');
    // 這是 MF4 的本體:刪掉 page.tsx 的 stuck 分支、恢復「已受理,優先處理」,本格會紅。
    expect(text).not.toContain('優先處理');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('[10c] 🔴 不得把「人工判定」講成金流事實 —— 那正是可能要更正的東西', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckWithEvidence()],
      truncated: false,
    });
    const { container } = await renderPage();
    const copy = [...container.querySelectorAll('p')].map((p) => p.textContent ?? '').join(' ');
    // 🔴 兩關同抓:「錢沒有動」寫成既成事實 ⇒ 員工不會再去追 TapPay,
    //    而帶證據的列**錢可能真的動了**。文案只能敘述「當初判定的內容」。
    expect(copy).not.toContain('錢沒有動');
    expect(copy).toContain('當初被人工判定');
  });

  it('[11] 🔴 文案守門:純文字輸出不得混進 Markdown 星號;不得寫死鐘點', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [stuckRow()], truncated: false });
    const { container } = await renderPage();
    expect(container.textContent ?? '').not.toContain('**');
    // 🔴 鐘點守門只掃「我們寫的字」(<p> 文案),**不掃整頁** ——
    //    第一版掃整頁,紅在資料列渲染出來的 created_at「2026-08-04 11:00」,
    //    那是真實資料不是文案 = 量錯東西(掃描字集比宣稱寬)。
    //    ⚠️ 限度:寫死鐘點若被塞進 <td>/<th> 而非 <p>,本格看不到。
    const copy = [...container.querySelectorAll('p')].map((p) => p.textContent ?? '').join(' ');
    expect(copy).not.toBe('');
    // 「22:30」這種關帳鐘點依銀行而異,寫進 UI 就是對員工說謊(memory:鐘點不准進文案)。
    expect(copy).not.toMatch(/\d{1,2}:\d{2}/);
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
