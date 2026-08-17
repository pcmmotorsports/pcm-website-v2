import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseOrderAdapter } from './SupabaseOrderAdapter';

// `Q-C18` 甲:`listOrderItemsForPrint` 的分頁迴圈。
//
// 🔴 **這一支測的不是「有沒有撈到東西」,是【伺服器把頁切短時會不會靜默少撈】。**
//    那正是本函式要消滅的病,而它最容易在修法裡換個位置重生
//    —— V 窗 2026-08-17 預先列出的五條「換成 .range()/count 之後最容易長出來的新病」逐條在下面。
//
// ⚠️ 每一格都用**假的 client** —— 它證明的是**迴圈的邏輯**,不是「真的 PostgREST 會這樣回」。
//    真 DB 的行為(`db-max-rows` 實際值、embed 形狀)本窗量不到,標**未確認**。

const ORDER = '11111111-1111-4111-8111-111111111111';

type Row = {
  id: string;
  variant_sku: string;
  quantity: number;
  product_snapshot: unknown;
  order_item_quantity_summary?: unknown;
};

function row(i: number): Row {
  return {
    // id 補零 ⇒ 字串升冪 = 數值升冪,讓「順序漂掉」在斷言上看得出來。
    id: `item-${String(i).padStart(4, '0')}`,
    variant_sku: `SKU-${i}`,
    quantity: 1,
    product_snapshot: { title: `品名 ${i}`, spec: { 顏色: '黑' } },
    order_item_quantity_summary: null,
  };
}

/**
 * 假 client。`serverCap` = **伺服器自己的上限**(模擬 `db-max-rows`)——
 * 它會把每一頁切到最多 `serverCap` 列,**而呼叫端要不出更多**。
 * 這正是「頁大小 ≥ 伺服器上限」時真實世界會發生的事。
 */
function makeClient(
  rows: Row[],
  opts: { serverCap?: number; errorOnCall?: number; count?: number | null } = {},
) {
  const rangeCalls: Array<[number, number]> = [];
  const countOpts: Array<unknown> = [];
  let call = 0;
  const q = {
    select(_cols: string, o?: unknown) {
      countOpts.push(o);
      return q;
    },
    eq() {
      return q;
    },
    order() {
      return q;
    },
    range(from: number, to: number) {
      call += 1;
      rangeCalls.push([from, to]);
      if (opts.errorOnCall === call) {
        return Promise.resolve({ data: null, error: { message: '第 N 頁爆了' }, count: null });
      }
      const wanted = rows.slice(from, to + 1);
      const cap = opts.serverCap ?? Number.POSITIVE_INFINITY;
      return Promise.resolve({
        data: wanted.slice(0, cap),
        error: null,
        count: opts.count === undefined ? rows.length : opts.count,
      });
    },
  };
  const client = { from: () => q };
  return { client: client as unknown as SupabaseClient, rangeCalls, countOpts };
}

