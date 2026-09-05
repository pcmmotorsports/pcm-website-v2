import { describe, expect, it } from 'vitest';
import { TAX_EXCLUSIVE_SUFFIX, subtotalLabelOf } from './subtotal-label';

describe('subtotalLabelOf:「小計」在有稅時要說得出自己是未稅的', () => {
  // 🔴 **兩個世界要印不同的東西** —— 而這一族的病正是「兩個世界印同一個標籤」。
  it('稅 0 ⇒ 維持原字面(今天每一張單都走這條)', () => {
    expect(subtotalLabelOf('小計', 0)).toBe('小計');
    expect(subtotalLabelOf('商品小計', 0)).toBe('商品小計');
  });

  it('稅 > 0 ⇒ 加上未稅後綴', () => {
    expect(subtotalLabelOf('小計', 1)).toBe('小計(未稅)');
    expect(subtotalLabelOf('商品小計', 250)).toBe('商品小計(未稅)');
  });

  it('🔴 負數不算「有稅」—— 那是上游壞了, 不該被讀成有稅', () => {
    expect(subtotalLabelOf('小計', -1)).toBe('小計');
  });

  it('🔴 後綴的括號是【半形】—— 而這不是我挑的, 是去量拍板字面量到的', () => {
    // ⛔ ~~我第一版斷言【全形】並讓它紅了一次~~ —— 而**紅得好**:它逼我去量真權威。
    // 🔬 量法(字面值三來源律 ①):`docs/launch-todo.md` 裡 Sean 2026-09-04 拍甲那句,
    //    正則掃「小計.{0,1}未稅.{0,1}」⇒ **2 處, 兩處都是** ['0x28','0x672a','0x7a05','0x29']
    //    ⇒ 半形 `(` `)`。
    // 🛑 **為什麼要有這一格**:全形與半形括號在畫面上**幾乎看不出差別**,
    //    而它會讓五個面之間出現一個沒有人看得見的不一致。
    expect(TAX_EXCLUSIVE_SUFFIX.charCodeAt(0)).toBe(0x28);
    expect(TAX_EXCLUSIVE_SUFFIX.charCodeAt(TAX_EXCLUSIVE_SUFFIX.length - 1)).toBe(0x29);
    // 🔵 負對照:全形那一版**必須不等於**它(否則上面兩格對「隨便哪種括號」都會過)。
    expect(TAX_EXCLUSIVE_SUFFIX).not.toBe(String.fromCharCode(0xff08) + '未稅' + String.fromCharCode(0xff09));
  });

  it('🔴 負對照:基底字面原樣帶出去, 本函式不改它', () => {
    expect(subtotalLabelOf('隨便什麼字', 0)).toBe('隨便什麼字');
    expect(subtotalLabelOf('隨便什麼字', 5)).toBe('隨便什麼字(未稅)');
  });
});
