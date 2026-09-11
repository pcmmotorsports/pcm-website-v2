// @vitest-environment jsdom
//
// vehicle-facet-display.test.tsx — #306-b 的顯示決策與取數 hook。
//
// 🔴 這裡每一條對應一個「客人會看到錯東西」的具體情境:
//   - 選了車卻退回全站數 ⇒ #306 的病灶原封不動回來(198 件的車顯示 2130)
//   - 沒有這個 key 卻當成 0 ⇒ 明明有商品的分類被灰掉、客人點不進去(比顯示錯數字更糟)
//   - 換車沒清舊值 ⇒ 舊車的件數留在畫面上
//   - 非 2xx 當成功 ⇒ 把錯誤訊息物件當件數用

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

import {
  makeFacetCountResolver,
  facetCategoryKey,
  useFacetCounts,
  useFacetCountResolver,
} from './vehicle-facet-display';

const COUNTS = { categories: { 碳纖維部品: 13, '碳纖維部品 · 土除': 0 }, brands: { lightech: 84 } };

describe('facetCategoryKey', () => {
  it('大類 = 名稱本身;子類 = `大類 · 子類`(與 route 的 categoryFacetKeys 同字面)', () => {
    expect(facetCategoryKey('碳纖維部品')).toBe('碳纖維部品');
    expect(facetCategoryKey('碳纖維部品', '土除')).toBe('碳纖維部品 · 土除');
  });
});

describe('makeFacetCountResolver', () => {
  it('沒選車 → 沿用 server 帶下來的全站數', () => {
    const countOf = makeFacetCountResolver(false, null);
    expect(countOf('categories', '碳纖維部品', 2130)).toBe(2130);
    expect(countOf('brands', 'lightech', 1900)).toBe(1900);
  });

  it('選了車但件數還沒回來 → null(不顯示),🔴 絕不用全站數頂替', () => {
    const countOf = makeFacetCountResolver(true, null);
    expect(countOf('categories', '碳纖維部品', 2130)).toBeNull();
  });

  it('選了車且有 key → 真實件數;0 就是 0(由呼叫端灰掉)', () => {
    const countOf = makeFacetCountResolver(true, COUNTS);
    expect(countOf('categories', '碳纖維部品', 2130)).toBe(13);
    expect(countOf('categories', '碳纖維部品 · 土除', 5)).toBe(0);
    expect(countOf('brands', 'lightech', 1900)).toBe(84);
  });

  it('選了車但沒有這個 key → null,🔴 不得當成 0(那是「算不出來」不是「沒有商品」)', () => {
    const countOf = makeFacetCountResolver(true, COUNTS);
    expect(countOf('categories', '含%萬用字元的分類', 5)).toBeNull();
    expect(countOf('brands', '沒算到的品牌', 5)).toBeNull();
  });

  it('沒選車且 server 也沒給數字 → null(不硬湊 0)', () => {
    expect(makeFacetCountResolver(false, null)('brands', 'x', undefined)).toBeNull();
  });
});

