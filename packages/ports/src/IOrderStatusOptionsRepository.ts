import type { OrderStatusOption, OrderStatusOptionUpdate } from '@pcm/domain';

/**
 * IOrderStatusOptionsRepository: 後台訂單處理狀態詞彙(order_status_options)讀取 port(M-4a Slice A)。
 *
 * Sean 可設定的「收款×訂定×貨況合併彩色狀態」策展清單(設計真權威
 * docs/specs/2026-07-13-m4a-order-workflow-status-design.md)。**刻意獨立於 IOrderRepository**:
 * 會員側完全用不到本詞彙(orders.workflow_status 純後台操作軸)、拆港避免動到會員側 port 表面
 * (listByCustomer / listSummariesByCustomer 等零接觸)。
 *
 * admin-only:實作走 service_role(order_status_options 對 anon/authenticated 全鎖、RLS zero-policy)。
 * M-4a Slice D-3 設定 UI 擴 `updateOrderStatusOption`(編輯既有);新增(create)留 D-3b。
 */
export interface IOrderStatusOptionsRepository {
  /**
   * 列出全部狀態選項(含 is_active=false;sort_order ASC)。
   *
   * 回全量而非只 active:列表 badge 要能解析「指向已停用選項」的舊單 label/color(soft-delete
   * 語意);下拉/篩選 UI 端自行 `filter(isActive)`。詞彙量 = Sean 策展(個位數~十位數),無分頁。
   */
  listOrderStatusOptions(): Promise<OrderStatusOption[]>;

  /**
   * 更新既有狀態選項(M-4a Slice D-3 設定頁編輯;code 為鍵、不可改)。
   * 🔴 只改 label/color/text_color/sort_order/is_active(DB column-level grant 已收窄;code/created_at 凍結)。
   * 回 'UPDATED'(命中)/ 'NOT_FOUND'(code 不存在)。停用走 isActive=false(soft-delete)。
   */
  updateOrderStatusOption(
    code: string,
    update: OrderStatusOptionUpdate,
  ): Promise<'UPDATED' | 'NOT_FOUND'>;
}
