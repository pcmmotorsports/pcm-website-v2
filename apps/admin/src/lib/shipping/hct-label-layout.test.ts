import { describe, expect, it } from 'vitest';
import {
  A4_GRID,
  HCT_LABEL_BATCH_MAX,
  buildLabelPages,
  type LabelSlot,
} from './hct-label-layout';

// hct-label-layout.test.ts — ⟦ship-HCTAPI⟧ 片 D 的守門。
//
// 🔴 **這一片的正確性完全靠這支檔** —— 它零網路零 env 零 DB。
// 🛑 **而它【證不到】紙上印出來對不對** —— 我沒有印表機、也沒有那種標籤貼紙。
//    ⇒ 📌 下面每一格問的都是「哪一張圖擺進哪一格」, **不是「那一格在紙上多大」**。

/** 一張「看起來像圖」的假 base64(長度過關、字元合法)。內容不重要 —— 本片不解圖。 */
const OK_IMG = 'iVBORw0KGgoAAAANSUhEUg'.repeat(4);
const lab = (n: number, img = OK_IMG) => ({ imageBase64: img, shipmentRef: `REF${n}` });
const kinds = (slots: LabelSlot[]) => slots.map((s) => s.kind);

describe('⟦ship-HCTAPI⟧ 片 D · single —— 一張圖一頁', () => {
  it('🔵 三張圖 ⇒ 三頁, 每頁一格', () => {
    const pages = buildLabelPages({ labels: [lab(1), lab(2), lab(3)], sheet: 'single' });
    expect(pages.length).toBe(3);
    expect(pages.every((p) => p.slots.length === 1)).toBe(true);
  });

  it('🔵 single 不理會 startAt(那個概念只對貼紙有意義)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'single', startAt: 4 });
    expect(pages.length).toBe(1);
    expect(kinds(pages[0]!.slots), 'single 也跳格 ⇒ 會平白多印三張紙').toEqual(['label']);
  });
});

describe('⟦ship-HCTAPI⟧ 片 D · a4-2x3 —— 六格一頁, 而【從第幾格開始】是版面參數', () => {
  it('🔵 六張圖 + 從第 1 格 ⇒ 一頁六格全是標籤', () => {
    const pages = buildLabelPages({
      labels: [1, 2, 3, 4, 5, 6].map((n) => lab(n)),
      sheet: 'a4-2x3',
      startAt: 1,
    });
    expect(pages.length).toBe(1);
    expect(kinds(pages[0]!.slots)).toEqual(Array(6).fill('label'));
  });

  /**
   * 🔴 **這一格是「從第幾格開始」的承重。**
   * 少了它, 一個**忽略 `startAt`** 的實作照樣通過上面那格 ——
   * 而後果是:🎯 **第一張標籤印在一個【已經撕走的格子】上 ⇒ 一張浪費掉的貼紙。**
   */
  it('🔴 從第 3 格開始 ⇒ 前兩格是 skipped, 而標籤從第 3 格接下去', () => {
    const pages = buildLabelPages({
      labels: [lab(1), lab(2)],
      sheet: 'a4-2x3',
      startAt: 3,
    });
    expect(pages.length).toBe(1);
    expect(kinds(pages[0]!.slots)).toEqual(['skipped', 'skipped', 'label', 'label']);
  });

  it('🔵 跨頁:從第 5 格開始放 4 張 ⇒ 第一頁六格(4 skipped + 2 label)· 第二頁 2 格', () => {
    const pages = buildLabelPages({
      labels: [1, 2, 3, 4].map((n) => lab(n)),
      sheet: 'a4-2x3',
      startAt: 5,
    });
    expect(pages.length).toBe(2);
    expect(kinds(pages[0]!.slots)).toEqual([
      'skipped', 'skipped', 'skipped', 'skipped', 'label', 'label',
    ]);
    // 🔵 第二頁【不補 skipped】—— 它是一張新的貼紙, 從第 1 格開始。
    expect(kinds(pages[1]!.slots)).toEqual(['label', 'label']);
  });

  it.each([0, -1, 7, 1.5, Number.NaN])('🔴 起始格 %s ⇒ 丟例外, 不夾到 1', (n) => {
    expect(() =>
      buildLabelPages({ labels: [lab(1)], sheet: 'a4-2x3', startAt: n }),
    ).toThrow(/起始格必須是/);
  });

  it('🔵 正對照:起始格 6(邊界內最大)⇒ 正常走(證明上面那幾格不是因為它永遠丟例外)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'a4-2x3', startAt: 6 });
    expect(kinds(pages[0]!.slots)).toEqual([
      'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'label',
    ]);
  });

  it('🔵 沒給 startAt ⇒ 當作 1(整張新的貼紙)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'a4-2x3' });
    expect(kinds(pages[0]!.slots)).toEqual(['label']);
  });
});

