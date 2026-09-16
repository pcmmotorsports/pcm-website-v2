import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  saveHomeBannerDraft: vi.fn(),
  publishHomeBanner: vi.fn(),
  archiveHomeBanner: vi.fn(),
  uploadBannerImage: vi.fn(),
  duplicateHomeBanner: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

// 🔴 三支動作都只走 authorizeAdminMutation(Sean 09-16 Q5 乙 + 主視窗「發得出去要收得回來」)
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./home-banner-image-upload', () => ({ uploadBannerImage: mocks.uploadBannerImage }));
vi.mock('./home-banner-repository', () => ({
  saveHomeBannerDraft: mocks.saveHomeBannerDraft,
  publishHomeBanner: mocks.publishHomeBanner,
  archiveHomeBanner: mocks.archiveHomeBanner,
  duplicateHomeBanner: mocks.duplicateHomeBanner,
}));

// 解析器不 mock:餵真 FormData 走真解析器。
import { archiveHomeBannerAction, duplicateHomeBannerAction, publishHomeBannerAction, saveHomeBannerDraftAction } from './home-banner-actions';
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
  mocks.getRequestId.mockResolvedValue('req-1');
});

describe('publishHomeBannerAction', () => {
  it('🔴 沒登入 / 授權閘擋下 ⇒ denied,RPC 零呼叫(Sean 09-16 Q5 乙:發布改成所有在職員工)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const url = await urlOf(publishHomeBannerAction(formOf({ [HB_FIELD.id]: ID, [HB_FIELD.expected]: UA })));
    expect(url.searchParams.get('r')).toBe('denied');
    expect(mocks.publishHomeBanner).not.toHaveBeenCalled();
  });

  it('🔴 updated_at 原字串(含微秒)一個字不改送進 RPC', async () => {
    const url = await urlOf(publishHomeBannerAction(formOf({ [HB_FIELD.id]: ID, [HB_FIELD.expected]: UA })));
    // actor 是 authorizeAdminMutation 給的一般員工(Q5 乙),不是管理者
    expect(mocks.publishHomeBanner).toHaveBeenCalledWith({ id: ID, expectedUpdatedAt: UA, actor: 'probe_staff', requestId: 'req-1' });
    expect(url.searchParams.get('r')).toBe('published');
    expect(url.pathname).toBe('/home-banners');
  });

  it.each([
    ['草稿剛被改過,請重新確認內容再發布', 'stale'],
    ['還沒確認圖文可以使用', 'rights'],
    ['大圖缺標題、連結或電腦版圖片', 'incomplete'],
    // 🔴 20260916180000 的兩道發布閘:要說「規則不合」不是「系統出錯」
    ['這張還沒配到商品,不能發布', 'nomatch'],
    ['連結要指到商品或品牌頁(/products… 或 /brands…),不能發布', 'linkscope'],
    ['連結要指到商品列表或商品頁(/products…),不能發布', 'linkscope'],
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
  it('🔴 授權閘擋下 ⇒ denied,RPC 零呼叫(下架已開給所有在職員工,不再看管理者)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
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

describe('存草稿 · 選檔上傳(片 B)', () => {
  const PUBLIC_URL = 'https://ref.supabase.co/storage/v1/object/public/home-banners/abc.jpg';

  function withFile(fields: Record<string, string>, file: File | null): FormData {
    const d = formOf(fields);
    if (file !== null) d.set(HB_FIELD.imgDesktopFile, file);
    return d;
  }

  const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], 'a.jpg', { type: 'image/jpeg' });

  it('🔴 傳了檔 ⇒ 桌機圖用回傳的公開網址, 而且 image_origin 寫 storage', async () => {
    mocks.uploadBannerImage.mockResolvedValue({ ok: true, publicUrl: PUBLIC_URL });
    mocks.saveHomeBannerDraft.mockResolvedValue(ID);
    await urlOf(saveHomeBannerDraftAction(withFile({ [HB_FIELD.title1]: '一二三' }, jpeg())));
    const sent = mocks.saveHomeBannerDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.imageDesktopUrl).toBe(PUBLIC_URL);
    // 🔴 這一格是 R1 的 MF2:沒有它, 'storage' 這個值仍然零個生產者
    expect(sent.imageOrigin).toBe('storage');
  });

  it('🔴 沒傳檔 ⇒ 連上傳都不呼叫, 而且 image_origin 不帶(貼網址那條路一個字沒動)', async () => {
    mocks.saveHomeBannerDraft.mockResolvedValue(ID);
    await urlOf(saveHomeBannerDraftAction(formOf({ [HB_FIELD.title1]: '一二三', [HB_FIELD.imgDesktop]: 'https://x.test/a.jpg' })));
    expect(mocks.uploadBannerImage).not.toHaveBeenCalled();
    const sent = mocks.saveHomeBannerDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.imageDesktopUrl).toBe('https://x.test/a.jpg');
    expect(sent.imageOrigin).toBeUndefined();
  });

  it('🔴 選了空檔(size 0)⇒ 當作沒選, 不呼叫上傳', async () => {
    mocks.saveHomeBannerDraft.mockResolvedValue(ID);
    await urlOf(saveHomeBannerDraftAction(withFile({ [HB_FIELD.title1]: '一二三' }, new File([], 'empty.jpg'))));
    expect(mocks.uploadBannerImage).not.toHaveBeenCalled();
  });

  it.each([
    ['toobig', 'toobig'],
    ['badtype', 'badtype'],
    ['uploadfail', 'uploadfail'],
  ])('上傳被擋 %s ⇒ 結果碼 %s, 而且【一列都不寫】', async (reject, code) => {
    mocks.uploadBannerImage.mockResolvedValue({ ok: false, reject });
    const url = await urlOf(saveHomeBannerDraftAction(withFile({ [HB_FIELD.title1]: '一二三' }, jpeg())));
    expect(url.searchParams.get('r')).toBe(code);
    // 🔴 傳圖失敗就不能存 —— 存下去等於把一張沒有圖的草稿說成存好了
    expect(mocks.saveHomeBannerDraft).not.toHaveBeenCalled();
  });

  it('🔬 正對照:文字欄位不合法時【連上傳都不會被呼叫】(先 parse 再傳圖, 才不會留孤兒圖)', async () => {
    // title1 超過 DB 上限 ⇒ 解析器就擋掉
    await urlOf(saveHomeBannerDraftAction(withFile({ [HB_FIELD.title1]: 'x'.repeat(200) }, jpeg())));
    expect(mocks.uploadBannerImage).not.toHaveBeenCalled();
  });
});

