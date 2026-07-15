import { describe, it, expect } from 'vitest';
import { resolveEnd, matchFitmentYear, isYearUnrestricted } from './year-range';

describe('resolveEnd', () => {
  it('yearEnd null → Infinity(開放式)', () => {
    expect(resolveEnd(2025, null)).toBe(Infinity);
  });
  it('yearEnd undefined → yearStart(單年)', () => {
    expect(resolveEnd(2021)).toBe(2021);
  });
  it('yearEnd number → yearEnd(範圍上限)', () => {
    expect(resolveEnd(2018, 2024)).toBe(2024);
  });
});

describe('matchFitmentYear（V-2b 升 domain;byte 等價原 adapters 版）', () => {
  it('actual 無 yearStart → true(不限年份)', () => {
    expect(matchFitmentYear({}, { yearStart: 2021, yearEnd: 2022 })).toBe(true);
  });
  it('spec 無 yearStart → true(fitment 不限年份、任何年皆命中)', () => {
    expect(matchFitmentYear({ yearStart: 2021, yearEnd: 2021 }, {})).toBe(true);
  });
  it('單年落在 fitment 範圍內 → true', () => {
    expect(matchFitmentYear({ yearStart: 2022, yearEnd: 2022 }, { yearStart: 2018, yearEnd: 2024 })).toBe(true);
  });
  it('單年落在 fitment 範圍外 → false', () => {
    expect(matchFitmentYear({ yearStart: 2017, yearEnd: 2017 }, { yearStart: 2018, yearEnd: 2024 })).toBe(false);
  });
  it('開放式 fitment(yearEnd null)涵蓋較後年份 → true', () => {
    expect(matchFitmentYear({ yearStart: 2030, yearEnd: 2030 }, { yearStart: 2025, yearEnd: null })).toBe(true);
  });
  it('開放式 fitment(2025+)不涵蓋較早年份 → false', () => {
    expect(matchFitmentYear({ yearStart: 2024, yearEnd: 2024 }, { yearStart: 2025, yearEnd: null })).toBe(false);
  });
  it('範圍重疊(邊界相接)→ true', () => {
    expect(matchFitmentYear({ yearStart: 2024, yearEnd: 2026 }, { yearStart: 2018, yearEnd: 2024 })).toBe(true);
  });
  it('範圍不重疊 → false', () => {
    expect(matchFitmentYear({ yearStart: 2025, yearEnd: 2026 }, { yearStart: 2018, yearEnd: 2024 })).toBe(false);
  });
});

describe('isYearUnrestricted', () => {
  it('yearStart undefined → true(該車型全年份)', () => {
    expect(isYearUnrestricted({})).toBe(true);
  });
  it('yearStart 定義 → false', () => {
    expect(isYearUnrestricted({ yearStart: 2021 })).toBe(false);
  });
});
