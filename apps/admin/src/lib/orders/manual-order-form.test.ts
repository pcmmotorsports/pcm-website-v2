import { describe, expect, it } from 'vitest';
import {
  MANUAL_ORDER_MAX_LINES,
  MANUAL_ORDER_MAX_QTY,
  newManualRequestId,
  parseManualOrderForm,
  type ManualOrderFormLike,
} from './manual-order-form';

// manual-order-form.test.ts — `#858` M12-A2 前半的守門。
//
// 🔴 **本檔的欄位名是【手打的】,不是從 `manual-order-form.ts` import 的常數。**
//    理由逐字抄 `lib/forms/single-value.ts` 的能力邊界那段:拿同一顆常數去走訪,
//    常數少一欄時**測項也跟著少一條、全綠** —— 那是循環論證。
//    ⇒ 這裡手打一份,兩份不一致時**這裡紅**。
const FIELDS = {
  requestId: 'manual_request_id',
  customer: 'customer_user_id',
  source: 'order_source',
  channel: 'payment_channel',
  shipping: 'shipping_method',
  fee: 'shipping_fee',
  name: 'ship_to_name',
  phone: 'ship_to_phone',
  line: 'ship_to_line',
  invoiceType: 'invoice_type',
  carrier: 'invoice_carrier',
  title: 'invoice_title',
  taxId: 'invoice_tax_id',
  donateCode: 'invoice_donate_code',
  item: 'manual_order_line',
} as const;

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const VARIANT = '33333333-3333-4333-8333-333333333333';

/** 假表單:`getAll` 就夠(解析器只用得到它)。值可重複 ⇒ 才測得了「同名欄位送兩份」。 */
function form(entries: Array<[string, string]>): ManualOrderFormLike {
  return {
    getAll: (name: string) => entries.filter(([k]) => k === name).map(([, v]) => v),
  };
}

const LINE = JSON.stringify({
  sku: 'PCM-001',
  title: '排氣管',
  qty: 2,
  unit_price: 12000,
  variant_id: VARIANT,
  spec: { color: '黑' },
});

function base(over: Array<[string, string]> = [], drop: string[] = []): ManualOrderFormLike {
  const rows: Array<[string, string]> = [
    [FIELDS.requestId, UUID_A],
    [FIELDS.customer, UUID_B],
    [FIELDS.source, 'manual_phone'],
    [FIELDS.channel, 'bank_transfer'],
    [FIELDS.shipping, 'home'],
    [FIELDS.fee, '150'],
    [FIELDS.name, '王小明'],
    [FIELDS.phone, '0912345678'],
    [FIELDS.line, '台北市中正區某路 1 號'],
    [FIELDS.invoiceType, 'personal'],
    [FIELDS.item, LINE],
  ];
  return form([...rows.filter(([k]) => !drop.includes(k)), ...over]);
}

/** 只在**確定成功**時用;失敗會把 `error` 印出來,而不是丟一個 `undefined` 讓人去猜。 */
function ok(result: ReturnType<typeof parseManualOrderForm>) {
  if (!result.ok) throw new Error(`預期成功,實際被拒:${result.error}`);
  return result.values;
}

describe('parseManualOrderForm:成功路徑的形狀', () => {
  it('🔴 前提:這張基準表單是【過得了】的(不然下面每一格的紅都沒有意義)', () => {
    expect(parseManualOrderForm(base()).ok).toBe(true);
  });

  it('吐出的形狀 = RPC 的 wire 形狀(snake_case 品項、camelCase 發票鍵)', () => {
    expect(ok(parseManualOrderForm(base()))).toEqual({
      customerUserId: UUID_B,
      manualRequestId: UUID_A,
      orderSource: 'manual_phone',
      paymentChannel: 'bank_transfer',
      shippingMethod: 'home',
      shipTo: { name: '王小明', phone: '0912345678', line: '台北市中正區某路 1 號' },
      invoice: { type: 'personal' },
      shippingFee: 150,
      lines: [
        { sku: 'PCM-001', title: '排氣管', qty: 2, unit_price: 12000, variant_id: VARIANT, spec: { color: '黑' } },
      ],
    });
  });

  it('🔴🔴 一個字都不 normalize —— 前後空白【原樣送出】(冪等指紋靠這個)', () => {
    const values = ok(
      parseManualOrderForm(
        base(
          [
            [FIELDS.name, '  王小明  '],
            [FIELDS.item, JSON.stringify({ sku: ' PCM-001 ', title: ' 排氣管 ', qty: 1, unit_price: 1 })],
          ],
          [FIELDS.name, FIELDS.item],
        ),
      ),
    );
    expect(values.shipTo.name).toBe('  王小明  ');
    expect(values.lines[0]?.sku).toBe(' PCM-001 ');
    expect(values.lines[0]?.title).toBe(' 排氣管 ');
  });
});