describe('useFacetCounts', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('沒有 query(什麼都沒選)→ 不發請求、回 null', () => {
    const { result } = renderHook(() => useFacetCounts(null));
    expect(result.current.counts).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('有 query → 原樣打到 facet-counts 端點', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    const { result } = renderHook(() => useFacetCounts('vehicle=yamaha%3Amt-09%3A2021'));
    await waitFor(() => expect(result.current.counts).toEqual(COUNTS));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/catalog/facet-counts?vehicle=yamaha%3Amt-09%3A2021',
    );
  });

  it('非 2xx(如 503)→ 維持 null,不把錯誤物件當件數用', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'taxonomy_unavailable' }) });
    const { result } = renderHook(() => useFacetCounts('vehicle=yamaha%3Amt-09%3A2021'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.counts).toBeNull();
  });

  it('回傳形狀不對 → 維持 null', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) });
    const { result } = renderHook(() => useFacetCounts('vehicle=yamaha%3Amt-09%3A2021'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.counts).toBeNull();
  });

  it('網路失敗 → 維持 null,不 crash', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFacetCounts('vehicle=yamaha%3Amt-09%3A2021'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.counts).toBeNull();
  });

  it('換車 → 先清成 null 再抓(舊車的件數不得留在畫面上)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    const { result, rerender } = renderHook(({ slug }) => useFacetCounts(slug), {
      initialProps: { slug: 'vehicle=yamaha%3Amt-09%3A2021' },
    });
    await waitFor(() => expect(result.current.counts).toEqual(COUNTS));

    let resolveSecond: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    rerender({ slug: 'vehicle=honda%3Acbr1000rr-sp%3A2021' });
    // 🔴 第二台車的數字還沒回來的這段時間,畫面上不能還掛著第一台車的件數
    expect(result.current.counts).toBeNull();

    resolveSecond?.({ ok: true, json: async () => COUNTS });
    await waitFor(() => expect(result.current.counts).toEqual(COUNTS));
  });

  it('🔴 A 車的 json() 在切到 B 之後才 resolve → 不得寫到 B 車上(abort 擋不住已完成的 promise)', async () => {
    // codex 關卡2 C2:abort **不保證**撤銷「已經進入完成序列」的 promise。
    // 原測試只用「永不 resolve 的 fetch」⇒ 這種交錯永遠測不到。
    const A = { categories: { a: 1 }, brands: {} };
    const B = { categories: { b: 2 }, brands: {} };
    let resolveAJson: ((v: unknown) => void) | undefined;
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            resolveAJson = resolve;
          }),
      }),
    );
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: async () => B }));

    const { result, rerender } = renderHook(({ slug }) => useFacetCounts(slug), {
      initialProps: { slug: 'a-car' },
    });
    rerender({ slug: 'b-car' });
    await waitFor(() => expect(result.current.counts).toEqual(B));

    // A 的 json() 現在才回來(它的 .then 仍會執行)
    resolveAJson?.(A);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.counts).toEqual(B); // 🔴 不得被 A 蓋掉
  });

  it('換車那一幀不得掛著上一台車的數字(setState 發生在 render 之後)', async () => {
    const A = { categories: { a: 1 }, brands: {} };
    fetchMock.mockResolvedValue({ ok: true, json: async () => A });
    const { result, rerender } = renderHook(({ slug }) => useFacetCounts(slug), {
      initialProps: { slug: 'a-car' },
    });
    await waitFor(() => expect(result.current.counts).toEqual(A));
    fetchMock.mockReturnValue(new Promise(() => {}));
    rerender({ slug: 'b-car' });
    expect(result.current.counts).toBeNull();
  });

  it('換車時 abort 掉前一個請求(慢回應不得覆蓋新車的數字)', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise(() => {});
    });
    const { rerender } = renderHook(({ slug }) => useFacetCounts(slug), {
      initialProps: { slug: 'vehicle=yamaha%3Amt-09%3A2021' },
    });
    rerender({ slug: 'vehicle=honda%3Acbr1000rr-sp%3A2021' });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

