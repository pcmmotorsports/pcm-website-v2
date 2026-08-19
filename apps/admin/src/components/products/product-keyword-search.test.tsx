// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductKeywordSearch } from './product-keyword-search';
import {
  DEFAULT_PAGE_SIZE,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';

// product-keyword-search.test.tsx — `#661`。
//
// 🔴 這一組守的不是「有沒有畫出來」,是**三件會靜默壞掉的事**:
//    ① 送出方式必須是 GET(改成 POST ⇒ 網址不會帶 q ⇒ 加書籤與上一頁全失效,而畫面一樣)
//    ② 分類必須被帶著走(漏了 ⇒ 搜尋一次把分類洗掉,而畫面看起來完全正常)
//    ③ 清除只拿掉搜尋詞、保留分類(拿錯 ⇒ 員工被踢回全部商品)

const NONE: AdminProductFilter = { setBy: undefined, keyword: undefined };

afterEach(cleanup);

function formOf(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form');
  if (form === null) throw new Error('畫面上沒有 form');
  return form;
}

describe('#661 ProductKeywordSearch', () => {
  it('🔴 送出方式是 GET、目的地是 /products —— 這一格擋的是「改成 POST 之後網址不帶 q」', () => {
    const { container } = render(<ProductKeywordSearch filter={NONE} size={DEFAULT_PAGE_SIZE} />);
    const form = formOf(container);
    // getAttribute 不是 form.method:後者會把缺值正規化成 'get',那樣**漏寫也會綠**。
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/products');
  });

  it('輸入框的 name 是 q,並回填目前的搜尋詞', () => {
    render(<ProductKeywordSearch filter={{ setBy: undefined, keyword: 'brembo' }} size={DEFAULT_PAGE_SIZE} />);
    const input = screen.getByLabelText('搜尋');
    expect(input.getAttribute('name')).toBe('q');
    expect((input as HTMLInputElement).value).toBe('brembo');
  });

  it('🔴🔴 有分類時要有 set_by 的 hidden —— 沒有它,搜尋一次就把分類洗掉', () => {
    const { container } = render(
      <ProductKeywordSearch filter={{ setBy: 'staff', keyword: undefined }} size={DEFAULT_PAGE_SIZE} />,
    );
    const hidden = container.querySelector('input[type="hidden"][name="set_by"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.getAttribute('value')).toBe('staff');
  });

  it('沒有分類時不要送空的 set_by(負向對照:證明上一格不是恆真)', () => {
    const { container } = render(<ProductKeywordSearch filter={NONE} size={DEFAULT_PAGE_SIZE} />);
    expect(container.querySelector('input[type="hidden"][name="set_by"]')).toBeNull();
  });

  it('🔴 沒有 page 的 hidden —— 換搜尋詞要回第 1 頁,而「沒有那個欄位」就是做法', () => {
    const { container } = render(
      <ProductKeywordSearch filter={{ setBy: 'sync', keyword: 'x' }} size={DEFAULT_PAGE_SIZE} />,
    );
    expect(container.querySelector('input[name="page"]')).toBeNull();
  });

  it('沒搜尋時不畫「清除搜尋」', () => {
    render(<ProductKeywordSearch filter={NONE} size={DEFAULT_PAGE_SIZE} />);
    expect(screen.queryByText('清除搜尋')).toBeNull();
  });

  it('🔴 清除搜尋只拿掉 q、保留分類 —— 拿錯會把員工踢回全部商品', () => {
    render(<ProductKeywordSearch filter={{ setBy: 'staff', keyword: 'brembo' }} size={DEFAULT_PAGE_SIZE} />);
    const link = screen.getByText('清除搜尋');
    expect(link.getAttribute('href')).toBe('/products?set_by=staff');
  });

  it('目前搜尋的詞要顯示出來(員工要看得到自己在哪個篩選狀態)', () => {
    const { container } = render(
      <ProductKeywordSearch filter={{ setBy: undefined, keyword: '煞車皮' }} size={DEFAULT_PAGE_SIZE} />,
    );
    expect(container.textContent ?? '').toContain('煞車皮');
  });
});
