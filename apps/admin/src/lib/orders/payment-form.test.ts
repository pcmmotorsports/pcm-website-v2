import { describe, expect, it } from 'vitest';
import {
  PAY_AMOUNT_FIELD,
  PAY_CASH_RECEIVED_AT_FIELD,
  PAY_BANK_REFERENCE_FIELD,
  PAY_ORDER_ID_FIELD,
  PAY_PAYER_NOTE_FIELD,
  PAY_RAIL_FIELD,
  PAY_RECEIVED_DATE_FIELD,
  PAY_REQUEST_ID_FIELD,
} from './payment-action-state';
import {
  buildReceivedAt,
  carryBackPaymentValues,
  INT4_MAX,
  missingPaymentFieldLabels,
  mintPaymentFormStamp,
  PAYMENT_FIELD_LABELS,
  parsePaymentForm,
  PAYMENT_SINGLE_FIELDS,
} from './payment-form';
// 🔴 片2a minor7 起 `paymentStampFields` 搬到 client-safe 的 `payment-action-state.ts`
//    (表單是 client 元件,從 `payment-form` 拿展開器等於把鑄章函式一起拉進 client 可達範圍)。
//    本格仍留在這裡:它驗的是**展開器與解析器欄位名同一份字面**,那是 `payment-form` 這側的契約。
import { paymentStampFields } from './payment-action-state';

// payment-form.test.ts — #15-B2-b 表單解析(server 端)。
//
// 🔴 本檔守兩件事:①**偽造 payload 擋得住**(UI 約束不是 server 保證,codex must-fix #2)
//                  ②**int4 上限自己擋**(超界會在進函式前 cast 爆、落在 RPC 碼表外,must-fix #7)。

const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const REQUEST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
/** 鑄表單那一刻 server 蓋的章(與 request_id 同生命週期)。 */
const MINTED_AT = '2026-08-11T06:30:00.000Z';

function form(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const one of Array.isArray(v) ? v : [v]) f.append(k, one);
  }
  return f;
}

function bankForm(over: Record<string, string | string[]> = {}): FormData {
  return form({
    [PAY_ORDER_ID_FIELD]: ORDER_ID,
    [PAY_REQUEST_ID_FIELD]: REQUEST_ID,
    [PAY_RAIL_FIELD]: 'bank_transfer',
    [PAY_AMOUNT_FIELD]: '1180',
    [PAY_RECEIVED_DATE_FIELD]: '2026-08-11',
    [PAY_CASH_RECEIVED_AT_FIELD]: MINTED_AT,
    [PAY_BANK_REFERENCE_FIELD]: '國泰 12345',
    [PAY_PAYER_NOTE_FIELD]: '',
    ...over,
  });
}

function cashForm(over: Record<string, string | string[]> = {}): FormData {
  return form({
    [PAY_ORDER_ID_FIELD]: ORDER_ID,
    [PAY_REQUEST_ID_FIELD]: REQUEST_ID,
    [PAY_RAIL_FIELD]: 'cash',
    [PAY_AMOUNT_FIELD]: '500',
    [PAY_RECEIVED_DATE_FIELD]: '',
    [PAY_CASH_RECEIVED_AT_FIELD]: MINTED_AT,
    [PAY_BANK_REFERENCE_FIELD]: '',
    [PAY_PAYER_NOTE_FIELD]: '客人現場付',
    ...over,
  });
}