// ── #269-b 段二:新品頁不顯示件數(Sean `Q21 = B`)────────────────────────
//
// 🔴 codex 段二審查 MF-7 實錘:本檔原本**完全沒有 import 或呼叫 `useFacetCountResolver`**
//    ⇒ 把 `filter=new` 那整段分支刪掉,測試仍然全綠 = Q21 沒有任何行為守門。
describe('⟦search-SILENTDOORS2⟧ 件數取不到時, 客人那一側要有一句話', () => {
  // 🔴🔴 **這一族守的是【兩個世界要印不同的東西】** —— 而修這一片之前,
  //   `facet-counts` 回 503 與回 200 在客人眼裡的差別只有「件數不見了」, **沒有任何一句話**。
  //   🛑 `route.ts:20` 逐字「上游字典失敗一律 503、不得回 200 半套」是**對的決定**;
  //     壞的是客戶端 `.catch(() => {})` 把它**吞掉**。
  // 🔴  在上面那個 describe 的作用域裡 ⇒ 本 describe 要自己一份, 不能借。
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const callResolver = (qs: string) =>
    renderHook(() => useFacetCountResolver(new URLSearchParams(qs)));

  it('🟢 200 ⇒ 件數在、countsFailed 是 false(沒有那句話)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    const { result } = callResolver('vehicle=yamaha:mt-09:2021');
    await waitFor(() =>
      expect(result.current.countOf('categories', '碳纖維部品', null)).toBe(13),
    );
    expect(result.current.countsFailed, '成功時不可以印錯誤').toBe(false);
  });

  it('🔴 503 ⇒ 件數是 null【而且】countsFailed 是 true', async () => {
    // 📌 少了後半, 這一格與修這片之前【完全一樣】—— 件數 null 本來就是舊行為。
    // 🔴 **fixture 要帶 `status`** —— 舊版只給 `ok:false`, 那在 `!res.ok` 的世界夠用,
    //   而現在實作分 4xx/5xx ⇒ `undefined >= 500` 是 false ⇒ 這一格會紅。
    //   📌 **那一紅是對的**:它指出我的 fixture 少了一個真實回應一定有的欄位。
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'taxonomy_unavailable' }) });
    const { result } = callResolver('vehicle=yamaha:mt-09:2021');
    await waitFor(() => expect(result.current.countsFailed).toBe(true));
    expect(result.current.countOf('categories', '碳纖維部品', null), '失敗時不得掰出件數').toBeNull();
  });

  it('🔴 網路整個掛掉(reject)⇒ 也要 countsFailed', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = callResolver('vehicle=yamaha:mt-09:2021');
    await waitFor(() => expect(result.current.countsFailed).toBe(true));
  });

  it('🛑 abort(換車)【不算】失敗 —— 否則每次換車都閃一下錯誤', async () => {
    // 🔴 這一格是本片唯一必須把「進到 catch 的兩種原因」分開的地方。
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortErr);
    const { result } = callResolver('vehicle=yamaha:mt-09:2021');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.countsFailed, 'abort 是我們自己取消的, 不是故障').toBe(false);
  });

  it('🛑 新品頁不算失敗 —— 而【理由是它根本沒發請求】, 不是那個布林', async () => {
    // 🔴🔴 **code-reviewer must-fix 2:這一格原本【恆真】。**
    //   實錘:把 `vehicle-facet-display.tsx` 的 `!isNewArrivals &&` 拿掉 ⇒ **23 passed, 紅 0**。
    //   成因:`filter=new` ⇒ hook 收到 `null` ⇒ **早退**、`fetch` 從沒被叫過
    //   ⇒ 📌 **那個 mock 的 503 是裝飾品**, 這一格量不到任何東西。
    // ✅ 改成問「兩個世界會印不同的東西嗎」:**沒發請求**才是這條路真正的形狀。
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { result } = callResolver('filter=new&vehicle=yamaha:mt-09:2021');
    await waitFor(() => expect(result.current.countOf('categories', 'x', 5)).toBeNull());
    expect(fetchMock, '新品頁不該發 facet-counts 請求 —— 這才是它不算失敗的理由').not.toHaveBeenCalled();
    expect(result.current.countsFailed, '把一個刻意的設計說成故障').toBe(false);
  });

  it('🔴 400(白名單擋下)⇒ 不顯示件數, 而【不】對客人說故障', async () => {
    // 🔴 route.ts:74-75 逐字分過:400 = 永久錯誤語意 / 503 = 這次讀不到。
    //   舊書籤的車型下架 ⇒ 400 ⇒ 若當故障, 客人會在一頁沒壞的畫面上【永久】看到「暫時無法顯示」。
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'unknown_model' }) });
    const { result } = callResolver('vehicle=yamaha:mt-09:2021');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.countOf('categories', '碳纖維部品', null), '400 也不顯示件數').toBeNull();
    expect(result.current.countsFailed, '400 不是故障 ⇒ 不可以印那句話').toBe(false);
  });

  it('🔴 回了 200 而形狀認不得 ⇒ 也要算失敗(否則「契約變了」會退化成「沒有數字」)', async () => {
    // 🔵 code-reviewer nit 3:這一格原本零覆蓋 —— 刪掉實作那一行, 測試全綠。
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) });
    const { result } = callResolver('vehicle=yamaha:mt-09:2021');
    await waitFor(() => expect(result.current.countsFailed).toBe(true));
  });

  it('🔴 換車 ⇒ 上一台車的失敗【不可以】掛到新車上(owner 兩道防線)', async () => {
    // 🔵 code-reviewer nit 4:那兩道防線原本零覆蓋 —— 拿掉任一道, 測試全綠。
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { result, rerender } = renderHook(
      ({ qs }: { qs: string }) => useFacetCountResolver(new URLSearchParams(qs)),
      { initialProps: { qs: 'vehicle=yamaha:mt-09:2021' } },
    );
    await waitFor(() => expect(result.current.countsFailed).toBe(true));
    // 🛑 新車這一發【還沒回來】⇒ 此刻畫面上不該掛著上一台車的錯誤。
    fetchMock.mockReturnValue(new Promise(() => {}));
    rerender({ qs: 'vehicle=honda:cbr650r:2022' });
    expect(result.current.countsFailed, '上一台車的失敗掛到新車上了').toBe(false);
  });
});

