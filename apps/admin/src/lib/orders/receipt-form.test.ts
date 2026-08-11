import { describe, expect, it } from 'vitest';
import {
  RCPT_NOTE_FIELD,
  RCPT_PROCUREMENT_ID_FIELD,
  RCPT_QUANTITY_FIELD,
  RCPT_RECEIVED_AT_LOCAL_FIELD,
  RCPT_REQUEST_ID_FIELD,
  RCPT_SURPLUS_FIELD,
  receiptFailure,
} from './receipt-action-state';
import { RECEIPT_SINGLE_FIELDS, carryBackReceiptValues, parseReceiptForm } from './receipt-form';

// #352-b:到貨登錄表單解析的守門測試。

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

const OK: [string, string][] = [
  [RCPT_PROCUREMENT_ID_FIELD, 'proc-1'],
  [RCPT_REQUEST_ID_FIELD, 'ab12'],
  [RCPT_RECEIVED_AT_LOCAL_FIELD, '2026-08-11T10:30'],
];

describe('parseReceiptForm', () => {
  it('一般情況:到貨 2 件、溢收留空當 0、備註原樣', () => {
    const parsed = parseReceiptForm(
      form([...OK, [RCPT_QUANTITY_FIELD, '2'], [RCPT_NOTE_FIELD, '外箱破損']]),
    );
    expect(parsed).toEqual({
      procurementId: 'proc-1',
      quantity: 2,
      surplusQuantity: 0,
      receivedAtLocal: '2026-08-11T10:30',
      note: '外箱破損',
      requestId: 'ab12',
    });
  });

  // 🔴 本片最重要的一格:`到貨 0 件 / 溢收 N 件` 是「這張單已收滿或已取消、但貨還是到了」
  //    的正式登記方式(a1 `20260810230000:82`)。把 `quantity` 當成必填正整數會讓那條路
  //    在表單層就死掉,而且症狀是沉默的 —— 員工只看到「件數不正確」。
  //    ⇒ 這一格紅了,代表 #386 那條出路又被關上了。
  it('到貨 0 件 + 溢收 3 件必須解析得出來(取消後到貨的唯一出路)', () => {
    const parsed = parseReceiptForm(
      form([...OK, [RCPT_QUANTITY_FIELD, '0'], [RCPT_SURPLUS_FIELD, '3']]),
    );
    expect(parsed?.quantity).toBe(0);
    expect(parsed?.surplusQuantity).toBe(3);
  });

  it('全空白備註收斂成 null(不製造「看起來有、其實沒有」的假資料)', () => {
    const parsed = parseReceiptForm(
      form([...OK, [RCPT_QUANTITY_FIELD, '1'], [RCPT_NOTE_FIELD, '   ']]),
    );
    expect(parsed?.note).toBeNull();
  });

  it.each([
    ['負數', '-1'],
    ['小數', '1.5'],
    ['非數字', 'abc'],
    ['全形數字', '１'],
  ])('件數是%s ⇒ 不成形', (_label, raw) => {
    expect(parseReceiptForm(form([...OK, [RCPT_QUANTITY_FIELD, raw]]))).toBeNull();
  });

  it.each([RCPT_PROCUREMENT_ID_FIELD, RCPT_REQUEST_ID_FIELD, RCPT_RECEIVED_AT_LOCAL_FIELD])(
    '缺 %s ⇒ 不成形(fail-closed)',
    (missing) => {
      const entries = OK.filter(([k]) => k !== missing);
      expect(parseReceiptForm(form([...entries, [RCPT_QUANTITY_FIELD, '1']]))).toBeNull();
    },
  );

  // 🔴🔴 R1 must-fix 2 的守門:**逐欄**證明「非恰一筆字串」會被入口擋下。
  //    上一版只餵 `request_id` 一欄卻把測項名寫成「同名欄位送兩份 ⇒ 一律當沒送」——
  //    那是過度宣稱:`request_id` 缺值本來就會被 `=== ''` 擋掉,而**真正的洞在 `quantity`**
  //    (空字串對它是合法輸入、依約回 0)⇒ 送兩份會被靜默寫成「到貨 0 件」而不是拒。
  //    ⚠️ 這裡刻意**手寫欄位清單**、不走訪 `RECEIPT_SINGLE_FIELDS` ——
  //    走訪同一顆常數的話,常數少一欄時測項也跟著少一條、全綠(single-value.ts 檔尾點名的循環論證)。
  const HAND_WRITTEN_SINGLE_FIELDS = [
    RCPT_PROCUREMENT_ID_FIELD,
    RCPT_REQUEST_ID_FIELD,
    RCPT_RECEIVED_AT_LOCAL_FIELD,
    RCPT_QUANTITY_FIELD,
    RCPT_SURPLUS_FIELD,
    RCPT_NOTE_FIELD,
  ];

  it('入口擋門的欄位清單沒有漏欄(手寫清單 vs 常數)', () => {
    expect([...RECEIPT_SINGLE_FIELDS].sort()).toEqual([...HAND_WRITTEN_SINGLE_FIELDS].sort());
  });

  // ⚠️ **append 兩次、不是一次**:`note` / `surplus` 不在 `OK` 裡,只 append 一次的話那一欄
  //    只有一筆值 = 根本沒構造出「送兩份」⇒ 這幾格會變成在測別的東西。
  //    (第一版就是這樣寫的,`note` 那格當場紅給我看 —— 它證明了自己不是恆真格。)
  it.each(HAND_WRITTEN_SINGLE_FIELDS)('%s 送兩份 ⇒ 拒(不是靜默當沒送)', (field) => {
    const fd = form([...OK, [RCPT_QUANTITY_FIELD, '1']]);
    fd.append(field, 'x');
    fd.append(field, 'y');
    expect(parseReceiptForm(fd)).toBeNull();
  });

  // 🔴 `File` 那條路:數量是 1、只數 length 的擋門會放行,而 readSingleString 一樣回 null。
  it('quantity 塞單一 File ⇒ 拒(只數 length 的擋門會漏掉這形狀)', () => {
    const fd = new FormData();
    for (const [k, v] of OK) fd.append(k, v);
    fd.append(RCPT_QUANTITY_FIELD, new File(['x'], 'x.txt'));
    expect(parseReceiptForm(fd)).toBeNull();
  });

  // 🔴 nit 10:冪等鍵要求 canonical 形狀(btrim 對它是 no-op)⇒ 查帳本用的鍵 = RPC 存的鍵。
  it.each([
    ['含空白', 'ab 12'],
    ['大寫', 'AB12'],
    ['前後空白', ' ab12 '],
    ['超過 200', 'a'.repeat(201)],
  ])('request_id %s ⇒ 拒', (_label, raw) => {
    const entries = OK.filter(([k]) => k !== RCPT_REQUEST_ID_FIELD);
    expect(
      parseReceiptForm(form([...entries, [RCPT_REQUEST_ID_FIELD, raw], [RCPT_QUANTITY_FIELD, '1']])),
    ).toBeNull();
  });
});

