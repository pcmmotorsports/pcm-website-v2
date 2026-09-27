// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { ProductsTable } = await import('./products-table');
import type { AdminProductListRow } from '../../lib/products/product-repository';

const ROW: AdminProductListRow = {
  id: 'p1', title: 'Brake Lever', external_id: 'X-1', price_general: 1000, delisted_at: null,
  listing_set_by: 'sync', source_missing_at: null, brands: { name: 'B' }, categories: { raw_path: 'A · B' },
  override_title: null, thumb: 'https://img.example.com/a.jpg', image_missing: false, availability: 'in-stock',
};

describe('商品頁乙 A4:縮圖與缺貨標記', () => {
  it('有真圖 ⇒ 顯示縮圖;代表圖待補 ⇒ 空框寫「待補」,不顯示那張佔位圖', () => {
    const ok = renderToStaticMarkup(<ProductsTable rows={[ROW]} />);
    expect(ok).toContain('src="https://img.example.com/a.jpg"');
    const missing = renderToStaticMarkup(<ProductsTable rows={[{ ...ROW, image_missing: true, thumb: 'https://www.gbracing.eu/x/no-image-1.jpg' }]} />);
    expect(missing).toContain('待補');
    expect(missing).not.toContain('no-image-1.jpg');
  });

  it('上架中而且缺貨 ⇒ 另外標「缺貨」;已下架的不標缺貨(三件事分開)', () => {
    expect(renderToStaticMarkup(<ProductsTable rows={[{ ...ROW, availability: 'out-of-stock' }]} />)).toContain('缺貨');
    const delisted = renderToStaticMarkup(<ProductsTable rows={[{ ...ROW, availability: 'out-of-stock', delisted_at: '2026-09-01T00:00:00Z' }]} />);
    expect(delisted).toContain('已下架');
    expect(delisted).not.toContain('缺貨');
  });
});

// Sean 2026-09-28:「快速編輯」側邊欄。每一列多一個連結(帶 ?edit=), 點名稱照舊進整頁。
describe('快速編輯連結', () => {
  it('🔴 有給 editHref ⇒ 每一列都有「快速編輯」, 指向那一件的 ?edit=', () => {
    const out = renderToStaticMarkup(<ProductsTable rows={[ROW]} editHref={(id) => `/products?edit=${id}`} />);
    expect(out).toMatch(/href="\/products\?edit=p1"[^>]*>快速編輯</);
  });
  it('沒給 editHref ⇒ 不畫(其他用到表格的地方不受影響)', () => {
    expect(renderToStaticMarkup(<ProductsTable rows={[ROW]} />)).not.toContain('快速編輯');
  });
});

