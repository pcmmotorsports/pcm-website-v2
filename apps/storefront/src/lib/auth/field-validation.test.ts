// field-validation.test.ts — 註冊驗證的合成 email 網域 denylist(M-1-14e-f2-a2、防冒登入第二道防線)
//                          + 忘記密碼片 validateForgot / validateResetPassword 逐欄驗證
//
// 聚焦本 slice 新增的 denylist 行為(+ 對照組:正常 email 不被擋)。node env、無 server-only。

import { describe, expect, it } from 'vitest';
import { validateRegister, validateForgot, validateResetPassword } from './field-validation';

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

describe('validateForgot', () => {
  it('空 email → 「請填寫 Email」、ok=false、data=undefined', () => {
    const r = validateForgot({ email: '' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.email).toBe('請填寫 Email');
    expect(r.data).toBeUndefined();
  });

  it('格式錯 email → 沿用 zod「Email 格式不正確」', () => {
    const r = validateForgot({ email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.email).toBe('Email 格式不正確');
  });

  it('正常 email → ok=true、data 回傳該 email', () => {
    const r = validateForgot({ email: 'rider@pcm.com' });
    expect(r.ok).toBe(true);
    expect(r.fieldErrors.email).toBeUndefined();
    expect(r.data).toEqual({ email: 'rider@pcm.com' });
  });
});

describe('validateResetPassword', () => {
  it('兩次密碼一樣 → ok=true、data 回傳 password', () => {
    const r = validateResetPassword({ password: 'password123', confirm: 'password123' });
    expect(r.ok).toBe(true);
    expect(r.fieldErrors).toEqual({});
    expect(r.data).toEqual({ password: 'password123' });
  });

  it('兩次密碼不一樣 → confirm「兩次輸入的密碼不一樣」', () => {
    const r = validateResetPassword({ password: 'password123', confirm: 'password124' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.confirm).toBe('兩次輸入的密碼不一樣');
    expect(r.fieldErrors.password).toBeUndefined();
    expect(r.data).toBeUndefined();
  });

  it('confirm 空 → 「請再輸入一次密碼」', () => {
    const r = validateResetPassword({ password: 'password123', confirm: '' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.confirm).toBe('請再輸入一次密碼');
  });

  it('password 純空白(含 trim 後空) → 「請填寫密碼」', () => {
    const r = validateResetPassword({ password: '        ', confirm: '        ' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.password).toBe('請填寫密碼');
  });

  it('password 7 碼 → 「密碼至少 8 碼」(邊界:未達標)', () => {
    const r = validateResetPassword({ password: '1234567', confirm: '1234567' });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.password).toBe('密碼至少 8 碼');
  });

  it('password 8 碼 → 通過(邊界:剛好達標)', () => {
    const r = validateResetPassword({ password: '12345678', confirm: '12345678' });
    expect(r.ok).toBe(true);
    expect(r.fieldErrors.password).toBeUndefined();
  });

  it('password 含前後空白但非純空白 → 傳出值不 trim(允許密碼含空白字元)', () => {
    const r = validateResetPassword({ password: ' password123 ', confirm: ' password123 ' });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ password: ' password123 ' });
  });
});
