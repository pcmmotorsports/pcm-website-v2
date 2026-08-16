// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * 客人卡頁面的 **`?wpage` 接線**守門(2026-08-17)。
 *
 * 🔴 **為什麼要有這一格**:codex R2 指出 —— 我原本只在 `load-customer-detail.test.ts` 驗
 * 「傳 `walletPage=3` 會算出 `offset 40`」,**那三格測的是取數函式的內部**;
 * **把 `page.tsx` 裡 `walletPage: parsePage(rawSearch.wpage)` 整行刪掉,那三格仍然全綠**
 * ⇒ 真正把網址接到取數的那一段**零覆蓋**。本檔補的就是那一段。
 */

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../../../lib/customers/load-customer-detail', () => ({
  loadCustomerDetail: mocks.load,
  WALLET_LEDGER_PAGE_SIZE: 20,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
// 🔴 `@/` alias 在 vitest 解析不到 ⇒ 導到【真實模組】而不是替身:
//    第三格要驗 `parsePage` 對竄改值的下界行為，用假的就等於沒測。
vi.mock('../../../lib/shared/list-params', async () => {
  return await vi.importActual('../../../lib/shared/list-params');
});

import CustomerDetailPage from './page';

const CUSTOMER_ID = '99999999-8888-4777-8666-555555555555';

function emptyData() {
  return {
    customer: null,
    customerFailed: true, // 走錯誤態分支即可（本檔只驗取數參數，不驗渲染）
    walletEntries: [],
    walletLoadFailed: false,
    walletTotal: 0,
    walletPage: 1,
    orders: [],
    ordersLoadFailed: false,
    addresses: [],
    addressesLoadFailed: false,
    vehicles: [],
    vehiclesLoadFailed: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('客人卡頁面 — ?wpage 接到儲值金取數(2026-08-17)', () => {
  it('🔴 網址帶 ?wpage=3 → 取數收到 walletPage 3', async () => {
    mocks.load.mockResolvedValue(emptyData());

    await CustomerDetailPage({
      params: Promise.resolve({ id: CUSTOMER_ID }),
      searchParams: Promise.resolve({ wpage: '3' }),
    });

    expect(mocks.load).toHaveBeenCalledWith(CUSTOMER_ID, { walletPage: 3 });
  });

  it('負向對照:沒帶 ?wpage → 第 1 頁(證明上一格不是恆真)', async () => {
    mocks.load.mockResolvedValue(emptyData());

    await CustomerDetailPage({
      params: Promise.resolve({ id: CUSTOMER_ID }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.load).toHaveBeenCalledWith(CUSTOMER_ID, { walletPage: 1 });
  });

  it('負向對照:?wpage 被竄改成 0 / 負數 / 非數字 → 下界到 1，不透傳', async () => {
    for (const raw of ['0', '-5', 'abc']) {
      mocks.load.mockResolvedValue(emptyData());
      await CustomerDetailPage({
        params: Promise.resolve({ id: CUSTOMER_ID }),
        searchParams: Promise.resolve({ wpage: raw }),
      });
      expect(mocks.load, `wpage=${raw} 應下界到 1`).toHaveBeenCalledWith(CUSTOMER_ID, {
        walletPage: 1,
      });
      vi.clearAllMocks();
    }
  });
});