describe('正常兩軌', () => {
  it('匯款軌:日期、單號、備註都收', () => {
    expect(parsePaymentForm(bankForm({ [PAY_PAYER_NOTE_FIELD]: '尾款' }))).toEqual({
      rail: 'bank_transfer',
      orderId: ORDER_ID,
      amount: 1180,
      receivedDate: '2026-08-11',
      bankReference: '國泰 12345',
      payerNote: '尾款',
      requestId: REQUEST_ID,
    });
  });

  it('現金軌:沒有日期欄、單號恆 null', () => {
    expect(parsePaymentForm(cashForm())).toEqual({
      rail: 'cash',
      orderId: ORDER_ID,
      amount: 500,
      bankReference: null,
      cashReceivedAt: MINTED_AT,
      payerNote: '客人現場付',
      requestId: REQUEST_ID,
    });
  });

  it('空白的選填欄 ⇒ null(與 RPC 的 btrim 正規化同一個立場)', () => {
    const parsed = parsePaymentForm(bankForm({ [PAY_PAYER_NOTE_FIELD]: '   ' }));
    expect(parsed?.payerNote).toBeNull();
  });

  // 🔴 關卡2 codex MF2:匯款軌沒單號 ⇒ RPC 是**無 ERRCODE 的通用 RAISE**(`:181-183`)
  //    ⇒ 放它過去只會得到含糊的「這張單現在不能登錄收款」,員工看不出是漏填單號。
  it.each(['', '   '])('🔴 匯款軌單號空白(%s)⇒ 當場拒,不讓它到 RPC', (raw) => {
    expect(parsePaymentForm(bankForm({ [PAY_BANK_REFERENCE_FIELD]: raw }))).toBeNull();
  });
});

describe('🔴 偽造 payload(FormData 可以偽造,UI 約束在這裡不算數)', () => {
  it('現金軌帶單號 ⇒ 拒(不是靜默丟掉)', () => {
    expect(parsePaymentForm(cashForm({ [PAY_BANK_REFERENCE_FIELD]: '國泰 999' }))).toBeNull();
  });

  // 🔴 現金軌的日期**刻意忽略而不是拒**:員工裝置的時鐘本來就不該有發言權,
  //    忽略比拒收安全(拒收會讓一個無害的多餘欄位變成阻斷)。
  it('現金軌帶日期 ⇒ 忽略、照常解析(時點由 server 產生)', () => {
    const parsed = parsePaymentForm(cashForm({ [PAY_RECEIVED_DATE_FIELD]: '1999-01-01' }));
    expect(parsed).not.toBeNull();
    expect(parsed && 'receivedDate' in parsed).toBe(false);
  });

  it('amount 送兩份 ⇒ 拒', () => {
    expect(parsePaymentForm(bankForm({ [PAY_AMOUNT_FIELD]: ['100', '200'] }))).toBeNull();
  });

  // 🔴🔴 關卡2 codex MF4:上面那格**證不了入口擋門有效** ——
  //    拿掉 `anyMalformed` 之後,重複的 amount 會被收斂成 '' 而由 `toAmount` 擋下 ⇒ 照樣綠。
  //    下面這兩格挑的是「**收斂成空字串之後就變成合法輸入**」的欄位:
  //    備註送兩份會變成「沒填備註」、單號送兩份在現金軌會變成「沒填單號」⇒ 靜默放行。
  //    ⇒ 只有入口擋門擋得住,拿掉它這兩格才會紅。
  it('🔴 payer_note 送兩份 ⇒ 拒(拿掉入口擋門會靜默變成「沒填備註」)', () => {
    expect(parsePaymentForm(bankForm({ [PAY_PAYER_NOTE_FIELD]: ['a', 'b'] }))).toBeNull();
  });

  it('🔴 現金軌 bank_reference 送兩份 ⇒ 拒(拿掉入口擋門會靜默變成「沒填單號」而放行)', () => {
    expect(parsePaymentForm(cashForm({ [PAY_BANK_REFERENCE_FIELD]: ['x', 'y'] }))).toBeNull();
  });

  it('rail 不是那兩個字面 ⇒ 拒(含 card:它讀得到、但本表單做不出來)', () => {
    expect(parsePaymentForm(bankForm({ [PAY_RAIL_FIELD]: 'card' }))).toBeNull();
    expect(parsePaymentForm(bankForm({ [PAY_RAIL_FIELD]: 'BANK_TRANSFER' }))).toBeNull();
  });

  it('request_id / order_id 不是 canonical uuid ⇒ 拒(RPC 的參數型別就是 uuid)', () => {
    expect(parsePaymentForm(bankForm({ [PAY_REQUEST_ID_FIELD]: 'not-a-uuid' }))).toBeNull();
    expect(parsePaymentForm(bankForm({ [PAY_REQUEST_ID_FIELD]: REQUEST_ID.toUpperCase() }))).toBeNull();
    expect(parsePaymentForm(bankForm({ [PAY_ORDER_ID_FIELD]: '123' }))).toBeNull();
  });

  it('🔴 解析器讀的欄位清單與入口擋門吃的是同一份(手寫清單比對,漏列一欄無症狀)', () => {
    expect([...PAYMENT_SINGLE_FIELDS]).toEqual([
      'order_id',
      'rail',
      'amount',
      'received_date',
      'cash_received_at',
      'bank_reference',
      'payer_note',
      'request_id',
    ]);
  });
});

