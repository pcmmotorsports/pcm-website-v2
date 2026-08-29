// @vitest-environment jsdom
//
// CartQtyInput.test.tsx — 這支元件的**第一支專屬測試檔**。
//
// 🔴 為什麼要另開一支, 而不是加進 `CartView.test.tsx`:
//   ① `CartView.test.tsx` 現在**壓著線C 的 `#886` 診斷**(未 commit)—— 動它會撞車。
//   ② 更重要的是**分母**:那支測的是「購物車頁把數量框接對了沒」, 而本檔測的是
//      「這台輸入狀態機自己對不對」。兩個問題的失敗會指向不同的人。
//
// 🔴 而在本檔出現之前, 這支元件**沒有專屬測試** —— 唯一在斷言它行為的是 `CartView.test.tsx`
//   的兩格(餵 `'0'` 與 `'150'`)。數法(2026-08-24 當場跑):
//     `grep -rln "CartQtyInput\|useQtyInput" apps/storefront/src | grep "\.test\."` ⇒ 只命中 `CartView.test.tsx`
//
// 🔴 第一格刻意是【正對照】:一支新檔若沒被收進去, vitest 印 `Test Files (0)`,
//   而**那個 0 與「全部通過」在 exit code 上是同一個 0**。

import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { CartQtyInput } from './CartQtyInput';
import { MAX_QTY } from '@/contexts/CartContext';

afterEach(cleanup);

const setup = (qty: number) => {
  const onCommit = vi.fn();
  render(<CartQtyInput qty={qty} onCommit={onCommit} />);
  const input = screen.getByRole('textbox', { name: '數量' }) as HTMLInputElement;
  return { onCommit, input };
};

/** 清空 → 失焦(客人真的會做的那個動作)。 */
const clearThenBlur = (input: HTMLInputElement) => {
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
};

describe('CartQtyInput —— 正對照(先證明這支檔真的被跑到)', () => {
  it('渲染出數量框, 值等於傳進來的 qty', () => {
    const { input } = setup(3);
    expect(input.value).toBe('3');
  });

  it('打一個正常數字 ⇒ onCommit 收到它', () => {
    const { onCommit, input } = setup(3);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(7);
  });
});

describe('CartQtyInput —— 清空輸入框不得把數量吃掉', () => {
  // 🔴 本段守的是 `CartQtyInput.tsx` 的
  //   `const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QTY) : qty;`
  //   舊碼那個 else 是常數 `1` ⇒ 客人清空框再點別處, 那一列**從 8 件直接變 1 件, 零提示**。
  //
  // 🔴 **為什麼既有那兩格分不出修沒修**:`CartView.test.tsx` 餵的是 `'0'` 與 `'150'`,
  //   兩個都是有限數 ⇒ **走不到 else**;而它們的期望值剛好是 `1` 與 `99`。
  //   ⇒ 對「else 回 1 還是回 qty」零判別力。本段把 qty 推到 **8** 就是為了讓兩個世界印不同的東西。

  // 🔴 **2026-08-29 契約換了一次, 而【換的是宣稱不是期望值】**(Sean 拍甲, 逐字
  //    「什麼都不送,件數維持原樣」;選項字面是我們寫的, 他只打了甲):
  //    ⛔ ~~舊契約:`onCommit` 收到 8(不得是 1)~~ ⇒ 那已經達成「件數維持原樣」,
  //    🔴 而它仍然【送出去了】—— 而 `CartContext.updateQty` 值一樣也會產生新陣列 + 新物件
  //       ⇒ 重繪 + 寫 localStorage ⇒ **calls=1 與 calls=0 是觀察得到的兩件事**。
  //    ✅ 新契約:**一次都不呼叫**, 而框上的字仍然回到 `8`(客人看到的沒變)。
  it('🔴 qty=8 ⇒ 清空 ⇒ 失焦 ⇒ onCommit【一次都不呼叫】, 而框回到 8', () => {
    const { onCommit, input } = setup(8);
    clearThenBlur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('8'); // 框裡的字仍要收斂回去, 不能留空
  });

  it('🔴 同族的其他「不是數字」也一樣', () => {
    // ⚠️ 這個框的 `onChange` 會把非數字濾掉(`replace(/[^0-9]/g,'')`)⇒ 客人打 `abc` 進來時
    //   框裡本來就是空的。所以這一族在真實 UI 上**只有「空字串」一種形狀** ——
    //   而 `commit` 是純函式路徑, 直接餵空白仍值得釘住(它是 `parseInt` ⇒ NaN 的同一條路)。
    const { onCommit, input } = setup(6);
    fireEvent.change(input, { target: { value: '   ' } }); // 濾完仍是空
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled(); // ⛔ ~~toHaveBeenCalledWith(6)~~ 同上, 契約換了
    expect(input.value).toBe('6');
  });

  it('負對照:既有夾值行為一個字沒變(0 ⇒ 1、超上限 ⇒ 夾到上限 + 提示)', () => {
    // 🔴 少了這一格,「else 改成 qty」若順手把 clamp 弄壞了, 不會有東西紅。
    //   ⚠️ 這兩個案例**與 `CartView.test.tsx` 那兩格是同一件事** —— 刻意重複,
    //      因為那支現在壓著別人的未 commit 改動, 我不能靠它。
    const a = setup(5);
    fireEvent.change(a.input, { target: { value: '0' } });
    fireEvent.blur(a.input);
    expect(a.onCommit).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('status')).toBeNull(); // 0 不是超上限, 不該有提示

    cleanup();

    const b = setup(5);
    fireEvent.change(b.input, { target: { value: String(MAX_QTY + 51) } });
    fireEvent.blur(b.input);
    expect(b.onCommit).toHaveBeenCalledWith(MAX_QTY);
    expect(screen.getByRole('status')).toBeDefined(); // 夾值要明說, 不得靜默夾
  });

  it('負對照:加減鈕仍走原路(它們餵的是有限數, 不經過那條 else)', () => {
    const { onCommit } = setup(4);
    fireEvent.click(screen.getByRole('button', { name: '增加數量' }));
    expect(onCommit).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: '減少數量' }));
    expect(onCommit).toHaveBeenCalledWith(3);
  });
});
