// @vitest-environment jsdom
//
// FeatureEditorial — 版位渲染(D5e-1 起改資料驅動)。
// 決策那一面(輪播是誰、fallback 怎麼退)在 `lib/brand-focus.test.ts`,本支不重複驗;
// 這裡只驗「給了一顆 focus,版位有沒有把每一欄真的畫出來」。
//
// 🔴 D5e-1 之前這支只有一條 smoke test,而版位的內容**全部硬編在 JSX 裡** ——
//    所以「把資料接錯欄位」這一族(標題吃到 body、facts 只畫第一則、照片吃到品牌名)
//    以前零覆蓋。改資料驅動之後這些才變成真的會發生的錯,故補齊。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FeatureEditorial } from './FeatureEditorial';
import type { ResolvedBrandFocus } from '@/lib/brand-focus';

afterEach(cleanup);

const focus: ResolvedBrandFocus = {
  slug: 'rizoma',
  name: 'RIZOMA',
  title: '工藝之鏡',
  body: '第一行。<br>第二行。',
  caption: '義大利',
  facts: [
    ['ORIGIN', 'Milano, Italy'],
    ['SINCE', '2000'],
    ['CRAFT', 'CNC · Anodized'],
  ],
  categories: ['外觀與後視鏡', '拉桿與把手', '懸吊與車架 · 輪圈'],
  photo: 'https://example.test/rizoma.jpg',
};

