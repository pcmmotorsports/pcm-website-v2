import { describe, expect, it } from 'vitest';
import { productSeoTitle } from './product-seo-title';

const f = (motoBrand: string, modelCode: string, yearStart?: number) => ({ motoBrand, modelCode, yearStart });

describe('productSeoTitle(Sean 09-12 拍甲)', () => {
  it('單一車款:品牌 品名|車款 — PCM,不帶年份', () => {
    expect(
      productSeoTitle({ brand: 'WRS', name: '導航支架', fitments: [f('Honda', 'XL750 Transalp', 2023), f('Honda', 'XL750 Transalp', 2025)] }),
    ).toBe('WRS 導航支架|Honda XL750 Transalp — PCM');
  });

  it('兩台 ⇒「A / B」;三台以上 ⇒「A 等 N 款車型」(同車跨年式算 1 台)', () => {
    expect(productSeoTitle({ brand: 'RPM', name: '拉桿', fitments: [f('KTM', '1290'), f('KTM', '1390')] })).toBe(
      'RPM 拉桿|KTM 1290 / KTM 1390 — PCM',
    );
    expect(
      productSeoTitle({ brand: 'RPM', name: '拉桿', fitments: [f('KTM', '1290'), f('KTM', '1290', 2020), f('KTM', '1390'), f('KTM', '890')] }),
    ).toBe('RPM 拉桿|KTM 1290 等 3 款車型 — PCM');
  });

  it('inherited(家族樹推導)車款不算 —— 與卡片 / 副標同一把尺', () => {
    expect(
      productSeoTitle({
        brand: 'WRS',
        name: '導航支架',
        fitments: [f('Honda', 'XL750 Transalp'), { ...f('Honda', 'XL750 Transalp E'), matchSource: 'inherited' as const }],
      }),
    ).toBe('WRS 導航支架|Honda XL750 Transalp — PCM');
  });

  it('通用款(零車款)⇒ 不加車款段;品名已含品牌 ⇒ 不疊', () => {
    expect(productSeoTitle({ brand: 'RIZOMA', name: 'RIZOMA CIRCUIT 959 後視鏡', fitments: [] })).toBe(
      'RIZOMA CIRCUIT 959 後視鏡 — PCM',
    );
    expect(productSeoTitle({ brand: 'WRS', name: '風鏡' })).toBe('WRS 風鏡 — PCM');
  });
});
