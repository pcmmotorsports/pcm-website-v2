import type { OrderStatusOption } from '@pcm/domain';

/**
 * IOrderStatusOptionsRepository: 後台訂單處理狀態詞彙(order_status_options)讀取 port(M-4a Slice A)。
 *
 * Sean 可設定的「收款×訂定×貨況合併彩色狀態」策展清單(設計真權威
 * docs/specs/2026-07-13-m4a-order-workflow-status-design.md)。**刻意獨立於 IOrderRepository**:
 * 會員側完全用不到本詞彙(orders.workflow_status 純後台操作軸)、拆港避免動到會員側 port 表面
 * (listByCustomer / listSummariesByCustomer 等零接觸)。
 *
 * admin-only:實作走 service_role(order_status_options 對 anon/authenticated 全鎖、RLS zero-policy)。
 * 寫入方法(增/改/排序/停用 = Slice D 設定 UI)屆時再擴,本片唯讀。
 */
export interface IOrderStatusOptionsRepository {
  /**
   * 列出全部狀態選項(含 is_active=false;sort_order ASC)。
   *
   * 回全量而非只 active:列表 badge 要能解析「指向已停用選項」的舊單 label/color(soft-delete
   * 語意);下拉/篩選 UI 端自行 `filter(isActive)`。詞彙量 = Sean 策展(個位數~十位數),無分頁。
   */
  listOrderStatusOptions(): Promise<OrderStatusOption[]>;
}
