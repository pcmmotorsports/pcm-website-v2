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

const detailOf = (embeddedCount: number, itemsTruncated = true): AdminOrderDetail =>
  ({
    id: 'o1',
    displayId: 'PCM-2026-0201',
    // 🔴 `#646`:這一欄進來時的意思是【內嵌那份有沒有撞到 200 上限】,
    //    它是「缺 embedded 的品項到底是不是被上限切掉」的**唯一證據**(見 mergeDetailItems 內註解)。
    itemsTruncated,
    items: Array.from({ length: embeddedCount }, (_, k) => embeddedItem(k + 1)),
  }) as unknown as AdminOrderDetail;

describe('🔴🔴 201 項的單:第 201 項不可以消失', () => {
  // 🔴 這一組刻意造出【真實世界的形狀】:
  //    內嵌那份被 200 夾住（前 200 項），而撈到盡那份有 201 項。
  const embeddedCapped = 200;
  const full = Array.from({ length: 201 }, (_, k) => fullItem(k + 1));

  it('併完之後品項數 = 201,而不是 200', () => {
    const merged = mergeDetailItems(detailOf(embeddedCapped), full, full.length);
    expect(
      merged.items.length,
      '少一項 ⇒ 那一項在畫面上不存在，而畫面看起來完全正常。',
    ).toBe(201);
    expect(merged.items.map((i) => i.id)).toContain('oi-0201');
  });

  it('🔴 `itemsTruncated` 必須翻成 false —— 否則取消複核區永遠 fail-closed', () => {
    // 那一區逐字:「沒有看到全部品項就不能複核取消範圍」⇒ 旗標不翻,這張單【永遠取消不了】。
    expect(mergeDetailItems(detailOf(embeddedCapped), full, full.length).itemsTruncated).toBe(false);
  });

  it('🔴🔴 第 201 項的採購要標成【沒載完】,不可以標成【沒有採購紀錄】', () => {
    // 🔴 本片最貴的一格。`itemsTruncated` 翻成 false 之後,
    //    `item.procurementTruncated || detail.itemsTruncated` 的後半永遠是 false
    //    ⇒ 採購那一面【完全靠前半】撐住。前半填錯 = 畫面對員工說謊。
    const merged = mergeDetailItems(detailOf(embeddedCapped), full, full.length);
    const tail = merged.items.find((i) => i.id === 'oi-0201')!;
    // 🔴🔴 `#646` 之後**承重的欄位換了**:擋住「被當成沒有採購紀錄」與「可以被編輯」的,
    //    現在是 `procurements === null` 本身(消費端的 `blocked = unreadable || truncated`),
    //    不再是 `procurementTruncated`。
    //    ⚠️ 而 `procurementTruncated` 在這條路上**必須是 false** —— 那一欄的意思是
    //    「有證據說這是固定限制」,而我們**沒有品項級的證據**(codex 關卡2 兩輪的結論)。
    //    標成 true = 對一個可能重整就會恢復的品項說「重整不會改變」。
    expect(
      tail.procurementTruncated,
      '沒有品項級的截斷證據卻標 true ⇒ 畫面會說「重整不會改變」，而那可能是假的',
    ).toBe(false);
    // 🔴🔴 `#646`:這一格從 `toEqual([])` 改成 `toBeNull()`,而**這不是把期望值改成現況** ——
    //    `[]` 的意思是「問過了,答案是零筆」,那正是本測試標題說**不可以**的那句話。
    //    `null` 才是「我沒去讀」。舊版靠旁邊那顆布林補救,現在型別自己講得出來。
    expect(
      tail.procurements,
      '空陣列 = 「問過了，答案是零筆」⇒ 正是本測試要防的那句話；null 才是「我沒去讀」',
    ).toBeNull();
    // 🔴 兩個欄位要**一起**驗,而它們現在的分工是:
    //    `null` = 我手上沒有這份清單(承重:擋住「沒有採購紀錄」那句話 + 停用編輯)
    //    `false` = 我**沒有證據**說這是固定的(不是「我確定它是暫時的」)
  });

  // 🔴🔴 `#646` 關卡2 codex must-fix(2026-08-18):**「不在 embedded 裡」≠「被 200 切掉」。**
  //    反例走得到、而且不需要任何異常:品項數 < 200 的單,在兩次查詢之間**新增了一個品項**
  //    ⇒ 較新的 `fullItems` 有它、較舊的 `embedded` 沒有。
  //    這個品項**重新整理就會恢復** ⇒ 標成「固定限制」= 叫員工別做一件其實有用的事,
  //    **正是 `#646` 這條 backlog 在修的病,在一個新地方復發。**
  // ⚠️ 這一格與上一格**成對**:只留上一格的話,一個「寫死 procurementTruncated: true」的實作照樣全綠
  //    (第一版就是寫死的,而它通過了我自己的全部測試)。
  it('🔴 內嵌沒撞上限,而某項不在內嵌裡(兩次查詢之間新增)⇒ 不得標成固定限制', () => {
    const embeddedCount = 3;
    const fullFour = Array.from({ length: 4 }, (_, k) => fullItem(k + 1));
    const merged = mergeDetailItems(detailOf(embeddedCount, false), fullFour, fullFour.length);
    const added = merged.items.find((i) => i.id === 'oi-0004')!;
    expect(added.procurements, '沒讀到它的採購 ⇒ null(不是空陣列)').toBeNull();
    expect(
      added.procurementTruncated,
      '內嵌那份根本沒撞到上限 ⇒ 沒有任何證據說這是固定的;重整就會恢復',
    ).toBe(false);
  });

  it('🔴 正向對照 — 前 200 項的採購資料【要保留】,不可以一起被清成空的', () => {
    // 沒有這一格的話,一個「全部填 procurements: [] / truncated: true」的實作也會讓上一格全綠
    // —— 而那個實作會讓【整張單】的採購都不能編輯。
    const merged = mergeDetailItems(detailOf(embeddedCapped), full, full.length);
    const head = merged.items.find((i) => i.id === 'oi-0001')!;
    expect(head.procurementTruncated, '前 200 項的採購是讀到了的，不該被標成沒載完').toBe(false);
    expect(head.procurements).toEqual([{ id: 'pr-1' }]);
  });

  it('🔴 順序照【撈到盡那份】,不是照內嵌那份', () => {
    const merged = mergeDetailItems(detailOf(embeddedCapped), full, full.length);
    expect(merged.items.map((i) => i.id).slice(0, 3)).toEqual(['oi-0001', 'oi-0002', 'oi-0003']);
    expect(merged.items[200]!.id).toBe('oi-0201');
  });
});

