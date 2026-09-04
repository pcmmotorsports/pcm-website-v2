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
  invoiceRequested: 'invoice_requested',
  notificationEmail: 'notification_email',
  carrier: 'invoice_carrier',
  title: 'invoice_title',
  taxId: 'invoice_tax_id',
  donateCode: 'invoice_donate_code',
  // 🔴 A3-c 起是**六個平行的原生欄位**(原本 `~~manual_order_line~~` 一個 JSON 欄已退場)。
  // 這六個字面同樣是**手打的**,理由同上:從常數走訪會讓「少一欄」變成全綠。
  // 🔴 **帶列號 `_0`** —— 少了它, 下面那組「送的不是字串」的測試會把檔案塞進一個
  //    **沒有人會讀的欄名** ⇒ 解析器一路綠 ⇒ **那六格全部假綠**。我踩過一次。
  lineSku: 'line_sku_0',
  lineTitle: 'line_title_0',
  lineQty: 'line_qty_0',
  lineUnitPrice: 'line_unit_price_0',
  lineVariant: 'line_variant_id_0',
  lineSpec: 'line_spec_0',
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

type LineOver = Partial<Record<'sku' | 'title' | 'qty' | 'unitPrice' | 'variantId' | 'spec', string>>;

/**
 * 把**第 `index` 列**品項展開成六筆 `[欄名, 值]`。欄名帶列號(`line_sku_0` …)。
 * 🔴 欄名的 `_${index}` 是**手打的字串拼接**,不呼叫 `manualOrderLineField()` ——
 *    共用同一支拼接函式的話,拼錯了兩邊會一起錯而測試全綠。
 */
function lineRows(over: LineOver = {}, index = 0): Array<[string, string]> {
  const v = { sku: 'S', title: 'T', qty: '1', unitPrice: '100', variantId: '', spec: '', ...over };
  return [
    [`line_sku_${index}`, v.sku],
    [`line_title_${index}`, v.title],
    [`line_qty_${index}`, v.qty],
    [`line_unit_price_${index}`, v.unitPrice],
    [`line_variant_id_${index}`, v.variantId],
    [`line_spec_${index}`, v.spec],
  ];
}

/** 基準那一列的六個欄名(要 drop 它時用)。 */
const LINE_KEYS = lineRows().map(([k]) => k);

