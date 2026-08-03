// @vitest-environment jsdom
//
// BrandRichText smoke test — D2a(2026-08-04)
//
// 正向那幾條(粗體、換行)一眼就看得出來;真正要守的是**沒有任何內容字串能長成
// 標記以外的東西**。所以下半組全部是「餵進去的東西必須以純文字出現在畫面上」。

import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { BrandRichText } from './BrandRichText';
import { BRAND_CONTENT } from '@/data/brand-content';

afterEach(cleanup);

describe('BrandRichText · 白名單標記渲染', () => {
  it('<strong> 變成真的 <strong> 元素', () => {
    const { container } = render(<BrandRichText>{'<strong>甲</strong>乙'}</BrandRichText>);
    const strongs = container.querySelectorAll('strong');
    expect(strongs).toHaveLength(1);
    expect(strongs[0]?.textContent).toBe('甲');
    expect(container.textContent).toBe('甲乙');
  });

  it('<br> 變成真的 <br> 元素', () => {
    const { container } = render(<BrandRichText>{'甲<br>乙'}</BrandRichText>);
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('&amp; 顯示成 &(不是四個字)', () => {
    const { container } = render(<BrandRichText>{'PUSH &amp; PULL'}</BrandRichText>);
    expect(container.textContent).toBe('PUSH & PULL');
  });

  it('as 給包裹元素、className 傳得下去', () => {
    const { container } = render(
      <BrandRichText as="p" className="bp-lede">
        {'一句話'}
      </BrandRichText>,
    );
    const p = container.querySelector('p.bp-lede');
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe('一句話');
  });

  it('不給 as 就只吐節點、不多包一層', () => {
    const { container } = render(
      <div data-testid="host">
        <BrandRichText>{'甲'}</BrandRichText>
      </div>,
    );
    expect(screen.getByTestId('host').children).toHaveLength(0); // 只有 text node
    expect(container.textContent).toBe('甲');
  });
});

describe('🔴 BrandRichText · 白名單外的東西不得變成元素', () => {
  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror=alert(1)>', 'img'],
    ['<a href="https://evil.example">連結</a>', 'a'],
    ['<em>斜體</em>', 'em'],
    ['<div>區塊</div>', 'div'],
    ['<STRONG>大寫</STRONG>', 'strong'],
    ['<strong class="x">帶屬性</strong>', 'strong'],
  ])('%s 不得產生 <%s>,而是原樣顯示', (input, tag) => {
    const { container } = render(<BrandRichText>{input}</BrandRichText>);
    expect(container.querySelectorAll(tag)).toHaveLength(0);
    // 🔴 「沒產生元素」還不夠 —— 也可能是被靜默吞掉了。必須確認那串字**看得到**。
    expect(container.textContent).toBe(input);
  });

  it('&lt;strong&gt; 解碼後顯示成文字,不得變成粗體元素', () => {
    const { container } = render(<BrandRichText>{'&lt;strong&gt;假粗體&lt;/strong&gt;'}</BrandRichText>);
    expect(container.querySelectorAll('strong')).toHaveLength(0);
    expect(container.textContent).toBe('<strong>假粗體</strong>');
  });
});

describe('🔴 BrandRichText · 對 20 家真資料實跑', () => {
  // 上面那些是構造出來的案例。這一組拿**真的會上線的字**跑一遍 ——
  // 構造案例證明「這支擋得住攻擊形狀」,這一組證明「它沒把正常內容弄壞」。
  const richFields = (): string[] =>
    BRAND_CONTENT.flatMap((b) => [
      b.lede,
      b.slogan,
      b.about.lead,
      b.about.pull,
      b.about.tail,
      b.highlights.lead,
      ...b.highlights.cards.map((c) => c.d),
      ...b.craft.rows.map((r) => r.d),
      ...(b.aside ? [b.aside.note] : []),
      ...(b.timeline?.items.map((i) => i.d) ?? []),
    ]);

  it('每個帶標記的欄位都渲染得出非空文字,且畫面上不留任何 < 或 >', () => {
    const fields = richFields();
    expect(fields.length).toBeGreaterThan(200); // 前提斷言:真的掃到東西了
    for (const raw of fields) {
      const { container } = render(<BrandRichText>{raw}</BrandRichText>);
      const shown = container.textContent ?? '';
      expect(shown.length, `空輸出:${raw.slice(0, 40)}`).toBeGreaterThan(0);
      // 內容裡沒有裸的角括號(D1b 的白名單守門已保證),所以渲染後也不該出現 ——
      // 出現就代表有標記沒被吃掉、會以原文顯示在畫面上。
      expect(shown.includes('<'), `畫面殘留 < :${raw.slice(0, 40)}`).toBe(false);
      expect(shown.includes('>'), `畫面殘留 > :${raw.slice(0, 40)}`).toBe(false);
      cleanup();
    }
  });

  it('<strong> 的總數與資料裡的開標籤數相同(沒有漏掉也沒有多生)', () => {
    let expected = 0;
    let actual = 0;
    for (const raw of richFields()) {
      expected += raw.match(/<strong>/g)?.length ?? 0;
      const { container } = render(<BrandRichText>{raw}</BrandRichText>);
      actual += container.querySelectorAll('strong').length;
      cleanup();
    }
    expect(expected).toBeGreaterThan(100); // 前提斷言:實測全資料 168 個
    expect(actual).toBe(expected);
  });
});
