import { describe, it, expect } from 'vitest';

import {
  normalizeOrderKeywordSearch,
  MAX_ORDER_KEYWORD_LENGTH,
  OrderKeywordSearchShapeError,
} from './keyword-search';

// keyword-search.test.ts — #347-2a domain 正規化。
//
// 🔴 本檔的每一組斷言都對應 `keyword-search.ts` 裡一條**有理由的**守門,
//    而不是「把函式的每一行走一次」。看得出「拿掉哪一行會讓哪一格紅」是驗收條件。
//
// ⚠️ 刻意**不**測「中文/`%`/`,` 會被擋掉」—— 那是反向的:本維度**必須放行**它們
//    (走 POST body、不進 URL);真的有人加了字元集守門,下面 `放行` 那組會轉紅。

/** migration `:179` 的 btrim 字元集,逐顆。用 `\u` 逃脫寫,不在原始碼放隱形字元。 */
const TRIM_CHARS = [
  ['半形空格', ' '],
  ['tab', '\u0009'],
  ['CR', '\u000d'],
  ['LF', '\u000a'],
  ['全形空白 U+3000', '\u3000'],
  ['不斷行空格 U+00A0', '\u00a0'],
  ['窄不斷行空格 U+202F', '\u202f'],
  ['零寬空格 U+200B', '\u200b'],
  ['BOM U+FEFF', '\ufeff'],
] as const;

describe('normalizeOrderKeywordSearch — empty(不篩選)', () => {
  it('非字串 → empty', () => {
    expect(normalizeOrderKeywordSearch(undefined)).toEqual({ kind: 'empty' });
    expect(normalizeOrderKeywordSearch(null)).toEqual({ kind: 'empty' });
  });

  it.each(TRIM_CHARS)('🔴 只有「%s」也算空 → empty(不是零筆)', (_name, ch) => {
    expect(normalizeOrderKeywordSearch(ch)).toEqual({ kind: 'empty' });
    expect(normalizeOrderKeywordSearch(ch + ch + ch)).toEqual({ kind: 'empty' });
  });

  it('🔴🔴 零寬空格 U+200B 是 JS `.trim()` 清不掉的那一顆 —— 這格釘住我們沒有偷用 trim()', () => {
    // 前提斷言:證明 `.trim()` 真的清不掉它。這條若哪天不成立,下一行就不再有判別力。
    expect('\u200b'.trim()).toBe('\u200b');
    // 而我們必須清得掉 —— 否則「貼上一顆零寬空格」會變成搜尋、RPC 回空 ⇒ 畫面「查無此單」,
    // 正確答案卻是「沒有搜尋 = 列出全部訂單」。
    expect(normalizeOrderKeywordSearch('\u200b')).toEqual({ kind: 'empty' });
  });

  it('修剪只切頭尾、不動中間(「王 小明」中間那格空白是搜尋詞的一部分)', () => {
    expect(normalizeOrderKeywordSearch('\u3000王 小明\u200b')).toEqual({
      kind: 'ok',
      value: '王 小明',
    });
  });
});

describe('normalizeOrderKeywordSearch — 放行(本維度沒有字元集守門)', () => {
  // 🔴 這一組是「反向守門」:有人照抄 A9b1/A9b2 的字元集限制過來,這裡就會紅。
  it.each([
    ['中文姓名', '王小明'],
    ['百分號(strpos 下不是萬用字元)', '100%'],
    ['底線(同上)', 'ABC_123'],
    ['逗號與括號(PostgREST 保留字元,但我們走 POST body)', 'PO(2026),A'],
    ['雙引號與反斜線', 'a"b\\c'],
    ['emoji', '\u{1f6f5}'],
    ['日文品名', 'アクラポヴィッチ'],
  ])('放行:%s', (_name, input) => {
    expect(normalizeOrderKeywordSearch(input)).toEqual({ kind: 'ok', value: input });
  });

  it('🔴 不轉大小寫(RPC 自己 lower();在這裡先折會製造第二個真相源)', () => {
    expect(normalizeOrderKeywordSearch('AkRaPoViC')).toEqual({ kind: 'ok', value: 'AkRaPoViC' });
  });
});