const BASE_LINE = lineRows({
  sku: 'PCM-001', title: '排氣管', qty: '2', unitPrice: '12000',
  variantId: VARIANT, spec: JSON.stringify({ color: '黑' }),
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
    [FIELDS.invoiceRequested, 'off'],
    [FIELDS.notificationEmail, ''],
    [FIELDS.invoiceType, 'personal'],
    ...BASE_LINE,
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
      // 基準表單的 hidden 是 `off` ⇒ 這裡是 `false`。**不是預設值, 是那張表單的內容。**
      invoiceRequested: false,
      notificationEmail: null,
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
            ...lineRows({ sku: ' PCM-001 ', title: ' 排氣管 ', qty: '1', unitPrice: '1' }),
          ],
          [FIELDS.name, ...LINE_KEYS],
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
  /** 只帶一列品項的表單(先把基準那列六格 drop 掉,再放進 `over`)。 */
  const one = (over: LineOver = {}) => base(lineRows(over), [...LINE_KEYS]);

  it('一個品項都沒有 ⇒ 拒', () => {
    expect(parseManualOrderForm(base([], [...LINE_KEYS])).ok).toBe(false);
  });

  it(`超過 ${MANUAL_ORDER_MAX_LINES} 筆 ⇒ 拒;剛好 ${MANUAL_ORDER_MAX_LINES} 筆 ⇒ 收`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => lineRows({ sku: `S${i}` }, i)).flat();
    expect(parseManualOrderForm(base(many(MANUAL_ORDER_MAX_LINES), [...LINE_KEYS])).ok).toBe(true);
    expect(parseManualOrderForm(base(many(MANUAL_ORDER_MAX_LINES + 1), [...LINE_KEYS])).ok).toBe(false);
  });

  it.each([
    ['沒有料號', { sku: '  ' }],
    ['沒有品名', { title: '' }],
    ['數量 0', { qty: '0' }],
    ['數量非整數', { qty: '1.5' }],
    ['數量帶正號', { qty: '+2' }],
    ['數量前後有空白', { qty: ' 2 ' }],
    ['數量是科學記號', { qty: '3e0' }],
    [`數量超過 ${MANUAL_ORDER_MAX_QTY}`, { qty: String(MANUAL_ORDER_MAX_QTY + 1) }],
    ['單價負數', { unitPrice: '-1' }],
    ['單價非整數', { unitPrice: '0.5' }],
    ['規格值不是文字', { spec: JSON.stringify({ qty: 3 }) }],
    ['規格是陣列', { spec: '[]' }],
    ['規格不是 JSON', { spec: '{oops' }],
    // 🔴 codex R1 #5:舊的 JSON 版對 `spec: "   "` 會因「不是物件」而拒;用 `isBlank()` 會變 `{}`
    //    ⇒ 又是一條被靜默放寬的規則。**完全沒送(空字串)才等於沒填。**
    ['規格只有空白(不是沒送)', { spec: '   ' }],
  ])('%s ⇒ 拒', (_label, over) => {
    expect(parseManualOrderForm(one(over as LineOver)).ok).toBe(false);
  });

  it('variantId = 空字串(完全沒打字)⇒ 代購品項(variant_id 收斂成 null)', () => {
    expect(ok(parseManualOrderForm(one())).lines[0]?.variant_id).toBeNull();
  });

  it('🔴🔴 variantId = 【只有空白】⇒ 拒,不得靜默退化成代購', () => {
    // ⛔ 這一格第一版被我寫成 `⇒ null`(當成沒填)——**那是把一條放寬的規則釘成期望值**,
    //    而放寬之後沒有任何東西會紅。R1 抓到。
    //    真實情境:從 Excel 貼一格帶前後空白的編號 ⇒ 建出一個沒連到商品的憑空品項。
    const r = parseManualOrderForm(one({ variantId: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('商品編號');
  });

  it('🔴 variantId 是個不合法字串 ⇒ 拒,【不得】默默退化成代購品項', () => {
    // 退化的後果:員工以為挑到了網站上那個商品, 系統建出來的卻是一個憑空的新品項。
    expect(parseManualOrderForm(one({ variantId: 'not-a-uuid' })).ok).toBe(false);
  });

  it('沒帶 spec ⇒ 空物件', () => {
    expect(ok(parseManualOrderForm(one())).lines[0]?.spec).toEqual({});
  });

  // 🔴 **邊界那一格,codex R1 #9 點名**:原本只驗 `MAX_QTY + 1` 被拒,
  //    ⇒ 把 `qty > MAX_QTY` 改成 `>=` 的突變**會活著**(唯一用到 9999 的案例本來就因總額超限而預期失敗)
  //    ⇒ 合法上限 9999 會被錯誤拒絕,而沒有東西會紅。**上界要兩邊都釘。**
  it(`🔴 數量【剛好】 ${MANUAL_ORDER_MAX_QTY} ⇒ 收(單價壓低, 免得被總額上限接走而看不出是哪一格擋的)`, () => {
    const values = ok(parseManualOrderForm(one({ qty: String(MANUAL_ORDER_MAX_QTY), unitPrice: '1' })));
    expect(values.lines[0]?.qty).toBe(MANUAL_ORDER_MAX_QTY);
  });

  it('總金額超出 int4 上限 ⇒ 拒', () => {
    const r = parseManualOrderForm(one({ qty: '9999', unitPrice: '999999' }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('上限');
  });

  // ── 🔴 A3-c 新增的三族:拉鍊 / 空白列 / 列號 ────────────────────────────────
  describe('🔴🔴 列與值的配對(本片最承重的一族)', () => {
    // 🔴 **這一族在 codex R1 之後換了形狀。** 第一版是六個同名可重複欄位 + 「長度全等」拉鍊,
    //    而 codex 打破了它:一格 `disabled` 不送 + 尾端一個同名殘留欄位
    //    ⇒ **六欄仍然等長, 而配對錯開** ⇒ 建出一張每格合法而內容全錯的單。
    //    ⇒ 現在欄名自己帶列號(`line_sku_0`)⇒ **那一整族不存在了**, 不是被擋下來。
    //    📌 **「六個東西數量一樣多」不等於「它們配對正確」。要驗配對, 就得有配對的鍵。**
    it('某一列少送一格 ⇒ 拒,走【線路層】那句話(不是靜默補空、也不是整列消失)', () => {
      // ⚠️ **這一格的期望值在 Fable R3 之後改過**:原本斷言「第 2 個品項」——
      //    那是把「缺格」當成「那一列內容不合格」。**它不是** ——
      //    欄位整個沒送是**線路層**出事(頁面沒載完 / 欄位被拔掉), 員工的下一步是**重新整理**,
      //    不是「去把第 2 列填好」(他畫面上那一列可能填得好好的)。
      //    🔴 訊息要指向他**做得到的下一步**, 而那取決於是哪一層壞掉。
      const rows = [...lineRows({ sku: 'A', unitPrice: '10' }), ...lineRows({ sku: 'B', unitPrice: '20' }, 1)]
        .filter(([k]) => k !== 'line_unit_price_1');
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('重新整理');
    });

    it('🔴🔴 同一格送兩份 ⇒ 拒,【不得挑一個用】(挑哪一個都是猜)', () => {
      const rows = [...lineRows({ sku: 'A' }), ['line_qty_0', '999'] as [string, string]];
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('重新整理');
    });

    // 🔴🔴 **Fable R3 F1(must-fix)**:第一版的「六欄長度全等」擋得住「缺格」,
    //    而換成帶列號之後我只擋了「重複」與「缺號」—— **忘了擋「缺格」** ⇒ 一個原本會紅的情況被改綠。
    //    ⇒ 這一族釘住「這一列在席, 而某一格【整個沒送】」。
    it.each([
      ['line_variant_id_0', '🔴 最貴的那一格:靜默退化成代購品項'],
      ['line_sku_0', '料號'],
      ['line_spec_0', '規格'],
      ['line_qty_0', '數量'],
    ])('🔴 這一列在席而 %s 整格沒送 ⇒ 拒(%s)', (missing) => {
      const rows = lineRows({ variantId: '33333333-3333-4333-8333-333333333333' })
        .filter(([k]) => k !== missing);
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error, '要走「對不起來」那條路, 不是被別的欄位規則順手擋下').toContain(
        '重新整理',
      );
    });

    it('🔴 正對照:六格【全部】送出(其中幾格是空字串)⇒ 收 —— 空字串不等於沒送', () => {
      // 沒有這一格, 上面那族可以靠「把空字串也判成缺格」而全綠, 而那會擋掉正常的代購品項。
      expect(ok(parseManualOrderForm(one())).lines[0]?.variant_id).toBeNull();
    });

    it('🔴 整列六格【全部】送兩份 ⇒ 拒(不得整列靜默消失)', () => {
      // Fable R3 F3:`present()` 若寫成 `=== 'value'`, 這一列會被判成不在席 ⇒ 整列消失,
      // 而上面那道 invalid 守門根本走不到。其他 invalid 測項都還有別的字串格撐住 present()。
      const rows = [...lineRows({ sku: 'A' }), ...lineRows({ sku: 'B' })]; // 同 index 0 ⇒ 六格各兩份
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('重新整理');
    });

    it('🔴🔴 列號中間缺一號而後面還有東西 ⇒ 拒(那一列在路上不見了, 不得靜默截斷)', () => {
      const rows = [...lineRows({ sku: 'A' }), ...lineRows({ sku: 'C' }, 2)];
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('重新整理');
    });

    // ── 🔴 列號本身可以被 client 亂寫, 這一族釘住「亂寫會怎樣」 ──────────────
    //  🔴🔴 **先寫清楚這道守門【做不到】什麼**:解析器拿到的介面只有 `getAll(name)`,
    //     它**沒有辦法列舉表單上到底有哪些欄名** ⇒ 名字不是 `base_0`…`base_50` 的東西
    //     (`line_sku_9999` / `line_sku_-1` / `line_sku_x` / `line_sku_00`)
    //     **它根本看不到, 因此是被【忽略】而不是被【擋下】。**
    //  ✅ 而忽略是安全的那一邊:那些格子進不了訂單, 不會憑空多一列。
    //     ⚠️ 但**不得讀成「亂寫的列號會被拒絕」** —— 它是被無視。
    it.each([
      ['超大列號', 9999],
      ['負數列號', -1],
      ['前導零', '00'],
      ['非數字', 'x'],
    ])('🔴 %s 的欄位【被忽略】, 不會憑空多一列品項', (_label, idx) => {
      const rows: Array<[string, string]> = [
        ...lineRows({ sku: 'REAL' }),
        [`line_sku_${idx}`, 'PHANTOM'],
        [`line_title_${idx}`, '幽靈'],
        [`line_qty_${idx}`, '1'],
        [`line_unit_price_${idx}`, '1'],
      ];
      const values = ok(parseManualOrderForm(base(rows, [...LINE_KEYS])));
      expect(values.lines.map((l) => l.sku)).toEqual(['REAL']);
    });

    it('🔴 只送一個超大列號、沒有第 0 列 ⇒ 拒(不是建出一張空單)', () => {
      const rows: Array<[string, string]> = [
        ['line_sku_9999', 'PHANTOM'],
        ['line_title_9999', '幽靈'],
        ['line_qty_9999', '1'],
        ['line_unit_price_9999', '1'],
      ];
      expect(parseManualOrderForm(base(rows, [...LINE_KEYS])).ok).toBe(false);
    });

    it('🔴 正對照:連續兩列 ⇒ 收(證明上面幾格紅的是【那些毛病】不是【兩列】)', () => {
      const rows = [...lineRows({ sku: 'A', unitPrice: '10' }), ...lineRows({ sku: 'B', unitPrice: '20' }, 1)];
      const values = ok(parseManualOrderForm(base(rows, [...LINE_KEYS])));
      expect(values.lines.map((l) => [l.sku, l.unit_price])).toEqual([['A', 10], ['B', 20]]);
    });

    it('🔴 值與列的配對不得錯開(拉鍊本身)', () => {
      const rows = [
        ...lineRows({ sku: 'A', title: 'TA', qty: '1', unitPrice: '11' }),
        ...lineRows({ sku: 'B', title: 'TB', qty: '2', unitPrice: '22' }, 1),
      ];
      expect(ok(parseManualOrderForm(base(rows, [...LINE_KEYS]))).lines).toEqual([
        { sku: 'A', title: 'TA', qty: 1, unit_price: 11, variant_id: null, spec: {} },
        { sku: 'B', title: 'TB', qty: 2, unit_price: 22, variant_id: null, spec: {} },
      ]);
    });
  });

  // 🔴 R1 找到的第二發活著的突變:`readLines` 裡 `typeof v !== 'string'` 改成 `if (false)` ⇒ 108 格全綠。
  //    ⇒ 那道守門**一格測試都沒有**。構造的 multipart 可以把 `line_qty` 送成一個 File,
  //    而 `isBlank(File)` 會丟 `TypeError` ⇒ **500,而不是那句「請重新整理」。**
  //  ⚠️ **第一版只把檔案塞進 `line_qty`,而突變照樣活著** —— 因為 `isEmptyRow` 是短路的:
  //     `sku` 不是空的就直接 false,**根本沒碰到 qty** ⇒ 後面 `NON_NEG_INT_RE.test()` 把它
  //     強制轉成字串 `'[object File]'` ⇒ 乖乖回一句話 ⇒ 沒有例外、測試綠。
  //     ⇒ **要真的走到會爆的那一行,那六格得【逐格都試一次】。**
  it.each(['lineSku', 'lineTitle', 'lineQty', 'lineUnitPrice', 'lineVariant', 'lineSpec'] as const)(
    '🔴 %s 送的不是字串(例如檔案)⇒ 收斂成一句話, 不得丟例外',
    (key) => {
      const target = FIELDS[key];
      const good = base(lineRows(), [...LINE_KEYS]);
      const withFile: ManualOrderFormLike = {
        ...good,
        getAll: (name: string) =>
          name === target
            ? ([new File([''], 'x.txt')] as unknown as FormDataEntryValue[])
            : good.getAll(name),
      };
      let r: ReturnType<typeof parseManualOrderForm> | undefined;
      expect(() => {
        r = parseManualOrderForm(withFile);
      }).not.toThrow();
      expect(r?.ok).toBe(false);
      // 🔴🔴 **要斷言【是哪一條路擋的】,而不是「反正失敗了」**(2026-08-24 夜,主視窗問「那六發都跑了嗎」逼出來的)。
      //    只斷言 `ok === false` 時,把那道 `invalid` 守門拿掉 ⇒ 六格裡**只有兩格會紅**:
      //    另外四格是因為 `read.value` 是 `undefined` ⇒ 收斂成空字串 ⇒ 落進「沒有料號 / 沒有品名 /
      //    數量要是整數」那些**別的**訊息 ⇒ 照樣 `ok:false` ⇒ **綠得沒有判別力。**
      //    📌 形狀:**一個會失敗的輸入,通常有不只一條路讓它失敗。**
      //       只驗「有沒有失敗」= 沒有指定是哪一條路 ⇒ 守門死了它也不會說。
      expect(r?.ok === false && r.error, '要走「這幾欄對不起來」那條路, 不是被別的欄位規則順手擋下').toContain(
        '重新整理',
      );
    },
  );

  describe('空白列', () => {
    const blank = (index = 0) => lineRows({ sku: '', title: '', qty: '', unitPrice: '' }, index);

    it('六格全空的列 ⇒ 跳過(員工按了「加一列」但沒填)', () => {
      const rows = [...lineRows({ sku: 'A' }), ...blank(1)];
      expect(ok(parseManualOrderForm(base(rows, [...LINE_KEYS]))).lines.map((l) => l.sku)).toEqual(['A']);
    });

    // 🔴🔴 **下面兩格是 R1 指出的一發【活著的突變】逼出來的**:
    //    把 `isEmptyRow` 的 `&& isBlank(r.variantId)`(或 `&& isBlank(r.spec)`)拿掉 ⇒ 67 格全綠。
    //    ⇒ 「六格全空」這個斷言,**當時只有四格真的被量到**。
    //    失敗形狀:員工只填了商品編號、其他留白 ⇒ 那一列**憑空消失**,而不是被指名擋下。
    it.each([
      ['只填了商品編號', { variantId: '33333333-3333-4333-8333-333333333333' }],
      ['只填了規格', { spec: JSON.stringify({ color: '黑' }) }],
    ])('🔴 %s、其餘留白 ⇒ 那一列【不算空】, 要被指名擋下而不是消失', (_label, over) => {
      const rows = [
        ...lineRows({ sku: 'GOOD' }),
        ...lineRows({ sku: '', title: '', qty: '', unitPrice: '', ...(over as LineOver) }, 1),
      ];
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('第 2 個品項');
    });

    it('🔴 全部都是空白列 ⇒ 拒(與「一列都沒有」同一句話)', () => {
      expect(parseManualOrderForm(base(blank(), [...LINE_KEYS])).ok).toBe(false);
    });

    it('🔴🔴 【部分】空的列 ⇒ 拒,不得靜默跳過', () => {
      // 靜默跳過的後果:他填了料號忘了價格 ⇒ 那一列憑空消失 ⇒ 畫面說成功 ⇒ 對帳那天才發現少一項。
      //
      // 🔴🔴 **這一格【要配一列好的】,而那不是湊數** —— 第一版只送那一列壞的,
      //    突變(把「部分空」也當空列跳過)之後它**照樣綠**:唯一那列被跳掉 ⇒ 零品項 ⇒ 仍然 `ok:false`。
      //    **它綠的理由與它自己寫的失敗情境不同 ⇒ 那一發沒有判別力。**
      //    配一列好的之後,跳過那列壞的會變成 `ok:true` ⇒ 兩個世界才印不同的東西。
      const r = parseManualOrderForm(
        base([...lineRows({ sku: 'GOOD' }), ...lineRows({ sku: 'A', qty: '', unitPrice: '' }, 1)], [...LINE_KEYS]),
      );
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('第 2 個品項');
    });

    it('🔴 跳過空白列【不得】讓後面的列改號 —— 訊息裡的列號要對得上畫面', () => {
      // 畫面:第 1 列有東西 / 第 2 列空的 / 第 3 列數量填 0 ⇒ 訊息必須說「第 3 個」
      const rows = [...lineRows({ sku: 'A' }), ...blank(1), ...lineRows({ sku: 'C', qty: '0' }, 2)];
      const r = parseManualOrderForm(base(rows, [...LINE_KEYS]));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain('第 3 個品項');
      expect(r.ok === false && r.error).not.toContain('第 2 個品項');
    });
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

describe('⟦b4-MANUALORDERDEADEND⟧ 商品編號那句訊息 —— 不得指向不存在的動作', () => {
  // 🔬 病史(2026-09-05 走查 + 讀碼各驗一次):原句是
  //    「…商品編號格式不對, **請重新從商品清單挑一次**。」
  //    ① 那個清單**不能挑**:`manual-order-catalog-lookup.tsx:145` 的 `<li>` 沒有 button / role / onClick
  //    ② 那串編號他**從來看不到**:同檔 `h.variantId` 全檔 1 命中, 而那一處是 React 的 `key=`
  //    ⇒ 🎯 原句對員工是「回去挑」而沒有東西可挑、「重新輸入」而他沒看過那個值。

  function bad() {
    // 🔴 **要 `drop` 掉原本那一格再放新的** —— `base(over)` 是**追加**不是取代,
    //    同名欄送兩份會撞到另一條路(「品項那幾欄對不起來了」)⇒ 這幾格會紅在無關的理由上。
    //    📌 我第一版就是這樣, 而三格同時紅 —— **紅的理由與它們要守的東西無關。**
    return parseManualOrderForm(base([[FIELDS.lineVariant, 'not-a-uuid']], [FIELDS.lineVariant]));
  }

  it('🔴 舊字面不得再出現', () => {
    const r = bad();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain('請重新從商品清單挑一次');
  });

  it('🔴 新訊息要給【做得到的】下一步 —— 這一格留白', () => {
    const r = bad();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('留白');
  });

  it('🔴🔴 而它要擋掉那個【最自然的錯誤動作】:貼商品頁網址上的編號', () => {
    // 🛑 商品列表是 `.from('products')`(`product-repository.ts:315`), 網址 `/products/{id}`
    //    帶的是 **product id**;這一格要的是 **product_variants id**。
    //    🔴 兩者都是 UUID ⇒ 貼錯那一種**過得了格式檢查**, 而錯誤往下走、不會叫。
    //    ⇒ 少了這一格, 一個「只把舊句改成『請重新輸入』」的修法會全綠, 而它沒有擋住那個動作。
    const r = bad();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('商品頁網址');
  });

  it('🔵 負對照:合法 uuid 不得被這道擋下(否則上面三格對「永遠失敗」也全綠)', () => {
    const r = parseManualOrderForm(
      base([[FIELDS.lineVariant, '33333333-3333-4333-8333-333333333333']], [FIELDS.lineVariant]),
    );
    expect(r.ok).toBe(true);
  });
});

describe('parseManualOrderForm:「要不要開發票」那顆勾選(`⟦b4-INVOICE5PCT⟧` 第 2 步)', () => {
  // 🔴🔴 **這一族要測的是【三個世界】, 不是兩個。**
  //   HTML 的 checkbox 沒勾時**整個欄位不出現** ⇒ 那與「表單根本沒有這一格」印同一個空白,
  //   而兩者的正確答案**相反**(一個是他決定不開, 一個是我不知道)。
  //   ⇒ 表單那邊放了一個**同名 hidden(`off`)**, 讓欄位永遠在 ⇒ 三個世界才分得開。
  //   🛑 少了下面第三格, 把 hidden 從表單刪掉這件事**不會有任何東西紅**。

  it('沒勾(只有 hidden 的 off)⇒ false', () => {
    expect(ok(parseManualOrderForm(base())).invoiceRequested).toBe(false);
  });

  it('勾了(hidden 的 off 後面再跟一個 on)⇒ true —— 取的是【最後一個】值', () => {
    expect(ok(parseManualOrderForm(base([[FIELDS.invoiceRequested, 'on']]))).invoiceRequested).toBe(
      true,
    );
  });

  it('🔴 順序反過來(on 在前、off 在後)⇒ false —— 證明「取最後一個」不是「有 on 就算」', () => {
    const flipped = base(
      [
        [FIELDS.invoiceRequested, 'on'],
        [FIELDS.invoiceRequested, 'off'],
      ],
      [FIELDS.invoiceRequested],
    );
    expect(ok(parseManualOrderForm(flipped)).invoiceRequested).toBe(false);
  });

  it('🔴🔴 欄位【整個不在】(hidden 被刪掉了)⇒ **拒絕建單**, 不猜', () => {
    // 🛑 codex R1 must-fix 改過方向:⛔ ~~原本回 `true` 並繼續建單~~ ——
    //    `true` = 開發票 = **多做一件事** ⇒ 那是 fail-**open**, 而它會安靜地替他做一個決定,
    //    錯的方向剛好是「客人拿到一張他沒要的發票」。錢路徑上契約壞掉要**停**。
    const r = parseManualOrderForm(base([], [FIELDS.invoiceRequested]));
    expect(r.ok).toBe(false);
  });

  it('🔴 值看不懂(`off` 後面跟一串亂碼)⇒ **拒絕**, 不當作沒勾', () => {
    const r = parseManualOrderForm(
      base([[FIELDS.invoiceRequested, 'yes-please']], [FIELDS.invoiceRequested]),
    );
    expect(r.ok).toBe(false);
  });

  it('🔴 負對照:上面兩格的紅【不是因為 base 本身壞了】', () => {
    expect(parseManualOrderForm(base()).ok).toBe(true);
  });

  it('🔴 前提:上面那三格的差別真的來自這一欄 —— 三個世界的其餘欄位逐字相同', () => {
    const off = ok(parseManualOrderForm(base()));
    const on = ok(parseManualOrderForm(base([[FIELDS.invoiceRequested, 'on']])));
    expect({ ...off, invoiceRequested: null }).toEqual({ ...on, invoiceRequested: null });
  });
});

/**
 * 🔴 **覆寫那一格要用 `drop`, 不能只 `over` 追加** —— `base()` 的 `over` 是**接在後面**,
 *    而 `notification_email` 已經在基準列裡 ⇒ 追加會讓同名欄出現**兩次**。
 * 🛑 而解析端用 `readSingle` ⇒ 它把「出現兩次」判成 invalid(那是對的:text input 只會有一份,
 *    兩份 = payload 被動過)⇒ 🔬 **我第一版就是這樣寫的, 九格全紅, 而紅的理由不是我要測的那個。**
 * 📌 **一個測試助手的預設行為(追加 vs 覆寫), 會讓九格測試同時測到另一件事。**
 */
function withEmail(v: string): ManualOrderFormLike {
  return base([[FIELDS.notificationEmail, v]], [FIELDS.notificationEmail]);
}

describe('parseManualOrderForm:「通知 email」那一格(`⟦f3-MAILFALLBACKVSRULING⟧` 片 E)', () => {
  // 🔴🔴 **這一族要測的是【留白會不會變成空字串】, 不只是「有填的時候對不對」。**
  //    空字串會被 `orders_notification_email_valid` 的 `~ '^[!-~]+$'` 擋掉 ⇒ **整張單建不出來**,
  //    而那個失敗的訊息是一個約束名 —— 員工看不懂、也不知道是哪一格。
  //    ⇒ 📌 所以「留白 ⇒ `null`」是**行為**不是實作細節,要有自己的一格。
  it('有填 ⇒ 原樣帶出去(而前後空白被剝掉)', () => {
    const r = ok(parseManualOrderForm(withEmail('  a@b.co  ')));
    expect(r.notificationEmail).toBe('a@b.co');
  });

  it('🔴 留白 ⇒ `null`, 不是空字串', () => {
    const r = ok(parseManualOrderForm(withEmail('')));
    expect(r.notificationEmail).toBeNull();
  });

  it('🔴 只打了空白 ⇒ 也是 `null`(員工按了空白鍵與什麼都沒打, 對客人是同一件事)', () => {
    const r = ok(parseManualOrderForm(withEmail('   ')));
    expect(r.notificationEmail).toBeNull();
  });

  it('🔴 缺欄 ⇒ 拒, 而訊息要講【哪一格】', () => {
    const form = base();
    const stripped = {
      getAll: (n: string) => (n === FIELDS.notificationEmail ? [] : form.getAll(n)),
    };
    const r = parseManualOrderForm(stripped);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('通知 email');
  });

  it.each([
    ['沒有 @', 'abc'],
    ['兩個 @', 'a@@b.co'],
    ['domain 沒有點', 'a@b'],
    ['帶全形字', 'a＠b.co'],
    ['LINE 合成域', 'u123@line.pcmmotorsports.local'],
    ['合成域的子網域', 'u123@x.line.pcmmotorsports.local'],
  ])('🔴 格式不對就拒(%s)', (_n, v) => {
    const r = parseManualOrderForm(withEmail(v));
    expect(r.ok).toBe(false);
    // 🔵 訊息要告訴他**清空也可以** —— 那是他最常見的下一步。
    expect(r.ok === false && r.error).toContain('清空');
  });

  it('🔵 負對照:一個【合法】的信箱不得被判成格式錯', () => {
    // 🛑 少了這一格, 一個「永遠拒絕」的實作會讓上面六格全綠。
    const r = parseManualOrderForm(withEmail('a+tag@sub.example.co.jp'));
    expect(r.ok).toBe(true);
  });

  it('🔵 負對照:那個看起來像合成域而不是的網域要放行', () => {
    // `evil-pcmmotorsports.local` 以它結尾而不是子網域 —— 判斷式用 `.` 前綴才分得出來。
    const r = parseManualOrderForm(withEmail('a@evil-pcmmotorsports.local'));
    expect(r.ok).toBe(true);
  });
});
