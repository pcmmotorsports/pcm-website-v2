// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductTaxonomyFilter } from './product-taxonomy-filter';
import {
  BRAND_PARAM,
  CATEGORY_PARAM,
  DEFAULT_PAGE_SIZE,
  SUBCATEGORY_PARAM,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';
import type { CategoryOption } from '../../lib/products/product-taxonomy-options';

// product-taxonomy-filter.test.tsx — 2026-08-19 品牌 / 分類篩選片。
//
// 🔴 **本檔守的不是「有沒有畫出來」,是三件會【安靜壞掉】的事**:
//    ① 兩顆下拉的 `name` 不同(同名 ⇒ HTML 兩個都送 ⇒ 解析成陣列 ⇒ 篩選整個失效而畫面正常)
//    ② 另外兩軸有 hidden 欄位帶著走(少了 ⇒ 選品牌會把搜尋詞洗掉,而清單真的變了 = 像生效了)
//    ③ 沒有 `page` 欄位(有了 ⇒ 換篩選還停在第 3 頁 ⇒ 空白畫面,看起來像查無結果)
//    這三件在畫面上**都不會報錯**。

afterEach(cleanup);

const NONE: AdminProductFilter = {
  setBy: undefined,
  keyword: undefined,
  brandId: undefined,
  categoryPath: undefined,
};

const BRANDS = [
  { id: 'b-1', name: 'Akrapovic' },
  { id: 'b-2', name: 'Brembo' },
];

const CATEGORIES: readonly CategoryOption[] = [
  {
    id: 'c-top',
    name: '引擎部品',
    rawPath: '引擎部品',
    children: [
      { id: 'c-a', name: '排氣管', rawPath: '引擎部品 · 排氣管', children: [] },
      { id: 'c-b', name: '空濾', rawPath: '引擎部品 · 空濾', children: [] },
    ],
  },
  // 🔴 沒有子類的大類 —— 用來驗「子分類下拉不該冒出來」那一格。
  { id: 'c-solo', name: '服務與其他', rawPath: '服務與其他', children: [] },
];

const setup = (filter: AdminProductFilter, size = DEFAULT_PAGE_SIZE) =>
  render(
    <ProductTaxonomyFilter
      filter={filter}
      size={size}
      brands={BRANDS}
      categories={CATEGORIES}
    />,
  );

/** 表單裡所有 hidden 欄位的 name。 */
function hiddenNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('input[type="hidden"]')].map((el) =>
    el.getAttribute('name') ?? '',
  );
}

