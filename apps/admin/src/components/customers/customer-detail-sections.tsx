import Link from 'next/link';
import type { CustomerAddress, CustomerVehicle, OrderListItem } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  formatOrderAmount,
} from '../../lib/orders/order-list-view';
import { formatCustomerDate } from '../../lib/customers/customer-list-view';
import { ADDRESS_INVOICE_LABEL } from '../../lib/customers/customer-detail-view';

// M-4a 客戶明細-b:訂單歷史/地址/車庫三 section(server-render 唯讀;customer-detail.tsx 組裝)。
// 🔴 訂單歷史=OrderListItem 摘要投影(型別層零經銷價/成本欄、total=該客成交價);
//    地址含發票設定、車庫含引擎號/里程=PII 同頁邊界(admin-only、登入閘後)。
// 🔴🔴 ~~已知限制(#278):listSummariesByCustomer 沿用 #249 隱含濾 unpaid(storefront 會員視角
//    藏放棄付款孤兒單)→ 本頁「訂單歷史」看不到該客待付款單(admin /orders 列表篩「待付款」
//    看得到同一單);admin 專用含 unpaid 查法=另片,詳 backlog #278。~~
// **⇒ 2026-08-24 上面整段【已不成立】**:`#249` 那道 `.neq('payment_status','unpaid')` 已被拆掉
//    (`SupabaseOrderAdapter.ts` 的 `listSummariesByCustomer`,Sean 拍板【丙:不要藏,顯示並標狀態】)
//    ⇒ **本頁現在【看得到】該客的待付款單** ⇒ `#278` 那個「兩個後台頁互相矛盾」被順手修掉了。
//
// 🔴 **而這一段是【被審查抓到的】,不是我主動想起來的** —— 那一片動的是 storefront 的畫面,
//    而 `listSummariesByCustomer` 是**跨兩個 app 的共用方法**:
//    `load-customer-detail.ts:104` 呼叫的就是同一支。
//    📌 **改一個共用方法時,「我改的是哪個畫面」不是分母 —— 分母是【誰在呼叫它】。**
//
// ⚠️ ~~**而本頁沒有為此加任何欄位**:清單投影 `ORDER_LIST_SELECT` **不含 `cancelled_at`**~~
//    ⇒ 2026-08-25 實查:`ORDER_LIST_SELECT` **含** `cancelled_at`
//      (`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:99`,由 `2e276a10` 加入)
//      ⇒ **原句的【前提】為假。**
//    ⇒ 🔴 **而結論仍然成立,只是理由換了一個** —— 不是撈不到,是**本頁沒有讀它**:
//      `grep -n 'cancelled\|Cancelled' <本檔>` ⇒ **命中全部落在註解行**(判別式:
//      同一發接 `| grep -cv '://'` ⇒ 0 ⇒ 沒有任何一格在真的碼上);
//      正對照 `grep -c 'paymentStatus\|payment_status' <本檔>` ⇒ 2(那兩格在碼上)⇒ 尺會動。
//      🔴 **這是自指的量測** —— 本段註解自己就是命中的一部分,寫下它就改變了它
//      ⇒ 只寫「全在註解行」這個**程序**,不寫命中數那個**絕對值**。
//      ⇒ **已取消的單在本頁也會顯示,而分不出來**(同 storefront 的那一格,見那支檔的決策題)。
//    📌 **一句話讀起來對,不代表它下面那句依據是對的** —— 這一段的結論從頭到尾沒錯,
//      而它拿來當依據的那個事實在 `2e276a10` 那天就死了,**沒有任何東西會紅**。
//    ⇒ **那一格未決,本頁跟著未決。** 不要單獨在這裡補一個 admin 專用的判法。
// 編輯/刪除不在此(後台寫入片另議);V-1d dict 欄唯讀顯示。

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';
const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm align-top';
const BADGE = 'bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs';

function SectionFailed({ what }: { what: string }) {
  return <p className='text-destructive py-2 text-sm'>{what}載入失敗,請稍後再試(其他區塊不受影響)。</p>;
}

