import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let authed: { sid: string; actorId: string } | null = { sid: 's1', actorId: 'staff_a' };
let source: { actor: { id: string } | null; source: string } = { actor: { id: 'staff_a' }, source: 'ticket' };
const create = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: async () => authed }));
vi.mock('../session/actor', () => ({ getSessionActorWithSource: async () => source }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./product-repository', () => ({ createManualProduct: (a: unknown) => create(a) }));

const { createManualProductAction } = await import('./manual-product-actions');
const B = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const base = () => ({
  brandId: B,
  categoryId: C,
  title: '  手動排氣管  ',
  subtitle: '',
  description: '',
  variants: [{ sku: 'pcm-ex-01', label: '亮面', priceGeneral: 5000, priceStore: null, availability: 'in-stock' as const }],
});

beforeEach(() => {
  authed = { sid: 's1', actorId: 'staff_a' };
  source = { actor: { id: 'staff_a' }, source: 'ticket' };
  create.mockReset();
  create.mockResolvedValue('00000000-0000-4000-8000-000000000001');
});

describe('商品頁乙 P5:新增手動商品 server action', () => {
  it('料號轉大寫、標題去空白、操作人取自 session;成功回新商品 id', async () => {
    expect(await createManualProductAction(base())).toEqual({ ok: true, productId: '00000000-0000-4000-8000-000000000001' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: '手動排氣管',
      actor: 'staff_a',
      requestId: 'req-1',
      variants: [{ sku: 'PCM-EX-01', label: '亮面', price_general: 5000, price_store: null, availability: 'in-stock' }],
    }));
  });

  it('🔴 不是登入票證上的身分(自選身分、舊票)⇒ 不建立,請重新登入', async () => {
    source = { actor: { id: 'staff_a' }, source: 'self-selected' };
    const r = await createManualProductAction(base());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('重新登入');
    expect(create).not.toHaveBeenCalled();
  });

  it('料號規則同報價單圖庫:.. 、只有符號、空白都拒;一般價要是整數;料號或名稱重複都拒', async () => {
    const bad = [
      { ...base(), variants: [{ ...base().variants[0]!, sku: 'A..B' }] },
      { ...base(), variants: [{ ...base().variants[0]!, sku: '---' }] },
      { ...base(), variants: [{ ...base().variants[0]!, sku: 'A B' }] },
      { ...base(), variants: [{ ...base().variants[0]!, priceGeneral: 10.5 }] },
      { ...base(), variants: [{ ...base().variants[0]!, priceGeneral: -1 }] },
      { ...base(), variants: [base().variants[0]!, { ...base().variants[0]!, sku: 'PCM-EX-01', label: '霧面' }] },
      { ...base(), variants: [base().variants[0]!, { ...base().variants[0]!, sku: 'X2' }] },
      { ...base(), variants: [] },
      { ...base(), title: '   ' },
    ];
    for (const input of bad) expect((await createManualProductAction(input)).ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('資料庫拒絕 ⇒ 說明原因;連線中斷 ⇒ 不說失敗,請先搜尋確認', async () => {
    create.mockRejectedValueOnce(new Error('admin_create_manual_product: 料號已經有商品在用:PCM-EX-01'));
    expect(await createManualProductAction(base())).toEqual({ ok: false, message: '沒有建立：料號已經有商品在用：PCM-EX-01。' });
    create.mockRejectedValueOnce(new Error('fetch failed'));
    const r = await createManualProductAction(base());
    expect(!r.ok && r.message).toContain('無法確認商品是否已建立');
  });
});
