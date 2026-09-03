/**
 * @module @pcm/domain/payment/anomaly-alert — 雙扣 anomaly 主動告警 domain 型別(M-3 #250)
 *
 * 主動告警(pull→push)的 domain 契約:
 * 🔴 **2026-08-24(F-004)起是【三支】RPC**,不是兩支:計數 / 單號 / 退款卡住計數
 *    (`get_order_refunds_stuck_summary`)。下面那句原本只列兩支,已被本行更正。
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

  /**
   * 🔴 **F-004:退款卡住計數,分母是 `order_refunds`** —— 與上面那個 `refundingStuckCount`
   * **不是同一張表**。後者的分母是 `payment_double_charge_anomalies`(名字比分母寬),
   * 而畫面上卡住的退款**從 2026-08 以前到現在一次都沒有被通報過**,因為那封信讀的是前者。
   *
   * · `orderRefundsStuckCount`:①可處理半全體(processing 且〔逾 30 分 或 有 TapPay 受理證據〕)。
   * · `orderRefundsStuckOvernightCount`:上者的**子集**,再加「建立逾 24 小時」。
   *   ⇒ 兩者在同一支 RPC 的同一發 SELECT 算出 ⇒ **內部恆一致,不會 overnight > total**。
   * · `orderRefundsStuckUnknown`:RPC 尚未 apply(部署窗口)⇒ 兩個計數為 `null`。
   *   🔴 **`null` 與 `0` 必須印不同的字** —— 把「我讀不到」印成「沒有卡住的退款」,
   *   就是**用這一片的部署窗口,重新造出這一片要修的那個 bug**。
   *
   * ⚠️ **信上的數字通常會小於畫面上的數字**,那是設計:畫面另含②終態半
   * (`status='failed' AND failed_reason='manual_failed'`),那半後台零按鈕、不進計數型告警。
   * 🔴 「通常」二字不要退回全稱句:`refund-read.ts` 的 `REFUND_EXCEPTIONS_LIMIT = 200`
   *    會截斷①半 ⇒ ①半超過 200 筆時**方向會反過來**(信比畫面大)。
   *    寫成全稱句的話,那一天沒有人解釋得了那個矛盾。
   */
  orderRefundsStuckCount: number | null;
  orderRefundsStuckOvernightCount: number | null;
  /**
   * 🔴 ②終態半(`status='failed' AND failed_reason='manual_failed'`)—— **只是一個數字**。
   * Sean 2026-08-24 拍甲:**不列進清單**,只在信尾寫一行「另有 N 筆已判定失敗,不需要你動作」。
   * 🔴🔴 **它絕不可以進 `shouldAlert`**:終態、永遠不會自己消失(正式庫 2026-08-24 量到 = 4)。
   * ⚠️ **「終態」不是我的形容詞,是 DB 硬防線** —— 出處:
   *   `20260725130100_m3_rf2a2_order_refunds_ledger.sql` 的 `pcm_order_refund_status_transition()`
   *   逐字:「僅允許 processing → confirmed / processing → failed / 同值冪等;
   *   confirmed 與 failed 皆為終態,**轉出一律 RAISE**。DB 層硬防線,不依賴 RF8 自律。」
   * ⚠️ **射程**:那道 trigger 管的是 UPDATE。這個計數仍可能因 **DELETE / TRUNCATE** 下降,
   *   而那兩條路不在它的守備範圍 ⇒ 不要把「不會消失」讀成「這個數字單調不減」。
   * ⇒ 進了就是每天叫一次做不到的事,那正是 `2SQH2P` 叫了 15 天的同一個病。
   */
  orderRefundsManualFailedCount: number | null;
  orderRefundsStuckUnknown: boolean;
  oldestOpenAgeSeconds: number | null;
  attemptManualReviewCount: number;
  releasedStuckCount: number;
  pendingDoubleChargeCandidateCount: number;

  /**
   * 🔴 **寄信這條線的五個死人開關計數**(M-4a;Sean 2026-08-29 拍 `Q-EMAIL-ALERT` = 甲「現在做」)。
   *
   * **為什麼它們要掛在【付款告警】這支上,而不是自己開一條路**:
   * `check-anomaly-alerts` 是**唯一一支已經每天跑、而且真的推得到 LINE** 的路
   * (`0 1 * * *` UTC = **台北早上九點**,不是凌晨一點)。
   * 🔴 而**必須走 LINE 不能走 Resend** —— `20260717020000` 頭註 §⑨ 逐字:
   * 「**Resend 額度用完時,走 Resend 的告警信自己也送不出去**」。
   *
   * **在它們之前發生的事**:額度爆掉 ⇒ 每封信失敗而 sweeper 回報「這一輪成功」
   * ⇒ 心跳前進 ⇒ **一封信都沒寄出去而所有監控都說正常**。
   * 那一半已修(`97864730`:那一輪現在會回 503)—— **而【會主動叫的那一格】直到本片才有。**
   *
   * 🔴 **`null` = 那支 RPC 尚未 apply**(`20260829010000_m4a_email_deadman_alert_counts.sql`
   * 已 commit 而**未 apply**;數法 `grep -c 20260829010000 supabase/APPLIED.tsv` ⇒ 2026-08-29 量到 **0**)
   * ⇒ 照 F-004 那組的成例:**`null` 與 `0` 必須分得開** ——
   * **「讀不到」與「一切正常」在一個裸數字上長得一模一樣。**
   *
   * ⚠️ **訊號 4(訂單已 paid 而 outbox 列根本沒建)刻意【不在】這裡** ——
   * 它的失敗形狀是**資料不存在**,而上面每一個 count 都只數存在的東西 ⇒ 對它永遠印 0。
   * 那一格另立一列(`docs/launch-todo.md` ⟦b4-EMAIL-SIG4⟧),要拿 `orders` 當分母做 anti-join。
   */
  /** 訊號 1:該重試而沒有人重試(已到 `next_retry_at` 且逾寬限)。 */
  emailOverdueCount: number | null;
  /** 訊號 2:死信(`attempts >= max_attempts`)⇒ 那幾封信**永遠不會再寄**。 */
  emailDeadLetterCount: number | null;
  /** 訊號 3:認領後程序死 ⇒ 永久卡在 `sending`(訊號 1/2 都不命中的那個盲區)。 */
  emailStuckSendingCount: number | null;
  /** 訊號 5-a:**確診**額度耗盡(`quota_daily_exceeded` / `quota_monthly_exceeded`)。 */
  emailQuotaConfirmedCount: number | null;
  /**
   * 訊號 5-b:**疑似**額度(`http_429`)。
   * 🔴 **與 5-a 分開,不是分類癖**:`http_429` 可能只是**瞬時限流** ——
   * 併進去 = 用「額度用盡、請升級」的文案報一個**未知原因**。
   * 📌 **一個報錯原因的告警,會把人送去修錯的東西 —— 那比不叫更糟。**
   */
  emailQuotaSuspectedCount: number | null;
  /**
   * 🔴🔴 **分母**(2026-08-31 接上;Sean 逐字答 `3 甲`;板上錨 `⟦b4-EMAILTOTAL⟧`)。
   * `email_outbox` 這張表現在**總共幾列**。
   *
   * ⚠️ **它不是第六個訊號, 它是上面五個的【分母】**:
   * 那五個 count 全部 `FROM public.email_outbox` ⇒ **它們只數【已經存在的列】**
   * ⇒ 📌 **沒有它, 上面五個 0 在「一切正常」與「這張表是空的 / 讀不到」之間分不出來。**
   * (那句話不是我寫的 —— `20260829010000_m4a_email_deadman_alert_counts.sql` 檔頭自己寫的,
   *  逐字:「**一個讀不到資料的計數器, 與一個一切正常的系統, 印同一組 0。**」)
   *
   * 🔴 **而它【要進 `shouldAlert`】** —— 與 `emailOutboxUnknown` 那一格**相反**, 理由:
   * `unknown` 是「函式不存在」= 部署問題, 走部署管道;
   * 而「五格全 0 **且** 分母也 0」是**資料面**的訊號, 沒有別的管道會講它。
   * ⇒ 而 SQL 那一側**早就在回它了**, 是 adapter 這一層把它丟掉的
   * ⇒ 📌 **一個【寫對了而沒接上】的保護, 與一個【沒寫】的保護, 在系統的行為上完全相同。**
   */
  emailOutboxTotalCount: number | null;
  /**
   * 🔴 **出貨信缺口:貨出了、有收件信箱、而通知信【還沒被排進佇列】,且已過寬限。**
   * (2026-08-31;Sean 逐字答 `2 甲`;RPC `get_shipped_email_gap_counts`;板上錨 `⟦b4-EMAILEMPTY⟧` 出貨那半)
   *
   * ⚠️ **它與上面五個訊號的分母【不同】**:那五個數 `email_outbox` 裡的列;
   * 這一個數的是**那張表裡【應該有而沒有】的列** —— 分母來自 `pcm_shipped_email_pending` 那支 view。
   * ⇒ 📌 **所以它是唯一一個「東西沒被建出來」看得到的訊號。**
   */
  shippedNeverEnqueuedCount: number | null;
  /**
   * 🔵 **另一種壞法**:貨出了,而那張單**兩個信箱都是空的** ⇒ 它不會進佇列。
   * **而那不是系統壞掉, 是我們沒有那個客人的信箱。**
   * ⇒ 分開數的理由與 5-a / 5-b 同一個:**併起來 = 用一種原因的文案報另一種原因。**
   */
  shippedUnsendableCount: number | null;
  /**
   * 🔴 **分母**:未刪的 `shipments` 總數。
   * ⚠️ **它是【全域存活量】, 不是「本告警視窗的分母」** —— 含未出貨、也含起始線以前的。
   * 它答的是「**這裡到底有沒有出貨資料**」。
   * ⇒ 📌 **一個分母的用途要寫在它旁邊, 否則下一個人會拿它去算比率。**
   */
  shipmentsTotalCount: number | null;
  /**
   * 🔴 上面三個是不是**讀不到**(RPC 尚未 apply / 起始線沒設)。
   * ⚠️ 與 `emailOutboxUnknown` 同族:**它刻意【不】進 `shouldAlert`** ——
   * 部署問題走部署管道, 不變成一封每天寄的信。
   * 🛑 **而它比那一個多一種成因**:`SHIPPED_EMAIL_CUTOFF` 沒設 ⇒ 那支 RPC 不能呼叫
   *   (它的參數無 DEFAULT, 而 NULL 會被它自己的閘擋下)⇒ **也落這一格。**
   *   ⇒ 而那個狀態**在 log 上看得見**(呼叫端印一行), 不靠這個旗標。
   */
  shippedGapUnknown: boolean;
  /**
   * 🔵 **訊號 4:訂單已付款,而 `order_created` 那一列【根本沒被建出來】**
   * (2026-08-31,Sean 拍 5️⃣ 甲「有一封就叫」;線【出貨】`-1e`)。
   *
   * 🛑🛑 **這個數 > 0 是【正常】的,它【不】進 `shouldAlert`。**
   *   scanner 每 5 分鐘掃「已付款而沒有信」的單,**然後當輪就把它們排進去**
   *   ⇒ 新訂單進來就會被數到一次,下一輪就沒了。
   *   ⇒ 📌 **拿它當判準 = 有生意就叫。那不是告警。**
   * ⇒ 它存在的理由是**脈絡**:沒有它,下面那個 `no_recipient` 的 0 在
   *   「一切正常」與「這裡根本沒有訂單」之間分不出來。
   */
  orderCreatedPaidNoEmailCount: number | null;
  /**
   * 🔴🔴 **這一個才是訊號 4 的告警主詞**:上面那一群裡,**兩個信箱都空**的。
   *   ⇒ scanner 撈到它也 enqueue 不了(use-case 落 `noRecipient` 桶)
   *   ⇒ 📌 **它不會自己好** —— 那張單沒有信箱,下一輪、下下輪都一樣。
   *   ⇒ ✅ 所以 Sean 的「有一封就叫」套在**這一格**上不會變噪音:
   *      **叫一次就是一件真的待辦。**
   * ⚠️ **而 `errors` 那一桶【不在這裡】** —— 它會自己好(下一輪重撈)
   *   ⇒ 要叫它需要跨輪狀態,**本片沒有**。那是具名的已知缺口,不是被忽略的。
   */
  orderCreatedNoRecipientCount: number | null;
  /**
   * 🔵 **未付款取消信線的同一組**(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)——
   *    `get_order_unpaid_cancelled_gap_counts` 的 `pending_count` / `no_recipient_count`。
   * 🔴 **為什麼獨立三格而不併進上面那兩格**:它們是**兩條線**, 修法不同
   *    (一條要看「為什麼下單沒留信箱」, 一條要看「那張被取消的單是誰的」)
   *    ⇒ 併成一個數字, 看信的人不知道要去哪一條線。
   * 🛑 `pending` >0 是【正常】的(下一輪 scanner 就排掉)⇒ **不進 `shouldAlert`**;
   *    `noRecipient` 才是主詞 —— 那張單沒有信箱, **它不會自己好**。
   * 🔴 `unpaidCancelledGapUnknown` 為 true 時上面兩個是 `null` —— **不得寫成 0**:
   *    「讀不到」與「一切正常」在一個裸數字上長得一模一樣。
   */
  unpaidCancelledPendingCount: number | null;
  unpaidCancelledNoRecipientCount: number | null;
  unpaidCancelledGapUnknown: boolean;
  // 🔵 ↓↓ 以下回到【訂單成立信】那一族(codex 2026-09-03 nit:我把三欄插在中間,
  //    而下一段開頭那句「上面兩個」原本指的是 orderCreated 那兩欄 —— 字面被我推到指錯欄位)。
  /**
   * 🔴 上面兩個是不是**讀不到**(RPC 尚未 apply / `B4_DEPLOY_CUTOFF` 沒設或格式不合)。
   * ⚠️ 與 `shippedGapUnknown` / `emailOutboxUnknown` 同族:**刻意【不】進 `shouldAlert`**
   *   —— 部署問題走部署管道,不變成一封每天寄的信。
   * 🛑 **而它【不得】被寫成 0** —— 「讀不到」與「一切正常」在一個裸數字上長得一模一樣,
   *   那正是訊號 4 這一片要治的病本身。
   */
  orderCreatedGapUnknown: boolean;
  /**
   * 🔴🔴 **訊號4 的【持續失敗】那一格(板 `⟦b4-SIG4ERRORS⟧`)**。
   *   已付款、過了起始線, 而 `order_created` 那一列**超過門檻分鐘還沒被建出來**。
   * 🛑 **它與 `orderCreatedPaidNoEmailCount` 差在【年齡】, 而那個差別就是它能不能當判準**:
   *   那一個 > 0 是正常的(新訂單進來就會被數到一次, 下一輪就沒了)⇒ 拿它當判準 = 有生意就叫;
   *   **這一個 > 0 不正常** —— 因為正常的單活不過一輪(scanner 每 5 分鐘就把它排進去)。
   * ✅ **所以它【要進 `shouldAlert`】** —— 與上面那一個相反。
   * ⚠️ 已排除【兩個信箱都空】那一群(它們走 `orderCreatedNoRecipientCount`)⇒ 不重複叫。
   * 🛑 `null` = **沒查**(門檻 env 沒設 / 起始線沒設 / RPC 還沒 apply)⇒ **不是 0**。
   */
  orderCreatedStuckCount: number | null;
  /**
   * 🔵 最舊那一筆卡了幾分鐘 —— 一個裸的筆數寫不出信裡那句「卡多久了」。
   * 🛑 **沒有卡住時是 `null` 不是 `0`** ——「沒有卡住」與「卡了 0 分鐘」是兩件事。
   */
  orderCreatedStuckOldestMinutes: number | null;
  /**
   * 🔴🔴 **上面兩格是不是【讀不到】**(RPC 尚未 apply / 它自己 RAISE)。
   * 🛑 **它必須有出口** —— 與 `orderCreatedGapUnknown` / `shippedGapUnknown` / `cronHeartbeatUnknown` 同構:
   *   adapter 那道 fail-closed(降級成 unknown 而不是 0)**如果下游不消費, 就在下游被拆掉了**。
   * ⛔ 而那正是本片要治的病本身:**一個讀不到的量具, 與一個健康的系統, 印同一個 0。**
   * 📌 route 那一支的檔頭逐字記著「我在同一支檔裡重犯了一次」—— 這是第三次, 而它被 code-reviewer 抓到。
   */
  orderCreatedStuckUnknown: boolean;
  /**
   * 🔴🔴 **排程心跳:六支 cron 裡有幾支不正常**(板 `⟦b4-SWEEPDEAD1⟧` 片3;Sean `q4: 甲`)。
   *   判準由 `@pcm/domain` 的 `CRON_JOB_WHITELIST` 傳進 DB 函式 ——
   *   **DB 那一側不知道任何門檻**,那是刻意的(兩份門檻會漂,而漂開時兩邊都不會紅)。
   * 🔵 判準與後台儀表板逐格相同:過期 / 時間戳在未來 / 連續失敗(該支的失敗計數有意義時)/
   *   心跳表根本沒有那一列 / 有那一列而 `last_success_at` 是 NULL。
   */
  cronHeartbeatAbnormalCount: number | null;
  /**
   * 🔴 **哪幾支** —— 一個裸數字寫不出信裡那句「哪一支死了」。
   *   ⇒ 告警信要說得出名字,否則收到信的人還得自己去後台找。
   * ⚠️ 同一支 job 可能因為多個理由不正常,而這裡**每支只出現一次**。
   */
  cronHeartbeatAbnormalJobs: readonly string[] | null;
  /**
   * 🔴 上面兩個是不是**讀不到**(RPC 尚未 apply / 白名單是空的)。
   * ⚠️ 與 `orderCreatedGapUnknown` 同族:**刻意【不】進 `shouldAlert`** ——
   *   部署問題走部署管道,不變成一封每天寄的信。
   * 🛑 **而它【不得】被寫成 0** —— 「讀不到」與「六支都健康」在一個裸數字上長得一模一樣。
   */
  cronHeartbeatUnknown: boolean;
  /**
   * ⟦b9-RLSHARDEN⟧ 甲:`service_role` 的 `BYPASSRLS` 被收掉了嗎。
   *
   * 🔴 **兩個旗標而不是一個三態值, 理由是【下一步不同】**:
   *   `bypassRlsRevoked = true` ⇒ 屬性被收掉 ⇒ **進 `shouldAlert`**(錢與權限, 吵 Sean)
   *   `bypassRlsUnknown = true` ⇒ 量不到(函式未 apply / `service_role` 不存在)
   *                              ⇒ **不進 `shouldAlert`**, 走 log + 503(部署問題吵看 cron 的人)
   * 🛑 **兩者不可互相推導**:`Revoked=false` 有兩種成因(屬性還在 / 我根本沒量到),
   *    而它們在一個裸 boolean 上長得一模一樣 —— 那正是本片要治的病。
   * 📌 ⇒ 所以 `Revoked` 只在**明確拿到 `false`** 時為 `true`;`null` 走 `Unknown`。
   */
  bypassRlsRevoked: boolean;
  bypassRlsUnknown: boolean;
  /** 🔵 讀到的兩個分母。**不直接進 `shouldAlert`** —— 那道閘只看上面兩個旗標。
   *  ⛔ ~~我第一版寫「它們**不是判準**」~~ —— **codex R2 nit 打掉, 而它是對的**:
   *     `bypassRlsTotalRoleCount` **確實參與判定** —— adapter 拿它當**回應合理性下界**
   *     (不是正整數 ⇒ 那次讀到的東西不可信 ⇒ 走 Unknown)。
   *  📌 **⇒ 「不進 shouldAlert」與「不是判準」是兩句話, 而我把它們寫成了同一句。**
   *  🔵 `bypassRlsPrivilegedCount` 才是純診斷:它只讓 503 的 log 印得出
   *     「我到底讀到什麼」, 而不是只說「讀不到」。 */
  bypassRlsPrivilegedCount: number | null;
  bypassRlsTotalRoleCount: number | null;
  /**
   * 🔴 上面五個是不是**讀不到**。
   * ⚠️ **它只代表【函式不存在】(部署窗口),不代表權限問題**(codex 2026-08-29 nit:
   *    原句寫「RPC 尚未 apply / 權限問題」是錯的)—— `42501` 在 adapter 是**原封上拋**,
   *    不會變成 unknown。**「讀不到」與「不准讀」走不同的路,而只有前者會走到這個旗標。**
   * ⚠️ **它刻意【不】進 `shouldAlert`** —— 照 F-004 那組的成例(codex R2 定的):
   * **部署問題走部署管道**,route 依它回 503(監控看得到),不變成一封每天寄的信。
   */
  emailOutboxUnknown: boolean;

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
