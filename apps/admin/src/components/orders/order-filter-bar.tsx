import type { AdminOrderFilter } from '@pcm/domain';
import { OrderFilterControls } from './order-filter-controls';
import {
  PAYMENT_STATUS_OPTIONS,
  FULFILLMENT_STATUS_OPTIONS,
  ORDER_SOURCE_OPTIONS,
  PAYMENT_CHANNEL_OPTIONS,
  SHOW_UNPAID_CARD_ON,
} from '../../lib/orders/order-list-view';

// M-4a 訂單篩選列(D-1b:選了即時生效免按鈕;Sean Q1=A)。
// M-4b E10 A9w2(九碼退場):**商品狀態軸整條下架**(原主篩選)—— 選項來源 `order_status_options`
// 的策展詞彙不再進篩選列,本元件自此不吃 `statusOptions`(列表 cell 仍吃,隨 A11a-c 退場)。
// 現存 = 來源/管道多勾選;付款/出貨軸維持單選(拍板字面)、同步即時生效。互動核心=OrderFilterControls(單一 client
// state 導出 URL、router.replace → server 重讀 searchParams 重查、page 天然回 1);
// 「篩選」按鈕移除、「清除」保留(整頁載入=controls 重掛歸零)。

export function OrderFilterBar({
  filter,
  orderNumberSearchEnabled = false,
  supplierOrderNoSearchEnabled = false,
}: {
  filter: AdminOrderFilter;
  /** M-4b E10 A10c1 單號搜尋開關(§7.1 逐批啟用閘;D0 apply 前一律 false)。 */
  orderNumberSearchEnabled?: boolean;
  /** M-4b E10 A10c2 供應商單號搜尋開關(A9b2-M `20260807130000` apply 前一律 false)。 */
  supplierOrderNoSearchEnabled?: boolean;
}) {
  return (
    <div className='bg-card text-card-foreground flex flex-wrap items-end gap-3 rounded-lg border p-4'>
      <OrderFilterControls
        paymentOptions={PAYMENT_STATUS_OPTIONS}
        fulfillmentOptions={FULFILLMENT_STATUS_OPTIONS}
        sourceOptions={ORDER_SOURCE_OPTIONS}
        channelOptions={PAYMENT_CHANNEL_OPTIONS}
        orderNumberSearchEnabled={orderNumberSearchEnabled}
        supplierOrderNoSearchEnabled={supplierOrderNoSearchEnabled}
        initial={{
          pay: filter.paymentStatus ?? '',
          ful: filter.fulfillmentStatus ?? '',
          src: filter.orderSources ?? [],
          ch: filter.paymentChannels ?? [],
          no: filter.orderNumber ?? '',
          supplierNo: filter.supplierOrderNo ?? '',
          // L6:server 端解析出來的開關要餵回勾選框,否則重新整理後「勾沒了、列表卻是全顯示」。
          showUnpaidCard: filter.includeUnpaidCardOrders ? SHOW_UNPAID_CARD_ON : '',
        }}
      />
      <a
        href='/orders'
        className='border-input text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md border px-4 text-sm'
      >
        清除
      </a>
    </div>
  );
}
