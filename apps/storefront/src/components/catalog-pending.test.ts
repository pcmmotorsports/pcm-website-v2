// catalog-pending.test.ts — ⟦search-CATSWITCHSLOW⟧ 訊號來源的**逐格**守門。
//
// 🔴 **為什麼這支與 `ProductsPage.test.tsx` 那 4 格【不重複】**(兩個分母,不是同一個):
//   · 這支問「**算得對不對**」—— 純函式、可以逐格餵到每一條分支。
//   · `ProductsPage.test.tsx` 那 4 格問「**它會不會被叫、畫面會不會變**」——
//     真 DOM、斷言 `更新中…` / `is-loading` / `inert`。
//   一支綠了另一支照樣可以紅(memory `feedback_a-guard-has-two-denominators`:
//   「它掃得到嗎 / 它會被叫嗎」是兩件事)。

import { describe, expect, it } from 'vitest';
import { isCatalogPending } from './catalog-pending';

const TREE = [
  { id: 'carbon', name: '碳纖維部品', count: 12, children: [] },
  {
    id: 'cool',
    name: '引擎與冷卻',
    count: 690,
    children: [{ id: 'hose', name: '水管束環', count: 690 }],
  },
];
const sp = (q: string) => new URLSearchParams(q);

describe('isCatalogPending', () => {
  it('🔴 cascade 有分類而網址還沒換 ⇒ true(這就是客人在等的那幾秒)', () => {
    expect(isCatalogPending({ main: '碳纖維部品' }, sp(''), TREE)).toBe(true);
  });

  it('🔵 cascade 沒有分類 ⇒ false —— 入站水合那一波不可以誤報', () => {
    expect(isCatalogPending(null, sp('category=碳纖維部品'), TREE)).toBe(false);
  });

  it('🔵 網址追上了 ⇒ false', () => {
    expect(isCatalogPending({ main: '碳纖維部品' }, sp('category=碳纖維部品'), TREE)).toBe(false);
  });

  it('🔴 兩層分類:網址是【正規形】(大類 · 子類)⇒ false', () => {
    expect(
      isCatalogPending({ main: '引擎與冷卻', sub: '水管束環' }, sp('category=引擎與冷卻 · 水管束環'), TREE),
    ).toBe(false);
  });

  it('🛑 兩層分類:網址是【裸子分類短名】⇒ 仍是 false(逐字比會變成一盞永遠亮著的燈)', () => {
    expect(isCatalogPending({ main: '引擎與冷卻', sub: '水管束環' }, sp('category=水管束環'), TREE)).toBe(false);
  });

  it('🔴 多顆世界:剛選的那一顆【已經在 categories= 裡】⇒ false', () => {
    expect(
      isCatalogPending({ main: '碳纖維部品' }, sp('categories=引擎與冷卻,碳纖維部品'), TREE),
    ).toBe(false);
  });

  it('🔴 多顆世界:剛選的那一顆【還沒進 categories=】⇒ true', () => {
    expect(isCatalogPending({ main: '碳纖維部品' }, sp('categories=引擎與冷卻'), TREE)).toBe(true);
  });

  it('🔵 categories= 的值有空白 ⇒ 照樣認得出來(url-sync 寫的是 join(",") 而讀的人不該假設)', () => {
    expect(
      isCatalogPending({ main: '碳纖維部品' }, sp('categories=引擎與冷卻, 碳纖維部品'), TREE),
    ).toBe(false);
  });

  it('🛑 已知、刻意留著的 fail-open:多顆世界底下舊 category= 殘留值恰等於新選那顆 ⇒ false(少閃一次回饋)', () => {
    // 🔵 這一格**不是在慶祝**, 它是把「我們選了哪一種錯」釘住:
    //   改成「有 categories= 就只看 categories=」會製造相反方向的錯 —— 一盞永遠亮著的燈。
    //   理由全文在 catalog-pending.ts 檔尾。這一格會在有人「順手修掉」時紅, 而那正是它的用途。
    expect(
      isCatalogPending({ main: '碳纖維部品' }, sp('categories=引擎與冷卻&category=碳纖維部品'), TREE),
    ).toBe(false);
  });
});
