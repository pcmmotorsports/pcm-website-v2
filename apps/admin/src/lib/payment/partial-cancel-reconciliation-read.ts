import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * OP7 ④ 對帳面的讀取端(`pcm_partial_cancel_refund_reconciliation_v`,migration `20260914070000`)。
 *
 * 🔴 **它就是「對帳在交易外」那一半**(主視窗 A 2026-09-08:丙 = recompute + 對帳【兩件一起】;
 *    codex 2026-09-14 R1 must-fix 6:view 沒有讀它的人 = 對帳不存在)。
 *    呼叫點 = 後台 `/orders/refund-exceptions` 那頁(值班本來就每天看它);**不在任何 trigger / RPC 的呼叫鏈上**。
 * 🔴 view 還沒貼(`20260914070000` 未貼)⇒ PostgREST 回錯 ⇒ 這裡 **throw**,頁面顯示「載入失敗」而不是「0 張」——
 *    「沒貼」與「沒有異常」不可以印同一個結果。
 * 🛑 零 PII:只回 order_id / kind / 三個金額;單號 / 客人由頁面自己查(它已有那條路)。
 */
export type PartialCancelReconciliationKind = 'has_card' | 'tax_uncomputable' | 'missing_row' | 'rail_mismatch';
export type PartialCancelReconciliationRow = {
  orderId: string;
  kind: PartialCancelReconciliationKind;
  /** 依 Q13 該開的總額;`null` = 待人工確認(has_card 一律 null:非卡差額不是整單該退;或剩餘應收算不出來)。 */
  expectedTotal: number | null;
  /** 目前未結待退款列合計。 */
  openTotal: number;
  noncardNet: number;
  allNet: number;
  remaining: number | null;
};

const LIMIT = 200;
const KINDS: ReadonlySet<string> = new Set(['has_card', 'tax_uncomputable', 'missing_row', 'rail_mismatch']);

type Raw = {
  order_id: string;
  kind: string;
  expected_total: number | string | null;
  open_total: number | string;
  noncard_net: number | string;
  all_net: number | string;
  remaining: number | string | null;
};

const num = (v: number | string): number => (typeof v === 'string' ? Number(v) : v);

export async function listPartialCancelReconciliation(): Promise<{
  rows: PartialCancelReconciliationRow[];
  truncated: boolean;
}> {
  const { data, error } = await createSupabaseServiceClient()
    .from('pcm_partial_cancel_refund_reconciliation_v' as never)
    .select('order_id, kind, expected_total, open_total, noncard_net, all_net, remaining' as never)
    .order('order_id' as never, { ascending: true })
    .limit(LIMIT + 1);
  if (error) throw error;
  const raw = (data ?? []) as unknown as Raw[];
  const rows = raw.slice(0, LIMIT).flatMap((r): PartialCancelReconciliationRow[] => {
    // 🔴 view 日後多一種 kind ⇒ 這裡不認得 ⇒ **不靜靜吞掉**:當成 rail_mismatch 一樣要人看(寬進嚴出)。
    const kind = (KINDS.has(r.kind) ? r.kind : 'rail_mismatch') as PartialCancelReconciliationKind;
    return [{
      orderId: r.order_id,
      kind,
      expectedTotal: r.expected_total === null ? null : num(r.expected_total),
      openTotal: num(r.open_total),
      noncardNet: num(r.noncard_net),
      allNet: num(r.all_net),
      remaining: r.remaining === null ? null : num(r.remaining),
    }];
  });
  return { rows, truncated: raw.length > LIMIT };
}

/** 值班看得懂的一句(每一種 kind 各一句;字面是這一片的規格,測試釘它)。 */
export const PARTIAL_CANCEL_RECONCILIATION_LABEL: Record<PartialCancelReconciliationKind, string> = {
  has_card: '這張單有刷卡收款 —— 系統不會自動開待退款(卡的退款另一條路),請人看要退多少',
  tax_uncomputable: '這張單有另計的稅,系統算不出取消後還該收多少 —— 請人算該退多少',
  missing_row: '算起來該退錢,而待退款一列都沒有 —— 可能是某條路沒觸發,請查',
  rail_mismatch: '待退款列跟現在的收款對不上(金額或軌別)—— 請對一次',
};
