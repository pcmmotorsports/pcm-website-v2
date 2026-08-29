import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORRECTION_DB_BLANK_CHARS,
  CORRECTION_REASON_MAX,
  CORRECTION_SINGLE_FIELDS,
  CORRECTION_TOKEN_MAX,
  isDbBlank,
  parseCorrectionForm,
} from './refund-correction-form';
import {
  CORRECTION_EXPECTED_ID_FIELD,
  CORRECTION_REASON_FIELD,
  CORRECTION_REFUND_ID_FIELD,
  CORRECTION_REQUEST_TOKEN_FIELD,
  CORRECTION_VERDICT_FIELD,
} from './refund-correction-state';

// refund-correction-form.test.ts — `#890` 片2b 的解析器。
//
// 🔴 **這一支的重點是「前端不得比 DB 寬」** —— 而那句話只有配上
//    【一個正常的理由必須通過】才有意義:一個把所有輸入都拒掉的解析器**滿分通過**
//    (plan v4 §1d「v4 折 A4」,原 R3-5)。

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20260814190000_m4b_e10_473b1_refund_manual_corrections.sql',
);

const UUID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

/** 假表單:只實作 `getAll`。傳陣列 = 送多筆(用來打「送兩份」那條路)。 */
function form(fields: Record<string, string | string[] | undefined>) {
  return {
    getAll(name: string): FormDataEntryValue[] {
      const v = fields[name];
      if (v === undefined) return [];
      return (Array.isArray(v) ? v : [v]) as FormDataEntryValue[];
    },
  };
}

function good(over: Record<string, string | string[] | undefined> = {}) {
  return form({
    [CORRECTION_REFUND_ID_FIELD]: UUID_A,
    [CORRECTION_EXPECTED_ID_FIELD]: UUID_B,
    [CORRECTION_VERDICT_FIELD]: 'no_money_moved',
    [CORRECTION_REASON_FIELD]: '對過 TapPay，這筆錢其實沒有動',
    [CORRECTION_REQUEST_TOKEN_FIELD]: 'tok-0001',
    ...over,
  });
}

describe('🔴🔴 正對照 —— 缺了它,一個全拒的解析器會滿分通過', () => {
  it('一個正常的中文理由**必須通過**', () => {
    const parsed = parseCorrectionForm(good());
    expect(parsed.ok).toBe(true);
  });

  it('兩個合法的 verdict 都必須通過', () => {
    for (const v of ['money_moved', 'no_money_moved']) {
      expect(parseCorrectionForm(good({ [CORRECTION_VERDICT_FIELD]: v })).ok).toBe(true);
    }
  });

  it('恰好 500 字的理由必須通過(上限是 <=,不是 <)', () => {
    expect(parseCorrectionForm(good({ [CORRECTION_REASON_FIELD]: '字'.repeat(500) })).ok).toBe(true);
  });

  it('解析出來的六個值逐格對上', () => {
    const parsed = parseCorrectionForm(good());
    expect(parsed).toEqual({
      ok: true,
      refundId: UUID_A,
      expectedCorrectionId: UUID_B,
      correctedTo: 'no_money_moved',
      reason: '對過 TapPay，這筆錢其實沒有動',
      requestToken: 'tok-0001',
    });
  });
});

describe('🔴 CAS 那一欄是【三態】,不是兩態', () => {
  it('不在席 ⇒ expectedCorrectionId = null(= 我看到的是尚未被更正過)', () => {
    const parsed = parseCorrectionForm(good({ [CORRECTION_EXPECTED_ID_FIELD]: undefined }));
    expect(parsed).toMatchObject({ ok: true, expectedCorrectionId: null });
  });

  it('🔴 而**空字串不是不在席** ⇒ 拒(送了這一欄卻送空 = 表單壞了)', () => {
    // 把它讀成「尚未更正過」⇒ 一個壞掉的表單會拿 NULL 去 CAS，而那可能真的成功。
    expect(parseCorrectionForm(good({ [CORRECTION_EXPECTED_ID_FIELD]: '' })).ok).toBe(false);
  });

  it('不是 uuid ⇒ 拒', () => {
    expect(parseCorrectionForm(good({ [CORRECTION_EXPECTED_ID_FIELD]: 'not-a-uuid' })).ok).toBe(
      false,
    );
  });
});

