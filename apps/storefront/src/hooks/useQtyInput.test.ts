// @vitest-environment jsdom
//
// useQtyInput.test.ts — 這支 hook 的**第一支測試檔**。
//
// 🔴 為什麼「第一支」這件事要寫在檔頭:
//   本 hook 是 `#888` 從 `ProductInfo.tsx` 搬出來的(commit `6bf774a6`),而搬之前它在
//   400 行元件裡、搬之後它獨立成檔 —— **兩個狀態下它都沒有任何測試直接看著它。**
//   數法(2026-08-24 當場跑):
//     `grep -rln "CartQtyInput\|useQtyInput" apps/storefront/src | grep "\.test\."` ⇒ 只命中
//     `CartView.test.tsx`,而那支測的是 `CartQtyInput`(另一份), **不是本 hook**。
//   ⇒ 也就是說:在本檔出現之前, 改壞這支 hook **不會有任何東西變紅**。
//
// 🔴 所以第一格刻意是【正對照】, 不是要測的那件事:
//   一支新測試檔若因為設定/命名問題整支沒被收進去, vitest 會印 `Test Files (0)` —— 而
//   **那個 0 與「全部通過」在 exit code 上是同一個 0**。放一格必綠的基本行為在最前面,
//   是為了讓「這支檔真的有被跑到」這件事**看得出來**, 而不是靠相信。

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useQtyInput } from './useQtyInput';
import { MAX_QTY } from '@/contexts/CartContext';

describe('useQtyInput —— 正對照(先證明這支檔真的被跑到)', () => {
  it('初始值:qty=1、qtyText="1"、沒有提示', () => {
    const { result } = renderHook(() => useQtyInput());
    expect(result.current.qty).toBe(1);
    expect(result.current.qtyText).toBe('1');
    expect(result.current.qtyNotice).toBeNull();
  });

  it('打一個正常數字 ⇒ 收斂寫回 qty', () => {
    const { result } = renderHook(() => useQtyInput());
    act(() => result.current.commitQty('7'));
    expect(result.current.qty).toBe(7);
    expect(result.current.qtyText).toBe('7');
  });
});

describe('useQtyInput —— 清空輸入框不得把數量吃掉', () => {
  // 🔴 本段守的是這一行:`useQtyInput.ts` 的
  //   `const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QTY) : qty;`
  //   舊碼那個 else 是常數 `1`。
  //
  // 🔴 **為什麼既有測試分不出修沒修**:唯一在看這一族行為的兩格(`CartView.test.tsx`)
  //   餵的是 `'0'` 與 `'150'` —— 那兩個都是**有限數**, 走不到 else;而它們的期望值剛好是
  //   `1` 與 `99`。⇒ 對「else 回 1 還是回 qty」**零判別力**。
  //   本段刻意把 qty 先推到 **8**, 就是為了讓兩個世界印不同的東西(8 vs 1)。

  it('🔴 qty=8 ⇒ 清空 ⇒ 失焦 ⇒ 仍是 8, 不得掉回 1', () => {
    const { result } = renderHook(() => useQtyInput());
    act(() => result.current.commitQty('8'));
    expect(result.current.qty).toBe(8); // 前置條件成立才有判別力

    act(() => result.current.commitQty('')); // 清空後失焦
    expect(result.current.qty).toBe(8);
    expect(result.current.qtyText).toBe('8'); // 框裡的字也要被收斂回去, 不能留空
  });

  it('🔴 同族的其他「不是數字」也一樣(空白 / 純文字 / 只有減號)', () => {
    // `Number.parseInt` 對這三個都回 NaN ⇒ 走同一條 else。
    // ⚠️ 而 `'-5'` **不在這一族**:它 parse 得出 -5(有限數)⇒ 走 clamp ⇒ 被 max(,1) 拉回 1。
    //    那是既有行為, 本片不改。
    for (const raw of ['   ', 'abc', '-']) {
      const { result } = renderHook(() => useQtyInput());
      act(() => result.current.commitQty('6'));
      act(() => result.current.commitQty(raw));
      expect(result.current.qty, `輸入 ${JSON.stringify(raw)}`).toBe(6);
    }
  });

  it('負對照:既有的夾值行為一個字都沒變(0 ⇒ 1、超上限 ⇒ 夾到上限 + 提示)', () => {
    // 🔴 少了這一格,「else 改成 qty」若順手把 clamp 也弄壞了, 不會有東西紅。
    const { result } = renderHook(() => useQtyInput());
    act(() => result.current.commitQty('0'));
    expect(result.current.qty).toBe(1);
    expect(result.current.qtyNotice).toBeNull(); // 0 不是超上限, 不該有提示

    act(() => result.current.commitQty(String(MAX_QTY + 51)));
    expect(result.current.qty).toBe(MAX_QTY);
    expect(result.current.qtyNotice).not.toBeNull(); // 夾值要明說, 不得靜默夾
  });

  it('負對照:`-5` 仍走 clamp 回 1(它 parse 得出來, 不屬於 NaN 那一族)', () => {
    const { result } = renderHook(() => useQtyInput());
    act(() => result.current.commitQty('9'));
    act(() => result.current.commitQty('-5'));
    expect(result.current.qty).toBe(1);
  });
});
