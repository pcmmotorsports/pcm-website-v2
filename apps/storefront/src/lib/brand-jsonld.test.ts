// lib/brand-jsonld.test.ts — 品牌介紹頁 schema.org 單測(M-6-02,2026-09-14)
//
// 守三件事:① 休眠(base 拿不到 ⇒ null,絕不吐相對網址);② 麵包屑最後一階不帶 `item`;
// ③ 拿不到 logo 時**不放** `logo` 欄位(不塞站台預設圖冒充品牌標誌)。

import { describe, expect, it } from 'vitest';

import {
  buildBrandJsonLd,
  buildBrandBreadcrumbJsonLd,
  serializeBrandJsonLd,
} from './brand-jsonld';

const BASE = 'https://www.pcmmotorsports.com';
const BRAND = { slug: 'akrapovic', name: 'Akrapovic' };

describe('buildBrandJsonLd', () => {
  it('吐 Brand,url 是自己這條 route 的絕對網址', () => {
    expect(buildBrandJsonLd(BRAND, BASE, '斯洛維尼亞的鈦合金排氣管', `${BASE}/logo.svg`)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Brand',
      name: 'Akrapovic',
      url: `${BASE}/brands/akrapovic`,
      description: '斯洛維尼亞的鈦合金排氣管',
      logo: `${BASE}/logo.svg`,
    });
  });

  it('🔴 沒有 logo ⇒ 不放 logo 欄位(不塞替代圖)', () => {
    const jsonLd = buildBrandJsonLd(BRAND, BASE, 'x');
    expect(jsonLd).not.toBeNull();
    expect(Object.hasOwn(jsonLd!, 'logo')).toBe(false);
  });

  it('🔴 base 未設 ⇒ null(整個 <script> 不渲染)', () => {
    expect(buildBrandJsonLd(BRAND, undefined, 'x', 'y')).toBeNull();
    expect(serializeBrandJsonLd(BRAND, undefined, 'x')).toBeNull();
  });
});

describe('buildBrandBreadcrumbJsonLd', () => {
  it('首頁 › 品牌 › 該品牌,最後一階不帶 item', () => {
    expect(buildBrandBreadcrumbJsonLd(BRAND, BASE)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: '品牌', item: `${BASE}/brands` },
        { '@type': 'ListItem', position: 3, name: 'Akrapovic' },
      ],
    });
  });

  it('🔴 base 未設 ⇒ null', () => {
    expect(buildBrandBreadcrumbJsonLd(BRAND, undefined)).toBeNull();
  });
});
