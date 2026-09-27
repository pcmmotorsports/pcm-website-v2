// 商品文字一次儲存(商品頁改版乙 B3;計畫 ~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第五節)。
// 守的是:登入與 Origin 由 authorizeAdminMutation 擋、操作人取自 session、request id 由 server 產生、
// 後端仍逐欄呼叫 admin_set_product_override(逐欄留紀錄)、有一欄沒存成功時講清楚是哪一欄、不 redirect(存完停在原位)。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const revalidatePath = vi.fn();
const setProductOverride = vi.fn(async (_args: unknown) => 'UPDATED' as string);
let authed: { sid: string; actorId: string } | null = { sid: 'sid', actorId: 'actor' };

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: async () => authed }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./product-repository', () => ({ setProductOverride: (a: unknown) => setProductOverride(a) }));

const { saveProductTextAction } = await import('./product-overrides-actions');
const f = await import('./product-overrides-form');

const PID = '11111111-2222-3333-4444-555555555555';
const IDLE = { kind: 'idle' } as const;

function form(v: { title?: string; subtitle?: string; highlights?: string[]; actor?: string } = {}): FormData {
  const fd = new FormData();
  fd.set(f.OVERRIDE_PRODUCT_ID_FIELD, PID);
  fd.set(f.OVERRIDE_TITLE_FIELD, v.title ?? '我們的標題');
  fd.set(f.OVERRIDE_SUBTITLE_FIELD, v.subtitle ?? '');
  for (const h of v.highlights ?? ['a']) fd.append(f.OVERRIDE_HIGHLIGHT_FIELD, h);
  if (v.actor) fd.set('actor', v.actor);
  return fd;
}

describe('saveProductTextAction', () => {
  beforeEach(() => {
    revalidatePath.mockClear();
    setProductOverride.mockReset();
    setProductOverride.mockResolvedValue('UPDATED');
    authed = { sid: 'sid', actorId: 'actor' };
  });

  it('🔴 逐欄呼叫 RPC(標題、副標、賣點), 帶 session 的操作人與 server 的 request id;不 redirect', async () => {
    const r = await saveProductTextAction(IDLE, form({ actor: '冒名' }));
    expect(setProductOverride.mock.calls.map((c) => c[0])).toEqual([
      { productId: PID, field: 'title', value: '我們的標題', actor: 'actor', requestId: 'req-1' },
      { productId: PID, field: 'subtitle', value: null, actor: 'actor', requestId: 'req-1' },
      { productId: PID, field: 'highlights', value: ['a'], actor: 'actor', requestId: 'req-1' },
    ]);
    expect(r).toEqual({
      kind: 'done',
      results: [
        { field: 'title', outcome: 'saved' },
        { field: 'subtitle', outcome: 'restored' },
        { field: 'highlights', outcome: 'saved' },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/products/${PID}`);
    // 列表顯示的是客人看到的標題(A1)⇒ 列表也要重新取得(Fable R2 nit)
    expect(revalidatePath).toHaveBeenCalledWith('/products');
  });

  it('🔴 畫面標了沒動過的欄位 ⇒ 那一欄不呼叫 RPC(不會用舊內容蓋掉別人剛改的), 結果是 noop', async () => {
    const fd = form({ title: '新標題' });
    fd.append(f.OVERRIDE_UNCHANGED_FIELD, 'subtitle');
    fd.append(f.OVERRIDE_UNCHANGED_FIELD, 'highlights');
    const r = await saveProductTextAction(IDLE, fd);
    expect(setProductOverride.mock.calls.map((c) => (c[0] as { field: string }).field)).toEqual(['title']);
    expect(r).toEqual({
      kind: 'done',
      results: [
        { field: 'title', outcome: 'saved' },
        { field: 'subtitle', outcome: 'noop' },
        { field: 'highlights', outcome: 'noop' },
      ],
    });
  });

  it('NO_CHANGE ⇒ 那一欄是 noop;三欄都沒變就不重新整理頁面', async () => {
    setProductOverride.mockResolvedValue('NO_CHANGE');
    const r = await saveProductTextAction(IDLE, form());
    expect(r).toMatchObject({ kind: 'done', results: [{ outcome: 'noop' }, { outcome: 'noop' }, { outcome: 'noop' }] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('🔴 沒登入 ⇒ 一欄都不送, 回登入過期的話', async () => {
    authed = null;
    const r = await saveProductTextAction(IDLE, form());
    expect(setProductOverride).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: 'failed' });
    expect((r as { message: string }).message).toContain('登入已過期');
  });

  it('🔴 有一欄內容不合規則 ⇒ 一欄都不送, 說是哪一欄', async () => {
    const r = await saveProductTextAction(IDLE, form({ subtitle: '字'.repeat(301) }));
    expect(setProductOverride).not.toHaveBeenCalled();
    expect((r as { message: string }).message).toBe('沒有儲存：副標字數超過上限，或含有不能使用的字元。請修改後再儲存。');
  });

  it('🔴 中間一欄 RPC 出錯 ⇒ 其他欄照送, 結果逐欄講清楚(拒絕內容 = invalid、停用員工 = denied、其他 = 無法確認)', async () => {
    setProductOverride
      .mockResolvedValueOnce('UPDATED')
      .mockRejectedValueOnce(new Error('admin_set_product_override: 內容不合規則'))
      .mockRejectedValueOnce(new Error('fetch failed'));
    const r = await saveProductTextAction(IDLE, form());
    expect(setProductOverride).toHaveBeenCalledTimes(3);
    expect(r).toEqual({
      kind: 'done',
      results: [
        { field: 'title', outcome: 'saved' },
        { field: 'subtitle', outcome: 'invalid' },
        { field: 'highlights', outcome: 'error' },
      ],
    });
    expect(revalidatePath).toHaveBeenCalled();

    setProductOverride.mockReset();
    setProductOverride.mockRejectedValue(new Error('無權執行此操作'));
    const d = await saveProductTextAction(IDLE, form());
    expect(d).toMatchObject({ kind: 'done', results: [{ outcome: 'denied' }, { outcome: 'denied' }, { outcome: 'denied' }] });
  });

  it('🔴 找不到商品 ⇒ 停下, 不再送後面的欄', async () => {
    setProductOverride.mockResolvedValue('NOT_FOUND');
    const r = await saveProductTextAction(IDLE, form());
    expect(setProductOverride).toHaveBeenCalledTimes(1);
    expect((r as { message: string }).message).toContain('找不到這件商品');
  });

  it('第二欄才查無商品(存到一半被刪)⇒ 不說「本次未儲存」, 說哪一欄起沒存', async () => {
    setProductOverride.mockResolvedValueOnce('UPDATED').mockResolvedValueOnce('NOT_FOUND');
    const r = await saveProductTextAction(IDLE, form());
    expect(setProductOverride).toHaveBeenCalledTimes(2);
    expect((r as { message: string }).message).toBe('找不到這件商品，可能剛被刪除。副標和後面的欄位沒有儲存，請回商品列表重新查詢。');
  });

  it('前一欄是沒動過(沒送)、下一欄才查無商品 ⇒ 仍說「本次未儲存」(前面沒有真的寫過)', async () => {
    setProductOverride.mockResolvedValue('NOT_FOUND');
    const fd = form();
    fd.append(f.OVERRIDE_UNCHANGED_FIELD, 'title');
    const r = await saveProductTextAction(IDLE, fd);
    expect((r as { message: string }).message).toContain('本次未儲存');
  });
});
