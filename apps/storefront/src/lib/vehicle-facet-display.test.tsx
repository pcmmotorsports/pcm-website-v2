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
  useVehicleFacetCounts,
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

describe('useVehicleFacetCounts', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('沒車 → 不發請求、回 null', () => {
    const { result } = renderHook(() => useVehicleFacetCounts(null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('有車 → 打 facet-counts 端點並帶上 slug', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    const { result } = renderHook(() => useVehicleFacetCounts('yamaha:mt-09:2021'));
    await waitFor(() => expect(result.current).toEqual(COUNTS));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/catalog/facet-counts?vehicle=yamaha%3Amt-09%3A2021',
    );
  });

  it('非 2xx(如 503)→ 維持 null,不把錯誤物件當件數用', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'taxonomy_unavailable' }) });
    const { result } = renderHook(() => useVehicleFacetCounts('yamaha:mt-09:2021'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('回傳形狀不對 → 維持 null', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) });
    const { result } = renderHook(() => useVehicleFacetCounts('yamaha:mt-09:2021'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('網路失敗 → 維持 null,不 crash', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useVehicleFacetCounts('yamaha:mt-09:2021'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('換車 → 先清成 null 再抓(舊車的件數不得留在畫面上)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => COUNTS });
    const { result, rerender } = renderHook(({ slug }) => useVehicleFacetCounts(slug), {
      initialProps: { slug: 'yamaha:mt-09:2021' },
    });
    await waitFor(() => expect(result.current).toEqual(COUNTS));

    let resolveSecond: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    rerender({ slug: 'honda:cbr1000rr-sp:2021' });
    // 🔴 第二台車的數字還沒回來的這段時間,畫面上不能還掛著第一台車的件數
    expect(result.current).toBeNull();

    resolveSecond?.({ ok: true, json: async () => COUNTS });
    await waitFor(() => expect(result.current).toEqual(COUNTS));
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

    const { result, rerender } = renderHook(({ slug }) => useVehicleFacetCounts(slug), {
      initialProps: { slug: 'a-car' },
    });
    rerender({ slug: 'b-car' });
    await waitFor(() => expect(result.current).toEqual(B));

    // A 的 json() 現在才回來(它的 .then 仍會執行)
    resolveAJson?.(A);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual(B); // 🔴 不得被 A 蓋掉
  });

  it('換車那一幀不得掛著上一台車的數字(setState 發生在 render 之後)', async () => {
    const A = { categories: { a: 1 }, brands: {} };
    fetchMock.mockResolvedValue({ ok: true, json: async () => A });
    const { result, rerender } = renderHook(({ slug }) => useVehicleFacetCounts(slug), {
      initialProps: { slug: 'a-car' },
    });
    await waitFor(() => expect(result.current).toEqual(A));
    fetchMock.mockReturnValue(new Promise(() => {}));
    rerender({ slug: 'b-car' });
    expect(result.current).toBeNull();
  });

  it('換車時 abort 掉前一個請求(慢回應不得覆蓋新車的數字)', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise(() => {});
    });
    const { rerender } = renderHook(({ slug }) => useVehicleFacetCounts(slug), {
      initialProps: { slug: 'yamaha:mt-09:2021' },
    });
    rerender({ slug: 'honda:cbr1000rr-sp:2021' });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});
