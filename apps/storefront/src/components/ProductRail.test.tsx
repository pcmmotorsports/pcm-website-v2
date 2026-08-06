// @vitest-environment jsdom
//
// ProductRail smoke — R-1 抽元件後的**props 接線**守門。
//
// 🔴 分工要講清楚,免得誤以為這支在重複別人的工作:
//    橫捲**機制**(箭頭 disabled、scrollBy 步進、tabIndex、軌道格數、CSS 承重值)由
//    `HomeSelect.test.tsx` 與 `styles/home.test.ts` 守著 —— 它們透過首頁打到同一顆元件,
//    R-1 刻意讓那兩支**一個字都不用改**,那就是「首頁零變更」的驗收。
//    這支只守**抽出來才新產生的那一面**:區塊專屬字面是不是真的由 props 決定。
//    沒有它的話,R-2 / R-3 傳了 props 卻被元件忽略(例如寫死回 N°02 的字面),
//    只會在真瀏覽器上被看到,jsdom 與型別都不會紅。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProductRail } from './ProductRail';
import { MOCK_PRODUCTS } from '@/data/mock-products';

afterEach(cleanup);

// 🔴 用既有的 `MOCK_PRODUCTS` 當 fixture,不自己手捏。
//    初版我寫了一顆 `makeProduct()` 並用 `as MockProduct` 硬轉 —— 那個 cast 把型別錯誤整組吞掉
//    (`id` 其實是 number,我寫成字串,typecheck 只在 `Partial` 那個參數上紅、基底完全沒紅)。
//    fixture 用 cast 繞過型別 = 測試在一份現實裡不存在的資料形狀上跑。
const products = MOCK_PRODUCTS;

const BASE = {
  title: '熱門商品',
  viewAllHref: '/products?pbrand=bonamici',
  viewAllLabel: '查看全部',
  ariaLabel: '熱門商品橫捲',
  emptyText: '目前沒有商品',
  errorText: '載入失敗、請稍後再試',
};

