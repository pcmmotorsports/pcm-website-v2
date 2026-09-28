// @vitest-environment jsdom
//
// 2026-09-29 選車清單瘦身甲案:`VehicleSelect` 收到底盤清單時, 自己補「目前這個牌子」的年份
// (`use-lazy-brand-years.ts`)。守四件事:
//   ① 還沒補到 ⇒ 年份欄寫「年份載入中…」, 不是「不限年份」(那會讓客人以為這台車不分年份)
//   ② 補到了 ⇒ 年份可以選
//   ③ 補失敗 ⇒ 寫失敗、清掉廠牌再選一次會重打
//   ④ 整棵本來就有年份 ⇒ 不打任何 API(舊的呼叫端行為不變)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { VehicleSelect } from './VehicleSelect';
import { YEARS_FETCH_TIMEOUT_MS } from './use-lazy-brand-years';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const SLIM: MockMotoBrand[] = [
  { id: 'yamaha', name: 'Yamaha', models: [{ id: 'r6', name: 'R6', years: [] }], yearsLoaded: false },
  { id: 'kawasaki', name: 'Kawasaki', models: [{ id: 'z900', name: 'Z900', years: [] }], yearsLoaded: true },
];

const noop = () => {};
function Select({ brands, vehicle }: { brands: MockMotoBrand[]; vehicle: { brand: string; model?: string } | null }) {
  return (
    <VehicleSelect
      motoBrands={brands}
      vehicle={vehicle}
      onPickBrand={noop}
      onPickModel={noop}
      onPickYear={noop}
      onClearBrand={noop}
      onClearModel={noop}
      onClearYear={noop}
    />
  );
}
const year = () => screen.getByRole('combobox', { name: '選擇年份' }) as HTMLInputElement;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VehicleSelect 自己補目前牌子的年份', () => {
  it('🔴 ① 還沒補到 ⇒「年份載入中…」而且不能選, 不是「不限年份」;打的是那個牌子的 API', () => {
    const d = deferred<Response>();
    const fetchMock = vi.fn((_url: string) => d.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
    expect(year().placeholder).toBe('年份載入中…');
    expect(year().disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/catalog/vehicle-models?brand=yamaha');
  });

  it('🔴 ② 補到了 ⇒ 年份可以選', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ brandId: 'yamaha', models: [{ id: 'r6', name: 'R6', years: [2016, 2017] }] })),
    );
    render(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
    await act(async () => {});
    expect(year().placeholder).toBe('選擇或輸入年份');
    expect(year().disabled).toBe(false);
  });

  it('🔴 ③ 補失敗 ⇒ 寫失敗;清掉廠牌再選一次 ⇒ 重打一次', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
    await act(async () => {});
    expect(year().placeholder).toBe('年份讀取失敗，請清除廠牌再選');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<Select brands={SLIM} vehicle={null} />);
    rerender(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('🔵 ④ 牌子本來就有年份(yearsLoaded 不是 false)⇒ 不打 API;沒有年份的車款照舊「不限年份」', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Select brands={SLIM} vehicle={{ brand: 'Kawasaki', model: 'Z900' }} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(year().placeholder).toBe('不限年份');
  });

  it('🔵 呼叫端每次 render 傳新的陣列 ⇒ 不會重打、也不會把補好的年份丟掉', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ brandId: 'yamaha', models: [{ id: 'r6', name: 'R6', years: [2016] }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<Select brands={[...SLIM]} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
    await act(async () => {});
    rerender(<Select brands={[...SLIM]} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(year().disabled).toBe(false);
  });
});

// 2026-09-29:補年份那一發一直不回 ⇒ 8 秒後當失敗(否則手機面板套用鈕會一直停在「年份載入中…」)。
describe('補年份逾時', () => {
  /** 一直不回、但會照 signal 放棄的假 fetch(真的 fetch 被 abort 時就是這樣 reject)。 */
  function hangingFetch() {
    return vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    );
  }

  it('🔴 8 秒(YEARS_FETCH_TIMEOUT_MS)內沒回 ⇒ 改寫失敗;門檻前 0.1 秒還是載入中', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', hangingFetch());
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(YEARS_FETCH_TIMEOUT_MS - 100);
      });
      expect(year().placeholder).toBe('年份載入中…');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(year().placeholder).toBe('年份讀取失敗，請清除廠牌再選');
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴 逾時之後清除廠牌再選 ⇒ 重打一次, 這次回了就可以選年份', async () => {
    vi.useFakeTimers();
    try {
      const hang = hangingFetch();
      vi.stubGlobal('fetch', hang);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { rerender } = render(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(YEARS_FETCH_TIMEOUT_MS + 100);
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => okResponse({ brandId: 'yamaha', models: [{ id: 'r6', name: 'R6', years: [2016] }] })),
      );
      rerender(<Select brands={SLIM} vehicle={null} />);
      rerender(<Select brands={SLIM} vehicle={{ brand: 'Yamaha', model: 'R6' }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(year().disabled).toBe(false);
      expect(hang).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
