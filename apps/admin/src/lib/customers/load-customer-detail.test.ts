import { afterEach, describe, expect, it, vi } from 'vitest';

// repository getter 會拉 server-only 模組 ⇒ 整支 mock(同 `app/customers/page.test.tsx` 紀律)。
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listEntries: vi.fn(),
  listSummariesByCustomer: vi.fn(),
  listAddresses: vi.fn(),
  listVehicles: vi.fn(),
}));
vi.mock('./customer-repository', () => ({
  getAdminCustomerRepository: () => ({ findById: mocks.findById }),
  getAdminWalletRepository: () => ({ listEntries: mocks.listEntries }),
  getAdminAddressRepository: () => ({ listByCustomer: mocks.listAddresses }),
  getAdminVehicleRepository: () => ({ listByCustomer: mocks.listVehicles }),
}));
vi.mock('../orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ listSummariesByCustomer: mocks.listSummariesByCustomer }),
}));
vi.mock('server-only', () => ({}));

import { loadCustomerDetail } from './load-customer-detail';

// OD 片 3a:客戶明細五路取數抽成共用實作的守門。
//
// 🔴 **這支測試存在的第一個理由是「原本零覆蓋」**:`app/customers/[id]/page.tsx` 在本片之前
//    **全 repo 沒有任何測試 import 它**(數法:`grep -rn 'customers/\[id\]/page' --include='*.test.*'`
//    → 0 行;該目錄下只有 `page.tsx`)。抽共用等於讓**兩個**消費端依賴同一份容錯契約,
//    而那份契約當時沒有任何守門 —— 抽出來卻不補測試,是把無保護的東西複製給更多人用。
//
// 🔴 第二個理由是「失敗 vs 查無」這條分流:兩者的 `customer` 都是 `null`,
//    差別只在 `customerFailed` 旗標,而呼叫端拿它決定 **404** 還是**錯誤態**。
//    分流寫反 = 把一次讀取失敗顯示成「這個客人不存在」。

const CUSTOMER = { userId: 'cu-1', name: '王小明' };

