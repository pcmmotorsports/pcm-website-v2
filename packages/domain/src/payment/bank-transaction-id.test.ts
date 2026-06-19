import { describe, it, expect } from 'vitest';
import { generateBankTransactionId } from './bank-transaction-id';

const FORMAT = /^[A-Z0-9]{19}$/;

describe('generateBankTransactionId — 格式硬約束(TapPay 跨收單行最嚴)', () => {
  it('長度恆 = 19', () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateBankTransactionId()).toHaveLength(19);
    }
  });

  it('恆符 ^[A-Z0-9]{19}$(純大寫英數、無小寫 / hyphen / 底線)', () => {
    for (let i = 0; i < 1000; i++) {
      const id = generateBankTransactionId();
      expect(id).toMatch(FORMAT);
      expect(id).not.toMatch(/[a-z]/); // 無小寫
      expect(id).not.toContain('-'); // 無 hyphen(排除 randomUUID)
      expect(id).not.toContain('_'); // 無底線(玉山禁)
    }
  });

  it('多次產出不重複(crypto 安全亂數、防撞)', () => {
    const seen = new Set<string>();
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      seen.add(generateBankTransactionId());
    }
    expect(seen.size).toBe(N);
  });

  it('PCM 來源前綴 P(便於 log / 對帳辨識)', () => {
    expect(generateBankTransactionId().startsWith('P')).toBe(true);
  });

  it('亂數段只用 Crockford 字母表(無易混淆 I / L / O / U)', () => {
    // 取大量樣本的亂數段(去前綴),驗證從不出現被排除字元。
    let pool = '';
    for (let i = 0; i < 2000; i++) {
      pool += generateBankTransactionId().slice(1);
    }
    expect(pool).not.toMatch(/[ILOU]/);
  });
});
