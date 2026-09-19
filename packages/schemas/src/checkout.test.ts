import { describe, it, expect, expectTypeOf } from 'vitest';
import { CheckoutInput, CheckoutInvoiceInput, TapPayPrimeInput } from './index';
import type { AddressInput, CheckoutInvoice } from './index';

/** 取指定 path 的 issue message(path 以 '.' 串接比對,不只驗 path[0])。 */
function messageAt(result: { success: boolean } & Record<string, unknown>, path: string): string | undefined {
  if (result.success) return undefined;
  const error = result.error as { issues: { path: PropertyKey[]; message: string }[] };
  return error.issues.find((i) => i.path.join('.') === path)?.message;
}

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// M-1-14c 的 6 組 schema 靠消費端 actions.test.ts 間接驗;本片改為「schema 直接單元測」(更早抓 zod 漂移)。
describe('CheckoutInput', () => {
  const validBase = {
    addressId: '00000000-0000-4000-8000-000000000000',
    shippingMethod: 'home',
    // 🔵 段 1-B:必填、無預設(tappay = 今天線上唯一那個世界)。
    paymentChannel: 'tappay',
    invoice: { type: 'personal' },
  };

  it('should accept a valid personal-invoice checkout (invoice 子欄 default 補齊)', () => {
    expect(CheckoutInput.safeParse(validBase).success).toBe(true);
  });

  it('should reject a non-uuid / empty addressId', () => {
    expect(CheckoutInput.safeParse({ ...validBase, addressId: '' }).success).toBe(false);
    expect(CheckoutInput.safeParse({ ...validBase, addressId: 'not-a-uuid' }).success).toBe(false);
  });

  it('should reject an unknown shipping method (對齊 RPC home/store 白名單)', () => {
    expect(CheckoutInput.safeParse({ ...validBase, shippingMethod: 'cvs' }).success).toBe(false);
  });

  it('should accept store pickup', () => {
    expect(CheckoutInput.safeParse({ ...validBase, shippingMethod: 'store' }).success).toBe(true);
  });

  it('should require title + 8-digit taxId for company invoice', () => {
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'company', title: '', taxId: '123' },
      }).success,
    ).toBe(false);
  });

  it('should accept a valid company invoice', () => {
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'company', title: 'PCM 重機', taxId: '12345678' },
      }).success,
    ).toBe(true);
  });

  it('should require donateCode for donate invoice', () => {
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'donate', donateCode: '' },
      }).success,
    ).toBe(false);
    expect(
      CheckoutInput.safeParse({
        ...validBase,
        invoice: { type: 'donate', donateCode: '520' },
      }).success,
    ).toBe(true);
  });

  it('client 偷塞的 Email 欄被 strip —— 那一格拿掉之後它不是任何候選', () => {
    const result = CheckoutInput.safeParse({
      ...validBase,
      notificationEmail: 'attacker@example.com',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('notificationEmail');
    }
  });

});

