import { describe, expect, it } from 'vitest';
import { describeSupplierMatch } from './supplier-match-notice';

// #338:三態提示的語意守門。畫面只排版,判斷全在這裡 ⇒ 突變靶也都打在這支。

const s = (id: string, label: string | null) => ({ id, label });

describe('describeSupplierMatch — #338', () => {
  it('🔴 恰一家 ⇒ 具名(這就是本片要回答的那個問題)', () => {
    expect(describeSupplierMatch([s('a', 'Akrapovič')], true)).toEqual({
      kind: 'single',
      label: 'Akrapovič',
    });
  });

  it('🔴 兩家以上 ⇒ 示警並列名(真正會出事的情況)', () => {
    const res = describeSupplierMatch([s('a', 'A 商行'), s('b', 'B 貿易')], true);
    expect(res).toEqual({ kind: 'multiple', labels: ['A 商行', 'B 貿易'] });
  });

  it('🔴 `null` = 這次不是供應商單號搜尋 ⇒ 什麼都不顯示', () => {
    // 突變:把 `null` 也當成 unknown ⇒ 每一次一般搜尋都會冒出「不區分供應商」的警語。
    expect(describeSupplierMatch(null, true)).toEqual({ kind: 'none' });
  });

  it('🔴 空清單(查過了、一家都認不出來)⇒ unknown,不是 none', () => {
    // 兩者不可互換:none 是「不該說話」,unknown 是「要說我不知道」。
    expect(describeSupplierMatch([], true)).toEqual({ kind: 'unknown' });
  });

  it('🔴 有任何一家沒有名字 ⇒ 整組 unknown,不做半吊子顯示', () => {
    // 突變:改成「濾掉沒名字的、剩下的照常顯示」⇒ 這格紅。
    // 那個突變的實害:兩家命中、其中一家沒名字 ⇒ 畫面顯示「屬於供應商 A」= **少報**,
    // 而少報正是本條 backlog 的傷害本身(員工放心登錄,實際上還有 B 家)。
    expect(describeSupplierMatch([s('a', 'A 商行'), s('b', null)], true)).toEqual({
      kind: 'unknown',
    });
    expect(describeSupplierMatch([s('a', null)], true)).toEqual({ kind: 'unknown' });
  });

  it('🔴 畫面零筆 ⇒ 什麼都不說(該說話的是「查無此單」那條路徑)', () => {
    expect(describeSupplierMatch([s('a', 'A 商行')], false)).toEqual({ kind: 'none' });
  });
});