describe('listOrderItemsForPrint — 分頁迴圈', () => {
  it('正向:一頁就撈完(空頁才停 ⇒ 會多跑一次空查詢)', async () => {
    const rows = [row(1), row(2), row(3)];
    const { client, rangeCalls } = makeClient(rows);
    const res = await new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER);

    expect(res.items.map((i) => i.id)).toEqual(['item-0001', 'item-0002', 'item-0003']);
    // 🔴 **刻意斷言那一次空查詢** —— 它是「終止條件是空頁、不是本頁不滿」的**唯一機械證據**。
    //    改成「不滿即停」的話這裡會變成 1 次 ⇒ 這一格紅。
    expect(rangeCalls).toHaveLength(2);
  });

  it('🔴 V-1 伺服器把頁切得比頁大小短 ⇒ 仍然撈得完(不是撈到第一頁就停)', async () => {
    // 頁大小 200,而伺服器每次只給 7 列 —— 這正是 `db-max-rows` 低於頁大小時的形狀。
    // 🔴 既有共用 helper `fetchAllPaginated` 在這個情境下**會停在第一頁**
    //    (它的判準是 `batch.length < PAGE_SIZE`)⇒ 靜默少撈 493 列。
    const rows = Array.from({ length: 23 }, (_, i) => row(i + 1));
    const { client, rangeCalls } = makeClient(rows, { serverCap: 7 });
    const res = await new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER);

    expect(res.items).toHaveLength(23);
    expect(new Set(res.items.map((i) => i.id)).size, '有重複列').toBe(23);
    // from 前進【實得筆數】而非頁大小 ⇒ 視窗連續、不跳號。
    // 最後那個 `23` 是**空頁**那一次 —— 它就是終止條件本身,不是多餘的。
    // ⚠️ 我第一版把它漏掉、預期 `[0,7,14,21]` ⇒ 這一格當場紅。**紅的是我的預期,不是實作。**
    expect(rangeCalls.map(([f]) => f)).toEqual([0, 7, 14, 21, 23]);
  });

  it('🔴 V-2 `.range(from, to)` 兩端皆含 ⇒ to = from + 頁大小 − 1(寫成 +頁大小 會跨頁重複)', async () => {
    const { client, rangeCalls } = makeClient([row(1)]);
    await new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER);
    const [from, to] = rangeCalls[0] as [number, number];
    expect(to - from + 1, '視窗寬度必須等於頁大小').toBe(200);
  });

  it('🔴 V-3 中途某頁失敗 ⇒ throw,不回已累積的前幾頁', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i + 1));
    const { client } = makeClient(rows, { errorOnCall: 2 });
    await expect(
      new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER),
    ).rejects.toBeTruthy();
    // 🔴 這一格的價值不在「有沒有 throw」,在**它沒有回一個看起來正常的短清單** ——
    //    回部分 = 部分資料而沒有旗標 = 紙上少列品項而紙看起來完全正常。
  });

  it('🔴 V-4 `count` 只在第一頁要、而且不當終止判準(中途有寫入時它會對不上,那是正常)', async () => {
    // 迴圈跨多次查詢 ⇒ `count` 量在第一頁那個瞬間。這裡刻意讓它與實得不同。
    const rows = Array.from({ length: 23 }, (_, i) => row(i + 1));
    const { client, countOpts } = makeClient(rows, { serverCap: 7, count: 99 });
    const res = await new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER);

    expect(res.items, '拿 count 當終止判準的話會提早停或多跑').toHaveLength(23);
    expect(res.reportedTotal, 'count 要原樣帶出去當【對不上】的訊號').toBe(99);
    // 只有第一次 select 帶 count 選項;之後帶 undefined。
    expect(countOpts[0]).toEqual({ count: 'exact' });
    expect(countOpts.slice(1).every((o) => o === undefined)).toBe(true);
  });

  it('🔴 V-5 排序鍵必須是唯一鍵(order_items.id 是 PK)—— 釘在呼叫參數上', async () => {
    const orderCalls: Array<[string, unknown]> = [];
    const q = {
      select: () => q,
      eq: () => q,
      order: (col: string, o: unknown) => {
        orderCalls.push([col, o]);
        return q;
      },
      range: () => Promise.resolve({ data: [], error: null, count: 0 }),
    };
    await new SupabaseOrderAdapter({ from: () => q } as unknown as SupabaseClient)
      .listOrderItemsForPrint(ORDER);
    // 非唯一鍵分頁時同一列可能兩頁都出現、也可能兩頁都不出現(頁界漂移)。
    expect(orderCalls).toEqual([['id', { ascending: true }]]);
  });

  // 🔴 **OFFSET 分頁在並發寫入下會漂移**(A 窗 2026-08-17 被 codex 擊破的那條):
  //    撈到一半集合裡多一筆 ⇒ 某一列**兩頁都出現**。**而「多了」也是壞的** ——
  //    紙上同一個品項印兩次;更毒的是它讓 `count` 對帳**看起來剛好**(漏一列 + 重一列 ⇒ 筆數相同)
  //    ⇒ **對帳擋不住它要擋的那個病。**
  //    📌 本路徑實查判為【不會漂】(`order_items` 建單後不再增刪,數法寫在 adapter docstring),
  //       **而去重仍然加了** —— 論證會過期且過期時沒有症狀,去重讓這個失敗模式結構上不存在。
  it('🔴 兩頁重疊(模擬 OFFSET 漂移)⇒ 結果不得有重複列', async () => {
    // 假 client 刻意讓第 2 頁把第 1 頁最後一列再回一次。
    const all = Array.from({ length: 6 }, (_, i) => row(i + 1));
    const pages = [all.slice(0, 3), [all[2] as Row, ...all.slice(3)], []];
    let call = 0;
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      range: () => {
        const data = pages[call] ?? [];
        call += 1;
        return Promise.resolve({ data, error: null, count: 6 });
      },
    };
    const res = await new SupabaseOrderAdapter({ from: () => q } as unknown as SupabaseClient)
      .listOrderItemsForPrint(ORDER);

    expect(res.items).toHaveLength(6);
    expect(new Set(res.items.map((i) => i.id)).size, '同一個品項會被印兩次').toBe(6);
    // 正向對照:去重之後筆數與 `count` 對得上 ⇒ 對帳恢復判別力
    //(不去重的話這裡是 7,而 7 !== 6 反而「看起來有問題」—— 真正毒的是漏一列時被重複補平)。
    expect(res.reportedTotal).toBe(6);
  });

  it('mapper 有接上:product_snapshot 解析成 title / spec,缺摘要 ⇒ null(不是 0)', async () => {
    const { client } = makeClient([row(1)]);
    const res = await new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER);
    const item = res.items[0];
    expect(item?.title).toBe('品名 1');
    expect(item?.spec).toEqual({ 顏色: '黑' });
    // 🔴 `null` = 「不知道」,不是「都是 0」 —— 補 0 會讓可取消量被算大。
    expect(item?.quantitySummary).toBeNull();
  });

  it('🔴 撞到 MAX_PAGES ⇒ throw,不回部分、不只印 console.warn', async () => {
    // 每頁只給 1 列、資料 10 萬列 ⇒ 200×50 撈不完。
    const rows = Array.from({ length: 100_000 }, (_, i) => row(i + 1));
    const { client } = makeClient(rows, { serverCap: 1 });
    await expect(
      new SupabaseOrderAdapter(client).listOrderItemsForPrint(ORDER),
    ).rejects.toThrow(/MAX_PAGES/);
    // 📎 既有共用 helper 在這個情境是 `console.warn` + 回部分 ——
    //    **server component 裡沒有人會看到那行 warn**,那等於靜默截斷。
  });
});