// === U3a:canonical 發票 schema(唯一真相,Address 與 Checkout 共用同一實例)===
//
// 🔴 等價性的誠實邊界(Sean 2026-07-22 拍 A;plan §⑥ 已同步改寫):
//   重構前發票規則掛在**外層** superRefine,zod 4 遇到 fatal issue(`invalid_type` /
//   z.enum 的 `invalid_value`)會中止外層 checks → 發票錯誤被吞掉;重構後規則住在
//   invoice 欄位自己的 parse 內,不受兄弟欄位影響 → 會一併報出。
//   實測(窮舉 21,546 組輸入)結論:
//     ① accept/reject 完全等價 —— 沒有任何輸入從「拒」變「收」,驗證零放寬。
//     ② 成功案的 parsed output 完全等價(defaults / strip 一致)。
//     ③ 失敗案的 issue 集合恆為**超集**(只增不減)。
//     ④ issue **陣列順序不保證等價**(flag-on 時發票錯誤會排在 notificationEmail 之前)
//        → 任何消費端都不得用「第一個 issue」當欄位錯誤來源;現行兩個 action 都是
//        逐欄建 map(charge-actions.ts / account/address/actions.ts),不受影響。
//   下方 describe 就是把 ①②③④ 逐條釘死的守門測試。
describe('CheckoutInvoiceInput(canonical 發票 schema)', () => {
  it('單獨使用時 issue path 不帶 invoice 前綴(內層只寫 title/taxId/donateCode)', () => {
    const r = CheckoutInvoiceInput.safeParse({ type: 'company' });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'taxId')).toBe('統編需 8 碼數字');
  });

  it('巢狀 compose 後前綴由 zod 自動補成 invoice.*(不手動拼字串)', () => {
    const r = CheckoutInput.safeParse({
      addressId: '00000000-0000-4000-8000-000000000000',
      shippingMethod: 'home',
      // 🔵 段 1-B:必填、無預設(tappay = 今天線上唯一那個世界)。
      paymentChannel: 'tappay',
      invoice: { type: 'company' },
    });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('捐贈缺愛心碼 → donateCode', () => {
    expect(messageAt(CheckoutInvoiceInput.safeParse({ type: 'donate' }), 'donateCode')).toBe('請填愛心碼');
  });

  // 🔴 code-reviewer 關卡 Critical(同 address.test.ts):`toBe` 實例同一性擋不住
  //    「invoice 仍指 canonical、但規則被複製回外層 superRefine」——那會讓同一 path 出現兩條 issue,
  //    而以 `.find()` 取值的斷言全部照樣綠(實測 63 條全綠)。唯一擋得住的是「同一欄只報一次」。
  // ⛔ ~~原本三列, 其中一列是 flag-on~~ ⇒ 2026-09-19 那格拿掉後沒有第二種 schema, 兩列即窮盡。
  it.each([
    ['company 雙錯', { type: 'company' }, ['invoice.title', 'invoice.taxId']],
    ['donate 缺碼', { type: 'donate' }, ['invoice.donateCode']],
  ])('%s:同一欄只出現一次 issue', (_label, invoice, expected) => {
    const r = CheckoutInput.safeParse({
      addressId: '00000000-0000-4000-8000-000000000000',
      shippingMethod: 'home',
      // 🔵 段 1-B:必填、無預設(tappay = 今天線上唯一那個世界)。
      paymentChannel: 'tappay',
      invoice,
    });
    if (r.success) throw new Error('預期 parse 失敗,但通過了');
    const paths = r.error.issues.map((i) => i.path.join('.'));
    for (const p of expected) {
      expect(paths.filter((x) => x === p)).toHaveLength(1);
    }
  });

  it('五個子欄 default 補齊', () => {
    expect(CheckoutInvoiceInput.parse({ type: 'personal' })).toEqual({
      type: 'personal',
      carrier: '',
      title: '',
      taxId: '',
      donateCode: '',
    });
  });

  // 🔴 結構性防漂移:結帳 schema 的 invoice 必須就是那個 canonical 實例(不是複製一份)。
  //    ⛔ ~~原本還比 flag-on / flag-off 兩個 schema~~ ⇒ 2026-09-19 那格拿掉後只剩一個。
  it('CheckoutInput 的 invoice 就是同一個 canonical 實例', () => {
    expect(CheckoutInput.shape.invoice).toBe(CheckoutInvoiceInput);
  });
});

describe('U3a 等價性邊界:fatal 兄弟欄位不再吞掉發票錯誤', () => {
  const uuid = '00000000-0000-4000-8000-000000000000';

  // 🔴 這幾條在重構前是 FAIL 的(舊版外層 superRefine 被 zod 中止、發票錯誤消失),
  //    重構後轉綠 = 行為差異的機械證據。正常 UI 操作打不出這些輸入(配送方式只有
  //    兩顆按鈕、型別由表單保證),需要繞過前端直打 server action 才做得到。
  it('配送方式非白名單(fatal)時,發票錯誤仍然一起報出', () => {
    const r = CheckoutInput.safeParse({
      addressId: uuid,
      shippingMethod: 'cvs',
      // 🔵 段 1-B:必填、無預設(tappay = 今天線上唯一那個世界)。
      paymentChannel: 'tappay',
      invoice: { type: 'company' },
    });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'shippingMethod')).toBe('請選擇配送方式');
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it.each([
    ['配送方式非法', { addressId: uuid, shippingMethod: 'cvs', invoice: { type: 'personal' } }],
    ['addressId 非 uuid', { addressId: 'nope', shippingMethod: 'home', invoice: { type: 'personal' } }],
    ['addressId 型別錯', { addressId: 42, shippingMethod: 'home', invoice: { type: 'personal' } }],
    ['發票型別非白名單', { addressId: uuid, shippingMethod: 'home', invoice: { type: 'bogus' } }],
  ])('%s → 仍然 reject(等價性 ①:驗證零放寬)', (_label, input) => {
    expect(CheckoutInput.safeParse(input).success).toBe(false);
  });
});

