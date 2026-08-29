import { describe, expect, it } from 'vitest';

import {
  assertAnchorsAlive,
  blankPages,
  hasAnchor,
  moneyPagesWithoutItems,
  type PageAnchors,
} from './page-invariants';

const A: PageAnchors = { item: 'SKU-', money: '訂單金額' };

// 🔴 三個世界都是 2026-08-29 線G 在真的 PDF 上量到的形狀,不是編出來的:
//    5 項 ⇒ 1 頁 ／ 6 項 ⇒ p2 全空 ／ 7 項 ⇒ p2 只有金額 + QR。
const CHROME = '出貨明細單  2026/8/29  第 N 頁 / 共 M 頁';
const W5 = [`${CHROME} SKU-0000 SKU-0001 SKU-0004 訂單金額 1,558,454`];
const W6 = [`${CHROME} SKU-0000 SKU-0005 訂單金額 445,098`, `${CHROME}`];
const W7 = [`${CHROME} SKU-0000 SKU-0006`, `${CHROME} 加入官方 LINE 訂單金額 1,558,454`];

describe('🔴 錨要 NFKC —— 沒有這一格,整道守門恆綠', () => {
  it('PDF 抽出來的「⾦」(U+2FA6 康熙部首)要能命中原始碼的「金」(U+91D1)', () => {
    const fromPdf = '加入官方 LINE 訂單⾦額 1,558,454';
    // 🔴 先證明【不正規化就是不相等】—— 沒有這一格,下面那個 true 可能只是因為兩邊本來就一樣
    expect(fromPdf.includes('訂單金額')).toBe(false);
    expect(hasAnchor(fromPdf, '訂單金額')).toBe(true);
  });

  it('負對照:一個真的不在的字串仍然要回 false(正規化沒有把它變成萬用鑰匙)', () => {
    expect(hasAnchor('加入官方 LINE 訂單⾦額', 'ZZQ8842NOTHERE')).toBe(false);
  });
});

describe('🔴 正對照:錨死掉要先被擋下來', () => {
  it('錨打錯 ⇒ 指名道姓說哪一個死了', () => {
    const dead = assertAnchorsAlive(W7, { item: 'ZZQ8842-', money: '訂單金額' });
    expect(dead).toHaveLength(1);
    expect(dead[0]).toContain('品項錨');
  });

  it('兩個錨都活著 ⇒ 空陣列', () => {
    expect(assertAnchorsAlive(W7, A)).toEqual([]);
    expect(assertAnchorsAlive(W5, A)).toEqual([]);
  });
});

describe('守門一 · 每一頁都必須有東西(抓「多印一張白紙」)', () => {
  it('🔴 6 項那個世界:第 2 頁全空 ⇒ 指出頁碼 2', () => {
    expect(blankPages(W6, A)).toEqual([2]);
  });

  it('5 項(好的世界)⇒ 不誤報', () => {
    expect(blankPages(W5, A)).toEqual([]);
  });

  it('🔴 7 項那個世界【它抓不到】—— 這一格是刻意的,它證明兩道都要裝', () => {
    // p2 有金額 ⇒ 守門一認為那一頁有東西。而那一頁上沒有任何品項,那是守門二的事。
    expect(blankPages(W7, A)).toEqual([]);
  });
});

describe('守門二 · 錢不可以跟品項分家', () => {
  it('🔴 7 項那個世界:金額在 p2 而 p2 零品項 ⇒ 指出頁碼 2', () => {
    expect(moneyPagesWithoutItems(W7, A)).toEqual([2]);
  });

  it('5 項(好的世界)⇒ 不誤報', () => {
    expect(moneyPagesWithoutItems(W5, A)).toEqual([]);
  });

  it('🔴 6 項那個世界【它抓不到】—— 同上,兩道各抓一個病', () => {
    // 金額與品項都在 p1 ⇒ 它認為沒分家。而 p2 是一張白紙,那是守門一的事。
    expect(moneyPagesWithoutItems(W6, A)).toEqual([]);
  });
});

describe('🔴 兩道合起來才蓋得住三個世界(把上面六格的結論並排釘住)', () => {
  it('5 綠綠 / 6 紅綠 / 7 綠紅 —— 少裝一道就會漏掉一個真的病', () => {
    const verdict = (pages: readonly string[]) =>
      [blankPages(pages, A).length > 0, moneyPagesWithoutItems(pages, A).length > 0];
    expect(verdict(W5)).toEqual([false, false]);
    expect(verdict(W6)).toEqual([true, false]);
    expect(verdict(W7)).toEqual([false, true]);
  });
});
