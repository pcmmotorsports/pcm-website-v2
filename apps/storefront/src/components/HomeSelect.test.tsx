// @vitest-environment jsdom
//
// HomeSelect(N°02 最新商品橫捲)—— H6 改寫,2026-08-06。
// 驗「正常 / empty / error 三條 UI 分支」+ **橫捲軌道與左右箭頭的行為**。
// 🔴 箭頭是本片自己接的(OD 只畫了樣式、原型零 JS)⇒ 它的行為只有這裡守得到。
// ⚠️ **擋不住什麼**:jsdom 沒有真的 layout ⇒ `scrollWidth`/`clientWidth` 都是 0、
//    `scrollBy` 是 stub;「捲得動嗎、一次捲幾格」要真瀏覽器。這裡守的是接線與 disabled 邏輯。
// #5b 後改 href(Next.js Link)導航、不再用 useRouter;下方斷言精選卡 href 用真 slug(非 hashed id)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { HomeSelect } from './HomeSelect';
import type { FeaturedResult } from '@/lib/products';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(cleanup);

describe('HomeSelect', () => {
  it('should render the featured products carousel without crashing', () => {
    const featured: FeaturedResult = { products: MOCK_PRODUCTS.slice(0, 4), error: false };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('New Arrivals · 最新商品')).toBeDefined();
    expect(screen.getByText(MOCK_PRODUCTS[0]!.name)).toBeDefined();
    // #5b regression guard:精選卡導向真 slug(/products/<slug>),非 hashIdToNumber 雜湊數字。
    const links = screen.getAllByRole('link');
    expect(
      links.some((a) => a.getAttribute('href') === `/products/${MOCK_PRODUCTS[0]!.slug}`),
    ).toBe(true);
  });

  it('should render the empty branch when there are no products', () => {
    const featured: FeaturedResult = { products: [], error: false };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('目前沒有商品')).toBeDefined();
  });

  it('should render the error branch when the fetch failed', () => {
    const featured: FeaturedResult = { products: [], error: true };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('載入失敗、請稍後再試')).toBeDefined();
  });
});

