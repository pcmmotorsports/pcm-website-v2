/**
 * @module @pcm/domain/payment/anomaly-alert — 雙扣 anomaly 主動告警 domain 型別(M-3 #250)
 *
 * 主動告警(pull→push)的 domain 契約:
 * - `AnomalyAlertSummary` = SECDEF 聚合 RPC `get_payment_anomaly_alert_summary` 回的**零 PII 計數**
 *   (adapter 邊界把 DB snake_case jsonb 映射成 camelCase domain)。
 * - `AnomalyAlertMessage` = use-case 由 summary 組的**固定格式零 PII 告警訊息**(subject/text),
 *   兩管道(LINE/Email)送同一份內容、各自包裝 transport。
 *
 * 🔴 零 PII / 零金額 / 零單號:本契約**只含計數與年齡秒數**,不得引入 amount/user/order/rec 等可識別欄。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 * @see docs/phase-1-backlog.md #250
 */

/**
 * AnomalyAlertSummary:雙扣 anomaly + 死卡列的零 PII 計數摘要。
 * - `openCount` / `refundingCount`:anomaly status='open'(雙扣**候選**、待查證)/ 'refunding'。
 * - `refundingStuckCount`:refunding 卡逾營運門檻(route 常數注入、非 PRD SLA)。
 * - `oldestOpenAgeSeconds`:最舊 open anomaly 的年齡秒數(無 open → null)。
 * - `attemptManualReviewCount`:needs_manual_review + order unpaid 的死卡人工 queue(sweeper 放棄)。
 *   🔴 **M-4b L5b-0-s 起是「兩種事故的聯集」、不再只有 pending 孤兒**:
 *   ① `status='pending'` 的 sweeper 孤兒(原語意);
 *   ② `superseded_at` 非 NULL 且 `status IN ('charged','released')` = 被 L5a-1 **讓路**、又達 ceiling 轉人工的 attempt。
 *   ⇒ 告警文案不得再寫死「pending 孤兒」(見 `buildAnomalyAlertMessage`);本計數不帶 id、**分辨不出**是哪一種,
 *   要分辨走 `docs/specs/2026-08-10-l5b-0-supersede-charge-reject-plan.md` §4 的值班查詢。
 *   權威述詞在 migration `*_l5b0s_supersede_sweeper_ceiling.sql` 改③。
 * - `releasedStuckCount`:released_manual_review_at released unpaid 死卡(Phase1 producer-gated 0、前瞻)。
 * - `pendingDoubleChargeCandidateCount`:#256 GAP2 治本 — pending-based 雙扣候選「組」數
 *   (同 user + 同 total + 窗內兩 paid + 其一 charged attempt「卡住指紋」〔結帳到扣款拖 > 門檻〕;
 *   候選待查證非已確認、卡住指紋降誤報〔正常「乾脆買兩個」秒扣不觸發〕)。
 */
export type AnomalyAlertSummary = {
  openCount: number;
  refundingCount: number;
  refundingStuckCount: number;
  oldestOpenAgeSeconds: number | null;
  attemptManualReviewCount: number;
  releasedStuckCount: number;
  pendingDoubleChargeCandidateCount: number;
};

/**
 * AnomalyAlertMessage:固定格式零 PII 告警訊息(use-case 由 summary 組、notifier 送)。
 * - `subject`:標題(Email 主旨 / LINE 首行)。
 * - `text`:內文(只含計數、零 PII;LINE 純文字、Email 內文)。
 */
export type AnomalyAlertMessage = {
  subject: string;
  text: string;
};
