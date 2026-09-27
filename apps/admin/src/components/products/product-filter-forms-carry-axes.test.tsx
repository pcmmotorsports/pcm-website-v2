// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductKeywordSearch } from './product-keyword-search';
import { ProductSkuFilter } from './product-sku-filter';
import { ProductTaxonomyFilter } from './product-taxonomy-filter';
import {
  DEFAULT_PAGE_SIZE,
  filterHiddenFields,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';

// 商品頁乙 A2(Codex 必修 1):三張 GET 表單各自手寫要帶走的篩選,新加的「要處理」三張都漏了。
// 這一格拿【每一軸都有值】的篩選去畫三張表單,逐軸檢查:除了表單自己那一軸,其他軸都要以 hidden 欄位送出。
// ⇒ 以後 AdminProductFilter 再加一軸而某張表單沒帶,這一格會紅(不用等有人回報「條件被洗掉」)。

const ALL: AdminProductFilter = {
  setBy: 'staff',
  keyword: 'brembo',
  brandIds: ['00000000-0000-4000-8000-000000000001'],
  categoryPath: '引擎部品',
  skus: ['SKU-1'],
  attention: ['out_of_stock', 'image_missing'],
  sort: 'price_desc',
};

/** 畫出來的 HTML 裡,每個 hidden 欄位的 name → value。 */
function hiddenFields(html: string): Map<string, string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return new Map(
    [...doc.querySelectorAll<HTMLInputElement>('input[type=hidden]')].map((el) => [el.name, el.value]),
  );
}

/** 表單自己那一軸 ⇒ 由表單的可見欄位送出,不需要 hidden。 */
const FORMS: ReadonlyArray<[string, string, readonly (keyof AdminProductFilter)[]]> = [
  ['搜尋框', renderToStaticMarkup(<ProductKeywordSearch filter={ALL} size={DEFAULT_PAGE_SIZE} />), ['keyword']],
  [
    '品牌分類',
    renderToStaticMarkup(<ProductTaxonomyFilter filter={ALL} size={DEFAULT_PAGE_SIZE} brands={[]} categories={[]} />),
    ['brandIds', 'categoryPath'],
  ],
  ['貼料號', renderToStaticMarkup(<ProductSkuFilter filter={ALL} size={DEFAULT_PAGE_SIZE} />), ['skus']],
];

describe('三張篩選表單送出時,其他篩選都要帶著走', () => {
  it.each(FORMS)('%s', (_name, html, own) => {
    const hidden = hiddenFields(html);
    const others: AdminProductFilter = { ...ALL, ...Object.fromEntries(own.map((k) => [k, undefined])) };
    for (const [param, value] of Object.entries(filterHiddenFields(others))) {
      if (value === undefined) continue;
      expect(hidden.get(param), `少帶 ?${param}=`).toBe(value);
    }
  });
});
