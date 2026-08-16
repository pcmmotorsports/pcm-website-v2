// amount-form.test.ts — 改品項金額表單解析(M-4b E10 #13 片1c-1)。
//
// 🔴 用**真 FormData**,不用手寫假表單 —— 手寫的假表單「單值情境永遠只回一筆」,
//    正好測不出重複欄位那族(理由逐字見 `workflow-form.test.ts` 的同段註解)。

import { describe, it, expect } from 'vitest';
import {
  parseAmountForm,
  AMOUNT_ORDER_ID_FIELD,
  AMOUNT_ORDER_ITEM_ID_FIELD,
  AMOUNT_VERSION_FIELD,
  AMOUNT_UNIT_PRICE_FIELD,
  AMOUNT_ZERO_PRICE_REASON_FIELD,
  AMOUNT_RETURN_TO_FIELD,
  AMOUNT_SINGLE_FIELDS,
  type AmountFormLike,
} from './amount-form';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function form(entries: Record<string, string>): AmountFormLike {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

/** 正常可過的一份(單價 > 0、無零元原因)。 */
function ok(overrides: Record<string, string> = {}) {
  return form({
    [AMOUNT_ORDER_ID_FIELD]: ORDER,
    [AMOUNT_ORDER_ITEM_ID_FIELD]: ITEM,
    [AMOUNT_VERSION_FIELD]: '3',
    [AMOUNT_UNIT_PRICE_FIELD]: '1200',
    ...overrides,
  });
}

describe('parseAmountForm — 正向', () => {
  it('單價 > 0、無原因 ⇒ ok,且 zeroPriceReason 是【顯式 null】不是 undefined', () => {
    const r = parseAmountForm(ok());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe(ORDER);
    expect(r.expectedVersion).toBe(3);
    expect(r.patch).toEqual({ orderItemId: ITEM, unitPrice: 1200, zeroPriceReason: null });
    // 🔴 顯式 null 是契約的一部分:adapter 那層靠 `Required<…Args>` 讓「忘了帶」變編譯錯誤,
    //    而送 undefined 會在 JSON 序列化時整個鍵消失 ⇒ RPC 拿到 DEFAULT NULL、反向閘也過。
    expect('zeroPriceReason' in r.patch).toBe(true);
    expect(r.patch.zeroPriceReason).toBeNull();
  });

  it('單價 = 0 且有原因 ⇒ ok,原因被 trim', () => {
    const r = parseAmountForm(
      ok({ [AMOUNT_UNIT_PRICE_FIELD]: '0', [AMOUNT_ZERO_PRICE_REASON_FIELD]: '  贈品  ' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.unitPrice).toBe(0);
    expect(r.patch.zeroPriceReason).toBe('贈品');
  });

  it('return_to 非站內 ⇒ 退回本單明細頁(不是列表)', () => {
    const r = parseAmountForm(ok({ [AMOUNT_RETURN_TO_FIELD]: 'https://evil.example/x' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.returnTo).toBe(`/orders/${ORDER}`);
  });
});

describe('parseAmountForm — #517 整數閘(RPC 只驗 IS NULL OR < 0、沒驗整數)', () => {
  // 🔴 這一族是 backlog #517 在應用層的處置。**它關掉那條路,不回答「RPC 端會怎樣」**
  //    ⇒ #517 不得因為這些格存在就標為已解。
  for (const bad of ['12.5', '-1', '1,200', '1e3', ' 100', '100 ', '', 'abc', '٣', '1.0']) {
    it(`非十進位非負整數 ⇒ ok:false(${JSON.stringify(bad)})`, () => {
      expect(parseAmountForm(ok({ [AMOUNT_UNIT_PRICE_FIELD]: bad })).ok).toBe(false);
    });
  }

  it('0 是合法的(它走零元那條路,不是被整數閘擋掉)', () => {
    const r = parseAmountForm(
      ok({ [AMOUNT_UNIT_PRICE_FIELD]: '0', [AMOUNT_ZERO_PRICE_REASON_FIELD]: '換貨補寄' }),
    );
    expect(r.ok).toBe(true);
  });

  it('int4 上限:2147483647 過、2147483648 拒', () => {
    expect(parseAmountForm(ok({ [AMOUNT_UNIT_PRICE_FIELD]: '2147483647' })).ok).toBe(true);
    expect(parseAmountForm(ok({ [AMOUNT_UNIT_PRICE_FIELD]: '2147483648' })).ok).toBe(false);
  });

  it('🔴 前導零的合法值要過(codex R1 MF1:判的是【值】不是【字串長度】)', () => {
    // `/^\d{1,10}$/` 那種寫法會把這個擋掉,而它就是 1。誤擋 = 員工看到 invalid 卻不知錯在哪。
    const r = parseAmountForm(ok({ [AMOUNT_UNIT_PRICE_FIELD]: '00000000001' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.unitPrice).toBe(1);
  });

  it('🔴 version 同一條路:前導零過、且值仍是原本那個數', () => {
    const r = parseAmountForm(ok({ [AMOUNT_VERSION_FIELD]: '00000000003' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expectedVersion).toBe(3);
  });

  it('🔴 長到失去精度的數字要拒(不能只靠上限比較 —— 它轉成 number 就已經不是原來那個數)', () => {
    const huge = '9'.repeat(30);
    expect(Number(huge) > 2147483647).toBe(true); // 上限比較「看起來」擋得住
    expect(Number.isSafeInteger(Number(huge))).toBe(false); // 但它已經不精確了
    expect(parseAmountForm(ok({ [AMOUNT_UNIT_PRICE_FIELD]: huge })).ok).toBe(false);
  });
});

describe('parseAmountForm — 零元原因兩道互斥(對齊 RPC :366 / :371)', () => {
  it('單價 = 0 而沒有原因 ⇒ ok:false', () => {
    expect(parseAmountForm(ok({ [AMOUNT_UNIT_PRICE_FIELD]: '0' })).ok).toBe(false);
  });

  it('單價 = 0 而原因只有空白 ⇒ ok:false(空白不算填了)', () => {
    expect(
      parseAmountForm(
        ok({ [AMOUNT_UNIT_PRICE_FIELD]: '0', [AMOUNT_ZERO_PRICE_REASON_FIELD]: '   ' }),
      ).ok,
    ).toBe(false);
  });

  it('🔴 單價 > 0 卻帶原因 ⇒ ok:false(反向那道;防它退化成前端恆填樣板字)', () => {
    expect(
      parseAmountForm(ok({ [AMOUNT_ZERO_PRICE_REASON_FIELD]: '贈品' })).ok,
    ).toBe(false);
  });

  it('單價 > 0 而原因欄提供但為空 ⇒ ok(空 = 沒有原因)', () => {
    expect(parseAmountForm(ok({ [AMOUNT_ZERO_PRICE_REASON_FIELD]: '' })).ok).toBe(true);
  });
});

describe('parseAmountForm — 形狀層 fail-closed', () => {
  it('order_id / order_item_id 非 UUID ⇒ 拒', () => {
    expect(parseAmountForm(ok({ [AMOUNT_ORDER_ID_FIELD]: 'nope' })).ok).toBe(false);
    expect(parseAmountForm(ok({ [AMOUNT_ORDER_ITEM_ID_FIELD]: 'nope' })).ok).toBe(false);
  });

  it('version 非 1..2147483646 整數 ⇒ 拒', () => {
    for (const bad of ['0', '-1', '1.5', '', 'x', '2147483647']) {
      expect(parseAmountForm(ok({ [AMOUNT_VERSION_FIELD]: bad })).ok).toBe(false);
    }
    expect(parseAmountForm(ok({ [AMOUNT_VERSION_FIELD]: '1' })).ok).toBe(true);
  });

  it('缺任一必要欄 ⇒ 拒', () => {
    for (const field of [
      AMOUNT_ORDER_ID_FIELD,
      AMOUNT_ORDER_ITEM_ID_FIELD,
      AMOUNT_VERSION_FIELD,
      AMOUNT_UNIT_PRICE_FIELD,
    ]) {
      const data = new FormData();
      for (const [k, v] of Object.entries({
        [AMOUNT_ORDER_ID_FIELD]: ORDER,
        [AMOUNT_ORDER_ITEM_ID_FIELD]: ITEM,
        [AMOUNT_VERSION_FIELD]: '3',
        [AMOUNT_UNIT_PRICE_FIELD]: '1200',
      })) {
        if (k !== field) data.set(k, v);
      }
      expect(parseAmountForm(data).ok).toBe(false);
    }
  });
});

describe('parseAmountForm — 入口擋門(anyMalformed)的判別力', () => {
  // 🔴 `single-value.ts` 檔頭的判準:**先問「這個欄位的 null 在下游代表放行還是代表拒」**。
  //    本解析器裡 order_id / order_item_id / version / unit_price 的 null 都直接 ok:false
  //    ⇒ 對那四欄,擋門是零判別力的。
  //    **而 `zero_price_reason` 不同**:它的 `invalid` 會被收斂成「沒有原因」,
  //    在「單價 > 0」那條路上代表**放行** ⇒ 擋門對這一欄是承重的。這一格就是釘它。
  it('🔴 zero_price_reason 送兩份 + 單價 > 0 ⇒ 必須拒(沒有擋門的話會被讀成「沒有原因」而放行)', () => {
    const data = new FormData();
    data.set(AMOUNT_ORDER_ID_FIELD, ORDER);
    data.set(AMOUNT_ORDER_ITEM_ID_FIELD, ITEM);
    data.set(AMOUNT_VERSION_FIELD, '3');
    data.set(AMOUNT_UNIT_PRICE_FIELD, '1200');
    data.append(AMOUNT_ZERO_PRICE_REASON_FIELD, '');
    data.append(AMOUNT_ZERO_PRICE_REASON_FIELD, '贈品');
    expect(parseAmountForm(data).ok).toBe(false);
  });

  it('unit_price 送兩份 ⇒ 拒', () => {
    const data = new FormData();
    data.set(AMOUNT_ORDER_ID_FIELD, ORDER);
    data.set(AMOUNT_ORDER_ITEM_ID_FIELD, ITEM);
    data.set(AMOUNT_VERSION_FIELD, '3');
    data.append(AMOUNT_UNIT_PRICE_FIELD, '1200');
    data.append(AMOUNT_UNIT_PRICE_FIELD, '0');
    expect(parseAmountForm(data).ok).toBe(false);
  });
});

describe('AMOUNT_SINGLE_FIELDS — 完整性守門(源碼契約)', () => {
  // ⚠️ 漏列一欄 ⇒ 那一欄退回「三態各自處理」,仍 fail-closed 但變成靜默不送。
  //    這一格拿手寫清單比對那顆常數(同 `WORKFLOW_SINGLE_FIELDS` 先例)。
  it('恰好是這五個欄名,順序不拘', () => {
    expect([...AMOUNT_SINGLE_FIELDS].sort()).toEqual(
      ['order_id', 'order_item_id', 'unit_price', 'version', 'zero_price_reason'].sort(),
    );
  });

  it('return_to 刻意不在清單內(它決定不了寫什麼、只決定停在哪一頁)', () => {
    expect([...AMOUNT_SINGLE_FIELDS]).not.toContain('return_to');
  });
});
