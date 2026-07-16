// customer-detail-view.test.ts — 客戶明細顯示層純函式單測(M-4a 客戶明細-a)。
// isCustomerId 形狀守門 / 儲值金類型標籤覆蓋 / 金額格式化(signed 流水 + 餘額)。

import { describe, it, expect } from 'vitest';
import type { InvoiceType, WalletEntryType } from '@pcm/domain';
import {
  isCustomerId,
  WALLET_ENTRY_LABEL,
  ADDRESS_INVOICE_LABEL,
  formatWalletEntryAmount,
  formatWalletBalance,
} from './customer-detail-view';

describe('isCustomerId', () => {
  it('合法 UUID(含大寫)→ true', () => {
    expect(isCustomerId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isCustomerId('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('非 UUID(空字串/任意文字/SQL 注入字面/缺段)→ false、不打 DB', () => {
    expect(isCustomerId('')).toBe(false);
    expect(isCustomerId('abc')).toBe(false);
    expect(isCustomerId("1' OR '1'='1")).toBe(false);
    expect(isCustomerId('123e4567-e89b-12d3-a456')).toBe(false);
    // 前後綴殘餘(anchor 守門)
    expect(isCustomerId('x123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(isCustomerId('123e4567-e89b-12d3-a456-426614174000\n')).toBe(false);
  });
});

describe('WALLET_ENTRY_LABEL', () => {
  it('三值全覆蓋、字面對齊 domain WalletEntryType 語意(儲值/消費折抵/退款返還)', () => {
    const all: WalletEntryType[] = ['deposit', 'use', 'refund'];
    expect(all.map((t) => WALLET_ENTRY_LABEL[t])).toEqual(['儲值', '消費折抵', '退款返還']);
  });
});

describe('ADDRESS_INVOICE_LABEL', () => {
  it('三值全覆蓋、字面對齊 domain InvoiceType 語意(個人/公司/捐贈)', () => {
    const all: InvoiceType[] = ['personal', 'company', 'donate'];
    expect(all.map((t) => ADDRESS_INVOICE_LABEL[t])).toEqual(['個人', '公司', '捐贈']);
  });
});

describe('formatWalletEntryAmount(signed 流水)', () => {
  it('正數 → +NT$ 千分位(deposit/refund)', () => {
    expect(formatWalletEntryAmount(30000)).toBe('+NT$ 30,000');
    expect(formatWalletEntryAmount(1)).toBe('+NT$ 1');
  });

  it('負數 → −NT$ 千分位(use;U+2212)', () => {
    expect(formatWalletEntryAmount(-5000)).toBe('−NT$ 5,000');
  });
});

describe('formatWalletBalance(餘額/累積、無正號)', () => {
  it('非負 → NT$ 千分位(0 也誠實顯示)', () => {
    expect(formatWalletBalance(12340)).toBe('NT$ 12,340');
    expect(formatWalletBalance(0)).toBe('NT$ 0');
  });

  it('負餘額(理論不應發生)→ 誠實顯示 −、不吞號', () => {
    expect(formatWalletBalance(-100)).toBe('−NT$ 100');
  });
});
