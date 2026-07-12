import { describe, expect, it } from 'vitest';
import { formatCardFits } from './product-card-fits';
import type { UIFitment } from '@/data/mock-products';

const f = (over: Partial<UIFitment>): UIFitment => ({ motoBrand: 'YAMAHA', modelCode: 'MT-09', ...over });

describe('formatCardFits', () => {
  it('無 fitments 陣列 → 回退 fallback', () => {
    expect(formatCardFits(undefined, '通用款')).toBe('通用款');
    expect(formatCardFits([], 'YAMAHA MT-09')).toBe('YAMAHA MT-09');
  });

  it('單一車款明確年段 → 兩位數 起–迄', () => {
    expect(formatCardFits([f({ yearStart: 2018, yearEnd: 2024 })], 'x')).toBe("YAMAHA MT-09 '18–'24");
  });

  it('單一車款單年(yearEnd 省略或 ===yearStart)→ 只一個年份', () => {
    expect(formatCardFits([f({ yearStart: 2021 })], 'x')).toBe("YAMAHA MT-09 '21");
    expect(formatCardFits([f({ yearStart: 2021, yearEnd: 2021 })], 'x')).toBe("YAMAHA MT-09 '21");
  });

  it('單一車款開放式(yearEnd===null)→ 起年+', () => {
    expect(formatCardFits([f({ yearStart: 2025, yearEnd: null })], 'x')).toBe("YAMAHA MT-09 '25+");
  });

  it('單一車款多筆年段 → min 起 – max 迄', () => {
    expect(
      formatCardFits(
        [f({ yearStart: 2018, yearEnd: 2020 }), f({ yearStart: 2021, yearEnd: 2024 })],
        'x',
      ),
    ).toBe("YAMAHA MT-09 '18–'24");
  });

  it('同款 direct + inherited(matchSource 不同)→ 仍算單款、年段合併', () => {
    expect(
      formatCardFits(
        [
          f({ yearStart: 2018, yearEnd: 2020, matchSource: 'direct' }),
          f({ yearStart: 2021, yearEnd: 2024, matchSource: 'inherited' }),
        ],
        'x',
      ),
    ).toBe("YAMAHA MT-09 '18–'24");
  });

  it('單一車款無年份 → 降級只顯車款、不杜撰', () => {
    expect(formatCardFits([f({ yearStart: undefined, yearEnd: undefined })], 'x')).toBe('YAMAHA MT-09');
  });

  it('多車款(Sean Q1=A)→ N 款車型、不挑代表款', () => {
    expect(
      formatCardFits(
        [f({ modelCode: 'MT-09' }), f({ modelCode: 'MT-07' }), f({ motoBrand: 'HONDA', modelCode: 'CB650R' })],
        'x',
      ),
    ).toBe('3 款車型');
  });

  it('車款名皆空 → 回退 fallback(不顯空「適用 」)', () => {
    expect(formatCardFits([{ motoBrand: '', modelCode: '' }], '通用款')).toBe('通用款');
  });
});
