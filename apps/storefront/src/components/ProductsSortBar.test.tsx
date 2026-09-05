// @vitest-environment jsdom
//
// ProductsSortBar — 件數那一行的三態。
// 🔬 **為什麼有這支檔**:⟦search-CATSWITCHSLOW⟧ ①。正式站量到切一個分類要等 **3.4-6.3 秒**
//   (正本 `~/pcm-mailbox/量-抽屜正式站-20260906.md`), 而這段期間畫面完全不動
//   ⇒ 客人以為壞掉。這一行是他**唯一**看得到「有沒有在動」的地方(商品格線只是變淡)。
// 🛑 **本檔證的是「他看得見」, 不是「它變快了」** —— 它一秒都沒變快。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProductsSortBar } from './ProductsSortBar';

afterEach(cleanup);

const base = { gridCols: 0, setGridCols: vi.fn(), sort: 'default', setSort: vi.fn() };

describe('ProductsSortBar 件數那一行', () => {
  it('🔴 isPending:原地換成「更新中…」, 而【舊件數不准印】', () => {
    // 🔵 在「把 isPending 排在 count 後面」的世界會紅 —— 那時 128 會贏。
    // 📌 為什麼舊件數不能印:那幾秒裡 count 還是舊的 ⇒ 印它看起來像「算完了而數字沒變」,
    //    比印「更新中…」糟(客人會停止等待)。
    render(<ProductsSortBar {...base} count={128} isPending />);
    expect(screen.getByText('更新中…')).toBeDefined();
    expect(screen.queryByText('128 件商品')).toBeNull();
  });

  it('🟢 正對照:沒在飛就照印件數(證明上面那格不是恆真)', () => {
    // 🛑 少了這一格,「永遠顯示更新中…」也會讓上面那格綠。
    render(<ProductsSortBar {...base} count={128} isPending={false} />);
    expect(screen.getByText('128 件商品')).toBeDefined();
    expect(screen.queryByText('更新中…')).toBeNull();
  });

  it('🔵 沒傳 isPending = 舊行為逐字相同(預設 false)', () => {
    // 📌 守的是「加一個 optional prop 不得改變任何既有呼叫端的行為」。
    render(<ProductsSortBar {...base} count={7} />);
    expect(screen.getByText('7 件商品')).toBeDefined();
  });

  it('🔵 回歸:count 為 null 時仍印「件數未能載入」, 而它排在 isPending 之後', () => {
    // ⚠️ 三態的順序是 isPending > null > 數字;這一格釘住【後兩態沒有被新分支吃掉】。
    render(<ProductsSortBar {...base} count={null} />);
    expect(screen.getByText('件數未能載入')).toBeDefined();
  });

  it('🔴 而 isPending 要贏過 null(撈不到 + 正在飛 ⇒ 印更新中, 不印失敗)', () => {
    // 📌 印「件數未能載入」會讓客人以為壞了, 而其實只是還沒回來。
    render(<ProductsSortBar {...base} count={null} isPending />);
    expect(screen.getByText('更新中…')).toBeDefined();
    expect(screen.queryByText('件數未能載入')).toBeNull();
  });
});
