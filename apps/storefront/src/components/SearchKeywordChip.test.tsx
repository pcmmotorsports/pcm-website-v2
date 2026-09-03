// @vitest-environment jsdom
// SearchKeywordChip.test.tsx — ⟦搜尋-落點換 /products⟧ 2026-09-03
//
// 🔴🔴 **這支元件的存在理由是【誠實】,所以它的測試守的也是誠實,不是版面。**
//    `/products?search=` 走的是關鍵字資料路,而**那條路吃不到 facet**。
//    沒有這顆膠囊 ⇒ 客人看到一個「篩選都排在那裡、點了卻不會變」的目錄頁 = **安靜的錯**。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SearchKeywordChip } from './SearchKeywordChip';

const push = vi.fn();
let currentParams = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(currentParams),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  currentParams = '';
});

describe('SearchKeywordChip — 關鍵字要看得見、而且拿得掉', () => {
  it('🔵 沒有關鍵字 ⇒ 整區不畫(不要留一條空的膠囊列)', () => {
    const { container } = render(<SearchKeywordChip keyword={undefined} />);
    expect(container.textContent).toBe('');
  });

  it('🔴 有關鍵字 ⇒ 印出那個字, 而且帶「搜尋:」前綴', () => {
    const { container } = render(<SearchKeywordChip keyword='akrapovic' />);
    // 🎯 前綴是必要的 —— 少了它, 這顆與旁邊的品牌/分類膠囊長得一模一樣,
    //    而它們的意思完全不同(那些是篩選, 這顆是**這批商品的來源**)。
    expect(container.textContent).toContain('搜尋:akrapovic');
  });

  // 🔴🔴 **本片的驗收核心就是這一格。**
  //    ⚠️ 而它不能只斷言「有出現關鍵字」—— 那句話在「facet 有效」與「facet 無效」
  //      兩個世界裡是同一個字串 ⇒ **那就不是宣稱, 是標籤。**
  //    ⇒ ✅ 所以斷言的是那句話**講不講得出「左側篩選現在沒生效」與「怎麼辦」**。
  it('🔴🔴 那句提示要同時講出【篩選沒生效】與【他可以怎麼辦】', () => {
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    const text = container.textContent ?? '';
    expect(text, '沒講篩選/排序 ⇒ 客人不知道左邊為什麼點了沒用').toMatch(/篩選.*排序|排序.*篩選/);
    expect(text, '沒講出路 ⇒ 他只知道不能用, 不知道怎麼辦').toContain('移除關鍵字');
  });

  it('🔴 ✕ 掉 ⇒ 導到同一頁但沒有 search', () => {
    currentParams = 'search=mt07&sort=price-asc';
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    fireEvent.click(container.querySelector('.ac-chip')!);
    const url = String(push.mock.calls[0]?.[0] ?? '');
    expect(url.includes('search='), '關鍵字沒被拿掉 ⇒ 這顆膠囊的 ✕ 是假的').toBe(false);
    // 🎯 而**其他參數要留著** —— 客人排好的順序不該因為拿掉關鍵字就被清空。
    expect(url).toContain('sort=price-asc');
  });

  // 🔴 分母換了, 頁碼就不是同一批東西。
  it('🔴 ✕ 掉時 page 也要一起清(關鍵字幾百件 ⇒ 全目錄兩萬多件)', () => {
    currentParams = 'search=mt07&page=3';
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    fireEvent.click(container.querySelector('.ac-chip')!);
    const url = String(push.mock.calls[0]?.[0] ?? '');
    expect(url.includes('page='), '留著第 3 頁 ⇒ 他落在一個看起來像壞掉的位置').toBe(false);
  });

  it('🔵 負對照:只有 search 一個參數 ⇒ 清掉之後是乾淨路徑, 不是留一個 ?', () => {
    currentParams = 'search=mt07';
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    fireEvent.click(container.querySelector('.ac-chip')!);
    expect(push).toHaveBeenCalledWith('/products');
  });
});