describe('🔴 空白字集:逐個 + 【組合】,而不是各測一個', () => {
  // DB 是 btrim(x, E' \t\r\n')；只測「一個空格」會漏掉「空格+Tab」那種。
  const chars = [...CORRECTION_DB_BLANK_CHARS];

  it.each(chars.map((c) => [JSON.stringify(c)] as const))('只有 %s 的理由 ⇒ 拒', (label) => {
    const c = JSON.parse(label) as string;
    expect(parseCorrectionForm(good({ [CORRECTION_REASON_FIELD]: c })).ok).toBe(false);
  });

  it('🔴 兩兩組合、以及四個全上 ⇒ 全部要拒', () => {
    const combos: string[] = [];
    for (const a of chars) for (const b of chars) combos.push(a + b);
    combos.push(chars.join(''));
    for (const combo of combos) {
      expect(
        parseCorrectionForm(good({ [CORRECTION_REASON_FIELD]: combo })).ok,
        `理由 = ${JSON.stringify(combo)} 應被拒`,
      ).toBe(false);
    }
    expect(combos.length).toBe(chars.length * chars.length + 1);
  });

  it('🔴 對照:空白【包著】真字 ⇒ 必須通過(btrim 只剝兩端,中間有字就不是空的)', () => {
    expect(parseCorrectionForm(good({ [CORRECTION_REASON_FIELD]: ' \t真的沒動\n' })).ok).toBe(true);
  });

  it('isDbBlank 對空字串為真、對一個字為假', () => {
    expect(isDbBlank('')).toBe(true);
    expect(isDbBlank('x')).toBe(false);
  });
});

describe('🔴 跨側:我的字集與上限,與 migration 寫的是同一組', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('正對照:那支 migration 真的有那兩條 CHECK(尺是活的)', () => {
    expect(sql).toContain("btrim(reason, E' \\t\\r\\n')");
    expect(sql).toContain('char_length(reason) <= 500');
  });

  it('我的 500 / 64 與 DB 的是同一個數', () => {
    expect(sql).toContain(`char_length(reason) <= ${CORRECTION_REASON_MAX}`);
    expect(sql).toContain(`char_length(request_id) <= ${CORRECTION_TOKEN_MAX}`);
  });

  it('🔴 負對照:一個編出來的上限比不到(證明上面那格不是「什麼都算有」)', () => {
    expect(sql).not.toContain('char_length(reason) <= 499');
  });
});

describe('其餘的拒法', () => {
  it.each([
    ['refund_id 不在席', { [CORRECTION_REFUND_ID_FIELD]: undefined }],
    ['refund_id 不是 uuid', { [CORRECTION_REFUND_ID_FIELD]: 'nope' }],
    ['verdict 不在值域', { [CORRECTION_VERDICT_FIELD]: 'maybe_moved' }],
    ['verdict 不在席', { [CORRECTION_VERDICT_FIELD]: undefined }],
    ['reason 不在席', { [CORRECTION_REASON_FIELD]: undefined }],
    ['reason 超過 500', { [CORRECTION_REASON_FIELD]: '字'.repeat(501) }],
    ['token 不在席', { [CORRECTION_REQUEST_TOKEN_FIELD]: undefined }],
    ['token 超過 64', { [CORRECTION_REQUEST_TOKEN_FIELD]: 'x'.repeat(65) }],
  ])('%s ⇒ 拒', (_label, over) => {
    expect(parseCorrectionForm(good(over)).ok).toBe(false);
  });

  it.each([...CORRECTION_SINGLE_FIELDS])('🔴 %s 送兩份 ⇒ 整張表單被拒(入口擋門)', (field) => {
    // 逐欄跑一遍才是那份清單完整性的守門 —— 漏列一欄沒有症狀。
    expect(parseCorrectionForm(good({ [field]: ['a', 'b'] })).ok).toBe(false);
  });
});
