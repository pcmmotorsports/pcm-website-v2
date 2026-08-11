// @vitest-environment node
//
// products-new-arrivals.test.ts — #269-b 段二「新品」退回邏輯的守門。
//
// 這裡守的是三個拍板做成的行為,而**它們的失敗都不會 crash、不會紅、客人也不會回報**:
//   Sean `Q20 = C`  新品頁不准空白 ⇒ 窗內沒東西就退回顯示最近上架
//   主視窗 `Q23 = A` 退回時**仍排除供應商批次日** ⇒ 傳「很早的時戳」而不是 NULL
//   主視窗 `Q24 = A` 0 列有兩種成因 ⇒ 補一次 total 探查才決定要不要退回
//
// 🔴 為什麼 Q23 值得一格:傳 NULL 與傳很早的時戳,**第一頁看起來完全一樣**
//   (實測正式庫:兩者最新 50 件落在相同的 7 個日期),差別只在 total(108 vs 19,017)
//   與第二頁之後會不會翻進 2026-07-24 那 6,188 件目錄搬遷。
//   ⇒ 只看「有沒有回商品」的測試對這條**零判別力**,必須直接斷言送出去的參數。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();

vi.mock('@pcm/adapters', () => ({
  createSupabaseAnonClient: () => ({ rpc }),
  SupabaseProductAdapter: class {},
  availabilityToBool: () => true,
}));

// unstable_cache 直通,否則測不到快取內側真正送出去的參數。
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

import { fetchCatalogPage } from '@/lib/products';
import { parseCatalogQuery } from '@/lib/catalog-query';

const FALLBACK_SINCE = '2000-01-01T00:00:00.000Z';

function params(qs: string) {
  return new URLSearchParams(qs);
}

/** RPC 回一列;`item` 只需最低限度欄位讓 mapper 不炸。 */
function row(total: number, id = 'p1') {
  return {
    item: {
      id,
      title: 't',
      subtitle: null,
      handle: 'h',
      availability: 'in_stock',
      price_general: 100,
      card_image: null,
      fits: '通用款',
      brand_name: 'b',
      brand_slug: 'b',
      category_raw: 'c',
      fitments: [],
      card_image_trim: null,
    },
    total,
  };
}

const argsOf = (call: number) => rpc.mock.calls[call]?.[1] as Record<string, unknown>;

beforeEach(() => {
  rpc.mockReset();
});

