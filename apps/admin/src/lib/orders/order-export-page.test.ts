import { describe, expect, it } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import { CSV_BOM, ORDER_EXPORT_COLUMNS } from './order-export';
import { buildOrderPageCsv, orderPageExportFilename } from './order-export-page';

// order-export-page.test.ts — `#24` 片B 接線層的守門。
//
// 🔴 **本層存在的理由是治理不是技術**:plan §1 寫「不改 `order-export.ts`」(Sean 批的),
//    而第一版我判它錯、直接改了片A。codex 指出**那不是被迫的**(`toCsv` 本來就公開),
//    主視窗裁還原 —— 理由:兩者產出對員工完全一樣 ⇒ **唯一差別是誰授權了那個範圍變更**。
//    ⇒ 本層 = 把「這一頁的那份檔長什麼樣」放回**頁面自己的層**。
//
// ⚠️ 本檔【不驗下載】—— 那只有真瀏覽器算數, 而那一發也有它量不到的東西
//    (見 `order-export-button.test.tsx` 檔頭)。

function line(over: Partial<AdminOrderLine> = {}): AdminOrderLine {
  const quantity = over.quantity ?? 1;
  return {
    id: 'l-1',
    variantSku: 'SKU-001',
    title: '排氣管',
    brand: 'Akrapovic',
    quantity,
    unitPrice: { amount: toMoneyAmount(12000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(12000 * quantity), currency: 'TWD' },
    workflowStatus: null,
    version: 1,
    vehicle: null,
    quantitySummary: {
      quantity,
      orderedQuantity: 0,
      instockQuantity: 0,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: quantity,
    },
    ...over,
  };
}

function order(over: Partial<AdminOrderSummary> = {}): AdminOrderSummary {
  const lines = over.lines ?? [line()];
  return {
    id: 'ord-1',
    itemsTruncated: false,
    displayId: 'PCM-0001',
    createdAt: '2026-08-13T02:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    total: { amount: toMoneyAmount(12000), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: '王小明',
    shippingAddress: { name: '收件人', phone: '0912345678', line: '台北市信義區 1 號' },
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    ...over,
    lines,
  };
}

const CTX = { page: 1, filterNote: '', dataAsOf: '2026-08-26 09:00' };

describe('這一頁的 CSV:第一列是檔案自述, 第二列才是表頭', () => {
  it('第一列講得出:哪一頁 / 資料截至什麼時候 / 狀態欄不能當判斷', () => {
    const csv = buildOrderPageCsv([order()], { ...CTX, page: 2, dataAsOf: '2026-08-26 09:30' });
    const first = csv.replace(CSV_BOM, '').split('\r\n')[0] ?? '';
    expect(first).toContain('第 2 頁');
    expect(first).toContain('資料截至 2026-08-26 09:30');
    expect(first).toContain('不是系統對出來的判斷');
  });

  it('🔴 表頭被推到第二列 —— 而它逐字仍是片A 那一份', () => {
    const csv = buildOrderPageCsv([order()], CTX);
    const rows = csv.replace(CSV_BOM, '').split('\r\n');
    expect(rows[1]).toContain(ORDER_EXPORT_COLUMNS[0]);
    expect(rows[1]).toContain('料號');
    // 負對照:第一列【不是】表頭(證上面那格不是隨便抓一列)
    expect(rows[0]).not.toContain('料號');
  });

  it('🔴 走片A 的 toCsv ⇒ BOM 與 CRLF 不是本層自己實作的', () => {
    const csv = buildOrderPageCsv([order()], CTX);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('🔴 自述列【一定】會被逃脫 —— 因為那句話本身就含逗號', () => {
    const first = buildOrderPageCsv([order()], CTX).replace(CSV_BOM, '').split('\r\n')[0] ?? '';
    expect(first.startsWith('"')).toBe(true);
    /* 🔴🔴 **本格原本寫成「有逗號才加引號」+ 一個負對照(乾淨的自述列不加引號)——
       而那個負對照【前提就是錯的】, 當場紅。**
       實查:自述列固定含一個【半形逗號】(「…給人看的文字**,**不是系統對出來的判斷」)
       ⇒ 它**永遠**會被加引號 ⇒ 那個負對照要求的世界【不存在】。
       📌 形狀:**我寫負對照時假設了一個「乾淨的輸入」, 而那個輸入從來沒有乾淨過。**
          ⇒ 紅的不是碼, 是我的假設。
       ⇒ 「不含特殊字元就不加引號」那條**屬於 `toCsv` 自己**, 守門在
         `order-export.test.ts` 的「負對照:不含特殊字元的格不會被加引號」那一格,
         **本層不重複守它**。 */
  });

  it('空清單 ⇒ 仍有自述列 + 表頭, 不是一個空檔', () => {
    const lines = buildOrderPageCsv([], CTX).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    /* 🔴 本格守的是「沒東西可匯出時, 員工拿到的不是 0 byte 的檔」——
       他要分得出「這一頁沒有東西」與「匯出壞了」。 */
    expect(buildOrderPageCsv([], CTX).replace(CSV_BOM, '').trim()).not.toBe('');
  });
});

describe('檔名:要分得出是哪一頁, 否則同一天兩頁互相覆蓋', () => {
  it('帶頁碼', () => {
    expect(orderPageExportFilename(new Date(2026, 7, 26), { ...CTX, page: 3 })).toBe(
      '訂單商品-20260826-第3頁.csv',
    );
  });

  it('帶篩選', () => {
    expect(
      orderPageExportFilename(new Date(2026, 7, 26), { ...CTX, filterNote: '未出貨' }),
    ).toBe('訂單商品-20260826-第1頁-未出貨.csv');
  });

  it('🔴 篩選字串裡的路徑字元被換掉 —— 不讓一個篩選變成一段路徑', () => {
    const n = orderPageExportFilename(new Date(2026, 7, 26), {
      ...CTX,
      filterNote: 'a/b\\c:d',
    });
    expect(n).not.toContain('/');
    expect(n).not.toContain('\\');
    expect(n).not.toContain(':');
    // 負對照:乾淨的字串不會被改壞(證上面三格不是「把什麼都刪光」)
    expect(
      orderPageExportFilename(new Date(2026, 7, 26), { ...CTX, filterNote: '未出貨' }),
    ).toContain('未出貨');
  });

  it('🔴 基底仍然來自片A 的 orderExportFilename —— 日期那半不是本層自己算的', () => {
    expect(orderPageExportFilename(new Date(2026, 0, 3), CTX)).toContain('訂單商品-20260103');
  });
});