function allOk() {
  mocks.findById.mockResolvedValue(CUSTOMER);
  mocks.listEntries.mockResolvedValue([{ id: 'w1' }]);
  mocks.listSummariesByCustomer.mockResolvedValue([{ id: 'o1' }]);
  mocks.listAddresses.mockResolvedValue([{ id: 'a1' }]);
  mocks.listVehicles.mockResolvedValue([{ id: 'v1' }]);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('loadCustomerDetail — 五路取數', () => {
  it('全成功:五路資料都在、旗標全 false', async () => {
    allOk();
    const data = await loadCustomerDetail('cu-1');
    expect(data.customer).toEqual(CUSTOMER);
    expect(data.walletEntries).toHaveLength(1);
    expect(data.orders).toHaveLength(1);
    expect(data.addresses).toHaveLength(1);
    expect(data.vehicles).toHaveLength(1);
    expect([
      data.customerFailed,
      data.walletLoadFailed,
      data.ordersLoadFailed,
      data.addressesLoadFailed,
      data.vehiclesLoadFailed,
    ]).toEqual([false, false, false, false, false]);
  });

  /**
   * 🔴 這兩格是本檔的核心:`customer === null` 有兩個成因,而它們的處置**相反**
   * (查無 → 404;失敗 → 錯誤態 200)。混用就是把讀取失敗顯示成「查無此人」。
   */
  it('🔴 客戶本體**讀取失敗** → customer=null 且 customerFailed=true(呼叫端據此顯錯誤態、不得 404)', async () => {
    allOk();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findById.mockRejectedValue(new Error('boom'));
    const data = await loadCustomerDetail('cu-1');
    expect(data.customer).toBeNull();
    expect(data.customerFailed).toBe(true);
  });

  it('🔴 客戶**真的查無** → customer=null 但 customerFailed=false(呼叫端據此 404)', async () => {
    allOk();
    mocks.findById.mockResolvedValue(null);
    const data = await loadCustomerDetail('cu-1');
    expect(data.customer).toBeNull();
    expect(data.customerFailed).toBe(false);
  });

  /**
   * 🔴 不連坐:單一區塊壞掉只讓該區塊降級,基本資料照看。
   * 這條若退化成 `Promise.all`,任何一路壞掉都會讓整張客人卡變錯誤頁 ——
   * 而「車庫查詢壞了 ⇒ 看不到客人電話」對員工是完全無法理解的失敗。
   */
  it.each([
    ['儲值金流水', 'listEntries', 'walletLoadFailed', 'walletEntries'],
    ['訂單歷史', 'listSummariesByCustomer', 'ordersLoadFailed', 'orders'],
    ['收件地址', 'listAddresses', 'addressesLoadFailed', 'addresses'],
    ['車庫', 'listVehicles', 'vehiclesLoadFailed', 'vehicles'],
  ] as const)(
    '🔴 %s 壞掉:該區塊旗標 true + 回空陣列,而客戶本體不連坐',
    async (_label, mockKey, failFlag, dataKey) => {
      allOk();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks[mockKey].mockRejectedValue(new Error('boom'));
      const data = await loadCustomerDetail('cu-1');
      expect(data[failFlag]).toBe(true);
      expect(data[dataKey]).toEqual([]);
      // 不連坐:客戶本體照常
      expect(data.customer).toEqual(CUSTOMER);
      expect(data.customerFailed).toBe(false);
    },
  );

  /**
   * 🔴 五路並行(退化成序列 ⇒ 面板開啟時間變五倍)。
   *
   * ⚠️ **這格的第一版覆蓋不全,code-reviewer 實測擊破**(2026-08-13,本片 important):
   *    原本只斷言 `listEntries` 與 `listVehicles` 兩支 ⇒ 把 orders 那一路挪出去序列化
   *    (`await allSettled([a,b,d,e]); await c();`)**測試照樣綠**,而**「面板版要自己抓 orders」
   *    正是最可能被挪出去的那一路**。病名同本片其他幾處:斷言量到的比它宣稱的窄。
   * ⇒ 現在**五支全斷言**,少任何一支被移出批次都會紅。
   *
   * 量法:第一支卡住不 resolve 的狀態下,其餘四支**必須都已經被呼叫**。
   * (array literal 是同步求值 ⇒ 五個 IIFE 在 `allSettled` 收集參數時就全部發動;
   *  序列實作則會卡在第一個 `await`,後面幾支一次都沒被呼叫到。)
   */
  it('🔴 五路都是並行發動(不是逐一 await),五支全查', async () => {
    let releaseFirst: (() => void) | undefined;
    mocks.findById.mockReturnValue(
      new Promise((resolve) => {
        releaseFirst = () => resolve(CUSTOMER);
      }),
    );
    mocks.listEntries.mockResolvedValue([]);
    mocks.listSummariesByCustomer.mockResolvedValue([]);
    mocks.listAddresses.mockResolvedValue([]);
    mocks.listVehicles.mockResolvedValue([]);

    const pending = loadCustomerDetail('cu-1');
    // 第一支還沒 resolve,但五支都已發動 ⇒ 並行
    for (const [label, fn] of [
      ['客戶本體', mocks.findById],
      ['儲值金流水', mocks.listEntries],
      ['訂單歷史', mocks.listSummariesByCustomer],
      ['收件地址', mocks.listAddresses],
      ['車庫', mocks.listVehicles],
    ] as const) {
      expect(fn, `${label} 沒有在第一批發動 ⇒ 它被挪出並行了`).toHaveBeenCalledTimes(1);
    }
    releaseFirst?.();
    await pending;
  });

  /**
   * 🔴 log label ↔ 區塊的配對(code-reviewer nit)。
   * 原本 `console.error` 被 spy 掉、無人斷言 ⇒ label 寫反(例如 '收件地址' 與 '車庫' 互換)
   * 不會有任何測試轉紅。本片正好是「**把 log 契約複製給更多消費端**」的時機 ——
   * 面板版落地後,log 讀者要靠這個 label 判斷是哪一區塊壞了。
   */
  it('🔴 失敗 log 的 label 指向真正壞掉的那一路(寫反不會有別的守門抓到)', async () => {
    allOk();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.listVehicles.mockRejectedValue(new Error('boom'));
    await loadCustomerDetail('cu-1');
    const messages = spy.mock.calls.map((call) => String(call[0]));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('車庫');
    expect(messages[0]).not.toContain('收件地址');
  });
});
