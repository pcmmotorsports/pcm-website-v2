// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/vehicle-dictionary-action', () => ({ searchVehicleDictionaryAction: vi.fn(async () => []) }));

import { ManualOrderVehicleField } from './manual-order-vehicle-field';

afterEach(cleanup);

// 2026-10-01 建單簡化(Sean Q1 甲, S2):車輛預設收起, 而收起時兩格照樣送出。
describe('車輛:預設收起', () => {
  it('預設是收起的, 標題寫「車輛(選填)」', () => {
    render(<ManualOrderVehicleField />);
    const box = screen.getByTestId('manual-order-vehicle') as HTMLDetailsElement;
    expect(box.open).toBe(false);
    expect(box.querySelector('summary')?.textContent).toBe('車輛(選填)');
  });

  it('🔴 收起時 text 與 hidden pick 兩格仍在表單裡(解析端看到的與改版前相同)', () => {
    render(
      <form data-testid='f'>
        <ManualOrderVehicleField />
      </form>,
    );
    const fd = new FormData(screen.getByTestId('f') as HTMLFormElement);
    expect(fd.get('vehicle_text')).toBe('');
    expect(fd.get('vehicle_pick')).toBe('');
  });
});
