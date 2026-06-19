// node env(root vitest 預設);mock 'server-only'(three-ds-flag.ts 檔頭 import 'server-only')。
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { isThreeDSEnabled } from './three-ds-flag';

const ORIGINAL = process.env.TAPPAY_3DS_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.TAPPAY_3DS_ENABLED;
  } else {
    process.env.TAPPAY_3DS_ENABLED = ORIGINAL;
  }
});

describe('isThreeDSEnabled — 嚴格 opt-in、只認字面 true', () => {
  it("字面 'true' → true", () => {
    process.env.TAPPAY_3DS_ENABLED = 'true';
    expect(isThreeDSEnabled()).toBe(true);
  });

  it.each(['false', 'TRUE', 'True', '1', 'yes', 'on', '', ' true ', 'true '])(
    '非字面 true(%j)→ false',
    (val) => {
      process.env.TAPPAY_3DS_ENABLED = val;
      expect(isThreeDSEnabled()).toBe(false);
    },
  );

  it('未設(undefined)→ false(預設 off)', () => {
    delete process.env.TAPPAY_3DS_ENABLED;
    expect(isThreeDSEnabled()).toBe(false);
  });
});