describe('normalizeOrderKeywordSearch — bad_char(擋住會讓整頁進錯誤態的字元)', () => {
  it('🔴 NUL:PG 的 text 存不下(22021)⇒ 不擋的話是整個列表壞掉,不是「查無此單」', () => {
    expect(normalizeOrderKeywordSearch('王\u0000明')).toMatchObject({
      kind: 'invalid',
      reason: 'bad_char',
    });
  });

  it('🔴 落單高位代理:PG 解 JSON 時拒收(fetch 送得出去,炸在 DB 那端)', () => {
    expect(normalizeOrderKeywordSearch('a\ud800b')).toMatchObject({
      kind: 'invalid',
      reason: 'bad_char',
    });
  });

  it('🔴 落單低位代理(同族、方向相反)', () => {
    expect(normalizeOrderKeywordSearch('a\udc00b')).toMatchObject({
      kind: 'invalid',
      reason: 'bad_char',
    });
  });

  it('🔴 成對的代理**不得**被誤殺 —— 否則所有 emoji 與罕用漢字都搜不到', () => {
    // '😅' = 一顆合法 emoji;若守門寫成「含任何 D800-DFFF」就會在這格轉紅。
    expect(normalizeOrderKeywordSearch('a😅b')).toEqual({
      kind: 'ok',
      value: 'a😅b',
    });
  });

  it('🔴 又超長又含 NUL → 回 bad_char 不回 too_long(砍短了還是會失敗,說 too_long 是在騙人)', () => {
    const poisoned = 'x'.repeat(MAX_ORDER_KEYWORD_LENGTH + 50) + '\u0000';
    expect(normalizeOrderKeywordSearch(poisoned)).toMatchObject({
      kind: 'invalid',
      reason: 'bad_char',
    });
  });
});

describe('normalizeOrderKeywordSearch — too_long(鏡射 RPC 的 120 閘)', () => {
  it(`剛好 ${MAX_ORDER_KEYWORD_LENGTH} 個 code point → ok(邊界內側)`, () => {
    const s = 'a'.repeat(MAX_ORDER_KEYWORD_LENGTH);
    expect(normalizeOrderKeywordSearch(s)).toEqual({ kind: 'ok', value: s });
  });

  it(`${MAX_ORDER_KEYWORD_LENGTH + 1} 個 code point → too_long(邊界外側)`, () => {
    expect(normalizeOrderKeywordSearch('a'.repeat(MAX_ORDER_KEYWORD_LENGTH + 1))).toMatchObject({
      kind: 'invalid',
      reason: 'too_long',
    });
  });

  it('🔴🔴 emoji:數 code point 不是數 UTF-16 code unit —— 用 `.length` 的話這格會紅', () => {
    // 61 顆 emoji:JS `.length` = 122(> 120,會被誤判太長)、code point = 61(合法)。
    const s = '\u{1f6f5}'.repeat(61);
    expect(s.length).toBe(122); // 前提斷言:證明這組輸入真的能分辨兩種數法
    expect(Array.from(s).length).toBe(61);
    expect(normalizeOrderKeywordSearch(s)).toEqual({ kind: 'ok', value: s });
  });

  it('🔴 too_long 的 input 截到 MAX+1、不是 MAX ⇒ 再正規化必然**仍是** too_long', () => {
    const first = normalizeOrderKeywordSearch('a'.repeat(500));
    expect(first.kind).toBe('invalid');
    if (first.kind !== 'invalid') throw new Error('unreachable');
    expect(Array.from(first.input).length).toBe(MAX_ORDER_KEYWORD_LENGTH + 1);
    // 🔴 這一句才是重點:呼叫鏈真的會再跑一次正規化(2b 把 input 放回 filter → adapter 重跑)。
    //    截到剛好 MAX 的話,第二次會變成 `ok` ⇒ 橫幅說「太長」、列表卻顯示前 120 字的真實命中。
    expect(normalizeOrderKeywordSearch(first.input)).toMatchObject({
      kind: 'invalid',
      reason: 'too_long',
    });
  });

  it('🔴 截斷不得切在代理對中間(切壞了會自己造出一顆落單代理毒值)', () => {
    const s = '\u{1f6f5}'.repeat(300);
    const r = normalizeOrderKeywordSearch(s);
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') throw new Error('unreachable');
    // 切壞的話這個 input 自己會被 bad_char 擋下 —— 用「再正規化的 reason」當觀察點,
    // 比直接檢查字串裡有沒有落單代理更貼近真正會壞掉的那件事。
    expect(normalizeOrderKeywordSearch(r.input)).toMatchObject({ reason: 'too_long' });
  });
});

describe('OrderKeywordSearchShapeError', () => {
  it('🔴 訊息只含結構描述、不得含搜尋詞(它會進 server log,而搜尋詞是 PII)', () => {
    const e = new OrderKeywordSearchShapeError('ids 不是陣列(拿到 string)');
    expect(e.code).toBe('order_keyword_search_bad_shape');
    expect(e.name).toBe('OrderKeywordSearchShapeError');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('ids 不是陣列');
  });
});
