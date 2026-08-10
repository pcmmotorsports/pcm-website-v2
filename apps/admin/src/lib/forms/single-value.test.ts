import { describe, expect, it } from 'vitest';

import { readSingle, readSingleString, type SingleValueFormLike } from './single-value';

/** 直接吃真 `FormData`(它天生有 `getAll`),避免用假物件把被測行為造出來。 */
function form(pairs: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of pairs) f.append(k, v);
  return f;
}

describe('#365 單值欄位讀法', () => {
  it('恰一筆字串 → value', () => {
    expect(readSingle(form([['amount', '2']]), 'amount')).toEqual({ kind: 'value', value: '2' });
    expect(readSingleString(form([['amount', '2']]), 'amount')).toBe('2');
  });

  it('沒送 → missing(選填欄位靠這個與「送壞了」分開)', () => {
    expect(readSingle(form([]), 'amount')).toEqual({ kind: 'missing' });
    expect(readSingleString(form([]), 'amount')).toBeNull();
  });

  // 🔴 本模組存在的唯一理由:這一格。
  it('🔴 送兩份 → invalid,而且**不是**採第一筆', () => {
    const two = form([
      ['amount', '2'],
      ['amount', '5'],
    ]);
    expect(readSingle(two, 'amount')).toEqual({ kind: 'invalid' });
    expect(readSingleString(two, 'amount')).toBeNull();
    // 反向釘死:舊寫法(get)在同一份 FormData 上會拿到 '2' ——
    // 這行證明「兩者行為真的不同」,不是我換了一個等價寫法。
    expect(two.get('amount')).toBe('2');
  });

  it('🔴 順序互換仍 invalid(避免只擋住某一種排法)', () => {
    const swapped = form([
      ['amount', '5'],
      ['amount', '2'],
    ]);
    expect(readSingleString(swapped, 'amount')).toBeNull();
    expect(swapped.get('amount')).toBe('5');
  });

  it("送一筆空字串 → value:''(不是 missing —— 選填欄位的『有送但留空』要分得出來)", () => {
    expect(readSingle(form([['note', '']]), 'note')).toEqual({ kind: 'value', value: '' });
    expect(readSingleString(form([['note', '']]), 'note')).toBe('');
  });

  it('非字串(檔案)→ invalid,不當成空字串放行', () => {
    const f = new FormData();
    f.append('doc', new File(['x'], 'x.txt'));
    expect(readSingle(f, 'doc')).toEqual({ kind: 'invalid' });
  });

  it('只依賴 getAll —— 假表單只要有這一支就吃得下', () => {
    const fake: SingleValueFormLike = { getAll: (name) => (name === 'k' ? ['v'] : []) };
    expect(readSingleString(fake, 'k')).toBe('v');
    expect(readSingleString(fake, 'other')).toBeNull();
  });
});
