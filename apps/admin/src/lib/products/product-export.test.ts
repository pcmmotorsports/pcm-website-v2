import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CSV_BOM } from '../orders/order-export';
import {
  PRODUCT_EXPORT_BATCH,
  PRODUCT_EXPORT_CAP,
  PRODUCT_EXPORT_HEADER,
  basisDealerPrice,
  buildProductExportCsv,
  collectProductsForExport,
  productExportFilename,
  productExportFilterNote,
  productExportHref,
  productExportRow,
  type ProductExportRow,
} from './product-export';

// product-export.test.ts — 商品清單匯出(M-4a-24 第二片)。
// 守三件事:① 整份(少讀、位移、超過上限都擋下,不交半份檔)② 店家價挑對那一支變體 ③ 欄位與檔案說明。

function row(over: Partial<ProductExportRow> = {}): ProductExportRow {
  return {
    id: 'p-1',
    title: '供應商標題',
    external_id: 'EXT-1',
    price_general: 1200,
    delisted_at: null,
    staff_overrides: {},
    brands: { name: 'BREMBO' },
    categories: { raw_path: '煞車 · 卡鉗' },
    product_variants: [{ sku: 'A', price_general: 1200, price_store: 1000 }],
    ...over,
  };
}

function lister(pages: Array<{ items: ProductExportRow[]; total: number }>) {
  const calls: Array<[number, number]> = [];
  const fn = async (limit: number, offset: number) => {
    calls.push([limit, offset]);
    // 沒準備的批次 ⇒ 空的一批、總數同最後一批(給「只看有沒有被上限擋」那格用)
    return pages[Math.floor(offset / PRODUCT_EXPORT_BATCH)] ?? { items: [], total: pages.at(-1)!.total };
  };
  return { fn, calls };
}

function many(n: number, from = 0): ProductExportRow[] {
  return Array.from({ length: n }, (_, i) => row({ id: `p-${from + i}` }));
}

describe('collectProductsForExport', () => {
  it('分批讀到最後一件, 每批都用同一個批量', async () => {
    const total = PRODUCT_EXPORT_BATCH + 3;
    const { fn, calls } = lister([
      { items: many(PRODUCT_EXPORT_BATCH), total },
      { items: many(3, PRODUCT_EXPORT_BATCH), total },
    ]);
    const r = await collectProductsForExport(fn);
    expect(r.kind).toBe('ok');
    expect(r.kind === 'ok' && r.rows.length).toBe(total);
    expect(calls).toEqual([
      [PRODUCT_EXPORT_BATCH, 0],
      [PRODUCT_EXPORT_BATCH, PRODUCT_EXPORT_BATCH],
    ]);
  });

  it('超過上限 ⇒ 擋下, 只讀第一批', async () => {
    const { fn, calls } = lister([{ items: many(PRODUCT_EXPORT_BATCH), total: PRODUCT_EXPORT_CAP + 1 }]);
    expect(await collectProductsForExport(fn)).toEqual({ kind: 'too_many', total: PRODUCT_EXPORT_CAP + 1 });
    expect(calls.length).toBe(1);
  });

  it('剛好等於上限 ⇒ 照常匯出(上限是含的)', async () => {
    const { fn } = lister([{ items: many(PRODUCT_EXPORT_BATCH), total: PRODUCT_EXPORT_CAP }]);
    const r = await collectProductsForExport(fn);
    expect(r.kind).not.toBe('too_many');
  });

  it('途中總數變了 ⇒ 擋下', async () => {
    const { fn } = lister([
      { items: many(PRODUCT_EXPORT_BATCH), total: PRODUCT_EXPORT_BATCH + 1 },
      { items: many(2, PRODUCT_EXPORT_BATCH), total: PRODUCT_EXPORT_BATCH + 2 },
    ]);
    expect((await collectProductsForExport(fn)).kind).toBe('changed_while_reading');
  });

  it('總數沒變但整串位移(同一件讀兩次) ⇒ 擋下', async () => {
    const { fn } = lister([
      { items: many(PRODUCT_EXPORT_BATCH), total: PRODUCT_EXPORT_BATCH + 1 },
      { items: many(1, PRODUCT_EXPORT_BATCH - 1), total: PRODUCT_EXPORT_BATCH + 1 },
    ]);
    expect(await collectProductsForExport(fn)).toEqual({
      kind: 'changed_while_reading',
      got: PRODUCT_EXPORT_BATCH,
      total: PRODUCT_EXPORT_BATCH + 1,
    });
  });

  it('一批被資料庫砍短(回的比要的少) ⇒ 擋下, 不交半份', async () => {
    const { fn } = lister([{ items: many(PRODUCT_EXPORT_BATCH - 1), total: PRODUCT_EXPORT_BATCH }]);
    expect((await collectProductsForExport(fn)).kind).toBe('changed_while_reading');
  });
});