describe('🔴 金額:只收十進位整數字串,且自己擋 int4 上限', () => {
  it.each(['0', '1', String(INT4_MAX)])('%s ⇒ 收(範圍是 RPC 的權威,本層只管形狀)', (raw) => {
    const parsed = parsePaymentForm(bankForm({ [PAY_AMOUNT_FIELD]: raw }));
    expect(parsed?.amount).toBe(Number(raw));
  });

  // 🔴 2147483648 是 int4 上限 +1:它會在**進函式之前** cast 爆,
  //    SQLSTATE 落在 RPC 碼表外面 ⇒ 映射成「可能已經寫進去了」= 對員工說假話。
  it('🔴 int4 上限 +1 ⇒ 拒(這一格是 must-fix #7 的本體)', () => {
    expect(parsePaymentForm(bankForm({ [PAY_AMOUNT_FIELD]: String(INT4_MAX + 1) }))).toBeNull();
  });

  it.each(['1180.0', '1,180', '1e3', ' 1180', '+1180', '-1180', '', 'abc', '０'])(
    '%s ⇒ 拒(禁 parseFloat、禁指數、禁千分位、禁全形)',
    (raw) => {
      expect(parsePaymentForm(bankForm({ [PAY_AMOUNT_FIELD]: raw }))).toBeNull();
    },
  );
});

describe('🔴 匯款日期必須是真的存在的日期', () => {
  it.each(['2026-02-31', '2026-13-01', '2026-08-1', '20260811', ''])('%s ⇒ 拒', (raw) => {
    expect(parsePaymentForm(bankForm({ [PAY_RECEIVED_DATE_FIELD]: raw }))).toBeNull();
  });

  // 🔴 為什麼不讓它進 RPC:`2026-02-31` 會噴 22007,那個碼不在映射表裡 ⇒ fail-closed 成
  //    `'error'`,而 `'error'` 的文案是「可能已經寫進去了」—— 對一筆根本沒送成的收款說假話。
  it('閏年 2028-02-29 是真的 ⇒ 收', () => {
    const parsed = parsePaymentForm(bankForm({ [PAY_RECEIVED_DATE_FIELD]: '2028-02-29' }));
    expect(parsed?.rail === 'bank_transfer' && parsed.receivedDate).toBe('2028-02-29');
  });
});

