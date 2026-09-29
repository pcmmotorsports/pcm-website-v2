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

  it('單一車款開放式(yearEnd===null)→「起年 年起」,不用會被讀成保證的「\'25+」', () => {
    expect(formatCardFits([f({ yearStart: 2025, yearEnd: null })], 'x')).toBe('YAMAHA MT-09 2025 年起');
    // 🔵 對照組:封閉年段**不能**跟著變成「年起」,否則等於每一件都在標開放年、那句話就沒意義了。
    expect(formatCardFits([f({ yearStart: 2018, yearEnd: 2024 })], 'x')).not.toContain('年起');
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

  describe('多車款而各款年份一致 ⇒ 年份寫出來(2026-09-29 主視窗定甲:Evotech 同名商品只差年份)', () => {
    it("兩款同一段閉區間 ⇒ 「2 款車型 '21–'23」", () => {
      expect(
        formatCardFits([f({ modelCode: 'MT-09', yearStart: 2021, yearEnd: 2023 }), f({ modelCode: 'MT-09 SP', yearStart: 2021, yearEnd: 2023 })], 'x'),
      ).toBe("2 款車型 '21–'23");
    });

    it('兩款同起年的開放年 ⇒ 「2 款車型 2024 年起」(與單款同一個寫法)', () => {
      expect(
        formatCardFits([f({ modelCode: 'MT-09', yearStart: 2024, yearEnd: null }), f({ modelCode: 'MT-09 SP', yearStart: 2024, yearEnd: null })], 'x'),
      ).toBe('2 款車型 2024 年起');
    });

    it('一款有多年段(中間有空缺)、一款連續, 壓平後相同 ⇒ 仍合併(與單款規則一致, Fable R1 建議)', () => {
      expect(
        formatCardFits(
          [
            f({ modelCode: 'MT-09', yearStart: 2018, yearEnd: 2019 }),
            f({ modelCode: 'MT-09', yearStart: 2023, yearEnd: 2024 }),
            f({ modelCode: 'MT-07', yearStart: 2018, yearEnd: 2024 }),
          ],
          'x',
        ),
      ).toBe("2 款車型 '18–'24");
    });

    it('🔵 各款年份不同 ⇒ 照舊只寫款數', () => {
      expect(
        formatCardFits([f({ modelCode: 'MT-09', yearStart: 2021, yearEnd: 2023 }), f({ modelCode: 'MT-07', yearStart: 2021, yearEnd: 2024 })], 'x'),
      ).toBe('2 款車型');
    });

    it('🔵 開放年與閉區間不混為一談 ⇒ 只寫款數', () => {
      expect(
        formatCardFits([f({ modelCode: 'MT-09', yearStart: 2024, yearEnd: null }), f({ modelCode: 'MT-07', yearStart: 2024, yearEnd: 2024 })], 'x'),
      ).toBe('2 款車型');
    });

    it('🔵 其中一款沒有年份(不限年份)⇒ 只寫款數, 不能把它說成有年限', () => {
      expect(
        formatCardFits([f({ modelCode: 'MT-09', yearStart: 2021, yearEnd: 2023 }), f({ modelCode: 'MT-07', yearStart: undefined, yearEnd: undefined })], 'x'),
      ).toBe('2 款車型');
    });
  });

  it('車款名皆空 → 回退 fallback(不顯空「適用 」)', () => {
    expect(formatCardFits([{ motoBrand: '', modelCode: '' }], '通用款')).toBe('通用款');
  });

  // 急件2(2026-07-15 prod 炸頁止血):jsonb 直透 null 車款名 → 不 throw、髒條目略過、全髒回退。
  describe('null/非字串車款名防呆(急件2)', () => {
    const dirty = (over: Record<string, unknown>): UIFitment =>
      ({ motoBrand: 'YAMAHA', modelCode: 'MT-09', ...over }) as unknown as UIFitment;

    it('motoBrand:null(prod 實證 shape)→ 不 throw、以 modelCode 照算', () => {
      expect(formatCardFits([dirty({ motoBrand: null, modelCode: 'GasGas 700 SM/Enduro' })], 'x')).toBe(
        'GasGas 700 SM/Enduro',
      );
    });

    it('modelCode:null → 不 throw、以 motoBrand 照算', () => {
      expect(formatCardFits([dirty({ modelCode: null, yearStart: 2021 })], 'x')).toBe("YAMAHA '21");
    });

    it('雙 null 條目略過、其餘正常條目照算', () => {
      expect(
        formatCardFits(
          [dirty({ motoBrand: null, modelCode: null }), f({ yearStart: 2018, yearEnd: 2024 })],
          'x',
        ),
      ).toBe("YAMAHA MT-09 '18–'24");
    });

    it('全髒(雙 null)→ 回退 fallback、不 throw', () => {
      expect(formatCardFits([dirty({ motoBrand: null, modelCode: null })], '通用款')).toBe('通用款');
    });
  });
});
