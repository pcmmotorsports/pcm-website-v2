import { describe, it, expect } from 'vitest';
import { AddressInput, CheckoutInvoiceInput } from './index';

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// #201:name/line 必填欄純空白 trim(對齊 design saveAddress L705 !form.name.trim()||!form.line.trim())。
// U3a:發票規則改由 canonical `CheckoutInvoiceInput` 提供(原本 Address / Checkout 各抄一份);
//   本檔以「特徵測試」鎖住重構前後必須相同的行為,詳 checkout.test.ts 的 U3a 等價性說明。

const valid = { name: '王小明', line: '台北市信義區市府路 1 號', invoice: { type: 'personal' } };

/** 取指定 path 的 issue message(path 以 '.' 串接比對,避免只驗 path[0] 漏掉巢狀層)。 */
function messageAt(result: ReturnType<typeof AddressInput.safeParse>, path: string): string | undefined {
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join('.') === path)?.message;
}

/** 取所有 issue 的 path 字串(不去重)——用來驗「同一欄只報一次」。 */
function pathsOf(result: ReturnType<typeof AddressInput.safeParse>): string[] {
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join('.'));
}

describe('AddressInput name/line 純空白 trim(#201)', () => {
  it('合法地址(invoice 子欄 default 補齊)→ 通過', () => {
    expect(AddressInput.safeParse(valid).success).toBe(true);
  });

  it('純空白 name → reject「請填寫收件人」(trim 後為空)', () => {
    const r = AddressInput.safeParse({ ...valid, name: '   ' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'name');
      expect(issue?.message).toBe('請填寫收件人');
    }
  });

  it('純空白 line → reject「請填寫地址」(trim 後為空)', () => {
    const r = AddressInput.safeParse({ ...valid, line: '  \t ' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'line');
      expect(issue?.message).toBe('請填寫地址');
    }
  });

  it('頭尾空白 name/line → 通過且入庫值去空白', () => {
    const parsed = AddressInput.parse({ ...valid, name: '  王小明 ', line: ' 台北市 ' });
    expect(parsed.name).toBe('王小明');
    expect(parsed.line).toBe('台北市');
  });
});

// === U3a:發票規則(重構前後必須完全相同的特徵測試)===
// 🔴 這組測試在「抽 canonical schema」之前與之後都必須全綠 —— 它們是等價性的機械證據,
//    不是新行為。重構前先跑一次確認全綠,才有資格說「規則沒被我改掉」。
describe('AddressInput 發票跨欄位規則(U3a canonical schema)', () => {
  it('personal:不驗公司/捐贈欄,且五個子欄由 default 補齊', () => {
    const parsed = AddressInput.parse(valid);
    expect(parsed.invoice).toEqual({
      type: 'personal',
      carrier: '',
      title: '',
      taxId: '',
      donateCode: '',
    });
  });

  it('company 缺抬頭 → issue path 為完整巢狀 invoice.title', () => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'company', taxId: '12345678' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
  });

  it.each([
    ['非 8 碼', '123'],
    ['9 碼', '123456789'],
    ['含非數字', '1234567a'],
    ['空字串', ''],
  ])('company 統編%s → issue path 為完整巢狀 invoice.taxId', (_label, taxId) => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'company', title: 'PCM', taxId } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('company 抬頭與統編同時錯 → 兩條 issue 一起出現(不逐一阻擋)', () => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'company' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('company 齊全 → 通過', () => {
    expect(
      AddressInput.safeParse({ ...valid, invoice: { type: 'company', title: 'PCM 重機', taxId: '12345678' } })
        .success,
    ).toBe(true);
  });

  it('donate 缺愛心碼 → issue path 為完整巢狀 invoice.donateCode', () => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'donate' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.donateCode')).toBe('請填愛心碼');
  });

  it('donate 有碼 → 通過', () => {
    expect(AddressInput.safeParse({ ...valid, invoice: { type: 'donate', donateCode: '520' } }).success).toBe(
      true,
    );
  });

  it('切到 personal 時,殘留的公司/捐贈欄不再阻擋(隱藏類型錯誤不殘留)', () => {
    expect(
      AddressInput.safeParse({ ...valid, invoice: { type: 'personal', title: '', taxId: '1', donateCode: '' } })
        .success,
    ).toBe(true);
  });

  // 🔴 結構性防漂移:兩張表單必須指向「同一個 schema 物件」,不是兩份長得一樣的定義。
  //    若有人未來把其中一邊改回自己的 z.object,這條會立刻轉紅 —— 這是 U3a 的核心價值。
  it('AddressInput.invoice 與 canonical CheckoutInvoiceInput 是同一個 schema 實例', () => {
    expect(AddressInput.shape.invoice).toBe(CheckoutInvoiceInput);
  });

  // 🔴 Address 端的 fatal sibling 案例(codex 關卡2 must-fix:原本只有 Checkout 端有)。
  //    isDefault 送非 boolean → invalid_type(fatal)。U3a 之前外層 superRefine 會被 zod 中止、
  //    發票錯誤整組消失;之後發票規則住在 invoice 欄自己身上,兩種錯誤一起報。
  //    正常 UI 打不出來(isDefault 由 checkbox 產生),需繞過前端直打 server action。
  it('fatal 兄弟欄位(isDefault 型別錯)不再吞掉發票錯誤', () => {
    const r = AddressInput.safeParse({
      ...valid,
      isDefault: '不是 boolean',
      invoice: { type: 'company' },
    });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'isDefault')).toBeTruthy();
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('fatal 兄弟欄位存在時仍然 reject(等價性:驗證零放寬)', () => {
    expect(AddressInput.safeParse({ ...valid, isDefault: '不是 boolean' }).success).toBe(false);
    expect(AddressInput.safeParse({ ...valid, phone: 42 }).success).toBe(false);
  });

  // 🔴 code-reviewer 關卡 Critical:上面那條 `toBe` **擋不住最可能的回歸**。
  //    zod 4 的 `z.object({...}).superRefine(...)` 回傳仍是 ZodObject、`.shape.invoice` 不變,
  //    所以「invoice 仍指 canonical、但有人把規則複製回外層 superRefine」(= U3a 之前的原形)
  //    會讓同一個 path 出現**兩條**相同 issue,而 messageAt 用 `.find()` 取第一條 → 全部測試照樣綠。
  //    實測證實:加回外層重複規則後 63 條全綠。唯一擋得住的是「同一欄只能報一次」。
  it.each([
    ['company 雙錯', { type: 'company' }, ['invoice.title', 'invoice.taxId']],
    ['donate 缺碼', { type: 'donate' }, ['invoice.donateCode']],
  ])('%s:同一欄只出現一次 issue(擋規則被複製回外層的回歸)', (_label, invoice, expected) => {
    const paths = pathsOf(AddressInput.safeParse({ ...valid, invoice }));
    for (const p of expected) {
      expect(paths.filter((x) => x === p)).toHaveLength(1);
    }
  });
});
