import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// refund-recovery-read.ts — M-3 A7c RW4:恢復對帳專用的帳本窄讀(server action 專用)。
//
// 🔴 與 refund-read.ts(顯示投影)刻意分檔:那邊的投影**零 rec_trade_id / 零 baseline**
//    (顯示層不該摸得到對帳材料);本檔的快照反過來**只給 server action 消費、不外流 UI**。
//    也不放 refund-repository.ts —— 那檔是兩支寫入 RPC 的唯一呼叫端(鐵則 6 行數紀律
//    亦不允許再長),讀寫合檔會讓「改對帳讀」踩到已審過的錢面。
//
// 🔴 兄弟列讀數 fail-closed:超上限丟 RecoveryReadIntegrityError —— 截斷後的 SUM /
//    在途計數是**錯的數**,拿去餵判定會把 other_in_flight 判漏、把 RF8 對帳算小;
//    這是「重試不會好」的資料異常(opus nit 折入:呼叫端映停手訊息、不映重試)。

/** 資料完整性異常(重試不會好;呼叫端必須映「停手找維護」而非「稍後再試」)。 */
export class RecoveryReadIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryReadIntegrityError';
  }
}

/**
 * 帳本終態 allowlist(與 S6 status CHECK 對齊;`20260803150000` §2)。
 * 🔴 在途計數用「非終態」反面數(opus C4 折入):S6 未來新增第五個狀態值時,
 * 白名單數 processing 會靜默歸 0(fail-open);反面數會把未知新狀態當在途(fail-closed),
 * 並逼新增狀態的人回訪本檔。
 */
export const TERMINAL_REFUND_STATUSES: readonly string[] = ['confirmed', 'failed', 'deferred'];

/**
 * 判定與結案要的帳本列快照。
 * `recTradeId` / `recordRefundedBefore` / `providerEvidence` 是對帳材料,只在 action 內用。
 */
export type RecoveryRefundSnapshot = {
  id: string;
  orderId: string;
  /** 確認碼比對用(訂單號末 4 碼;Q2=A 人因閘)。FK 保證有母單;缺=資料異常、呼叫端停手。 */
  orderDisplayId: string | null;
  status: string;
  refundAmount: number;
  /** 列上快照(`order_refunds.rec_trade_id`);判定對這一筆,不讀 orders 現值(快照語意)。 */
  recTradeId: string;
  /** S2 baseline(RW4 差額判定的錨;`20260803150000:177`)。 */
  recordRefundedBefore: number;
  providerEvidence: string | null;
  createdAt: string;
  /** 同單其他**非終態**列數(S5 下應恆 0;判定 executed 出口的縱深輸入;見 TERMINAL 註解)。 */
  otherInFlightCount: number;
  /** RF8 讀數:同單 confirmed 列的金額總和(帳本已登記額;與 Record 累計對帳)。 */
  ledgerConfirmedSum: number;
  /** RF8 讀數:confirmed 列缺 tappay_refund_id 的筆數(P7C09 下應恆 0;>0=資料異常告警)。 */
  confirmedMissingRefundId: number;
};

/** 兄弟列上限(見檔頭 fail-closed 段;一張單的帳本列在正常營運下是個位數)。 */
export const RECOVERY_SIBLINGS_LIMIT = 500;

/** 恢復對帳的帳本重讀。查無 → null;兄弟列超上限 → RecoveryReadIntegrityError。 */
export async function findRefundForRecovery(
  refundId: string,
): Promise<RecoveryRefundSnapshot | null> {
  const client = createSupabaseServiceClient();
  const { data, error } = await client
    .from('order_refunds')
    // embed 無空格 = house 字面(refund-read.ts 同款;真 PostgREST 形狀證據=handoff §3h/§3i)。
    .select(
      'id, order_id, status, refund_amount, rec_trade_id, record_refunded_before, provider_refund_id_evidence, created_at, orders(display_id)',
    )
    .eq('id', refundId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const raw = data as {
    id: string;
    order_id: string;
    status: string;
    refund_amount: number;
    rec_trade_id: string;
    record_refunded_before: number;
    provider_refund_id_evidence: string | null;
    created_at: string;
    orders: { display_id: string } | null;
  };

  // 兄弟列一次讀(在途計數 + RF8 兩讀數同源;顯式上限=平台 max-rows 教訓)。
  const siblings = await client
    .from('order_refunds')
    .select('id, status, refund_amount, tappay_refund_id')
    .eq('order_id', raw.order_id)
    .neq('id', refundId)
    .limit(RECOVERY_SIBLINGS_LIMIT + 1);
  if (siblings.error) throw siblings.error;
  const rows = siblings.data as {
    id: string;
    status: string;
    refund_amount: number;
    tappay_refund_id: string | null;
  }[];
  if (rows.length > RECOVERY_SIBLINGS_LIMIT) {
    throw new RecoveryReadIntegrityError(
      `findRefundForRecovery: 訂單 ${raw.order_id} 帳本列超過 ${RECOVERY_SIBLINGS_LIMIT},截斷後的對帳讀數不可信`,
    );
  }
  const confirmed = rows.filter((row) => row.status === 'confirmed');
  return {
    id: raw.id,
    orderId: raw.order_id,
    orderDisplayId: raw.orders?.display_id ?? null,
    status: raw.status,
    refundAmount: raw.refund_amount,
    recTradeId: raw.rec_trade_id,
    recordRefundedBefore: raw.record_refunded_before,
    providerEvidence: raw.provider_refund_id_evidence,
    createdAt: raw.created_at,
    otherInFlightCount: rows.filter(
      (row) => !TERMINAL_REFUND_STATUSES.includes(row.status),
    ).length,
    ledgerConfirmedSum: confirmed.reduce((sum, row) => sum + row.refund_amount, 0),
    confirmedMissingRefundId: confirmed.filter((row) => row.tappay_refund_id === null).length,
  };
}