// === U3a:型別層守門(codex 關卡2 must-fix)===
//
// 🔴 為什麼需要這一組:有些契約只有型別擋得住,runtime 測試看不見。
//    ⛔ ~~原本這裡還釘著 createCheckoutInputSchema 兩個 overload 不可對調~~
//       ⇒ 2026-09-19 那格拿掉、factory 退場, 那個突變不存在了。
//    本檔在 tsconfig 內,`pnpm typecheck`(tsc --noEmit)會實際檢查以下斷言。
describe('U3a 型別層契約', () => {
  it('CheckoutInvoiceInput(input)四個 default 欄選填、CheckoutInvoice(output)五欄齊全', () => {
    expectTypeOf<CheckoutInvoiceInput['title']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<CheckoutInvoiceInput['carrier']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<CheckoutInvoice['title']>().toEqualTypeOf<string>();
    expectTypeOf<CheckoutInvoice['donateCode']>().toEqualTypeOf<string>();
    expect(CheckoutInvoiceInput.parse({ type: 'personal' }).title).toBe('');
  });

  it('AddressInput.invoice 的型別 = canonical output(compose 後型別未退化)', () => {
    expectTypeOf<AddressInput['invoice']>().toEqualTypeOf<CheckoutInvoice>();
  });
});

// === TapPayPrimeInput(M-3 ②-③d)===
describe('TapPayPrimeInput', () => {
  it('合法 prime(trim 後非空、≤512)→ 通過且回 trim 後值', () => {
    const res = TapPayPrimeInput.safeParse('  prime_abc123  ');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBe('prime_abc123');
    }
  });

  it.each([
    ['空字串', ''],
    ['純空白', '   '],
  ])('%s → 拒(不送空 prime 給 TapPay)', (_label, v) => {
    expect(TapPayPrimeInput.safeParse(v).success).toBe(false);
  });

  it('超長(>512)→ 拒(防呆 cap)', () => {
    expect(TapPayPrimeInput.safeParse('x'.repeat(513)).success).toBe(false);
  });

  it('非字串(數字/物件)→ 拒', () => {
    expect(TapPayPrimeInput.safeParse(123).success).toBe(false);
    expect(TapPayPrimeInput.safeParse({ prime: 'x' }).success).toBe(false);
  });
});

describe('⟦b4-COUPONFIELD⟧ 片 A · 券碼欄(選填、只剝頭尾、不改大小寫)', () => {
  // 🔵 與上面那個 describe 的 validBase 同一份形狀(它是那個 describe 的區域變數, 這裡自己來一份)
  const validBase = {
    addressId: '00000000-0000-4000-8000-000000000000',
    shippingMethod: 'home',
    paymentChannel: 'tappay',
    invoice: { type: 'personal' },
  };
  const parse = (couponCode: unknown) =>
    CheckoutInput.safeParse({ ...validBase, ...(couponCode === undefined ? {} : { couponCode }) });

  it('🟢 不填 ⇒ 過, 而且 data 上沒有那個鍵(與今天「不帶 p_coupon_code」同語意)', () => {
    const r = parse(undefined);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.couponCode).toBeUndefined();
  });

  it('🟢 只剝頭尾空白, 大小寫與中間空白原樣留著(正規化的真來源是 redeem_coupon:20260831160000:200)', () => {
    const r = parse('  save10  ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.couponCode).toBe('save10');
    const mid = parse('SA VE10');
    expect(mid.success).toBe(true);
    if (mid.success) expect(mid.data.couponCode).toBe('SA VE10');
  });

  it('🟢 純空白 ⇒ 當成沒填(undefined), 不是空字串', () => {
    const r = parse('    ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.couponCode).toBeUndefined();
  });

  it('🔴 超過 64 字 ⇒ 擋下來(這一層自己的上限, DB 沒有)', () => {
    expect(parse('A'.repeat(65)).success).toBe(false);
    expect(parse('A'.repeat(64)).success).toBe(true);
  });

  it('🔵 負對照:非字串 ⇒ 不過(client 偷塞物件不會靜靜通過)', () => {
    expect(parse({ code: 'SAVE10' }).success).toBe(false);
    expect(parse(123).success).toBe(false);
  });
});
