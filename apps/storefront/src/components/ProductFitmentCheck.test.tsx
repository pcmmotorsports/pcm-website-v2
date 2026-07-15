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
});