describe('封閉值集:不在名單上就拒', () => {
  it.each([
    [FIELDS.source, 'manual_fax'],
    [FIELDS.channel, 'linepay'],
    [FIELDS.shipping, 'drone'],
    [FIELDS.invoiceType, 'triplicate'],
  ])('%s = %s ⇒ 拒', (field, bad) => {
    expect(parseManualOrderForm(base([[field, bad]], [field])).ok).toBe(false);
  });

  it('🔴 `tappay` 過不了收款方式 —— 人工建的單不得宣稱一筆刷卡交易', () => {
    const r = parseManualOrderForm(base([[FIELDS.channel, 'tappay']], [FIELDS.channel]));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('刷卡');
  });

  it.each([FIELDS.requestId, FIELDS.customer, FIELDS.source, FIELDS.channel, FIELDS.shipping, FIELDS.fee, FIELDS.name, FIELDS.phone, FIELDS.line, FIELDS.invoiceType])(
    '缺 %s ⇒ 拒',
    (field) => {
      expect(parseManualOrderForm(base([], [field])).ok).toBe(false);
    },
  );

  it('冪等鍵不是 uuid ⇒ 拒(而訊息叫他重開一張空白表單,不是叫他重送)', () => {
    const r = parseManualOrderForm(base([[FIELDS.requestId, 'req_11111111-1111-4111-8111-111111111111']], [FIELDS.requestId]));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('空白建單表單');
  });
});

describe('🔴 選填發票欄:送兩份【必須被拒】,不得靜默當成沒填', () => {
  // 這一格就是 `forms/single-value.ts` 檔頭記載、退款線實測過的 fail-open 方向:
  // 若這裡改用 `readSingleString`,兩份會收斂成 null ⇒ 當成「沒填」⇒ **本格轉綠而洞打開**。
  it.each([FIELDS.carrier, FIELDS.title, FIELDS.taxId, FIELDS.donateCode])('%s 送兩份 ⇒ 拒', (field) => {
    expect(parseManualOrderForm(base([[field, 'A'], [field, 'B']])).ok).toBe(false);
  });

  it('沒送 ⇒ payload 裡沒有那把鍵(不是空字串)', () => {
    expect(ok(parseManualOrderForm(base())).invoice).toEqual({ type: 'personal' });
  });

  it('🔴 只打了空白 ⇒ 與「沒填」同一件事(否則會生出兩種指紋)', () => {
    expect(ok(parseManualOrderForm(base([[FIELDS.carrier, '   ']]))).invoice).toEqual({ type: 'personal' });
  });

  it('有值 ⇒ 原樣進 payload', () => {
    expect(ok(parseManualOrderForm(base([[FIELDS.taxId, '12345678']]))).invoice).toEqual({
      type: 'personal',
      taxId: '12345678',
    });
  });
});

describe('收件三格與運費', () => {
  it.each([
    [FIELDS.name, '   '],
    [FIELDS.phone, '\t'],
    [FIELDS.line, '\n'],
  ])('%s 只有空白字元 ⇒ 拒(本層比 RPC 嚴,見檔頭)', (field, blank) => {
    expect(parseManualOrderForm(base([[field, blank]], [field])).ok).toBe(false);
  });

  it.each(['-1', '3.0', '+3', ' 3 ', '3e0', '', 'abc'])('運費 %s ⇒ 拒', (bad) => {
    expect(parseManualOrderForm(base([[FIELDS.fee, bad]], [FIELDS.fee])).ok).toBe(false);
  });

  it('運費 0 ⇒ 收(不收運費是常態,不是缺值)', () => {
    expect(ok(parseManualOrderForm(base([[FIELDS.fee, '0']], [FIELDS.fee]))).shippingFee).toBe(0);
  });
});

