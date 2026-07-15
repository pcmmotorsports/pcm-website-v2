// @vitest-environment jsdom
// InlineVehicleForm smoke — V-1c++(Sean 07-16 實測回饋二輪):車型欄=品牌/車型雙下拉
// (與首頁同 combobox 原型、清單可捲無 8 筆截斷)為主、「改用自行輸入」fallback;
// 送出名稱=字典標準字面「品牌 車型」→ 首頁愛車 chips 可精確命中。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { InlineVehicleForm } from './InlineVehicleForm';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'r6', name: 'YZF-R6', years: [2018, 2019, 2020] },
      { id: 'r1', name: 'YZF-R1', years: [2020, 2021] },
    ],
  },
  { id: 'kawasaki', name: 'Kawasaki', models: [{ id: 'z900', name: 'Z900', years: [2021] }] },
];

afterEach(cleanup);

function renderForm(props: { vehicleBrands?: MockMotoBrand[]; veh?: Record<string, unknown> } = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ ok: true as const });
  const utils = render(
    <InlineVehicleForm
      veh={props.veh ?? {}}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      vehicleBrands={props.vehicleBrands}
    />,
  );
  return { onSubmit, ...utils };
}

function combo(label: string) {
  return screen.getByRole('combobox', { name: label }) as HTMLInputElement;
}

function pickByTyping(label: string, text: string) {
  const input = combo(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input); // 唯一精確命中 → 套用
  return input;
}

describe('InlineVehicleForm — 車型字典雙下拉(V-1c++)', () => {
  it('預設 dict 模式:品牌/車型雙下拉;選品牌解鎖車型;送出=標準字面「品牌 車型」', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    expect(combo('選擇車型').disabled).toBe(true);
    pickByTyping('選擇品牌', 'Yamaha');
    expect(combo('選擇車型').disabled).toBe(false);
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: 'Yamaha YZF-R6' });
  });

  it('聚焦品牌 → 展開完整清單(可捲、無截斷);換品牌 → 車型連動清空', () => {
    renderForm({ vehicleBrands: BRANDS });
    fireEvent.focus(combo('選擇品牌'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Yamaha',
      'Kawasaki',
    ]);
    pickByTyping('選擇品牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    pickByTyping('選擇品牌', 'Kawasaki');
    expect(combo('選擇車型').value).toBe('');
  });

  it('dict 模式未選齊 → 送出擋下顯欄位錯、不打 server', () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText('儲存'));
    expect(screen.getByText(/請選擇品牌與車型/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('「改用自行輸入」→ 自由文字照打照存(字典沒有的車不擋);可切回清單選車', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText(/改用自行輸入/));
    const free = screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement;
    fireEvent.change(free, { target: { value: '我的紅色小車' } });
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: '我的紅色小車' });
    expect(screen.getByText(/改用清單選車/)).toBeTruthy();
  });

  it('NIT-1:自由輸入=字典字面 → 切回清單選車時回填雙下拉(所見=所送)', () => {
    renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText(/改用自行輸入/));
    fireEvent.change(screen.getByPlaceholderText('YAMAHA YZF-R6'), {
      target: { value: 'Kawasaki Z900' },
    });
    fireEvent.click(screen.getByText(/改用清單選車/));
    expect(combo('選擇品牌').value).toBe('Kawasaki');
    expect(combo('選擇車型').value).toBe('Z900');
  });

  it('編輯模式:name=字典標準字面 → dict 回填雙下拉;自由文字 → 進自行輸入模式', () => {
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v1', name: 'Yamaha YZF-R1' } });
    expect(combo('選擇品牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('YZF-R1');
    cleanup();
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v2', name: '我的紅色小車' } });
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe(
      '我的紅色小車',
    );
  });

  it('缺字典(vehicleBrands 缺省)→ 退回純自由輸入、無切換鈕(行為同舊版)', () => {
    renderForm();
    expect(screen.getByPlaceholderText('YAMAHA YZF-R6')).toBeTruthy();
    expect(screen.queryByText(/改用清單選車/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: '選擇品牌' })).toBeNull();
  });
});
