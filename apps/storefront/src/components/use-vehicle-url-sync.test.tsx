// @vitest-environment jsdom
//
// useVehicleUrlSync 鏡同步單測 — V-2c R2:cascade.vehicle 變更「寫 URL 同一時機」同步 vehicle-context 鏡
// (修 Sean 07-15 實測:型錄換車/清車不寫鏡 → PDP §7 顯舊車+購物車帶錯車)。
// 驗:選車寫鏡 / 換車鏡跟換 / 清車清鏡 / mount 無車不清既有鏡 / 還原窗口不清鏡 /
//     brand-only 寫鏡(無 modelName=消費端零猜)/ taxonomy 查無 no-op 不動鏡。
// (URL 半邊 router.replace 由 ProductsPage.test + dev 實跑覆蓋;本檔聚焦鏡=V-2c 修復面。)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  // 同 ProductsPage.test 慣例:replace 落 jsdom history、URL 半邊維持可觀察
  useRouter: () => ({
    push: vi.fn(),
    replace: (url: string) => window.history.replaceState(null, '', url),
  }),
}));

import { useVehicleUrlSync } from './products-url-state';
import { readVehicleContext, writeVehicleContext, VEHICLE_CONTEXT_KEY } from '@/lib/vehicle-context';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'YAMAHA',
    models: [
      { id: 'mt-09', name: 'MT-09', years: [2021, 2022] },
      { id: 'mt-07', name: 'MT-07', years: [2021] },
    ],
  },
] as MockMotoBrand[];

type Veh = { brand: string; model?: string; year?: number } | null;

function renderSync(initial: Veh) {
  return renderHook(({ v }: { v: Veh }) => useVehicleUrlSync(v, BRANDS), {
    initialProps: { v: initial },
  });
}

/** 預置一面「舊車」鏡(V-2a additive 名稱欄齊全),模擬他頁先前選過車。 */
function seedStaleMirror() {
  writeVehicleContext({
    brandId: 'aprilia',
    modelId: 'dorsoduro-750',
    label: 'APRILIA DORSODURO 750',
    brandName: 'APRILIA',
    modelName: 'DORSODURO 750',
  });
}

afterEach(() => {
  cleanup();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
  window.history.replaceState(null, '', '/products');
});

describe('useVehicleUrlSync — vehicle-context 鏡同步(V-2c R2)', () => {
  it('選車(brand+model+year)→ 鏡=taxonomy 名稱字面+id+年', () => {
    renderSync({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
    const ctx = readVehicleContext();
    expect(ctx).toMatchObject({
      brandId: 'yamaha',
      modelId: 'mt-09',
      year: 2022,
      brandName: 'YAMAHA',
      modelName: 'MT-09',
    });
  });

  it('換不同車 → 鏡跟著換(不殘留舊車=bug 本體)', () => {
    const { rerender } = renderSync({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
    rerender({ v: { brand: 'YAMAHA', model: 'MT-07' } });
    const ctx = readVehicleContext();
    expect(ctx?.modelName).toBe('MT-07');
    expect(ctx?.year).toBeUndefined();
  });

  it('清車 → 清鏡(真清除:本 mount 曾有車)', () => {
    const { rerender } = renderSync({ brand: 'YAMAHA', model: 'MT-09' });
    expect(readVehicleContext()).not.toBeNull();
    rerender({ v: null });
    expect(readVehicleContext()).toBeNull();
  });

  it('mount 無車(URL 也無車)→ 不清既有鏡(逛 /products 不得洗掉首頁選車)', () => {
    seedStaleMirror();
    renderSync(null);
    expect(readVehicleContext()?.brandName).toBe('APRILIA');
  });

  it('還原窗口(URL 帶可解析 vehicle、state 尚未水合)→ 鏡不動', () => {
    seedStaleMirror();
    window.history.replaceState(null, '', '/products?vehicle=yamaha:mt-09');
    renderSync(null);
    expect(readVehicleContext()?.brandName).toBe('APRILIA'); // 早退、待 restore dispatch 後才由有車分支覆寫
  });

  it('brand-only → 鏡只寫品牌(無 modelName;PDP/購物車消費端名稱不齊=零猜)', () => {
    renderSync({ brand: 'YAMAHA' });
    const ctx = readVehicleContext();
    expect(ctx?.brandName).toBe('YAMAHA');
    expect(ctx?.modelName).toBeUndefined();
    expect(ctx?.modelId).toBeUndefined();
  });

  it('taxonomy 查無 → 保守 no-op(URL 與鏡皆不動)', () => {
    seedStaleMirror();
    renderSync({ brand: 'HONDA', model: 'CB650R' });
    expect(readVehicleContext()?.brandName).toBe('APRILIA');
  });
});
