import { describe, expect, it } from 'vitest';
import { parseAmount, parseCount } from './dealer-price-parse.js';

/**
 * 🔴 **形狀表** —— 每一種「外部值可能長的樣子」各一格。
 * 主視窗 B 2026-09-07:「你這三輪都是少擋一種形狀,那是**載體問題**」
 * ⇒ 漏的那一種要在**這張表上**看得見,不是在下一輪 codex 的 finding 裡。
 */
describe('形狀表:parseAmount', () => {
  const absent: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['缺 key', ({} as { amount?: unknown }).amount],
    ['空字串', ''],
    ['只有空白的字串', '   '],
  ];
  for (const [name, raw] of absent) {
    it(`${name} ⇒ absent(沒有值)`, () => {
      expect(parseAmount(raw)).toEqual({ kind: 'absent' });
    });
  }

  const values: [string, unknown, number][] = [
    ['數字', 555, 555],
    ['字串數字', '555', 555],
    ['帶空白的字串數字', ' 555 ', 555],
    ['0', 0, 0],
    ['字串 "0"', '0', 0],
    ['小數(四捨五入)', 554.6, 555],
    ['int4 上界', 2147483647, 2147483647],
    ['字串小數(pg numeric 的形狀)', '554.60', 555],
    ['科學記號字串', '5.55e2', 555],
  ];
  for (const [name, raw, want] of values) {
    it(`${name} ⇒ value ${want}`, () => {
      expect(parseAmount(raw)).toEqual({ kind: 'value', value: want });
    });
  }

  const invalid: [string, unknown, string][] = [
    ['非數字字串', 'abc', 'not_a_number'],
    ['NaN', Number.NaN, 'not_a_number'],
    ['Infinity', Number.POSITIVE_INFINITY, 'not_a_number'],
    ['布林 true', true, 'not_a_number'],
    ['布林 false', false, 'not_a_number'],
    ['物件', { amount: 1 }, 'not_a_number'],
    ['陣列', [1], 'not_a_number'],
    ['負數', -1, 'negative'],
    ['字串負數', '-1', 'negative'],
    ['超出 int4', 2147483648, 'overflow'],
    // 🔴 codex 2026-09-07 實測:`Math.round(-0.01)` 是 `-0`, 而 `-0 < 0` 為 false
    //   ⇒ 驗正負若跑在四捨五入之後, 這一列會變成「合法的 0 元」。
    ['負小數(四捨五入會變 -0)', -0.01, 'negative'],
    ['字串負小數', '-0.01', 'negative'],
    ['小數超界', 2147483647.6, 'overflow'],
    ['字串 "NaN"(PG numeric 會回這個)', 'NaN', 'not_a_number'],
    ['字串 "Infinity"', 'Infinity', 'not_a_number'],
    // 🔵 `-Infinity` 先被 `isFinite` 擋掉 ⇒ `not_a_number`(不是 `negative`)。
    //   兩者都是 `invalid`、都會拒收整批,差別只在報哪個理由。
    ['字串 "-Infinity"', '-Infinity', 'not_a_number'],
  ];
  for (const [name, raw, why] of invalid) {
    it(`${name} ⇒ invalid/${why}`, () => {
      expect(parseAmount(raw)).toEqual({ kind: 'invalid', why });
    });
  }

  it('🛑 0 與「沒有值」必須分得開 —— 0 是 2026-08-25 拍板的合法贈品價', () => {
    expect(parseAmount(0).kind).toBe('value');
    expect(parseAmount(null).kind).toBe('absent');
  });

  it('🛑 布林不得被 Number() 悄悄變成 0/1', () => {
    expect(Number(false)).toBe(0); // 正對照:原生行為就是這樣
    expect(parseAmount(false).kind).toBe('invalid'); // 而我們擋掉了
  });
});

describe('形狀表:parseCount', () => {
  it('count 是 0 而無錯誤 ⇒ 真的零筆', () => {
    expect(parseCount(0, null)).toEqual({ ok: true, count: 0 });
  });
  it('🔴 count 是 null 而無錯誤 ⇒ 沒讀到, 不是零筆', () => {
    expect(parseCount(null, null)).toEqual({ ok: false });
  });
  it('count 是 undefined ⇒ 沒讀到', () => {
    expect(parseCount(undefined, null)).toEqual({ ok: false });
  });
  it('count 是字串 ⇒ 沒讀到(不猜)', () => {
    expect(parseCount('12', null)).toEqual({ ok: false });
  });
  it('count 是負數 ⇒ 沒讀到', () => {
    expect(parseCount(-1, null)).toEqual({ ok: false });
  });
  it('有 error ⇒ 沒讀到(即使 count 有值)', () => {
    expect(parseCount(12, { message: 'boom' })).toEqual({ ok: false });
  });
  it('正常筆數', () => {
    expect(parseCount(1234, null)).toEqual({ ok: true, count: 1234 });
  });
});
