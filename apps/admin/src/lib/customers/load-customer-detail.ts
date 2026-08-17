// 🔴 直接守 server 邊界,不只靠 `customer-repository` 傳遞式帶進來(code-reviewer nit):
//    本檔**專門設計成要被多處 import**,且回傳含 PII(email / 生日 / 地址 / 引擎號)。
//    哪天有人在 client component 裡 import 它,這一行讓它**編譯期就炸**,
//    而不是等 PII 已經進了瀏覽器 bundle 才發現。(順帶讓測試裡的 `vi.mock('server-only')`
//    從死碼變成真的在承重。)
import 'server-only';
import type {
  Customer,
  CustomerAddress,
  CustomerVehicle,
  OrderListItem,
  Paginated,
  WalletLedgerEntry,
} from '@pcm/domain';
import {
  getAdminCustomerRepository,
  getAdminWalletRepository,
  getAdminAddressRepository,
  getAdminVehicleRepository,
} from './customer-repository';
import { getAdminOrderRepository } from '../orders/order-repository';

// load-customer-detail.ts — 客戶明細五路取數的**單一實作**(OD 片 3a 從 `app/customers/[id]/page.tsx` 抽出)。
//
// 🔴 為什麼要抽:片 3 要讓**訂單面板**也開得出同一張客人卡(需求檔 §0-J J-4 逐字
//    「刻意不複製一份 markup 過來,不然兩邊遲早會長不一樣」)。
//    OD 在靜態 HTML 環境用 iframe 達成那件事;真站用「同一個元件 + 同一份取數」達成 ——
//    **而只共用元件、各自抓資料的話,不會長不一樣的是版面,會長不一樣的是「哪一區塊算失敗」。**
//    容錯策略(誰連坐、誰各自降級)本身就是行為契約,複製一份就是複製契約。
//
// 🔴 本檔零 UI、零 `notFound()`:呼叫端各自決定「查無」要 404 還是在面板裡顯示訊息
//    (面板裡呼叫 `notFound()` 會炸掉整個頁面 —— 見 `app/@panel/orders/page.tsx:47-49`
//    「員工手上的列表會整片消失」)。**這個分工是刻意的,不要把 notFound 搬進來。**

/** allSettled 結果收斂:成功取值、失敗 log + 旗標(各區塊分開容錯、基本資料不連坐)。 */
function settle<T>(
  settled: PromiseSettledResult<T>,
  fallback: T,
  label: string,
): { value: T; failed: boolean } {
  if (settled.status === 'fulfilled') {
    return { value: settled.value, failed: false };
  }
  console.error(`[admin/customers/:id] ${label}載入失敗`, settled.reason);
  return { value: fallback, failed: true };
}

/**
 * 客人卡「儲值金交易紀錄」每頁筆數。
 *
 * **【抄】既有慣例、不新造**：`PRODUCTS_PAGE_SIZE` / `CUSTOMERS_PAGE_SIZE` / `ORDERS_PAGE_SIZE`
 * 三處都是 20 ⇒ 這裡沿用同一個數。
 * ⚠️ 抄的理由是**一致性**（員工在不同列表看到同樣的翻頁節奏），
 * 不是這個數字有什麼技術特性 —— 今天稍早我才吃過「抄了形狀也抄了參數」的虧，
 * 兩種抄的理由不同，這裡是前者。
 */
export const WALLET_LEDGER_PAGE_SIZE = 20;

export type CustomerDetailData = {
  /**
   * 客戶本體。
   * 🔴 `null` 有**兩個成因,呼叫端必須分開處理**:
   *   ①`customerFailed === true` ⇒ **讀取失敗**(顯錯誤態,不得說「查無此人」)
   *   ②`customerFailed === false` ⇒ **真的查無**(404 或面板內的查無訊息)
   * 兩者混用就是把一次讀取失敗顯示成「這個客人不存在」。
   */
  customer: Customer | null;
  customerFailed: boolean;
  walletEntries: WalletLedgerEntry[];
  walletLoadFailed: boolean;
  /** 該會員儲值金流水【總筆數】（伺服器 count，非本頁筆數）。 */
  walletTotal: number;
  /** 目前是第幾頁（1-indexed；URL 竄改由 `parsePage` 下界到 1）。 */
  walletPage: number;
  orders: OrderListItem[];
  ordersLoadFailed: boolean;
  addresses: CustomerAddress[];
  addressesLoadFailed: boolean;
  vehicles: CustomerVehicle[];
  vehiclesLoadFailed: boolean;
};

/**
 * 五路並行取數(客戶本體 / 儲值金流水 / 訂單歷史 / 收件地址 / 車庫)。
 *
 * 🔴 `allSettled` 不是 `all`:單一區塊壞掉只讓該區塊顯示錯誤列,**基本資料不連坐**
 * (與訂單明細頁同慣例)。改成 `all` 會讓「車庫查詢壞掉」把整張客人卡打成錯誤頁。
 */
export async function loadCustomerDetail(
  id: string,
  options: { walletPage?: number } = {},
): Promise<CustomerDetailData> {
  // 🔴 分頁「顯示」不是分頁「撈取」：這一頁只要這一頁的列 + 伺服器算的總數。
  //    `count:'exact'` 不受 `db-max-rows` 限制 ⇒ 畫面能印「共 N 筆」而不必先把 N 筆撈下來。
  const walletPage = options.walletPage ?? 1;
  const [customerSettled, walletSettled, ordersSettled, addressesSettled, vehiclesSettled] =
    await Promise.allSettled([
      (async () => getAdminCustomerRepository().findById(id))(),
      (async () =>
        getAdminWalletRepository().listEntries(id, {
          limit: WALLET_LEDGER_PAGE_SIZE,
          offset: (walletPage - 1) * WALLET_LEDGER_PAGE_SIZE,
        }))(),
      (async () => getAdminOrderRepository().listSummariesByCustomer(id))(),
      (async () => getAdminAddressRepository().listByCustomer(id))(),
      (async () => getAdminVehicleRepository().listByCustomer(id))(),
    ]);

  const customerResult = settle<Customer | null>(customerSettled, null, '客戶明細');
  const wallet = settle<Paginated<WalletLedgerEntry>>(
    walletSettled,
    { items: [], total: 0 },
    '儲值金流水',
  );
  const orders = settle<OrderListItem[]>(ordersSettled, [], '訂單歷史');
  const addresses = settle<CustomerAddress[]>(addressesSettled, [], '收件地址');
  const vehicles = settle<CustomerVehicle[]>(vehiclesSettled, [], '車庫');

  return {
    customer: customerResult.value,
    customerFailed: customerResult.failed,
    walletEntries: wallet.value.items,
    walletLoadFailed: wallet.failed,
    walletTotal: wallet.value.total ?? 0,
    walletPage,
    orders: orders.value,
    ordersLoadFailed: orders.failed,
    addresses: addresses.value,
    addressesLoadFailed: addresses.failed,
    vehicles: vehicles.value,
    vehiclesLoadFailed: vehicles.failed,
  };
}
