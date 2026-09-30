import 'server-only';
import type { AdminOrderSummary } from '@pcm/domain';
import { getAdminOrderRepository } from './order-repository';
import { frozenListHref, hrefToRaw } from './order-list-count';
import { parseOrderListSearchParams } from './order-list-view';
import { TODO_LIST_SPECS } from '../dashboard/today-todo-read';

// 匯款對帳小工具的候選單 = 首頁「待收款（匯款）」+「待尾款」兩格的單(同一組篩選, 數字對得上)。
// 🔴 不套搜尋 cookie:對帳要找的是全部待收款的單, 不是剛好符合上一次搜尋的那幾張。

/** 每一格最多讀幾張。列表第二發用 `in (...)` 查應付餘額, 100 是那條網址量過的上限(`ADMIN_ORDER_ID_IN_CAP`)。 */
export const TRANSFER_CANDIDATE_LIMIT = 100;

export type TransferCandidates = {
  orders: AdminOrderSummary[];
  /** 有一格超過上限、沒讀完 ⇒ 畫面要講「只比對了前 N 張」。 */
  truncated: boolean;
};

/** 讀不到 ⇒ `null`(畫面說載入失敗, 不假裝沒有相符的單)。 */
export async function loadTransferCandidates(
  now: Date = new Date(),
  repo = getAdminOrderRepository(),
): Promise<TransferCandidates | null> {
  try {
    const results = await Promise.all(
      [TODO_LIST_SPECS.unpaidBankTransfer.filter, TODO_LIST_SPECS.partiallyPaid.filter].map((f) => {
        const filter = parseOrderListSearchParams(hrefToRaw(frozenListHref(f, now)), { now }).filter;
        return repo.listOrderSummariesForAdmin(filter, { limit: TRANSFER_CANDIDATE_LIMIT, offset: 0 });
      }),
    );
    const orders = results.flatMap((r) => r.items);
    // 🔴 Fable R1 B1:應付餘額那一發讀不到時 adapter 不丟錯, 每張單都是 null ⇒ 當讀不到。
    //    兩格都有 `pendingOnly`(排除已退款)⇒ 正常資料不會整批都是 null。
    if (orders.length > 0 && orders.every((o) => o.balanceDue === null)) {
      console.error('[transfer-match] 待收款訂單的應付餘額全部讀不到');
      return null;
    }
    return {
      orders,
      // 沒回總數 ⇒ 讀滿上限就當可能沒讀完(寧可多提醒一句)。
      truncated: results.some((r) =>
        r.total === undefined ? r.items.length >= TRANSFER_CANDIDATE_LIMIT : r.total > r.items.length,
      ),
    };
  } catch (e) {
    console.error('[transfer-match] 待收款訂單讀取失敗', e);
    return null;
  }
}
