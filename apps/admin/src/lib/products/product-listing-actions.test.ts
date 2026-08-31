import { describe, expect, it, vi, beforeEach } from 'vitest';

// 🔴 本檔守的是【那道確認的四條路】(板 `⟦b4-NOVARIANT1⟧`, Sean 2026-08-31 拍 `Q2=甲`)。
// 🛑 而其中**最容易被漏掉的是第二格**:「帶了確認 ⇒ 放行」——
//    少了它, 一個【永遠擋】的實作會讓其餘三格全綠, 而那就變成【封鎖】不是【確認】。
vi.mock('server-only', () => ({}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const setProductListing = vi.fn(async (_args: unknown) => 'UPDATED');
const findVariantSkuCollisionOrUnavailable = vi.fn(
  async (_id: string) => null as null | 'unavailable' | { externalId: string; belongsToExternalId: string },
);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: async () => ({ sid: 'sid', actorId: 'actor' }),
}));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./product-repository', () => ({ setProductListing: (a: unknown) => setProductListing(a) }));
vi.mock('./variant-sku-collision', () => ({
  findVariantSkuCollisionOrUnavailable: (id: string) => findVariantSkuCollisionOrUnavailable(id),
}));

const { setProductListingAction } = await import('./product-listing-actions');
const {
  LISTING_PRODUCT_ID_FIELD,
  LISTING_DELISTED_FIELD,
  LISTING_RETURN_TO_FIELD,
  LISTING_CONFIRM_FIELD,
  LISTING_CONFIRM_OWNER_FIELD,
} = await import('./product-listing-form');

const PID = '11111111-2222-3333-4444-555555555555';
const HIT = { externalId: 'ARSV421-08-G-F', belongsToExternalId: 'ARSV421-08' };

function form(opts: { delisted: boolean; confirm?: string; owner?: string }) {
  const f = new FormData();
  f.set(LISTING_PRODUCT_ID_FIELD, PID);
  f.set(LISTING_DELISTED_FIELD, String(opts.delisted));
  f.set(LISTING_RETURN_TO_FIELD, `/products/${PID}`);
  // 🔴 `confirm` 收字串不收 boolean —— 因為要演 'on' / 'false' / '' 那幾種竄改(codex R1 #7)。
  if (opts.confirm !== undefined) f.set(LISTING_CONFIRM_FIELD, opts.confirm);
  if (opts.owner !== undefined) f.set(LISTING_CONFIRM_OWNER_FIELD, opts.owner);
  return f;
}

/** action 用 redirect 結束(它 throw)⇒ 把導去哪裡取出來。 */
async function run(f: FormData): Promise<string> {
  try {
    await setProductListingAction(f);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith('REDIRECT:')) return m.slice('REDIRECT:'.length);
    throw e;
  }
  return '(沒有 redirect)';
}

describe('上架前的確認 —— 四條路', () => {
  beforeEach(() => {
    redirect.mockClear();
    setProductListing.mockClear();
    findVariantSkuCollisionOrUnavailable.mockReset();
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(null);
  });

  it('🔴 要上架 + 命中 + 沒帶確認 ⇒ 擋下(不寫入)', async () => {
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(HIT);
    const url = await run(form({ delisted: false }));
    expect(url).toContain('r=variant_sku_collision');
    // 🔴 「擋下」不只是導頁 —— **一定要沒有寫進去**。少了這一格,
    //    一個「先寫入再導頁」的實作會全綠, 而商品已經上架了。
    expect(setProductListing).not.toHaveBeenCalled();
  });

  it('🔵 要上架 + 命中 + 【勾了確認且看的是同一支】⇒ 放行 —— 這是【確認】不是【封鎖】', async () => {
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(HIT);
    const url = await run(form({ delisted: false, confirm: 'true', owner: HIT.belongsToExternalId }));
    expect(url).not.toContain('variant_sku_collision');
    expect(setProductListing).toHaveBeenCalledTimes(1);
  });

  it('🟢 要上架 + 不命中 ⇒ 照常放行(證明它不是恆擋)', async () => {
    const url = await run(form({ delisted: false }));
    expect(url).not.toContain('variant_sku_collision');
    expect(setProductListing).toHaveBeenCalledTimes(1);
  });

  it('🛑 要【下架】⇒ 永遠不檢查(把可疑商品下架永遠是安全的)', async () => {
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(HIT);
    const url = await run(form({ delisted: true }));
    expect(url).not.toContain('variant_sku_collision');
    // 🔴 連問都不該問 —— 那不只是「不擋」, 是【不花那一發查詢】。
    expect(findVariantSkuCollisionOrUnavailable).not.toHaveBeenCalled();
    expect(setProductListing).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 codex R1 補的那幾條路', () => {
  beforeEach(() => {
    redirect.mockClear();
    setProductListing.mockClear();
    findVariantSkuCollisionOrUnavailable.mockReset();
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(null);
  });

  it('🛑 #2 查不出來 ⇒ **擋下**(fail-closed), 而不是當成「沒撞名」照樣上架', async () => {
    findVariantSkuCollisionOrUnavailable.mockResolvedValue('unavailable');
    const url = await run(form({ delisted: false }));
    expect(url).toContain('r=variant_sku_check_unavailable');
    expect(setProductListing).not.toHaveBeenCalled();
  });

  it('🔴 #5 勾了確認, 而他看到的是【別支】商品 ⇒ 擋下(stale confirmation)', async () => {
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(HIT);
    // 畫面當時顯示 ARSV999(舊資料), 而現在算出來是 ARSV421-08 ⇒ 他確認的不是這一件事。
    const url = await run(form({ delisted: false, confirm: 'true', owner: 'ARSV999' }));
    expect(url).toContain('r=variant_sku_collision');
    expect(setProductListing).not.toHaveBeenCalled();
  });

  it('🔴 #5 勾了確認【而沒送 owner】⇒ 擋下(不得因為「反正他勾了」就放行)', async () => {
    findVariantSkuCollisionOrUnavailable.mockResolvedValue(HIT);
    const url = await run(form({ delisted: false, confirm: 'true' }));
    expect(url).toContain('r=variant_sku_collision');
    expect(setProductListing).not.toHaveBeenCalled();
  });

  it("🔴 #7 confirm 竄改成 'on' / 'false' / '' ⇒ 一律當【沒確認】", async () => {
    for (const bad of ['on', 'false', '', 'TRUE', '1']) {
      findVariantSkuCollisionOrUnavailable.mockResolvedValue(HIT);
      setProductListing.mockClear();
      const url = await run(form({ delisted: false, confirm: bad, owner: HIT.belongsToExternalId }));
      // 🔴 少了這一格 ⇒ 一個「有送這一欄就算確認」的實作會全綠, 而那等於沒有確認。
      expect(url, `confirm='${bad}' 應該要被擋`).toContain('r=variant_sku_collision');
      expect(setProductListing).not.toHaveBeenCalled();
    }
  });
});
