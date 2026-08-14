// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// repository 拉 server-only 模組 ⇒ 只 mock 那兩支查詢函式。
// 🔴 `resolvePrice` / `resolveListingState` **不 mock** —— 它們是本片要驗的取值落點,
//    mock 掉等於把要驗的東西換成假的(memory `feedback_assertion-measures-the-wrong-thing`)。
const mocks = vi.hoisted(() => ({ get: vi.fn(), taxonomy: vi.fn(), notFound: vi.fn() }));
vi.mock('../../../lib/products/product-repository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/products/product-repository')>();
  return {
    ...actual,
    getProductForAdmin: mocks.get,
    getProductTaxonomyNames: mocks.taxonomy,
  };
});
vi.mock('server-only', () => ({}));
// `notFound()` 真的會 throw ⇒ 用可觀察的 spy 取代,才驗得到「有沒有被呼叫」而不是靠例外形狀。
vi.mock('next/navigation', () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '11111111-2222-4333-8444-555555555555';
const PRODUCT = {
  id: ID,
  title: '碳纖維前土除',
  subtitle: '亮面 3K',
  external_id: 'RPM-001',
  supplier_slug: 'rpm',
  handle: 'carbon-front-fender',
  brand_id: '22222222-2222-4222-8222-222222222222',
  category_id: '33333333-3333-4333-8333-333333333333',
  price_general: 4800,
  availability: 'in-stock',
  delisted_at: null,
  created_at: '2026-08-01T02:00:00Z',
  updated_at: '2026-08-10T02:00:00Z',
};

async function renderPage(id = ID) {
  const { default: Page } = await import('./page');
  return render(await Page({ params: Promise.resolve({ id }) }));
}

describe('/products/[id] 詳情頁(#20 片1b-1)', () => {
  it('🔴 驗收 1:六個平欄區塊都看得到,料號 / 供應商 / 售價 / 狀態逐欄驗', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: 'CNC RACING', categoryName: '外觀部品' });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    for (const expected of [
      '碳纖維前土除',
      '亮面 3K',
      'RPM-001',
      'rpm',
      'carbon-front-fender',
      '上架中',
      '有庫存',
      'NT$ 4,800',
      'CNC RACING',
      '外觀部品',
    ]) {
      expect({ [expected]: text.includes(expected) }).toEqual({ [expected]: true });
    }
  });

  it('🔴 MF2:時間欄要釘台北曆面 —— 這格不存在時 MF1(差 8 小時)全綠溜過去', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';

    // `created_at = 2026-08-01T02:00:00Z` ⇒ 台北是 **08-01 10:00**;UTC 印出來會是 02:00。
    // 🔴 兩條缺一不可:只斷言「有 10:00」而不斷言「沒有 02:00」,
    //    在某些格式下仍可能兩個都印(例如同時印了 UTC 與本地)。
    expect(text).toContain('2026-08-01 10:00');
    expect(text).not.toContain('2026-08-01 02:00');
    // `updated_at = 2026-08-10T02:00:00Z` ⇒ 台北 08-10 10:00。
    expect(text).toContain('2026-08-10 10:00');

    // 格式字面也釘住(`YYYY-MM-DD HH:mm`):改回 `toLocaleString('zh-TW')` 會印成
    // `2026/8/1 上午10:00:00`。⚠️ **這兩條只擋格式,不擋時區** —— 見下一格。
    expect(text).not.toContain('上午');
    expect(text).not.toContain('2026/8/1');
  });

  it('🔴 R2 MF2:執行環境在 UTC 時仍印台北時間(唯一能證明 timeZone 有效的一格)', async () => {
    // ⚠️ **上一格對「沒釘 timeZone」零判別力,我 R1 折的時候寫反了。**
    //    `vitest.config.ts:64` 把 `env: { TZ: 'Asia/Taipei' }` 釘死在所有測試上
    //    ⇒ 我當時寫的「測試程序自己不在台北時區也會紅」**永遠不會發生**。
    //    實測:不帶 `timeZone` 的 `toLocaleDateString('en-CA')` + `toLocaleTimeString('en-GB',…)`
    //    在 Taipei 下輸出 `2026-08-01 10:00` —— **與正確實作逐字相同、五條斷言全綠**。
    //    🔴 病根:**判別力要對著「壞實作」量,不能對著「好實作」量** ——
    //    我為了修一個恆綠格,做出了另一個恆綠格。
    //    形狀照抄屋內既有解(`lib/orders/payment-list-view.test.ts:96-107`),不自己想新寫法。
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });

    vi.stubEnv('TZ', 'UTC');
    try {
      // 前置斷言:先確認 stub 真的改到執行期時區 —— 沒改到的話下面那句在台北下恆綠,
      // 又是一個「偵測器根本沒吐東西」的假綠。
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
      const { container } = await renderPage();
      const text = container.textContent ?? '';
      // 🔴 這一條是「`formatOrderDateTime` 裡那兩行 `timeZone` 消失就會紅」的唯一憑據。
      expect(text).toContain('2026-08-01 10:00');
      expect(text).not.toContain('2026-08-01 02:00');
    } finally {
      vi.unstubAllEnvs();
    }
    // 收尾也驗:時區有還原,否則本檔後面的格子會在 UTC 下跑。
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
  });

  it('🔴 驗收 2:已下架的商品進得去,而且狀態顯示「已下架」(不是 404)', async () => {
    mocks.get.mockResolvedValue({ ...PRODUCT, delisted_at: '2026-08-01T00:00:00Z' });
    mocks.taxonomy.mockResolvedValue({ brandName: 'X', categoryName: 'Y' });
    const { container } = await renderPage();
    expect(container.textContent ?? '').toContain('已下架');
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('🔴 驗收 3:非 UUID → 404,而且完全不打 DB', async () => {
    await expect(renderPage('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
    // 🔴 這一格才是重點:形狀不對就不該讓路由參數進到查詢裡。
    expect(mocks.get).not.toHaveBeenCalled();

    // 負向對照:合法 UUID 一定要打得到 DB,否則上面那條對「永遠不查」也會綠。
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    await renderPage();
    expect(mocks.get).toHaveBeenCalledWith(ID);
  });

  it('🔴 驗收 4a:查無此商品 → 404', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('🔴 驗收 4b:讀取失敗 → 錯誤態,不 404、DB error 不外洩到畫面', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.get.mockRejectedValue(new Error('PGRST301 permission denied for table products'));
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('商品資料載入失敗');
    expect(text).not.toContain('PGRST301');
    expect(text).not.toContain('permission denied');
    // 🔴 讀取失敗**不得**退化成 404 —— 兩者混在一起,員工會以為商品被刪了。
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 品牌/分類壞掉只壞那一區塊,其餘欄位照看得到', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('品牌與分類載入失敗');
    // 這才是「單區塊容錯」的意思:料號還在。
    expect(text).toContain('RPM-001');
    expect(text).toContain('NT$ 4,800');
    spy.mockRestore();
  });

  it('🔴 本頁不得宣稱尚未存在的功能', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    for (const promise of ['即將推出', '敬請期待', '可以編輯', '點擊修改', '編輯商品']) {
      expect({ [promise]: text.includes(promise) }).toEqual({ [promise]: false });
    }
    expect(text).toContain('只能查看');
    expect(text).toContain('返回商品列表');
  });

  it('沒值的欄位顯「—」,不留空白格', async () => {
    mocks.get.mockResolvedValue({ ...PRODUCT, subtitle: null, price_general: null });
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    expect(container.textContent ?? '').toContain('—');
  });
});
