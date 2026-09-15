import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(),
  saveHomeBannerDraft: vi.fn(),
  publishHomeBanner: vi.fn(),
  archiveHomeBanner: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
  authorizeManagerMutation: mocks.authorizeManagerMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./home-banner-repository', () => ({
  saveHomeBannerDraft: mocks.saveHomeBannerDraft,
  publishHomeBanner: mocks.publishHomeBanner,
  archiveHomeBanner: mocks.archiveHomeBanner,
}));

// 解析器不 mock:餵真 FormData 走真解析器。
import { archiveHomeBannerAction, publishHomeBannerAction, saveHomeBannerDraftAction } from './home-banner-actions';
import { HB_FIELD } from './home-banner-constants';

const ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const UA = '2026-09-16T00:12:34.123456+00:00';

function formOf(fields: Record<string, string>): FormData {
  const d = new FormData();
  for (const [k, v] of Object.entries(fields)) d.set(k, v);
  return d;
}

async function urlOf(p: Promise<void>): Promise<URL> {
  await expect(p).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return new URL(mocks.redirect.mock.calls[0]![0] as string, 'http://admin.local');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's', actorId: 'probe_staff' });
  mocks.authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-1');
});

describe('publishHomeBannerAction', () => {
  it('🔴 非管理者 ⇒ denied,RPC 零呼叫', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    const url = await urlOf(publishHomeBannerAction(formOf({ [HB_FIELD.id]: ID, [HB_FIELD.expected]: UA })));
    expect(url.searchParams.get('r')).toBe('denied');
    expect(mocks.publishHomeBanner).not.toHaveBeenCalled();
  });

  it('🔴 updated_at 原字串(含微秒)一個字不改送進 RPC', async () => {
    const url = await urlOf(publishHomeBannerAction(formOf({ [HB_FIELD.id]: ID, [HB_FIELD.expected]: UA })));
    expect(mocks.publishHomeBanner).toHaveBeenCalledWith({ id: ID, expectedUpdatedAt: UA, actor: 'sean', requestId: 'req-1' });
    expect(url.searchParams.get('r')).toBe('published');
    expect(url.pathname).toBe('/home-banners');
  });

  it.each([
    ['草稿剛被改過,請重新確認內容再發布', 'stale'],
    ['還沒確認圖文可以使用', 'rights'],
    ['大圖缺標題、連結或電腦版圖片', 'incomplete'],
    ['下架時間已經過了', 'window'],
    ['無權執行此操作', 'denied'],
  ])('DB 說「%s」⇒ r=%s', async (message, code) => {
    mocks.publishHomeBanner.mockRejectedValue({ code: 'P0001', message });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = await urlOf(publishHomeBannerAction(formOf({ [HB_FIELD.id]: ID, [HB_FIELD.expected]: UA })));
    expect(url.searchParams.get('r')).toBe(code);
    expect(url.searchParams.get('edit')).toBe(ID);
  });

  it('沒帶 updated_at ⇒ invalid,RPC 零呼叫', async () => {
    const url = await urlOf(publishHomeBannerAction(formOf({ [HB_FIELD.id]: ID })));
    expect(url.searchParams.get('r')).toBe('invalid');
    expect(mocks.publishHomeBanner).not.toHaveBeenCalled();
  });
});

describe('saveHomeBannerDraftAction', () => {
  const fields = { [HB_FIELD.title1]: '新品', [HB_FIELD.link]: '/brands/arrow', [HB_FIELD.view]: 'draft' };

  it('一般員工可以存草稿(走 authorizeAdminMutation,不看管理者)', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    mocks.saveHomeBannerDraft.mockResolvedValue(ID);
    const url = await urlOf(saveHomeBannerDraftAction(formOf(fields)));
    expect(mocks.saveHomeBannerDraft).toHaveBeenCalledTimes(1);
    expect(url.searchParams.get('r')).toBe('created');
    expect(url.searchParams.get('edit')).toBe(ID);
  });

  it('外站連結 ⇒ invalid,RPC 零呼叫', async () => {
    const url = await urlOf(saveHomeBannerDraftAction(formOf({ ...fields, [HB_FIELD.link]: '//evil.com' })));
    expect(url.searchParams.get('r')).toBe('invalid');
    expect(mocks.saveHomeBannerDraft).not.toHaveBeenCalled();
  });

  it('DB CHECK 擋下(解析器沒擋到)⇒ invalid;不認得的錯 ⇒ error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.saveHomeBannerDraft.mockRejectedValueOnce({ code: '23514', message: 'check' });
    expect((await urlOf(saveHomeBannerDraftAction(formOf(fields)))).searchParams.get('r')).toBe('invalid');
    mocks.redirect.mockClear();
    mocks.saveHomeBannerDraft.mockRejectedValueOnce(new Error('boom'));
    expect((await urlOf(saveHomeBannerDraftAction(formOf(fields)))).searchParams.get('r')).toBe('error');
  });

  it('網址亂帶 view ⇒ 回草稿分頁(白名單)', async () => {
    mocks.saveHomeBannerDraft.mockResolvedValue(ID);
    const url = await urlOf(saveHomeBannerDraftAction(formOf({ ...fields, [HB_FIELD.view]: 'https://evil.com' })));
    expect(url.searchParams.get('view')).toBe('draft');
  });
});

describe('archiveHomeBannerAction', () => {
  it('非管理者 ⇒ denied', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    const url = await urlOf(archiveHomeBannerAction(formOf({ [HB_FIELD.id]: ID })));
    expect(url.searchParams.get('r')).toBe('denied');
    expect(mocks.archiveHomeBanner).not.toHaveBeenCalled();
  });

  it('已經封存 ⇒ nochange', async () => {
    mocks.archiveHomeBanner.mockResolvedValue({ changed: false });
    const url = await urlOf(archiveHomeBannerAction(formOf({ [HB_FIELD.id]: ID })));
    expect(url.searchParams.get('r')).toBe('nochange');
  });
});