describe('🔴 received_at 的構造(兩軌不同,而且都不碰裝置時區)', () => {
  const NOW = new Date('2026-08-11T06:30:00.000Z'); // = 台北 14:30

  it('匯款 ⇒ 該日的台北 00:00(RPC 的下限對匯款軌比的是**台北曆日**)', () => {
    const parsed = parsePaymentForm(bankForm({ [PAY_RECEIVED_DATE_FIELD]: '2026-08-11' }))!;
    expect(buildReceivedAt(parsed)).toBe('2026-08-11T00:00:00+08:00');
  });

  // 🔴 這一格是 Fable R3 #1 那條交叉洞的迴歸鎖:若匯款軌送的是「當下時點」而不是台北 00:00,
  //    「今天下午成立、客人立刻轉帳當日入帳」= 台灣最常見的情境會被 G7 恆拒。
  it('🔴 匯款軌送的值必須 ≤ 當日任何時刻 ⇒ 當日成立的單也收得下', () => {
    const parsed = parsePaymentForm(bankForm({ [PAY_RECEIVED_DATE_FIELD]: '2026-08-11' }))!;
    const sent = Date.parse(buildReceivedAt(parsed));
    expect(sent).toBeLessThan(Date.parse('2026-08-11T00:00:01+08:00'));
    expect(sent).toBeLessThan(NOW.getTime());
  });

  it('現金 ⇒ 用表單上蓋的章,**與 client 送的日期欄無關**', () => {
    const parsed = parsePaymentForm(cashForm({ [PAY_RECEIVED_DATE_FIELD]: '1999-01-01' }))!;
    expect(buildReceivedAt(parsed)).toBe(MINTED_AT);
  });

  // 🔴🔴 關卡2 codex MF1 的迴歸鎖:同一份表單(= 同一把 request_id)重送**必須**得到同一個時點。
  //    若這裡改回「每次呼叫讀時鐘」,首送已 commit、回應掉了的那次重送會因為 G8 逐欄比對
  //    (`20260810200000:271-283`)對不上而回通用 RAISE ⇒ 員工看到失敗,錢卻已經在帳上。
  it('🔴 同一份表單重送 ⇒ received_at 逐字相同(冪等重放的前提)', () => {
    const f = cashForm();
    const first = buildReceivedAt(parsePaymentForm(f)!);
    const second = buildReceivedAt(parsePaymentForm(cashForm())!);
    expect(first).toBe(second);
    expect(first).toBe(MINTED_AT);
    // 這個函式**不讀時鐘**:換一個「現在」也不會改變結果(它根本沒有時鐘參數可傳)。
    expect(NOW.toISOString()).not.toBe('');
  });

  it.each(['', '2026-08-11T14:30:00', '2026-08-11', 'now', '2026-13-01T00:00:00Z'])(
    '🔴 現金軌的章不是「帶偏移且解析得出來的 ISO」(%s)⇒ 拒',
    (raw) => {
      expect(parsePaymentForm(cashForm({ [PAY_CASH_RECEIVED_AT_FIELD]: raw }))).toBeNull();
    },
  );
});

describe('🔴 印章:兩軌都要在、壞掉不准帶回(窄 R3 must-fix)', () => {
  it.each([
    ['', '缺章'],
    ['2026-08-11T14:30:00', '沒有偏移'],
    ['not-a-time', '根本不是時間'],
  ])('匯款軌的印章 %s(%s)⇒ 整份表單拒收', (raw) => {
    expect(parsePaymentForm(bankForm({ [PAY_CASH_RECEIVED_AT_FIELD]: raw }))).toBeNull();
  });

  // 🔴 這是那條 must-fix 的本體:`invalid` 路徑的 payload 依定義是壞的,
  //    帶回一個壞印章 ⇒ B2-c 依「兩者皆空才重鑄」永遠不重鑄 ⇒ 表單怎麼按都失敗、鎖死。
  it.each<[Record<string, string>, string]>([
    [{ [PAY_REQUEST_ID_FIELD]: 'not-a-uuid' }, '鍵不是 uuid'],
    [{ [PAY_CASH_RECEIVED_AT_FIELD]: 'garbage' }, '時點不合法'],
    [{ [PAY_REQUEST_ID_FIELD]: '' }, '鍵是空的'],
    [{ [PAY_CASH_RECEIVED_AT_FIELD]: '' }, '時點是空的'],
  ])('印章壞掉(%o:%s)⇒ 帶回時**兩格一起清空**,讓 B2-c 重鑄', (over) => {
    const values = carryBackPaymentValues(bankForm(over));
    expect(values.requestId).toBe('');
    expect(values.cashReceivedAt).toBe('');
  });

  it('印章完整合法 ⇒ 原樣沿用(對照組,證明上一格不是「一律清空」)', () => {
    const values = carryBackPaymentValues(bankForm());
    expect(values.requestId).toBe(REQUEST_ID);
    expect(values.cashReceivedAt).toBe(MINTED_AT);
  });
});

