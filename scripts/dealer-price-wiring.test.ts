import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 **A2 的【接線】測試** —— 不是判定邏輯(那在 `dealer-price-gate.test.ts`),
 *   是「判了之後真的有跳過嗎」。這一層原本沒有任何測試守著。
 * 🛑 判定對而接線斷掉時,**每一格都會綠** —— 那正是這支要擋的。
 */

type Row = Record<string, unknown>;

/** 極簡 mock:記下每一次 `.from(table)` 與 select 的結果,讓測試能問「它讀了誰、讀了幾次」。 */
function mockClient(opts: { variants?: Row[] | 'fail'; products?: Row[] | 'fail' }) {
  const calls: string[] = [];
  const make = (table: string) => {
    const data = table === 'product_variants' ? opts.variants : opts.products;
    const fail = data === 'fail';
    const rows = Array.isArray(data) ? data : [];
    const b: Record<string, unknown> = {};
    const self = () => b;
    // 🔴 真實鏈是 `.select(head).eq(...)` —— **head 的 Promise 在 `.eq` 之後**,
    //   我第一版把它掛在 `.select` 上 ⇒ `.eq` 拿不到 ⇒ 讀成失敗 ⇒ 那一格假紅。
    //   📌 mock 造錯與行為不符長得一樣;是「印出 degraded」這行 log 讓我分得出來。
    let head = false;
    b.select = (_c?: string, o?: { head?: boolean }) => {
      head = Boolean(o?.head);
      calls.push(`${table}.select${head ? '(count)' : ''}`);
      return b;
    };
    b.eq = () =>
      head
        ? Promise.resolve({ count: fail ? null : rows.length, error: fail ? { message: 'boom' } : null })
        : b;
    b.order = self;
    b.range = () => Promise.resolve({ data: fail ? null : rows, error: fail ? { message: 'boom' } : null });
    return b;
  };
  return { client: { from: (t: string) => make(t) } as never, calls };
}

const ENV = { ...process.env };
beforeEach(() => { vi.resetModules(); });
afterEach(() => { process.env = { ...ENV }; });

describe('接線① allowlist 空 ⇒ 上游零呼叫、兩層 untouched', () => {
  it('不叫上游, 兩層各帶自己的舊值', async () => {
    process.env.DEALER_PRICE_SUPPLIERS = '';
    process.env.DEALER_PRICE_DATABASE_URL = 'postgres://should-not-be-used';
    const src = await import('./dealer-price-source');
    const spy = vi.spyOn(src, 'fetchUpstreamDealerPrices');
    const { decideDealerPrice } = await import('./rpm-import');
    const { client } = mockClient({
      variants: [{ sku: 'A', price_store: 87 }],
      products: [{ external_id: 'G1', price_by_tier: { store: { amount: 555 } } }],
    });
    const r = await decideDealerPrice(client, 'rpm');
    expect(spy).not.toHaveBeenCalled();          // 🔴 上游【零呼叫】
    expect(r.dealerPrice.kind).toBe('untouched');
    expect(r.skipVariantSync).toBe(false);
    expect(r.skipProductSync).toBe(false);
  });
});

describe('接線② 變體舊值讀漏 ⇒ A2、跳過變體、degraded', () => {
  it('skipVariantSync = true 且 dealerAction = A2', async () => {
    process.env.DEALER_PRICE_SUPPLIERS = '';
    const { decideDealerPrice } = await import('./rpm-import');
    const { client } = mockClient({ variants: 'fail', products: [] });
    const r = await decideDealerPrice(client, 'rpm');
    expect(r.dealerAction).toBe('A2_skip_family');
    expect(r.skipVariantSync).toBe(true);        // 🔴 判了【而且真的跳】
  });
});

describe('接線③ 商品層讀失敗 ⇒ 商品層也跳過(那個蓋掉是永久的)', () => {
  it('skipProductSync = true', async () => {
    process.env.DEALER_PRICE_SUPPLIERS = '';
    const { decideDealerPrice } = await import('./rpm-import');
    const { client } = mockClient({ variants: [{ sku: 'A', price_store: 1 }], products: 'fail' });
    const r = await decideDealerPrice(client, 'rpm');
    expect(r.skipProductSync).toBe(true);
    expect(r.dealerAction).toBe('A2_skip_family');
  });
});

describe('🔴 首灌與日常同步分得開(codex 窄審 must-fix)', () => {
  it('本站零經銷價 + 沒帶 checksum ⇒ 不寫新值(A1 帶舊值)', async () => {
    // 🛑 沒有這一格, allowlist 一開排程就可能先於人工核准那一發寫入 ⇒ 綁定被繞過
    process.env.DEALER_PRICE_SUPPLIERS = 'rpm';
    process.env.DEALER_PRICE_DATABASE_URL = 'postgres://x';
    process.env.DEALER_PRICE_EXPECT_CHECKSUM = '';
    const src = await import('./dealer-price-source');
    vi.spyOn(src, 'fetchUpstreamDealerPrices').mockResolvedValue({
      ok: true, rows: [{ supplier_slug: 'rpm', sku: 'A', price_store: 87 }],
    });
    const { decideDealerPrice } = await import('./rpm-import');
    const { client } = mockClient({
      variants: [{ sku: 'A', price_store: null }], // ← 一筆經銷價都沒有 = 首灌
      products: [{ external_id: 'G1', price_by_tier: { store: { amount: 100 } } }],
    });
    const r = await decideDealerPrice(client, 'rpm');
    expect(r.dealerPrice.kind).toBe('carry_old'); // 🔴 不是 from_upstream ⇒ 沒寫新值
  });

  it('🔵 本站已有經銷價 + 沒帶 checksum ⇒ 日常同步, 照常跟上游', async () => {
    process.env.DEALER_PRICE_SUPPLIERS = 'rpm';
    process.env.DEALER_PRICE_DATABASE_URL = 'postgres://x';
    process.env.DEALER_PRICE_EXPECT_CHECKSUM = '';
    const src = await import('./dealer-price-source');
    vi.spyOn(src, 'fetchUpstreamDealerPrices').mockResolvedValue({
      ok: true, rows: [{ supplier_slug: 'rpm', sku: 'A', price_store: 87 }],
    });
    const { decideDealerPrice } = await import('./rpm-import');
    const { client } = mockClient({
      variants: [{ sku: 'A', price_store: 3400 }], // ← 已經有 = 已啟用
      products: [{ external_id: 'G1', price_by_tier: { store: { amount: 100 } } }],
    });
    const r = await decideDealerPrice(client, 'rpm');
    expect(r.dealerPrice.kind).toBe('from_upstream');
  });
});
