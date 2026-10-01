import { afterEach, describe, expect, it, vi } from 'vitest';

// 貼板 261:客人頁新增蝦皮帳號撞到唯一索引時, 要分得出「這位客人已經有」與「記在別的客人身上」。
const mocks = vi.hoisted(() => ({ insert: vi.fn(), lookup: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      insert: mocks.insert,
      select: () => ({ ilike: (_c: string, v: string) => ({ limit: () => mocks.lookup(v) }) }),
    }),
  }),
}));

import { addShopeeAccount } from './shopee-accounts';

afterEach(() => vi.clearAllMocks());

const ME = 'c0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000002';

describe('addShopeeAccount', () => {
  it('寫進去 ⇒ added', async () => {
    mocks.insert.mockResolvedValue({ error: null });
    await expect(addShopeeAccount(ME, 'moto_wang', 'sean')).resolves.toBe('added');
  });

  it('🔴 撞唯一索引而帳號是自己的 ⇒ exists', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.lookup.mockResolvedValue({ data: [{ customer_user_id: ME, account: 'moto_wang' }], error: null });
    await expect(addShopeeAccount(ME, 'Moto_Wang', 'sean')).resolves.toBe('exists');
  });

  it('🔴 撞唯一索引而帳號是別人的 ⇒ taken', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.lookup.mockResolvedValue({ data: [{ customer_user_id: OTHER, account: 'Moto_Wang' }], error: null });
    await expect(addShopeeAccount(ME, 'moto_wang', 'sean')).resolves.toBe('taken');
  });

  it('查詢用的字串把 % 與 _ 跳脫(不然 a_b 會比對到 axb)', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.lookup.mockResolvedValue({ data: [{ customer_user_id: ME, account: 'a_b%c' }], error: null });
    await addShopeeAccount(ME, 'a_b%c', 'sean');
    expect(mocks.lookup).toHaveBeenCalledWith('a\\_b\\%c');
  });

  it('🔴 帳號含 * (PostgREST 當萬用字元)查回多筆 ⇒ 比完整帳號, 不被別人的 motoabc 誤導', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.lookup.mockResolvedValue({
      data: [{ customer_user_id: OTHER, account: 'motoabc' }, { customer_user_id: ME, account: 'MOTO*' }],
      error: null,
    });
    await expect(addShopeeAccount(ME, 'moto*', 'sean')).resolves.toBe('exists');
  });

  it('查回來沒有完全相同的帳號(剛被刪)⇒ error', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    await expect(addShopeeAccount(ME, 'moto', 'sean')).resolves.toBe('error');
  });

  it('客人不存在(外鍵)⇒ not_found;其他錯 ⇒ error', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23503' } });
    await expect(addShopeeAccount(ME, 'x', 'sean')).resolves.toBe('not_found');
    mocks.insert.mockResolvedValue({ error: { code: '42501' } });
    await expect(addShopeeAccount(ME, 'x', 'sean')).resolves.toBe('error');
  });
});