describe('失敗帶回', () => {
  // 🔴 R2 MF2 之後這裡是**七個欄位**:五個可見欄 + 印章兩格。
  //    印章不帶回的話,失敗路徑 revalidate ⇒ 表單重渲染 ⇒ 下一次送出是新的一把鍵
  //    ⇒ 對 RPC 的 G8 是全新的一次 ⇒ 多一筆刪不掉的收款。
  it('原樣帶回五個可見欄 + 印章兩格(不帶回 =「保留輸入」與「沿用同一把鍵」都是空宣稱)', () => {
    expect(
      carryBackPaymentValues(
        cashForm({ [PAY_PAYER_NOTE_FIELD]: '週五匯', [PAY_BANK_REFERENCE_FIELD]: '' }),
      ),
    ).toEqual({
      rail: 'cash',
      amount: '500',
      receivedDate: '',
      bankReference: '',
      payerNote: '週五匯',
      requestId: REQUEST_ID,
      cashReceivedAt: MINTED_AT,
    });
  });
});

describe('🔴 鑄印章:lockstep 做成機制,不是口頭約定(opus R2 MF3)', () => {
  it('一次回兩個值(B2-c 物理上鑄不出「只換一半」)', () => {
    const stamp = mintPaymentFormStamp(new Date('2026-08-11T06:30:00.000Z'));
    expect(Object.keys(stamp).sort()).toEqual(['cashReceivedAt', 'requestId']);
    expect(stamp.cashReceivedAt).toBe('2026-08-11T06:30:00.000Z');
  });

  // 🔴 這一格守的是**接縫**:鑄出來的東西如果過不了我自己的解析器,
  //    B2-c 會在真站上得到一句莫名其妙的「表單內容不正確」,而兩邊各自的測試都是綠的。
  it('🔴 鑄出來的兩個值都通得過本檔的解析器(接縫要真的接得上)', () => {
    const stamp = mintPaymentFormStamp(new Date('2026-08-11T06:30:00.000Z'));
    const parsed = parsePaymentForm(
      cashForm({
        [PAY_REQUEST_ID_FIELD]: stamp.requestId,
        [PAY_CASH_RECEIVED_AT_FIELD]: stamp.cashReceivedAt,
      }),
    );
    expect(parsed?.rail).toBe('cash');
    expect(parsed && 'cashReceivedAt' in parsed && parsed.cashReceivedAt).toBe(stamp.cashReceivedAt);
    expect(parsed?.requestId).toBe(stamp.requestId);
  });

  it('每次鑄的 requestId 不同(它是一次性的鍵,不是常數)', () => {
    const a = mintPaymentFormStamp(new Date('2026-08-11T06:30:00.000Z'));
    const b = mintPaymentFormStamp(new Date('2026-08-11T06:30:00.000Z'));
    expect(a.requestId).not.toBe(b.requestId);
  });
});

describe('印章成組展開(窄確認輪 MF3:降級宣稱之後留下的那一半)', () => {
  it('回的是兩格 hidden input 的資料,欄位名與解析器讀的一致', () => {
    const stamp = mintPaymentFormStamp(new Date('2026-08-11T06:30:00.000Z'));
    const fields = paymentStampFields(stamp);
    expect(fields.map((f) => f.name)).toEqual(['request_id', 'cash_received_at']);
    expect(fields.map((f) => f.value)).toEqual([stamp.requestId, stamp.cashReceivedAt]);
    // 🔴 欄位名要與 `PAYMENT_SINGLE_FIELDS` 是同一份字面 —— 不然 B2-c 放進去的東西解析器讀不到,
    //    症狀是「表單內容不正確」而兩邊各自的測試都綠。
    for (const f of fields) {
      expect([...PAYMENT_SINGLE_FIELDS]).toContain(f.name);
    }
  });
});


