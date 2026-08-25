import { describe, expect, it } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import {
  CSV_BOM,
  ORDER_EXPORT_COLUMNS,
  buildOrderExportCsv,
  buildOrderExportRows,
  orderExportBlockedReason,
  orderExportFilename,
  toCsv,
} from './order-export';

// order-export.test.ts — `#24` 片A 的守門。
//
// 🔴 **本檔驗的是【資料層】,不是畫面。** 「CSV 與畫面逐格相符」那發在片B
//    (它要 render `<OrdersTable/>` 才有東西可比)⇒ **本檔的綠不可以被讀成「匯出跟畫面一樣」。**
//
// fixture 體例沿用同目錄 `order-status-axes.test.ts:35-90`(同一組型別、同一種寫法)。

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
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    ...over,
    lines,
  };
}

/**
 * 取一格。
 *
 * 🔴 **刻意用 `throw` 而不是 `!` 或 `?.`**:`rows[9]` 不存在時,`!` 會讓斷言在
 *    「值不對」與「那一列根本沒有」印**同一種紅**,而後者通常表示上游攤平壞了 ——
 *    那是比「值錯了」嚴重得多的事,不該被壓成同一句話。
 */
function cell(
  rows: string[][],
  index: number,
  name: (typeof ORDER_EXPORT_COLUMNS)[number],
): string {
  const row = rows[index];
  if (row === undefined) throw new Error(`第 ${index} 列不存在(共 ${rows.length} 列)`);
  const value = row[ORDER_EXPORT_COLUMNS.indexOf(name)];
  if (value === undefined) throw new Error(`欄「${name}」不在這一列裡(共 ${row.length} 欄)`);
  return value;
}

describe('攤平:每品項一列', () => {
  it('兩張單、共三個品項 ⇒ 三列', () => {
    const rows = buildOrderExportRows([
      order({ lines: [line({ id: 'a' }), line({ id: 'b' })] }),
      order({ id: 'ord-2', displayId: 'PCM-0002', lines: [line({ id: 'c' })] }),
    ]);
    expect(rows).toHaveLength(3);
    // 🔴 負對照:列數不是恆等於訂單數,也不是恆等於某個寫死的值。
    expect(buildOrderExportRows([order()])).toHaveLength(1);
    expect(buildOrderExportRows([])).toHaveLength(0);
  });

  it('每一列的欄數 = 表頭欄數(欄位漏給會在這裡紅,不是在試算表裡)', () => {
    const rows = buildOrderExportRows([order({ lines: [line(), line({ id: 'b' })] })]);
    for (const row of rows) expect(row).toHaveLength(ORDER_EXPORT_COLUMNS.length);
  });

  it('🔴 訂單層的識別欄【每列都重複】—— 排序會把續列跟它的第一列拆開', () => {
    const rows = buildOrderExportRows([order({ lines: [line({ id: 'a' }), line({ id: 'b' })] })]);
    expect(cell(rows, 1, '單號')).toBe('PCM-0001');
    expect(cell(rows, 1, '客戶')).toBe('王小明');
    expect(cell(rows, 1, '日期')).toBe(cell(rows, 0, '日期'));
  });
});

describe('🔴🔴 錢:兩欄各自可安全加總(本片唯一真正的風險)', () => {
  it('小計每列都填,而【訂單總額只填第一列】⇒ 直接 SUM 那一欄不會重複算', () => {
    const rows = buildOrderExportRows([
      order({
        total: { amount: toMoneyAmount(36000), currency: 'TWD' },
        lines: [line({ id: 'a', quantity: 2 }), line({ id: 'b', quantity: 1 })],
      }),
    ]);
    expect(cell(rows, 0, '小計(每列都有)')).toBe('24000');
    expect(cell(rows, 1, '小計(每列都有)')).toBe('12000');
    expect(cell(rows, 0, '訂單總額(每單只出現一次,可直接加總)')).toBe('36000');
    // 🔴 這一格是整組的重點:**續列必須是空字串**。
    //    它變成 '36000' 的話,一張兩品項的單會被對帳的人加成 72,000 ——
    //    而畫面上完全看不出來,因為畫面根本不顯示續列的金額。
    expect(cell(rows, 1, '訂單總額(每單只出現一次,可直接加總)')).toBe('');
    const summed = rows.reduce((acc, _r, i) => acc + Number(cell(rows, i, '訂單總額(每單只出現一次,可直接加總)') || 0), 0);
    expect(summed).toBe(36000);
  });

  it('🔴 金額是原始整數:沒有 NT$、沒有千分位(畫面上有,這裡刻意沒有)', () => {
    const rows = buildOrderExportRows([
      order({ lines: [line({ unitPrice: { amount: toMoneyAmount(1234567), currency: 'TWD' } })] }),
    ]);
    const unitPriceCell = cell(rows, 0, '單價');
    expect(unitPriceCell).toBe('1234567');
    // 該紅會紅:這兩格是「我沒有不小心套上畫面那層格式」的對照組。
    expect(unitPriceCell).not.toContain('NT$');
    expect(unitPriceCell).not.toContain(',');
  });
});

