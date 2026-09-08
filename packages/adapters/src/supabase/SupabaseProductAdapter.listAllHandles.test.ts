// `listAllHandles` —— sitemap 那條路的最小投影(2026-09-08)
//
// 🔴🔴 **為什麼有這支方法(病史, 一句)**:顧客站 production build 連續 3 次在
//    `/sitemap.xml/route` 逾時(每次上限 60 秒)⇒ 部署失敗;而**上一次成功那發的靜態頁生成 ≈59 秒**
//    ⇒ 📌 **它本來就貼在線上。** sitemap 只用得到 handle, 而舊路對【每一列】投影
//    detail 全欄 + `product_variants_public(id)` 這個 embed。
//
// 🛑 **本檔證得到的 / 證不到的**:
//    ✅ 證得到:投影只有兩欄 · 走同一張表同一個排序同一套分頁 · 回的 handle 陣列與舊路【逐字相同】
//    🔴 證不到:**build 期會不會在 60 秒內做完** —— 那只有真的部署一次才知道。
//       ⇒ 任何人看到本檔全綠, **不可以據此說「sitemap 逾時修好了」。**

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseProductAdapter } from './SupabaseProductAdapter';

/** 造一個會記下 select 字串與 range 呼叫的假 client(形狀抄同目錄 `SupabaseProductAdapter.test.ts`)。 */
function makeClient(pageSizes: number[], rowFor: (i: number) => Record<string, unknown>) {
  const selectCalls: string[] = [];
  const rangeCalls: Array<[number, number]> = [];
  const orderCalls: Array<[string, boolean | undefined]> = [];
  let idx = 0;
  const t = {
    select(cols: string) { selectCalls.push(cols); return t; },
    order(col: string, o?: { ascending?: boolean }) { orderCalls.push([col, o?.ascending]); return t; },
    range(from: number, to: number) {
      rangeCalls.push([from, to]);
      const n = pageSizes[idx] ?? 0;
      idx += 1;
      return Promise.resolve({ data: Array.from({ length: n }, (_, j) => rowFor(from + j)), error: null });
    },
  };
  const client = {
    from(name: string) {
      if (name !== 'products_public') throw new Error(`listAllHandles 只該讀 products_public, 收到 ${name}`);
      return t;
    },
  };
  return { client: client as unknown as SupabaseClient, selectCalls, rangeCalls, orderCalls };
}

const handleRow = (i: number) => ({ id: `id-${String(i).padStart(6, '0')}`, handle: `h-${i}` });

