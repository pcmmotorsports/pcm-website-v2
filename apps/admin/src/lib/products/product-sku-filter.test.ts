import { describe, expect, it } from 'vitest';
import {
  MAX_SKU_CHARS,
  MAX_SKU_COUNT,
  SKU_PARAM,
  buildProductListHref,
  parseProductListParams,
  parseProductSkus,
  DEFAULT_PAGE_SIZE,
  type AdminProductFilter,
} from './product-list-view';

// 貼料號那一軸(片:商品頁「其他篩選方式」③)。
//
// 🔴 本檔的每一條規則都對應一個【對正式庫量到的事實】,不是挑的。量法逐條寫在斷言旁。

const F = (over: Partial<AdminProductFilter> = {}): AdminProductFilter => ({
  setBy: undefined,
  keyword: undefined,
  brandId: undefined,
  categoryPath: undefined,
  skus: undefined,
  ...over,
});

describe('parseProductSkus', () => {
  it('換行與逗號都收 —— 員工從 Excel 貼進來是換行,網址回來是逗號', () => {
    expect(parseProductSkus('A-1\nB-2\nC-3')).toEqual(['A-1', 'B-2', 'C-3']);
    expect(parseProductSkus('A-1,B-2,C-3')).toEqual(['A-1', 'B-2', 'C-3']);
    expect(parseProductSkus('A-1\nB-2,C-3')).toEqual(['A-1', 'B-2', 'C-3']);
  });

  it('🔴🔴 料號【內部的空白要留著】—— 正式庫有 347 個料號本身含空白', () => {
    // 量法:SELECT count(*) FROM product_variants WHERE sku LIKE '% %'  ⇒ 347 / 51,645
    // ⇒ 用 /\s+/ 切會把這 347 個切碎,而症狀是「這個料號查不到」——
    //   員工只會以為是資料沒進來,不會想到是我們把它切斷了。
    expect(parseProductSkus('BRM 19RCS CL\nRZM-BS935B')).toEqual(['BRM 19RCS CL', 'RZM-BS935B']);
  });

  it('只 trim 前後,不動大小寫', () => {
    // 量法:WHERE sku <> btrim(sku) ⇒ 0 ⇒ trim 不會改到任何真料號
    expect(parseProductSkus('  A-1  \n\t B-2 ')).toEqual(['A-1', 'B-2']);
    // .in() 是精確比對 ⇒ 自作主張轉大寫會查不到
    expect(parseProductSkus('brm-19rcs')).toEqual(['brm-19rcs']);
  });

  it('去重、丟掉空行', () => {
    expect(parseProductSkus('A-1\n\nA-1\n\n B-2 \n')).toEqual(['A-1', 'B-2']);
  });

  it('沒東西 / 不是字串 ⇒ undefined(= 不篩,不是「篩空的」)', () => {
    expect(parseProductSkus('')).toBeUndefined();
    expect(parseProductSkus('  \n , \n ')).toBeUndefined();
    expect(parseProductSkus(undefined)).toBeUndefined();
    expect(parseProductSkus(['A-1'])).toBeUndefined();
  });

  it('🔴 筆數上限', () => {
    const many = Array.from({ length: MAX_SKU_COUNT + 50 }, (_, i) => `S${i}`).join('\n');
    expect(parseProductSkus(many)).toHaveLength(MAX_SKU_COUNT);
    // 對照組:剛好在上限內要全收(否則這格在「永遠只回 100 個」的世界也綠)
    const exact = Array.from({ length: MAX_SKU_COUNT }, (_, i) => `S${i}`).join('\n');
    expect(parseProductSkus(exact)).toHaveLength(MAX_SKU_COUNT);
  });

  it('🔴 字元上限【單獨】也擋得住 —— 只限筆數不夠', () => {
    // 量法:100 個典型料號 = 1,216 字元;100 個【最長】料號 = 5,472 字元
    //      ⇒ 筆數沒超而網址已經爆掉,那個人不會知道為什麼
    const longOnes = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(2, '0')}${'X'.repeat(60)}`);
    const got = parseProductSkus(longOnes.join('\n'));
    expect(got!.length).toBeLessThan(60); // 筆數沒到 100 就先被字元上限攔下
    expect(got!.join('').length).toBeLessThanOrEqual(MAX_SKU_CHARS);
  });
});

describe('料號那一軸的來回(網址 → filter → 網址)', () => {
  it('進得去也出得來,而且順序不變', () => {
    const href = buildProductListHref(F({ skus: ['A-1', 'B 2', 'C-3'] }), {
      page: 1,
      size: DEFAULT_PAGE_SIZE,
    });
    const back = parseProductListParams(
      Object.fromEntries(new URL(href, 'http://x').searchParams.entries()),
    );
    expect(back.filter.skus).toEqual(['A-1', 'B 2', 'C-3']);
  });

  it('🔴 含空白的料號經過網址一趟仍然完整(這是那 347 個的回歸格)', () => {
    const href = buildProductListHref(F({ skus: ['BRM 19RCS CL'] }), {
      page: 1,
      size: DEFAULT_PAGE_SIZE,
    });
    expect(href).toContain(SKU_PARAM);
    const back = parseProductListParams(
      Object.fromEntries(new URL(href, 'http://x').searchParams.entries()),
    );
    expect(back.filter.skus).toEqual(['BRM 19RCS CL']);
  });

  it('沒貼料號 ⇒ 網址裡不出現這個 param(網址要短、要可讀)', () => {
    const href = buildProductListHref(F(), { page: 1, size: DEFAULT_PAGE_SIZE });
    expect(href).not.toContain(SKU_PARAM);
  });
});
