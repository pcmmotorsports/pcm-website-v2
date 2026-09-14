// 🔵 **[2026-09-14 · 後綴從 `— PCM` 改成 `— PCM重機零件販售`(Sean 拍 Q14 甲:全站統一站名)]**
//   **原本守什麼**:`{品牌} {品名}|{車款}` 這個**組裝規則**(Sean 09-12 拍甲的本體)——
//     品名已含品牌不疊、inherited 車款不算、1/2/≥3 台三種寫法、通用款不加車款段。
//   **現在誰接手**:同一組斷言,一字未動,只有**尾巴那六個字**跟著全站站名走。
//   🔴 **09-12 那一拍的理由沒有被推翻**:它要解決的是「幾百件同名、Google 分不出」——
//     解法是**加上品牌與車款**,而不是把站名縮短。那一半完整保留在下面每一條裡。
//   ⚠️ 代價說清楚:標題變長六個字。而商品標題本來就遠超過 Google 那條約 60 字的截斷線
//     ⇒ 後綴在搜尋結果裡**本來就看不到** ⇒ 這一改在 Google 那行藍字上是零差別,
//     換到的是分享連結與分頁標題不再三種寫法。
import { describe, expect, it } from 'vitest';
import { productSeoTitle } from './product-seo-title';

const f = (motoBrand: string, modelCode: string, yearStart?: number) => ({ motoBrand, modelCode, yearStart });

describe('productSeoTitle(Sean 09-12 拍甲)', () => {
  it('單一車款:品牌 品名|車款 — PCM重機零件販售,不帶年份', () => {
    expect(
      productSeoTitle({ brand: 'WRS', name: '導航支架', fitments: [f('Honda', 'XL750 Transalp', 2023), f('Honda', 'XL750 Transalp', 2025)] }),
    ).toBe('WRS 導航支架|Honda XL750 Transalp — PCM重機零件販售');
  });

  it('兩台 ⇒「A / B」;三台以上 ⇒「A 等 N 款車型」(同車跨年式算 1 台)', () => {
    expect(productSeoTitle({ brand: 'RPM', name: '拉桿', fitments: [f('KTM', '1290'), f('KTM', '1390')] })).toBe(
      'RPM 拉桿|KTM 1290 / KTM 1390 — PCM重機零件販售',
    );
    expect(
      productSeoTitle({ brand: 'RPM', name: '拉桿', fitments: [f('KTM', '1290'), f('KTM', '1290', 2020), f('KTM', '1390'), f('KTM', '890')] }),
    ).toBe('RPM 拉桿|KTM 1290 等 3 款車型 — PCM重機零件販售');
  });

  it('inherited(家族樹推導)車款不算 —— 與卡片 / 副標同一把尺', () => {
    expect(
      productSeoTitle({
        brand: 'WRS',
        name: '導航支架',
        fitments: [f('Honda', 'XL750 Transalp'), { ...f('Honda', 'XL750 Transalp E'), matchSource: 'inherited' as const }],
      }),
    ).toBe('WRS 導航支架|Honda XL750 Transalp — PCM重機零件販售');
  });

  it('通用款(零車款)⇒ 不加車款段;品名已含品牌 ⇒ 不疊', () => {
    expect(productSeoTitle({ brand: 'RIZOMA', name: 'RIZOMA CIRCUIT 959 後視鏡', fitments: [] })).toBe(
      'RIZOMA CIRCUIT 959 後視鏡 — PCM重機零件販售',
    );
    expect(productSeoTitle({ brand: 'WRS', name: '風鏡' })).toBe('WRS 風鏡 — PCM重機零件販售');
  });
});
