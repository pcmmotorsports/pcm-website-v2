import { describe, expect, it, vi } from 'vitest';
import type { INewProductDraftStore, NewProductCandidate, NewProductDraft } from '@pcm/ports';
import { buildNewProductDraft, draftNewProductPosts } from './draft-new-product-posts';

const SITE = 'https://www.pcmmotorsports.com';

function cand(over: Partial<NewProductCandidate> = {}): NewProductCandidate {
  return {
    productId: over.productId ?? 'p1',
    handle: 'materya-mty033',
    title: 'Lever Guard 拉桿護弓',
    subtitle: 'Yamaha YZF-R9 2024+',
    brandName: 'Materya',
    brandSlug: 'materya',
    categoryName: '拉桿護弓',
    priceGeneral: 3200,
    imageUrl: 'https://img.test/a.jpg',
    highlights: ['主體：實心鋁合金 CNC 切削', '端部：鈦金屬'],
    sku: 'MTY033N',
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

class FakeStore implements INewProductDraftStore {
  readonly drafts: NewProductDraft[] = [];
  constructor(private readonly existing: ReadonlySet<string> = new Set()) {}
  async create(d: NewProductDraft): Promise<'created' | 'duplicate'> {
    if (this.existing.has(d.sourceProductId)) return 'duplicate';
    this.drafts.push(d);
    return 'created';
  }
}

function run(cands: NewProductCandidate[], store = new FakeStore(), perDay?: number) {
  const source = { listNewSince: async () => cands };
  return draftNewProductPosts({ source, store, siteUrl: SITE, now: () => new Date('2026-10-02T01:00:00Z'), perDay });
}

describe('buildNewProductDraft', () => {
  it('組出大圖欄位與帶 UTM 的 FB / IG 文字', () => {
    const r = buildNewProductDraft(cand(), SITE);
    if (!('draft' in r)) throw new Error('應該建得出草稿');
    expect(r.draft).toMatchObject({
      sourceProductId: 'p1', eyebrow: 'Materya', titleLine1: 'Lever Guard 拉桿護弓',
      subtitle: 'Yamaha YZF-R9 2024+', ctaLabel: '看商品', linkPath: '/products/materya-mty033',
      imageDesktopUrl: 'https://img.test/a.jpg',
    });
    expect(r.draft.fbText).toContain(`${SITE}/products/materya-mty033?utm_source=facebook&utm_medium=social&utm_campaign=mty033n`);
    expect(r.draft.igText).toContain('官網搜尋料號 MTY033N');
  });

  it.each([
    [{ imageUrl: null }, 'no_image'],
    [{ imageUrl: 'http://img.test/a.jpg' }, 'no_image'],
    [{ imageUrl: 'https://img.test/a b.jpg' }, 'no_image'],
    [{ imageUrl: `https://img.test/${'x'.repeat(2000)}.jpg` }, 'no_image'],
    [{ priceGeneral: null }, 'no_price'],
    [{ priceGeneral: 0 }, 'no_price'],
    [{ highlights: ['  '] }, 'no_highlights'],
    [{ title: '拉'.repeat(61) }, 'title_too_long'],
    [{ title: 'Lever Guard' }, 'no_chinese_title'],
    [{ imageUrl: 'https://quote.pcmmotorsports.com/no-photo.png' }, 'no_image'],
    [{ highlights: ['台灣現貨'] }, 'red_flag'],
    [{ highlights: ['終身保固'] }, 'red_flag'],
  ] as const)('不建:%o ⇒ %s', (over, reason) => {
    expect(buildNewProductDraft(cand(over), SITE)).toEqual({ skip: reason });
  });

  it('品牌名開頭的保固放行(主視窗 2026-10-01 Q1 甲)', () => {
    expect('draft' in buildNewProductDraft(cand({ highlights: ['Materya 原廠提供兩年保固'] }), SITE)).toBe(true);
  });

  it('品名已經以品牌開頭 ⇒ 大圖眉標不重複寫品牌', () => {
    const r = buildNewProductDraft(cand({ brandName: 'Öhlins', title: 'Ohlins TTX GP 後避震' }), SITE);
    expect('draft' in r && r.draft.eyebrow).toBeNull();
  });

  it('副標太長就不放副標, 草稿照建', () => {
    const r = buildNewProductDraft(cand({ subtitle: 'x'.repeat(61) }), SITE);
    expect('draft' in r && r.draft.subtitle).toBeNull();
  });
});

describe('draftNewProductPosts', () => {
  it('每天最多 3 份, 每個品牌 1 份', async () => {
    const cands = [
      cand({ productId: 'a1', brandSlug: 'a' }), cand({ productId: 'a2', brandSlug: 'a' }),
      cand({ productId: 'b1', brandSlug: 'b' }), cand({ productId: 'c1', brandSlug: 'c' }),
      cand({ productId: 'd1', brandSlug: 'd' }),
    ];
    const store = new FakeStore();
    const r = await run(cands, store);
    expect(store.drafts.map((d) => d.sourceProductId)).toEqual(['a1', 'b1', 'c1']);
    expect(r).toMatchObject({ candidates: 5, created: 3, duplicate: 0 });
    expect(r.skipped.brand_done).toBe(1);
  });

  it('已經建過草稿的商品不算額度, 換下一件', async () => {
    const store = new FakeStore(new Set(['a1']));
    const r = await run([cand({ productId: 'a1', brandSlug: 'a' }), cand({ productId: 'a2', brandSlug: 'a' })], store, 1);
    expect(store.drafts.map((d) => d.sourceProductId)).toEqual(['a2']);
    expect(r).toMatchObject({ created: 1, duplicate: 1 });
  });

  it('有紅字的不建, 換下一件', async () => {
    const store = new FakeStore();
    await run([cand({ productId: 'x', brandSlug: 'x', highlights: ['現貨供應'] }), cand({ productId: 'y', brandSlug: 'y' })], store, 1);
    expect(store.drafts.map((d) => d.sourceProductId)).toEqual(['y']);
  });

  it('🔴 一件被資料庫拒收 ⇒ 跳過那一件, 整輪照跑(R1 必修 2)', async () => {
    const store = new FakeStore();
    const orig = store.create.bind(store);
    store.create = async (d) => {
      if (d.sourceProductId === 'bad') throw Object.assign(new Error('violates check constraint'), { code: '23514' });
      return orig(d);
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run([cand({ productId: 'bad', brandSlug: 'a' }), cand({ productId: 'ok', brandSlug: 'b' })], store);
    expect(store.drafts.map((d) => d.sourceProductId)).toEqual(['ok']);
    expect(r.skipped.rejected).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ productId: 'bad', code: '23514' }));
    spy.mockRestore();
  });

  it('往回看 36 小時', async () => {
    let asked = '';
    await draftNewProductPosts({
      source: { listNewSince: async (since) => { asked = since; return []; } },
      store: new FakeStore(),
      siteUrl: SITE,
      now: () => new Date('2026-10-02T12:00:00Z'),
    });
    expect(asked).toBe('2026-10-01T00:00:00.000Z');
  });
});
