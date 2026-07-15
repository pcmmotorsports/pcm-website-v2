// @vitest-environment jsdom
// InlineVehicleForm smoke — V-1c+(Sean 07-15 實測回饋):車型欄打字跳字典建議、點選填標準字面、
// 自由輸入 fallback 不變(字典沒有照打照存、不擋)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { InlineVehicleForm } from './InlineVehicleForm';

const OPTIONS = ['Yamaha YZF-R6', 'Yamaha YZF-R1', 'Kawasaki Z900'];

afterEach(cleanup);

function renderForm(vehicleModelOptions?: string[]) {
  const onSubmit = vi.fn().mockResolvedValue({ ok: true as const });
  const utils = render(
    <InlineVehicleForm
      veh={{}}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      vehicleModelOptions={vehicleModelOptions}
    />,
  );
  const nameInput = utils.container.querySelector('.vsc input') as HTMLInputElement;
  return { onSubmit, nameInput, ...utils };
}

describe('InlineVehicleForm — 車型字典建議(V-1c+)', () => {
  it('聚焦+打字 → 跳字典建議(substring、上限 8);點選=填標準字面', () => {
    const { nameInput } = renderForm(OPTIONS);
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'yzf' } });
    const opts = screen.getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Yamaha YZF-R6', 'Yamaha YZF-R1']);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha YZF-R6' }));
    expect(nameInput.value).toBe('Yamaha YZF-R6');
    expect(screen.queryAllByRole('option')).toHaveLength(0); // 選完收合
  });

  it('自由輸入 fallback:字典查無 → 無建議、值照留可送出;缺 options prop 行為同舊版', () => {
    const { nameInput } = renderForm(OPTIONS);
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: '我的紅色小車' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(nameInput.value).toBe('我的紅色小車');

    cleanup();
    const legacy = renderForm(undefined);
    fireEvent.focus(legacy.nameInput);
    fireEvent.change(legacy.nameInput, { target: { value: 'yzf' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('blur 收合建議(onMouseDown 先於 blur、點選不被搶走已由選取案覆蓋)', () => {
    const { nameInput } = renderForm(OPTIONS);
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'z9' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.blur(nameInput);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
