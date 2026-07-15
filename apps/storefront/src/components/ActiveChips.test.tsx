// @vitest-environment jsdom
// ActiveChips smoke — V-1a(Sean 07-15 追加 2):車輛膠囊拆三顆、可單刪、連動語意。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { ActiveChips } from './ActiveChips';
import { makeInitialExtraFilters } from './filter-state';
import type { FilterTopData } from './FilterTop';

const DATA = { motoBrands: [], categories: [], brands: [] } as unknown as FilterTopData;

function renderChips(vehicle: { brand: string; model?: string; year?: number } | null) {
  const dispatch = vi.fn();
  const utils = render(
    <ActiveChips
      data={DATA}
      cascade={{ vehicle, category: null, brands: [] }}
      dispatch={dispatch}
      extras={makeInitialExtraFilters()}
      setExtras={vi.fn()}
    />,
  );
  return { dispatch, ...utils };
}

describe('ActiveChips — 車輛膠囊拆三顆(V-1a)', () => {
  it('brand/model/year 各一顆;刪 year=重選同 model(只清年份)', () => {
    const { dispatch, getByText } = renderChips({ brand: 'YAMAHA', model: 'R6', year: 2017 });
    expect(getByText('YAMAHA')).toBeTruthy();
    expect(getByText('R6')).toBeTruthy();
    expect(getByText('2017')).toBeTruthy();
    fireEvent.click(getByText('2017'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'vehicle/select-model', model: 'R6' });
  });

  it('刪 model=重選同 brand(連動清 model+year);刪 brand=全清', () => {
    const { dispatch, getByText } = renderChips({ brand: 'YAMAHA', model: 'R6', year: 2017 });
    fireEvent.click(getByText('R6'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'vehicle/select-brand', brand: 'YAMAHA' });
    fireEvent.click(getByText('YAMAHA'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'vehicle/clear' });
  });

  it('只選 brand → 只一顆;無 vehicle → 無車輛膠囊', () => {
    const only = renderChips({ brand: 'YAMAHA' });
    expect(only.getByText('YAMAHA')).toBeTruthy();
    expect(only.queryByText('R6')).toBeNull();
    only.unmount();
    const none = renderChips(null);
    expect(none.container.querySelector('.ac-bar')).toBeNull();
  });
});
