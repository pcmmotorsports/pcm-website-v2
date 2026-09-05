// node env(root vitest 預設);mock 'server-only'(bank-transfer-flag.ts 檔頭 import 'server-only')。
// 🔵 形狀逐格對齊 three-ds-flag.test.ts —— 同一種閘、同一種解析紀律, 不另創一套。
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { isBankTransferCheckoutEnabled } from './bank-transfer-flag';

const ORIGINAL = process.env.BANK_TRANSFER_CHECKOUT_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
  } else {
    process.env.BANK_TRANSFER_CHECKOUT_ENABLED = ORIGINAL;
  }
});

describe('isBankTransferCheckoutEnabled — 嚴格 opt-in、只認字面 true', () => {
  it("字面 'true' → true", () => {
    process.env.BANK_TRANSFER_CHECKOUT_ENABLED = 'true';
    expect(isBankTransferCheckoutEnabled()).toBe(true);
  });

  it.each(['false', 'TRUE', 'True', '1', 'yes', 'on', '', ' true ', 'true '])(
    '非字面 true(%j)→ false',
    (val) => {
      process.env.BANK_TRANSFER_CHECKOUT_ENABLED = val;
      expect(isBankTransferCheckoutEnabled()).toBe(false);
    },
  );

  it('🔴 未設(env 整個不存在)→ false —— 這一格是【今天正式站的世界】', () => {
    // 🛑 上面的 '' 那一格與這一格**不是同一件事**:
    //   '' 是「有設而是空字串」, 這裡是「這個 key 不存在」。
    //   而正式站今天是後者 ⇒ 少了這一格, 我驗的是一個沒有人在的世界。
    delete process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
    expect(isBankTransferCheckoutEnabled()).toBe(false);
  });
});