describe('#269-b useFacetCountResolver:新品頁一律不給件數', () => {
  const call = (qs: string) => {
    const { result } = renderHook(() => useFacetCountResolver(new URLSearchParams(qs)));
    // 🔴 2026-09-07 ⟦search-SILENTDOORS2⟧:hook 現在回 { countOf, countsFailed }
    return result.current.countOf;
  };

  it('🔴 filter=new ⇒ 任何 bucket/key 都回 null(即使有 serverCount)', () => {
    const countOf = call('filter=new');
    expect(countOf('brands', 'akrapovic', 16)).toBeNull();
    expect(countOf('categories', '碳纖維部品', 2130)).toBeNull();
  });

  it('對照組:沒有 filter=new 時,沒選車仍沿用 serverCount(現況不得被改壞)', () => {
    const countOf = call('');
    expect(countOf('brands', 'akrapovic', 16)).toBe(16);
  });

  it('對照組:不認得的 filter 值不觸發隱藏', () => {
    expect(call('filter=sale')('brands', 'akrapovic', 16)).toBe(16);
  });
});

describe('useFacetCountResolver:有關鍵字時一律不給件數(Sean 2026-09-11 拍乙)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const call = (qs: string) =>
    renderHook(() => useFacetCountResolver(new URLSearchParams(qs))).result.current;

  it('🔴 search=水箱護網 ⇒ 分類、品牌都回 null(即使有 serverCount)', () => {
    const { countOf, countsFailed } = call('search=水箱護網');
    expect(countOf('categories', '外觀與後視鏡', 14)).toBeNull();
    expect(countOf('brands', 'akrapovic', 16)).toBeNull();
    expect(countsFailed, '刻意不印不是故障').toBe(false);
  });

  it('🔴 選了車又有關鍵字 ⇒ 仍是 null, 而且不去打 facet-counts(那組數字不看關鍵字)', () => {
    const { countOf } = call('search=水箱護網&vehicle=yamaha:mt-09:2021');
    expect(countOf('categories', '外觀與後視鏡', 14)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('對照組:search 是空白 ⇒ 不算有關鍵字, 照舊用 serverCount', () => {
    expect(call('search=%20%20').countOf('categories', '外觀與後視鏡', 14)).toBe(14);
  });
});

describe('useFacetCountResolver:只選品牌 / 分類也要連動(Sean 2026-09-12 拍乙)', () => {
  // 🔴 Sean 在 www 抓到的:選「外觀與後視鏡」+「EAZI-GRIP」⇒ 右邊 0 件, 左邊仍是全站數。
  //   病灶 = 沒選車時根本不去問, 直接用 server 帶下來的全站數。
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const call = (qs: string) => renderHook(() => useFacetCountResolver(new URLSearchParams(qs)));

  it('🔴 沒選車、只選品牌 ⇒ 去問, 而且不再用全站數頂替', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: { 外觀與後視鏡: 0 }, brands: {} }) });
    const { result } = call('pbrands=eazi-grip');
    // 還沒回來那一刻:不顯示(不是 3887)
    expect(result.current.countOf('categories', '外觀與後視鏡', 3887)).toBeNull();
    await waitFor(() => expect(result.current.countOf('categories', '外觀與後視鏡', 3887)).toBe(0));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/catalog/facet-counts?pbrands=eazi-grip');
  });

  it('車 + 品牌(新舊兩種參數)+ 分類 ⇒ 一起送, 順序固定(vehicle → pbrands → categories)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    call('categories=外觀與後視鏡&pbrand=dbk&vehicle=yamaha:mt-09:2021&pbrands=eazi-grip');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/catalog/facet-counts?vehicle=yamaha%3Amt-09%3A2021&pbrands=eazi-grip%2Cdbk&categories=' +
        encodeURIComponent('外觀與後視鏡'),
    );
  });

  it('只選分類 ⇒ 也去問', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    call('categories=外觀與後視鏡');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('🔴 有關鍵字 + 選了品牌 ⇒ 仍然不問、不印(09-11 拍乙那一道排在最前面)', () => {
    const { result } = call('search=水箱護網&pbrands=eazi-grip');
    expect(result.current.countOf('categories', '外觀與後視鏡', 14)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('對照組:什麼都沒選 ⇒ 不問, 照舊用 serverCount', () => {
    const { result } = call('sort=price-asc');
    expect(result.current.countOf('categories', '外觀與後視鏡', 3887)).toBe(3887);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
