import { describe, it, expect } from 'vitest';
import { AddressInput } from './index';

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// #201:name/line 必填欄純空白 trim(對齊 design saveAddress L705 !form.name.trim()||!form.line.trim())。

const valid = { name: '王小明', line: '台北市信義區市府路 1 號', invoice: { type: 'personal' } };

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
