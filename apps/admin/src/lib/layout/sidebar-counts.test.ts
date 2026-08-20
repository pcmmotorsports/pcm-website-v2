import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  listRefundExceptions: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));
vi.mock('../payment/refund-read', () => ({
  listRefundExceptions: mocks.listRefundExceptions,
}));

import { loadSidebarCounts } from './sidebar-counts';

// sidebar-counts.test.ts — W1-077:側欄三格的查詢形狀與逐格失敗守門。
// 同構 `../dashboard/today-read.test.ts` 的鏈式 mock 手法(替身只證「本層送出什麼形狀」,
// 不證 PostgREST/DB 行為)。

type ChainResult = { count?: number; error?: unknown };

function makeChain(result: ChainResult) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const fn of ['select', 'eq', 'is']) {
    chain[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: null, count: result.count ?? null, error: result.error ?? null });
  return { chain, calls };
}

type Over = {
  orderCount?: number | null;
  orderError?: unknown;
  productCount?: number | null;
  productError?: unknown;
  exceptionsRows?: unknown[];
  exceptionsTruncated?: boolean;
  exceptionsReject?: unknown;
};

function setup(over: Over = {}) {
  const orders = makeChain({ count: over.orderCount ?? undefined, error: over.orderError });
  const products = makeChain({ count: over.productCount ?? undefined, error: over.productError });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'admin_order_list_v') return orders.chain;
    if (table === 'products') return products.chain;
    throw new Error(`未預期的 table:${table}`);
  });
  if (over.exceptionsReject) {
    mocks.listRefundExceptions.mockRejectedValue(over.exceptionsReject);
  } else {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: over.exceptionsRows ?? [],
      truncated: over.exceptionsTruncated ?? false,
    });
  }
  return { orders, products };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadSidebarCounts — 查詢形狀', () => {
  it('訂單那格:goods_axis=none 且 cancelled_at is null,count exact head', async () => {
    const { orders } = setup({ orderCount: 7 });
    const out = await loadSidebarCounts();
    expect(orders.calls).toContainEqual({
      fn: 'select',
      args: ['id', { count: 'exact', head: true }],
    });
    expect(orders.calls).toContainEqual({ fn: 'eq', args: ['goods_axis', 'none'] });
    expect(orders.calls).toContainEqual({ fn: 'is', args: ['cancelled_at', null] });
    expect(out.unorderedOrderCount).toBe(7);
  });

  it('商品那格:availability=out-of-stock 且 delisted_at is null,count exact head', async () => {
    const { products } = setup({ productCount: 4 });
    const out = await loadSidebarCounts();
    expect(products.calls).toContainEqual({
      fn: 'select',
      args: ['id', { count: 'exact', head: true }],
    });
    expect(products.calls).toContainEqual({ fn: 'eq', args: ['availability', 'out-of-stock'] });
    // 🔴 code-reviewer 抓到的 Important finding:已下架的商品不算「缺貨」——
    //    `delisted_at IS NULL` 是全站既有慣例(`product-repository.ts` 的 `resolveListingState`),
    //    少這個條件會把已下架、不可能被賣的商品也算進這個「需要員工處理」的徽章。
    expect(products.calls).toContainEqual({ fn: 'is', args: ['delisted_at', null] });
    expect(out.outOfStockProductCount).toBe(4);
  });

  it('退款異常沿用 listRefundExceptions(),不另查 order_refunds', async () => {
    setup({ exceptionsRows: [{}, {}, {}], exceptionsTruncated: false });
    const out = await loadSidebarCounts();
    expect(mocks.listRefundExceptions).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalledWith('order_refunds');
    expect(out.refundExceptionCount).toBe(3);
  });

  it('🔴 truncated=true 原樣透傳,不在本層被吃掉', async () => {
    setup({ exceptionsRows: [{}], exceptionsTruncated: true });
    const out = await loadSidebarCounts();
    expect(out.refundExceptionTruncated).toBe(true);
  });
});

describe('loadSidebarCounts — 各格各自獨立失敗', () => {
  it('訂單掛 ⇒ 只有訂單是 null,其餘照常', async () => {
    setup({ orderError: new Error('boom'), productCount: 2, exceptionsRows: [] });
    const out = await loadSidebarCounts();
    expect(out.unorderedOrderCount).toBeNull();
    expect(out.outOfStockProductCount).toBe(2);
    expect(out.refundExceptionCount).toBe(0);
  });

  it('商品掛 ⇒ 只有商品是 null', async () => {
    setup({ productError: new Error('boom'), orderCount: 1 });
    const out = await loadSidebarCounts();
    expect(out.outOfStockProductCount).toBeNull();
    expect(out.unorderedOrderCount).toBe(1);
  });

  it('退款異常 reject ⇒ 只有那格 null', async () => {
    setup({ exceptionsReject: new Error('boom'), orderCount: 1, productCount: 2 });
    const out = await loadSidebarCounts();
    expect(out.refundExceptionCount).toBeNull();
    expect(out.refundExceptionTruncated).toBe(false);
    expect(out.unorderedOrderCount).toBe(1);
    expect(out.outOfStockProductCount).toBe(2);
  });

  it('🔴 count 是 undefined(欄根本沒回來)⇒ 那格是 null,不是 0', async () => {
    setup({});
    const out = await loadSidebarCounts();
    expect(out.unorderedOrderCount).toBeNull();
    expect(out.outOfStockProductCount).toBeNull();
  });

  it('✅ 正向對照:count 真的是 0 ⇒ 顯示 0、不算失敗(否則上一格是恆真的)', async () => {
    setup({ orderCount: 0, productCount: 0, exceptionsRows: [] });
    const out = await loadSidebarCounts();
    expect(out.unorderedOrderCount).toBe(0);
    expect(out.outOfStockProductCount).toBe(0);
  });
});

describe('loadSidebarCounts — syncedAt(三態的機制)', () => {
  it('三支全成功 ⇒ syncedAt 是有效 ISO 字串', async () => {
    setup({ orderCount: 0, productCount: 0, exceptionsRows: [] });
    const out = await loadSidebarCounts();
    expect(out.syncedAt).not.toBeNull();
    expect(new Date(out.syncedAt as string).toString()).not.toBe('Invalid Date');
  });

  it('🔴 任一支失敗 ⇒ syncedAt 是 null(不得印出一個舊/假時間戳)', async () => {
    setup({ orderError: new Error('boom'), productCount: 0, exceptionsRows: [] });
    const out = await loadSidebarCounts();
    expect(out.syncedAt).toBeNull();
  });
});
