import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// manual-refund-read.ts — M-4b E10 D3:非卡退款帳本唯讀查詢(訂單頁登記列表)。
//
// 🔴 與 refund-read.ts(TapPay 帳本)刻意分檔,同 order_manual_refunds 建表 migration
//    (20260820010000)的紀律:「寫入 RPC 合約」與「純顯示投影」分檔,兩本帳的分界寫在
//    DB CHECK 裡,app 層的讀取路徑也不共用。
// 🔴 本表刻意沒有 status(D1 header 段:「記的是一件已經發生的事」)⇒ 投影裡沒有狀態欄,
//    也沒有 isRefundException 那類異常判定 —— 這張表沒有那個語意。

// 🔴 D3-c 加了三個作廢欄。**不加的話,作廢完畫面看起來一模一樣** ——
//    而 D3-b 的 UPDATE 只動這三欄,那一列的金額/理由/經手人全部原樣留著。
const ROW_COLUMNS =
  'id, rail, refund_amount, reason, actor, occurred_at, created_at, voided_at, void_reason, voided_by';

export type ManualRefundRow = {
  id: string;
  rail: string;
  refundAmount: number;
  reason: string;
  actor: string;
  /** 錢實際交回去的時刻(員工填)。 */
  occurredAt: string;
  /** 登記時刻(系統記)。 */
  createdAt: string;
  /** 🔴 非 null = 這筆登記已被作廢(D3-c)。作廢**不動錢**,它說的是「這筆登記本身記錯了」。 */
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
};

type RawRow = {
  id: string;
  rail: string;
  refund_amount: number;
  reason: string;
  actor: string;
  occurred_at: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
};

function toRow(raw: RawRow): ManualRefundRow {
  return {
    id: raw.id,
    rail: raw.rail,
    refundAmount: raw.refund_amount,
    reason: raw.reason,
    actor: raw.actor,
    occurredAt: raw.occurred_at,
    createdAt: raw.created_at,
    voidedAt: raw.voided_at,
    voidReason: raw.void_reason,
    voidedBy: raw.voided_by,
  };
}

/** 顯式上限 + truncated 旗標(同 refund-read.ts 的紀律:不帶 .limit 只是在平台的
 *  db-max-rows 被靜默截斷)。這張表每單筆數天生遠小於卡片退款帳本,先給一個保守值。 */
export const ORDER_MANUAL_REFUNDS_LIMIT = 100;

/** 某訂單的非卡退款登記列(新到舊;truncated=還有更舊的列沒顯示)。 */
export async function listOrderManualRefunds(
  orderId: string,
): Promise<{ rows: ManualRefundRow[]; truncated: boolean }> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_manual_refunds')
    .select(ROW_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(ORDER_MANUAL_REFUNDS_LIMIT + 1);
  if (error) throw error;
  const raw = data as RawRow[];
  return {
    rows: raw.slice(0, ORDER_MANUAL_REFUNDS_LIMIT).map(toRow),
    truncated: raw.length > ORDER_MANUAL_REFUNDS_LIMIT,
  };
}