describe('品項', () => {
  const line = (over: Record<string, unknown>) =>
    JSON.stringify({ sku: 'S', title: 'T', qty: 1, unit_price: 100, ...over });

  it('一個品項都沒有 ⇒ 拒', () => {
    expect(parseManualOrderForm(base([], [FIELDS.item])).ok).toBe(false);
  });

  it(`超過 ${MANUAL_ORDER_MAX_LINES} 筆 ⇒ 拒;剛好 ${MANUAL_ORDER_MAX_LINES} 筆 ⇒ 收`, () => {
    const rows = (n: number): Array<[string, string]> =>
      Array.from({ length: n }, (_, i) => [FIELDS.item, line({ sku: `S${i}` })] as [string, string]);
    expect(parseManualOrderForm(base(rows(MANUAL_ORDER_MAX_LINES), [FIELDS.item])).ok).toBe(true);
    expect(parseManualOrderForm(base(rows(MANUAL_ORDER_MAX_LINES + 1), [FIELDS.item])).ok).toBe(false);
  });

  it.each([
    ['沒有料號', { sku: '  ' }],
    ['沒有品名', { title: '' }],
    ['數量 0', { qty: 0 }],
    ['數量非整數', { qty: 1.5 }],
    ['數量是字串', { qty: '2' }],
    [`數量超過 ${MANUAL_ORDER_MAX_QTY}`, { qty: MANUAL_ORDER_MAX_QTY + 1 }],
    ['單價負數', { unit_price: -1 }],
    ['單價非整數', { unit_price: 0.5 }],
    ['規格值不是文字', { spec: { qty: 3 } }],
    ['規格是陣列', { spec: [] }],
  ])('%s ⇒ 拒', (_label, over) => {
    expect(parseManualOrderForm(base([[FIELDS.item, line(over)]], [FIELDS.item])).ok).toBe(false);
  });

  it('整筆不是 JSON ⇒ 拒(不是丟例外)', () => {
    expect(parseManualOrderForm(base([[FIELDS.item, '{oops']], [FIELDS.item])).ok).toBe(false);
  });

  it.each([
    ['沒帶 variant_id', {}],
    ['variant_id = null', { variant_id: null }],
    ['variant_id = 空字串', { variant_id: '' }],
  ])('%s ⇒ 代購品項(variant_id 收斂成 null)', (_label, over) => {
    const values = ok(parseManualOrderForm(base([[FIELDS.item, line(over)]], [FIELDS.item])));
    expect(values.lines[0]?.variant_id).toBeNull();
  });

  it('🔴 variant_id 是個不合法字串 ⇒ 拒,【不得】默默退化成代購品項', () => {
    // 退化的後果:員工以為挑到了網站上那個商品, 系統建出來的卻是一個憑空的新品項。
    const r = parseManualOrderForm(base([[FIELDS.item, line({ variant_id: 'not-a-uuid' })]], [FIELDS.item]));
    expect(r.ok).toBe(false);
  });

  it('沒帶 spec ⇒ 空物件', () => {
    expect(ok(parseManualOrderForm(base([[FIELDS.item, line({})]], [FIELDS.item]))).lines[0]?.spec).toEqual({});
  });

  it('總金額超出 int4 上限 ⇒ 拒', () => {
    const r = parseManualOrderForm(
      base([[FIELDS.item, line({ qty: 9999, unit_price: 999999 })]], [FIELDS.item]),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('上限');
  });
});

describe('newManualRequestId', () => {
  it('是 uuid,而且【不帶 req_ 前綴】(那是另一支 request-id 的形狀,型別對不上)', () => {
    const id = newManualRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(id.startsWith('req_')).toBe(false);
  });

  it('每次都是新的一顆', () => {
    expect(new Set(Array.from({ length: 20 }, newManualRequestId)).size).toBe(20);
  });

  it('🔴 它產出來的東西,解析器收得下(兩支不對盤的話這格會紅)', () => {
    const id = newManualRequestId();
    expect(ok(parseManualOrderForm(base([[FIELDS.requestId, id]], [FIELDS.requestId]))).manualRequestId).toBe(id);
  });
});
