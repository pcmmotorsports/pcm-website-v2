/**
 * @module @pcm/domain/payment/anomaly-alert — 雙扣 anomaly 主動告警 domain 型別(M-3 #250)
 *
 * 主動告警(pull→push)的 domain 契約:
 * - `AnomalyAlertSummary` = SECDEF 聚合 RPC `get_payment_anomaly_alert_summary` 回的計數,
 *   **外加** `get_payment_anomaly_alert_display_ids` 回的五個**訂單單號**陣列
 *   (adapter 邊界把 DB snake_case jsonb 映射成 camelCase domain)。
 * - `AnomalyAlertMessage` = use-case 由 summary 組的**固定格式告警訊息**(subject/text;**含訂單單號**),
 *   兩管道(LINE/Email)送同一份內容、各自包裝 transport。
 *
 * 🔴 **不再是「零 PII」** —— 本契約自 2026-08-19 起帶**訂單單號**(五組),那是可識別指標。
 *   仍然不得引入的:**金額 / 使用者 id / rec_trade_id / 姓名電話地址**。
 *   ⚠️ **「零金額」的射程 = 本契約【不帶金額欄】** —— 那不等於「訊息裡不可能出現數字」。
 *      守門那格只擋得住**帶標籤的**形式(`NT$` / `TWD`);一個裸數字它看不見(R3 nit)。
 *      ⇒ 寫文案的人:**不要靠那道守門**,金額是你自己不能寫進去。
 *
 * 🔴🔴 **「零單號」那一半已經被【刻意】拿掉了,不是有人漏改** ——
 *   原句逐字是「零 PII / 零金額 / **零單號**:本契約只含計數與年齡秒數」,
 *   理由:LINE 訊息會留在手機、可能被轉發或截圖。
 *   ⇒ **2026-08-19,Sean 本人在知道那個代價的情況下拍板打開它。**
 *     起因是他當天早上 9 點收到一封看不懂的告警;他採納的理由是他自己的:
 *     **「沒單號我查不到,那則告警等於只說『有事』」**。
 *   ⇒ ⇒ 所以 `*DisplayIds` 那五個欄位**是被授權的**。要把它關回去是可以的,
 *     而那要**再問他一次** —— 不要當成修 bug 順手關掉。
 *   ⚠️ 而它**每天早上 9 點都會寄一封**(`pcm-anomaly-alert(0 1 * * *)`,
 *     `supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:12` 逐字)
 *     ⇒ 單號會**每天**出現在他手機上;日後評估這個決定時要一起看這件事。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 * @see docs/specs/2026-08-19-anomaly-alert-plain-language-plan.md(真權威 plan,§v2 定案版)
 * @see supabase/migrations/20260819130000_m3_250_anomaly_alert_display_ids.sql
 * @see docs/phase-1-backlog.md #250
 */

/**
 * AnomalyAlertSummary:雙扣 anomaly + 死卡列的計數摘要 **+ 對應的訂單單號**(2026-08-19 起)。
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

  /**
   * 🔴 五個單號陣列(2026-08-19 Sean 拍板打開;理由與代價見本檔檔頭)。
   *
   * **它們與上面的計數不是同一個東西,不要拿長度當計數**:
   * · 計數 = 全部;陣列 = RPC 端 `LIMIT 100` 之後的**前 100 筆**(payload 護欄)。
   * · ⇒ `count > ids.length` 是**正常狀態**,不是壞掉 ⇒ 訊息用「另外還有 N 筆」表達差額。
   * · ⇒ 🔴 而 `ids` 為空、`count > 0` 也必須撐得住(RPC 舊版 / 權限退化 / 部署錯序):
   *   那時只講筆數、**不得憑空編一個單號**。
   *
   * `pendingDoubleChargeDisplayIdPairs` 是**一組兩張單**;組內順序由 SQL 用
   * `LEAST`/`GREATEST` 依單號定死(不定的話同一組每天會印成不同順序,而他每天都會收到一封)。
   */
  openDisplayIds: string[];
  refundingStuckDisplayIds: string[];
  attemptManualReviewDisplayIds: string[];
  releasedStuckDisplayIds: string[];
  pendingDoubleChargeDisplayIdPairs: Array<[string, string]>;
};

/**
 * AnomalyAlertMessage:固定格式告警訊息(use-case 由 summary 組、notifier 送)。
 * - `subject`:標題(Email 主旨 / LINE 首行)。
 * - `text`:內文(計數 **+ 訂單單號**;零金額、零姓名/電話/地址;LINE 純文字、Email 內文)。
 */
export type AnomalyAlertMessage = {
  subject: string;
  text: string;
};
