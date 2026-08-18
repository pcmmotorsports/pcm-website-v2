// @vitest-environment jsdom
//
// ProductFAQ smoke test — N°04 常見問題手風琴 + FAQPage JSON-LD(OD-10)。
// 驗 eyebrow 04 / 5 個 details / 保固 item 共用 rpm-policies 字面(與 ProductTabs 同源)/
// FAQPage JSON-LD 合法且 5 題。prop-less 純 presentational、原生 <details>、不需 router / matchMedia stub。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE } from '@pcm/domain';

import { ProductFAQ } from './ProductFAQ';
import { RPM_WARRANTY_PARAGRAPHS } from '../data/rpm-policies';
import { TERMS_SECTIONS } from '../data/legal-content';

afterEach(cleanup);

describe('ProductFAQ', () => {
  it('renders N°04 eyebrow (eb-no 04 + 常見問題 label)', () => {
    const { container } = render(<ProductFAQ />);
    expect(container.querySelector('.pd-eb-no')?.textContent).toBe('04');
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

  // 交期守門(2026-08-18):FAQ 的「N–M 週」必須等於 /terms 第 7 條那個區間。
  // 病史:FAQ 寫「2-6 週」、合約寫「2-12 週」=> 客人讀到的比綁約的短一半。
  // 🔴 刻意【不】另加 `not.toContain('2-6 週')`:合約日後若真的改回短版,那行會恆紅、擋住正確行為;
  //    而 FAQ 單邊退回時上面那條 positive 斷言就已經紅了,加了也是冗餘。
  // 判別力:改任一邊(FAQ 字面或 TERMS 條文)而沒改另一邊 => 本格紅;兩邊一起改 => 綠(正確行為)。
  it('交期字面與 /terms 第 7 條同一個週數區間', () => {
    const clause = TERMS_SECTIONS.find((s) => s.heading.includes('第 7 條'))
      ?.items?.find((i) => i.includes('週'));
    expect(clause).toBeDefined();
    const range = clause!.match(/\d+\s*[–-]\s*\d+\s*週/)?.[0];
    expect(range).toBeDefined();

    render(<ProductFAQ />);
    const text = document.body.textContent ?? '';
    expect(text).toContain(range!);
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

  // 🔴 2026-08-18 W5:原字面 `宅配 $100。` 只講費用不講免運門檻,而同一個商品頁另有兩處講門檻
  //   ⇒ 客人在同一畫面讀到互相打架的兩句,而 FAQ_ITEMS **同時餵 JSON-LD** ⇒ Google 也讀得到分歧。
  //   本格擋的是【有人把數字 hardcode 回去】:字面由常數組出來,hardcode 就對不上 ⇒ 紅。
  //   ⚠️ 改常數時本格【不該紅】(兩邊一起動 = 正確行為);只有 hardcode 才紅 —— 那才是它的判別力。
  it('運費字面吃 shipping 常數(hardcode 回去就紅),且畫面與 JSON-LD 同一份', () => {
    const { container } = render(<ProductFAQ />);
    const expected = `宅配 NT$ ${HOME_SHIPPING_FEE}（滿 NT$ ${FREE_SHIPPING_THRESHOLD.toLocaleString()} 免運）。`;

    expect(container.textContent).toContain(expected);

    const jsonLd = container.querySelector('script[type="application/ld+json"]')?.textContent ?? '';
    expect(jsonLd).toContain(expected);

    // 原病的另一半:門檻【完全沒被提到】。上面兩條若改成只比對費用就抓不到它 ⇒ 單獨釘住。
    expect(jsonLd).toContain(String(FREE_SHIPPING_THRESHOLD.toLocaleString()));
  });
});
