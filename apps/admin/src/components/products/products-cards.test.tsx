// @vitest-environment jsdom
// 商品頁乙 E1–E2:卡片檢視(計畫 ~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第五節 E)。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { ProductsCards } = await import('./products-cards');
import type { AdminProductListRow } from '../../lib/products/product-repository';

const ROW: AdminProductListRow = {
  id: '11111111-2222-4333-8444-555555555555', title: 'Brake Lever', external_id: 'X-1', price_general: 1000, delisted_at: null,
  listing_set_by: 'sync', source_missing_at: null, brands: { name: 'B' }, categories: { raw_path: 'A · B' },
  override_title: '煞車拉桿', thumb: 'https://img.example.com/a.jpg', image_missing: false, availability: 'in-stock',
};

const html = (rows: AdminProductListRow[], listHref = '/products?view=x') =>
  renderToStaticMarkup(
    <ProductsCards rows={rows} listHref={listHref} emptyText='目前沒有商品。' editHref={(id) => `/products?edit=${id}`} />,
  );

describe('ProductsCards', () => {
  it('🔴 每件一張卡:大縮圖、客人看到的標題(連到明細頁, 帶回列表的網址)、料號、售價、狀態', () => {
    const out = html([ROW]);
    expect(out).toContain('src="https://img.example.com/a.jpg"');
    expect(out).toContain('煞車拉桿');
    expect(out).not.toContain('>Brake Lever<');
    expect(out).toContain('X-1');
    expect(out).toContain('NT$ 1,000');
    expect(out).toContain('上架中');
    expect(out).toMatch(/href="\/products\/11111111-2222-4333-8444-555555555555\?from=/);
  });

  it('🔴 E2:每張卡有勾選框, 形狀與表格相同(批次按鈕列讀 data-product-select)', () => {
    const doc = new DOMParser().parseFromString(html([ROW]), 'text/html');
    const box = doc.querySelector('input[type="checkbox"][data-product-select]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.value).toBe(ROW.id);
    expect(box.getAttribute('data-title')).toBe('煞車拉桿');
    expect(doc.querySelector('[data-product-select-all]')).not.toBeNull();
  });

  it('代表圖待補 ⇒ 不顯示那張佔位圖, 寫「代表圖待補」', () => {
    const out = html([{ ...ROW, image_missing: true, thumb: 'https://www.gbracing.eu/x/no-image-1.jpg' }]);
    expect(out).not.toContain('no-image-1.jpg');
    expect(out).toContain('代表圖待補');
  });

  it('狀態與表格同一套:已下架不標缺貨;上架中而且缺貨另外標', () => {
    expect(html([{ ...ROW, availability: 'out-of-stock' }])).toContain('缺貨');
    const delisted = html([{ ...ROW, availability: 'out-of-stock', delisted_at: '2026-09-01T00:00:00Z' }]);
    expect(delisted).toContain('已下架');
    expect(delisted).not.toContain('缺貨');
  });

  it('沒有商品 ⇒ 顯示空白說明', () => {
    expect(html([])).toContain('目前沒有商品。');
  });

  it('🔴 每張卡有「快速編輯」, 指向那一件的 ?edit=', () => {
    expect(html([ROW])).toMatch(/href="\/products\?edit=11111111-2222-4333-8444-555555555555"[^>]*>快速編輯</);
  });
});
