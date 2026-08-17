// merge-detail-items.test.ts — `D2` C 條:把撈到盡的品項併回 detail。
//
// 🔴 **本檔守的是【第 201 項會不會消失】,而它有一個前科**:
//    A 條(`e0c343db`)那次我用 3 項的 fixture 寫「守第 201 項」,而 codex R3 抓到
//    **那格對 `items.slice(0, 200)` 恆綠** —— 宣稱守的是 201,量的卻是「兩份長得不一樣」。
//    ⇒ **本檔真的餵 201 項。**

import { describe, expect, it } from 'vitest';
import type { AdminOrderDetail, AdminOrderDetailFullItem } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import { mergeDetailItems } from './merge-detail-items';

// 🔴 走 `toMoneyAmount` 中央守門,不硬轉 —— fixture 若能繞過那道,
//    測試就會接受一個 production 造不出來的值(而那正是「活在假世界」的形狀)。
const money = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });

const summary = {
  quantity: 1,
  orderedQuantity: 1,
  instockQuantity: 1,
  cancelledQuantity: 0,
  cancellableQuantity: 0,
  shippedQuantity: 0,
};

/** 撈到盡那份(沒有採購欄 —— 那正是本片的核心區分)。 */
const fullItem = (i: number): AdminOrderDetailFullItem => ({
  id: `oi-${String(i).padStart(4, '0')}`,
  variantSku: `SKU-${String(i).padStart(4, '0')}`,
  title: `品項第 ${i} 號`,
  spec: null,
  quantity: 1,
  quantitySummary: summary,
  unitPrice: money(1000),
  lineTotal: money(1000),
});

/** 內嵌那份(帶採購欄)。 */
const embeddedItem = (i: number, over: Record<string, unknown> = {}) => ({
  ...fullItem(i),
  procurements: [{ id: `pr-${i}` }],
  procurementTruncated: false,
  ...over,
});

const detailOf = (embeddedCount: number): AdminOrderDetail =>
  ({
    id: 'o1',
    displayId: 'PCM-2026-0201',
    itemsTruncated: true,
    items: Array.from({ length: embeddedCount }, (_, k) => embeddedItem(k + 1)),
  }) as unknown as AdminOrderDetail;

describe('🔴🔴 201 項的單:第 201 項不可以消失', () => {
  // 🔴 這一組刻意造出【真實世界的形狀】:
  //    內嵌那份被 200 夾住（前 200 項），而撈到盡那份有 201 項。
  const embeddedCapped = 200;
  const full = Array.from({ length: 201 }, (_, k) => fullItem(k + 1));

  it('併完之後品項數 = 201,而不是 200', () => {
    const merged = mergeDetailItems(detailOf(embeddedCapped), full);
    expect(
      merged.items.length,
      '少一項 ⇒ 那一項在畫面上不存在，而畫面看起來完全正常。',
    ).toBe(201);
    expect(merged.items.map((i) => i.id)).toContain('oi-0201');
  });

  it('🔴 `itemsTruncated` 必須翻成 false —— 否則取消複核區永遠 fail-closed', () => {
    // 那一區逐字:「沒有看到全部品項就不能複核取消範圍」⇒ 旗標不翻,這張單【永遠取消不了】。
    expect(mergeDetailItems(detailOf(embeddedCapped), full).itemsTruncated).toBe(false);
  });

  it('🔴🔴 第 201 項的採購要標成【沒載完】,不可以標成【沒有採購紀錄】', () => {
    // 🔴 本片最貴的一格。`itemsTruncated` 翻成 false 之後,
    //    `item.procurementTruncated || detail.itemsTruncated` 的後半永遠是 false
    //    ⇒ 採購那一面【完全靠前半】撐住。前半填錯 = 畫面對員工說謊。
    const merged = mergeDetailItems(detailOf(embeddedCapped), full);
    const tail = merged.items.find((i) => i.id === 'oi-0201')!;
    expect(
      tail.procurementTruncated,
      '標成 false ⇒ 畫面會說「這個品項沒有採購紀錄」，而事實是【我們沒去讀】。' +
        '兩者對員工的下一步完全不同，而且它會讓那一項的採購【可以被編輯】—— ' +
        '用不完整的內容覆蓋既有紀錄是真的會弄壞資料。',
    ).toBe(true);
    expect(tail.procurements).toEqual([]);
  });

  it('🔴 正向對照 — 前 200 項的採購資料【要保留】,不可以一起被清成空的', () => {
    // 沒有這一格的話,一個「全部填 procurements: [] / truncated: true」的實作也會讓上一格全綠
    // —— 而那個實作會讓【整張單】的採購都不能編輯。
    const merged = mergeDetailItems(detailOf(embeddedCapped), full);
    const head = merged.items.find((i) => i.id === 'oi-0001')!;
    expect(head.procurementTruncated, '前 200 項的採購是讀到了的，不該被標成沒載完').toBe(false);
    expect(head.procurements).toEqual([{ id: 'pr-1' }]);
  });

  it('🔴 順序照【撈到盡那份】,不是照內嵌那份', () => {
    const merged = mergeDetailItems(detailOf(embeddedCapped), full);
    expect(merged.items.map((i) => i.id).slice(0, 3)).toEqual(['oi-0001', 'oi-0002', 'oi-0003']);
    expect(merged.items[200]!.id).toBe('oi-0201');
  });
});

describe('邊界', () => {
  it('內嵌那份自己就完整時(小單),採購資料全部保留、旗標仍翻 false', () => {
    const full = Array.from({ length: 3 }, (_, k) => fullItem(k + 1));
    const merged = mergeDetailItems(detailOf(3), full);
    expect(merged.items.length).toBe(3);
    expect(merged.items.every((i) => i.procurementTruncated === false)).toBe(true);
    expect(merged.itemsTruncated).toBe(false);
  });

  it('🔴 內嵌那份【自己】就標了 per-item 截斷 ⇒ 要沿用,不可以覆寫成 false', () => {
    // 那是另一件事:品項有讀到、而它的採購列超過 50 被夾了。
    const detail = {
      ...detailOf(1),
      items: [embeddedItem(1, { procurementTruncated: true })],
    } as unknown as AdminOrderDetail;
    const merged = mergeDetailItems(detail, [fullItem(1)]);
    expect(
      merged.items[0]!.procurementTruncated,
      '覆寫成 false ⇒ 一個【真的被夾過】的採購列表會顯示成完整的。',
    ).toBe(true);
  });

  it('撈到盡回空清單 ⇒ 品項就是空的,不退回內嵌那份', () => {
    // 退回內嵌 = 把「讀到 0 筆」與「沒去讀」混在一起,而呼叫端已經 fail-closed 處理讀失敗。
    expect(mergeDetailItems(detailOf(3), []).items).toEqual([]);
  });

  it('🔴 金額走的是【撈到盡那份】的值', () => {
    // 兩份的共同欄理論上相同,而理論上相同不是相同(兩次查詢之間可以有寫入)。
    const full = [{ ...fullItem(1), unitPrice: money(999), lineTotal: money(999) }];
    const merged = mergeDetailItems(detailOf(1), full);
    expect(merged.items[0]!.unitPrice).toEqual(money(999));
  });
});
