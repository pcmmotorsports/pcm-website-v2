import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let authed: { sid: string; actorId: string } | null = { sid: 's1', actorId: 'staff_a' };
const setProductListing = vi.fn();
const collision = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: async () => authed }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./variant-sku-collision', () => ({ findVariantSkuCollisionOrUnavailable: (id: string) => collision(id) }));
vi.mock('./product-repository', () => ({
  setProductListing: (a: unknown) => setProductListing(a),
  listProductListingStates: async () => [],
  displayTitle: (r: { title: string; override_title: string | null }) => r.override_title ?? r.title,
}));

const { setProductListingBatchAction } = await import('./product-listing-batch-actions');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  authed = { sid: 's1', actorId: 'staff_a' };
  setProductListing.mockReset();
  setProductListing.mockResolvedValue('UPDATED');
  collision.mockReset();
  collision.mockResolvedValue(null);
});

describe('商品頁乙 A7:批次上下架 server action', () => {
  it('下架:逐件呼叫、操作人取自 session、不跑規格料號檢查;結果逐件對應', async () => {
    setProductListing.mockResolvedValueOnce('UPDATED').mockResolvedValueOnce('NO_CHANGE').mockResolvedValueOnce('NOT_FOUND');
    const r = await setProductListingBatchAction({ productIds: [id(1), id(2), id(3)], delisted: true });
    expect(r).toEqual({ ok: true, results: [
      { productId: id(1), outcome: 'UPDATED' }, { productId: id(2), outcome: 'NO_CHANGE' }, { productId: id(3), outcome: 'NOT_FOUND' },
    ] });
    expect(setProductListing).toHaveBeenCalledWith({ productId: id(1), delisted: true, note: null, actor: 'staff_a', requestId: 'req-1', signal: expect.any(AbortSignal) });
    expect(collision).not.toHaveBeenCalled();
  });

  it('上架:規格料號疑似屬於別件、或檢查查不出來 ⇒ 列為「需要逐件確認」,不上架', async () => {
    collision.mockResolvedValueOnce({ externalId: 'X', belongsToExternalId: 'Y' }).mockResolvedValueOnce('unavailable').mockResolvedValueOnce(null);
    const r = await setProductListingBatchAction({ productIds: [id(1), id(2), id(3)], delisted: false });
    expect(r.ok && r.results.map((x) => x.outcome)).toEqual(['NEEDS_REVIEW', 'NEEDS_REVIEW', 'UPDATED']);
    expect(setProductListing).toHaveBeenCalledTimes(1);
  });

  it('資料庫明確拒絕 = 沒有成功;連線中斷 = 結果未確認;出錯之後其他件照常做', async () => {
    setProductListing
      .mockRejectedValueOnce(Object.assign(new Error('無權執行此操作'), { code: 'P0001' }))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: '08006' }))
      .mockResolvedValueOnce('UPDATED');
    const r = await setProductListingBatchAction({ productIds: [id(1), id(2), id(3), id(4)], delisted: true });
    // 連線類錯誤碼也是「不知道」,不是「沒有成功」
    expect(r.ok && r.results.map((x) => x.outcome)).toEqual(['FAILED', 'UNCONFIRMED', 'UNCONFIRMED', 'UPDATED']);
  });

  it('一次超過 50 件、形狀不對、沒登入 ⇒ 不呼叫資料庫', async () => {
    const bad = setProductListingBatchAction as (x: unknown) => Promise<{ ok: boolean }>;
    expect((await bad({ productIds: Array.from({ length: 51 }, (_, i) => id(i + 1)), delisted: true })).ok).toBe(false);
    expect((await bad({ productIds: [id(1)], delisted: 0 })).ok).toBe(false);
    expect((await bad({ productIds: ['x'], delisted: true })).ok).toBe(false);
    authed = null;
    expect((await bad({ productIds: [id(1)], delisted: true })).ok).toBe(false);
    expect(setProductListing).not.toHaveBeenCalled();
  });
});

describe('商品頁乙 A7:時間預算(第一輪審查必修 3)', () => {
  it('規格檢查做完已經超過 45 秒 ⇒ 不寫入,標「尚未執行」', async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    collision.mockImplementation(async () => {
      now += 46_000;
      return null;
    });
    const r = await setProductListingBatchAction({ productIds: [id(1), id(2)], delisted: false });
    expect(r.ok && r.results.map((x) => x.outcome)).toEqual(['NOT_RUN', 'NOT_RUN']);
    expect(setProductListing).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('寫入帶著期限(等太久就放棄 ⇒ 結果未確認)', async () => {
    await setProductListingBatchAction({ productIds: [id(1)], delisted: true });
    expect((setProductListing.mock.calls[0]![0] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
