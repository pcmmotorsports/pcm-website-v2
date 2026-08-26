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
    shippingAddress: { name: '收件人', phone: '0912345678', line: '台北市信義區 1 號' },
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


describe('🔴 `#24` 收件人三欄(Sean 2026-08-26 要求「放在最後一欄」)', () => {
  it('三欄在最後, 而順序是姓名/電話/地址', () => {
    const tail = ORDER_EXPORT_COLUMNS.slice(-3);
    expect(tail[0]).toContain('收件人姓名');
    expect(tail[1]).toContain('收件人電話');
    expect(tail[2]).toContain('收件地址');
    // 負對照:證它們【真的在最後】—— 前面那一段不該含這三個
    expect(ORDER_EXPORT_COLUMNS.slice(0, -3).join(',')).not.toContain('收件人');
  });

  it('🔴 欄名【不描述用法】—— 只寫它是什麼', () => {
    /* `#24` 片B 踩過:「訂單總額(每單只出現一次,**可直接加總**)」的「可直接加總」
       在會計於 Excel 篩選/隱藏列之後就不成立。
       📌 **一句比實際成立範圍更大的話, 比不寫更危險** —— 沒寫他會小心, 寫了他不會。
       ⇒ 本格釘住這三欄不得出現「可以拿來做什麼」那類字眼。 */
    for (const col of ORDER_EXPORT_COLUMNS.slice(-3)) {
      expect(col).not.toContain('可直接');
      expect(col).not.toContain('可以');
      expect(col).toContain('每單只有一個');
    }
    /* 正對照:證這把尺會回「是」。
       🔴 **用測試自造的字串, 不要拿現有欄名當正對照** ——
          第一版我釘的是既有那欄的「可直接加總」, 而**這一片自己正在宣告那句話有害**
          ⇒ 哪天有人照本片的道理去修那個欄名, 這一格會紅, 把他勸回去。
          **一個對的修法被自己立的守門擋下來, 而紅的理由看起來完全正當。**(審查 finding #12) */
    expect('收件人姓名(可直接寄信)').toContain('可直接');
    expect('收件人姓名(每單只有一個)').not.toContain('可直接');
  });

  it('值取自收件人快照, 而缺值印 —(不是空白也不是 undefined)', () => {
    const rows = buildOrderExportRows([
      order({ shippingAddress: { name: '王大明', phone: '0987654321', line: '高雄市三民區 9 號' } }),
    ]);
    expect(cell(rows, 0, '收件人姓名(每單只有一個)')).toBe('王大明');
    expect(cell(rows, 0, '收件人電話(每單只有一個)')).toBe('0987654321');
    expect(cell(rows, 0, '收件地址(每單只有一個)')).toBe('高雄市三民區 9 號');

    const missing = buildOrderExportRows([
      order({ shippingAddress: { name: null, phone: null, line: null } }),
    ]);
    expect(cell(missing, 0, '收件人姓名(每單只有一個)')).toBe('—');
    expect(cell(missing, 0, '收件人電話(每單只有一個)')).toBe('—');
  });

  it('🔴 續列【重複】收件人 —— 而它與「訂單總額」刻意不同', () => {
    const rows = buildOrderExportRows([
      order({
        lines: [line({ id: 'a' }), line({ id: 'b' })],
        shippingAddress: { name: '王大明', phone: '0987654321', line: '高雄市三民區 9 號' },
      }),
    ]);
    /* 收件人重複:CSV 會被排序, 而排序把第一列與續列拆開 ⇒ 留空的話續列不知道要寄給誰。
       而「訂單總額」留空是為了 SUM 不重複算 —— 這三欄不是數字, 重複它不會讓加總出錯。 */
    expect(cell(rows, 1, '收件人姓名(每單只有一個)')).toBe('王大明');
    // 對照:同一發裡「訂單總額」的續列仍然是空的(證兩條規則並存, 我沒有把它一起改掉)
    expect(cell(rows, 1, '訂單總額(每單只出現一次,可直接加總)')).toBe('');
  });
});

describe('🔴 CSV 公式注入(2026-08-26 審查 finding #8)', () => {
  /* 試算表看到 `=` `+` `-` `@` 開頭就把那格當公式跑。而地址/電話是客人自己打的,
     這份檔的用途又正好是「用 Excel 開起來對帳」⇒ 客人打的字會在會計的機器上執行。 */
  it('危險前綴的格被加上單引號逃脫', () => {
    /* ⚠️ 逃脫發生在 `toCsv` 裡, **不在** `buildOrderExportRows` ——
       `cell()` 拿到的是【逃脫前】的原值。第一版我在這裡用了 `cell()` 而它紅了,
       📌 那個紅是對的:**尺量錯層, 與碼真的沒修, 印出來的字一模一樣。** */
    for (const bad of ['=1+1', '+886912345678', '-危險', '@SUM(A1)']) {
      const rows = buildOrderExportRows([
        order({ shippingAddress: { name: bad, phone: null, line: null } }),
      ]);
      expect(toCsv([...ORDER_EXPORT_COLUMNS], rows)).toContain(`'${bad}`);
    }
  });

  it('🔴 負對照:乾淨的值【不】被動到 —— 否則每一格都會多一個引號', () => {
    const csv = toCsv(
      [...ORDER_EXPORT_COLUMNS],
      buildOrderExportRows([
        order({ shippingAddress: { name: '王大明', phone: '0912345678', line: '台北市 1 號' } }),
      ]),
    );
    expect(csv).toContain('王大明');
    expect(csv).not.toContain(`'王大明`);
    expect(csv).not.toContain(`'0912345678`);
  });

  it('🔴 修在共用的 escapeCell ⇒ 舊欄位也一起被保護(不是只擋新三欄)', () => {
    /* 只擋新欄的話, `客戶` / `物品名稱` 仍然開著 —— 而下一個人會以為已經修過。 */
    const rows = buildOrderExportRows([order({ customerName: '=cmd|calc' })]);
    expect(toCsv([...ORDER_EXPORT_COLUMNS], rows)).toContain("'=cmd|calc");
  });

  it('逃脫與引號包裝【疊加】—— 危險前綴 + 逗號同時出現', () => {
    const rows = buildOrderExportRows([
      order({ shippingAddress: { name: null, phone: null, line: '=A1,B2' } }),
    ]);
    /* 先加單引號 ⇒ 再因為含逗號整格包引號。這一格要看**逃脫後**的字面,
       而 `cell()` 回的是逃脫前的原值 ⇒ 直接對整份 CSV 斷言。 */
    const csv = toCsv([...ORDER_EXPORT_COLUMNS], rows);
    expect(csv).toContain(`"'=A1,B2"`);
    // 負對照:證這把尺會回「不是」—— 沒逃脫的話長這樣, 而它不該出現
    expect(csv).not.toContain(',=A1,B2,');
  });
});
