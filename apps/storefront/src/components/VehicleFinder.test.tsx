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
    // A8:hint 走 A 表定版。舊字面賣了一個不存在的能力(選車輸入裡沒有「引擎代號」欄),
    // 且該字面原本零守門 —— 改回去照樣全綠。
    expect(screen.getByText('選廠牌即可搜尋，選到車型、年份更精準')).toBeDefined();
    expect(screen.queryByText('精準匹配車款、年份、引擎代號')).toBeNull();
  });

  it('視覺回歸鎖(Sean 07-15「欄位很醜」):design slot 版型=三個 ed-finder-slot+小標籤', () => {
    const { container } = render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const slots = container.querySelectorAll('.ed-finder-bar .ed-finder-slot');
    expect(slots).toHaveLength(3);
    const labels = [...container.querySelectorAll('.ed-finder-slot-label')].map((e) => e.textContent);
    // A3(選車引擎統一 B′):slot 標籤照 OD A 表 —— 車=廠牌;車型/年份標「· 可不選」
    expect(labels).toEqual(['廠牌', '車型 · 可不選', '年份 · 可不選']);
    // 🔴 finder 變體的 placeholder:A3 前是三個 `—`(設計稿 C2 兩張圖皆如此畫),改採 A 表定版。
    //    這是本批**唯一改到首頁首屏可見字面**的地方,沒有這行斷言就完全沒有守門(改回去全綠)。
    expect([...container.querySelectorAll<HTMLInputElement>('.ed-finder-slot .vsc-input--finder')]
      .map((e) => e.placeholder))
      .toEqual(['選擇或輸入廠牌', '選擇或輸入車型', '選擇或輸入年份']);
    expect(container.querySelector('.ed-finder-slot .vsc-input--finder')).toBeTruthy();
    expect(container.querySelector('.ed-finder-bar .cft-select')).toBeNull(); // 型錄樣式不得滲入首頁
  });

  it('打字選品牌 → 車型欄解鎖並可打字選定', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    pickByTyping('選擇廠牌', brand.name);
    expect(combo('選擇車型').disabled).toBe(false);
    pickByTyping('選擇車型', brand.models[0]!.name);
    expect(combo('選擇車型').value).toBe(brand.models[0]!.name);
  });

  it('無年車型 → 年份欄「不限年份」、可搜尋、push 無 year 段(37/94 真車型無年)', () => {
    const noYearBrands = [
      { id: 'ducati', name: 'Ducati', models: [{ id: 'monster', name: 'Monster', years: [] }] },
    ];
    render(<VehicleFinder motoBrands={noYearBrands} />);
    pickByTyping('選擇廠牌', 'Ducati');
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
    pickByTyping('選擇廠牌', brand.name);
    pickByTyping('選擇車型', model.name);
    pickByTyping('選擇年份', String(year));
    fireEvent.click(screen.getByText('搜尋部品').closest('button')!);
    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: `${brand.id}:${model.id}:${year}` }).toString()}`,
    );
    // 🔴 名稱字面欄(brandName/modelName)是 V-2a REQUIRED-3 的 additive 欄,購物車自動帶車
    //    (lib/search-vehicle.ts)兩欄都要齊才帶 —— 少一欄就靜默不帶車、零測試會紅。
    //    這裡的正向對照同時讓 brand-only 那條的 `modelName 應為 undefined` 不再是恆真斷言。
    expect(readVehicleContext(window.sessionStorage)).toMatchObject({
      brandId: brand.id,
      modelId: model.id,
      year,
      brandName: brand.name,
      modelName: model.name,
      label: `${brand.name} ${model.name} ${year}`,
    });
  });

  // ── A8 / Sean 08-03 拍 Q4=A:首頁門檻放寬到「選廠牌即可搜」(與目錄一致)──
  // 改動前:必須選到車型、該車型有年份時還必須選年份,否則送出鈕 disabled。

  it('Q4=A:只選廠牌 → 送出鈕即亮、push 單段 ?vehicle=brandId、鏡不帶 modelId/year', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    pickByTyping('選擇廠牌', brand.name);

    const go = screen.getByText('搜尋部品').closest('button')!;
    expect(go.hasAttribute('disabled')).toBe(false); // 門檻:選了廠牌就可送出

    fireEvent.click(go);
    // 🔴 整串字面斷言:`?vehicle=brandId:year` 是不存在的格式,只比「有沒有 brandId」抓不到那個錯
    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: brand.id }).toString()}`,
    );

    const mirror = readVehicleContext(window.sessionStorage);
    expect(mirror).toMatchObject({ brandId: brand.id, brandName: brand.name });
    // brand-only ⇒ 鏡的車型/年份欄必須是「沒有」,不得殘留上一次或塞進假值
    expect(mirror?.modelId).toBeUndefined();
    expect(mirror?.year).toBeUndefined();
    expect(mirror?.modelName).toBeUndefined();
    expect(mirror?.label).toBe(brand.name);
  });

  it('Q4=A:選了廠牌+車型但不選年份 → push 兩段、鏡不帶 year(有年份的車型也一樣)', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    const model = brand.models[0]!;
    expect(model.years.length).toBeGreaterThan(0); // 前提:這是「有年份可選卻不選」,不是無年份車型

    pickByTyping('選擇廠牌', brand.name);
    pickByTyping('選擇車型', model.name);
    fireEvent.click(screen.getByText('搜尋部品').closest('button')!);

    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: `${brand.id}:${model.id}` }).toString()}`,
    );
    expect(readVehicleContext(window.sessionStorage)?.year).toBeUndefined();
  });

  it('Q4=A 邊界:什麼都沒選 → 送出鈕仍 disabled(門檻放寬不等於取消門檻)', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const go = screen.getByText('搜尋部品').closest('button')!;
    expect(go.hasAttribute('disabled')).toBe(true);
    fireEvent.click(go);
    expect(mockPush).not.toHaveBeenCalled();
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
        garage={[{ id: 'g1', name: 'mt-09 sp', year: '2021', dictBrandName: null, dictModelName: null }]}
      />,
    );
    fireEvent.click(screen.getByText('2021 mt-09 sp'));
    expect(combo('選擇廠牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('MT-09 SP');
    expect(combo('選擇年份').value).toBe('2021');
  });

  it('多命中(MT-0 substring 命中兩車型、非精確)→ 展開建議清單、點選才套用', () => {
    render(
      <VehicleFinder motoBrands={BRANDS} garage={[{ id: 'g2', name: 'MT-0', year: '', dictBrandName: null, dictModelName: null }]} />,
    );
    fireEvent.click(screen.getByText('MT-0'));
    expect(combo('選擇廠牌').value).toBe(''); // 不自動套用
    expect(screen.getByText(/可能是/)).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2); // Yamaha MT-09 SP / Yamaha MT-09(字典字面)
    fireEvent.click(screen.getByRole('option', { name: 'Yamaha MT-09' }));
    expect(combo('選擇廠牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('MT-09');
  });

  it('V-1d 分流:dict 欄有值 → 精確 lookup 直套(顯示名隨便改都不影響)', () => {
    render(
      <VehicleFinder
        motoBrands={BRANDS}
        garage={[
          { id: 'g4', name: '我的通勤車', year: '2021', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP' },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('2021 我的通勤車'));
    expect(combo('選擇廠牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('MT-09 SP');
    expect(combo('選擇年份').value).toBe('2021');
  });

  it('V-1d 分流:dict 欄指向已演化消失的車款 → 降級字面比對流(零猜)', () => {
    render(
      <VehicleFinder
        motoBrands={BRANDS}
        garage={[
          { id: 'g5', name: '我的紅色小車', year: '', dictBrandName: 'Yamaha', dictModelName: '已下架車型' },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('我的紅色小車'));
    expect(screen.getByText(/無法對應/)).toBeTruthy(); // name 零命中 → 提示、不套用
    expect(combo('選擇廠牌').value).toBe('');
  });

  it('零命中(純自由文字)→ 顯「無法對應」提示、不套用不猜', () => {
    render(
      <VehicleFinder motoBrands={BRANDS} garage={[{ id: 'g3', name: '我的紅色小車', year: '', dictBrandName: null, dictModelName: null }]} />,
    );
    fireEvent.click(screen.getByText('我的紅色小車'));
    expect(screen.getByText(/無法對應/)).toBeTruthy();
    expect(combo('選擇廠牌').value).toBe('');
  });
});
