import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let authed: { sid: string; actorId: string } | null = { sid: 's1', actorId: 'staff_a' };
const setProductCategory = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: async () => authed }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./product-repository', () => ({ setProductCategory: (a: unknown) => setProductCategory(a) }));

const { setProductCategoryAction } = await import('./product-category-actions');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  authed = { sid: 's1', actorId: 'staff_a' };
  setProductCategory.mockReset();
  setProductCategory.mockResolvedValue([{ productId: id(1), outcome: 'UPDATED' }]);
});

describe('商品頁乙 C3:改分類 server action', () => {
  it('操作人取自 session,不收前端傳來的;重複的商品先去掉', async () => {
    const r = await setProductCategoryAction({ productIds: [id(1), id(1)], categoryId: CAT, unlock: false });
    expect(r.ok).toBe(true);
    expect(setProductCategory).toHaveBeenCalledWith({
      productIds: [id(1)], categoryId: CAT, unlock: false, actor: 'staff_a', requestId: 'req-1',
    });
  });

  it('沒登入 ⇒ 不呼叫資料庫', async () => {
    authed = null;
    const r = await setProductCategoryAction({ productIds: [id(1)], categoryId: CAT, unlock: false });
    expect(r).toEqual({ ok: false, message: '沒有權限改分類，請重新登入後再試。' });
    expect(setProductCategory).not.toHaveBeenCalled();
  });

  it('超過 200 件、空清單、不是 uuid、分類不是 uuid、解鎖卻帶分類、設定沒帶分類 ⇒ 都不呼叫資料庫', async () => {
    const many = Array.from({ length: 201 }, (_, i) => id(i + 1));
    expect(await setProductCategoryAction({ productIds: many, categoryId: CAT, unlock: false })).toEqual({ ok: false, message: '一次最多改 200 件，請縮小範圍後再試。' });
    expect((await setProductCategoryAction({ productIds: [], categoryId: CAT, unlock: false })).ok).toBe(false);
    expect((await setProductCategoryAction({ productIds: ['x'], categoryId: CAT, unlock: false })).ok).toBe(false);
    expect((await setProductCategoryAction({ productIds: [id(1)], categoryId: 'not-a-uuid', unlock: false })).ok).toBe(false);
    expect((await setProductCategoryAction({ productIds: [id(1)], categoryId: CAT, unlock: true })).ok).toBe(false);
    expect((await setProductCategoryAction({ productIds: [id(1)], categoryId: null, unlock: false })).ok).toBe(false);
    expect(setProductCategory).not.toHaveBeenCalled();
    // 剛好 200 件可以
    const max = Array.from({ length: 200 }, (_, i) => id(i + 1));
    expect((await setProductCategoryAction({ productIds: max, categoryId: CAT, unlock: false })).ok).toBe(true);
  });

  it('瀏覽器送來的形狀不對 ⇒ 拒絕,不丟錯、不寫入(unlock 必須是真正的布林)', async () => {
    const bad = setProductCategoryAction as (x: unknown) => Promise<{ ok: boolean }>;
    expect((await bad(null)).ok).toBe(false);
    expect((await bad({ productIds: [id(1)], categoryId: CAT, unlock: 'true' })).ok).toBe(false);
    // 🔴 falsy 的非布林值才守得住 typeof 檢查('true' 會走解鎖分支,因為帶了分類而被拒,守不到;Fable R2 nit)
    expect((await bad({ productIds: [id(1)], categoryId: CAT, unlock: 0 })).ok).toBe(false);
    expect((await bad({ productIds: id(1), categoryId: CAT, unlock: false })).ok).toBe(false);
    expect(setProductCategory).not.toHaveBeenCalled();
  });

  it('「改回由同步決定」:不帶分類、unlock=true ⇒ 照送;前端夾帶的 actor 不採用', async () => {
    const input = { productIds: [id(1)], categoryId: null, unlock: true, actor: 'someone_else' } as never;
    const r = await setProductCategoryAction(input);
    expect(r).toEqual({ ok: true, results: [{ productId: id(1), outcome: 'UPDATED' }] });
    expect(setProductCategory).toHaveBeenCalledWith({
      productIds: [id(1)], categoryId: null, unlock: true, actor: 'staff_a', requestId: 'req-1',
    });
  });

  it('資料庫的錯誤對應到員工看得懂的話;原因不明不說「失敗」', async () => {
    const cases: [string, string][] = [
      ['無權執行此操作', '沒有權限改分類，請重新登入後再試。'],
      ['商品正在更新,請稍後再試', '商品正在更新，請稍後再試。'],
      ['admin_set_product_category: 分類不存在', '選的商品或分類有問題，請重新整理後再試。'],
      ['fetch failed', '無法確認分類是否已儲存，請重新整理頁面確認目前的分類。'],
    ];
    for (const [dbMessage, shown] of cases) {
      setProductCategory.mockRejectedValueOnce(new Error(dbMessage));
      expect(await setProductCategoryAction({ productIds: [id(1)], categoryId: CAT, unlock: false })).toEqual({ ok: false, message: shown });
    }
  });
});