// ── H6:橫捲軌道 ──────────────────────────────────────────────────────────────
describe('HomeSelect · 橫捲軌道(H6)', () => {
  const featured: FeaturedResult = { products: MOCK_PRODUCTS.slice(0, 5), error: false };

  it('🔴 每張卡都在自己的 `.b-carousel-item` 軌道格裡(格數 = 商品數)', () => {
    const { container } = render(<HomeSelect featured={featured} />);
    const track = container.querySelector('.b-carousel');
    expect(track, '找不到橫捲軌道 ⇒ 版面退回靜態 grid').not.toBeNull();
    expect(container.querySelectorAll('.b-carousel-item')).toHaveLength(5);
    // 軌道格是**外層包裝**,卡片本體照舊在裡面(不是把卡片拆掉重畫)
    expect(container.querySelector('.b-carousel-item a[href^="/products/"]')).not.toBeNull();
  });

  it('🔴 軌道可捲時兩顆箭頭都在、而且**接了線**(OD 只畫樣式沒接;死按鈕比沒按鈕更糟)', () => {
    const { container } = render(<HomeSelect featured={featured} />);
    const track = container.querySelector('.b-carousel') as HTMLElement;
    // jsdom 沒有 layout ⇒ 自己給軌道一組尺寸,才測得到「按了會捲」
    Object.defineProperty(track, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(track, 'clientWidth', { value: 800, configurable: true });
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy as unknown as typeof track.scrollBy;
    fireEvent.scroll(track); // 讓可捲判定與 disabled 狀態先更新(scrollLeft=0 ⇒ 只有「上一頁」該關)
    const prev = screen.getByLabelText('上一頁商品');
    const next = screen.getByLabelText('下一頁商品');
    expect(prev.tagName).toBe('BUTTON');
    expect(next.tagName).toBe('BUTTON');
    expect(next.hasAttribute('disabled'), '軌道還有得捲,「下一頁」卻是關的').toBe(false);
    fireEvent.click(next);
    expect(scrollBy, '按了「下一頁」卻沒有捲 ⇒ 箭頭是死的').toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0]![0]).toMatchObject({ behavior: 'smooth' });
    expect(scrollBy.mock.calls[0]![0].left, '捲的方向反了').toBeGreaterThan(0);
  });

  it('🔴 捲到頭 / 到底時對應的箭頭要 disabled(而不是按了沒反應)', () => {
    const { container } = render(<HomeSelect featured={featured} />);
    const track = container.querySelector('.b-carousel') as HTMLElement;
    Object.defineProperty(track, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(track, 'clientWidth', { value: 800, configurable: true });

    track.scrollLeft = 0;
    fireEvent.scroll(track);
    const prev = screen.getByLabelText('上一頁商品');
    const next = screen.getByLabelText('下一頁商品');
    expect(prev.hasAttribute('disabled'), '在最左端「上一頁」還能按').toBe(true);
    expect(next.hasAttribute('disabled')).toBe(false);

    track.scrollLeft = 1200; // = scrollWidth - clientWidth,已到底
    fireEvent.scroll(track);
    expect(prev.hasAttribute('disabled')).toBe(false);
    expect(next.hasAttribute('disabled'), '在最右端「下一頁」還能按').toBe(true);

    track.scrollLeft = 600; // 中間:兩顆都能按
    fireEvent.scroll(track);
    expect(prev.hasAttribute('disabled')).toBe(false);
    expect(next.hasAttribute('disabled')).toBe(false);
  });

  it('🔴 軌道捲不動時**整組箭頭不畫**(正式站只有 4 筆、桌機 5 格 ⇒ 填不滿一頁)', () => {
    // R1 M1 抓到的真情境:內容填不滿 ⇒ 舊寫法會把兩顆都設 disabled = 兩顆死按鈕。
    const { container } = render(<HomeSelect featured={featured} />);
    const track = container.querySelector('.b-carousel') as HTMLElement;
    Object.defineProperty(track, 'scrollWidth', { value: 800, configurable: true });
    Object.defineProperty(track, 'clientWidth', { value: 800, configurable: true });
    fireEvent.scroll(track);
    expect(container.querySelector('.b-select-nav'), '捲不動卻還畫著箭頭 ⇒ 沒有去處的 affordance').toBeNull();
    // 反面:一旦內容變得捲得動,箭頭要回來
    Object.defineProperty(track, 'scrollWidth', { value: 2000, configurable: true });
    fireEvent.scroll(track);
    expect(container.querySelector('.b-select-nav')).not.toBeNull();
  });

  it('🔴 軌道本身可聚焦且具名(Safari 沒有「可捲容器自動可聚焦」那個行為)', () => {
    const { container } = render(<HomeSelect featured={featured} />);
    const track = container.querySelector('.b-carousel') as HTMLElement;
    expect(track.getAttribute('tabindex'), '軌道不可聚焦 ⇒ Safari 鍵盤使用者完全捲不動').toBe('0');
    expect(track.getAttribute('role')).toBe('group');
    expect(track.getAttribute('aria-label'), '可聚焦卻沒有名字 ⇒ 報讀器唸不出這是什麼').toBeTruthy();
  });

  it('🔴 切到 empty 分支後不得留下箭頭(軌道沒了、按鈕還在 = 按了沒反應)', () => {
    const { container, rerender } = render(<HomeSelect featured={featured} />);
    const track = container.querySelector('.b-carousel') as HTMLElement;
    Object.defineProperty(track, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(track, 'clientWidth', { value: 800, configurable: true });
    fireEvent.scroll(track);
    expect(container.querySelector('.b-select-nav')).not.toBeNull();
    rerender(<HomeSelect featured={{ products: [], error: false }} />);
    expect(container.querySelector('.b-select-nav'), '商品沒了、箭頭還在').toBeNull();
  });

  it('🔴 OD 的副標「若有設定愛車…」不得出現(那個功能已被業務拍板凍結 = 對客人說謊)', () => {
    const { container } = render(<HomeSelect featured={featured} />);
    expect(container.textContent, 'OD 副標被搬進來了 ⇒ 承諾一個站上沒有的行為').not.toContain('若有設定愛車');
    // 標題本身維持凍結後的字面
    expect(screen.getByText('New Arrivals · 最新商品')).toBeDefined();
  });
});
