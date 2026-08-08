// fitment-match.test.ts — §7 保守適用比對(V-2b;不降級樣本實測、值班台 diff 審對照)。
// 涵蓋:車型命中/年份合不合、開放式 2025+、單年、缺 yearStart 全年份、year 缺+受限=qualified、
//       modelName 缺=undetermined、free=undetermined、brand 查無=no-match、名稱字面 NFKC 正規化、
//       V-2h/MF-1 slug 碰撞消歧(名稱字面比對、非假 ✓)。

import { describe, it, expect } from 'vitest';
import { checkFitment, type FitmentCheckVehicle } from './fitment-match';
import type { UIFitment } from '@/data/mock-products';

const F = (motoBrand: string, modelCode: string, yearStart?: number, yearEnd?: number | null): UIFitment => ({
  motoBrand,
  modelCode,
  yearStart,
  yearEnd,
});

// V-2h/MF-1:比對吃名稱字面(NFKC 正規化在 checkFitment 內);dict 直帶品牌/車型字面。
const dict = (motoBrand: string, modelCode: string, year?: number): FitmentCheckVehicle => ({
  kind: 'dict',
  brandName: motoBrand,
  modelName: modelCode,
  year,
});

describe('checkFitment（§7 保守比對）', () => {
  it('車型+年份命中(區間內)→ match(名稱字面 NFKC:YAMAHA→yamaha)', () => {
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

  it('modelName 缺(brand-only/選車中途)→ undetermined(禁 brand-level ✓,REQUIRED-2)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], { kind: 'dict', brandName: 'YAMAHA', year: 2022 })).toBe('undetermined');
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

  // V-2h/MF-1 對抗樣本:slug 碰撞消歧。slugify('MT-09')===slugify('MT 09')==='mt-09',taxonomy
  // uniqueId 加序號(mt-09 / mt-09-2)後名稱字面才是唯一真相;回 slug 比對會丟序號 → 假 ✓。
  // 名稱字面 NFKC 保留「空白≠連字號」,選 A 車不會誤命中 B 車 fitment。
  it('MF-1 碰撞:選「MT 09」(空白) vs 商品 fitment「MT-09」(連字號)→ no-match(名稱字面消歧、非假 ✓)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'MT 09', 2022))).toBe('no-match');
  });

  it('MF-1 碰撞反向:選「MT-09」 vs 商品 fitment「MT 09」→ no-match', () => {
    expect(checkFitment([F('YAMAHA', 'MT 09', 2021, 2024)], dict('YAMAHA', 'MT-09', 2022))).toBe('no-match');
  });

  it('MF-1 碰撞同名應命中:選「MT-09」 vs 商品 fitment「MT-09」→ match(名稱字面全等)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'MT-09', 2022))).toBe('match');
  });

  it('NFKC 全形半形正規化:全形「ＭＴ－０９／ＹＡＭＡＨＡ」對半形 fitment → match', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('ＹＡＭＡＨＡ', 'ＭＴ－０９', 2022))).toBe('match');
  });
});

// ── 2026-08-08 選車欄空格不敏感比對(looseVehicleKey)的**反面**回歸格 ────────────────
//
// 🔴 那一片讓「打字過濾」寬鬆到能用「RS6」找到「RS 660」。**這一層絕不准跟著寬鬆** ——
//    `checkFitment` 決定的是「這個零件裝不裝得上你的車」,而本檔 :3 逐字寫著
//    「**錯誤的『✓ 適用』比空白更糟(買錯裝不上=信任毀)**」。
//    「MT 09」與「MT-09」在 taxonomy 是**兩個不同節點**(`vehicle-taxonomy.ts:20` 逐字
//    「空白與連字號不互折」),把它們折平就是 codex MF-1 那個假 ✓ 的形狀。
// 突變:把 `checkFitment` 的正規化換成 `looseVehicleKey`(或把去分隔符併進
//    `normalizeVehicleQuery`)⇒ 只紅這族。
describe('🔴 分隔符不得被折平(空格比對片的反面守門)', () => {
  it('選「MT 09」不得命中「MT-09」的 fitment(假 ✓ 回歸格)', () => {
    expect(checkFitment([F('YAMAHA', 'MT-09', 2021, 2024)], dict('YAMAHA', 'MT 09', 2022)))
      .toBe('no-match');
  });

  it('反向同理:選「MT-09」不得命中「MT 09」的 fitment', () => {
    expect(checkFitment([F('YAMAHA', 'MT 09', 2021, 2024)], dict('YAMAHA', 'MT-09', 2022)))
      .toBe('no-match');
  });

  it('品牌側同樣不折:「Moto Guzzi」與「Moto-Guzzi」不得互相命中', () => {
    expect(checkFitment([F('Moto-Guzzi', 'V7', 2021, 2024)], dict('Moto Guzzi', 'V7', 2022)))
      .toBe('no-match');
  });

  // 正向對照:同一個字面照樣要命中(證明上面三條紅的是「折平」、不是「整個比對壞掉」)
  it('正向對照:字面完全相同仍 match', () => {
    expect(checkFitment([F('YAMAHA', 'MT 09', 2021, 2024)], dict('YAMAHA', 'MT 09', 2022)))
      .toBe('match');
  });
});