export function CustomerOrdersSection({
  orders,
  loadFailed,
  orderHref = (orderId) => `/orders/${orderId}`,
}: {
  orders: OrderListItem[];
  loadFailed: boolean;
  /**
   * OD 片 3b:單號連到哪。**預設 = 整頁版**(既有呼叫端行為一個字不變)。
   *
   * 🔴 訂單面板版傳的是「**換成那張訂單的面板**」連結,兌現 Sean 2026-08-13 逐字
   *    「點客人變成看向訂單一樣,**然後再點訂單**或者回去變成看訂單」——
   *    在面板裡點一張單要**換面板內容**,不是把員工丟去整頁版、把面板弄不見。
   * ⚠️ 這是**注入而不是判斷**:本元件不知道自己在面板還整頁裡,也不該知道
   *    (它同時被兩邊用)。由呼叫端決定連去哪。
   */
  orderHref?: (orderId: string) => string;
}) {
  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>訂單歷史</h2>
      {loadFailed ? (
        <SectionFailed what='訂單歷史' />
      ) : orders.length === 0 ? (
        <p className='text-muted-foreground py-2 text-sm'>目前沒有訂單紀錄。</p>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <table className='w-full border-collapse'>
            <thead>
              <tr>
                <th className={TH}>單號</th>
                <th className={TH}>日期</th>
                <th className={`${TH} text-right`}>件數</th>
                <th className={`${TH} text-right`}>金額</th>
                <th className={TH}>付款</th>
                {/* 🔴🔴 `#514`:「出貨」那一欄 2026-08-15 **拿掉**,不是忘了畫。
                    它讀的是 `orders.fulfillment_status` —— 那一欄 COLUMN COMMENT 自己寫著
                    「E10 起停止維護、值為 legacy stale、不得當現況真相」
                    (`20260729010000_m4b_e10_d0_display_id_expand.sql:88` 逐字),**全 migrations 零 writer**
                    ⇒ 正式庫 13/13 全是 DEFAULT ⇒ **這一欄從來沒有正確過一次**。
                    ⚠️ **為什麼這裡是「拿掉」而訂單明細頁是「改讀真相」——不是不一致,是【手上有沒有真相】**:
                    明細頁的 `AdminOrderDetail.items[]` 帶著三軸數量摘要、**零新查詢**就算得出來;
                    而本表吃的 `OrderListItem` 只有 7 欄、**零數量資料**,要補真相得改 `OrderListItem` 本身,
                    而它橫跨 **12 個非測試檔**(storefront 會員頁 4 + admin 3 + `packages/ports` 共用契約)
                    ⇒ 中鐵則 8+12、不成比例。**在沒有真相的地方硬留一格,只能留一個永遠錯的值。**
                    🔴 要補回來請走 `#514` 的長期那半(欄位本體處置,碰 schema、要 Sean)。 */}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className='border-t'>
                  <td className={`${TD} whitespace-nowrap font-medium`}>
                    <Link href={orderHref(order.id)} className='hover:underline'>
                      {order.displayId}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatCustomerDate(order.createdAt)}</td>
                  <td className={`${TD} text-right whitespace-nowrap`}>{order.itemCount}</td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    NT$ {formatOrderAmount(order.total.amount)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</td>
                  {/* `#514`:出貨欄已移除,理由見表頭註解。 */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CustomerAddressesSection({
  addresses,
  loadFailed,
}: {
  addresses: CustomerAddress[];
  loadFailed: boolean;
}) {
  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>收件地址</h2>
      {loadFailed ? (
        <SectionFailed what='收件地址' />
      ) : addresses.length === 0 ? (
        <p className='text-muted-foreground py-2 text-sm'>目前沒有收件地址。</p>
      ) : (
        <ul className='space-y-3'>
          {addresses.map((address) => (
            <li key={address.id} className='rounded-lg border p-3 text-sm'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{address.name}</span>
                {address.phone && <span className='text-muted-foreground'>{address.phone}</span>}
                {address.isDefault && <span className={BADGE}>預設</span>}
              </div>
              <p className='mt-1 break-all'>{address.line}</p>
              <p className='text-muted-foreground mt-1'>
                發票:{ADDRESS_INVOICE_LABEL[address.invoice.type]}
                {address.invoice.type === 'personal' && address.invoice.carrier
                  ? ` · 載具 ${address.invoice.carrier}`
                  : ''}
                {address.invoice.type === 'company' && (address.invoice.title || address.invoice.taxId)
                  ? ` · ${[address.invoice.title, address.invoice.taxId && `統編 ${address.invoice.taxId}`]
                      .filter(Boolean)
                      .join(' / ')}`
                  : ''}
                {address.invoice.type === 'donate' && address.invoice.donateCode
                  ? ` · 愛心碼 ${address.invoice.donateCode}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CustomerVehiclesSection({
  vehicles,
  loadFailed,
}: {
  vehicles: CustomerVehicle[];
  loadFailed: boolean;
}) {
  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>車庫</h2>
      {loadFailed ? (
        <SectionFailed what='車庫' />
      ) : vehicles.length === 0 ? (
        <p className='text-muted-foreground py-2 text-sm'>目前沒有愛車資料。</p>
      ) : (
        <ul className='space-y-3'>
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className='rounded-lg border p-3 text-sm'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{vehicle.name}</span>
                {vehicle.year && <span className='text-muted-foreground'>{vehicle.year}</span>}
                {vehicle.isPrimary && <span className={BADGE}>主要車輛</span>}
                {/* V-1d 字典鍵唯讀顯示:有值=已對上車款字典(愛車 chips 可精確命中)、null=自由輸入/舊資料 */}
                {vehicle.dictBrandName && vehicle.dictModelName && (
                  <span className={BADGE}>
                    字典:{vehicle.dictBrandName} {vehicle.dictModelName}
                  </span>
                )}
              </div>
              <p className='text-muted-foreground mt-1'>
                {[
                  vehicle.engine && `引擎號 ${vehicle.engine}`,
                  vehicle.km && `里程 ${vehicle.km}`,
                  vehicle.mods && `已改裝 ${vehicle.mods}`,
                  vehicle.service && `最近保養 ${formatCustomerDate(vehicle.service)}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