describe('FeatureEditorial', () => {
  it('should render the monthly feature section without crashing', () => {
    render(<FeatureEditorial focus={focus} />);
    expect(screen.getByText('This month · 本月聚焦')).toBeDefined();
    expect(screen.getByText('工藝之鏡')).toBeDefined();
  });

  // 🔴 每一欄都要畫出來。這條擋的是「接線錯但長得很正常」那一族:
  //    少畫一則 fact、或標題吃到 body,畫面看起來仍然是完整的一個版位。
  it('🔴 三則事實的標籤與值全部畫出來(不是只畫第一則)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    expect(container.querySelectorAll('.ed-feature-meta > div')).toHaveLength(3);
    for (const [label, value] of focus.facts) {
      expect(screen.getByText(label), `事實標籤「${label}」沒畫出來`).toBeDefined();
      expect(screen.getByText(value), `事實值「${value}」沒畫出來`).toBeDefined();
    }
  });

  // 🔴 `body` 帶白名單標記 ⇒ 必須過 `BrandRichText` 變成真的 `<br>`,
  //    而不是把 `<br>` 三個字原樣印在畫面上(那是「沒過 parser」的症狀)。
  it('🔴 敘述的 <br> 被解析成換行元素、不是印出字面', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const body = container.querySelector('.ed-feature-body');
    expect(body?.querySelectorAll('br')).toHaveLength(1);
    expect(body?.textContent).toBe('第一行。第二行。');
    expect(body?.textContent).not.toContain('<br>');
  });

  it('🔴 標題 = 品牌名 + 鉤子兩段(鉤子不重複寫品牌名,名字由版位另外提供)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const h2 = container.querySelector('.ed-feature-title');
    expect(h2?.textContent).toBe('RIZOMA.工藝之鏡');
    expect(h2?.querySelector('em')?.textContent).toBe('工藝之鏡');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 D5e-2b 動線改版:一顆 `ed-link` → 「實心主按鈕 + 分隔線 + 分類導覽列」。
  //    這一組守的是**三種各自無聲的接線錯**:
  //      ①主按鈕退回 legacy `/products?brand=`(D5e-1 的舊目的地)—— 頁面看起來完全正常。
  //      ②分類列硬編成某一家的分類 —— 輪到別家時連結指向錯的分類,畫面照樣好看。
  //      ③分類名沒被 encode —— 含 `·` 與空白的分類名(「懸吊與車架 · 輪圈」)會產出壞網址。
  // ══════════════════════════════════════════════════════════════════════════
  it('🔴 主按鈕連到品牌介紹頁 /brands/<slug>,不是 legacy 的 /products?brand=', () => {
    const { container } = render(<FeatureEditorial focus={{ ...focus, slug: 'k-speed', name: 'K-SPEED' }} />);
    const primary = container.querySelector('a.ed-feature-primary');
    expect(primary?.getAttribute('href'), '主按鈕沒指向品牌介紹頁').toBe('/brands/k-speed');
    expect(primary?.textContent).toContain('品牌介紹');
  });

  // 🔴 測試名只能宣稱**本元件**(R2 F2:原名寫「全站不得再出現」,但本支只 render 這一顆元件,
  //    而實跑 `curl localhost/` 首頁**仍有 17 條** `href="/products?brand=..."`(來自 `BrandIndex.tsx`,
  //    屬 D5f 範圍)⇒ 那個名字是**測試名 > 斷言**,正是 memory `feedback_claim-scope-exceeds-fact-three-shapes`
  //    記的三種形狀之一。名字縮回它真正量得到的範圍。
  it('🔴 **本元件**不得再出現 legacy 的 ?brand=(首頁其餘處屬 D5f,見檔頭)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length, '一條連結都沒有 ⇒ 下面的負向斷言恆真').toBeGreaterThan(3);
    // 錨在 `?brand=` / `&brand=`:`pbrand=` 不得誤命中(所以帶上前置的分隔符)。
    expect(
      hrefs.filter((h) => /[?&]brand=/.test(h)),
      'legacy ?brand= 又出現了 ⇒ 與 pbrand 新契約分岔、且與選車的 brand 撞同一個字',
    ).toEqual([]);
  });

  it('🔴 分類列:領頭是「全部商品」(is-all)、其餘逐一對應當期品牌的分類', () => {
    const { container } = render(<FeatureEditorial focus={{ ...focus, slug: 'k-speed', name: 'K-SPEED' }} />);
    const links = [...container.querySelectorAll('.ed-feature-jump a')];
    // 1 條領頭 + 3 條分類。數量對不上 = 少畫或多畫。
    expect(links, '分類列的連結數不對').toHaveLength(1 + focus.categories.length);

    const all = links[0]!;
    expect(all.className, '領頭那條沒有 is-all ⇒ 墨黑底線那組樣式不會套上').toContain('is-all');
    expect(all.getAttribute('href')).toBe('/products?pbrand=k-speed');
    expect(all.textContent).toBe('全部商品');

    // 🔴 逐一比對,不抽樣:硬編某一家的分類就會在這裡紅。
    for (const [idx, category] of focus.categories.entries()) {
      const link = links[idx + 1]!;
      expect(link.textContent, `第 ${idx + 1} 個分類的文字不對`).toBe(category);
      expect(link.getAttribute('href'), `分類「${category}」的網址不對`).toBe(
        `/products?pbrand=k-speed&category=${encodeURIComponent(category)}`,
      );
    }
  });

  it('🔴 含 `·` 與空白的分類名要被 encode(壞網址在畫面上看不出來)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const href = [...container.querySelectorAll('.ed-feature-jump a')]
      .map((a) => a.getAttribute('href') ?? '')
      .find((h) => h.includes('category='))!;
    // 「懸吊與車架 · 輪圈」那條:空白與 `·` 都必須是百分號編碼,且不得雙重編碼(%25)。
    const encoded = encodeURIComponent('懸吊與車架 · 輪圈');
    const all = [...container.querySelectorAll('.ed-feature-jump a')].map((a) => a.getAttribute('href') ?? '');
    expect(all.some((h) => h.endsWith(`category=${encoded}`)), '分類名沒被正確 encode').toBe(true);
    expect(href, '出現雙重編碼 ⇒ 有人在元件端又 encode 了一次').not.toContain('%25');
  });

  it('分隔線對讀屏隱藏(它是視覺分區訊號,不是內容)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const divider = container.querySelector('.ed-feature-divider');
    expect(divider, '分隔線不見了').not.toBeNull();
    expect(divider?.getAttribute('aria-hidden')).toBe('true');
  });

  it('圖說吃 caption(產地),圖的 alt 吃品牌名', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    expect(container.querySelector('.ed-feature-caption')?.textContent).toContain('義大利');
    const img = container.querySelector('.ed-feature-media img');
    expect(img?.getAttribute('src')).toBe(focus.photo);
    expect(img?.getAttribute('alt')).toBe('RIZOMA');
  });

  // 🔴 `photo` 為 null 時整個媒體欄不建 —— 不是建一個 `<img src="">`(那會是破圖框)。
  //    D5e-2 搬 20 家時必然會遇到某幾家還沒有產品特寫照。
  it('🔴 沒有照片時不渲染媒體欄,而不是畫一個 src 空的 <img>', () => {
    const { container } = render(<FeatureEditorial focus={{ ...focus, photo: null }} />);
    expect(container.querySelector('.ed-feature-media')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // 左欄仍在 ⇒ 版位不是整個消失
    expect(container.querySelector('.ed-feature-side')).not.toBeNull();
  });
});
