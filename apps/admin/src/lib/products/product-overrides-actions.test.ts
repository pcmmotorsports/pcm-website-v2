import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const setProductOverride = vi.fn(async (_args: unknown) => 'UPDATED' as string);
let authed: { sid: string; actorId: string } | null = { sid: 'sid', actorId: 'actor' };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: async () => authed }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./product-repository', () => ({ setProductOverride: (a: unknown) => setProductOverride(a) }));

const { setProductOverrideAction } = await import('./product-overrides-actions');
const f = await import('./product-overrides-form');

const PID = '11111111-2222-3333-4444-555555555555';

function form(field: string, intent: string, value = '我們的標題'): FormData {
  const fd = new FormData();
  fd.set(f.OVERRIDE_PRODUCT_ID_FIELD, PID);
  fd.set(f.OVERRIDE_FIELD_FIELD, field);
  fd.set(f.OVERRIDE_INTENT_FIELD, intent);
  fd.set(f.OVERRIDE_VALUE_FIELD, value);
  fd.set(f.OVERRIDE_RETURN_TO_FIELD, `/products/${PID}`);
  return fd;
}

async function run(fd: FormData): Promise<string> {
  try {
    await setProductOverrideAction(fd);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith('REDIRECT:')) return m.slice('REDIRECT:'.length);
    throw e;
  }
  return '(沒有 redirect)';
}

describe('setProductOverrideAction(丙方案片 2)', () => {
  beforeEach(() => {
    redirect.mockClear();
    setProductOverride.mockReset();
    setProductOverride.mockResolvedValue('UPDATED');
    authed = { sid: 'sid', actorId: 'actor' };
  });

  it('存標題 ⇒ 帶 actor / requestId 呼叫 RPC,導回 r=override_saved', async () => {
    const url = await run(form('title', 'save'));
    expect(setProductOverride).toHaveBeenCalledWith({
      productId: PID, field: 'title', value: '我們的標題', actor: 'actor', requestId: 'req-1',
    });
    expect(url).toBe(`/products/${PID}?r=override_saved`);
  });

  it('還原 ⇒ value null(刪鍵),導回 r=override_restored', async () => {
    const url = await run(form('title', 'restore'));
    expect(setProductOverride).toHaveBeenCalledWith(expect.objectContaining({ field: 'title', value: null }));
    expect(url).toContain('r=override_restored');
  });

  it('NO_CHANGE ⇒ r=override_noop;NOT_FOUND ⇒ r=override_not_found', async () => {
    setProductOverride.mockResolvedValue('NO_CHANGE');
    expect(await run(form('title', 'save'))).toContain('r=override_noop');
    setProductOverride.mockResolvedValue('NOT_FOUND');
    expect(await run(form('title', 'save'))).toContain('r=override_not_found');
  });

  it('沒登入 ⇒ r=override_denied,不呼叫 RPC', async () => {
    authed = null;
    expect(await run(form('title', 'save'))).toContain('r=override_denied');
    expect(setProductOverride).not.toHaveBeenCalled();
  });

  it('表單不合法 ⇒ r=override_invalid,不呼叫 RPC', async () => {
    expect(await run(form('description', 'save'))).toContain('r=override_invalid');
    expect(setProductOverride).not.toHaveBeenCalled();
  });

  it('RPC 拒絕內容(admin_set_product_override: …)⇒ override_invalid;其他錯誤 ⇒ override_error', async () => {
    setProductOverride.mockRejectedValue({ code: 'P0001', message: 'admin_set_product_override: title 太長或含控制字元' });
    expect(await run(form('title', 'save'))).toContain('r=override_invalid');
    setProductOverride.mockRejectedValue({ code: '08006', message: 'connection failure' });
    expect(await run(form('title', 'save'))).toContain('r=override_error');
  });

  it('RPC 擋下停用員工(無權執行此操作)⇒ override_denied,不是「無法確認」', async () => {
    setProductOverride.mockRejectedValue({ code: 'P0001', message: '無權執行此操作' });
    expect(await run(form('title', 'save'))).toContain('r=override_denied');
  });
});
