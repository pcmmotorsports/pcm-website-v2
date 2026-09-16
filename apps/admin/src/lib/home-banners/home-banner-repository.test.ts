import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { saveHomeBannerDraft } from './home-banner-repository';
import type { HomeBannerDraftInput } from './home-banner-form';

// home-banner-repository.test.ts — **只釘一行**:`p_image_origin` 有沒有被真的送下去。
//
// 🔴 為什麼只釘這一行(R2 的 N1):`home-banner-actions.test.ts` 把 repository **整支 mock 掉**
//    ⇒ 它只驗到「送進 repository 的物件帶 imageOrigin」,驗不到 repository 有沒有往下傳。
//    ⇒ 有人把 `home-banner-repository.ts` 那行改回 `p_image_origin: null`,**其他 70 格全綠**,
//      而 R1 的 MF2(`'storage'` 零個生產者)就這樣安靜復發。
//    📌 **不是現在壞,是復發時沒有東西叫。** 這一格就是那個會叫的東西。
// ⚠️ 本檔**刻意不補整支 repository 的測試** —— 其餘那些 RPC 參數沒有這段歷史,補了是把守門稀釋掉。

const BASE: HomeBannerDraftInput = {
  id: null,
  eyebrow: null,
  titleLine1: '一二三',
  titleLine2: null,
  subtitle: null,
  ctaLabel: null,
  linkPath: null,
  imageDesktopUrl: null,
  imageMobileUrl: null,
  imageKind: 'scene',
  rightsConfirmed: false,
  rightsNote: null,
  startsAt: null,
  endsAt: null,
};

const AUDIT = { actor: 'probe_staff', requestId: 'req-1' };

function sentArgs(): Record<string, unknown> {
  return mocks.rpc.mock.calls[0]![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', error: null });
});

describe('saveHomeBannerDraft · image_origin 有沒有真的送下去', () => {
  it('🔴 帶了 imageOrigin: storage ⇒ RPC 收到 p_image_origin = storage', async () => {
    await saveHomeBannerDraft({ ...BASE, imageOrigin: 'storage' }, AUDIT);
    expect(sentArgs().p_image_origin).toBe('storage');
  });

  it('🔬 正對照:沒帶 ⇒ 送 null(貼網址那條路的既有行為,不可以跟著變)', async () => {
    await saveHomeBannerDraft(BASE, AUDIT);
    expect(sentArgs().p_image_origin).toBeNull();
  });

  it('🔬 第二個正對照:確認叫的是對的那支 RPC、而且別的欄位真的有送(不是整包空的)', async () => {
    await saveHomeBannerDraft({ ...BASE, imageOrigin: 'storage' }, AUDIT);
    expect(mocks.rpc.mock.calls[0]![0]).toBe('admin_home_banner_save_draft');
    expect(sentArgs().p_title_line1).toBe('一二三');
    expect(sentArgs().p_actor).toBe('probe_staff');
  });
});
