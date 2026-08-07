// @vitest-environment jsdom
//
// ProductFAQ smoke test — N°02 常見問題手風琴 + FAQPage JSON-LD(OD-10;編號沿革見元件檔頭)。
// 驗 eyebrow 02 / 5 個 details / 保固 item 共用 rpm-policies 字面(與 ProductTabs 同源)/
// FAQPage JSON-LD 合法且 5 題。prop-less 純 presentational、原生 <details>、不需 router / matchMedia stub。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductFAQ } from './ProductFAQ';
import { RPM_WARRANTY_PARAGRAPHS } from '../data/rpm-policies';

afterEach(cleanup);

describe('ProductFAQ', () => {
  // Sean 2026-08-07 拍板 Q5=A:H7 整組刪掉商品頁品牌形象區後只剩 03/04、01/02 吊空 ⇒ 純重編號。
  // 本條期望值由 `04` 翻成 `02`(舊值見 git history;相對順序未變、沿革全文見元件檔頭)。
  it('renders N°02 eyebrow (eb-no 02 + 常見問題 label)', () => {
    const { container } = render(<ProductFAQ />);
    expect(container.querySelector('.pd-eb-no')?.textContent, 'Q5=A 後 FAQ 的編號是 02').toBe('02');
    expect(container.querySelector('.pd-eb-label')?.textContent).toContain('常見問題');
    expect(screen.getByText('下單前常被問到的問題')).toBeDefined();
  });

  it('renders 5 faq-item <details>', () => {
    const { container } = render(<ProductFAQ />);
    expect(container.querySelectorAll('details.faq-item').length).toBe(5);
  });

  it('warranty item reuses shared rpm-policies 鑑賞期 字面(與 ProductTabs 同源)', () => {
    const { container } = render(<ProductFAQ />);
    const text = container.textContent ?? '';
    expect(text).toContain('不適用 7 天鑑賞期');
    expect(text).toContain('客製化委任代購');
    // 確認真的吃共用常數:常數第一段特徵字面同時出現在畫面
    const firstPara = RPM_WARRANTY_PARAGRAPHS[0]!
      .map((r) => (typeof r === 'string' ? r : r.b))
      .join('');
    expect(firstPara).toContain('接單後才向原廠訂製的客製商品');
    expect(text).toContain('接單後才向原廠訂製的客製商品');
  });

  it('emits valid FAQPage JSON-LD with 5 questions', () => {
    const { container } = render(<ProductFAQ />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.textContent ?? '{}');
    expect(data['@type']).toBe('FAQPage');
    expect(Array.isArray(data.mainEntity)).toBe(true);
    expect(data.mainEntity.length).toBe(5);
    expect(data.mainEntity[0]['@type']).toBe('Question');
    expect(data.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
    // 保固題 answer text 含鑑賞期(JSON-LD 與畫面同源、與 ProductTabs 同字面)
    const warrantyQ = data.mainEntity.find((q: { name: string }) => q.name === '保固與退換貨');
    expect(warrantyQ?.acceptedAnswer?.text).toContain('不適用 7 天鑑賞期');
  });
});
