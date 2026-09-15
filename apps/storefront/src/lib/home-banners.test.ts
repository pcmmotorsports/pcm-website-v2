// @vitest-environment node
//
// home-banners.ts —— 首頁讀已發布新品大圖(片 3)。守的是「讀不到 / 形狀不對 ⇒ 沒有大圖,首頁照舊」。
// ⚠️ 擋不住:真的 PostgREST 回什麼、view 的權限 —— 那兩件在 storefront-probe 上實走(commit body 有讀數)。

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
const createCatalogAnonClient = vi.fn();
vi.mock('@/lib/catalog-anon-client', () => ({ createCatalogAnonClient: () => createCatalogAnonClient() }));

import {
  HOME_BANNER_DEFAULT_CTA,
  fetchLiveHomeBanner,
  isSafeInternalPath,
  loadLiveHomeBanner,
  toLiveHomeBanner,
} from './home-banners';

const ROW = {
  id: 'b1',
  eyebrow: 'AKRAPOVIC ‧ 新品到貨',
  title_line1: 'Slip-On 鈦合金尾段，',
  title_line2: '2026 年式新款到貨',
  subtitle: '適用 BMW S 1000 RR · 已上架 6 件',
  cta_label: '看 Akrapovic 新品',
  link_path: '/products?pbrands=akrapovic&categories=排氣系統',
  image_desktop_url: 'https://cdn.example.com/a.jpg',
  image_mobile_url: null,
  image_kind: 'scene',
  starts_at: '2026-09-16T00:00:00Z',
};

/** 假 client:記下查了哪個 view、回傳給定的結果(或一個永不 settle 的 promise)。 */
function fakeClient(result: unknown, calls: string[] = []) {
  return {
    from: (view: string) => {
      calls.push(view);
      return {
        select: () => ({ order: () => ({ limit: () => (result === 'hang' ? new Promise(() => {}) : Promise.resolve(result)) }) }),
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  createCatalogAnonClient.mockReset();
});

describe('toLiveHomeBanner —— 形狀不對就當作沒有大圖', () => {
  it('正常的情境照 ⇒ 前台形狀', () => {
    expect(toLiveHomeBanner(ROW)).toEqual({
      id: 'b1',
      eyebrow: 'AKRAPOVIC ‧ 新品到貨',
      titleLine1: 'Slip-On 鈦合金尾段，',
      titleLine2: '2026 年式新款到貨',
      subtitle: '適用 BMW S 1000 RR · 已上架 6 件',
      ctaLabel: '看 Akrapovic 新品',
      linkPath: '/products?pbrands=akrapovic&categories=排氣系統',
      imageDesktopUrl: 'https://cdn.example.com/a.jpg',
      imageMobileUrl: null,
      kind: 'scene',
    });
  });

  it('白底商品照 ⇒ kind=product;按鈕字空白 ⇒ 預設字', () => {
    const b = toLiveHomeBanner({ ...ROW, image_kind: 'product', cta_label: '  ' });
    expect(b?.kind).toBe('product');
    expect(b?.ctaLabel).toBe(HOME_BANNER_DEFAULT_CTA);
  });

  it.each([
    ['外站(雙斜線)', { link_path: '//evil.com/x' }],
    ['外站(反斜線)', { link_path: '/\\evil.com' }],
    ['絕對網址', { link_path: 'https://evil.com' }],
    ['路徑含空白', { link_path: '/products?search=a b' }],
    ['圖不是 https', { image_desktop_url: 'http://cdn.example.com/a.jpg' }],
    ['圖不是網址', { image_desktop_url: 'javascript:alert(1)' }],
    ['類型不認得', { image_kind: 'video' }],
    ['沒有標題', { title_line1: '' }],
  ])('🔴 %s ⇒ null', (_label, patch) => {
    expect(toLiveHomeBanner({ ...ROW, ...patch })).toBeNull();
  });

  it('手機圖不合格 ⇒ 退回桌機圖(不讓整張消失)', () => {
    expect(toLiveHomeBanner({ ...ROW, image_mobile_url: 'http://x/y.jpg' })?.imageMobileUrl).toBeNull();
    expect(toLiveHomeBanner({ ...ROW, image_mobile_url: 'https://x/m.jpg' })?.imageMobileUrl).toBe('https://x/m.jpg');
  });

  it('負對照:站內路徑判斷不是恆真 / 恆假', () => {
    expect(isSafeInternalPath('/brands/akrapovic')).toBe(true);
    expect(isSafeInternalPath('//x')).toBe(false);
  });
});

describe('loadLiveHomeBanner —— 失敗一律 throw(交給外層退)', () => {
  it('讀的是 home_banners_live_v,有列 ⇒ 大圖', async () => {
    const calls: string[] = [];
    await expect(loadLiveHomeBanner(fakeClient({ data: [ROW], error: null }, calls) as never)).resolves.toMatchObject({ id: 'b1' });
    expect(calls).toEqual(['home_banners_live_v']);
  });

  it('沒有列 ⇒ null(不是錯誤)', async () => {
    await expect(loadLiveHomeBanner(fakeClient({ data: [], error: null }) as never)).resolves.toBeNull();
  });

  it('🔴 查詢錯誤 ⇒ throw', async () => {
    await expect(loadLiveHomeBanner(fakeClient({ data: null, error: { code: '42501' } }) as never)).rejects.toThrow('42501');
  });

  it('🔴 永不回應 ⇒ 逾時 throw(不讓首頁卡住)', async () => {
    vi.useFakeTimers();
    const p = loadLiveHomeBanner(fakeClient('hang') as never, 2500);
    const assertion = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
  });
});

describe('fetchLiveHomeBanner —— 首頁用,永不 throw', () => {
  it('🔴 client 建不起來(env 缺)⇒ null,不 throw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createCatalogAnonClient.mockImplementation(() => {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL not set');
    });
    await expect(fetchLiveHomeBanner()).resolves.toBeNull();
  });

  it('🔴 查詢錯誤 ⇒ null,log 只有分類不帶列內容', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createCatalogAnonClient.mockReturnValue(fakeClient({ data: null, error: { code: 'PGRST301' } }));
    await expect(fetchLiveHomeBanner()).resolves.toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain('PGRST301');
  });

  it('正對照:讀得到 ⇒ 回大圖', async () => {
    createCatalogAnonClient.mockReturnValue(fakeClient({ data: [ROW], error: null }));
    await expect(fetchLiveHomeBanner()).resolves.toMatchObject({ kind: 'scene' });
  });
});