describe('⟦ship-HCTAPI⟧ 片 D · 壞掉的圖 —— 這一格【要說話】, 不得靜靜空白', () => {
  /**
   * 🔴🔴 **這一族是主視窗指名要的第三條**:假 base64 要能演兩個世界。
   *
   * 🎯 **理由**:「這一格沒有標籤」與「這一格的標籤壞了」**在紙上長得一模一樣** ——
   *    而員工會把那張紙拿去貼箱子。
   * ⇒ 📌 一張少了一格的紙他**會發現**(數量不對);一張那一格印壞的紙他會
   *    **貼一張空白上去** —— 而那個箱子就這樣出門了。
   */
  it.each([
    ['空字串', ''],
    ['只有空白', '   \n '],
    ['不是 base64', '<<<這不是圖>>>'],
    ['太短', 'iVBORw0KGgo'],
  ])('🔴 %s ⇒ broken, 而它帶得出【是哪一張單】與【為什麼】', (_n, bad) => {
    const pages = buildLabelPages({ labels: [lab(9, bad)], sheet: 'single' });
    const slot = pages[0]!.slots[0]!;
    expect(slot.kind, '壞圖被當成正常標籤 ⇒ 紙上一格空白, 而員工會貼上去').toBe('broken');
    // 🔴 承重:少了這兩行, 一個「壞了就回 broken 但不說是哪張」的實作也會過
    //    ⇒ 而員工拿著一張紙, 不知道少的是哪一箱。
    expect(slot).toMatchObject({ shipmentRef: 'REF9' });
    expect((slot as { reason: string }).reason.length).toBeGreaterThan(0);
  });

  it('🔵 負對照:好的圖 ⇒ label(證明上面那幾格不是因為它把每一張都判壞)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'single' });
    expect(pages[0]!.slots[0]!.kind).toBe('label');
  });

  it('🔵 好壞混在同一頁 ⇒ 各自歸各自, 壞的那一格不吃掉好的', () => {
    const pages = buildLabelPages({
      labels: [lab(1), lab(2, ''), lab(3)],
      sheet: 'a4-2x3',
      startAt: 1,
    });
    expect(kinds(pages[0]!.slots)).toEqual(['label', 'broken', 'label']);
  });
});

describe('⟦ship-HCTAPI⟧ 片 D · 那兩個常數', () => {
  it('🔵 A4 制式貼紙是 2 欄 × 3 列 = 六格(來源 = Sean 的截圖, 不是規格書)', () => {
    expect(A4_GRID.cols).toBe(2);
    expect(A4_GRID.rows).toBe(3);
    // 🔴 承重:`perSheet` 若與 cols×rows 不一致, 跨頁那幾格會安靜地切錯。
    expect(A4_GRID.perSheet).toBe(A4_GRID.cols * A4_GRID.rows);
  });

  it('🔴 一次上限 5 筆(規格第 12 頁逐字「若使用回傳圖檔, 一次上限為 5 筆」)', () => {
    // 🛑 Sean 說「幾乎不會 —— 一天出幾單而已」⇒ 今天不會撞到。
    //    而「今天不會撞到」與「撞到時會被擋下」是兩件事, 業務會長大。
    expect(HCT_LABEL_BATCH_MAX).toBe(5);
  });
});
