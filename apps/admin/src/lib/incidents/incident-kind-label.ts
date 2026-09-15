// incident-kind-label.ts — pcm_incident.kind 的中文標籤(稽核 P2-7;plan docs/plans/2026-09-15-admin-incident-list-plan.md §4-B)
//
// 🔴 **鍵一律單引號,不是排版偏好**:`packages/adapters/src/payment/incident-kind-two-truths.test.ts` 的第三把尺
//    用「單引號字串 + 冒號」抽鍵,拿去對 DB 的 `pcm_incident_kind_check` 封閉集。拿掉引號 ⇒ 抽到 0 個 ⇒ 那把尺當場丟例外。
//    ⇒ DB 加第 7 種而這張表沒加,那支測試會紅。
// 🔴 本檔**不 import 任何 runtime 模組**:測試端是讀原始碼字面,不 import 本檔。

export const INCIDENT_KIND_LABEL = {
  'pending_refund_open_failed': '補開待退款失敗',
  'refund_over_total': '退款超過訂單總額',
  'auto_cancel_skipped': '自動取消略過',
  'auto_cancel_failed': '自動取消失敗',
  'line_forward_failed': 'LINE 轉發失敗',
  'auto_cancel_live_shipment': '自動取消後箱子未作廢',
} as const;

export type IncidentKind = keyof typeof INCIDENT_KIND_LABEL;

/**
 * `subject_id` 不是訂單 id 的種類。
 * 🔴 `line_forward_failed` 寫入時固定傳 NULL(`20260914100000:64`);其餘五種寫入點傳的都是 `p_order_id`
 *    (`20260905290000`、`20260914060000`、`20260916010000` 各寫入點,設計窗 2026-09-15 抽核)。
 */
const KINDS_WITHOUT_ORDER: ReadonlySet<string> = new Set<string>(['line_forward_failed']);

/** 認得的種類回中文;認不得的原樣印出來,不吞成空白(DB 先加了種類而這裡還沒跟上時,員工仍看得到是什麼)。 */
export function incidentKindLabel(kind: string): string {
  return Object.hasOwn(INCIDENT_KIND_LABEL, kind)
    ? INCIDENT_KIND_LABEL[kind as IncidentKind]
    : `未知種類(${kind})`;
}

/** 這一筆的 `subject_id` 能不能當訂單連結。 */
export function incidentSubjectIsOrder(kind: string, subjectId: string | null): subjectId is string {
  return subjectId !== null && !KINDS_WITHOUT_ORDER.has(kind);
}
