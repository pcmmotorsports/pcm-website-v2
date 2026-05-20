// availability.test.ts — availabilityToBool / boolToAvailability unit test
// (M-1-13e-pre-2、對齊 docs/architecture/testing-strategy.md §3、vitest node env、
//  顯式 import、簡單純函式 4 case 覆蓋雙向轉換)。

import { describe, it, expect } from 'vitest';
import { availabilityToBool, boolToAvailability } from './availability';

describe('availabilityToBool', () => {
  it("'in-stock' → true", () => {
    expect(availabilityToBool('in-stock')).toBe(true);
  });

  it("'out-of-stock' → false", () => {
    expect(availabilityToBool('out-of-stock')).toBe(false);
  });
});

describe('boolToAvailability', () => {
  it("true → 'in-stock'", () => {
    expect(boolToAvailability(true)).toBe('in-stock');
  });

  it("false → 'out-of-stock'", () => {
    expect(boolToAvailability(false)).toBe('out-of-stock');
  });
});
