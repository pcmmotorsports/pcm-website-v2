// @vitest-environment jsdom
//
// 2026-09-29:目錄頁三個選車元件收到底盤清單(`yearsLoaded: false` 的牌子沒有年份)時,
// 「年份還沒補到」不能當成「不限年份」—— 與 VehicleSelect 同一支 `use-lazy-brand-years.ts`。
//   桌機選車列 CascadeFilterTop / 手機選車面板 MobileVehicleSheet / 篩選抽屜 FilterDrawerVehicleTab

import { useReducer } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState, type CascadeFilterState } from '@pcm/ui';

import { CascadeFilterTop } from './CascadeFilterTop';
import { MobileVehicleSheet } from './MobileVehicleSheet';
import { FilterDrawerVehicleTab } from './FilterDrawerVehicleTab';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { resetBrandYearsRequestsForTests } from './use-lazy-brand-years';

const SLIM: MockMotoBrand[] = [
  { id: 'yamaha', name: 'Yamaha', models: [{ id: 'r6', name: 'R6', years: [] }], yearsLoaded: false },
  { id: 'ducati', name: 'Ducati', models: [{ id: 'monster', name: 'Monster', years: [] }], yearsLoaded: true },
];
const YAMAHA_YEARS = { brandId: 'yamaha', models: [{ id: 'r6', name: 'R6', years: [2016, 2017] }] };
const withVehicle = (brand: string, model: string): CascadeFilterState => ({
  ...makeInitialCascadeState(),
  vehicle: { brand, model },
});

function gatedFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const fetchMock = vi.fn(async (_url: string) => {
    await gate;
    return { ok: true, json: async () => YAMAHA_YEARS } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, release };
}
const year = () => screen.getByLabelText('選擇年份') as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetBrandYearsRequestsForTests();
});

describe('桌機選車列 CascadeFilterTop', () => {
  function Top({ initial }: { initial: CascadeFilterState }) {
    const [cascade, dispatch] = useReducer(cascadeFilterReducer, initial);
    return <CascadeFilterTop data={{ motoBrands: SLIM, categories: [], brands: [] }} cascade={cascade} dispatch={dispatch} />;
  }

  it('🔴 年份還沒補到 ⇒「年份載入中…」不能選;補到後可以選', async () => {
    const { fetchMock, release } = gatedFetch();
    render(<Top initial={withVehicle('Yamaha', 'R6')} />);
    expect(year().placeholder).toBe('年份載入中…');
    expect(year().disabled).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/catalog/vehicle-models?brand=yamaha');
    await act(async () => {
      release();
    });
    expect(year().disabled).toBe(false);
    expect(year().placeholder).toBe('選擇或輸入年份');
  });

  it('🔴 補失敗 ⇒ 寫失敗, 不是「不限年份」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 }) as Response));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Top initial={withVehicle('Yamaha', 'R6')} />);
    await act(async () => {});
    expect(year().placeholder).toBe('年份讀取失敗，請清除廠牌再選');
  });

  it('🔵 年份本來就在(yearsLoaded 不是 false)而車型沒有年份 ⇒ 照舊「不限年份」、不打 API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Top initial={withVehicle('Ducati', 'Monster')} />);
    expect(year().placeholder).toBe('不限年份');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('手機選車面板 MobileVehicleSheet', () => {
  it('🔴 面板草稿的牌子年份還沒補到 ⇒「年份載入中…」;補到後可以選', async () => {
    const { release } = gatedFetch();
    render(
      <MobileVehicleSheet open onClose={() => {}} motoBrands={SLIM} cascade={withVehicle('Yamaha', 'R6')} dispatch={() => {}} />,
    );
    expect(year().placeholder).toBe('年份載入中…');
    expect(year().disabled).toBe(true);
    await act(async () => {
      release();
    });
    expect(year().disabled).toBe(false);
  });
});

describe('手機選車面板「查看適用商品」在年份載入中', () => {
  const sheet = (dispatch = vi.fn()) => {
    render(
      <MobileVehicleSheet open onClose={() => {}} motoBrands={SLIM} cascade={withVehicle('Yamaha', 'R6')} dispatch={dispatch} />,
    );
    return dispatch;
  };

  it('🔴 選了車型而年份還在補 ⇒ 套用鈕停用、寫「年份載入中…」;補到後恢復「查看適用商品」', async () => {
    const { release } = gatedFetch();
    const dispatch = sheet();
    const apply = screen.getByRole('button', { name: '年份載入中…' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => {
      release();
    });
    expect((screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('🔵 補失敗 ⇒ 放行套用(年份欄已講失敗, 不讓客人卡在面板裡)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 }) as Response));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sheet();
    await act(async () => {});
    expect((screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('🔵 年份本來就在的牌子 ⇒ 套用鈕照常可按', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <MobileVehicleSheet open onClose={() => {}} motoBrands={SLIM} cascade={withVehicle('Ducati', 'Monster')} dispatch={() => {}} />,
    );
    expect((screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('篩選抽屜 FilterDrawerVehicleTab', () => {
  function Drawer() {
    const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
    return (
      <>
        <FilterDrawerVehicleTab motoBrands={SLIM} cascade={cascade} dispatch={dispatch} />
        <div data-testid="applied">{cascade.vehicle ? `${cascade.vehicle.brand}/${cascade.vehicle.model ?? '-'}/${cascade.vehicle.year ?? '-'}` : '(無)'}</div>
      </>
    );
  }

  it('🔴 跨層搜尋點到年份還沒補到的車款 ⇒ 不直接套用「不限年份」, 跳年份層等它補;補到後可以選年份', async () => {
    const { release } = gatedFetch();
    render(<Drawer />);
    fireEvent.change(screen.getByLabelText('打字快速找車'), { target: { value: 'r6' } });
    fireEvent.click(screen.getByText('Yamaha R6'));
    expect(screen.getByTestId('applied').textContent).toBe('(無)');
    expect(screen.getByText('年份載入中…')).toBeTruthy();
    expect(screen.queryByText('不限年份(此車型套用全部)')).toBeNull();
    await act(async () => {
      release();
    });
    fireEvent.click(screen.getByText('2017'));
    expect(screen.getByTestId('applied').textContent).toBe('Yamaha/R6/2017');
  });

  it('🔴 逐層點進年份還沒補到的牌子 ⇒ 年份層寫「年份載入中…」, 補到後出現年份', async () => {
    const { release } = gatedFetch();
    render(<Drawer />);
    fireEvent.click(screen.getByText('Yamaha'));
    fireEvent.click(screen.getByText('R6'));
    expect(screen.getByText('年份載入中…')).toBeTruthy();
    await act(async () => {
      release();
    });
    expect(screen.getByText('2016')).toBeTruthy();
  });

  it('🔵 真的沒有年份的車型(牌子已補過)⇒ 跨層點到照舊直接套用「不限年份」', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<Drawer />);
    fireEvent.change(screen.getByLabelText('打字快速找車'), { target: { value: 'monster' } });
    fireEvent.click(screen.getByText('Ducati Monster'));
    expect(screen.getByTestId('applied').textContent).toBe('Ducati/Monster/-');
  });
});