describe('ProductTaxonomyFilter', () => {
  it('畫出品牌與分類兩顆下拉,選項來自傳進來的資料', () => {
    setup(NONE);
    expect(screen.getByLabelText('品牌')).toBeTruthy();
    expect(screen.getByLabelText('分類')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Akrapovic' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '引擎部品' })).toBeTruthy();
  });

  it('🔴 選中態靠網址 —— 傳進來的 filter 要變成下拉的預設選取', () => {
    const { container } = setup({ ...NONE, brandId: 'b-2', categoryPath: '引擎部品' });
    expect(container.querySelector<HTMLSelectElement>('#product-brand-filter')?.value).toBe('b-2');
    expect(container.querySelector<HTMLSelectElement>('#product-category-filter')?.value).toBe(
      '引擎部品',
    );
  });

  it('🔴🔴 兩顆分類下拉的 name **必須不同** —— 同名會讓篩選安靜失效', () => {
    const { container } = setup({ ...NONE, categoryPath: '引擎部品' });
    const top = container.querySelector('#product-category-filter')?.getAttribute('name');
    const sub = container.querySelector('#product-subcategory-filter')?.getAttribute('name');
    expect(top).toBe(CATEGORY_PARAM);
    expect(sub).toBe(SUBCATEGORY_PARAM);
    expect(top).not.toBe(sub);
  });

  it('選了子類 ⇒ 大類下拉停在它的父,子分類下拉停在它自己', () => {
    const { container } = setup({ ...NONE, categoryPath: '引擎部品 · 排氣管' });
    expect(container.querySelector<HTMLSelectElement>('#product-category-filter')?.value).toBe(
      '引擎部品',
    );
    expect(container.querySelector<HTMLSelectElement>('#product-subcategory-filter')?.value).toBe(
      '引擎部品 · 排氣管',
    );
  });

  it('✅ 負向對照:沒選大類 ⇒ 子分類下拉**不存在**(不是存在但空的)', () => {
    const { container } = setup(NONE);
    expect(container.querySelector('#product-subcategory-filter')).toBeNull();
  });

  it('✅ 負向對照:選的大類沒有子類 ⇒ 子分類下拉一樣**不存在**', () => {
    // 畫出來會是一顆只有「全部子分類」的下拉 —— 那是一個假的選擇。
    const { container } = setup({ ...NONE, categoryPath: '服務與其他' });
    expect(container.querySelector('#product-subcategory-filter')).toBeNull();
  });

  it('🔴 認不得的 raw_path ⇒ 退回「全部」而不是崩掉(網址可以被亂改)', () => {
    const { container } = setup({ ...NONE, categoryPath: '這個分類不存在' });
    expect(container.querySelector<HTMLSelectElement>('#product-category-filter')?.value).toBe('');
    expect(container.querySelector('#product-subcategory-filter')).toBeNull();
  });

  it('🔴🔴 另外兩軸要有 hidden 欄位帶著走 —— 少了會把搜尋詞/chip 洗掉', () => {
    const { container } = setup({ ...NONE, setBy: 'staff', keyword: 'brembo' }, 500);
    const names = hiddenNames(container);
    expect(names).toContain('set_by');
    expect(names).toContain('q');
    expect(names).toContain('size');
  });

  it('🔴 `page` **不得**有欄位 —— 換篩選要回第 1 頁', () => {
    const { container } = setup({ ...NONE, setBy: 'staff' });
    expect(hiddenNames(container)).not.toContain('page');
  });

  it('✅ 負向對照:預設筆數不送 hidden(否則書籤會凍住一個當時的預設值)', () => {
    const { container } = setup(NONE, DEFAULT_PAGE_SIZE);
    expect(hiddenNames(container)).not.toContain('size');
  });

  it('🔴 品牌下拉的 name 是字面 `brand`(不是拿常數跟它自己比)', () => {
    // R1 nit-8:元件與測試讀同一個常數 ⇒ 把常數改成 'x' 這格照樣綠。
    // 網址上真正出現的那個字才是契約 ⇒ 斷言字面,並順帶釘住常數沒被改掉。
    const { container } = setup(NONE);
    expect(container.querySelector('#product-brand-filter')?.getAttribute('name')).toBe('brand');
    expect(BRAND_PARAM).toBe('brand');
  });

  it('🔴 分類兩顆的 name 也斷言字面(同 nit-8 的理由)', () => {
    const { container } = setup({ ...NONE, categoryPath: '引擎部品' });
    expect(container.querySelector('#product-category-filter')?.getAttribute('name')).toBe(
      'category',
    );
    expect(container.querySelector('#product-subcategory-filter')?.getAttribute('name')).toBe(
      'subcategory',
    );
    expect([CATEGORY_PARAM, SUBCATEGORY_PARAM]).toEqual(['category', 'subcategory']);
  });

  it('🔴 按鈕文案是「套用篩選」不是「套用」—— 同頁的每頁筆數表單已經有一顆叫「套用」', () => {
    // 這一格是在真瀏覽器上撞出來的(playwright strict-mode 撞名),不是想出來的:
    // 兩顆同名的鈕,螢幕閱讀器的使用者聽到的是一模一樣的兩個名字。
    // 🔴 **2026-08-19 起加了 `hidden: true`,而那不是為了讓這格繼續綠**:
    //    `AutoApplySubmit` 掛上監聽後會把鈕收起來(有 JS 時它多餘)⇒ jsdom 這份一定是 hidden 的。
    //    **而這格要守的東西沒有變**:關掉 JS 時兩顆鈕都看得見、名字仍不能撞。
    //    ⇒ 「沒有 JS 時它看得見」由 `shared/auto-apply-submit.test.tsx` 用 server 端輸出守著,
    //       那一題 jsdom 答不出來(effect 一定會跑完)。
    // 🔴 而**不能**用 `getByRole('button', { name })` 抓它(我試過,紅的):`hidden` 屬性
    //    在 jsdom 的預設樣式表下是 `display:none` ⇒ 無障礙名稱計算回空字串,連 `hidden: true`
    //    也救不了。⇒ 改抓元素本身、斷言字面 —— **要守的字面一個字沒變**。
    const { container } = setup(NONE);
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('套用篩選');
  });

  it('表單是 GET、action 指向 /products —— 沒有 JS 時整條路照樣走得通', () => {
    // ⚠️ 標題原本寫「不靠任何 onChange」,2026-08-19 起**不再為真**:
    //    `AutoApplySubmit` 會在 form 上掛 `change` 監聽(Sean 要「點選後自動跳」)。
    //    改掉那半句而不是留著 —— 一個當下為假的斷言標題,下一個人會照它推論。
    //    **本格斷言的東西一個字沒變**:表單本身仍是零 JS 的 GET,JS 只加快、不是前提。
    const { container } = setup(NONE);
    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.getAttribute('action')).toBe('/products');
  });
});
