import { describe, it, expect, expectTypeOf } from 'vitest';
import { CheckoutInput, CheckoutInvoiceInput, TapPayPrimeInput, createCheckoutInputSchema } from './index';
import type { AddressInput, CheckoutInvoice } from './index';
import * as schemaExports from './index';

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

  it('功能開啟時會收 Email，並只移除頭尾半形空白、把網域轉小寫', () => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    expect(createCheckoutInputSchema).toBeTypeOf('function');

    const result = createCheckoutInputSchema(true).safeParse({
      ...validBase,
      notificationEmail: ' User.Name+tag@EXAMPLE.COM ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notificationEmail).toBe('User.Name+tag@example.com');
    }
  });

  it('功能關閉時維持舊契約，忽略 client 偷塞的 Email 欄', () => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const result = createCheckoutInputSchema(false).safeParse({
      ...validBase,
      notificationEmail: 'attacker@example.com',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('notificationEmail');
    }
  });

  it.each([
    ['未提供', undefined, '請填寫 Email'],
    ['空字串', '', '請填寫 Email'],
    ['只有半形空白', '   ', '請填寫 Email'],
    ['含全形空白', '　user@example.com', 'Email 格式不正確'],
    ['含全形 @', 'user＠example.com', 'Email 格式不正確'],
    ['含換行', 'user@example.com\n', 'Email 格式不正確'],
    ['沒有 @', 'user.example.com', 'Email 格式不正確'],
    ['兩個 @', 'user@@example.com', 'Email 格式不正確'],
    ['網域沒有點', 'user@example', 'Email 格式不正確'],
  ])('功能開啟時拒絕%s', (_label, notificationEmail, expectedMessage) => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const input = { ...validBase, ...(notificationEmail === undefined ? {} : { notificationEmail }) };
    const result = createCheckoutInputSchema(true).safeParse(input);

    expect(result.success).toBe(false);
    // 🔴 以 path 取、不用 issues[0](U3a 起 issue 陣列順序不保證;codex 關卡2 nit)。
    expect(messageAt(result, 'notificationEmail')).toBe(expectedMessage);
  });

  it('以 UTF-8 bytes 驗 254 上限，不用字元數混充', () => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const exactly254 = `${'a'.repeat(242)}@example.com`;
    const over254 = `${'a'.repeat(243)}@example.com`;

    expect(new TextEncoder().encode(exactly254)).toHaveLength(254);
    expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail: exactly254 }).success).toBe(
      true,
    );
    expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail: over254 }).success).toBe(
      false,
    );
  });

  it.each([
    'x@line.pcmmotorsports.local',
    'x@LINE.PCMMOTORSPORTS.LOCAL',
    'x@line.pcmmotorsports.local.',
    'x@sub.line.pcmmotorsports.local',
  ])('拒絕 LINE 合成信箱與其繞過形式：%s', (notificationEmail) => {
    const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail }).success).toBe(false);
  });

  it.each(['x@notline.pcmmotorsports.local2.com', 'x@line.pcmmotorsports.local.example.com'])(
    '不誤擋相似但合法的網域：%s',
    (notificationEmail) => {
      const createCheckoutInputSchema = Reflect.get(schemaExports, 'createCheckoutInputSchema');
      expect(createCheckoutInputSchema(true).safeParse({ ...validBase, notificationEmail }).success).toBe(true);
    },
  );
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
  it.each([
    ['flag-off company 雙錯', false, { type: 'company' }, ['invoice.title', 'invoice.taxId']],
    ['flag-off donate 缺碼', false, { type: 'donate' }, ['invoice.donateCode']],
    ['flag-on company 雙錯', true, { type: 'company' }, ['invoice.title', 'invoice.taxId']],
  ])('%s:同一欄只出現一次 issue', (_label, flagOn, invoice, expected) => {
    const factory = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const r = factory(flagOn).safeParse({
      addressId: '00000000-0000-4000-8000-000000000000',
      shippingMethod: 'home',
      invoice,
      ...(flagOn ? { notificationEmail: 'a@b.com' } : {}),
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

  // 🔴 結構性防漂移(U3a 的核心價值):flag-off 與 flag-on 兩個 schema 都必須指向同一實例。
  it('flag-off / flag-on 的 invoice 都是同一個 canonical 實例', () => {
    const factory = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    expect(CheckoutInput.shape.invoice).toBe(CheckoutInvoiceInput);
    expect(factory(true).shape.invoice).toBe(CheckoutInvoiceInput);
    expect(factory(false).shape.invoice).toBe(CheckoutInvoiceInput);
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
      invoice: { type: 'company' },
    });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'shippingMethod')).toBe('請選擇配送方式');
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('flag-on 缺 Email(fatal)時,發票錯誤仍然一起報出', () => {
    const factory = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const r = factory(true).safeParse({ addressId: uuid, shippingMethod: 'home', invoice: { type: 'donate' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'notificationEmail')).toBe('請填寫 Email');
    expect(messageAt(r, 'invoice.donateCode')).toBe('請填愛心碼');
  });

  // ④ 順序不保證:明確鎖住「不得依賴 issues[0]」這件事,免得未來有人寫出脆弱的消費端。
  it('flag-on 多錯時發票錯誤可能排在 Email 之前 → 消費端不得用 issues[0]', () => {
    const factory = Reflect.get(schemaExports, 'createCheckoutInputSchema');
    const r = factory(true).safeParse({ addressId: uuid, shippingMethod: 'home', invoice: { type: 'company' } });
    if (r.success) throw new Error('預期 parse 失敗,但通過了');
    const paths = r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('notificationEmail');
    expect(paths).toContain('invoice.title');
    expect(paths).toContain('invoice.taxId');
    expect(paths.indexOf('invoice.title')).toBeLessThan(paths.indexOf('notificationEmail'));
  });

  // ① 驗證零放寬:fatal 兄弟欄位在兩版都必然 reject,不因多報而變成通過。
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
// 🔴 為什麼需要這一組:runtime 測試全部走 `Reflect.get` 取 factory,型別被抹掉 →
//    「把 createCheckoutInputSchema 兩個 overload 的回傳型別對調」這個突變,**所有 vitest 仍會綠**,
//    但公開型別會反過來宣稱 flag-off 必須有 Email、flag-on 沒有。這種錯只有型別斷言擋得住。
//    本檔在 tsconfig 內,`pnpm typecheck`(tsc --noEmit)會實際檢查以下斷言。
describe('U3a 型別層契約', () => {
  it('flag-on 才有 notificationEmail、flag-off 沒有(overload 不可對調)', () => {
    const on = createCheckoutInputSchema(true);
    const off = createCheckoutInputSchema(false);
    // 🔴 純型別斷言:不可寫成 expectTypeOf(on.parse(...)) —— 參數在 runtime 仍會被求值、parse 會丟例外。
    expectTypeOf<ReturnType<typeof on.parse>>().toHaveProperty('notificationEmail');
    expectTypeOf<ReturnType<typeof off.parse>>().not.toHaveProperty('notificationEmail');
    // runtime 也一起釘,避免型別對了但實作分支接反。
    expect(Object.keys(on.shape)).toContain('notificationEmail');
    expect(Object.keys(off.shape)).not.toContain('notificationEmail');
  });

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
