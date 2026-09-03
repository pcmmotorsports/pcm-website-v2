import { describe, expect, it } from 'vitest';
import { foldSearchTerm, foldEquals, foldStartsWith } from './search-terms-fold';

// ⟦search-CAPSULEPARSE⟧ 2026-09-03
describe('foldSearchTerm — 格式折平(不是語意)', () => {
  // 🔴🔴 **本檔最重要的一格,而它是為了一個【我真的犯過】的錯而存在。**
  //    第一版的 fold 用 `[^A-Za-z0-9]` ⇒ 把中文也剝掉 ⇒ `fold('油箱貼')` = `''`
  //    ⇒ 而 `''.startsWith('')` 是 true ⇒ **每個中文詞都命中每個分類** ⇒ 印出一排假 ✅。
  //    🛑 而那排 ✅ **是好消息形狀的**(「字典幾乎不用做」)⇒ 沒有人會回頭查。
  it.each(['油箱貼', '排氣管', '碳纖維部品', '駐車架'])(
    '🔴🔴 純中文「%s」折完【不得是空字串】',
    (cjk) => {
      expect(foldSearchTerm(cjk), '折成空字串 ⇒ 它會命中每一個東西').not.toBe('');
      // 🎯 而且中文字本身要原封不動 —— 只剝標點與變音符號。
      expect(foldSearchTerm(cjk)).toBe(cjk);
    },
  );

  it('🔵 大小寫 / 連字號 / 空白 折成同一個', () => {
    const want = 'MT07';
    for (const typed of ['mt07', 'MT-07', 'mt 07', 'Mt_07', 'M T - 0 7']) {
      expect(foldSearchTerm(typed), `打法 ${typed}`).toBe(want);
    }
  });

  // 🔴 變音符號那一族 —— Sean 打的是 `akrapovic`, 而目錄裡是 `AKRAPOVIČ`。
  it.each([
    ['AKRAPOVIČ', 'AKRAPOVIC'],
    ['Öhlins', 'OHLINS'],
    ['Brembo', 'BREMBO'],
  ])('🔵 剝變音符號:%s ⇒ %s', (raw, want) => {
    expect(foldSearchTerm(raw)).toBe(want);
  });
});

describe('foldEquals / foldStartsWith — 空的一律不算命中', () => {
  // 🛑 這一族擋的是「折完是空字串」那個世界 —— 就算 fold 哪天被改壞, 這裡也不放行。
  it.each(['', '   ', '---', '...', '()'])(
    '🔴 純標點/空白「%s」⇒ 不得與任何東西相等',
    (junk) => {
      expect(foldEquals(junk, 'MT-07')).toBe(false);
      expect(foldStartsWith('MT-07', junk), '空前綴會命中每一個候選').toBe(false);
    },
  );

  // 🔴🔴 **這一格是突變逼出來的,而過程值得寫下來。**
  //    我原本只餵「一邊是空的」(`foldEquals('---', 'MT-07')`)⇒ 而那**兩種實作都回 false**
  //    (`'' === 'MT07'` 本來就不相等)⇒ 📌 **拿掉守衛那一發突變【全綠】。**
  //    ⇒ 🎯 而真正需要守衛的是**兩邊都折成空**的那個世界:
  //      `foldEquals('---', '...')` ⇒ 沒有守衛時 `'' === ''` ⇒ **true**(兩個垃圾互相「相等」)
  //    ⇒ ⇒ 📌 **又一次「我的測試到不了它要測的那一行」** —— 而告訴我的是突變, 不是我更仔細。
  it.each([
    ['兩邊都是純標點', '---', '...'],
    ['兩邊都是空白', '', '   '],
    ['括號 vs 連字號', '(())', '--'],
  ])(
    '🔴🔴 %s ⇒ **不得相等**(兩邊折完都是空的)',
    (_l, a, b) => {
      expect(foldEquals(a, b), '兩個折完是空的東西互相相等 ⇒ 垃圾會命中垃圾').toBe(false);
    },
  );

  it('🔵 正對照:真的相等時要回 true(否則上面那些 false 沒有判別力)', () => {
    expect(foldEquals('mt07', 'MT-07')).toBe(true);
    expect(foldEquals('akrapovic', 'AKRAPOVIČ')).toBe(true);
  });

  it('🔵 負對照:不同的東西不得相等', () => {
    expect(foldEquals('mt07', 'MT-09')).toBe(false);
    expect(foldEquals('油箱貼', '油箱止滑貼'), '這一種要靠字典, 不是 fold').toBe(false);
  });

  // 🔴 前綴不是子字串 —— 理由與料號那片同一個。
  it('🔴 是【前綴】不是【子字串】', () => {
    expect(foldStartsWith('AB-123', 'ab123')).toBe(true);
    expect(foldStartsWith('GRAB-123MM', 'ab123'), '子字串會中而前綴不該中').toBe(false);
  });
});