describe('⟦b4-DEADENDMSG1⟧ missingPaymentFieldLabels —— 「它說了, 而它說對你為什麼被擋嗎」', () => {
  const L = PAYMENT_FIELD_LABELS;

  /**
   * 🔴🔴 **這一格是整組的承重:兩份規則不准漂。**
   * 本函式與 `parsePaymentForm` 是**兩個函式**, 而它們對同一組輸入必須同意:
   * 列得出某一欄 ⇒ 解析必須是 `null`;一欄都列不出而輸入是好的 ⇒ 解析必須成功。
   * 🛑 少了這一格, 兩邊哪天漂了會**安靜地**變成「畫面說缺這欄, 而伺服器其實收得下」。
   */
  it.each([
    ['缺金額', { [PAY_AMOUNT_FIELD]: '' }, [L.amount]],
    ['金額打了逗號', { [PAY_AMOUNT_FIELD]: '1,180' }, [L.amount]],
    ['缺銀行入帳日', { [PAY_RECEIVED_DATE_FIELD]: '' }, [L.receivedDate]],
    ['缺銀行單號', { [PAY_BANK_REFERENCE_FIELD]: '' }, [L.bankReference]],
    ['缺兩欄', { [PAY_RECEIVED_DATE_FIELD]: '', [PAY_BANK_REFERENCE_FIELD]: '' },
      [L.receivedDate, L.bankReference]],
    ['三欄都缺', { [PAY_AMOUNT_FIELD]: '', [PAY_RECEIVED_DATE_FIELD]: '', [PAY_BANK_REFERENCE_FIELD]: '' },
      [L.amount, L.receivedDate, L.bankReference]],
  ])('🔴 匯款軌 %s ⇒ 逐欄列出, 而 parse 同時是 null', (_n, over, want) => {
    const f = bankForm(over);
    expect(missingPaymentFieldLabels(f)).toEqual(want);
    // 🔴 承重:少了這一行, 一份「列了欄位而伺服器其實收得下」的實作照樣通過上一行。
    expect(parsePaymentForm(f), '列得出缺欄, 而解析卻成功 ⇒ 兩份規則漂了').toBeNull();
  });

  it('🟢 負對照:全部填對 ⇒ 一欄都不列, 而 parse 成功', () => {
    const f = bankForm();
    expect(missingPaymentFieldLabels(f), '沒有東西缺卻列了欄 ⇒ 退化成「總是列出必填欄」').toEqual([]);
    expect(parsePaymentForm(f)).not.toBeNull();
  });

  it('🟢 負對照:現金軌填對 ⇒ 一欄都不列(那兩欄在現金軌【不存在】)', () => {
    const f = cashForm();
    expect(missingPaymentFieldLabels(f)).toEqual([]);
    expect(parsePaymentForm(f)).not.toBeNull();
  });

  /**
   * 🔴🔴 **系統層的失敗【不給欄位名】** —— 這幾種都不是員工填錯:
   * 對它們說「哪一欄」等於編一個具體原因, 而他會去改一個沒有壞的欄位。
   */
  it.each([
    ['印章不是 ISO 時點', bankForm({ [PAY_CASH_RECEIVED_AT_FIELD]: 'not-a-time' })],
    ['request_id 不是 uuid', bankForm({ [PAY_REQUEST_ID_FIELD]: 'nope' })],
    ['rail 不是那兩個字面', bankForm({ [PAY_RAIL_FIELD]: 'zz_no_such_rail' })],
    // 🔴🔴 **這一格是突變逼出來的**:上面那格的金額是好的 ⇒ 拿不拿掉 `isRail` 那道擋門
    //    都回空陣列 ⇒ **它對那道擋門零判別力**(2026-09-04 實測:突變 ④ rc=0)。
    //    ⇒ 要分辨得出來, `rail` 壞掉的同時**金額也要是空的** ——
    //      沒有那道擋門 ⇒ 會列出「金額」, 而真正的問題是那個偽造的 rail。
    ['rail 壞掉【而且】金額也空著', bankForm({ [PAY_RAIL_FIELD]: 'zz_no_such_rail', [PAY_AMOUNT_FIELD]: '' })],
    // 🔴🔴 **下面這組是 codex 對抗審查(2026-09-04)抓到的 must-fix**:
    //    先前每一格都把「系統層壞掉」與「缺欄」**分開餵** ⇒ 那個交叉漏洞可以完整通過。
    //    ⇒ 📌 **一個把兩種原因分開測的測試組, 對「兩種同時發生」零判別力。**
    ['壞 order uuid + 缺金額',
      bankForm({ [PAY_ORDER_ID_FIELD]: 'not-a-uuid', [PAY_AMOUNT_FIELD]: '' })],
    ['壞 request uuid + 缺金額',
      bankForm({ [PAY_REQUEST_ID_FIELD]: 'not-a-uuid', [PAY_AMOUNT_FIELD]: '' })],
    ['壞印章 + 缺金額',
      bankForm({ [PAY_CASH_RECEIVED_AT_FIELD]: 'not-a-time', [PAY_AMOUNT_FIELD]: '' })],
    ['壞印章 + 缺兩個銀行欄',
      bankForm({ [PAY_CASH_RECEIVED_AT_FIELD]: 'not-a-time', [PAY_RECEIVED_DATE_FIELD]: '', [PAY_BANK_REFERENCE_FIELD]: '' })],
    ['現金軌帶單號(偽造)+ 缺金額',
      cashForm({ [PAY_BANK_REFERENCE_FIELD]: '國泰 1', [PAY_AMOUNT_FIELD]: '' })],
    ['同名欄送兩份 + 缺金額',
      bankForm({ [PAY_RECEIVED_DATE_FIELD]: ['2026-08-11', '2026-08-12'], [PAY_AMOUNT_FIELD]: '' })],
    // 🔵 codex R2 nit d:大寫 uuid 兩邊都不收(`UUID_RE` 不帶 `i`)——
    //    釘住它, 否則哪天只有一邊放寬, 這組測試仍然全綠而兩份規則已經漂了。
    // 🔴🔴 **用 `REQUEST_ID` 不用 `ORDER_ID`** —— `ORDER_ID` 逐字是 `11111111-2222-…`,
    //    **一個字母都沒有** ⇒ `.toUpperCase()` 對它是 **no-op** ⇒ 那個「大寫」世界
    //    **根本沒有被造出來**, 而測試會紅在一個與大寫無關的理由上(2026-09-04 實撞)。
    //    📌 **一個造不出目標世界的測試, 它的紅與綠都不是關於它宣稱的那件事。**
    ['大寫 canonical uuid + 缺金額',
      bankForm({ [PAY_REQUEST_ID_FIELD]: REQUEST_ID.toUpperCase(), [PAY_AMOUNT_FIELD]: '' })],
    ['同名欄送兩份', bankForm({ [PAY_AMOUNT_FIELD]: ['1180', '9999'] })],
    ['現金軌帶了單號(偽造 payload)', cashForm({ [PAY_BANK_REFERENCE_FIELD]: '國泰 1' })],
  ])('🔴 %s ⇒ 回空陣列(維持通用話), 而 parse 仍是 null', (_n, f) => {
    expect(missingPaymentFieldLabels(f), '對系統層的失敗編一個欄位名給員工').toEqual([]);
    expect(parsePaymentForm(f)).toBeNull();
  });

  /**
   * 🔴 標籤要與**畫面上那幾個** `AdminFormField label=` 逐字相同 ——
   * 不同的話, 訊息會指到一個他在畫面上**找不到**的欄位。
   */
  it('🔴 三個標籤與表單元件上的字面逐字相同', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../components/orders/payment-record-form.tsx', import.meta.url)),
      'utf8',
    );
    for (const label of [L.amount, L.receivedDate, L.bankReference]) {
      expect(src, `畫面上沒有 label='${label}' ⇒ 訊息會指到一個找不到的欄位`)
        .toContain(`label='${label}'`);
    }
    // 🟢 正對照:一個現造的標籤在那支檔裡找不到 ⇒ 這把尺不是恆真。
    expect(src).not.toContain("label='ZZ沒有這一欄QQ'");
  });
});