describe('#269-b 新品退回(Q20=C / Q23=A / Q24=A)', () => {
  it('沒帶 filter=new ⇒ p_new_since 是 null,且完全不會有退回查詢', async () => {
    rpc.mockResolvedValueOnce({ data: [row(19017)], error: null });
    await fetchCatalogPage(parseCatalogQuery(params('')));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(argsOf(0)?.p_new_since).toBeNull();
  });

  it('filter=new 且窗內有商品 ⇒ 只打一次、不退回', async () => {
    rpc.mockResolvedValueOnce({ data: [row(25)], error: null });
    const out = await fetchCatalogPage(parseCatalogQuery(params('filter=new')));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(out.total).toBe(25);
    const since = argsOf(0)?.p_new_since as string;
    expect(since, 'filter=new 必須換算成一個時間窗').toEqual(expect.any(String));
    expect(since).not.toBe(FALLBACK_SINCE);
  });

  it('🔴 Q20+Q23:窗內 0 件 ⇒ 退回,而退回送的是「很早的時戳」不是 null', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })            // 窗內這頁 0 列
      .mockResolvedValueOnce({ data: [], error: null })            // Q24 探查:窗內 total 也是 0
      .mockResolvedValueOnce({ data: [row(108)], error: null });   // 退回查詢
    const out = await fetchCatalogPage(parseCatalogQuery(params('filter=new')));

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(out.total).toBe(108);
    // 🔴 這一條就是 Q23=A 的全部:傳 null 的話 RPC 的批次日排除**整個失效**
    //    ⇒ 退回清單會從 108 件變成 19,017 件、往後翻就是目錄傾倒。
    expect(
      argsOf(2)?.p_new_since,
      '退回必須傳很早的時戳,傳 null 會讓批次日排除失效(108 → 19,017)',
    ).toBe(FALLBACK_SINCE);
  });

  it('🔴 Q24:窗內有 25 件但客人翻過尾頁 ⇒ 0 列也**不可**退回', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })          // 第 2 頁 offset 過尾 → 0 列
      .mockResolvedValueOnce({ data: [row(25)], error: null });  // 探查:窗內其實有 25 件
    const out = await fetchCatalogPage(parseCatalogQuery(params('filter=new&page=2')));

    expect(rpc, '只該打兩次:本頁 + 探查,不該有第三次退回查詢').toHaveBeenCalledTimes(2);
    expect(out.products).toEqual([]);
    // 少了 Q24 這道:第 1 頁 25 件新品、第 2 頁冒出 108 件退回商品 = 同一次瀏覽兩種清單。
  });

  it('🔴 翻過尾頁時要回**探查問到的真總數**,不是本頁的 0(codex MF-4)', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })          // 第 2 頁 0 列
      .mockResolvedValueOnce({ data: [row(25)], error: null });  // 探查:其實有 25 件
    const out = await fetchCatalogPage(parseCatalogQuery(params('filter=new&page=2')));
    expect(
      out.total,
      '回 0 的話分頁列會說「共 0 件」而客人明明在第 2 頁;探查已經知道真總數了',
    ).toBe(25);
  });

  it('🔴 本查詢與探查必須用**同一個**時間窗(codex MF-3:各算一次會在窗邊界誤判)', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [row(108)], error: null });
    await fetchCatalogPage(parseCatalogQuery(params('filter=new')));
    expect(argsOf(0)?.p_new_since, '兩次窗內查詢的時戳必須逐字相同').toBe(argsOf(1)?.p_new_since);
  });

  it('🔴 filter=new 沒帶 sort 時預設 new,不是 recommend(codex MF-1)', async () => {
    rpc.mockResolvedValueOnce({ data: [row(25)], error: null });
    await fetchCatalogPage(parseCatalogQuery(params('filter=new')));
    expect(
      argsOf(0)?.p_sort,
      'recommend 在 RPC 裡是 id ASC ⇒「新品」與退回的「最近上架」都會變成任意順序',
    ).toBe('new');
  });

  it('客人自己選了排序時,不可被新品預設蓋掉', async () => {
    rpc.mockResolvedValueOnce({ data: [row(25)], error: null });
    await fetchCatalogPage(parseCatalogQuery(params('filter=new&sort=price-asc')));
    expect(argsOf(0)?.p_sort).toBe('price-asc');
  });

  it('Q24 的探查必須是 offset=0/limit=1,而且用**窗內**時戳(不是退回時戳)', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [row(25)], error: null });
    await fetchCatalogPage(parseCatalogQuery(params('filter=new&page=3')));

    const probe = argsOf(1);
    expect(probe?.p_offset, '探查要問「整個窗有沒有東西」,不是問這一頁').toBe(0);
    expect(probe?.p_limit, '探查只要一列就夠,不必把整頁撈回來').toBe(1);
    expect(probe?.p_new_since).not.toBe(FALLBACK_SINCE);
  });

  it('退回時其餘篩選條件原樣保留(退的是時間窗,不是把篩選也放掉)', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [row(3)], error: null });
    await fetchCatalogPage(
      parseCatalogQuery(params('filter=new&pbrand=gb-racing&category=%E7%A2%B3%E7%BA%96')),
      { brand: 'Ducati' },
    );

    const fb = argsOf(2);
    expect(fb?.p_brand, '退回不得把車輛條件放掉').toBe('Ducati');
    expect(fb?.p_brand_slugs, '退回不得把品牌篩選放掉').toEqual(['gb-racing']);
    expect(fb?.p_category, '退回不得把分類篩選放掉').toBe('碳纖');
  });
});

// ── #393-A(Sean 2026-08-11 拍 A):一般型錄路徑翻過尾頁 ────────────────────────
//
// 這是把上面 `filter=new` 的探查解**推廣到沒帶 filter 的一般型錄**,不是新機制。
// 🔴 為什麼它壞掉時沒人會叫:`?page=999` 回 0 列 ⇒ total 讀成 0 ⇒ 畫面說「找不到商品」,
//   但其實還有一萬多件。不 crash、不紅、客人只覺得這網站怪怪的。
describe('#393-A 一般型錄翻過尾頁', () => {
  it('🔴 沒帶 filter 翻過尾頁 ⇒ 探查真總數,不可回 0', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null }) // ?page=999 → 0 列
      .mockResolvedValueOnce({ data: [row(19017)], error: null }); // 探查:其實有 19,017 件
    const out = await fetchCatalogPage(parseCatalogQuery(params('page=999')));

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(
      out.total,
      '回 0 的話畫面會說「找不到商品」,而其實還有一萬多件(backlog #393 第 2 條)',
    ).toBe(19017);
    expect(argsOf(1)?.p_offset, '探查要問整個結果集,不是這一頁').toBe(0);
    expect(argsOf(1)?.p_limit).toBe(1);
    expect(argsOf(1)?.p_new_since, '一般路徑不該憑空帶時間窗').toBeNull();
  });

  it('🔴 第 1 頁就 0 列 ⇒ 總數真的是 0,不可多打一次 RPC', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const out = await fetchCatalogPage(
      parseCatalogQuery(params('category=%E4%B8%8D%E5%AD%98%E5%9C%A8')),
    );

    expect(
      rpc,
      'page=1 的 offset 就是 0,探查只會拿到同一個 0 ⇒ 多打就是純浪費',
    ).toHaveBeenCalledTimes(1);
    expect(out.total).toBe(0);
  });

  it('有列的一般路徑完全不受影響(不得多打探查)', async () => {
    rpc.mockResolvedValueOnce({ data: [row(19017)], error: null });
    const out = await fetchCatalogPage(parseCatalogQuery(params('page=2')));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(out.total).toBe(19017);
  });
});
