// field-validation.test.ts — 註冊驗證的合成 email 網域 denylist(M-1-14e-f2-a2、防冒登入第二道防線)
//
// 聚焦本 slice 新增的 denylist 行為(+ 對照組:正常 email 不被擋)。node env、無 server-only。

import { describe, expect, it } from 'vitest';
import { validateRegister } from './field-validation';

const base = {
  name: '王小明',
  phone: '0912345678',
  password: 'password123',
  agree: true,
};

describe('validateRegister 合成 email 網域 denylist', () => {
  it('合成網域 email(line_xxx@line.pcmmotorsports.local)→ 擋下、email 逐欄錯', () => {
    const r = validateRegister({
      ...base,
      email: `line_${'a'.repeat(33)}@line.pcmmotorsports.local`,
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.email).toBe('此 Email 網域不可用於註冊');
    expect(r.data).toBeUndefined();
  });

  it('合成網域大小寫混雜也擋(case-insensitive)', () => {
    const r = validateRegister({ ...base, email: 'attacker@LINE.PcmMotorsports.Local' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.email).toBe('此 Email 網域不可用於註冊');
  });

  it('正常 email → 不被 denylist 擋(對照組、通過驗證)', () => {
    const r = validateRegister({ ...base, email: 'real.user@gmail.com' });
    expect(r.ok).toBe(true);
    expect(r.fieldErrors.email).toBeUndefined();
  });

  it('空 email → presence 訊息優先、不被 denylist 覆蓋', () => {
    const r = validateRegister({ ...base, email: '' });
    expect(r.fieldErrors.email).toBe('請填寫 Email');
  });
});
