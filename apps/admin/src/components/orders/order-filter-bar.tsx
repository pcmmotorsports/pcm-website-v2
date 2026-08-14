import type { AdminOrderFilter } from '@pcm/domain';
import { taipeiYmdFromDayEndExclusive, taipeiYmdFromInstantIso } from '@pcm/domain';
import { OrderFilterControls } from './order-filter-controls';
import {
  PAYMENT_STATUS_OPTIONS,
  GOODS_AXIS_OPTIONS,
  ORDER_SOURCE_OPTIONS,
  PAYMENT_CHANNEL_OPTIONS,
  SHOW_UNPAID_CARD_ON,
  type OrderDatePresetOption,
} from '../../lib/orders/order-list-view';
import { applyOrderKeywordSearchAction } from '../../lib/orders/keyword-search-action';
import {
  ORDER_KEYWORD_FIELD,
  ORDER_KEYWORD_RETURN_TO_FIELD,
} from '../../lib/orders/order-keyword-cookie';

// M-4a 訂單篩選列(D-1b:選了即時生效免按鈕;Sean Q1=A)。
// M-4b E10 A9w2(九碼退場):**商品狀態軸整條下架**(原主篩選)—— 選項來源 `order_status_options`
// 的策展詞彙不再進篩選列,本元件自此不吃 `statusOptions`(列表 cell 仍吃,隨 A11a-c 退場)。
// 現存 = 來源/管道多勾選;付款/出貨軸維持單選(拍板字面)、同步即時生效。互動核心=OrderFilterControls(單一 client
// state 導出 URL、router.replace → server 重讀 searchParams 重查、page 天然回 1);
// 「篩選」按鈕移除、「清除」保留(整頁載入=controls 重掛歸零)。

export function OrderFilterBar({
  filter,
  datePresetOptions,
  selectedDatePresetKey,
}: {
  filter: AdminOrderFilter;
  /** #347-3c-2:日期下拉的選項(server 算好區間;client 不碰時鐘)。 */
  datePresetOptions: OrderDatePresetOption[];
  /** #347-3c-2:選中的那一格 —— 與**真正生效的區間**同源(見 `resolveOrderDateRange`)。 */
  selectedDatePresetKey: string;
}) {
  return (
    <div className='bg-card text-card-foreground flex flex-wrap items-end gap-3 rounded-lg border p-4'>
      <OrderFilterControls
        datePresetOptions={datePresetOptions}
        paymentOptions={PAYMENT_STATUS_OPTIONS}
        goodsAxisOptions={GOODS_AXIS_OPTIONS}
        sourceOptions={ORDER_SOURCE_OPTIONS}
        channelOptions={PAYMENT_CHANNEL_OPTIONS}
        initial={{
          pay: filter.paymentStatus ?? '',
          // `#484a` A2:單選下拉 ⇒ 只取第一個值(型別是陣列、片 B 的 chip UI 才會有第二個)。
          //    🔴 用 `?? ''` 而不是 `?.[0] ?? ''` 之外再判空陣列 —— 空陣列的 `[0]` 就是 undefined,
          //    兩者都折成 '' = 全部,與其他軸的既有處置一致。
          goods: filter.goodsAxes?.[0] ?? '',
          src: filter.orderSources ?? [],
          ch: filter.paymentChannels ?? [],
          // L6:server 端解析出來的開關要餵回勾選框,否則重新整理後「勾沒了、列表卻是全顯示」。
          showUnpaidCard: filter.includeUnpaidCardOrders ? SHOW_UNPAID_CARD_ON : '',
          // #347-3c-1:日期兩軸**純透傳**(沒有可見控制項,下拉是 3c-2)。
          //    server 解析出來的絕對時刻換回曆面日,換算走 domain 那一份。
          // #347-3c-2:兩個曆面日 + 選中的那一格,全部來自同一份 server 解析結果。
          dateFrom: filter.createdFrom ? (taipeiYmdFromInstantIso(filter.createdFrom) ?? '') : '',
          dateTo: filter.createdTo ? (taipeiYmdFromDayEndExclusive(filter.createdTo) ?? '') : '',
          datePreset: selectedDatePresetKey,
        }}
      />
      {/* 🔴 #347-2b:這顆從 `<a href='/orders'>` 改成 **POST 同一支 action 送空字串**。
          原本它只清得掉 URL 上那六軸;關鍵字那一軸住在 httpOnly cookie 裡,
          按了「清除」之後 URL 乾淨、列表卻**還被關鍵字篩著**(code-reviewer 2026-08-10 nit-3)。
          走 action 才能一次清兩邊,而且與 chip 的「清除搜尋」是同一條 PRG 路徑
          (裁決條件①:不生第二條沒人守的路)。 */}
      <form action={applyOrderKeywordSearchAction}>
        <input type='hidden' name={ORDER_KEYWORD_FIELD} value='' />
        <input type='hidden' name={ORDER_KEYWORD_RETURN_TO_FIELD} value='/orders' />
        <button
          type='submit'
          className='border-input text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md border px-4 text-sm'
        >
          清除
        </button>
      </form>
    </div>
  );
}
