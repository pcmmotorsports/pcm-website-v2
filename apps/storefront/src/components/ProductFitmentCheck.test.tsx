// @vitest-environment jsdom
//
// ProductFitmentCheck smoke — V-2b §7「是否適用我的車」保守比對。
// 驗:context dict 命中→✓ / 未列→✗ / 年份未定→qualified / 無 context→現選入口 /
//     愛車快選→比對 / 無 fitments→null。判定核心 checkFitment 另有 lib/fitment-match.test。

import { afterEach, describe, expect, it, vi } from 'vitest';
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
        garage={[{ id: 'g1', name: 'MT-09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT-09', isPrimary: false }]}
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

  // ── V-2h/MF-2:URL 車款三態 —— 'invalid'(參數在但對不到 taxonomy)不讀舊鏡、顯重新選車 ──

  it('V-2h/MF-2:urlVehicle="invalid" → 不讀過期鏡、不顯舊車判定、顯重新選車入口 + 失效提示', () => {
    setContext({ brandName: 'APRILIA', modelName: 'DORSODURO 750', year: 2015 }); // 過期鏡=舊車
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle="invalid" />);
    expect(screen.queryByText(/DORSODURO 750/)).toBeNull(); // 舊車判定不出現(不讀過期鏡)
    expect(screen.queryByText(/已記下你的車款/)).toBeNull(); // 亦無 undetermined 判定訊息
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy(); // 現選入口
    expect(screen.getByText(/先前的車款連結已失效/)).toBeTruthy(); // 失效提示
  });

  it('V-2h/MF-2:urlVehicle=null(無參數)→ 照舊讀鏡顯車(對照:只 invalid 才不讀)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={null} />);
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    expect(screen.queryByText(/先前的車款連結已失效/)).toBeNull(); // 無失效提示
  });

  // ── V-2h/MF-3:同頁 URL 車款變更反應式重判 + 選車回寫 URL ──

  it('V-2h/MF-3:同頁 URL 車款變更(rerender)→ 重新判定(修 mount-only 留舊值)', () => {
    const { rerender } = render(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }} />,
    );
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy(); // 2022 在 2021-2024 → match
    rerender(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2019 }} />,
    );
    expect(screen.getByText(/未列於適用清單/)).toBeTruthy(); // 2019 不合 → 重判 no-match
  });

  it('V-2h/MF-3:同頁 URL 車款被清除(→ null)→ 清判定顯現選入口、不回填舊鏡', () => {
    setContext({ brandName: 'HONDA', modelName: 'CB650R' }); // 鏡有別車
    const { rerender } = render(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }} />,
    );
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    rerender(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={null} />);
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy(); // 現選入口
    expect(screen.queryByText(/CB650R/)).toBeNull(); // 不回填舊鏡的 HONDA
  });

  it('V-2h/MF-3:愛車快選 commit → onPersistVehicle 帶 taxonomy id param(round-trip 消歧)', () => {
    const onPersist = vi.fn();
    render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'MT-09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT-09', isPrimary: false }]}
        onPersistVehicle={onPersist}
      />,
    );
    fireEvent.click(screen.getByText('2022 MT-09'));
    expect(onPersist).toHaveBeenCalledWith('yamaha:mt-09:2022'); // taxonomy id 空間、非 slugify(name)
  });

  it('V-2h/MF-3:onPersistVehicle 用 taxonomy id、碰撞序號存活(非 slugify(name) 丟序號=MF-1 教訓)', () => {
    const onPersist = vi.fn();
    // 「MT 09」(空白)slugify → 'mt-09' 與「MT-09」撞、taxonomy id 加序號 'mt-09-2';param 必用 id 非 slugify
    const COLLIDE = [
      {
        id: 'yamaha',
        name: 'YAMAHA',
        models: [
          { id: 'mt-09', name: 'MT-09', years: [2022] },
          { id: 'mt-09-2', name: 'MT 09', years: [2022] },
        ],
      },
    ] as MockMotoBrand[];
    render(
      <ProductFitmentCheck
        fitments={[{ motoBrand: 'YAMAHA', modelCode: 'MT 09', yearStart: 2022 }]}
        motoBrands={COLLIDE}
        garage={[{ id: 'g1', name: 'MT 09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT 09', isPrimary: false }]}
        onPersistVehicle={onPersist}
      />,
    );
    fireEvent.click(screen.getByText('2022 MT 09'));
    expect(onPersist).toHaveBeenCalledWith('yamaha:mt-09-2:2022'); // 序號存活;slugify 會塌成 mt-09
  });
});
