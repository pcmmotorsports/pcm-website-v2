// lib/site-order-guard.ts —— 依站別決定能不能算價、下單(B2B 計畫第四版 C 節 L4)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORDER_BLOCK_COPY, resolveOrderTier, siteOrderBlock } from './site-order-guard';

function client(user: { id: string } | null, tierRow: { data: { tier: string; disabled_at?: string } | null; error: { message: string } | null; status: number }) {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: user ? null : { name: 'AuthSessionMissingError' } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => tierRow }) }) }),
  };
}
const member = (tier: string) => client({ id: 'u-1' }, { data: { tier }, error: null, status: 200 });

afterEach(() => vi.unstubAllEnvs());

describe('siteOrderBlock', () => {
  it('經銷站只收 store;一般站拒絕 store', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    expect(await siteOrderBlock(member('store'), { allowGuest: false })).toBeNull();
    expect(await siteOrderBlock(member('general'), { allowGuest: false })).toBe(ORDER_BLOCK_COPY['member-on-b2b']);
    expect(await siteOrderBlock(member('premiumStore'), { allowGuest: false })).toBe(ORDER_BLOCK_COPY['member-on-b2b']);
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    expect(await siteOrderBlock(member('general'), { allowGuest: false })).toBeNull();
    expect(await siteOrderBlock(member('store'), { allowGuest: false })).toBe(ORDER_BLOCK_COPY['dealer-on-retail']);
  });

  // 20260926100000:停用的會員兩站都不能下單, 訪客購物車也不會把他當訪客
  it('停用 ⇒ 兩站都擋, 顯示停用說明', async () => {
    const off = client({ id: 'u-1' }, { data: { tier: 'store', disabled_at: '2026-09-26T02:00:00+00:00' }, error: null, status: 200 });
    for (const mode of ['retail', 'b2b']) {
      vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode);
      expect(await siteOrderBlock(off, { allowGuest: true })).toBe(ORDER_BLOCK_COPY.disabled);
      expect(await resolveOrderTier(off, { allowGuest: true })).toMatchObject({ ok: false, reason: 'disabled' });
    }
  });

  // 🔴 查不到等級兩站都拒絕(計畫 L4):放行的話,create_order 會照 DB 等級算價,錯的站用錯的價成交。
  it('查不到等級 ⇒ 兩站都擋', async () => {
    const down = client({ id: 'u-1' }, { data: null, error: { message: 'down' }, status: 503 });
    for (const mode of ['retail', 'b2b']) {
      vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode);
      expect(await siteOrderBlock(down, { allowGuest: true })).toBe(ORDER_BLOCK_COPY.unknown);
    }
  });

  // 🔴 Codex L4 R1 必修 1:購物車用這一次查到的等級算價,不再另查。
  it('resolveOrderTier 回傳查到的等級:經銷站 store ⇒ store;訪客 ⇒ general', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    expect(await resolveOrderTier(member('store'), { allowGuest: true })).toEqual({ ok: true, tier: 'store' });
    const guest = client(null, { data: null, error: null, status: 200 });
    expect(await resolveOrderTier(guest, { allowGuest: true })).toEqual({ ok: true, tier: 'general' });
    expect(await resolveOrderTier(member('general'), { allowGuest: true })).toMatchObject({ ok: false, reason: 'wrong-site' });
  });

  it('訪客:購物車放行(allowGuest),建單擋', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    const guest = client(null, { data: null, error: null, status: 200 });
    expect(await siteOrderBlock(guest, { allowGuest: true })).toBeNull();
    expect(await siteOrderBlock(guest, { allowGuest: false })).toBe(ORDER_BLOCK_COPY.unknown);
  });
});
