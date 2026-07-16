import Link from 'next/link';
import type { CustomerAddress, CustomerVehicle, OrderListItem } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  formatOrderAmount,
} from '../../lib/orders/order-list-view';
import { formatCustomerDate } from '../../lib/customers/customer-list-view';
import { ADDRESS_INVOICE_LABEL } from '../../lib/customers/customer-detail-view';

// M-4a 客戶明細-b:訂單歷史/地址/車庫三 section(server-render 唯讀;customer-detail.tsx 組裝)。
// 🔴 訂單歷史=OrderListItem 摘要投影(型別層零經銷價/成本欄、total=該客成交價);
//    地址含發票設定、車庫含引擎號/里程=PII 同頁邊界(admin-only、登入閘後)。
// ⚠️ 已知限制(#278):listSummariesByCustomer 沿用 #249 隱含濾 unpaid(storefront 會員視角
//    藏放棄付款孤兒單)→ 本頁「訂單歷史」看不到該客待付款單(admin /orders 列表篩「待付款」
//    看得到同一單);admin 專用含 unpaid 查法=另片,詳 backlog #278。
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
}: {
  orders: OrderListItem[];
  loadFailed: boolean;
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
                <th className={TH}>出貨</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className='border-t'>
                  <td className={`${TD} whitespace-nowrap font-medium`}>
                    <Link href={`/orders/${order.id}`} className='hover:underline'>
                      {order.displayId}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatCustomerDate(order.createdAt)}</td>
                  <td className={`${TD} text-right whitespace-nowrap`}>{order.itemCount}</td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    NT$ {formatOrderAmount(order.total.amount)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus]}
                  </td>
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
