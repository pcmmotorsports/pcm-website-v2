// @vitest-environment node
//
// ⟦search-COUNTNULLCACHE⟧ 的守門 —— **「失敗不進快取」今天是一句【沒有人在檢查的註解】。**
//
// 🔴🔴 **本檔守的不是一個 bug, 是一句【宣稱】**:
//    `apps/storefront/src/lib/products.ts` 的 `fetchCatalogPage` 把 `try/catch` 寫在
//    `unstable_cache` 的**外面**, 而檔裡逐字寫著「失敗 throw 不進快取(在快取外 catch…)」。
//    🛑 **而那句話沒有任何東西在檢查。** 有人「整理」它、把 `catch` 搬進 `getCatalogPageCached`
//       裡面 ⇒ 那一發失敗會變成一個**被快取住的 `{error:true}`**
//       ⇒ 📌 **一次瞬時的 RPC 失敗會被釘在快取裡整個 TTL** —— 而畫面「件數未能載入」看起來
//         只是偶發, 沒有人會去看它為什麼一直不好。
//
// 🔬 **而板列那一段(線【前台】`-front` 量的)講的是同一族的另一半**:
//    快取住的**健康**答案會蓋住一個真的壞掉 —— 首頁看起來好好的, 而客人一翻頁就死。
//    ⇒ 🎯 兩件事同一個成因(快取記住了它不該記的那一種答案), 而**方向相反**:
//       那一半是「壞的被好的蓋住」, 本檔守的是「好的被壞的蓋住」。
//
// 🛑 **本檔【不是】對照 `products.test.ts`** —— 那支把 `unstable_cache` mock 成【直通】,
//    ⇒ 它的世界裡**根本沒有快取** ⇒ 它結構上驗不到「什麼東西進了快取」。
//    ⇒ 📌 本檔刻意把它 mock 成**真的會記住**, 那才是這一格要的世界。

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/** 一個【真的會記住】的 unstable_cache —— 而它就是本檔的世界。 */
const cacheStore = new Map<string, unknown>();
let innerCalls = 0;
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (cacheStore.has(key)) return cacheStore.get(key);
      const out = await fn(...args);
      cacheStore.set(key, out);
      return out;
    },
}));

const rpc = vi.fn();
vi.mock('@pcm/adapters', async () => {
  const real = await vi.importActual<typeof import('@pcm/adapters')>('@pcm/adapters');
  return {
    ...real,
    createSupabaseAnonClient: () => {
      innerCalls += 1;
      return { rpc } as never;
    },
  };
});

const { fetchCatalogPage } = await import('./products');
const { parseCatalogQuery } = await import('./catalog-query');

// 🔴 **query 用【真的 parseCatalogQuery】造, 不是我手打一個物件** ——
//    我第一版手打 `{ page: 1 }` ⇒ `query.brandSlugs.length` 當場 TypeError
//    ⇒ 那一發變成【另一種失敗】, 而「成功」那一格因此拿到 2 而不是 1。
//    🎯 **抓到它的是那格正對照** —— 它逐字說「這個 mock 沒有在記東西」, 而真相是
//       **我的『成功世界』根本不是成功**。⇒ 📌 正對照要挑一個【期待非零/期待成功】的形狀, 它才會替你把關。
const q = (page: number) =>
  parseCatalogQuery({ get: (k: string) => (k === 'page' ? String(page) : null) } as never);

beforeEach(() => {
  cacheStore.clear();
  innerCalls = 0;
  rpc.mockReset();
});

describe('⟦search-COUNTNULLCACHE⟧ 撈失敗【不得】被快取住', () => {
  it('🔴 RPC 失敗兩次 ⇒ 兩次都要真的去打 DB(失敗不得進快取)', async () => {
    rpc.mockRejectedValue(new Error('模擬:RPC 掛了'));
    const first = await fetchCatalogPage(q(1));
    const second = await fetchCatalogPage(q(1));
    expect(first.error, '第一發該回 error:true').toBe(true);
    expect(second.error, '第二發也該回 error:true').toBe(true);
    // 🎯 這一行就是整格的重點:失敗若被快取住, 第二發不會再建 client ⇒ innerCalls 停在 1。
    expect(
      innerCalls,
      '第二發沒有真的去打 DB ⇒ 那一發失敗【被快取住了】' +
        ' ⇒ 一次瞬時的 RPC 失敗會被釘在快取裡整個 TTL, 而畫面只看得到「件數未能載入」。' +
        ' ⇒ 檢查 fetchCatalogPage 的 try/catch 是不是被搬進 unstable_cache 裡面了。',
    ).toBe(2);
  });

  it('🟢 正對照:成功【要】被快取住 —— 否則上面那格與「這個 mock 根本沒在快取」印同一個綠', async () => {
    // 🔵 空清單也是【成功】(目錄真的沒東西時就是這個形狀)—— 而它不需要造假商品,
    //    也就不會踩到 catalogRowToUIProduct 讀 item.id 那條路。
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchCatalogPage(q(2));
    await fetchCatalogPage(q(2));
    expect(
      innerCalls,
      '成功也沒被快取 ⇒ 這個 mock 沒有在記東西 ⇒ 上面那格對「失敗有沒有被快取」零判別力',
    ).toBe(1);
  });

  it('🔵 前提 — products.ts 的那句宣稱還在(它是本檔存在的理由)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./products.ts', import.meta.url), 'utf8');
    expect(
      src.includes('失敗 throw 不進快取'),
      '那句宣稱被改掉了 ⇒ 回來確認本檔守的還是不是同一件事',
    ).toBe(true);
  });
});
