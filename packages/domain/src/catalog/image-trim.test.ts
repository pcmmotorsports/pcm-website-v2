// parseImageTrim 單測 — wire jsonb 收斂與 clamp 邊界(plan §5;兩條卡片資料路共用單一來源)。

import { describe, expect, it } from 'vitest';

import { parseImageTrim } from './image-trim';

const ok = { l: 0.1, t: 0.2, w: 0.5, h: 0.6, nw: 1200, nh: 900 };

describe('parseImageTrim', () => {
  it('合法 wire 形狀 → 原值透傳', () => {
    expect(parseImageTrim(ok)).toEqual(ok);
  });

  it('numeric(6,5) 邊界:l+w=1 精確值(0.99999+0.00001 浮點容差)通過', () => {
    expect(parseImageTrim({ ...ok, l: 0.4, w: 0.6 })).not.toBeNull();
    expect(parseImageTrim({ ...ok, l: 0.39999, w: 0.60001 })).not.toBeNull();
  });

  it('非物件 / null / 陣列 / 缺鍵 / 非數值 → null', () => {
    expect(parseImageTrim(null)).toBeNull();
    expect(parseImageTrim('x')).toBeNull();
    expect(parseImageTrim([ok])).toBeNull();
    expect(parseImageTrim({ ...ok, w: undefined })).toBeNull();
    expect(parseImageTrim({ ...ok, h: 'NaN' })).toBeNull();
    expect(parseImageTrim({ ...ok, nw: Number.NaN })).toBeNull();
  });

  it('超界(l<0 / l≥1 / w≤0 / w>1 / l+w>1 / t+h>1)→ null', () => {
    expect(parseImageTrim({ ...ok, l: -0.01 })).toBeNull();
    expect(parseImageTrim({ ...ok, l: 1 })).toBeNull();
    expect(parseImageTrim({ ...ok, w: 0 })).toBeNull();
    expect(parseImageTrim({ ...ok, w: 1.01 })).toBeNull();
    expect(parseImageTrim({ ...ok, l: 0.6, w: 0.5 })).toBeNull();
    expect(parseImageTrim({ ...ok, t: 0.5, h: 0.6 })).toBeNull();
  });

  it('nw/nh 非正整數 → null', () => {
    expect(parseImageTrim({ ...ok, nw: 0 })).toBeNull();
    expect(parseImageTrim({ ...ok, nh: -1 })).toBeNull();
    expect(parseImageTrim({ ...ok, nw: 100.5 })).toBeNull();
  });
});