describe('複製成新草稿(板 20260916250000)', () => {
  const NEW_ID = '9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f';

  it('🔴 複製成功 ⇒ 開的是【新那張】的面板, 不是舊那張', async () => {
    mocks.duplicateHomeBanner.mockResolvedValue(NEW_ID);
    const url = await urlOf(duplicateHomeBannerAction(formOf({ [HB_FIELD.id]: ID })));
    expect(mocks.duplicateHomeBanner).toHaveBeenCalledWith({ id: ID, actor: 'probe_staff', requestId: 'req-1' });
    expect(url.searchParams.get('r')).toBe('duplicated');
    // 📌 這一格就是「他按複製是為了改」—— 停在舊那張等於什麼也沒解決
    expect(url.searchParams.get('edit')).toBe(NEW_ID);
    expect(url.searchParams.get('view')).toBe('draft');
  });

  it('🔴 失敗 ⇒ 停在【舊那張】, 他看得到錯誤(不要把他丟到一個不存在的 id)', async () => {
    mocks.duplicateHomeBanner.mockRejectedValue({ code: 'P0001', message: '找不到這張大圖' });
    const url = await urlOf(duplicateHomeBannerAction(formOf({ [HB_FIELD.id]: ID })));
    expect(url.searchParams.get('r')).toBe('notfound');
    expect(url.searchParams.get('edit')).toBe(ID);
  });

  it('🔬 正對照:沒登入 ⇒ denied, 而且 RPC 零呼叫', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const url = await urlOf(duplicateHomeBannerAction(formOf({ [HB_FIELD.id]: ID })));
    expect(url.searchParams.get('r')).toBe('denied');
    expect(mocks.duplicateHomeBanner).not.toHaveBeenCalled();
  });

  it('沒帶 id ⇒ invalid, RPC 零呼叫', async () => {
    const url = await urlOf(duplicateHomeBannerAction(formOf({})));
    expect(url.searchParams.get('r')).toBe('invalid');
    expect(mocks.duplicateHomeBanner).not.toHaveBeenCalled();
  });
});
