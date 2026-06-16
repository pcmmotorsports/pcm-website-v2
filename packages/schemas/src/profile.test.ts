import { describe, it, expect } from 'vitest';
import { ProfileInput } from './index';

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// #197:phone/birthday 格式驗證(選填、空字串合法;填了則驗格式,server 端早於 DB 給精準欄位錯)。

const base = { name: '王小明' };

describe('ProfileInput phone 格式驗證(#197)', () => {
  it('空字串 → 合法(選填、空→action 層原樣傳遞)', () => {
    expect(ProfileInput.safeParse({ ...base, phone: '' }).success).toBe(true);
  });

  it('省略 → default 空字串 → 合法', () => {
    expect(ProfileInput.safeParse(base).success).toBe(true);
  });

  it('合法手機(≥8 數字/空白/連字號)→ 通過', () => {
    expect(ProfileInput.safeParse({ ...base, phone: '0912345678' }).success).toBe(true);
    expect(ProfileInput.safeParse({ ...base, phone: '02-2345-6789' }).success).toBe(true);
  });

  it('太短(<8)→ reject + 手機格式不正確', () => {
    const r = ProfileInput.safeParse({ ...base, phone: '0911' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'phone');
      expect(issue?.message).toBe('手機格式不正確');
    }
  });

  it('含字母 → reject', () => {
    expect(ProfileInput.safeParse({ ...base, phone: 'abc12345' }).success).toBe(false);
  });
});

describe('ProfileInput birthday 格式驗證(#197)', () => {
  it('空字串 → 合法(選填、空→action 層 normalize null)', () => {
    expect(ProfileInput.safeParse({ ...base, birthday: '' }).success).toBe(true);
  });

  it('合法 YYYY-MM-DD → 通過', () => {
    expect(ProfileInput.safeParse({ ...base, birthday: '1990-12-31' }).success).toBe(true);
  });

  it('非 YYYY-MM-DD(斜線/亂字串)→ reject + 生日格式不正確', () => {
    expect(ProfileInput.safeParse({ ...base, birthday: '1990/12/31' }).success).toBe(false);
    const r = ProfileInput.safeParse({ ...base, birthday: 'not-a-date' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'birthday');
      expect(issue?.message).toBe('生日格式不正確');
    }
  });

  it('name 仍必填(空字串 → reject、不被格式驗證鬆綁)', () => {
    expect(ProfileInput.safeParse({ name: '', phone: '', birthday: '' }).success).toBe(false);
  });
});
