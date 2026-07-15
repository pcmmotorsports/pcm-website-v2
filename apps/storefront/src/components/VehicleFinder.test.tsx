// @vitest-environment jsdom
//
// VehicleFinder smoke test — 前台 regression 安全網(V-1c 起=VehicleSelect combobox 版)。
// 驗「render 不報錯 + 打字選車連動 + 無年車型不限年份 + 短版 push + context 鏡寫 +
// 愛車 chips(唯一精確命中套用/多命中建議清單/零命中提示=REQUIRED-2)」。
// useRouter 走 per-file vi.mock(共享 mockPush 供斷言 push URL)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { VehicleFinder } from './VehicleFinder';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { VEHICLE_CONTEXT_KEY, readVehicleContext } from '@/lib/vehicle-context';

afterEach(() => {
  cleanup();
  mockPush.mockReset();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
});

function combo(label: string) {
  return screen.getByRole('combobox', { name: label }) as HTMLInputElement;
}

function pickByTyping(label: string, text: string) {
  const input = combo(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input); // 唯一精確命中 → 套用
  return input;
}

describe('VehicleFinder(V-1c combobox 版)', () => {
  it('should render the vehicle finder without crashing', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    expect(screen.getByText('輸入你的車輛')).toBeDefined();
    expect(screen.getByText('搜尋部品')).toBeDefined();
  });

  it('視覺回歸鎖(Sean 07-15「欄位很醜」):design slot 版型=三個 ed-finder-slot+小標籤', () => {
    const { container } = render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const slots = container.querySelectorAll('.ed-finder-bar .ed-finder-slot');
    expect(slots).toHaveLength(3);
    const labels = [...container.querySelectorAll('.ed-finder-slot-label')].map((e) => e.textContent);
    expect(labels).toEqual(['品牌', '車型', '年份']);
    expect(container.querySelector('.ed-finder-slot .vsc-input--finder')).toBeTruthy();
    expect(container.querySelector('.ed-finder-bar .cft-select')).toBeNull(); // 型錄樣式不得滲入首頁
  });

  it('打字選品牌 → 車型欄解鎖並可打字選定', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    pickByTyping('選擇品牌', brand.name);
    expect(combo('選擇車型').disabled).toBe(false);
    pickByTyping('選擇車型', brand.models[0]!.name);
    expect(combo('選擇車型').value).toBe(brand.models[0]!.name);
  });

  it('無年車型 → 年份欄「不限年份」、可搜尋、push 無 year 段(37/94 真車型無年)', () => {
    const noYearBrands = [
      { id: 'ducati', name: 'Ducati', models: [{ id: 'monster', name: 'Monster', years: [] }] },
    ];
    render(<VehicleFinder motoBrands={noYearBrands} />);
    pickByTyping('選擇品牌', 'Ducati');
    pickByTyping('選擇車型', 'Monster');
    expect(combo('選擇年份').placeholder).toBe('不限年份');
    const go = screen.getByText('搜尋部品').closest('button')!;
    expect(go.hasAttribute('disabled')).toBe(false);
    fireEvent.click(go);
    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: 'ducati:monster' }).toString()}`,
    );
  });

  it('三層選定 → push 短版 ?vehicle= + vehicle-context 鏡寫(V-1c)', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    const model = brand.models[0]!;
    const year = model.years[0]!;
    pickByTyping('選擇品牌', brand.name);
    pickByTyping('選擇車型', model.name);
    pickByTyping('選擇年份', String(year));
    fireEvent.click(screen.getByText('搜尋部品').closest('button')!);
    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: `${brand.id}:${model.id}:${year}` }).toString()}`,
    );
    expect(readVehicleContext(window.sessionStorage)).toMatchObject({
      brandId: brand.id,
      modelId: model.id,
      year,
    });
  });
});

describe('VehicleFinder — 愛車 chips(REQUIRED-2:唯一精確命中/建議清單/零命中零猜)', () => {
  const BRANDS = [
    {
      id: 'yamaha',
      name: 'Yamaha',
      models: [
        { id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] },
        { id: 'mt-09', name: 'MT-09', years: [2021] },
      ],
    },
  ];

  it('未登入/空車庫 → 不顯示 chips 排', () => {
    render(<VehicleFinder motoBrands={BRANDS} />);
    expect(screen.queryByText('我的愛車')).toBeNull();
  });

  it('唯一精確命中(車型名、含年份合法)→ 直接套用三欄', () => {
    render(
      <VehicleFinder
        motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'mt-09 sp', year: '2021' }]}
      />,
    );
    fireEvent.click(screen.getByText('2021 mt-09 sp'));
    expect(combo('選擇品牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('MT-09 SP');
    expect(combo('選擇年份').value).toBe('2021');
  });

  it('多命中(MT-0 substring 命中兩車型、非精確)→ 展開建議清單、點選才套用', () => {
    render(
      <VehicleFinder motoBrands={BRANDS} garage={[{ id: 'g2', name: 'MT-0', year: '' }]} />,
    );
    fireEvent.click(screen.getByText('MT-0'));
    expect(combo('選擇品牌').value).toBe(''); // 不自動套用
    expect(screen.getByText(/可能是/)).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2); // Yamaha MT-09 SP / Yamaha MT-09(字典字面)
    fireEvent.click(screen.getByRole('option', { name: 'Yamaha MT-09' }));
    expect(combo('選擇品牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('MT-09');
  });

  it('零命中(純自由文字)→ 顯「無法對應」提示、不套用不猜', () => {
    render(
      <VehicleFinder motoBrands={BRANDS} garage={[{ id: 'g3', name: '我的紅色小車', year: '' }]} />,
    );
    fireEvent.click(screen.getByText('我的紅色小車'));
    expect(screen.getByText(/無法對應/)).toBeTruthy();
    expect(combo('選擇品牌').value).toBe('');
  });
});