describe('basisDealerPrice:照經銷目錄 view 挑基準款變體', () => {
  it('一般價最低的那支', () => {
    expect(
      basisDealerPrice([
        { sku: 'A', price_general: 2000, price_store: 1800 },
        { sku: 'B', price_general: 1500, price_store: 1300 },
      ]),
    ).toBe(1300);
  });

  it('同價取 sku 字元碼最小(大寫排在小寫前面, 同 COLLATE "C")', () => {
    expect(
      basisDealerPrice([
        { sku: 'a-1', price_general: 1000, price_store: 900 },
        { sku: 'B-1', price_general: 1000, price_store: 800 },
      ]),
    ).toBe(800);
  });

  it('一般價空的排最後', () => {
    expect(
      basisDealerPrice([
        { sku: 'A', price_general: null, price_store: 1 },
        { sku: 'B', price_general: 999, price_store: 700 },
      ]),
    ).toBe(700);
  });

  it('基準款沒有經銷價 ⇒ 空, 不拿別支的來補、也不退回一般價', () => {
    expect(
      basisDealerPrice([
        { sku: 'A', price_general: 1000, price_store: null },
        { sku: 'B', price_general: 2000, price_store: 1500 },
      ]),
    ).toBeNull();
  });

  it('沒有變體 ⇒ 空', () => {
    expect(basisDealerPrice([])).toBeNull();
    expect(basisDealerPrice(null)).toBeNull();
  });
});

describe('每件商品一列', () => {
  it('欄序 = 品牌、料號、品名、分類、上架狀態、一般價、店家價', () => {
    expect([...PRODUCT_EXPORT_HEADER]).toEqual(['品牌', '料號', '品名', '分類', '上架狀態', '一般價', '店家價']);
    expect(productExportRow(row())).toEqual(['BREMBO', 'EXT-1', '供應商標題', '煞車 · 卡鉗', '上架中', '1200', '1000']);
  });

  it('員工改過標題 ⇒ 品名用改過的(客人看到的那個)', () => {
    expect(productExportRow(row({ staff_overrides: { title: '我們的標題' } }))[2]).toBe('我們的標題');
  });

  it('已下架、沒品牌沒分類、沒價格 ⇒ 看得出來, 不是亂填', () => {
    expect(
      productExportRow(
        row({ delisted_at: '2026-09-01T00:00:00Z', brands: null, categories: null, price_general: null, product_variants: [] }),
      ),
    ).toEqual(['', 'EXT-1', '供應商標題', '', '已下架', '', '']);
  });

  it('一般價 0 元照印 0, 不當成空的', () => {
    expect(productExportRow(row({ price_general: 0 }))[5]).toBe('0');
  });
});

describe('整份 CSV', () => {
  const csv = buildProductExportCsv([row()], { total: 1, filterNote: '品牌 BREMBO', dataAsOf: '2026-09-27 12:00' });
  const lines = csv.replace(CSV_BOM, '').split('\r\n');

  it('BOM 開頭;第一列說明檔案(件數、篩選、資料截至、店家價的意思), 第二列表頭', () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(lines[0]).toContain('共 1 件');
    expect(lines[0]).toContain('品牌 BREMBO');
    expect(lines[0]).toContain('資料截至 2026-09-27 12:00');
    expect(lines[0]).toContain('未含個別經銷商的品牌折扣');
    // 缺經銷價時經銷會員看不到價格、不能下單(20260925050000 D1 起);不能寫成「看到一般價」
    expect(lines[0]).toContain('經銷會員目前看不到價格、無法下單');
    expect(lines[0]).not.toContain('看到的是一般價');
    expect(lines[1]).toBe(PRODUCT_EXPORT_HEADER.join(','));
  });

  it('品名以 = 開頭 ⇒ 走共用逃脫, 試算表不會當公式', () => {
    const out = buildProductExportCsv([row({ title: '=HYPERLINK("x")' })], { total: 1, filterNote: '無篩選', dataAsOf: 'x' });
    expect(out).not.toContain(',=HYPERLINK');
  });
});

describe('篩選說明、檔名、網址', () => {
  it('沒篩選 ⇒「無篩選」', () => {
    expect(
      productExportFilterNote({ brandNames: [], skuCount: 0, brandFilterDropped: false, categoryFilterDropped: false }),
    ).toBe('無篩選');
  });

  it('只寫真的套上的;網址帶了卻沒套上的也講出來', () => {
    const note = productExportFilterNote({
      keyword: '卡鉗',
      setBy: 'staff',
      brandNames: ['BREMBO'],
      categoryPath: '煞車 · 卡鉗',
      skuCount: 3,
      brandFilterDropped: true,
      categoryFilterDropped: true,
    });
    expect(note).toContain('搜尋「卡鉗」');
    expect(note).toContain('品牌 BREMBO');
    expect(note).toContain('料號批次 3 個');
    expect(note).not.toContain('分類 煞車');
    expect(note).toContain('沒有依分類篩選');
    expect(note).toContain('品牌有找不到的');
  });

  it('檔名走台北日期(UTC 前一天 16:30 = 台北隔天)', () => {
    expect(productExportFilename(new Date('2026-09-26T16:30:00Z'))).toBe('商品清單-20260927.csv');
  });

  it('列表網址 ⇒ 匯出網址, 篩選參數原封', () => {
    expect(productExportHref('/products')).toBe('/products/export');
    expect(productExportHref('/products?brand=u1&q=x')).toBe('/products/export?brand=u1&q=x');
  });
});
