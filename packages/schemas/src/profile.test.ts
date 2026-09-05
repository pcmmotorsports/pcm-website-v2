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

  // ⛔ ~~太短(<8)→ reject~~ · ~~含字母 → reject~~
  // 🔴🔴 **這兩格【被 Sean 2026-09-04 拍板作廢】, 不是我改期望值遷就實作。**
  //    題目字面「甲 = 放寬, 跟地址頁一樣」⇒ 電話**只擋空白, 不驗格式**。
  //    成因:`⟦b4-PHONEREGEXSPLIT⟧` —— 那條 regex 的字元類沒有 `+` ⇒ 拒掉 `+886…`
  //    ⇒ 📌 **同一支電話, 客人在地址頁填得進、註冊頁填不進。**
  // 🛑 **舊字面留著加刪除線** —— 搜「手機格式不正確」想知道它去哪了的人, 要在同一發撞到這裡。
  // ✅ 而**取代它們的是下面兩格**:①那些值現在要【收得下】②而空字串在必填處仍然要擋。
  it('🔴 Sean 拍甲之後:太短 / 含字母 / +886 / 分機【全部收得下】(選填欄, 非空即可)', () => {
    for (const v of ['0911', 'abc12345', '+886-912-345-678', '02-1234-5678 #12']) {
      expect(ProfileInput.safeParse({ ...base, phone: v }).success, `擋掉了 ${v}`).toBe(true);
    }
  });

  // 🔴 **R1 抓到選填版沒有 trim(必填版有)⇒ `'   '` 會原樣寫進 DB。修了之後我跑突變:**
  //    把 `.trim()` 拿掉 ⇒ **1555 格全綠** ⇒ 📌 **那個修法沒有任何東西守著。** 所以有這一格。
  it('🔵 選填版也要 trim —— 兩版行為一致(拿掉 .trim() ⇒ 本格紅)', () => {
    const r = ProfileInput.safeParse({ ...base, phone: '  0912345678  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone, '沒 trim ⇒ 前後空白會原樣進 customers.phone').toBe('0912345678');
    const blank = ProfileInput.safeParse({ ...base, phone: '   ' });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.phone, '純空白該被 trim 成空字串').toBe('');
  });

  it('🔵 而【必填那一側】仍然擋得住空 —— 放寬的是格式, 不是必填', async () => {
    const { AddressInput } = await import('./index');
    const addr = { name: '王', line: '台北', email: 'a@b.tw', phone: '   ', invoice: { type: 'personal' } };
    expect(AddressInput.safeParse(addr).success, '純空白過了 ⇒ 放寬放過頭').toBe(false);
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
