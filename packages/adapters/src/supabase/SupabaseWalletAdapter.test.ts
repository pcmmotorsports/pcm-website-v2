import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseWalletAdapter } from './SupabaseWalletAdapter';

/**
 * `SupabaseWalletAdapter.listEntries` 的分頁守門（2026-08-17）。
 *
 * 🔴 **本檔是新增的 —— 在此之前 `SupabaseWalletAdapter` 沒有任何測試檔。**
 * 數法（改動前）:`git ls-files | grep -i wallet` 命中 4 支測試，
 * 分別是 use-case / admin 表單 / mapper / storefront 分頁 ⇒ **沒有一支在測這個 adapter**。
 *
 * 本檔只測 `listEntries`（本次改動面）。`addEntry` / `getBalance` 仍無測試 —— **不假裝補齊了。**
 */

type LedgerRow = {
  id: string;
  customer_user_id: string;
  entry_date: string;
  entry_type: string;
  amount: number;
  note: string | null;
  related_order_id: string | null;
  created_at: string;
};

const row = (i: number): LedgerRow => ({
  id: `w-${String(i).padStart(5, '0')}`,
  customer_user_id: 'cust-1',
  entry_date: '2026-08-17',
  entry_type: 'deposit',
  amount: 100,
  note: null,
  related_order_id: null,
  created_at: '2026-08-17T00:00:00.000Z',
});

/** 模擬 PostgREST:`.range(from,to)` 兩端皆含；`count` 由伺服器對整個篩選集算。 */
function makeReadClient(allRows: LedgerRow[]) {
  const captured: {
    orders: [string, boolean][];
    range?: [number, number];
    countOption?: string;
    eqs: [string, unknown][];
  } = { orders: [], eqs: [] };
  const builder = {
    select(_cols: string, options?: { count?: string }) {
      captured.countOption = options?.count;
      return builder;
    },
    eq(col: string, val: unknown) {
      captured.eqs.push([col, val]);
      return builder;
    },
    order(col: string, o?: { ascending?: boolean }) {
      captured.orders.push([col, o?.ascending !== false]);
      return builder;
    },
    range(from: number, to: number) {
      captured.range = [from, to];
      // 🔴 只回落在該會員條件內的列 —— 這樣「拿掉 .eq」才會被測出來。
      const mine = allRows.filter(
        (r) => !captured.eqs.length || captured.eqs.some(([c, v]) => c !== 'customer_user_id' || r.customer_user_id === v),
      );
      return Promise.resolve({
        data: mine.slice(from, to + 1),
        error: null,
        // 🔴 真的模擬 PostgREST:**沒有要求 `count:'exact'` 就不會回 count**
        //    (codex 2026-08-17:上一版 mock 無條件回數 ⇒「一頁＋總數」那格沒有判別力)。
        count: captured.countOption === 'exact' ? mine.length : null,
      });
    },
  };
  return { client: { from: () => builder } as unknown as SupabaseClient, captured };
}

const writeClient = {} as SupabaseClient;

describe('SupabaseWalletAdapter.listEntries — 分頁顯示（2026-08-17 第四版）', () => {
  it('回傳的是【一頁】+ 伺服器算的總數，不是全部', async () => {
    const { client } = makeReadClient(Array.from({ length: 1500 }, (_, i) => row(i)));
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    const res = await adapter.listEntries('cust-1', { limit: 20, offset: 0 });

    // 🔴 1500 筆母體、只回 20 筆，而 total 是 1500
    //    ⇒ 舊版會靜默停在 db-max-rows；本版根本不撈那麼多，且畫面知道總共有幾筆
    expect(res.items).toHaveLength(20);
    expect(res.total).toBe(1500);
  });

  it('.range 兩端皆含 —— offset 40 + limit 20 ⇒ [40, 59] 而不是 [40, 60]', async () => {
    const { client, captured } = makeReadClient(Array.from({ length: 100 }, (_, i) => row(i)));
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    await adapter.listEntries('cust-1', { limit: 20, offset: 40 });

    expect(captured.range).toEqual([40, 59]);
  });

  it('要 count:exact —— 沒有它就沒有「共 N 筆」，整個第四條路不成立', async () => {
    const { client, captured } = makeReadClient([row(0)]);
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    await adapter.listEntries('cust-1', { limit: 20 });

    expect(captured.countOption).toBe('exact');
  });

  it('排序帶唯一鍵 id 當 tiebreaker（entry_date / created_at 都可能撞值）', async () => {
    const { client, captured } = makeReadClient([row(0), row(1)]);
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    await adapter.listEntries('cust-1', { limit: 20 });

    expect(captured.orders).toEqual([
      ['entry_date', false],
      ['created_at', false],
      ['id', false],
    ]);
  });

  it('🔴 只讀該會員的列 —— 拿掉 customer_user_id 條件必須被測出來', async () => {
    // codex 2026-08-17 抓到:上一版 mock 的 .eq() 不過濾也不記參數
    // ⇒ 把這個條件刪掉，測試仍會全綠 ⇒ 跨會員資料洩漏測不出來。本格是那條的補洞。
    const mine = Array.from({ length: 3 }, (_, i) => row(i));
    const others = Array.from({ length: 7 }, (_, i) => ({
      ...row(100 + i),
      customer_user_id: 'cust-OTHER',
    }));
    const { client, captured } = makeReadClient([...mine, ...others]);
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    const res = await adapter.listEntries('cust-1', { limit: 20 });

    expect(captured.eqs).toContainEqual(['customer_user_id', 'cust-1']);
    expect(res.total).toBe(3);
    expect(res.items.every((e) => e.customerUserId === 'cust-1')).toBe(true);
  });

  it('offset 省略 ⇒ 視為 0（第 1 頁）', async () => {
    const { client, captured } = makeReadClient([row(0)]);
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    await adapter.listEntries('cust-1', { limit: 20 });

    expect(captured.range).toEqual([0, 19]);
  });
});

describe('SupabaseWalletAdapter.listEntries — count 缺席時不假裝有總數', () => {
  it('🔴 伺服器沒回 count → throw，不回傳「20 筆 / 共 0 筆」的假帳', async () => {
    // codex 2026-08-17：`count ?? 0` 會讓 items 有資料而 total=0 ⇒ 畫面出現自相矛盾的帳。
    const rows = Array.from({ length: 5 }, (_, i) => row(i));
    const client = {
      from: () => {
        const b = {
          select: () => b,
          eq: () => b,
          order: () => b,
          // 不回 count（模擬沒帶 count:'exact' 或伺服器未提供）
          range: () => Promise.resolve({ data: rows, error: null, count: null }),
        };
        return b;
      },
    } as unknown as SupabaseClient;
    const adapter = new SupabaseWalletAdapter(client, writeClient);

    await expect(adapter.listEntries('cust-1', { limit: 20 })).rejects.toThrow(
      /沒有回傳總筆數/,
    );
  });
});
