import { describe, it, expect } from 'vitest';
import {
  formatDisplayId,
  isValidDisplayId,
  assertDisplayId,
  parseDisplayId,
} from './display-id';
import { OrderError } from './errors';

describe('formatDisplayId', () => {
  it('組 PCM-YYYY-NNNN、序號前導補 0 至 4 位', () => {
    expect(formatDisplayId(2026, 1)).toBe('PCM-2026-0001');
    expect(formatDisplayId(2026, 42)).toBe('PCM-2026-0042');
    expect(formatDisplayId(2026, 1234)).toBe('PCM-2026-1234');
  });

  it('序號超過 4 位不截斷', () => {
    expect(formatDisplayId(2026, 12345)).toBe('PCM-2026-12345');
  });

  it('year 非 4 位整數 throw OrderError invalid_display_id', () => {
    expect(() => formatDisplayId(999, 1)).toThrow(OrderError);
    expect(() => formatDisplayId(10000, 1)).toThrow(OrderError);
    expect(() => formatDisplayId(2026.5, 1)).toThrow(OrderError);
    try {
      formatDisplayId(999, 1);
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_display_id');
    }
  });

  it('seq 非正整數 throw OrderError invalid_display_id', () => {
    expect(() => formatDisplayId(2026, 0)).toThrow(OrderError);
    expect(() => formatDisplayId(2026, -1)).toThrow(OrderError);
    expect(() => formatDisplayId(2026, 1.5)).toThrow(OrderError);
    try {
      formatDisplayId(2026, 0);
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_display_id');
    }
  });
});

describe('isValidDisplayId', () => {
  it('合法格式回 true', () => {
    expect(isValidDisplayId('PCM-2026-0001')).toBe(true);
    expect(isValidDisplayId('PCM-2026-12345')).toBe(true);
  });

  it('非法格式回 false', () => {
    expect(isValidDisplayId('PCM-2026-1')).toBe(false); // 序號不足 4 位
    expect(isValidDisplayId('PCM-26-0001')).toBe(false); // 年非 4 位
    expect(isValidDisplayId('pcm-2026-0001')).toBe(false); // 小寫前綴
    expect(isValidDisplayId('ORD-2026-0001')).toBe(false); // 錯前綴
    expect(isValidDisplayId('PCM-2026-0001-x')).toBe(false); // 多餘尾段
    expect(isValidDisplayId('')).toBe(false);
  });
});

describe('assertDisplayId', () => {
  it('合法回原值', () => {
    expect(assertDisplayId('PCM-2026-0001')).toBe('PCM-2026-0001');
  });

  it('非法 throw OrderError invalid_display_id', () => {
    expect(() => assertDisplayId('bad')).toThrow(OrderError);
    try {
      assertDisplayId('bad');
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_display_id');
    }
  });
});

describe('parseDisplayId', () => {
  it('拆回 { year, seq }、前導 0 解析後丟失', () => {
    expect(parseDisplayId('PCM-2026-0001')).toEqual({ year: 2026, seq: 1 });
    expect(parseDisplayId('PCM-2026-12345')).toEqual({ year: 2026, seq: 12345 });
  });

  it('非法 throw OrderError invalid_display_id', () => {
    expect(() => parseDisplayId('PCM-2026-1')).toThrow(OrderError);
  });
});