describe('ProductRail(R-1 抽元件:區塊專屬字面全部由 props 決定)', () => {
  it('標題 / 查看全部文案 / 連結 / 軌道 aria-label 都吃 props,不是寫死首頁那組', () => {
    const { container } = render(<ProductRail {...BASE} products={products.slice(0, 1)} />);
    expect(screen.getByText('熱門商品'), '標題沒吃 props').toBeTruthy();
    const link = screen.getByText('查看全部').closest('a');
    expect(link?.getAttribute('href'), '查看全部連結沒吃 props').toBe('/products?pbrand=bonamici');
    expect(
      container.querySelector('.b-carousel')?.getAttribute('aria-label'),
      '軌道 aria-label 沒吃 props ⇒ 讀屏會念錯是哪一區的橫捲',
    ).toBe('熱門商品橫捲');
    // 反面:首頁那組字面不該在沒傳的情況下冒出來。
    expect(screen.queryByText('New Arrivals · 最新商品'), '洩漏了首頁寫死的標題').toBeNull();
    expect(screen.queryByText('查看所有新品'), '洩漏了首頁寫死的 CTA 字面').toBeNull();
  });

  it('eyebrow 不給就不畫編號標(只有首頁 N°02 有;其他區畫出來是憑空多一個編號)', () => {
    const { container, rerender } = render(<ProductRail {...BASE} products={products.slice(0, 1)} />);
    expect(container.querySelector('.b-select-title .ed-mono'), '沒給 eyebrow 卻畫了編號標').toBeNull();
    rerender(<ProductRail {...BASE} products={products.slice(0, 1)} eyebrow="N°02" />);
    expect(container.querySelector('.b-select-title .ed-mono')?.textContent).toBe('N°02');
  });

  it('空(0 筆)與錯(error)是兩種文案 —— 對客人的意思不一樣,不能共用一句', () => {
    const { rerender } = render(<ProductRail {...BASE} products={[]} />);
    expect(screen.getByText('目前沒有商品')).toBeTruthy();
    expect(screen.queryByText('載入失敗、請稍後再試'), '0 筆被當成載入失敗').toBeNull();
    rerender(<ProductRail {...BASE} products={[]} error />);
    expect(screen.getByText('載入失敗、請稍後再試')).toBeTruthy();
    expect(screen.queryByText('目前沒有商品'), '載入失敗被當成沒有商品').toBeNull();
  });

  it('error 時即使有資料也不畫軌道(取數失敗的殘值不該被當成結果端出去)', () => {
    const { container } = render(
      <ProductRail {...BASE} products={products.slice(0, 2)} error />,
    );
    expect(container.querySelector('.b-carousel'), 'error 態仍畫了軌道').toBeNull();
    expect(screen.getByText('載入失敗、請稍後再試')).toBeTruthy();
  });

  // 🔴 審查抓到:`showRedPrice` / `badgeStyle` 兩個透傳 prop 原本零守門 —— 把它們改成寫死
  //    `false` / `"minimal"`(首頁傳的正是那兩個值)⇒ 本檔原本 5 條 + `HomeSelect.test.tsx` **全綠**。
  //    而這兩個是視覺 prop,jsdom 與型別都看不見。⇒ 用「換個值 DOM 真的跟著變」釘住透傳鏈。
  it('showRedPrice / badgeStyle 真的透傳到 ProductCard(不是寫死首頁那組)', () => {
    const one = products.slice(0, 1);
    const { container, rerender } = render(
      <ProductRail {...BASE} products={one} showRedPrice={false} />,
    );
    expect(container.querySelector('.is-red'), 'showRedPrice=false 卻畫了紅價').toBeNull();
    rerender(<ProductRail {...BASE} products={one} showRedPrice />);
    expect(container.querySelector('.is-red'), 'showRedPrice=true 沒有透傳到卡片').toBeTruthy();
    // badgeStyle:`pill` 會畫出 `.badge-pill`、`none` 整顆不畫 —— 用差異證明它真的傳下去。
    const flagged = products.find((p) => p.isNew || p.isSale);
    expect(flagged, 'MOCK_PRODUCTS 找不到 isNew/isSale 的商品 ⇒ 本條前提失效').toBeTruthy();
    rerender(<ProductRail {...BASE} products={[flagged!]} badgeStyle="pill" />);
    expect(container.querySelector('.badge-pill'), 'badgeStyle=pill 沒有透傳到卡片').toBeTruthy();
    rerender(<ProductRail {...BASE} products={[flagged!]} badgeStyle="none" />);
    expect(container.querySelector('.badge'), 'badgeStyle=none 卻仍畫了徽章').toBeNull();
  });

  // 🔴 審查抓到:`data-reveal` 原本寫死在 section 上。品牌頁 Sean 2026-08-04 拍板 C
  //    「捲動揭示先不做」(backlog #316)⇒ 寫死的話 R-2 會種下與拍板反向的屬性,而三綠不會紅。
  it('data-reveal 是 opt-in(不給就不種;只有首頁給)', () => {
    const one = products.slice(0, 1);
    const { container, rerender } = render(<ProductRail {...BASE} products={one} />);
    expect(container.querySelector('[data-reveal]'), '沒給 reveal 卻種了 data-reveal').toBeNull();
    rerender(<ProductRail {...BASE} products={one} reveal />);
    expect(
      container.querySelector('section.b-select[data-reveal]'),
      'reveal 沒有種到 section 上 ⇒ 首頁 N°02 的進場揭示會靜默消失',
    ).toBeTruthy();
  });

  // 🔴 審查抓到:`emptyText` 若必填,R-2 會被迫替品牌頁編一句「目前沒有商品」——
  //    而品牌頁現行是 0 筆整區不渲染,註解逐字寫過「對客人說什麼是文案決策」(backlog #315 未拍)。
  it('0 筆且沒給 emptyText → 整區不渲染(不替呼叫端編文案、也不留空骨架)', () => {
    const { container } = render(<ProductRail {...BASE} emptyText={undefined} products={[]} />);
    expect(container.querySelector('.b-select'), '沒給 emptyText 卻仍畫了整個區塊骨架').toBeNull();
    expect(container.textContent, '憑空生出了一句空狀態文案').toBe('');
  });

  it('傳幾筆畫幾筆(元件本身不截斷 —— 要顯示幾筆是呼叫端的產品決定)', () => {
    const seven = products.slice(0, 7);
    expect(seven.length, 'MOCK_PRODUCTS 不足 7 筆 ⇒ 本條前提失效').toBe(7);
    const { container } = render(<ProductRail {...BASE} products={seven} />);
    expect(container.querySelectorAll('.b-carousel-item').length).toBe(7);
    // 每張卡的連結走 slug(不是 id;歷史上這裡出過導向 404 的 bug)。
    expect(container.querySelector('.b-carousel-item a')?.getAttribute('href')).toBe(
      `/products/${seven[0]!.slug}`,
    );
  });
});
