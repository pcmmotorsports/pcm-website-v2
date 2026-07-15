// @vitest-environment jsdom
//
// ProductFitmentCheck smoke — V-2b §7「是否適用我的車」保守比對。
// 驗:context dict 命中→✓ / 未列→✗ / 年份未定→qualified / 無 context→現選入口 /
//     愛車快選→比對 / 無 fitments→null。判定核心 checkFitment 另有 lib/fitment-match.test。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProductFitmentCheck } from './ProductFitmentCheck';
import { VEHICLE_CONTEXT_KEY } from '@/lib/vehicle-context';
import { slugify } from '@/lib/vehicle-taxonomy';
import type { UIFitment } from '@/data/mock-products';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const FITMENTS: UIFitment[] = [{ motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: 2021, yearEnd: 2024 }];
const BRANDS: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-09', name: 'MT-09', years: [2021, 2022, 2023, 2024] }] },
] as MockMotoBrand[];

function setContext(v: { brandName: string; modelName: string; year?: number }) {
  window.sessionStorage.setItem(
    VEHICLE_CONTEXT_KEY,
    JSON.stringify({
      brandId: slugify(v.brandName),
      modelId: slugify(v.modelName),
      year: v.year,
      label: `${v.brandName} ${v.modelName}`,
      brandName: v.brandName,
      modelName: v.modelName,
      savedAt: 1,
    }),
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
});

describe('ProductFitmentCheck（§7）', () => {
  it('context dict 命中(年份區間內)→ ✓ 適用', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('context dict 年份不合 → ✗ 未列 + 聯絡', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2019 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText(/未列於適用清單/)).toBeTruthy();
    expect(screen.getByText('✗')).toBeTruthy();
    expect(screen.getByText(/聯絡我們確認/)).toBeTruthy();
  });

  it('context dict 年份未定 + 受限 fitment → qualified(禁 bare ✓)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText(/有年份限制/)).toBeTruthy();
    expect(screen.getByText(/請確認你的年份/)).toBeTruthy();
  });

  it('無 context → 現選入口(確認是否適用你的車)', () => {
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '選擇品牌' })).toBeTruthy();
  });

  it('愛車快選 dict 命中 → 套用並比對(✓)', () => {
    render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'MT-09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT-09' }]}
      />,
    );
    fireEvent.click(screen.getByText('2022 MT-09'));
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
  });

  it('無 fitments → 整段不渲染', () => {
    const { container } = render(<ProductFitmentCheck fitments={[]} motoBrands={BRANDS} />);
    expect(container.firstChild).toBeNull();
  });

  // ── V-2c:URL `?vehicle=` 恆第一真相、優先於 context 鏡(修「回上一頁換車後 PDP 顯舊車」)──

  it('V-2c:urlVehicle 優先於過期鏡 → 判 URL 車款、掛載回寫同步鏡', () => {
    setContext({ brandName: 'APRILIA', modelName: 'DORSODURO 750' }); // 過期鏡=舊車
    render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }}
      />,
    );
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy(); // 顯 URL 車、非鏡的舊車
    const raw = window.sessionStorage.getItem(VEHICLE_CONTEXT_KEY);
    const ctx = JSON.parse(raw!) as { brandName?: string; modelName?: string; year?: number };
    expect(ctx.brandName).toBe('YAMAHA'); // 鏡已同步=addToCart 帶入同源、不再分家
    expect(ctx.modelName).toBe('MT-09');
    expect(ctx.year).toBe(2022);
  });

  it('V-2d③:picker 預設收合殼——入口鈕存在、點擊加 pfc-picker-open(展開=CSS ≤1023 生效;§7 邏輯零動)', () => {
    const { container } = render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    const picker = container.querySelector('.pfc-picker')!;
    expect(picker.classList.contains('pfc-picker-open')).toBe(false);
    fireEvent.click(screen.getByText('選擇車款,確認是否適用'));
    expect(container.querySelector('.pfc-picker')!.classList.contains('pfc-picker-open')).toBe(true);
    expect(screen.getByRole('combobox', { name: '選擇品牌' })).toBeTruthy(); // 選單仍在(桌機恆顯)
  });

  it('V-2c:urlVehicle brand-only → 不判定(現選入口、零猜)、鏡同步蓋掉過期鏡', () => {
    setContext({ brandName: 'APRILIA', modelName: 'DORSODURO 750' });
    render(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA' }} />,
    );
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy();
    const ctx = JSON.parse(window.sessionStorage.getItem(VEHICLE_CONTEXT_KEY)!) as {
      brandName?: string;
      modelName?: string;
    };
    expect(ctx.brandName).toBe('YAMAHA');
    expect(ctx.modelName).toBeUndefined();
  });
});