describe('🔴🔴 對帳:撈到盡那支【自己少撈了】的時候(codex 2026-08-18 MF-1)', () => {
  // 🔴 本族守的是本片【最嚴重的洞】,而第一版沒有它:
  //    撈到盡那支若少撈(翻頁中途出事、伺服器切頁…),`itemsTruncated` 若還是寫死 false,
  //    摘要卡 / 出貨狀態 / 取消複核會**開始相信一份殘缺的清單**
  //    ⇒ 從 fail-closed 變成 fail-open ⇒ 本片要修的病換一個位置發作。
  const full = Array.from({ length: 200 }, (_, k) => fullItem(k + 1));

  it('🔴 伺服器說 201、只撈到 200 ⇒ `itemsTruncated` 必須留著 true', () => {
    expect(
      mergeDetailItems(detailOf(200), full, 201).itemsTruncated,
      '翻成 false ⇒ 摘要卡會印一個【少算的件數】、取消複核會放行一份殘缺的清單。',
    ).toBe(true);
  });

  it('🔴 正向對照 — 數字對得上 ⇒ 翻成 false(不可以永遠保守)', () => {
    // 沒有這一格,一個「永遠回 true」的實作也會讓上一格全綠 ——
    // 而那個實作會讓【每一張單】都永遠取消不了。
    expect(mergeDetailItems(detailOf(200), full, 200).itemsTruncated).toBe(false);
  });

  it('🔴🔴 `reportedTotal = NaN` 不可以讓它恆為截斷(T① 2026-08-18 在列印那支撞到的同一形狀)', () => {
    // 機轉:PostgREST 回 `Content-Range: 0-200/*`(沒有總數)⇒ supabase-js `parseInt('*')` ⇒ NaN
    //      而 `typeof NaN === 'number'` 為 true ⇒ 上游的 typeof 守門【放它過】
    // 🔴 而 `x !== NaN` 恆為 true ⇒ 舊式 `reportedTotal !== null && length !== reportedTotal`
    //    會讓 incomplete 恆為 true ⇒ 摘要永遠印「未知」、取消複核區【永遠鎖死】
    //    = 本片剛修好的那個病原樣復發。
    // ⚠️ **斷言刻意不是「有沒有擋住」** —— 那在修之前也綠(舊式也會擋,只是擋過頭)。
    //    要斷言的是【它不該擋】:數字給不出來 ≠ 數字對不上。
    expect(
      mergeDetailItems(detailOf(200), full, Number.NaN).itemsTruncated,
      'NaN 被當成「對不上」⇒ 這張單【永遠】顯示沒列完、【永遠】取消不了。',
    ).toBe(false);
  });

  it('🔴 `reportedTotal === null` 不算對不上 —— 那是「沒給 count」不是「數字不符」', () => {
    // 把它當截斷 ⇒ 一個【正常但沒 count 的回應】會把整頁降級。
    expect(mergeDetailItems(detailOf(200), full, null).itemsTruncated).toBe(false);
  });

  it('🔴 而【品項清單本身仍然照撈到的那份給】—— 對帳不過不等於不顯示', () => {
    // 明細頁有「不完整」的 UI(摘要印未知、取消區 fail-closed)⇒ 讓那一套接手，
    // 比丟掉整頁好:員工至少還看得到單號、收款、退款。
    expect(mergeDetailItems(detailOf(200), full, 201).items.length).toBe(200);
  });
});

describe('邊界', () => {
  it('內嵌那份自己就完整時(小單),採購資料全部保留、旗標仍翻 false', () => {
    const full = Array.from({ length: 3 }, (_, k) => fullItem(k + 1));
    const merged = mergeDetailItems(detailOf(3), full, full.length);
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
    const merged = mergeDetailItems(detail, [fullItem(1)], 1);
    expect(
      merged.items[0]!.procurementTruncated,
      '覆寫成 false ⇒ 一個【真的被夾過】的採購列表會顯示成完整的。',
    ).toBe(true);
  });

  it('撈到盡回空清單 ⇒ 品項就是空的,不退回內嵌那份', () => {
    // 退回內嵌 = 把「讀到 0 筆」與「沒去讀」混在一起,而呼叫端已經 fail-closed 處理讀失敗。
    expect(mergeDetailItems(detailOf(3), [], 0).items).toEqual([]);
  });

  it('🔴 金額走的是【撈到盡那份】的值', () => {
    // 兩份的共同欄理論上相同,而理論上相同不是相同(兩次查詢之間可以有寫入)。
    const full = [{ ...fullItem(1), unitPrice: money(999), lineTotal: money(999) }];
    const merged = mergeDetailItems(detailOf(1), full, full.length);
    expect(merged.items[0]!.unitPrice).toEqual(money(999));
  });
});