describe('空值與格式化:呼叫的是畫面用的同一批函式', () => {
  it('車種 / 廠牌 / 品名 為空 ⇒ 印 — (與畫面同字面)', () => {
    const rows = buildOrderExportRows([
      order({ lines: [line({ brand: null, title: null, vehicle: null })] }),
    ]);
    expect(cell(rows, 0, '車種')).toBe('—');
    expect(cell(rows, 0, '廠牌')).toBe('—');
    expect(cell(rows, 0, '物品名稱')).toBe('—');
    // 負對照:有值時不會被印成 —(證上面三格不是恆真)。
    const full = buildOrderExportRows([order()]);
    expect(cell(full, 0, '廠牌')).toBe('Akrapovic');
    expect(cell(full, 0, '物品名稱')).toBe('排氣管');
  });

  it('狀態:已取消走取消字面;itemsTruncated ⇒ 未知(與畫面同一條分支)', () => {
    const cancelled = buildOrderExportRows([order({ cancelledAt: '2026-08-20T00:00:00.000Z' })]);
    expect(cell(cancelled, 0, '狀態')).toBe('已取消');
    const truncated = buildOrderExportRows([order({ itemsTruncated: true })]);
    expect(cell(truncated, 0, '狀態')).toBe('未知');
    // 負對照:一般單既不是「已取消」也不是「未知」。
    const normal = buildOrderExportRows([order()]);
    expect(cell(normal, 0, '狀態')).not.toBe('已取消');
    expect(cell(normal, 0, '狀態')).not.toBe('未知');
  });

  it('會員等級與發票走畫面用的同一張表', () => {
    const rows = buildOrderExportRows([order({ tierAtCheckout: 'store', invoiceStatus: 'issued' })]);
    expect(cell(rows, 0, '會員等級')).toBe('車行');
    expect(cell(rows, 0, '發票')).toBe('已開立');
  });
});

describe('🔴🔴 fail-closed:資料是半份的時候不給匯出', () => {
  it('沒有截斷 ⇒ 放行(回 null)', () => {
    expect(orderExportBlockedReason([order(), order({ id: 'ord-2' })])).toBeNull();
    expect(orderExportBlockedReason([])).toBeNull();
  });

  it('🔴 有截斷 ⇒ 擋下,而理由裡要有【是哪幾張單】', () => {
    const reason = orderExportBlockedReason([
      order(),
      order({ id: 'ord-2', displayId: 'PCM-0002', itemsTruncated: true }),
    ]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('PCM-0002');
    expect(reason).toContain('1');
    // 沒被截斷的那張不該被點名 —— 否則員工會去翻一張沒問題的單。
    expect(reason).not.toContain('PCM-0001');
  });
});

describe('CSV 逃脫:壞掉的話整份檔會安靜地少列', () => {
  it('逗號 / 雙引號 / 換行都要被包起來,格內引號變兩個', () => {
    const csv = toCsv(['a', 'b', 'c'], [['純文字', '含,逗號', '含"引號']]);
    expect(csv).toContain('純文字,"含,逗號","含""引號"');
    const nl = toCsv(['a'], [['第一行\n第二行']]);
    expect(nl).toContain('"第一行\n第二行"');
  });

  it('負對照:不含特殊字元的格【不會】被加引號(證上面那條不是無條件包)', () => {
    const csv = toCsv(['a'], [['乾淨']]);
    expect(csv).toContain('\r\n乾淨\r\n');
    expect(csv).not.toContain('"乾淨"');
  });

  it('🔴 BOM 在最前面(沒有它,Excel 開中文是亂碼),換行是 CRLF', () => {
    const csv = buildOrderExportCsv([order()]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('\r\n');
    // 表頭逐字,不從常數回推 —— 回推的話常數打錯字這格照樣綠。
    expect(csv).toContain(
      '單號,日期,車種,廠牌,料號,物品名稱,數量,單價,小計(每列都有),"訂單總額(每單只出現一次,可直接加總)",客戶,會員等級,狀態,發票',
    );
  });

  it('空清單 ⇒ 只有表頭(不是空檔:員工要看得出「這一頁沒有東西」而不是「匯出壞了」)', () => {
    const csv = buildOrderExportCsv([]);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('檔名', () => {
  it('帶日期,而時鐘是注入的(不吃真時鐘 ⇒ 這一格不會在半夜自己變色)', () => {
    expect(orderExportFilename(new Date(2026, 7, 25))).toBe('訂單商品-20260825.csv');
    expect(orderExportFilename(new Date(2026, 0, 3))).toBe('訂單商品-20260103.csv');
  });
});
