// fitment-match.test.ts — §7 保守適用比對(V-2b;不降級樣本實測、值班台 diff 審對照)。
// 涵蓋:車型命中/年份合不合、開放式 2025+、單年、缺 yearStart 全年份、year 缺+受限=qualified、
//       modelId 缺=undetermined、free=undetermined、brandId 查無=no-match、slug 空間往返。

import { describe, it, expect } from 'vitest';
import { checkFitment, type FitmentCheckVehicle } from './fitment-match';
import { slugify } from '@/lib/vehicle-taxonomy';
import type { UIFitment } from '@/data/mock-products';

const F = (motoBrand: string, modelCode: string, yearStart?: number, yearEnd?: number | null): UIFitment => ({
  motoBrand,
  modelCode,
  yearStart,
  yearEnd,
});

// 大寫來源字面 → slugify 應小寫化;brandId/modelId 從同一 slugify 建=slug 空間往返一致
const dict = (motoBrand: string, modelCode: string, year?: number): FitmentCheckVehicle => ({
  kind: 'dict',
  brandId: slugify(motoBrand),
  modelId: slugify(modelCode),
  year,
});

describe('checkFitment（§7 保守比對）', () => {
  it('車型+年份命中(區間內)→ match(slug 空間往返:YAMAHA→yamaha)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'MT-09', 2022))).toBe('match');
  });

  it('車型命中但年份不合 → no-match(✗,REQUIRED-3 反向)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'MT-09', 2019))).toBe('no-match');
  });

  it('開放式 2025+:使用者 2026 → match / 2024 → no-match(null 開放式語意不塌)', () => {
    const open = [F('YAMAHA', 'MT-09', 2025, null)];
    expect(checkFitment(open, dict('YAMAHA', 'MT-09', 2026))).toBe('match');
    expect(checkFitment(open, dict('YAMAHA', 'MT-09', 2024))).toBe('no-match');
  });

  it('單年 fitment(yearEnd undefined):使用者同年 → match / 他年 → no-match', () => {
    const single = [F('YAMAHA', 'MT-09', 2021)];
    expect(checkFitment(single, dict('YAMAHA', 'MT-09', 2021))).toBe('match');
    expect(checkFitment(single, dict('YAMAHA', 'MT-09', 2022))).toBe('no-match');
  });

  it('缺 yearStart 全年份 fitment:使用者給年 → match', () => {
    expect(checkFitment([F('HONDA', 'CB650R')], dict('HONDA', 'CB650R', 2030))).toBe('match');
  });

  it('缺 yearStart 全年份 fitment + 使用者年份未知 → match(bare ✓ 合法)', () => {
    expect(checkFitment([F('HONDA', 'CB650R')], dict('HONDA', 'CB650R'))).toBe('match');
  });

  it('使用者年份未知 + 命中 fitments 皆年份受限 → qualified(禁 bare ✓)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'MT-09'))).toBe('qualified');
  });

  it('使用者年份未知 + 混合(受限+不限)→ match(有不限即可 bare ✓)', () => {
    const mixed = [F('YAMAHA', 'MT-09', 2021, 2024), F('YAMAHA', 'MT-09')];
    expect(checkFitment(mixed, dict('YAMAHA', 'MT-09'))).toBe('match');
  });

  it('modelId 缺(brand-only/選車中途)→ undetermined(禁 brand-level ✓,REQUIRED-2)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], { kind: 'dict', brandId: slugify('YAMAHA'), year: 2022 })).toBe('undetermined');
  });

  it('free(自由輸入)→ undetermined(人工確認)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], { kind: 'free' })).toBe('undetermined');
  });

  it('brandId 對不到任何 fitment → no-match(未列、安全方向)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('KAWASAKI', 'Ninja', 2022))).toBe('no-match');
  });

  it('brand 對但 model 不對 → no-match', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'R6', 2022))).toBe('no-match');
  });
});