describe('carryBackReceiptValues', () => {
  it('原樣帶回員工打的四個欄位(不帶回 = 「保留輸入」是空宣稱)', () => {
    const values = carryBackReceiptValues(
      form([
        [RCPT_QUANTITY_FIELD, '9'],
        [RCPT_SURPLUS_FIELD, '2'],
        [RCPT_RECEIVED_AT_LOCAL_FIELD, '2026-08-11T10:30'],
        [RCPT_NOTE_FIELD, '備註'],
      ]),
    );
    expect(values).toEqual({
      quantity: '9',
      surplusQuantity: '2',
      receivedAtLocal: '2026-08-11T10:30',
      note: '備註',
    });
  });
});

describe('receiptFailure', () => {
  it('取消後到貨的訊息要講「到貨填 0、多的填溢收」,不是只說改走現貨入庫', () => {
    const state = receiptFailure('EXCEEDS_ROOM_AFTER_CANCELLATION', 'proc-1', {
      quantity: '',
      surplusQuantity: '',
      receivedAtLocal: '',
      note: '',
    });
    expect(state.status).toBe('failed');
    if (state.status !== 'failed') return;
    // 🔴 上一版第二條是 `toContain('0')` —— 近乎恆真(訊息裡隨便一個數字都可能含 0)。
    //    改成釘住這條訊息真正要傳達的動作:把「到貨幾件」改成 0。
    expect(state.message).toContain('溢收');
    expect(state.message).toContain('改成 0');
  });

  it('detail 接在基本訊息之後(拆分建議 / DB 的包裹清單原文)', () => {
    const state = receiptFailure(
      'QUANTITY_EXCEEDS_ALLOCATED',
      'proc-1',
      { quantity: '', surplusQuantity: '', receivedAtLocal: '', note: '' },
      '這筆採購還能登錄 3 件。',
    );
    if (state.status !== 'failed') throw new Error('應為 failed');
    expect(state.message).toContain('這筆採購還能登錄 3 件。');
  });
});