describe('SupabaseProductAdapter.listAllHandles — 最小投影', () => {
  it('🔴 投影【只有】id 與 handle —— 一個重欄位都不准回來', async () => {
    // 🛑 這一格是本片的整個理由。少了它, 有人「順手」把投影加回 detail 全欄,
    //    產出仍然正確、測試仍然全綠, 而 build 又會逾時。
    const { client, selectCalls } = makeClient([0], handleRow);
    await new SupabaseProductAdapter(client).listAllHandles();

    expect(selectCalls.length, '一次 select 都沒發生 ⇒ 下面的斷言在空集合上恆真').toBeGreaterThan(0);
    for (const cols of selectCalls) {
      expect(cols.replace(/\s/g, '')).toBe('id,handle');
      // 🔴 逐項點名那幾個【重的】—— 上面那條 toBe 已經涵蓋, 而這幾條會在失敗時直接說出是誰混進來
      for (const heavy of ['product_variants_public', 'categories', 'images', 'fitments', 'description']) {
        expect(cols, `${heavy} 不該出現在 sitemap 的投影裡`).not.toContain(heavy);
      }
    }
  });

  // 🔴 [codex R2 must-fix:標題收窄] ⛔ ~~「與 listAllProducts() 走同一張表、同一個排序、同一套分頁」~~
  //   本格【只呼叫 listAllHandles】⇒ 改壞 listAllProducts 它照樣全綠
  //   ⇒ 📌 它證不到「兩者相同」, 只證得到「這一支自己對」。
  //   🔵 兩條路真的一起跑的是下面那格「產出等價」。
  it('🔴 只讀 products_public · 排序 id 升冪 · 分頁窗連續不重疊', async () => {
    const { client, rangeCalls, orderCalls } = makeClient([1000, 1000, 7], handleRow);
    await new SupabaseProductAdapter(client).listAllHandles();

    expect(orderCalls, '排序必須是 id 升冪(決定性;sitemap 每次產出要穩定)').toEqual([
      ['id', true], ['id', true], ['id', true],
    ]);
    // 分頁窗要連續、不重疊、不跳號
    expect(rangeCalls[0]![0]).toBe(0);
    for (let i = 1; i < rangeCalls.length; i += 1) {
      expect(rangeCalls[i]![0], `第 ${i} 頁的起點要接在上一頁的終點 +1`).toBe(rangeCalls[i - 1]![1] + 1);
    }
    // 🟢 最後一頁不滿 ⇒ 迴圈停;而它【真的停了】= 沒有第 4 次 range
    expect(rangeCalls.length).toBe(3);
  });

  it('🔴 回的是 handle 字串陣列, 順序 = DB 回的順序(不重排、不去重、不濾空)', async () => {
    // 🔴🔴 **[codex 2026-09-08 must-fix:第一版的 fixture 讓這個宣稱【證不到】]**
    //   ⛔ ~~fixture 是 `zz-0 / zz-1 / zz-2`(全唯一、全非空)~~
    //   🛑 那樣的話, 實作改成 `.filter(Boolean)` 或 `new Set(...)` **五格仍然全綠** ——
    //     📌 **標題說「不去重、不濾空」, 而 fixture 裡沒有重複也沒有空字串可以被去掉。**
    //   ✅ 現在 fixture 自己帶著那兩種東西:重複的 `dup` ×2、以及一個空字串。
    //   ⚠️ **空 handle 在現行 schema 下是合法的**(欄位允許)—— 而正式庫實查
    //     `handle IS NULL` 0 筆 / `handle = ''` 0 筆 / 共 26,402(2026-09-08 唯讀)
    //     ⇒ 今天不會發生, 而**本格守的是「哪天發生時實作不會自作主張」**。
    const rows = ['zz-0', 'dup', 'dup', '', 'zz-4'];
    const { client } = makeClient([rows.length], (i) => ({ id: `id-${i}`, handle: rows[i] }));
    const out = await new SupabaseProductAdapter(client).listAllHandles();
    expect(out, '順序 / 重複 / 空字串三者都要原封回來').toEqual(rows);
    expect(out.length, '去重了 ⇒ 長度會變成 4').toBe(5);
  });

  it('🟢 零列 ⇒ 空陣列, 不是 throw(sitemap 拿到空的要能自己處理)', async () => {
    const { client } = makeClient([0], handleRow);
    expect(await new SupabaseProductAdapter(client).listAllHandles()).toEqual([]);
  });

  it('🔴🔴 產出等價:與 listAllProducts() 對【同一批列】給出逐字相同的 handle 陣列', async () => {
    // 🎯 這是 A 案的驗收核心 —— 「換投影」不可以換掉任何一件商品。
    //   兩條路各自跑一次, 比字串陣列(比字串比比物件硬)。
    const pages = [1000, 512];
    const rich = (i: number) => ({
      id: `id-${String(i).padStart(6, '0')}`,
      handle: `p-${i}`,
      // listAllProducts 的 mapper 要的欄位, 給最小可用值(本格只比 handle)
      external_id: `E${i}`, title: `t${i}`, subtitle: '', description: '',
      fitments: [], images: [], availability: 'in-stock',
      brands: { id: 'b', name: 'B', slug: 'b' },
      categories: { raw_path: 'X', segments: ['X'] },
      price_general: 100, highlights: [], manuals: [], sound_clips: [],
      created_at: '2026-01-01T00:00:00+00', updated_at: '2026-01-01T00:00:00+00',
      product_variants_public: [],
    });
    const a = makeClient([...pages], rich);
    // 🔴 比的是 domain `Product.handle`(`packages/domain/src/catalog/types.ts:330`)——
    //   而 sitemap 舊路拿到的 `slug` 就是它:`apps/storefront/src/lib/products.ts:183`
    //   逐字 `slug: product.handle`, **沒有 fallback**。
    //   ⚠️ 別處有一個長得很像而【有 fallback】的:`lib/catalog-page.ts:102` 是 `row.handle ?? row.id`
    //     ⇒ 那是目錄卡片那條路, **不是 sitemap 這條** ⇒ 兩者不要混。
    //   (正式庫實查:`handle` 為 NULL 0 筆、空字串 0 筆 / 共 26,402 ⇒ 今天兩者不會分岔。)
    const fromProducts = (await new SupabaseProductAdapter(a.client).listAllProducts()).map((p) => p.handle);
    const b = makeClient([...pages], rich);
    const fromHandles = await new SupabaseProductAdapter(b.client).listAllHandles();

    expect(fromProducts.length, '前提:舊路真的回了列(0 的話下面那條恆真)').toBe(1512);
    expect(fromHandles).toEqual(fromProducts);
    // ⚪ 負對照:兩條路【不該】剛好都回空 —— 上面那條 length 已經擋住, 這裡再釘一次形狀
    expect(fromHandles[0]).toBe('p-0');
  });
});
