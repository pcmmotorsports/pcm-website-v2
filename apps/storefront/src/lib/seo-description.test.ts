// Bing Webmaster 2026-09-29「meta description 太短」:9 頁 25–89 字。主視窗定 120–150 字、重點放前 80 字、
// 商品頁保留一句「適用 {車款}」(SOP §5.9 適用範圍句)、只用既有事實。
import { describe, expect, it } from 'vitest';
import {
  brandDirectoryMetaDescription,
  brandMetaDescription,
  HOME_META_DESCRIPTION,
  productMetaDescription,
  SEO_DESC_MAX,
  SEO_DESC_MIN,
} from './seo-description';

const inRange = (s: string) => s.length >= SEO_DESC_MIN && s.length <= SEO_DESC_MAX;

describe('商品頁描述', () => {
  const rpm = {
    brand: 'RPM CARBON',
    name: '單座蓋',
    category: '碳纖維部品',
    description: '以真碳纖維熱壓成型，取代原廠座墊後段，外觀更俐落。\n\n表面為亮面透明漆。',
    fitments: [{ motoBrand: 'Honda', modelCode: 'CBR1000RR-R', yearStart: 2020 }],
  };

  it('前 80 字就有品牌、品名、適用車款', () => {
    const d = productMetaDescription(rpm);
    expect(d.slice(0, 80)).toContain('RPM CARBON 單座蓋');
    expect(d.slice(0, 80)).toContain('適用 Honda CBR1000RR-R');
  });

  it('長度落在 120–150 字', () => {
    const d = productMetaDescription(rpm);
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });

  it('商品介紹的第一句當賣點, 類別也寫進去', () => {
    const d = productMetaDescription(rpm);
    expect(d).toContain('以真碳纖維熱壓成型，取代原廠座墊後段，外觀更俐落');
    expect(d).toContain('碳纖維部品');
  });

  it('品名已含品牌 ⇒ 不重複(與 SEO 標題同一條規則)', () => {
    expect(productMetaDescription({ ...rpm, name: 'RPM CARBON 單座蓋' })).not.toContain('RPM CARBON RPM CARBON');
  });

  it('多款車 ⇒ 與標題同寫法「A 等 N 款車型」', () => {
    const many = { ...rpm, fitments: ['A', 'B', 'C'].map((m) => ({ motoBrand: 'Ducati', modelCode: m })) };
    expect(productMetaDescription(many)).toContain('適用 Ducati A 等 3 款車型');
  });

  it('🔵 沒有車款資料 ⇒ 不寫「適用」那句(不杜撰), 仍在範圍內', () => {
    const d = productMetaDescription({ ...rpm, fitments: [] });
    expect(d).not.toContain('適用 ');
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });

  it('🔵 沒有商品介紹、類別也空 ⇒ 靠補句撐到範圍內', () => {
    const d = productMetaDescription({ brand: 'DNA', name: '空氣濾清器', fitments: [] });
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });

  it('🔵 補句只補整句, 不會把一句切一半(結尾一定是句號)', () => {
    for (const d of [
      productMetaDescription(rpm),
      productMetaDescription({ ...rpm, description: '採 Grade 5 鈦合金 CNC 機械加工製造，質地輕量且具備優異的抗腐蝕特性。', name: '鈦合金下三角台螺絲組 M8x25（4 件）' }),
      brandMetaDescription({ name: 'DNA', lede: '希臘的高性能空氣濾清器製造商，以多層棉紗浸油濾材與自有氣流實驗室，供應機車、汽車與賽事用進氣濾清。', productCount: 312 }),
    ]) {
      expect(d.endsWith('。'), d).toBe(true);
      expect(d.length, d).toBeLessThanOrEqual(SEO_DESC_MAX);
    }
  });

  it('🔵 超長 ⇒ 截在 150 字內, 結尾「…」', () => {
    const d = productMetaDescription({ ...rpm, name: '很長的品名'.repeat(30) });
    expect(d.length).toBeLessThanOrEqual(SEO_DESC_MAX);
    expect(d.endsWith('…')).toBe(true);
  });

  it('🔵 不寫尚未提供的服務(合作店家安裝、安裝預約都還沒上線)', () => {
    expect(productMetaDescription(rpm)).not.toMatch(/安裝/);
  });
});

describe('品牌頁描述', () => {
  const lede = '希臘的高性能空氣濾清器製造商，以多層棉紗浸油濾材與自有氣流實驗室，供應機車、汽車與賽事用進氣濾清。';

  it('品牌介紹在前, 加上架件數, 長度在範圍內', () => {
    const d = brandMetaDescription({ name: 'DNA', lede, productCount: 312 });
    expect(d.startsWith(lede)).toBe(true);
    expect(d).toContain('DNA 商品 312 件');
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });

  it('🔵 件數讀不到(null)⇒ 不寫件數, 不寫成 0', () => {
    const d = brandMetaDescription({ name: 'DNA', lede, productCount: null });
    expect(d).not.toMatch(/\d+ 件/);
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });
});

describe('品牌總覽描述', () => {
  it('寫出品牌數與前三大品牌, 長度在範圍內', () => {
    const d = brandDirectoryMetaDescription([
      { name: 'Evotech', count: 3713 },
      { name: 'Rizoma', count: 900 },
      { name: 'DNA', count: 312 },
      { name: 'X', count: 0 },
    ]);
    expect(d).toContain('3 個品牌');
    expect(d).toContain('Evotech、Rizoma、DNA');
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });

  it('🔵 讀不到品牌 ⇒ 不寫數字, 仍在範圍內', () => {
    const d = brandDirectoryMetaDescription([]);
    expect(d).not.toMatch(/\d+ 個品牌/);
    expect(inRange(d), `${d.length} 字:${d}`).toBe(true);
  });
});

describe('首頁描述', () => {
  it('長度在範圍內;安裝只寫現況「用 LINE 找我們安排」, 不寫成已上線的合作店家安裝 / 線上預約', () => {
    expect(inRange(HOME_META_DESCRIPTION), `${HOME_META_DESCRIPTION.length} 字`).toBe(true);
    expect(HOME_META_DESCRIPTION).toContain('需要安裝可先用 LINE 找我們安排');
    expect(HOME_META_DESCRIPTION).not.toMatch(/合作店家安裝|線上安裝預約|線上預約/);
  });
});
