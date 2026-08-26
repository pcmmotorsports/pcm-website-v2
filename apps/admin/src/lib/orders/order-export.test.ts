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

describe('🔴 品項是空陣列的單(2026-08-27 補審 must-fix 的同族 nit)', () => {
  // 🔴 **修之前:那張單【整筆從 CSV 消失】, 連訂單總額一起** —— 而檔案上零訊號。
  //    `orderExportBlockedReason` 攔不到(它只看 `itemsTruncated`)⇒ 對帳的人 SUM 少一筆。
  // ⇒ 現在印一列出來, 品項欄全部 `—`, 訂單層的欄位照填。
  // ⚠️ **測試名稱與斷言要一致**(2026-08-27 codex nit):上一版叫「品項全 `—`」而只驗了料號一欄,
  //    且總額只驗 `not.toBe('')` —— 那讓 `0` 與 `—` 都算過。**名字承諾的比斷言做的多。**
  it('不會整筆消失:印一列, 料號欄寫「本單無品項」, 其餘品項欄全 `—`, 訂單總額逐字保真', () => {
    const o = order({ displayId: 'PCM-EMPTY', lines: [] });
    const rows = buildOrderExportRows([o]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row[0]).toBe('PCM-EMPTY');

    const idx = (needle: string) => {
      const i = ORDER_EXPORT_COLUMNS.findIndex((c) => c.includes(needle));
      expect(i, `欄位 ${needle} 不在 ORDER_EXPORT_COLUMNS 裡 —— 這一格失去意義`).toBeGreaterThanOrEqual(0);
      return i;
    };

    // ① 訂單總額**逐字等於**那張單的金額(不是「非空」)⇒ 被輸出成 0 或 — 都會紅。
    expect(row[idx('訂單總額')]).toBe(String(o.total.amount));

    // ② 料號欄是那句人話 —— 它與「料號是空的」必須分得開。
    expect(row[idx('料號')]).toBe('(本單無品項)');

    // ③ 其餘每一個品項欄都是 `—`(逐欄檢, 不是只挑一欄)。
    for (const name of ['車種', '廠牌', '物品名稱', '數量', '單價', '小計']) {
      expect(row[idx(name)], `品項欄 ${name} 應為 —`).toBe('—');
    }
  });

  // 🔴 正對照:有品項的單不受影響(否則上面那格可能是「所有單都只印一列」)。
  it('正對照:有兩個品項的單仍然印兩列', () => {
    const rows = buildOrderExportRows([order({ lines: [line({ id: 'a' }), line({ id: 'b' })] })]);
    expect(rows).toHaveLength(2);
  });
});

describe('檔名', () => {
  it('帶日期,而時鐘是注入的(不吃真時鐘 ⇒ 這一格不會在半夜自己變色)', () => {
    expect(orderExportFilename(new Date(2026, 7, 25))).toBe('訂單商品-20260825.csv');
    expect(orderExportFilename(new Date(2026, 0, 3))).toBe('訂單商品-20260103.csv');
  });

  // 🔴 **日期走 Asia/Taipei 曆面, 不走機器本機時區**(2026-08-27 `#24` 補審 must-fix)。
  //
  // 🔴🔴 **這一格【在這台機器上預設是恆真的】, 所以它必須自己造出另一個世界:**
  //    `Intl.DateTimeFormat().resolvedOptions().timeZone` ⇒ `Asia/Taipei`(2026-08-27 量)
  //    ⇒ 本機時區與台北**同一個** ⇒ 不改 TZ 的話,`getDate()` 與台北曆面永遠一致,
  //      **舊的本機時區寫法在這裡怎麼測都綠。** 這正是它活到現在的原因。
  //    ⇒ 所以本格把 `process.env.TZ` 切成 `UTC` 再測 —— 那是 Vercel node 的預設。
  //
  // ⚠️ **而「我以為我切了時區」與「真的切了」是兩個宣稱** ⇒ 下面第一發是**量具自檢**:
  //    先確認在這個 process 裡 TZ 真的生效了(`getDate()` 真的變成 UTC 那一天),
  //    自檢不過就直接紅在自檢那一行,**不會讓主斷言無聲地通過**。
  it('🔴 檔名日期是台北曆面, 不是機器時區(server TZ=UTC 時不得標成前一天)', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';

      // 台北 2026-08-27 07:00 = UTC 2026-08-26 23:00 ⇒ 兩個世界的「今天」不同一天。
      const instant = new Date('2026-08-26T23:00:00Z');

      // ① 量具自檢:TZ 真的切成 UTC 了嗎?(沒切成功 ⇒ 紅在這裡, 不是在主斷言)
      expect(instant.getDate()).toBe(26);
      // ② 負對照:舊寫法(本機時區)在這個世界會產出【哪一天】—— 證明兩個世界真的不同。
      const naive = `${instant.getFullYear()}${String(instant.getMonth() + 1).padStart(2, '0')}${String(
        instant.getDate(),
      ).padStart(2, '0')}`;
      expect(naive).toBe('20260826');

      // ③ 主斷言:實作必須給台北那一天。
      expect(orderExportFilename(instant)).toBe('訂單商品-20260827.csv');
    } finally {
      process.env.TZ = original;
    }
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
    /* ⚠️ ~~expect(csv).not.toContain(`'0912345678`)~~ —— **本行 2026-08-26 當天就過期了。**
       寫它的時候「乾淨的值」包含電話;而同一天稍後 codex 指出以 `0` 開頭的純數字
       會被試算表吃掉開頭的 0 ⇒ **電話從此【該】被加引號**。
       📌 這一格是這一片第三次撞到同一個形狀:
          **一個前提被改掉之後, 所有引用它的斷言在同一秒變假, 而它們一個都不知道。**
          前兩次隔了幾個月(migration COMMENT / spec 的死前提), 這次隔了 20 分鐘。
       ⇒ 電話的正確行為改由下面那個 describe 釘住。 */
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

describe('🔴 以 0 開頭的純數字會被試算表吃掉開頭的 0(2026-08-26 codex must-fix)', () => {
  /* 這與公式注入不是同一件事:`0912345678` 沒有任何危險字元,
     而 Excel 會把它當數字 ⇒ 變 `912345678`。**檔案本身沒有任何異常。** */
  it('電話被保護成文字', () => {
    const csv = toCsv(
      [...ORDER_EXPORT_COLUMNS],
      buildOrderExportRows([
        order({ shippingAddress: { name: null, phone: '0912345678', line: null } }),
      ]),
    );
    expect(csv).toContain(`'0912345678`);
  });

  it('🔴 負對照三發:不以 0 開頭 / 含非數字 / 空字串 —— 都【不】該被動到', () => {
    /* 沒有這三發的話,「每一格都加引號」與「只加對的那幾格」印同一個綠。 */
    for (const clean of ['912345678', '2026-08-26', '台北市 1 號']) {
      const csv = toCsv(
        [...ORDER_EXPORT_COLUMNS],
        buildOrderExportRows([
          order({ shippingAddress: { name: clean, phone: null, line: null } }),
        ]),
      );
      expect(csv).not.toContain(`'${clean}`);
      expect(csv).toContain(clean);
    }
  });
});
