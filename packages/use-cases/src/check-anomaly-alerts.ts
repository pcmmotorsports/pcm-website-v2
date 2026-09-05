import type { IAnomalyAlertReader, IAlertNotifier } from '@pcm/ports';
import type { AnomalyAlertSummary, AnomalyAlertMessage } from '@pcm/domain';

/**
 * checkAnomalyAlerts:雙扣 anomaly 主動告警 use-case(M-3 #250;pull→push)。
 *
 * 週期 cron(app/api/cron/anomaly-alert)觸發 → 讀 anomaly + 死卡列計數 **與對應的訂單單號** → 任一門檻踩
 * → 對「所有已設定管道」(LINE/Email、Q1=A+C)推播固定格式告警。杜絕「沉默故障 + 錯過客訴黃金期」。
 *   🔴 ~~原句兩處「零 PII」~~ 2026-08-19 作廢 —— **訊息現在帶訂單單號**,見下方那段授權來歷。
 *
 * ```
 * summary = reader.getAlertSummary(refundingStuckSeconds)   // throw → 上拋(route 503,不吞)
 * shouldAlert = open>0 || refundingStuck>0 || attemptManualReview>0 || releasedStuck>0
 * if shouldAlert: 對每個 notifier.notify(固定訊息)、Promise.allSettled 收集失敗數
 * return { alerted, ...counts, notifiersTotal, notifiersFailed, errors=notifiersFailed }
 * ```
 *
 * 安全 / 信任邊界(鐵則 12):
 * - reader 走 payment_confirmer SECDEF 受控窗、對 anomaly 兩表零表權;回傳計數 **+ 訂單單號**、零 PII/零金額。
 *   🔴🔴 **原句逐字是「回傳只計數、零 PII/零金額/零 id」,而【零 id】那一半是被刻意拿掉的、不是有人漏改。**
 *   打開它的是 **Sean 本人,2026-08-19**,在知道代價(LINE 訊息會留在手機、可能被轉發截圖)的情況下拍板;
 *   他的理由是他自己的:**「沒單號我查不到,那則告警等於只說『有事』」**。
 *   ⇒ 要關回去是可以的,而那要**再問他一次** —— 不要當成修 bug 順手關掉。
 *   ⚠️ 它**每天早上 9 點寄一封**(`20260723120000_m3_s2_settle_sweep_pgcron.sql:12` 逐字
 *   `pcm-anomaly-alert(0 1 * * *)`)⇒ 單號會每天出現在他手機上。
 * - 告警訊息固定格式;🔴 文案不宣稱「已確認雙扣」(open=候選、待查證;runbook line51)。
 * - fail-closed:reader throw → 上拋 → route 503;notifier throw → 計入 errors → route 503(壞掉的管道必須可見、
 *   不得靜默吞成成功)。一管道掛掉不影響另一管道(Promise.allSettled 各自送)。
 * - **無 per-anomaly 去重**(本片刻意):未解決前每輪重推 = 持續提醒(雙扣不可被遺忘);去重狀態表列 follow-up。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 * @see docs/phase-1-backlog.md #250
 */
export type CheckAnomalyAlertsDeps = {
  reader: IAnomalyAlertReader;
  /** 已設定的推播管道(LINE/Email;composition 依 env 存在性組;至少 1 個〔否則 composition fail-closed〕)。 */
  notifiers: IAlertNotifier[];
};

export type CheckAnomalyAlertsOptions = {
  /** refunding 卡住門檻秒數(route 常數注入、營運參數非 SLA)。 */
  refundingStuckSeconds: number;
  /** #256 pending 雙扣候選:兩 paid 單 paid_at 差窗秒數(route 常數、預設 12h)。 */
  pendingDoubleChargeWindowSeconds: number;
  /** #256 卡住指紋門檻秒數(charged attempt updated_at-created_at 逾此才算卡住;route 常數、預設 10min)。 */
  pendingDoubleChargeStuckSeconds: number;
  /**
   * 🔵 出貨信起始線(ISO 8601 UTC;來自 env `SHIPPED_EMAIL_CUTOFF`;2026-08-31 Sean `2 甲`)。
   * 🛑 **`null` = 那一段整段不查** —— 而那不是失敗, 是「**還沒上膛**」。
   *   ⇒ 落 `shippedGapUnknown`, **不進 `shouldAlert`**;而那個狀態由 route 印在 log 上。
   */
  shippedCutoffIso: string | null;
  /** 🔵 出貨信寬限秒數(Sean `2 甲` = 15 分鐘 = 3 次掃描;route 常數注入)。 */
  shippedGraceSeconds: number;
  /**
   * 🔵 訊號 4 的起始線(env `B4_DEPLOY_CUTOFF`,**與寄信端同一顆**;2026-08-31 Sean 拍 5️⃣ 甲)。
   * 🛑 `null` = 整段不查 ⇒ 落 `orderCreatedGapUnknown`(**不進 `shouldAlert`**)。
   */
  orderCreatedCutoffIso: string | null;
  /**
   * ⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋計數的回看窗口(秒;route 常數注入)。
   * 🔵 它**不是門檻** —— 本片刻意不設門檻(板 `⟦b4-ENUM3⟧` 逐字「門檻不要用猜的」)。
   */
  manualCustomerSearchWindowSeconds: number;
  /**
   * 🔵 訊號4【持續失敗】那一格的門檻(分鐘)。`null` = 還沒上膛。
   * 🛑 它與 `orderCreatedCutoffIso` 是兩顆各自獨立的 env, 任一為 null 就不查那一格。
   */
  orderCreatedStuckMinutes: number | null;
};

/** CheckAnomalyAlertsResult:結構化摘要(零 PII counts only;route log/回應用)。 */
export type CheckAnomalyAlertsResult = {
  /** 是否踩門檻並嘗試推播。 */
  alerted: boolean;
  openCount: number;
  refundingCount: number;
  refundingStuckCount: number;
  attemptManualReviewCount: number;
  releasedStuckCount: number;
  /** #256 pending-based 雙扣候選「組」數(卡住指紋 + 同額 + 窗;候選待查證)。 */
  pendingDoubleChargeCandidateCount: number;
  /**
   * F-004 客人的退款卡住(分母 `order_refunds`,**不是**上面那個雙扣表)。
   * `null` = 那支 RPC 尚未 apply ⇒ 🔴 **route 據 `orderRefundsStuckUnknown` 回 503**,
   * 而不是寄一封「尚未啟用」的信給老闆(部署問題走部署管道)。
   */
  orderRefundsStuckCount: number | null;
  orderRefundsStuckOvernightCount: number | null;
  /** ②終態半(只進信尾那一行,**不進 `shouldAlert`**;Sean 2026-08-24 拍甲)。 */
  orderRefundsManualFailedCount: number | null;
  /**
   * 🔵 ⟦b9-ENUMWATCH⟧ 片 2:近 N 秒的客戶搜尋筆數 / 相異操作者數。
   * 🛑 **不進 `shouldAlert`** —— 沿用本檔 `:850` 那格的慣例(搭已經要寄的那封信的便車)。
   *    本片**刻意不設門檻**:沒有基線, 猜低=天天吵(= `2SQH2P` 叫了 15 天的同一個病)、
   *    猜高=永遠不叫 = 裝飾, **而兩種失敗都不會叫**。本片產生的正是那個基線。
   * 🔴 **`Unknown` = 查不到, 不是零筆** —— 那支 RPC 還沒 apply 時走這一格。
   * 🛑🛑 **而 `manualCustomerSearchActors` 不是「零 PII」的計數**(R3 must-fix 3):
   *    同批 migration 自己寫著「**actors=1 + 已知班表 ⇒ 連得回唯一員工**,不得宣稱絕對零 PII」。
   *    ⇒ **它今天只走內部告警管道, 而要外送到別處時要重新判。**
   *    📌 一個錯的安全標籤比沒有標籤貴 —— 它讓下一個人沿用一個不存在的保證。
   *    ⚠️ 而**天花板要一起讀**:那封信只在別的異常觸發時才寄
   *    ⇒ 一整週沒有別的異常 ⇒ **這個數字一次都不會被看到。往前一格, 不是解決。**
   */
  manualCustomerSearchCount: number | null;
  manualCustomerSearchActors: number | null;
  /**
   * 搜尋日誌健康度(⟦search-LOGSILENTZERO⟧)。**五個欄位, 而它們代表【不同的世界】不是程度**:
   * ```
   * searchLogUnknown        那支 RPC 還沒 apply / 讀不到  ⇒ 與其他 Unknown 同款
   * searchLogTableExists    false = 那張表還沒貼          ⇒ 印「未貼」【不告警】
   * searchLogLastRowAt      null 而表在 = 還沒開始收      ⇒ 【不告警】(主視窗裁乙)
   * searchLogStale          有列而最後一列 > 24h          ⇒ 🔴 告警
   * searchLogAnonCanExecute null = 函式沒貼(不告警) · false = 🔴 門被關掉了(告警)
   * ```
   * ⛔ **原提案「近 24h 0 列就告警」被推翻** —— 逐字:「甲每天半夜假紅一次,
   *    假紅會被人關掉(閘死於誤報比漏報常見)」。
   */
  searchLogUnknown: boolean;
  /**
   * 🔴 **與 `searchLogUnknown` 分開 —— 兩者的成因不同而回傳值原本是同一格。**
   *   `Unknown` 有兩種世界:①那支 RPC 還沒 apply(部署窗口, 預期中)②它真的壞了(要有人看)
   *   ⛔ ~~我原本只有 Unknown 一格~~ ⇒ 唯一分得開它們的是一行 log,
   *      而 **同一個 type 往下幾行的 R3 must-fix 1 逐字判過這個形狀**:
   *      「把那行 log 刪掉, 測試照樣全綠 ⇒ 那個『分得開』沒有量具」。
   *   ⇒ 照 sibling(`manualCustomerSearchFailed`)補這一格, 讓它有量具。
   */
  searchLogFailed: boolean;
  searchLogTableExists: boolean | null;
  searchLogLastRowAt: string | null;
  searchLogStale: boolean;
  /**
   * ⟦b4-NEEDSHUMANNOWATCHER⟧ 卡住的匯款單筆數(`overpaid` / `needs_human`)。
   * 🔵 `stuckBankUnknown` 與它分開 —— 「那支 RPC 沒貼 / 讀失敗」與「真的 0 張」的下一步不同。
   */
  stuckBankCount: number;
  stuckBankOldestCreated: string | null;
  /**
   * ⟦b4-PAIDTHENOVERPAID⟧ **第二個世界**(主視窗 2026-09-05 `Q1=乙`)——
   * 已 `paid` / `partiallyPaid` 而**收到的比該收的多**。
   * 🛑 **與 `stuckBankCount` 分開, 不合成一個數** —— 兩個世界要打不同的電話:
   *   A 的客人**畫面還在叫他匯款**(急);B 的客人畫面正常, **而我們欠他錢**(要退)。
   */
  stuckBankOverpaidCount: number;
  stuckBankOverpaidOldest: string | null;
  stuckBankUnknown: boolean;
  /**
   * 🔴 **`stuckBankUnknown` 的兩個成因各有出口**(codex R1 must-fix ④)。
   *    ⛔ ~~我原本只寫了 `stuckBankUnknown`, 而註解說「兩者分開」~~ —— **那句是假的**:
   *      「那支 RPC 還沒 apply」與「讀的時候丟例外」**兩者都只讓 Unknown = true**
   *      ⇒ 📌 **我寫了分開, 而下游拿到的是同一個布林。**
   *    ✅ 照 `searchLogFailed` 那格的成例補這一欄 —— **真的壞了要有人看**,
   *      而「還沒 apply」是部署窗口、不是壞掉。
   */
  stuckBankFailed: boolean;
  /**
   * 🔴 **命名的極性與 `searchLogStale` 對齊(true = 要看)**——
   *   ⛔ ~~原名 `searchLogAnonCanExecute`(false = 要看)~~ ⇒ route 自然會寫
   *      `!searchLogAnonCanExecute`, 而那在【函式還沒貼】那段期間 **每天假紅**
   *      —— 正是主視窗裁乙要避開的那件事。
   *   `null` = 那支函式還沒貼(不告警) · `true` = 🔴 那道門被關掉了(告警)
   */
  searchLogAnonExecuteRevoked: boolean | null;
  manualCustomerSearchUnknown: boolean;
  /**
   * 🔴🔴 **R3 must-fix 1:「讀取失敗」與「還沒 apply」必須在【回傳值】上分得開。**
   *
   * ⛔ 我原本把兩者都壓成 `Unknown = true`, 而**唯一分得開它們的是一行 `console.error`**
   *    ⇒ 而 R3 指出:**把那行 log 刪掉, 測試照樣全綠** ⇒ 那個「分得開」沒有量具。
   * 🛑 而後果不是少一個欄位:**信上一律寫「那支查詢還沒上線」** ——
   *    而權限被收回 / 函式體壞掉的那一天, 讀信的人會以為它只是還沒部署。
   * ✅ ⇒ 加這一格 ⇒ 兩者在 Result、在信上、在 route 回應裡都分得開。
   */
  manualCustomerSearchFailed: boolean;
  orderRefundsStuckUnknown: boolean;
  /**
   * 🔵 出貨信缺口那三格(2026-08-31;Sean `2 甲`)。
   * 🔴 **[codex R1 must-fix 1]**:片1 給那支 RPC 裝了 fail-closed(NULL 參數 ⇒ RAISE),
   *   而**片2 若不把 `shippedGapUnknown` 帶到 result 上, 那道 fail-closed 在下游就被拆掉了** ——
   *   起始線【有設】而 RPC【不存在】⇒ route 會安靜回 200, 沒有 info、沒有 503、沒有旗標。
   * ⇒ 📌 **片1 讓那三個數字讀得到, 而片2 決定【讀不到的時候印什麼】—— 後者才是承重件。**
   * ⚠️ **而它與 `emailOutboxUnknown` 的處置【不同】**:那一個一律 503;
   *   這一個**只有在「起始線有設」時才 503** —— 沒設是「還沒上膛」= 正常, 由 route 印一行 info。
   */
  shippedNeverEnqueuedCount: number | null;
  shippedUnsendableCount: number | null;
  shipmentsTotalCount: number | null;
  shippedGapUnknown: boolean;
  /**
   * 🔵 訊號 4 那三格(2026-08-31)。
   * 🛑 `paidNoEmail` **不進 `shouldAlert`**(它 >0 是正常的);`noRecipient` 才是主詞。
   * 🔴 `unknown` 為 true 時上面兩個是 `null` —— **不得寫成 0**。
   */
  orderCreatedPaidNoEmailCount: number | null;
  orderCreatedNoRecipientCount: number | null;
  /**
   * 🔵 **未付款取消信線的同一組**(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)。
   * 🔴 **為什麼要獨立三格而不是併進上面那兩格**:它們是**兩條線**,
   *    修法不同(一條要補信箱、一條可能要補取消流程), 併成一個數字會讓收信的人
   *    看到「3 張」而不知道要去看哪一條線。
   * 🛑 `pending` **不進 `shouldAlert`**(它 >0 是正常的);`noRecipient` 才是主詞 —— 同姊妹線。
   * 🔴 `unknown` 為 true 時上面兩個是 `null` —— **不得寫成 0**。
   * ⚠️ **它與訊號4 共用 `B4_DEPLOY_CUTOFF`**(寄信端那三條線也共用同一顆)
   *    ⇒ 那顆沒設 ⇒ **這一格是安靜的**, 而那是刻意的(還沒上膛的線不該每天寄信)。
   *    🛑 而「安靜」必須與「壞掉」分得開 ⇒ `unpaidCancelledGapUnknown` 要被 route 印出來。
   */
  unpaidCancelledPendingCount: number | null;
  unpaidCancelledNoRecipientCount: number | null;
  unpaidCancelledGapUnknown: boolean;
  /**
   * 🔵 更正單號信線那三格(第四條線, 2026-09-04)。
   * 🔴🔴 **它與姊妹線差在【不共用 `B4_DEPLOY_CUTOFF`】—— 它根本沒有 cutoff。**
   *    本線觸發欄是片 C 才新增的 ⇒ 歷史上每一箱都是 NULL ⇒ 母體天生從空的開始長。
   *    ⇒ 📌 **所以那顆 env 沒設的時候, 這一格【照樣會查】** —— 與上面那三格的行為不同。
   */
  trackingCorrectedPendingCount: number | null;
  trackingCorrectedNoRecipientCount: number | null;
  trackingCorrectedGapUnknown: boolean;
  /** 🔵 訊號4 持續失敗那三格 —— 信裡印了而 result 沒有 ⇒ 事後對不了帳。 */
  orderCreatedStuckCount: number | null;
  orderCreatedStuckOldestMinutes: number | null;
  orderCreatedStuckUnknown: boolean;
  orderCreatedGapUnknown: boolean;
  /** 🔵 排程心跳(片3):幾支不正常 / 哪幾支 / 是不是讀不到。`Unknown` 不進 `shouldAlert`。 */
  cronHeartbeatAbnormalCount: number | null;
  cronHeartbeatAbnormalJobs: readonly string[] | null;
  cronHeartbeatUnknown: boolean;
  /**
   * ⟦b9-RLSHARDEN⟧ 甲:`service_role` 的 `BYPASSRLS` 被收掉了嗎。
   * 🔴 `Revoked` **進** `shouldAlert`(那是錢與權限的事, 要吵到 Sean);
   *    `Unknown` **不進**(那是部署/環境問題, 走 log + 503 那條)。
   * 📌 兩種訊號落在兩個觀眾, 與本檔既有慣例一致。
   */
  bypassRlsRevoked: boolean;
  bypassRlsUnknown: boolean;
  /**
   * ⟦b9-ACLDRIFT5⟧ 片二:權限快照漂移。與 `bypassRls*` 同一族的兩個旗標 ——
   * `Detected` 進 `shouldAlert`(有人動了權限而沒有人認),`Unknown` 不進(讀不到 / 太舊 ⇒ 503 那條)。
   */
  aclDriftDetected: boolean;
  aclDriftUnknown: boolean;
  /** 🔵 診斷用:哪一族變了 / 那一列幾點量的。**不進** `shouldAlert`。 */
  aclDriftFamilies: string | null;
  aclDriftTakenAt: string | null;
  /** 🔵 讀到的兩個分母。**不直接進 `shouldAlert`** —— 那道閘只看上面兩個旗標。
   *  ⛔ ~~我第一版寫「**不是判準**」~~ —— R3 nit 打掉(codex R2 也在 domain 那份打過同一句):
   *     `bypassRlsTotalRoleCount` **確實參與判定**(adapter 拿它當回應合理性下界 ⇒ 走 Unknown)。
   *  🛑 **而訂正原本只落在兩份副本的其中一份** —— grep「不是判準」的人第一個命中可能是錯的那份。
   *  🔵 codex R2 must-fix ③:我第一版回了這兩個而**沒有宣告** ⇒ TS2353,型別系統當場攔住。 */
  bypassRlsPrivilegedCount: number | null;
  bypassRlsTotalRoleCount: number | null;
  /**
   * 🔴 M-4a:寄信那支 RPC 是不是【讀不到】(尚未 apply / 權限問題)。
   * route 依它回 **503**,而不是寄一封「尚未啟用」的信(部署問題走部署管道)。
   *
   * 🛑🛑 **2026-08-29 訂正:這一段原本寫「那是【五格刻意不進 `shouldAlert`】這個決定的另一半」——
   *    而那句話【與碼不符】。** 五格現在**確實進了** `shouldAlert`(本檔 `:801-805` 的 OR)。
   *    ⇒ 抓到它的是 `adversarial-reviewer`(2026-08-29),而 codex 那一輪**沒有抓到** ——
   *      codex 審的是那支 SQL,它審的是**那支 SQL 接上之後的世界**。
   *
   * 🔴 **歷史留著,因為「要不要改回去」是另一題**:
   *    「不進 `shouldAlert`」是**曾經打算**的設計(對齊上面 `orderRefundsManualFailedCount`
   *    那一格的 Sean 2026-08-24 拍甲),而它**沒有落到碼上**。
   *    ⇒ 主視窗 2026-08-29 裁:**改註解、不改碼** ——
   *      改碼等於改變一個【正在運作的】告警行為,那是 Sean 的題,不是修文件的順手。
   *    ⇒ 那一題已開列(見 `docs/launch-todo.md` ⟦b4-EMAILSHOULD⟧)。
   *
   * ⚠️ **而「進了 `shouldAlert`」現在的具體後果,寫在這裡免得下一個人自己去推**:
   *    死信那一格(訊號 2)的清理 job 是 backlog `#281`,**未實作**
   *    ⇒ 它一旦 `> 0` 就是 `> 0` 到永遠;而本支告警是 `0 1 * * *` **每天一封**、
   *      **冷卻/靜音鈕本片沒有做** ⇒ **正式庫只要有 1 列死信,就會每天寄,直到有人動它。**
   *    📌 而 `20260717020000_m4a_email_outbox.sql` §⑦ 自己就警告過這個形狀:
   *      「永久告警噪音,把真正的 pg_cron 靜默死亡淹掉」。
   */
  emailOutboxUnknown: boolean;
  emailOverdueCount: number | null;
  emailDeadLetterCount: number | null;
  emailStuckSendingCount: number | null;
  emailQuotaConfirmedCount: number | null;
  emailQuotaSuspectedCount: number | null;
  /** 最舊 open anomaly 年齡秒數(排序訊號、非 PII;無 open → null)。 */
  oldestOpenAgeSeconds: number | null;
  /** 本輪嘗試推播的管道數(shouldAlert=false 時為 0)。 */
  notifiersTotal: number;
  /** 推播失敗的管道數(>0 → route 503)。 */
  notifiersFailed: number;
  /** errors = notifiersFailed(route 據此回 503;reader throw 已上拋不進此)。 */
  errors: number;
};

/** 每小時秒數(refundingStuckSeconds → 顯示小時)。 */
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** 年齡秒數 → 白話(≥1 天顯天、否則顯小時;純聚合年齡、非 PII)。 */
function formatAge(seconds: number): string {
  if (seconds >= SECONDS_PER_DAY) {
    return `${Math.floor(seconds / SECONDS_PER_DAY)} 天`;
  }
  return `${Math.max(1, Math.floor(seconds / SECONDS_PER_HOUR))} 小時`;
}

/**
 * 🔴 每一類最多列幾張單號。
 *
 * **這個數字的來源是【手機上讀得完】,不是 LINE 的長度上限。**
 * Sean 2026-08-19 的原話是「看不懂」與「精簡」,不是「太長送不出去」⇒ 它是可讀性常數。
 *
 * 🔴🔴 **它【不推翻】他「乙:全部印出來,長就長」那一裁** ——
 *   乙 = 他要的**正常行為**;本常數 = 那一裁的**失效保護**,不是它的相反。
 *   他現在是 1 筆;**在 30 筆以下,兩者的輸出逐字相同。**
 *   ⇒ 讀到這裡的人:**不要因為看到一個上限就以為有人把乙偷偷改回甲了。**
 *
 * ✅ **LINE 上限那格【已經查到了】**(2026-08-19)⇒ 見下面的 `LINE_TEXT_MAX_CHARS`。
 *   ~~原本這裡寫「未確認,缺哪一道檢查」~~ —— 那句已完成它的任務,撤掉。
 *   🔴 而查到之後**這顆常數一個字都沒改**:它管的一直是可讀性,長度那格由另一道閘管。
 *     **兩件事各自有各自的守門,不要把它們併成一個數字。**
 *
 * 🔴 **與 SQL 端 `LIMIT 100` 的關係(兩個不同用途的數字,不是同一個常數的兩個落點)**:
 *   100 = payload 護欄(防陣列無上界);30 = 讀得完。
 *   **唯一不變式:30 必須 ≤ 100** —— 要把這顆調到 100 以上,先回去改 migration 那一行。
 */
const MAX_ORDERS_PER_CATEGORY = 30;

/**
 * 🔴 LINE 單則文字訊息的長度上限。
 *
 * ✅ **這個值有來源了**(2026-08-19 由 codex 關卡2 提供並附連結;我自己抓過四發拿不到那一頁):
 *    LINE Messaging API — Text character count
 *    https://developers.line.biz/en/docs/messaging-api/text-character-count/
 *    ⚠️ **單位是 UTF-16 code unit,不是「看起來幾個字」** —— 中文字多半各佔 1 個 code unit,
 *       而 emoji(本訊息開頭那顆 ⚠️)可能佔 2 個。JS 的 `String.length` **正好就是 UTF-16 長度**
 *       ⇒ 這裡用 `.length` 是對的,不要「改成正確的字元數」。
 *
 * 🔴 **為什麼需要這道閘,而不是靠「30 筆應該不會超過」**:
 *    `display_id` 的格式是 `^PCM-[0-9]{4}-[0-9]{4,}$`(`20260604120000:114`)——
 *    **末段是 `{4,}`,沒有上界** ⇒ 「30 筆算起來只有 2,800 字元」是**現在**的算術,不是保證。
 *    而超過上限時 LINE **整封拒收** ⇒ route 回 503 ⇒ **那天的告警等於沒寄**,
 *    🔴 **而那一天正是筆數最多、最需要它的那天。**
 */
const LINE_TEXT_MAX_CHARS = 5000;

/** 留給 subject、分隔換行與截斷說明的餘裕(寧可早一點截,不要卡在邊界)。 */
const LINE_BUDGET_HEADROOM = 400;

/**
 * 最後一道:整封超過 LINE 的上限時,**只截【單號清單】那一段,結尾三行永遠留著**。
 *
 * 🔴 `footer` 不進被截的範圍(理由寫在呼叫端:那裡有網址與唯一那句擋誤退款的警語)。
 *
 * 🔴🔴 **會走到截斷的路有【兩條】,而本函式對兩條都成立 —— 不要把它寫成一條**:
 * ```
 * ① 有人把 MAX_ORDERS_PER_CATEGORY 調高 —— 而那是【明文允許】的(那顆常數自己寫著「30 必須 ≤ 100」)
 *    實測:上限=50、單號正常長度 ⇒ 4,594 字 ⇒ 真的截（而警語與網址都還在）
 * ② `display_id` 末段是 `{4,}`、沒有上界 ⇒ 單號變長
 *    實測:上限=30、單號 60 字元 ⇒ 4,585 字 ⇒ 真的截（同樣兩者都在）
 * ```
 * 📌 **我一度把它寫成「只有②一條」** —— 因為我用「加筆數」去反證①,而筆數被上面那顆常數夾住了
 *    ⇒ **我變的不是我以為在變的那個變數。** 是 R3 的同儕審查把它分開重跑才看出來。
 * 🔴 **這一段之所以要留:下一個把上限從 30 調到 100 的人,會以為自己不在那個世界裡。**
 *    一句只寫對一半的說明,比沒有說明危險 —— 看到它的人會停止思考。
 * 🔴 不做中途切字 —— 半行單號比沒有那行更糟(讀的人會以為那是完整單號)。
 * ⚠️ 極端情況下 `footer` 自己就超過預算(不可能發生於現行三行,但別假設)⇒
 *    那時 body 會被清空,而 **footer 仍然全數保留** —— 這是刻意的:寧可只剩警語,不要只剩清單。
 * 📌 nit(已知,不修):下面 while 每輪重 `join` 是 O(n²)。上限 5,000 字元、每天一封 ⇒ 不值得換寫法。
 */
function fitToLineBudget(subject: string, body: readonly string[], footer: readonly string[]): string {
  const note = '（單號太多,上面只列出一部分 —— 完整清單請到後台看。）';
  const tail = footer.join('\n');
  const full = [...body, ...footer].join('\n');
  const budget = LINE_TEXT_MAX_CHARS - LINE_BUDGET_HEADROOM - subject.length;
  if (full.length <= budget) return full;
  const kept = [...body];
  const fits = () => [...kept, note, ...footer].join('\n').length <= budget;
  while (kept.length > 0 && !fits()) kept.pop();
  return [...kept, note, tail].join('\n');
}

/**
 * 這一類**真的會印出來**的單號。
 *
 * 🔴🔴 **兩個上限,擋兩個不同的病**(第二個是 R3 抓的,我原本只寫了一邊):
 *   · `MAX_ORDERS_PER_CATEGORY` —— 讀不讀得完。
 *   · 🔴 `count` —— **這封信不能自己跟自己打架**。計數與單號來自**兩次查詢**,
 *     而 skew 有**兩個方向**:
 *       `count > ids.length` ⇒ 單號比較少 ⇒ 用「另外還有 N 筆」講清楚(本來就處理了)
 *       🔴 `ids.length > count` ⇒ **單號比較多** —— 兩次查詢之間**新出現**的異常列:
 *          計數那一發沒看到它、單號那一發看到了。沒有夾的話,信上會是
 *          **「【可能被扣了兩次錢】1 筆」底下列 3 個單號**,而收信人不知道該信哪一個。
 *     ⚠️ **我檔頭原本逐字只寫了「`count > ids.length` 是正常狀態」—— 另一邊我沒有分析過。**
 *   ⇒ 夾在 `count` 是**保守的那一邊**:少列的那幾筆,明天早上 9 點那封會出現(它每天寄)。
 */
function shownIds<T>(ids: readonly T[], count: number): T[] {
  return ids.slice(0, Math.max(0, Math.min(count, MAX_ORDERS_PER_CATEGORY)));
}

/**
 * 一段的單號行。
 * 🔴 `hidden` 用 **`count − 實際列出的數量`** 算,不是 `count − 30` ——
 *    SQL 端 `LIMIT 100` 或缺鍵降級都會讓陣列比 `count` 短,寫死 30 會報出一個**假的差額**。
 * 🔴 陣列空而 `count > 0`(舊版 RPC / 部署錯序)⇒ 回空陣列 ⇒ 呼叫端只講筆數,
 *    **不得憑空編一個單號**。
 */
function orderLines(ids: readonly string[], count: number): string[] {
  const shown = shownIds(ids, count);
  if (shown.length === 0) return [];
  const lines = shown.map((id) => `  ${id}`);
  const hidden = count - shown.length;
  if (hidden > 0) lines.push(`  …另外還有 ${hidden} 筆,請到後台看`);
  return lines;
}

/** 一整段(標題 + 筆數 + 單號行);`count <= 0` ⇒ 這一段整個不出現。 */
function section(title: string, count: number, ids: readonly string[], unit = '筆'): string[] {
  if (count <= 0) return [];
  return [`【${title}】${count} ${unit}`, ...orderLines(ids, count)];
}

/**
 * 🔴🔴 **「五格全 0 【而且】分母也 0」**(2026-08-31;Sean 逐字答 `3 甲`;板上錨 `⟦b4-EMAILTOTAL⟧`)。
 *
 * **為什麼要有這個判斷**:上面五個 count 全部 `FROM public.email_outbox`
 * ⇒ 它們只數【已經存在的列】⇒ 📌 **「一切正常」與「這張表是空的 / 讀不到資料」印同一組 0。**
 * (那句話不是我寫的 —— `20260829010000_m4a_email_deadman_alert_counts.sql` 檔頭自己寫的。)
 *
 * 🛑 **為什麼是一支【共用函式】而不是在兩處各寫一次**:
 * 它同時餵給【告警閘】與【訊息那一段】—— 各算一次 ⇒ 它們可以分岔,
 * **而分岔的時候不會有任何東西叫**(一邊決定要不要寄、一邊決定信裡寫什麼)。
 *
 * 🛑 **`emailOutboxUnknown` 必須排除**:那是「函式不存在」= 部署問題, 走 503 那條路;
 * 而它會讓五個 count 全是 `null` ⇒ `?? 0` 之後長得與「真的全 0」**一模一樣**。
 * ⇒ 📌 **兩個不同的世界在 `?? 0` 之後印同一組 0 —— 那正是本片要防的形狀本身。**
 */
function isEmailOutboxSilentlyEmpty(summary: AnomalyAlertSummary): boolean {
  if (summary.emailOutboxUnknown) return false;
  return (
    (summary.emailOverdueCount ?? 0) === 0 &&
    (summary.emailDeadLetterCount ?? 0) === 0 &&
    (summary.emailStuckSendingCount ?? 0) === 0 &&
    (summary.emailQuotaConfirmedCount ?? 0) === 0 &&
    (summary.emailQuotaSuspectedCount ?? 0) === 0 &&
    (summary.emailOutboxTotalCount ?? 0) === 0
  );
}

/**
 * 由摘要組白話告警訊息(只列踩門檻的類別)。
 *
 * 🔴 **文案紀律(三條,改字的人要一起守)**:
 *   ① **零技術詞** —— 收訊者不是工程師。原版有 8 個他看不懂的詞
 *      (sweeper / pending / 孤兒 / 被讓路 / W1 / Report C / plan §4 / dismissed),全部拿掉。
 *   ② **不宣稱「已確認雙扣」** —— open = 候選、待查證(runbook line51)。
 *      末行那句「先查清楚再退款」是**唯一一句在防動錯錢的**,不要因為它不白話就刪掉。
 *   ③ 🔴 **「本訊息零個資、僅計數」那句已經拿掉,而那是必須的** ——
 *      帶了單號之後它就是**假的**,而一句假的隱私聲明比沒有更糟。
 */
/**
 * 安靜日心跳信(2026-09-03;Sean 拍甲「分兩區」的第一半)。
 *
 * 🔴🔴 **它裡面刻意【沒有任何計數】** —— 連「長期存量」都不印。
 *    理由:那些數字**永遠不為零**(`packages/domain/src/payment/anomaly-alert.ts:82` 那格終態,
 *    正式庫 2026-08-24 量到 4), 而每天把它們端出去 ⇒ 三天後沒有人讀
 *    ⇒ **一個每天都在響而沒有人看的東西**。它們的排版是**片2** 的事。
 *
 * 🔴 **為什麼帶時刻**:收信這件事本身就證明它跑了 —— 而**時刻分得出「今天這封」與
 *    「昨天那封延遲到現在才到」**。少了它, 一封遲到的信讀起來與一封準時的信一模一樣。
 *
 * 🛑🛑 **它【不在這一層寄】—— 而那是本片最重要的一格**(codex 2026-09-03 R1+R2 兩輪):
 *    我第一版在這支 use-case 裡直接寄, 並自己抄了一份「route 什麼時候會回 503」的清單來擋。
 *    ⇒ 🔴 **R2 逐條打回:那份副本抄不全也抄不準** ——
 *      `orderCreatedGapUnknown` / `shippedGapUnknown` 在 cutoff 有設時**會** 503 而我沒擋;
 *      `orderCreatedStuckUnknown` 要兩顆設定都有才 503 而我**無條件**擋;
 *      `SHIPPED_EMAIL_CUTOFF` 格式錯也 503 而**這一層看不到那顆 env**。
 *    ⇒ 🎯 **⇒ 我做的是一份 503 條件的副本, 而副本住在一個看不到那些 env 的地方。**
 *    ⇒ ⇒ 📌 **用一個【代理】去回答一個問題, 而代理與本尊會漂開。**
 *    ✅ **正解**:這一層只回 `alerted`(不另開旗標 —— codex R3 nit,理由見下),
 *      **由 route 在所有 503 檢查都過了、`return 200` 的正前面才寄** ——
 *      那樣耦合只有一個地方, 不會有兩份清單。
 *
 * 🔵 **而 route 判斷的依據就是 `result.alerted` 本身, 不另開一個旗標**(codex R3 nit):
 *    我原本加了一個 `quietHeartbeatEligible`, 理由是「將來規則可能分家」——
 *    🛑 而它現在**完全等於 `!alerted`**, 而複製一份狀態本身就有代價
 *    (契約上兩個旗標可以同時為 true ⇒ 那一天會同輪寄紅燈與綠燈)。
 *    ⇒ 📌 **真的出現獨立規則那天再加欄位** —— 那時候它會有一個真的理由。
 */
export function buildAnomalyQuietHeartbeatMessage(
  now: Date,
  /**
   * 這一輪有哪幾項**讀不到**(而它們自己不會讓 route 回 503)。
   *
   * 🔴🔴 **為什麼要帶進來, 而不是「讀不到就別寄」**(codex R3 must-fix, 而修法與它建議的不同):
   *    codex 說「不符合【全健康才寄】」—— 對, 而**擋掉會製造一個新的沉默**:
   *    `manualCustomerSearchUnknown` 那一項 route **只 warn 然後回 200**(`route.ts:567`)
   *    ⇒ 拿它擋心跳 ⇒ 那一天**既沒有信、也沒有 503** ⇒ 我親手做出這一片要消滅的東西。
   * ✅ **⇒ 所以照寄, 而【把它說出來】** —— 這封信不再宣稱「全部都好」,
   *    它宣稱的是「沒有需要你處理的事, 而有 N 項這一輪讀不到」。
   *    ⇒ 📌 **不要宣稱超過你量到的東西** —— 而那與「不要製造沉默」可以同時成立。
   */
  unreadable: readonly string[] = [],
): AnomalyAlertMessage {
  // 🔴 台北時刻:這封信的讀者在台灣, 而 `toISOString()` 是 UTC ——
  //    印 UTC 會讓「今天早上 9 點」讀起來像半夜, 而沒有人會去換算。
  const taipei = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return {
    subject: ANOMALY_QUIET_HEARTBEAT_SUBJECT,
    // 🔴 「0 筆」與「沒有這封信」要是**兩件看得出來的事** —— 那正是這一片的全部目的。
    text: [
      '今天沒有需要你處理的付款異常。',
      '',
      `這一輪跑完的時刻(台北):${taipei}`,
      // 🔴 讀不到的項目**逐項列出來** —— 這封信不宣稱「全部都好」, 只宣稱「沒有要你處理的事」。
      //    ⚠️ 這裡列的**不是計數**, 是「哪一項這一輪沒讀到」⇒ 不違反「信裡零計數」那條。
      ...(unreadable.length > 0
        ? ['', `⚠️ 這一輪有 ${unreadable.length} 項讀不到:${unreadable.join('、')}`,
           '(它們不會讓這支排程失敗,所以你只會在這裡看到)']
        : []),
      '',
      '⚠️ 這封信只證明巡檢跑完而且寄得出去。',
      '沒收到這封信 = 那條線可能停了,而不是「今天沒事」。',
    ].join('\n'),
  };
}

/**
 * 心跳主旨的**唯一字面來源**。
 * 🔴 route 與測試都引用它, **沒有第二個地方打這串字** —— 兩份字面遲早會分岔。
 */
export const ANOMALY_QUIET_HEARTBEAT_SUBJECT = '[PCM] 付款異常巡檢:今天 0 筆';

export function buildAnomalyAlertMessage(
  summary: AnomalyAlertSummary,
  refundingStuckSeconds: number,
  /**
   * ⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋計數。**第三個參數,而不是塞進 `AnomalyAlertSummary`。**
   * 🔴 理由:`AnomalyAlertSummary` 對應的是 `get_payment_anomaly_alert_summary` 那支 RPC 的形狀,
   *    而這個數字來自**另一支 RPC** ⇒ 混進去會讓那個型別不再對應任何一支函式。
   * 🛑 `null` = 那支 RPC 還沒 apply(查不到), **不是零筆**。
   */
  //  🔴🔴 **沒有預設值 —— 而那是 R2(換模型)must-fix F4。**
  //     ⛔ ~~原本寫 `= null`~~ ⇒ **少傳一個參數 = 「查不到」** ⇒ 真的告警信裡會印
  //        「那支查詢還沒上線」而它其實上線了, **而零 typecheck 紅、零測試紅**。
  //     ⇒ 而它與 `IAnomalyAlertReader` 那句「`null` 的唯一合法來源是【還沒被 apply】」直接相撞。
  //     📌 **⇒ 拿掉一個字元, 漏傳就當場 typecheck 紅。**(本函式對外匯出, 呼叫端不只一個。)
  /**
   * 🔵 **`windowSeconds` 併在這個物件裡, 不另開第四個參數** —— 而那不只是省一個參數:
   *    **那個窗口是【這份量測的一部分】** ⇒ 它跟著資料走, 就不會有「數字換了而說明沒換」。
   * 🔴 而它解掉 R2 consider F7:原本信裡**寫死**「過去 24 小時」,
   *    而窗口是 route 端注入的常數 ⇒ **把它改成 3600 而信上照樣說 24 小時。**
   *    ⇒ 那是同一支檔 `:346-348` 判過的同一個病的復發(那段逐字:「正式路徑目前固定 86400,
   *      所以今天走不到 —— **而那不是不修的理由**」)。
   */
  manualCustomerSearch: {
    readonly count: number;
    readonly actors: number;
    readonly windowSeconds: number;
  } | null,
  /**
   * 🔴 R3 must-fix 1:`manualCustomerSearch` 是 `null` 時有**兩種**成因,而它們在信上要講不同的話。
   * `true` = 讀取失敗(有人要去看)· `false` = 那支 RPC 還沒 apply(預期中,不必動作)。
   */
  searchReadFailedForMessage = false,
  /**
   * 搜尋日誌健康度(⟦search-LOGSILENTZERO⟧)。**第五個參數, 理由與第三個同一條**:
   * 它來自**另一支 RPC**(`get_search_log_health`), 塞進 `AnomalyAlertSummary` 會讓那個型別
   * 不再對應任何一支 RPC 的回傳。
   *
   * 🔴 **沒有預設值 —— 漏傳就當場 typecheck 紅**(與 `manualCustomerSearch` 同一個理由:
   *    有預設值的話, 漏傳 = 「一切正常」而零紅)。
   * 🛑 兩格都是 `boolean`, 而**它們只在 true 時才進信** ⇒ 不命中零字。
   */
  searchLogFlags: { readonly stale: boolean; readonly anonRevoked: boolean },
  /**
   * ⟦b4-NEEDSHUMANNOWATCHER⟧ 卡住的匯款單:`overpaid` / `needs_human` 那兩種。
   * 🔴 **沒有預設值 —— 漏傳就當場 typecheck 紅**(與上面兩格同一個理由)。
   * 🛑 **`count === 0` ⇒ 不命中零字。**
   * 🔵 `oldestCreated` 讓收信的人知道**積了多久** —— 而它零 PII、零金額、零單號。
   */
  stuckBank: {
    readonly count: number;
    readonly oldestCreated: string | null;
    readonly overpaidCount: number;
    readonly overpaidOldest: string | null;
  },
): AnomalyAlertMessage {
  // 🔴 `Math.round(秒/3600)` 會把 5400 秒(90 分)講成「2 小時」= **報一個錯的門檻給收信人**
  //    (codex R2 nit)。正式路徑目前固定 86400,所以今天走不到 —— 而那不是不修的理由:
  //    這個值是 route 端常數、揭示可調,調成非整點的那天沒有東西會紅。
  const stuckLabel =
    refundingStuckSeconds % SECONDS_PER_HOUR === 0
      ? `${refundingStuckSeconds / SECONDS_PER_HOUR} 小時`
      : `${Math.round(refundingStuckSeconds / 60)} 分鐘`;

  // ① 雙扣候選:附最舊年齡(排序訊號、對齊 W1「越久越優先」)。
  const agePart =
    summary.oldestOpenAgeSeconds !== null ? `(最久的已經 ${formatAge(summary.oldestOpenAgeSeconds)})` : '';

  /**
   * 🔴 某一類的單號**沒有列全**(RPC 端 `LIMIT 100`,或部署窗口整個拿不到)。
   * 這個旗標同時餵兩件事:標題的張數(D)與重疊提示(E)。**兩者壞在同一個前提上** ——
   * 「我手上的單號 = 那一類的全部」,而超過 100 筆時那句話就不成立了。
   */
  const truncated =
    summary.openCount > summary.openDisplayIds.length ||
    summary.refundingStuckCount > summary.refundingStuckDisplayIds.length ||
    summary.attemptManualReviewCount > summary.attemptManualReviewDisplayIds.length ||
    summary.releasedStuckCount > summary.releasedStuckDisplayIds.length ||
    summary.pendingDoubleChargeCandidateCount > summary.pendingDoubleChargeDisplayIdPairs.length ||
    // 🔴🔴 **F-004 這一類【永遠沒有單號】**(那支 RPC 只回計數、零 PII 零 id)⇒ 它**恆定命中**
    //    下面 `subject` 那段檔頭自己寫的條件:「被截斷(**或整個拿不到**)時不寫數字」。
    //    不加這一條的話,實測 `openCount=1`(1 個單號)+ `orderRefundsStuckCount=4` ⇒
    //    主旨印「⚠️ PCM 付款有 **1** 張單要你看」,而內文是 1 筆 + 4 筆
    //    ⇒ 🔴 **一個錯的數字會讓他以為事情比較小** —— 那正是那段檔頭寫下來要防的事,
    //      而我新增的類別讓它自己失效了。
    //    ⚠️ `unknown`(RPC 尚未 apply)同理:那一類是「查不到」,主旨更不該替它報一個數字。
    (summary.orderRefundsStuckCount ?? 0) > 0 ||
    summary.orderRefundsStuckUnknown;

  // 🔴 ④ 與 ③ 可以是**同一顆 attempt**(被讓路的 released 同時達 12h 與達 ceiling)。
  //    原版只能寫「可能與上一項重疊」;**帶了單號之後這件事變成查得出來的** ——
  //    有交集就直接指名是哪一張,沒有交集就不要提(提一個不存在的重疊反而更難讀)。
  // 🔴🔴 **而「沒有交集」只有在兩邊都列全時才等於「沒有重疊」**(codex R2 must-fix,兩輪都抓到):
  //    ③④ 各 101 筆、同一張單落在任一邊的第 101 名 ⇒ 兩個前 100 陣列**都非空且無交集**
  //    ⇒ 舊寫法會把重疊提示**整句刪掉**,而那正是最需要它的時候(101 筆的那一天)。
  //    ⇒ 被截斷時退回保守的「可能」,不要用一個算不準的集合去下斷言。
  // 🔴🔴 **交集要算在【真的印出去的那些】上,不是原始陣列**(關卡2 must-fix):
  //    `attempt = 1 筆 / ids [A,B]`、`released = 1 筆 / ids [D,B]` ⇒ 兩段各只列 A 與 D,
  //    而拿原始陣列算交集會得到 `B` ⇒ 註記會**指名一個信上根本沒出現的單號**,
  //    還說它是「上面那一項」—— 那是**多洩一個單號 + 講一句假話**,兩個問題一起。
  const shownAttempt = shownIds(summary.attemptManualReviewDisplayIds, summary.attemptManualReviewCount);
  const shownReleased = shownIds(summary.releasedStuckDisplayIds, summary.releasedStuckCount);
  const overlap = shownReleased.filter((id) => shownAttempt.includes(id));
  const bothMayOverlap = summary.attemptManualReviewCount > 0 && summary.releasedStuckCount > 0;
  // 🔴 **只看這兩類自己截斷了沒,不看全域 `truncated`**(關卡2 must-fix):
  //    `open` 被截斷、而 ③④ 兩邊都完整且真的無交集時,全域旗標會讓這裡誤報
  //    「可能和上面那一項是同一張單」—— **拿一個無關類別的殘缺,去替這兩類的完整下修**。
  const pairTruncated =
    summary.attemptManualReviewCount > shownAttempt.length ||
    summary.releasedStuckCount > shownReleased.length;
  const overlapNote =
    overlap.length > 0
      ? [`  (${overlap.join('、')} 和上面那一項是同一張單,不是兩件事)`]
      : bothMayOverlap && (pairTruncated || shownReleased.length === 0)
        ? ['  (可能和上面那一項是同一張單)']
        : [];

  const shownPairs = shownIds(
    summary.pendingDoubleChargeDisplayIdPairs,
    summary.pendingDoubleChargeCandidateCount,
  );

  /**
   * 🔴🔴 **「後台有沒有手可以處理」是【每一類各自】的事實,不是整封信的事實。**
   *
   * 2026-08-21 角度①(告警信線)抓到、Sean 拍板「甲」、codex R2 再打回一次之後的形狀。
   * 病史值得留著,因為我連續兩版都犯了同一個病的兩種形態:
   *   v1  「這幾筆單目前在後台【不能操作】(退款、標記免處理、取消都做不了)…不要在後台找按鈕」
   *       ⇒ 對 ③④ 驗過,而**印在五類上面**。
   *   v2  我把它改成一句「有些卡住的單,後台現在沒有手…沒有按鈕就是還沒開放處理」
   *       ⇒ 🔴 **codex R2 打回**:換一句一樣是全稱的話,而且「沒按鈕 ⇒ 還沒開放」是個
   *          **歸因** —— 按鈕消失也可能是 feature flag / 讀取失敗 / 非 TapPay / 對帳異常 / 權限,
   *          ⇒ 那句話會把**真的故障**說成「正常,還沒開放」。**用一個全稱句換掉另一個全稱句不是修好。**
   *   v3(本版)把那句話**搬進它為真的那幾個 block 裡**,並讓「哪幾類為真」跟著 block 一起走。
   *
   * 逐類依據(全部是量到的,不是推的):
   *   ① open / ② refundingStuck  —— SQL 對這兩類的 `payment_status` **沒有述詞**
   *      (`20260819130000_m3_s2…display_ids.sql:112` / `:124`,兩處都只 JOIN `old_order_id`)
   *      ⇒ **不知道** ⇒ 不宣稱。(codex R2:「沒有足夠 gate 資料保證」)
   *   ③ attemptManualReview / ④ releasedStuck —— SQL 寫死 `o.payment_status = 'unpaid'`
   *      (同檔 `:148` / `:162`)⇒ 而窗 C(法規客服線)頁層渲染實測:`chargeAttemptGate='blocked'`
   *      時整頁 6 顆控制項,**退款 0 · 人工退款 0 · 標記免處理 0 · 取消 0**
   *      (對照組 `'clear'` ⇒ 8 顆 ⇒ 尺分得開)⇒ **這兩類「沒有手」是真的。**
   *   ⑤ pendingDoubleCharge —— SQL 寫死 `o1/o2 payment_status = 'paid'`(同檔 `:189` / `:190`),
   *      而 `REFUND_ENTRY_STATUSES = ['paid','partiallyRefunded']`
   *      (`apps/admin/src/components/orders/refund-entry-gate.ts`,grep `REFUND_ENTRY_STATUSES`)
   *      ⇒ 🔴 **退款入口會渲染** ⇒ **絕對不可以對這一類說「沒有手」** ——
   *        而那正是 v1 最貴的那一格:客人**真的被扣了兩次錢**,而信叫他不要去找按鈕。
   *
   * 🔴 `noHand` 掛在 block 上、不掛在一張平行的表上 —— 平行表會與 block 陣列漂移,
   *    而漂移時兩邊各自都還讀得通。新增一類 ⇒ 這裡**寫不出物件字面就編譯紅**,不會靜靜地漏。
   */
  // 🔴 「後台沒有壞」四個字收在這一句裡面 —— 它原本是 footer 上一句獨立的話,
  //    而**組出成品逐句讀**之後那句變成孤兒:它在講這封信自己的結構(「那一類自己會講」),
  //    那是寫的人的語言,不是收信人的語言。⇒ 保證要跟它所保證的那件事**貼在一起**。
  // ⚠️ 刻意**不寫**「還沒開放處理」這類歸因(codex R2):按鈕消失也可能是讀取失敗 / 權限 / 對帳異常,
  //    替他歸因會把真故障說成正常。這裡只講**觀察得到的事實**:沒有那顆按鈕、而後台沒有壞。
  const NO_HAND_NOTE =
    '  ↳ 這一類後台沒有手可以處理 —— 打開那張單,不會有可以動這筆刷卡的按鈕。後台沒有壞。';
  /**
   * 🔴🔴 **Sean 2026-08-21 逐字。一個字都不要動**(含那個全形逗號)。
   * 原文:`訂單刷卡失敗未收款，請檢查是否是網站3D驗證問題。`
   *
   * 🔴 **它與 `NO_HAND_NOTE` 不是同一句的兩個版本,是兩件事:**
   *   NO_HAND_NOTE  = 告訴他【系統沒壞】⇒ 防的是誤判
   *   本句          = 告訴他【去查什麼】⇒ 那是一個動作
   *   ⇒ 兩句都要,而且本句放前面(他讀第一行就知道要去查什麼)。
   *
   * 🔴🔴 **只掛 ③,不掛 ④ —— 而這是一個【裁定】,不是排版**(主視窗 2026-08-21,可逆):
   *   本句寫的是「**3D 驗證問題**」,而 ④ 那一類進得了 `released` 的兩條路**都要求未授權**
   *   (`preflight-release-sibling.ts:128` 只在 record_status=4;`20260810010000_…l5a1:295`
   *    只收「查無 / 恆 4 PENDING」)⇒ **根本沒走到 3D。**
   *   ⇒ 把它套上 ④ = **我們自己造一句他沒說過的話,而且內容是假的。**
   *   ⚠️ 守門在 `check-anomaly-alerts.test.ts`:**④ 的訊息不得含 `3D驗證`**。
   *      那一格守的正是這個裁定 —— 而**裁定最容易被下一個人「順手統一」掉**,
   *      因為統一看起來像整理,不像改變決定。
   */
  const SEAN_3DS_NOTE = '  ↳ 訂單刷卡失敗未收款，請檢查是否是網站3D驗證問題。';
  const blockSpecs: readonly {
    readonly lines: readonly string[];
    /** 貼在【標題正下方】的註腳,依序。空陣列 = 這一類不加。 */
    readonly notes: readonly string[];
  }[] = [
    { lines: section(`可能被扣了兩次錢${agePart}`, summary.openCount, summary.openDisplayIds), notes: [] },
    {
      lines: section(
        `退款卡住,超過 ${stuckLabel}還沒退成`,
        summary.refundingStuckCount,
        summary.refundingStuckDisplayIds,
      ),
      notes: [],
    },
    /**
     * 🔴 **F-004:客人的退款卡住 —— 這一類以前【從來沒有進過這封信】。**
     *
     * 成因不是漏寫,是**分母**:上面那一類讀的是重複扣款那張表,而客人的退款帳本
     * 是另一張。⇒ 畫面上有卡住的退款,而信裡永遠是安靜的。
     * 🔴 **而排程與寄信都活著、信真的有來 ⇒ 這比完全沒有通知更難發現。**
     *
     * ⚠️ **標題刻意與上面那一類不同字**(「客人的退款」vs「退款」):兩類都叫「退款卡住」
     *    而分母不同 ⇒ 收信人分不出來,就會以為其中一個數字寫錯了。
     * ⚠️ **沒有單號可印** —— 那支 RPC 只回計數(零 PII/零 id)⇒ 走 `section` 的空陣列路徑,
     *    只講筆數。**不得憑空編單號。**
     */
    {
      lines: section(
        '客人的退款卡住,還沒退成功',
        summary.orderRefundsStuckCount ?? 0,
        [],
      ),
      notes:
        (summary.orderRefundsStuckCount ?? 0) > 0
          ? [
              // 🔴 Sean 的連帶必做逐字:「信裡把**剛卡住**與**過夜**分開列,不是把剛卡住的藏起來」。
              //    ⇒ 過夜是子集,分開講而不是換一個門檻把新的那幾筆濾掉。
              // 🔴 夾在總數上:overnight 是 total 的子集,而**型別沒有把這件事編碼進去**。
              //    SQL 端同一發 SELECT 保證子集 ⇒ 今天走不到;但 `shownIds` 對同一個 skew
              //    方向本來就有夾,這裡不夾就是同一封信裡兩套標準。
              //    不夾的話 `count=1 / overnight=5` ⇒ 信上會印「1 筆 / ↳ 其中 5 筆已經卡超過一天」。
              ...((summary.orderRefundsStuckOvernightCount ?? 0) > 0
                ? [
                    `  ↳ 其中 ${Math.min(
                      summary.orderRefundsStuckOvernightCount ?? 0,
                      summary.orderRefundsStuckCount ?? 0,
                    )} 筆已經卡超過一天。`,
                  ]
                : []),
              '  ↳ 到後台「退款異常清單」那一頁看。',
              // 🔴🔴 這兩句是主視窗指定的 must,而它們擋的是**兩種不同的誤會**:
              //    ① 「其餘=停+告警、零按鈕」⇒ 點進去可能沒有動作可按,那不是壞掉
              //    ② 不承諾筆數會變少 ⇒ 否則下一封信數字沒降,他會以為系統壞了
              '  ↳ 有幾筆可能還按不了(系統還在等對帳),那不是壞掉。',
              '  ↳ 只要還沒處理完,這幾筆每天都會再出現一次。',
            ]
          : [],
    },
    /**
     * 🔴 部署窗口:程式先上、DB 那支 RPC 還沒 apply。
     * **不寫成「0 筆」** —— 把「我讀不到」印成「沒有卡住的退款」,
     * 就是用這一片的部署窗口,重新造出這一片要修的那個 bug。
     * ⚠️ 而它**不觸發寄信**(不進 `shouldAlert`):DB 沒 apply 是**部署問題**,
     *    該吵的對象是看 cron 的人(route 回 503),不是每天寄信給老闆。
     *    ⇒ 這一行只在信**本來就要寄**的時候搭便車出現。
     */
    {
      lines: summary.orderRefundsStuckUnknown
        ? ['【客人的退款卡住】這一項今天查不到(後台尚未啟用),不代表沒有。']
        : [],
      notes: [],
    },
    {
      lines: section(
        '刷卡卡在中間,系統自己處理不了',
        summary.attemptManualReviewCount,
        summary.attemptManualReviewDisplayIds,
      ),
      // 🔴 順序不可調:Sean 那句在前(去查什麼),NO_HAND_NOTE 在後(系統沒壞)。
      notes: [SEAN_3DS_NOTE, NO_HAND_NOTE],
    },
    {
      lines: [
        // 🔴🔴 2026-08-21 **Sean 逐字定稿**:`訂單付款未成功`。**照抄,不要潤飾、不要加字。**
        //   舊字面「付款沒完成,但錢可能還被鎖著」是**事實錯誤**,而他自己抓到的,原話:
        //     「付款沒完成 錢不會被鎖吧,因為根本沒有跳過去 3d 驗證,也不會授權,所以不會卡著額度」
        //   查證(甲:選的東西對、名字錯):進得了 `status='released'` 的路只有兩條,兩條都要求【沒有授權】——
        //     ① preflight release CAS 只在 record_status=4(`preflight-release-sibling.ts:128`)
        //     ② supersede 只收「查無 / 恆 4 PENDING」(`20260810010000_…l5a1:295` COMMENT 逐字;
        //        同行另寫「🔴 charged 絕不讓路=錢可能已動」⇒ 已動錢那類被明文擋在門外)
        //   而 record_status=4 = **PENDING 待付款(尚未授權)**(`settle-charge.test.ts:181` 逐字);
        //   對照這格是尺:`settle-charge.ts:255`「record_status ∈ {0 AUTH, 1 OK} … 授權即成立」⇒ 走 paid,到不了 released。
        //   ⇒ 沒有授權 ⇒ 沒有預授權額度被佔 ⇒ **「錢可能還被鎖著」不會發生。**
        // 🔴 錯誤是從一個【變數名字】繼承來的:那個常數叫 `auth_or_pending`,讀起來像「已授權 or 待付款」,
        //   而它只有 4 = 尚未授權。**寫這個分類名的人讀了變數名,沒讀它旁邊那行註解。**(backlog `#387`)
        ...section('訂單付款未成功', summary.releasedStuckCount, summary.releasedStuckDisplayIds),
        ...(summary.releasedStuckCount > 0 ? overlapNote : []),
      ],
      // 🔴 **只有 NO_HAND_NOTE,沒有 SEAN_3DS_NOTE** —— 理由見 SEAN_3DS_NOTE 檔頭:
      //    這一類沒走到 3D,套上去就是替他造一句假話。守門會擋(不得含 `3D驗證`)。
      notes: [NO_HAND_NOTE],
    },
    {
      lines: [
        ...(summary.pendingDoubleChargeCandidateCount > 0
          ? [`【同一位客人、同樣金額買了兩次,其中一次卡很久】${summary.pendingDoubleChargeCandidateCount} 組`]
          : []),
        // 🔴 走同一支 `shownIds` ⇒ 第五類也受「不得多於計數」那道夾(R3 的 M1 對五類都成立)。
        ...shownPairs.map(([a, b]) => `  ${a} ＋ ${b}`),
        ...(summary.pendingDoubleChargeCandidateCount > shownPairs.length
          ? [`  …另外還有 ${summary.pendingDoubleChargeCandidateCount - shownPairs.length} 組,請到後台看`]
          : []),
      ],
      // 🔴 空的 —— 見上方 ⑤:這一類的退款入口【會渲染】。加 NO_HAND_NOTE 會把 v1 那個最貴的錯誤裝回來。
      notes: [],
    },
  ];
  // 🔴🔴 註腳插在【標題的下一行】,不是整段結尾(2026-08-21 `-91` 複核 MF-2)。
  //   前一版 `[...b.lines, NO_HAND_NOTE]` 把它貼在單號之後,而 `MAX_ORDERS_PER_CATEGORY = 30`(`:102`)
  //   ⇒ 那句話最遠落在標題【之下 31 行】。
  //   失敗情境:③ 有 30 筆時,他讀到第一個單號就去開後台、找不到按鈕 ⇒ 以為系統壞了,
  //   而「後台沒有壞」那句就寫在他還沒捲到的地方。
  // 🔴 而這一片自己在下面 footer 那段寫過同一句話的道理(逐字):
  //   「這一句放最前面,不是結尾 —— 它是唯一擋得住誤動作的東西,而放結尾等於沒有。」
  //   ⇒ **我寫了那條規則,然後在同一支檔的另一段違反它。** 規則知道 ≠ 規則執行。
  // ⚠️ 解構取頭 —— **不是風格,是型別**:`noUncheckedIndexedAccess` 之下 `b.lines[0]` 是
  //   `string | undefined`,而 `b.lines.length > 0` 不會讓 TS 收窄它(實測 TS2322)。
  //   🔴 而那一發是【typecheck 紅、45 格測試全綠】抓到的 ⇒ 測試不是型別的替代品。
  //   `head !== undefined` 同時涵蓋了原本的「非空才貼」那道判斷。
  const blocks: string[][] = blockSpecs.map((b) => {
    const [head, ...rest] = b.lines; // head = 【標題】N 筆
    return head !== undefined && b.notes.length > 0 ? [head, ...b.notes, ...rest] : [...b.lines];
  });

  /**
   * 標題的數字 = **不重複的單號張數**,不是各類筆數相加 ——
   * ③④ 可以是同一張單(見 `overlap`),相加會報出一個比實際多的數字。
   *
   * 🔴🔴 **而它只有在【單號列全了】的時候才等於「有幾張單」**(codex R2 must-fix):
   *   open 200 筆、RPC 只回得出前 100 ⇒ 標題會寫「100 張單」而內文寫「200 筆」
   *   ⇒ **同一封信自己跟自己打架**,而收信人沒有辦法知道該信哪一個。
   *   ⇒ 被截斷(或整個拿不到)時 **不寫數字** —— 一個沒有數字的標題只是少講一件事,
   *     一個錯的數字會讓他以為事情比較小。**那兩種代價不對稱。**
   */
  // 🔴 用**實際印出去的那些**,不是原始陣列(R3 的 M1):`ids.length > count` 那個方向下,
  //    原始陣列會讓標題報出一個**比各類計數之和還大**的張數。
  const distinctOrders = new Set<string>([
    ...shownIds(summary.openDisplayIds, summary.openCount),
    ...shownIds(summary.refundingStuckDisplayIds, summary.refundingStuckCount),
    ...shownIds(summary.attemptManualReviewDisplayIds, summary.attemptManualReviewCount),
    ...shownIds(summary.releasedStuckDisplayIds, summary.releasedStuckCount),
    ...shownPairs.flat(),
  ]);
  /**
   * 🔴🔴 **寄信這條線的區塊。它與上面那些【不是同一種東西】,所以它有自己的標題與收尾。**
   *
   * **為什麼不能只加兩行進去**(codex 2026-08-29 抓到,而它是本片最重的那一格):
   * 這封信的主旨寫死「PCM **付款**有事要你看」、footer 叫人**去看訂單**
   * ⇒ 一封**只有寄信異常**的告警,會用付款的主旨、叫他去動錢。
   * 📌 **一個內容正確而標題錯誤的告警,比不叫更糟 —— 它把人送去錯的地方。**
   *
   * ⚠️ **文案的【字面】沒有經過 Sean 拍板** —— 板上的規矩是文案歸他。
   * 這裡寫的是**事實正確的最小版本**,不是成品:要改字面,改這一段就好,不動任何判定。
   * ⇒ 而我**刻意不加「暫定文案」那種前綴** —— 這是一封他早上九點會收到的 LINE,
   *   前綴在那裡是雜訊;而在後台畫面上(`tier-edit-submit.tsx`)前綴是對的。**載體不同。**
   */
  const emailOutboxSilentlyEmpty = isEmailOutboxSilentlyEmpty(summary);

  const emailLines: string[] = [];
  const emailPush = (n: number | null, label: string) => {
    if ((n ?? 0) > 0) emailLines.push(`· ${label}:${n} 封`);
  };
  emailPush(summary.emailDeadLetterCount, '🔴 已經放棄、【永遠不會再寄】的信');
  emailPush(summary.emailQuotaConfirmedCount, '🔴 撞到寄信額度上限(確定)');
  // 🔴 疑似那格用【不同的字】—— `http_429` 可能只是瞬時限流。
  //    寫成「額度用盡、請升級」= 把未知報成確診,而那會把人送去買一個他可能不需要的方案。
  emailPush(summary.emailQuotaSuspectedCount, '⚠️ 大量被擋(可能是額度,也可能只是一時被限流)');
  emailPush(summary.emailOverdueCount, '該重試而沒有人重試的信');
  emailPush(summary.emailStuckSendingCount, '卡在「寄送中」出不來的信');
  // 🔵 出貨信缺口(2026-08-31;Sean `2 甲`)。用【不同的字】—— 它不是「信寄不出去」,
  //   是「**信根本沒有被建出來**」⇒ 去看的地方不一樣。
  emailPush(summary.shippedNeverEnqueuedCount, '🔴 貨出了而通知信【根本沒被排進佇列】');
  // 🔵 而這一格與上一格【不同種】:不是系統壞掉, 是**我們沒有那個客人的信箱**。
  //   ⇒ 併起來 = 用一種原因的文案報另一種原因(與 5-a / 5-b 分開的理由相同)。
  emailPush(summary.shippedUnsendableCount, '⚠️ 貨出了而那張單【兩個信箱都是空的】⇒ 寄不出去');
  /**
   * 🔵 **訊號 4(2026-08-31)** —— 用【第三種字】,因為它與上面兩族去看的地方都不一樣:
   *   上面是「信寄不出去」、出貨那兩格是「貨出了而信沒建」,
   *   這一格是「**訂單成立了而那封信沒建**」⇒ 看的是 scanner / 起始線那條路。
   * 🛑 **只推 `noRecipient` 那一格** —— `paidNoEmail` >0 是正常的(下一輪就排進去了),
   *   把它印進信裡會讓收信的人每天看到一個不用處理的數字, 而那正是噪音的來源。
   */
  // 🔵 卡住那一格【自己一行】—— 它要說得出「幾張」與「最舊卡多久」,
  //   而一個裸的筆數寫不出信裡那句話。
  if ((summary.orderCreatedStuckCount ?? 0) > 0) {
    const oldestStuck = summary.orderCreatedStuckOldestMinutes;
    emailLines.push(
      `· 🔴 訂單成立信【一直排不進去】:${summary.orderCreatedStuckCount} 張` +
        (oldestStuck === null ? '' : `(最舊那張已經 ${oldestStuck} 分鐘)`) +
        ' ⇒ 那不是還沒輪到它, 是每一輪都失敗',
    );
  }
  emailPush(
    summary.orderCreatedNoRecipientCount,
    '🔴 訂單成立了而【那張單兩個信箱都是空的】⇒ 通知信永遠不會被建出來',
  );
  // 🔴 **獨立一行, 不與上面那行合併** —— 兩條線的修法不同:
  //   上面那行要看「為什麼下單沒留信箱」, 這一行要看「那張被取消的單是誰的」。
  //   ⇒ 合成一個數字會讓看信的人不知道要去哪一條線。
  emailPush(
    summary.unpaidCancelledNoRecipientCount,
    '🔴 訂單被取消了而【那張單兩個信箱都是空的】⇒ 取消通知永遠不會被建出來',
  );
  // 🔴 **第四條線, 一樣獨立一行。** 而它的嚴重度與上面兩行不同, 文案要說出那個差:
  //   上面兩條是「客人【沒收到】一封信」;這一條是**客人手上有一個【我們給他的、而現在是錯的】號碼**
  //   ⇒ 🎯 他會拿那個號碼去查貨、查不到、打電話進來, 而後台看到的號碼是對的。
  emailPush(
    summary.trackingCorrectedNoRecipientCount,
    '🔴 貨運單號更正了而【那張單兩個信箱都是空的】⇒ 客人手上那個錯號碼, 我們沒有路可以更正',
  );
  // 🔴 這一行【不走 emailPush】—— 它不是「幾封信」, 它是「一封都沒有」。
  //   ⇒ 文案刻意寫成兩種可能, **不猜是哪一種**:「這張表是空的」與「讀不到資料」
  //     在這一格底下**分不出來**, 而寫死其中一個會把人送去修錯的東西。
  if (emailOutboxSilentlyEmpty) {
    emailLines.push('🔴 寄信佇列【一列都沒有】—— 可能是這張表是空的, 也可能是讀不到資料');
  }
  const emailBlock: string[] =
    emailLines.length > 0
      ? ['【寄信】', ...emailLines, '⇒ 這一段與訂單無關,不用去後台退款或改單。']
      : [];
  const hasEmail = emailLines.length > 0;
  const hasPayment =
    summary.openCount > 0 ||
    summary.refundingStuckCount > 0 ||
    summary.attemptManualReviewCount > 0 ||
    summary.releasedStuckCount > 0 ||
    summary.pendingDoubleChargeCandidateCount > 0 ||
    (summary.orderRefundsStuckCount ?? 0) > 0;

  /**
   * 🔴 **主旨要分得出三個世界**:純付款 / 純寄信 / 兩者都有。
   * 而**只有純付款那個世界維持原字面** —— 其餘兩個原本都會被寫成「付款有事」。
   */
  /**
   * 🔴 **codex 2026-09-02 must-fix ①:第四個世界【資料庫權限】** ——
   *    只有 `bypassRlsRevoked` 為真時, `hasPayment` 與 `hasEmail` **都是 false**
   *    ⇒ 上面那串三元會掉到最後那一支 `'⚠️ PCM 付款有事要你看'`
   *    ⇒ 📌 **主旨會說「付款有事」, 而付款一格都沒有事** —— 收信的人會去查訂單、查錢,
   *       而真正的問題是**他看到的那些數字本身可能是空的**。
   * 🛑 而它排在**最前面**:權限壞掉時要先講那件事, 不要讓它被另外兩個世界的字面蓋掉。
   */
  const hasBypassRls = summary.bypassRlsRevoked;
  /**
   * 🔴🔴 **R3(換模型那一輪)must-fix 1:「純心跳」這個世界一直都在, 而它掉到「付款有事」。**
   *
   * `cronHeartbeatAbnormalCount > 0` **進 `shouldAlert`**(見下方那道閘), 而它
   * **不在** `hasPayment` 也不在 `hasEmail` ⇒ 只有它為真時, 主旨掉到最後那一支
   * `'⚠️ PCM 付款有事要你看'` —— **而付款一格都沒事。**
   *
   * 🎯 **而本片自己就會點著它, 這才是 R3 抓到的重點**:
   *   `bypassRlsUnknown ⇒ route 回 503` 之前先跑 `recordHeartbeatFailure(anomalyAlert)`
   *   ⇒ `consecutive_failures` +1 ⇒ 而 `pcm-anomaly-alert` **不在**
   *     `FAILURE_COUNT_MEANINGLESS`(`packages/domain/src/ops/cron-jobs.ts:100` 只有
   *     `pcm-expire-unpaid-orders`;它自己在 `:66` 的被監控清單裡 —— **我實查過**)
   *   ⇒ 下一輪 `abnormal_count ≥ 1` ⇒ **進 `shouldAlert` ⇒ 寄 LINE + Email 給 Sean**。
   *
   * 🛑 **⇒ 所以我原本寫的「Unknown 不吵 Sean」在【單元層為真、在真系統為假】** ——
   *    那格測試的分母裡沒有心跳耦合。**兩種訊號兩個觀眾**這句話要收窄成:
   *    **「Unknown 不會【直接】寄信;而它連續失敗之後會經由心跳那條路寄。」**
   * 📌 **⇒ 一個在自己那一層完全正確的宣稱, 換一層之後是假的 —— 而它不會被任何單元測試抓到。**
   */
  const hasHeartbeat = (summary.cronHeartbeatAbnormalCount ?? 0) > 0;
  // ⟦b9-ACLDRIFT5⟧:主旨也要分得出來 —— 一封主旨寫「付款有事」而內容是權限漂移的信,
  //   收信的人會用錯的心情打開它。
  const hasAclDrift = summary.aclDriftDetected === true;
  const subject = hasAclDrift && !hasBypassRls && !hasPayment && !hasEmail && !hasHeartbeat
    ? '🔵 PCM 資料庫權限與昨天不一樣(貼板當天正常)'
    : hasBypassRls && !hasPayment && !hasEmail && !hasHeartbeat
    ? '⚠️ PCM 資料庫權限有事要你看(與付款無關)'
    : hasBypassRls
      ? '⚠️ PCM 資料庫權限有事,而其他也有事要你看'
      : hasHeartbeat && !hasPayment && !hasEmail
        ? '⚠️ PCM 背景排程有事要你看(與付款無關)'
        : !hasPayment && hasEmail
          ? '⚠️ PCM 寄信有事要你看(與付款無關)'
          : hasPayment && hasEmail
            ? '⚠️ PCM 付款與寄信都有事要你看'
            : !truncated && distinctOrders.size > 0
              ? `⚠️ PCM 付款有 ${distinctOrders.size} 張單要你看`
              : '⚠️ PCM 付款有事要你看';

  /**
   * 🔴 **寄信那一段放在【最前面】,而這是刻意的**:
   * 上面那段註解逐字寫著截斷是「從尾端整行 pop」⇒ **放尾端的東西最先被丟掉**。
   * 而「有幾封信永遠不會再寄」是這封信裡**唯一一個不可逆的事實**(單號可以再查,信寄不出去就沒了)
   * ⇒ 它不該是第一個被截掉的。
   * ⚠️ 而**這不等於它不會被截** —— 它只是排在後面那些單號之前。真正不可截的只有 `footer`。
   */
  /**
   * 🔵 **排程心跳(片3)** —— 自成一塊, 不併進【寄信】那一塊:
   *   那一塊的收尾句逐字是「這一段與訂單無關, 不用去後台退款或改單」,
   *   而心跳講的是**背景程式停了**, 兩者要做的事不一樣。
   * 🔴 **一定要印出【哪幾支】** —— 一個裸數字("2 支不正常")會逼收信的人自己去後台找,
   *   而這封信存在的理由就是「沒有人去看的時候它來告訴你」。
   */
  /**
   * ⟦b9-RLSHARDEN⟧ 甲:權限被收緊那天的那一行。
   * 🛑 **逐字帶【它證不到什麼】** —— 沒有這一句, 收到告警的人會以為
   *    「沒叫 = 沒事」, 而那 45 張表的地板還是濕的。
   */
  /**
   * ⟦b9-ACLDRIFT5⟧ 片二:權限快照與昨天不一樣的那一行。
   * 🛑 **逐字帶【貼板當天正常】** —— 少了那一句, 貼完板收到這封信的人會以為出事了,
   *    而最可能的反應是**把那次貼板 revert 掉**。
   * 🔵 而它也帶【怎麼讓它不再叫】—— 一封只說「有事」而不說下一步的信, 會被整批忽略。
   */
  const aclDriftBlock: string[] = [];
  if (summary.aclDriftDetected) {
    aclDriftBlock.push(
      '【權限快照】',
      '🔵 資料庫的權限與昨天不一樣了 —— 有人改了權限, 或是貼了一支 migration。',
      `   哪一族變了:${summary.aclDriftFamilies ?? '(沒讀到)'}`,
      `   這一列是幾點量的:${summary.aclDriftTakenAt ?? '(沒讀到)'}`,
      '   ✅ **貼板當天出現這一行是正常的** —— 那些差就是你貼的那支造成的。',
      '   ⇒ 確認過就在 SQL Editor 跑一次(理由必填, 它會留在資料庫裡):',
      "     SELECT public.pcm_acl_approve_latest('貼了 <版本號>, 那些差是它造成的');",
      '   🔴 而【沒有貼板】卻出現這一行 ⇒ 有人直接在 Supabase 網頁上改了權限 ⇒ 要查。',
      '     逐格看是哪裡變了:bash scripts/acl-snapshot.sh',
      '   🛑 它答不出【有沒有人偷改】—— 改掉又改回來, 兩次快照相同, 它不會叫。',
    );
  }

  const bypassRlsBlock: string[] = [];
  if (summary.bypassRlsRevoked) {
    bypassRlsBlock.push(
      '【資料庫權限】',
      '🔴 service_role 的 BYPASSRLS 被收掉了。',
      // 🔴🔴 **R3 must-fix 2:那句因果有前提, 而那個前提【正在被拆掉】。**
      //   「被收掉 ⇒ 訂單數 0」只在【那些表還沒補 service_role SELECT policy】時成立,
      //   而 Sean 已拍 Q15=甲要補它們, 別窗今晚就在加。
      //   ⇒ 📌 補完之後「收掉 BYPASSRLS」變成**正確的強化動作**, 而這封信會每天叫、
      //     並宣稱一個不成立的後果 ⇒ **最可能的反應是把那次強化 revert 掉。**
      //   ⇒ ⇒ **一支用來防「壞的強化」的量具, 會去阻止「好的強化」。**
      //   ✅ 所以把【前提】與【它失效的訊號】寫進信裡, 而不是只寫結論。
      '   前提(2026-09-01 唯讀實測):54 張表開了 RLS,其中 45 張還沒有 service_role 的 SELECT 政策',
      '   ⇒ 在那個前提下,後台會【有客戶而每個人訂單數 0】,不是空白。',
      '   🔴 而 ⟦Q15甲⟧ 正在補那些政策 —— **補完之後這一行就過期了,而收掉 BYPASSRLS 會變成對的動作。**',
      '     ⇒ 重新量:docs/probes/2026-08-26-q15-rls-service-role-audit.sql;數字不對就來拆這道閘。',
      '   ⇒ 本告警答的是【那個屬性還在不在】,不答哪些表會安靜回 0,也**不涵蓋別的成因**',
      '     (換掉 admin 憑證 / 新表沒補政策 / 加 restrictive policy 都會造成同一個畫面)。',
    );
  }

  /**
   * ⟦search-LOGSILENTZERO⟧:搜尋日誌那一行。
   * 🔴 **主視窗 2026-09-04 裁①**:進既有這封信、**只在命中時多一行, 不命中零字**。
   *    理由逐字:「②『靠有人去看』= 今天沒有人在看 ⇒ 等於沒做;而這兩格一年出不了幾次,
   *    不會變成每天一封。收件人不是他也沒關係 —— 他是唯一會轉給工程的人。」
   * 🛑 而**兩格都不告訴 Sean 要做什麼** —— 它們是工程要看的 ⇒ 信裡明寫「轉給施工窗」。
   */
  const searchLogBlock: string[] = [];
  if (searchLogFlags.stale) {
    searchLogBlock.push(
      '【搜尋日誌】',
      '🔴 搜尋日誌超過 24 小時沒有新列 —— 客人搜尋的紀錄可能停止寫入了。',
      '   ⇒ 這一格是工程要看的, 請【轉給施工窗】。',
      '   ⚠️ 而它也可能是【真的一天沒有人搜尋】—— 那時候該看的是網站, 不是這支。',
    );
  }
  if (searchLogFlags.anonRevoked) {
    searchLogBlock.push(
      '【搜尋日誌】',
      '🔴 顧客站寫搜尋日誌的那道權限被收掉了(log_search_query 的 anon EXECUTE)。',
      '   ⇒ 這一格是工程要看的, 請【轉給施工窗】。',
      '   ⚠️ 它與上面那行的差別:這一行是【門被關了】, 上面那行是【沒有東西進來】。',
    );
  }

  /**
   * ⟦b4-NEEDSHUMANNOWATCHER⟧ 卡住的匯款單。
   * 🔴 **這一格與上面兩格不同:上面兩格是【工程要看的】, 這一格是【客服要看的】** ——
   *    每一張都對應一個**已經把錢匯出去、而畫面告訴他還沒匯**的客人。
   * 🛑 `count === 0` ⇒ 整段不進信(不命中零字)。
   */
  const stuckBankBlock: string[] = [];
  if (stuckBank.count > 0) {
    stuckBankBlock.push(
      '【匯款單卡住】',
      `🔴 ${stuckBank.count} 張匯款單收到錢了, 而系統算不出該記成哪一種狀態(多匯 / 資料對不起來)。`,
      '   ⇒ 那些客人的訂單頁**仍然顯示「請匯款」+ 銀行帳號** ⇒ 🔴 **他們可能會再匯一次。**',
      '   ⇒ 這一格是**客服要看的** —— 請主動聯絡那幾位客人, 不要等他們打來。',
    );
    if (stuckBank.oldestCreated !== null) {
      stuckBankBlock.push(
        `   ⚠️ 最早那一張是 ${stuckBank.oldestCreated} 建立的 —— 這件事已經積了一段時間。`,
      );
    }
    // 🔵 **這一句刻意寫進信裡**:讀信的人會問「那我要去哪裡找它們」, 而今天沒有那個畫面。
    stuckBankBlock.push(
      '   🛑 而後台目前**沒有一個畫面在列這些單** ⇒ 要查請找施工窗(板列 ⟦b4-NEEDSHUMANNOWATCHER⟧)。',
    );
  }
  /**
   * 🔴🔴 **第二個世界:已付款而多匯**(⟦b4-PAIDTHENOVERPAID⟧, 主視窗 2026-09-05)。
   * 🛑 **與上面那一段【各講各的話】, 不共用文案** —— 那不是排版偏好:
   *    A 的客人**畫面還在叫他匯款** ⇒ 下一步是「趕快聯絡他, 免得他又匯」;
   *    B 的客人**畫面正常** ⇒ 下一步是「我們欠他錢, 要退」。
   *    ⇒ 📌 **合成一句的話, 客服讀完不知道該打哪一種電話。**
   * 🔵 語氣照上面那一段(【標題】+ 一行事實 + 一行「⇒ 下一步」), 不自創格式。
   */
  const stuckBankOverpaidBlock: string[] = [];
  if (stuckBank.overpaidCount > 0) {
    stuckBankOverpaidBlock.push(
      '【匯款單多收了錢】',
      `🔵 ${stuckBank.overpaidCount} 張匯款單**已經記成付款完成**, 而收到的錢**比該收的多**。`,
      '   ⇒ 那些客人的畫面是正常的 —— 🔴 **他們不會知道, 而我們欠他們錢。**',
      '   ⇒ 這一格是**客服要看的** —— 請主動聯絡並安排退款, 不要等他們發現。',
    );
    if (stuckBank.overpaidOldest !== null) {
      stuckBankOverpaidBlock.push(
        `   ⚠️ 最早那一張是 ${stuckBank.overpaidOldest} 建立的 —— 這件事已經積了一段時間。`,
      );
    }
    stuckBankOverpaidBlock.push(
      '   🛑 後台一樣**沒有畫面在列這些單**;而這個數字**可能少報** ——',
      '      它用訂單總額當預篩, 而有退款的單那個總額不會跟著變(板列 ⟦b4-PAIDTHENOVERPAID⟧)。',
    );
  }

  const heartbeatBlock: string[] = [];
  if ((summary.cronHeartbeatAbnormalCount ?? 0) > 0) {
    const names = summary.cronHeartbeatAbnormalJobs ?? [];
    heartbeatBlock.push(
      '【背景排程】',
      `🔴 有 ${summary.cronHeartbeatAbnormalCount} 支背景程式不正常${names.length > 0 ? `:${names.join('、')}` : ''}`,
      // 🛑 文案刻意**不寫「它死了」** —— 這道判準涵蓋五種世界(太久沒成功 / 時間戳在未來 /
      //    連續失敗 / 心跳表沒有那一列 / 有那一列而沒有成功時間), 而它們要查的地方不同。
      //    ⇒ 寫死其中一種會把人送去修錯的東西。
      '   ⇒ 到後台首頁看那一排「幾分沒成功」,它會說是哪一種。',
    );
  }
  /**
   * 🔴🔴 **⟦b9-ENUMWATCH⟧ 片 2:這一行放【body】不放 footer —— R2(換模型)must-fix F1。**
   *
   * ⛔ ~~我原本把它加在 `footer` 陣列裡~~ —— 而那是這一片最貴的一個錯:
   *    `fitToLineBudget` 把**整個 footer 算進預算, 而只 pop `body`**
   *    ⇒ footer 多 ~33 字 ⇒ **截斷時多 pop 掉約 2 行單號**(`  PCM-2026-0104` = 16 字/行)。
   * 🛑 **而 footer 的「不可截」是為了【擋誤退款的警語】爭來的**(見 footer 那段註解)——
   *    **我這一行繼承了那個豁免權, 然後用它擠掉主要內容。**
   * 📌 **⇒ 一個次要觀測拿到了為安全警語爭來的豁免權 ⇒ 那正是「把問題搬到別的層」。**
   * ✅ 放 body 末端 ⇒ **pop 的順序天然是次要先讓路。**
   * 🔵 而截斷路徑是活的(同檔實測 4,594 / 4,585 字, 而測試裡有一格在跑它)⇒ 這不是理論。
   */
  const searchBlock: string[] =
    manualCustomerSearch === null
      ? [
          searchReadFailedForMessage
            ? '(客戶搜尋計數:🔴 讀取失敗 —— 不是沒有人搜尋,也不是還沒上線。這一格要有人去看。)'
            : '(客戶搜尋計數:查不到 —— 那支查詢還沒上線,不是沒有人搜尋)',
        ]
      : [
          // ⟦b9-ENUMWATCH⟧ 片 2:同一個形狀(整點講小時、否則講分鐘)—— 不另發明第二種算法。
          `過去 ${
            manualCustomerSearch.windowSeconds % SECONDS_PER_HOUR === 0
              ? `${manualCustomerSearch.windowSeconds / SECONDS_PER_HOUR} 小時`
              : `${Math.round(manualCustomerSearch.windowSeconds / 60)} 分鐘`
          }客戶搜尋 ${manualCustomerSearch.count} 次,${manualCustomerSearch.actors} 個操作者。`,
        ];
  // 🔴 `bypassRlsBlock` 排在最前面。
  // ⛔ ~~我第一版寫的理由是「權限壞掉時下面每一格的數字都可能是假的」~~ ——
  //    **codex 2026-09-02 nit 打掉, 而它是對的**:本 reader 走的是 `payment_confirmer`,
  //    而那些聚合 RPC 是 `SECURITY DEFINER` ⇒ **它們不依賴 `service_role` 的 BYPASSRLS**
  //    ⇒ 下面那些數字**不會**因為這件事變假。
  // ✅ 真正的理由是**截斷方向**:本檔上面那段逐字寫著截斷是「從尾端整行 pop」
  //    ⇒ 放尾端的最先被丟掉。而「權限被收掉」是這封信裡**最不能被截掉**的一行 ——
  //    它影響的是**後台畫面對員工說的話**, 而那件事沒有第二個訊號會叫。
  // 🛑 **而我第一版建了這個陣列卻【沒有接進來】** —— 訊息區塊建好而沒 join,
  //    `shouldAlert` 照樣 true、信照樣寄、而信裡**一個字都沒有那一塊**。
  //    ⇒ 抓到它的是「信裡要逐字帶【它證不到什麼】」那一發測試。
  //    📌 **一個【建好而沒接上】的東西, 與【沒建】在行為上不同、在 diff 上長得一樣合理。**
  // 🔴 **⟦b4-NEEDSHUMANNOWATCHER⟧ 的第三格就在這一行** —— 算出來了、組成段落了,
  //    而**沒有加進這個陣列的話, 那段永遠不會出現在信裡**, 且測試會全綠。
  //    ⇒ 📌 「算出來了」「寫進信裡了」「會讓信寄出去」是三個宣稱(線【資料】`-db` 2026-09-05
  //      主動告知它上一片就漏了第三個)⇒ 本片三個接點:此處 · shouldAlert · builder 參數。
    // 🔵 2026-09-05 合併:`-db` 的 aclDriftBlock 與 `-mail` 的 stuckBank* 兩邊都留 ——
    //    它們是不同的訊號、不同的觀眾, 誰都不該覆蓋誰。
    const body = [bypassRlsBlock, aclDriftBlock, searchLogBlock, stuckBankBlock, stuckBankOverpaidBlock, emailBlock, heartbeatBlock, ...blocks, searchBlock]
      .filter((b) => b.length > 0)
      .flatMap((b) => [...b, '']);

  /**
   * 🔴🔴 **結尾三行是【不可截的】,而這不是排版偏好。**
   *
   * 我第一版的截斷是「從尾端整行 pop」—— 而**尾端就是這三行**
   * ⇒ 訊息一長,先被丟掉的正好是**網址**與**唯一那句擋著誤退款的警語**
   * ⇒ 🔴 **而它消失的那一天,正是筆數最多、最容易退錯錢的那一天。**
   * ⇒ 這封信唯一的危險動作是**退款**(鐵則 12①),而「先查清楚再退款」是全信唯一擋它的東西。
   * ⇒ ⇒ 所以要截的是**上面那些單號**,不是這三行。**清單少幾行仍然可用;少了警語就不是同一封信。**
   *
   * 📌 抓到它的是 R3 的同儕審查,而**我自己那格測試就在造這封信** ——
   *    它只斷言「截斷發生了」,沒有斷言「截完還是一封完整的信」
   *    ⇒ **每一格都在守實作細節,而沒有一格在守【這封信作為一封信】。**
   */
  const footer = [
    // 🔴 「這幾**筆**」不是「這幾**張單**」:`ids` 全空而 `count > 0` 是本片**刻意設計**
    //    的世界(舊版 RPC / 部署窗口)⇒ 那時信上一個單號都沒有,而「這幾張單」**沒有所指**。
    // 🔴 網址只寫【已驗過的根位址】,**不寫深連結**(例如 `/orders?q=<單號>`)——
    //    那條路徑沒有人驗過,而這是一封每天寄出去的信。沒查證過的東西不寫進去。
    //    值的來源(三層,由弱到強;2026-08-19):①Vercel API 該專案 domains 含此網域
    //    ②該網域的 production 部署 state=READY ③🔴 **Sean 本人在瀏覽器打開並截圖,主視窗親眼看畫面**。
    //    ⚠️ 射程:這證的是**那個網域今天開得起來**,不證它永遠不變。
    // 🔴 「(需登入後台)」五個字不可省 —— 它有登入閘,沒帳號的人點下去會看到登入頁。
    // 🔴🔴 **這一句放【最前面】,不是結尾**(2026-08-21 主視窗裁,而理由有兩個):
    //   ① 它是這封信唯一擋得住誤動作的東西,而**放結尾等於沒有** ——
    //      收信人讀到「不要自己去 TapPay 退款」那一行的時候,還沒讀到它。
    //   ② 🔴 **而更硬的理由是當天查出來的**:2026-08-21 那封信舉的兩筆(`2SQH2P`/`GVRDMH`)
    //      `payment_status=unpaid`、`tappay_rec_trade_id` 與 `paid_at` 皆 null
    //      ⇒ **它們從來沒有刷成功過,沒有錢可以退。**
    //      ⇒ 那封信不只是給了一條危險的捷徑,是**叫人去退一筆從來沒收到過的錢**。
    //      而唯一擋住那件事的,就是這一句。
    // ⚠️ 「上面」指的是 footer 之上的單號清單(body)⇒ 移到 footer 開頭之後,那個指涉仍然成立。
    '⚠️ 上面每一筆都只是「可能」,不是已經確定 —— 先查清楚再動錢。',
    // 🔴🔴 **F-004:上面那句是全稱句,而它對新這一類【是假的】。**
    //    「客人的退款卡住」那幾筆是 `order_refunds` 真的 `status='processing'` 且逾 30 分
    //    (或已有 TapPay 受理證據)⇒ 它們**確定卡住了**,不是「可能」。
    // 🔴 本檔上面已經記過**兩次**「全稱句只對部分類為真」被打回的病史(v1/v2)⇒ 這是第三次。
    //    ⇒ 修法照 `NO_HAND_NOTE` 那個形狀:**不改 Sean 拍板的那句字面**(它有兩格測試釘著,
    //      含一格釘它必須出現在「不要自己去 TapPay 退款」之前),**改成在它後面補一句範圍**。
    // ⚠️ 只在那一類真的有筆數時才出現 —— 否則就是替一封沒有那類的信加一句無所指的話。
    ...((summary.orderRefundsStuckCount ?? 0) > 0
      ? ['   ↳ 但「客人的退款卡住」那一類是已經確定卡住的,不是「可能」。']
      : []),
    'https://admin.pcmmotorsports.com (需登入後台)',
    // 🔴🔴 2026-08-21:上一版寫「看過之後再決定要退款還是【標記免處理】」——
    //    **那兩個動作後台都做不到**,而這封信從 2026-08-09 起每天叫他做一次(C 窗查證、窗 G 複驗):
    //      · 退款(TapPay)  入口不渲染 —— `refund-entry-gate.ts` 的 REFUND_ENTRY_STATUSES
    //        只認 'paid' / 'partiallyRefunded',而本信這一類的單是 unpaid/pending
    //      · 退款(人工)    UI 與 server 兩層都恆關 —— `manual-refund-entry-gate.ts`
    //        `MANUAL_REFUND_ENTRY_BLOCKED_BY_787 = true`(擋渲染、
    //        `lib/payment/manual-refund-actions.ts` 擋 action)
    //        🔴 **2026-08-24(`#806`)更新:這道封印被拿掉過一次,當天又裝回去。**
    //        `#787` 原本的三條解除條件**已全部成立**,而解除之後發現它還擋著一件
    //        三條件一個字都沒提的東西 ⇒ **封印現在押在 `#866`**(缺一道 server 不變式:
    //        退款不得超過該軌淨實收)。⇒ 這一行今天仍然成立,而**它會在 `#866` 落地那天失效**。
    //        ⚠️ **而當天我為它寫過一個錯的理由,留著當反例**:
    //           ~~「本信這一類 `payment_status=unpaid` + `paid_at=null` ⇒ 一列收款都沒有」~~
    //           **推不出來** —— 人工現金/匯款登錄**刻意不碰 `orders.payment_status`**
    //           (`20260810200000:32` 逐字「不碰 orders.payment_status」)
    //           ⇒ 「unpaid、paid_at null、而已經有 cash 收款列」是**存在的形狀**。
    //           📌 形狀:**拿一個欄位去推另一個欄位,而中間那一步沒有人量。**
    //      · 標記免處理      **不存在**(窗 G 用比 C 更寬的 pattern 掃 admin 502 支檔 ⇒ 2 命中,
    //        兩個都是 payment-record-form 的 UI dismissedState、與本題無關;
    //        正對照同法 payment_status 62 / refund 115 ⇒ 尺讀得到東西)
    //      · 連取消訂單也不行 —— `admin_cancel_order` 步7 對「有非 failed 的扣款嘗試」RAISE
    //        (`20260804180000_…_a8a1_admin_cancel_order.sql:200-203`)
    //    ⇒ 🔴 **一封叫人按不存在的按鈕的信,會訓練他不再相信這封信。**
    //      改成只叫他做【做得到的事】,並且**明說後台現在沒有手可以處理它** ——
    //      那句不是免責,它是在阻止他花時間去找一顆不存在的按鈕。
    //    ⚠️ 真正的缺口(不要被文案藏掉)= 系統把單標成「要人工處理」,而人工沒有入口:
    //      正式庫實查 2026-08-21:`mark_charge_attempt_failed` 的 EXECUTE
    //      service_role=false / authenticated=false(ACL 只有 postgres + payment_confirmer)
    //      對照組 `admin_cancel_order` service_role=**true** ⇒ 這把尺分得開,那兩個 false 是真的。
    //      ⇒ 後台(service_role)**叫不動**那支函式。
//      ⇒ **backlog `#808`**「系統把刷卡卡住的單標成『要人工處理』,而【人工】在後台沒有手可以處理它」
//         (`docs/phase-1-backlog.md`,搜 `mark_charge_attempt_failed` 可達)。
//      ⚠️ **這個編號要當場驗,不要相信這一行**(它可能被改號、合併或作廢):
//         `grep -n '^### #808' docs/phase-1-backlog.md` ⇒ 有命中才算數。
//         🔴 前一版這裡寫的是「已開 backlog,見下方 @see」而**沒有編號** ——
//            **沒有編號的承接宣稱,讀起來像已經有人接了,而它可能什麼都不是。**
//            (協作經過寫在 `~/pcm-mailbox/G-c0-告警信改成只叫人做得到的事-20260821.md`,不在 code 裡)
    '請到後台查這幾筆,看清楚是哪張單、客人是誰、金額多少。',
    // 🔴 codex R3 MF-4:這句有【三個世界】要分,而前兩版各誤導成其中一個:
    //    ① 系統故障(功能在,壞了)      ← 第一版「我們的後台做不到」被讀成這個
    //    ② 整套功能不存在                ← 第二版「都還沒做」被讀成這個
    //    ③ **功能在,而【這一筆】不能操作** ← 真相,而它其實是【混合的】:
    //       退款入口存在而這類單的 payment_status 不符 / 人工退款被旗標全域擋住 /
    //       「標記免處理」是真的不存在 / 取消的 RPC 對有非 failed 扣款嘗試的單 RAISE
    //    ⇒ 🔴 所以文案**不能替他歸因**(四條路四個理由),只能講他需要知道的那一件:
    //       **這幾筆在後台動不了,而後台沒有壞。**「還沒有開放處理」同時涵蓋②③而不撒謊。
    // 🔴🔴 2026-08-21 角度①(告警信線)+ Sean 拍板「甲」:**上一版這兩行在說謊,而只對五分之三說謊。**
    //   上一版逐字:「這幾筆單目前在後台【不能操作】(退款、標記免處理、取消都做不了)——
    //                 …不要在後台找按鈕,那會浪費你的時間。」
    //   它是對【刷卡卡在中間 / 訂單付款未成功】那兩類驗過的,而它**印在五類上面**:
    //     · 那兩類 `o.payment_status = 'unpaid'`
    //       (`20260819130000_m3_s2…display_ids.sql:148` / `:162`)
    //       ⇒ 窗 C 頁層渲染實測:`chargeAttemptGate='blocked'` 時整頁 6 顆控制項,
    //         **退款 0 · 人工退款 0 · 標記免處理 0 · 取消 0** ⇒ 這兩類「沒有按鈕」是真的。
    //     · 而「同一位客人、同樣金額買了兩次」那一組 `o1/o2 payment_status` 皆 `'paid'`(同檔 `:189`/`:190`),
    //       而 `REFUND_ENTRY_STATUSES = ['paid','partiallyRefunded']`
    //       (`apps/admin/src/components/orders/refund-entry-gate.ts`,grep `REFUND_ENTRY_STATUSES`)
    //       ⇒ 🔴 **那一類的退款入口【會渲染】。**
    //   ⇒ 錯的方向是最壞的那個:在**客人真的被扣兩次錢**的那一類上,這封信同時關掉了兩條路
    //     (別在後台找按鈕 + 別自己去 TapPay 退)⇒ 錢出去了,而他被說服不要動。
    //
    // 🔴 **為什麼不是寫成一個條件式**(主視窗要的形狀,而我做不到,理由是量到的不是推的):
    //   本 use-case 拿得到的**只有每一類的計數與單號**(`AnomalyAlertSummary`)——
    //   `payment_status` / `chargeAttemptGate` **一個都不在裡面**,reader 走的 SECDEF 聚合 RPC 不回這些。
    //   ⇒ 「那張單此刻退款入口渲不渲染得出來」在這一層**問不到**;要問就要動那支 RPC = 鐵則 12③。
    //   ⇒ 所以改法不是「把謊話加上條件」,是**改成一句在五個世界裡都成立的話**,
    //     並且**把判斷交還給他眼前那一頁**(他本來就要打開那張單才知道是哪一張)。
    //     這同時滿足窗 C 那半的原則:給他一個**當場做得到的測試**,不要給他一個我們替他做的歸因。
    // ⚠️ 文案**待 Sean 逐字定稿**(主視窗 2026-08-21:他會想自己下筆);此版是草稿的落地版本。
    // 🔴 v1/v2 這裡曾經有兩行講「後台不能操作」的話,**兩版都是全稱句、都被證偽**(病史寫在
    //    上面 `blockSpecs` 的檔頭)。v3 我在這裡留了一句「後台沒有壞 —— 上面哪幾類動不了,
    //    那一類自己會講」,而**把成品組出來逐句讀之後把它也刪了**:那句在講這封信自己的結構,
    //    是寫的人的語言;而只有一類異常時它還會變成廢話。⇒ 保證搬進 `NO_HAND_NOTE`,這裡不留。
    // 🔴 這一句**逐字不動**(`先查清楚再退款`):我一度改成「再動錢」,而那會動到守門的期望值。
    //    而它本來就仍然正確 —— 他**在我們後台**退不了,**在 TapPay 自己的後台可以** ⇒ 危險沒有消失。
    // 🔴🔴 2026-08-21 窗 C(`C-eb`)複驗抓到:上一版這裡與上面那句【隔兩行互相矛盾】——
    //    上面寫「不能退款」,這裡寫「先查清楚再退款」。
    //    而「他在我們後台退不了、在 TapPay 後台可以」那個解答**只寫在這個註解裡** ——
    //    🔴 **Sean 讀的是信,不是註解。**
    //    最可能的解讀方向正好是我們要防的:他相信後面那句(有 ⚠️、而且他看過很多次)
    //    ⇒ 得出「還是可以退款,只是要小心」⇒ **他去後台找按鈕** ⇒ 這次改文案要防的事照樣發生。
    //    ⇒ 修法 = 把「在哪裡退得了」放進【信裡】,不要留在註解裡。
    //    ⚠️ 守門是 `toContain('先查清楚再退款')`(`check-anomaly-alerts.test.ts:164` 與 `:282`)
    //       ⇒ **加字不刪字就過得了**;我實查過才動,不是照建議直接改。
    // 🔴🔴 codex R3 MF-5(**這一輪最重的一條**):前一版寫「要退款請在 TapPay 後台操作」——
    //    那是給收信人一條**可以自己走完的捷徑**,而走完的後果是:
    //    TapPay 那邊已退,而 PCM 這邊的訂單狀態【不會跟著更新】⇒ **錢出去了而系統不知道**。
    //    ⚠️ 而那一版**已經真的寄出去過**(2026-08-21)⇒ 修這裡只影響【下一封】,
    //       已經在收信人手上的那一封,這裡改不到。**那一格由主視窗當面跟他講。**
    //    ⇒ 修法方向不是「不准他退」,是**把順序講清楚:先回報,確認過那筆交易之後再一起處理**。
    '⚠️ 請【不要】自己去 TapPay 後台退款。',
    // 🔴🔴 codex R4 MF-3:前一版寫「先回報」—— **而那個接收端不存在。**
    //   2026-08-21 實查:`site-config.ts:26` `CONTACT_EMAIL = 'sean@pcmmotorsports.com'`、
    //   `:24` 電話、`legal-content.ts:46` 客服三管道 —— **三個都是收信人自己**;
    //   站上 contact form / 工單 API 掃描零命中。
    //   ⇒ 🔴 **這封告警的收件人、唯一的操作者、與「客服」,是同一個人。**
    //      「先回報」是叫他回報給他自己。
    //   📌 判別句要拆成兩個:**這個動作他做得到嗎?** 與 **做完之後有人會收到嗎?**
    //      這裡第一個答案是【做得到】(傳訊息),第二個是【沒有人在另一端】——
    //      **只問前一個會通過。**
    //   ⇒ 所以改寫成一個**他一個人就能執行完、而且不需要任何人回應**的動作。
    '   把單號記下來,等這筆的處理方式確認過再動 —— 自己先退,這邊的訂單狀態不會跟著更新。',
    /**
     * 🔴🔴 **Sean 2026-08-24 拍甲**(主視窗轉貼他的原句:
     * 「① 退款告警信要不要列『已判定失敗、按不了任何按鈕』的那幾筆 / 甲(推薦)」)——
     * 那一類**不列進清單**,只在信尾寫這一行。
     *
     * 為什麼是「一行」而不是「一個區塊」:那幾筆是**終態**,後台**零按鈕**
     * (`refund-exceptions/page.tsx` 逐字「這裡沒有可以按的動作」)⇒ 列出來他也做不了事,
     * 而它們**永遠不會自己消失** ⇒ 每天列一次 = `2SQH2P` 叫了 15 天的同一個病。
     * ⇒ 一行的作用是**讓那個差額有解釋**:畫面上看得到而信裡沒有,不是系統壞了。
     *
     * 🔴 **N 是動態值,不是寫死的 4** —— 正式庫 2026-08-24 量到 4,而那是**那一刻**的值。
     * 🔴 **這個計數不進 `shouldAlert`** —— 它只搭已經要寄的那封信的便車。
     */
    ...((summary.orderRefundsManualFailedCount ?? 0) > 0
      ? [`另有 ${summary.orderRefundsManualFailedCount} 筆已判定失敗,不需要你動作。`]
      : []),
  ];
  return { subject, text: fitToLineBudget(subject, body, footer) };
}

export async function checkAnomalyAlerts(
  deps: CheckAnomalyAlertsDeps,
  opts: CheckAnomalyAlertsOptions,
): Promise<CheckAnomalyAlertsResult> {
  // reader throw → 上拋(route catch → 503);無法讀狀態時不推播(不知狀態、fail-closed)。
  const summary = await deps.reader.getAlertSummary(
    opts.refundingStuckSeconds,
    opts.pendingDoubleChargeWindowSeconds,
    opts.pendingDoubleChargeStuckSeconds,
    opts.shippedCutoffIso,
    opts.shippedGraceSeconds,
    opts.orderCreatedCutoffIso,
    opts.orderCreatedStuckMinutes,
  );

  /**
   * ⟦b9-ENUMWATCH⟧ 片 2:第二支 RPC(客戶搜尋計數)。
   *
   * 🔴 **它【不共用】上面那一發的 throw 語意** —— 上面那支 throw ⇒ 整個告警 fail-closed(對的);
   *    而這一支**回 `null` 代表「那支 RPC 還沒 apply」**,那是部署窗口、不是壞掉
   *    ⇒ 落 `Unknown`、**不進 `shouldAlert`**、cron 照常跑完。
   * 🛑 **而它真的壞掉時(連線 / 權限 / 函式體壞掉)adapter 會原封上拋** ⇒ 走上面那條路
   *    ⇒ **「查不到」與「壞掉」在這一層是兩條路,而分開它們的是 adapter 那發 `to_regprocedure`。**
   */
  //
  // 🔴🔴 **必須 catch —— 而我第一版沒有 catch, 那是 codex R1 must-fix 2。**
  //
  // 我在這一片的 plan 裡自己寫過:「為了加一個觀測而弄壞了主要功能, 比不加還糟」。
  // **而我照樣寫出了一個【它 throw 就會把整封告警帶走】的版本。**
  // ⇒ 因為 adapter 那側對「函式體壞掉 / 回應形狀不符」是**刻意 fail-loud** 的(那是對的),
  //   而那個 throw 一路上來就會炸掉 `checkAnomalyAlerts` ⇒ route 回 503
  //   ⇒ **原本該寄的付款告警一封都不會送。**
  //
  // ✅ 正確的分界:**adapter 的 fail-loud 是「不要把壞掉讀成 0」, 不是「壞掉就停掉全部」。**
  //    ⇒ 在**這一層**收口:一個【次要觀測】永遠不得帶走【主要功能】。
  // 🛑 **而它不得變成靜默降級** —— 落 `Unknown` **並且** 印一行可辨識的 log,
  //    而 route 那側要把它算進回應(見 route.ts 那邊的 `manualCustomerSearchUnknown`)。
  // 📌 **⇒ 兩種 Unknown 的成因不同, 而它們在回傳值上是同一格**:
  //    ①那支 RPC 還沒 apply(部署窗口, 預期中)②它真的壞了(要有人看)
  //    ⇒ **所以 log 那一行是唯一分得開它們的東西。**
  let searchSummary:
    | { readonly count: number; readonly actors: number; readonly windowSeconds: number }
    | null = null;
  /** 🔴 R3 must-fix 1:與「還沒 apply」分開 —— 兩者都讓 `searchSummary` 是 null, 而意思相反。 */
  let searchReadFailed = false;
  try {
    searchSummary = await deps.reader.getManualCustomerSearchSummary(
      opts.manualCustomerSearchWindowSeconds,
    );
  } catch (err) {
    searchSummary = null;
    searchReadFailed = true;
    console.error(
      '[anomaly-alert] 🔴 客戶搜尋計數讀取失敗 ⇒ 降級成【查不到】,而其他告警照常送(這一格值得有人去看)',
      // 🔴🔴 **記 `code` 不記 `name` —— R2 must-fix F3。**
      //    ⛔ ~~原本記 `name`~~ ⇒ 逃出 adapter 的錯**永遠**是 `Error` 或
      //       `AnomalyAlertReaderParseError`(未設 `name`)⇒ **`name` 恆為 `'Error'`**
      //       ⇒ **我宣稱「唯一分得開的東西」的那行 log, payload 是一個常數。**
      //    ✅ 而 `sanitizeError` **刻意保留 `code`**:`42501` 權限 / `ECONNREFUSED` 連線 /
      //       parse 失敗時 undefined ⇒ **那一格才真的分得開【怎麼壞的】。**
      {
        reason: 'manual_customer_search_read_failed',
        code: (err as { code?: unknown } | null)?.code,
      },
    );
  }

  // 🔴 搜尋日誌健康度 —— 與上面 `searchSummary` 同款收口:次要觀測不得帶走主要功能。
  let searchLog: {
    readonly tableExists: boolean;
    readonly lastRowAt: string | null;
    readonly anonCanExecute: boolean | null;
  } | null = null;
  /** 🔴 與「還沒 apply」分開 —— 兩者都讓 `searchLog` 是 null, 而下一步不同。 */
  let searchLogReadFailed = false;
  try {
    searchLog = await deps.reader.getSearchLogHealth();
  } catch (err) {
    // 🛑 不得靜默。而 log 之外【還要有一格 result】—— 只靠 log 的話, 把 log 刪掉測試照樣全綠。
    console.error('[anomaly-alert] get_search_log_health 讀取失敗 ⇒ 落 Unknown', {
      reason: 'search_log_health_read_failed',
      code: (err as { code?: unknown } | null)?.code ?? null,
    });
    searchLog = null;
    searchLogReadFailed = true;
  }

  /**
   * 🔴 **信裡那兩格與 result 那兩格用【同一個常數】, 不是各算一次。**
   *   各算一次的話, 有人改了其中一邊 ⇒ 信說「日誌停了」而 result 說沒停,
   *   而**兩邊都不會紅**(那正是本 repo 記過的「兩半各自呼叫同一函式 ≠ 兩半綁在一起」的反面:
   *   這裡是【同一個值】, 所以綁得住)。
   */
  // ── ⟦b4-NEEDSHUMANNOWATCHER⟧ 卡住的匯款單 ──────────────────────────────
  let stuckBank: {
    readonly stuckCount: number;
    readonly oldestCreated: string | null;
    readonly overpaidCount: number;
    readonly overpaidOldest: string | null;
  } | null = null;
  /**
   * 🔴 與「還沒 apply」分開 —— 兩者都讓 `stuckBank` 是 null, 而下一步不同。
   * ✅ 而**分開那一半在 `result` 上**:`stuckBankUnknown`(兩者皆 true)+ `stuckBankFailed`(只有這格)。
   *    ⚠️ 2026-09-05 codex 抓到我原本只有前者 ⇒ **那時這句「分開」是假的。**
   */
  let stuckBankReadFailed = false;
  try {
    stuckBank = await deps.reader.getStuckBankOrdersHealth();
  } catch (err) {
    // 🛑 不得靜默(照 searchLog 那格的成例:只靠 log 的話, 把 log 刪掉測試照樣綠)。
    console.error('[anomaly-alert] get_stuck_bank_orders_health 讀取失敗 ⇒ 落 Unknown', {
      message: err instanceof Error ? err.message : String(err),
    });
    stuckBankReadFailed = true;
  }
  /**
   * 🔴 **信裡那一格與 result 那一格用【同一個常數】, 不是各算一次。**
   *   (照上面 searchLog 那段的理由:各算一次時有人改了一邊, 兩邊都不會紅。)
   */
  const stuckBankCountForMessage = stuckBank?.stuckCount ?? 0;
  const stuckBankOldestForMessage = stuckBank?.oldestCreated ?? null;
  const stuckBankOverpaidCountForMessage = stuckBank?.overpaidCount ?? 0;
  const stuckBankOverpaidOldestForMessage = stuckBank?.overpaidOldest ?? null;
  /**
   * 🔵 `stuckBank` 是 null(沒貼 / 讀失敗)時**不告警** —— 與 anonCanExecute 那格同款。
   * 🔴 **兩個世界【任一】有東西就要告警** —— ⛔ 少了 `||` 那半的話,
   *    「A=0 而 B=3」會安靜地不寄信, 而那三個客人是我們欠他錢的那三個。
   */
  const stuckBankAlertForMessage =
    stuckBankCountForMessage > 0 || stuckBankOverpaidCountForMessage > 0;

  const searchLogStaleForMessage =
    searchLog !== null &&
    searchLog.tableExists &&
    searchLog.lastRowAt !== null &&
    Date.now() - new Date(searchLog.lastRowAt).getTime() > 24 * 60 * 60 * 1000;
  const searchLogAnonRevokedForMessage =
    searchLog?.anonCanExecute === undefined || searchLog?.anonCanExecute === null
      ? null
      : !searchLog.anonCanExecute;

  /**
   * 🔴 **F-004 加了第六項,而它是一個【被明知接受的代價】,不是順手加的。**
   *
   * 加了 `orderRefundsStuckCount > 0` ⇒ 只要有一筆卡住的退款沒被處理掉,
   * 這封信**每天 09:00 都會再寄一次,直到有人處理它**(本 use-case 明文零 per-anomaly 去重)。
   *
   * 為什麼可以接受 —— 而它與 `2SQH2P` 那族**不是同一個病**:
   *   `2SQH2P` 那族  叫的動作【後台做不到】(人工退款入口封印在 `#866`)⇒ 叫 15 天 = 純雜訊
   *   這一族        叫的動作【後台做得到】—— `refund-exception-resolve.tsx` 有兩顆具名按鈕
   *                 (「標記失敗(確認錢未動)」/「恢復結案(登記為已退)」)
   *                 ⇒ 每天催報 = 真的待辦清單,不是狼來了
   * ⇒ 主視窗 2026-08-24 裁定接受;可逆(不同意就改這一個條件)。
   *
   * 🔴 **而 `orderRefundsStuckUnknown` 刻意【不】進這道閘**(codex R2):
   *    DB 一直沒 apply ⇒ 每天寄一封「尚未啟用」⇒ 久了變例行雜訊
   *    ⇒ 那是**把沉默換成無限重寄**,同一個病的另一面。
   *    ⇒ 部署問題走部署管道:route 依 `orderRefundsStuckUnknown` 回 503(監控看得到)。
   */
  const shouldAlert =
    // 🔴🔴 **codex 2026-09-04 must-fix ①:這兩格原本【沒有進 shouldAlert】**
    //    ⇒ 只有搜尋日誌異常時 `shouldAlert` 是 false ⇒ **那封信根本不會寄**
    //    ⇒ 📌 我把那兩行寫進了信的【內容】, 而沒有寫進【要不要寄】
    //      —— 而 `buildAnomalyAlertMessage` 的測試全綠, 因為它只驗「文字對不對」。
    //    🎯 **一片「加了一個告警」的改動, 在它自己的測試底下【完全看不出來它不會叫】。**
    searchLogStaleForMessage ||
    searchLogAnonRevokedForMessage === true ||
    // 🔴🔴 **⟦b4-NEEDSHUMANNOWATCHER⟧ 這一行, 就是 codex 2026-09-04 抓到的那個坑的形狀。**
    //    線【資料】`-db` 2026-09-05 主動告知:它上一片「算出來了、寫進信裡了, 而【忘了加進
    //    shouldAlert】⇒ 那封信只有在別的原因觸發時才會帶上它」。
    //    ⇒ 📌 **「算出來了」「寫進信裡了」「會讓信寄出去」是三個宣稱。**
    stuckBankAlertForMessage ||
    summary.openCount > 0 ||
    summary.refundingStuckCount > 0 ||
    summary.attemptManualReviewCount > 0 ||
    summary.releasedStuckCount > 0 ||
    summary.pendingDoubleChargeCandidateCount > 0 ||
    (summary.orderRefundsStuckCount ?? 0) > 0 ||
    /**
     * 🔴 **寄信這條線的五格**(M-4a;Sean 2026-08-29 拍 `Q-EMAIL-ALERT` = 甲)。
     * `?? 0` 的意思 = **讀不到就不叫** —— 照上面 `orderRefundsStuckUnknown` 那條的成例:
     * 部署問題走部署管道(route 回 503),不變成一封每天寄的信。
     * ⚠️ 而 **`emailQuotaSuspectedCount`(疑似額度 `http_429`)【也】進這道閘。**
     *
     * 🔴 **而我第一版寫的理由是【假的】,codex 2026-08-29 抓到,這裡改成真的**:
     * ~~「漏報的代價是信永久消失」~~ —— **不對。** `IEmailOutbox.ts` 的 `http_429` JSDoc 逐字:
     * 「若該 429 實際只是**瞬時限流**…該封信**白等約 24h** 才重試(**信仍會寄出、不會消失**)」
     * ⇒ **瞬時限流的代價是【延遲】,不是【消失】。** 拿「會消失」當理由 = 用一個更嚇人的
     *   後果去支持一個對的決定,**而下一個人會照那個假前提去做別的判斷。**
     *
     * ✅ **真正的理由(而它仍然足夠)**:同一份 JSDoc 逐字寫著 429 body 是否含 `name`
     * **兩官方 SDK 不一致、標為未確認** ⇒ **在那個世界裡,真正的額度耗盡就長成 `http_429`**。
     * ⇒ 也就是說:它不是「可能只是限流」,是**「可能就是確診,只是碼認不出來」**。
     * ⇒ 而誤報的代價 = 一封本來就會寄的信上多一行「可能是額度」。**取寬的。**
     * 📌 **而它在信上用的是【不同的文案】,不與確診混講** —— 那一格才是防「把未知報成確診」的。
     *
     * 🔴🔴 **未解:`§⑨` 要求的「冷卻/去重」【本片沒有做】,而我不假裝它被解掉了。**
     * (codex 2026-08-29 判 must-fix,而我同意它未解,只是把**曝險量出來**。)
     * ```
     * 排程   pcm-anomaly-alert = `0 1 * * *`（一天一次）
     *        ⇒ 一個【持續存在】的額度問題，每天會叫一次，直到有人處理
     * ⚠️ 而「一天一次」不是硬上限：這支 route 持有 CRON_SECRET 的人可以手動重打，
     *    而 `checkCronRateLimit` 自己的註解逐字寫著它是 **per-instance best-effort、非全域硬上限**
     * ```
     * 📌 **⇒ 曝險的正確說法是:【排程】一天一次,而【這支 route】不是一天只能被打一次。**
     * 🔴 **而我不在這裡加一個冷卻** —— 理由不是它不重要,是**「該不該冷卻、冷卻多久」是營運決定**:
     *    一個持續一整個月的月額度耗盡,每天提醒一次**可能正是對的**(它還沒被處理);
     *    而把述詞改窄會讓它在**問題還在**的時候安靜下來。
     *    ⇒ 要的是一顆「我知道了、N 天內別再說」的**靜音鈕**,~~而那顆鈕的存在與天數**是 Sean 的**~~。
     *
     * 🔵🔵 **2026-08-30 已拍板,這一格不再是待答題:Sean `Q3 靜音鈕 = 乙`,逐字「不做,就讓它一直提醒」。**
     *   出處 ⛔ ~~`~/pcm-mailbox/等Sean決策-20260829.md:3538`~~(2026-08-30 上午一口氣回六題那一批;
     *   題目來源 `~/pcm-mailbox/de-b9-等決策表18格triage-剩6題-20260830.md` 的 `Q-靜音鈕`)。
     *   🔴 **2026-09-02 05:2x 座標訂正(`-f3` 發現、`-c7` 開檔複核;舊字面加刪除線留著)**:
     *      `:3538` **指到的是另一題**(`Q-VISUAL`/OD 那一題)⇒ 照它跳過去的人會讀到不相干的內容。
     *      ✅ **正確的兩個座標(`-c7` 當場 `sed -n` 各印一次)**:
     *        · **題目** `等Sean決策-20260829.md:2980` ⇒ 逐字「**額度類**的告警現在會【每天】提醒你…」
     *          🔴 **那三個字就是本段射程的全部依據** —— 見下方 09-02 那一節。
     *        · **答案** 同檔 `:3573` ⇒ 逐字「`Q3 靜音鈕  乙  不做,就讓它一直提醒`」
     *      🟢 負對照:全檔 `靜音鈕` 只有 4 處(`:2980` `:2981` `:3573` `:3593`)⇒ `:3538` 一處都不是。
     *      📌 **⇒ 而 `:3538` 那一段自己在講的正是【兩題相鄰、轉述時被併成一個】** ——
     *        **一個壞掉的行號,指到了一段在描述同一種病的文字。**
     *   🔴 **他選的是【推薦的反面】** —— 推薦是甲(做鈕、預設 7 天),他選乙。
     *      而題目裡逐字寫著「會**每天**提醒你,一直提醒到有人處理為止」
     *      ⇒ **他看過那一句才選的 ⇒ 那是【接受成本】,不是【沒看到】。**
     *   🛑 **⇒ 兩件事不要做**:①不要再拿這一格去問他 ②不要有人「順手把鈕做出來」——
     *      做了就是推翻他的拍板,**而那在 diff 上會長得像一個貼心的補強。**
     *
     * 🔴🔴 **2026-09-02 05:1x 就地訂正(`-c7` 開兩份原文核;零刪除,上面一個字都沒改)**
     *   **上面那個「不要做」【射程只有「額度類」】,而它寫在一個管【五個訊號】的地方。**
     *   ```
     *   08-30 那一題逐字(de-b9-…-剩6題-20260830.md:99):
     *     「Q: **額度類**的告警現在會【每天】提醒你…要不要做一顆靜音鈕?」  ⇒ 他答【乙 不做】
     *   09-02 00:43 Q2 逐字(拍板-20260902-06題.md:20):
     *     「Q2 ⇒ 丙 · **死信**:靜音【與】重排都做」                        ⇒ 他答【丙 都做】
     *   ```
     *   🟢 **⇒ 那是【兩個不同的告警】,兩筆拍板【同時成立】,沒有誰推翻誰。**
     *      而本段緊接的 `shouldAlert` 是 `emailDeadLetterCount` 與 `emailQuota*Count` 五格【或】起來的
     *      ⇒ 📌 **一筆「額度類」的拍板,被記在一個【死信也適用】的位置上。**
     *   🛑 **⇒ 所以危害是真的**:今天要做死信靜音的人讀到「②不要有人順手把鈕做出來」
     *      **會停手,而且不會去查** —— 因為那句話的語氣是【禁止】,不是【參考】。
     *      **⇒ 而他會拒絕做 Sean 三小時前才要求的東西。**
     *   ✅ **⇒ 正確的讀法**:
     *      · **額度類**(`emailQuota*`)⇒ **不做靜音鈕**(08-30 乙,仍然有效,不要動它)
     *      · **死信**(`emailDeadLetterCount`)⇒ **靜音與重排都要做**(09-02 丙)
     *   🔴 **⇒ 而【一顆管全部五格的通用靜音鈕】仍然違反 08-30 那一板** —— 要做就只能是死信那一格。
     *   ⚠️ **分母**:`-c7` 只比了這兩筆;**09-02 00:43 之後有沒有第三筆,我沒有查**(`-f3` 同標)。
     *   🔵 **⇒ 而本訂正【與 `-0a`/`-f3` 的判斷不同】,留在這裡讓下一個人自己核**:
     *      它們判「08-30 已被推翻 ⇒ 整段劃掉」;**而劃掉會讓通用靜音鈕變成看起來合法的。**
     *      **⇒ 分歧點只有一句:那兩個「靜音」是不是同一顆鈕。⇒ 兩份題目原文說【不是】。**
     *   🎯 **⇒ 而這一格自己是母題的最尖版本**:
     *      **一段【為了保護拍板】而寫的註解,因為射程沒寫,自己變成了擋住另一筆拍板的東西。**
     *      **⇒ 而修法不是刪掉它,是【把它的射程寫出來】—— 刪掉會弄丟一筆仍然有效的拍板。**
     *
     *   📌 **為什麼要改這段註解(而不是只在板子上記一筆)**:上面那句「是 Sean 的」
     *      **就是把人推去問他的那句話** —— 拍板落在板子上而碼裡還在等,
     *      下一個讀到這裡的人會【第二次】去問一個他已經答過的問題。
     *
     * ⇒ ⛔ 以下是**拍板之前**的追蹤紀錄,**原句留著不改**(讓搜舊字面的人撞到上面那一段):
     *   ~~這一格已列在 `~/pcm-mailbox/等Sean決策-20260829.md`~~
     *   🔴 **2026-08-29 R3 查:板上【查無】**(可能被壓縮掉,或從未寫入)——
     *      而那句話的危害是:**讀的人以為有人在追,於是不追**(當晚同型第三例)。
     *   ✅ **已重排,而落點是【驗過的】**:`~/pcm-mailbox/R3-分堆-14題三堆-20260829.md` **乙6**
     *      (推薦 = 做鈕、預設 7 天),而它已進 `~/pcm-mailbox/等Sean決策-20260829.md`
     *      —— 線A `-e9` 2026-08-29 23:5x 改字前自己查過:
     *      該板「靜音」⇒ 3 / 「知道了」⇒ 2 / 「別再說」⇒ 1(而 R3 查時這四個字全 0)。
     *   ⚠️ ~~本片仍然刻意留白,不自行決定。~~ ⇒ **已由上面 2026-08-30 那一板取代。**
     */
    (summary.emailOverdueCount ?? 0) > 0 ||
    (summary.emailDeadLetterCount ?? 0) > 0 ||
    (summary.emailStuckSendingCount ?? 0) > 0 ||
    (summary.emailQuotaConfirmedCount ?? 0) > 0 ||
    (summary.emailQuotaSuspectedCount ?? 0) > 0 ||
    // 🔴🔴 **分母那一格**(2026-08-31;Sean 逐字答 `3 甲`;板上錨 `⟦b4-EMAILTOTAL⟧`)
    //   **五格全 0 【而且】分母也 0 ⇒ 也叫一次。**
    //   📌 **為什麼**:上面五個 count 全部 `FROM public.email_outbox` ⇒ 只數【已經存在的列】
    //     ⇒ 「一切正常」與「這張表是空的 / 讀不到資料」**印同一組 0**。
    //   ⚠️ **而只把分母接進來、不改這道閘是【不夠的】**:這道閘是「任一 > 0 才叫」
    //     ⇒ 五格全 0 ⇒ **一封信都不會發** ⇒ 那個分母**在它要防的那個世界裡沒有人看得到**。
    //   🔵 **它會自己安靜下來**:只要寄出過一封, `total_count` 就 > 0
    //     ⇒ 上線初期會叫幾天, 而那幾天**本來就沒有人在等信**。
    //   🔴🔴 **[2026-08-31 codex R1 訂正 —— 而它訂正的是我寫下的理由]**
    //     ⛔ ~~理由:「那張表不刪列」~~ **那句是假的。**
    //     `docs/specs/2026-07-18-b0-order-notification-email-prd.md` 的 PII 生命週期表逐字:
    //     `email_outbox.recipient_email` 保留 **120 天**(Sean 2026-07-18 拍板), 而**清理 job(#281)刪除逾期列**。
    //     ⇒ ✅ **結論不變**(活著的店天天寄信 ⇒ 表不會空), **而理由要換**:
    //       它安靜下來靠的是**持續有信在寄**, 不是**列不會被刪**。
    //     ⇒ 🔴 **⇒ 而那個差別在【店停業 120 天以上】那個世界會顯形:那時它會【再叫一次】,**
    //       **而那一次沒有人會記得為什麼。**⇒ 訊息那一行因此寫「可能是這張表是空的」——
    //       **那句話在那個世界裡仍然是對的。**
    //     📌 **⇒ 一個對的結論配一個錯的理由, 在今天印同一個結果 —— 而它們在【未來的某個世界】分岔。**
    //   🛑 **`emailOutboxUnknown` 必須排除**:那是「函式不存在」= 部署問題, 走 503 那條路;
    //     而它會讓五個 count 全是 `null` ⇒ `?? 0` 之後長得與「真的全 0」一模一樣。
    //     ⇒ 📌 **兩個不同的世界, 在 `?? 0` 之後印同一組 0 —— 那正是本片要防的形狀本身。**
    isEmailOutboxSilentlyEmpty(summary) ||
    // 🔵 出貨信缺口(2026-08-31;Sean 逐字答 `2 甲`:「大於 0 就叫」)。
    //   🛑 `?? 0` 在這裡是安全的:unknown 那條路 adapter 回 `null` ⇒ 不叫,
    //     而那是刻意的 —— **部署問題 / 還沒上膛走別的管道, 不變成一封每天寄的信。**
    (summary.shippedNeverEnqueuedCount ?? 0) > 0 ||
    (summary.shippedUnsendableCount ?? 0) > 0 ||
    /**
     * 🔵 **訊號 4(2026-08-31;Sean 拍 5️⃣ 甲「有一封就叫 —— 最吵但不漏」)。**
     *
     * 🛑🛑 **只有 `noRecipient` 進來,`paidNoEmail` 【刻意不進】。**
     *   scanner 每 5 分鐘掃「已付款而沒有信」的單, **然後當輪就把它們排進去**
     *   ⇒ `paidNoEmail > 0` 是【正常】的 ⇒ 📌 **拿它當判準 = 有生意就叫,那不是告警。**
     * ✅ 而 `noRecipient`(兩個信箱都空)**不會自己好** —— 那張單沒有信箱,下一輪也一樣
     *   ⇒ **叫一次就是一件真的待辦**, 所以「一封就叫」套在這一格上不會變噪音。
     * 🛑 `?? 0` 在這裡是安全的:unknown 那條路 adapter 回 `null` ⇒ 不叫,
     *   而那是刻意的 —— **RPC 還沒 apply / 起始線沒設走別的管道, 不變成一封每天寄的信。**
     */
    (summary.orderCreatedNoRecipientCount ?? 0) > 0 ||
    /**
     * 🔵 **未付款取消信線的同一格**(⟦b4-NORECIPIENTWINDOW⟧)。理由與上面那格逐字相同:
     *   那張單沒有信箱 ⇒ **它不會自己好** ⇒ 叫一次就是一件真的待辦。
     * 🛑 `?? 0` 在這裡同樣是安全的:cutoff 沒設 / RPC 還沒 apply ⇒ adapter 回 `null` ⇒ 不叫。
     */
    (summary.unpaidCancelledNoRecipientCount ?? 0) > 0 ||
    /**
     * 🔵 第四條線(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-04)。
     * 🛑 `pending` **刻意不進** —— 與姊妹線同一個理由:它 >0 是正常的。
     * 🔴 而 `unknown` 也不進:「讀不到」由 route 印出來, 不由這裡叫。
     */
    (summary.trackingCorrectedNoRecipientCount ?? 0) > 0 ||
    /**
     * 🔴🔴 **訊號4 的【持續失敗】那一格(板 `⟦b4-SIG4ERRORS⟧`)**。
     * 🛑 它與上面 `paidNoEmail` 的差別是【年齡】, 而那個差別就是它能不能當判準:
     *   `paidNoEmail > 0` 是正常的(新單進來就被數到一次, 下一輪 scanner 就排掉)
     *   ⇒ 拿它當判準 = **有生意就叫**, 那不是告警。
     * ✅ 而 `stuck` 是【超過門檻分鐘還沒被建出來】⇒ 正常的單活不過一輪 ⇒ > 0 就是真卡住。
     * 🔴 它守的是一個今天【零告警】的缺口:enqueue 每一輪都失敗時, 那個 `errors`
     *   只落在 cron 的回應 body、沒有進任何表 ⇒ **當下不會叫, 而且事後查不到。**
     * ⚠️ 已排除【兩個信箱都空】那一群 ⇒ 同一張單不會被兩個訊號各叫一次。
     * 🛑 `?? 0` 安全:沒上膛 / RPC 未 apply ⇒ adapter 回 `null` ⇒ **不叫**(走別的管道)。
     */
    (summary.orderCreatedStuckCount ?? 0) > 0 ||
    /**
     * 🔴🔴 **排程心跳(板 `⟦b4-SWEEPDEAD1⟧` 片3;Sean 2026-08-30 拍 `q4: 甲` = 現在做)**。
     * 那一列的問題逐字是「**結算程式死了沒人知道**」—— 而在這一行之前,
     * 心跳**只被儀表板顯示、從來沒有被告警**:
     *   儀表板 = 有人去看的時候它告訴他;告警 = 沒有人去看的時候它來告訴你。
     *   ⇒ 而那一列問的是後者。**這一行就是那一列缺的東西。**
     *
     * `?? 0` = **讀不到就不叫**,照上面每一條的成例(部署問題走部署管道)。
     * ⇒ 🛑 `cronHeartbeatUnknown` **刻意不在這道閘裡** —— 它只進 log 與信尾那一行。
     *
     * ⚠️ **而本片【不關】的那一半要寫在這裡, 免得下一個人以為關掉了**:
     *   **「整組 cron 一起死」這一格照舊沒有人看得到** ——
     *   這支告警器自己也是一支 cron(`pcm-anomaly-alert`), 它與它要監控的那五支
     *   **走同一條線**, 那條線壞掉兩個一起停 ⇒ **沒有人會收到任何信。**
     *   📌 ⇒ 本行關掉的是「**單支**死掉沒人知道」, 不是「整組一起死」。
     *
     * 🛑 **沒有冷卻機制, 而那是【接受】不是【漏】**(codex 2026-08-31 片3 R1 #5 提):
     *   一支排程持續死著 ⇒ **每天都會再寄一次**(這封信一天一班)。
     *   ⇒ 而本檔上面對 `emailQuotaConfirmedCount` 已經寫過同一句話並被 Sean 拍過:
     *     **「一個持續一整個月的問題, 每天提醒一次可能正是對的 —— 它還沒被處理。」**
     *   ⇒ 📌 一支排程死了三天而第二天起不再提醒, 與「它自己好了」在收件匣裡長得一樣。
     *   ⚠️ **若哪天要加冷卻**, 要先答一個問題:**停止提醒之後, 誰會發現它還死著?**
     */
    (summary.cronHeartbeatAbnormalCount ?? 0) > 0 ||
    // ⟦b9-RLSHARDEN⟧ 甲:**只有明確的 `true` 才進**。`bypassRlsUnknown` 不在這道閘裡。
    // 🛑 **而「所以它不吵 Sean」是【錯的】(R3 must-fix 1)** ——
    //   Unknown ⇒ route 回 503 前先記一次心跳失敗 ⇒ 連續失敗到門檻之後
    //   `cronHeartbeatAbnormalCount` 會亮 ⇒ **那一格【就在上面這道閘裡】** ⇒ 照樣寄信。
    // ✅ 正確的說法:**它不會【直接】寄信;而它持續量不到時會【經由心跳那條路】寄。**
    //   📌 而那其實是對的行為(一支一直失敗的 cron 本來就該被看見)——
    //     錯的是我原本那句話, 不是這個耦合。
      summary.bypassRlsRevoked ||
      // ⟦b9-ACLDRIFT5⟧ 片二:**只有明確的 `true` 才進**(與上面同一個形狀、同一個理由)。
      // 🔴 而「已批准」在 adapter 那一層就讓 Detected 回 false —— **那不是消音**:
      //   批准是一個人簽下「那是我貼板造成的」。少了它, 貼板當天之後會【每天寄一封
      //   一模一樣的信】, 而那種信會被整批忽略 ⇒ 連真的那一封也一起。
      summary.aclDriftDetected === true;

  let notifiersTotal = 0;
  let notifiersFailed = 0;

  if (shouldAlert) {
    // 🔴 fail-closed 縱深(關卡2 codex MED):踩門檻卻零 notifier = 告警無處可送 = 沉默故障 → 上拋(route 503、可見)。
    //    live path 由 composition getAnomalyAlertDeps「enabled 但零管道 throw」先擋;此為 use-case 端第二道防線
    //    (防未來其他 composition / 測試替身直接注入空陣列時偽 200)。
    if (deps.notifiers.length === 0) {
      throw new Error('checkAnomalyAlerts:踩告警門檻但未注入任何 notifier(告警無法送達、fail-closed)');
    }
    const message = buildAnomalyAlertMessage(
      summary,
      opts.refundingStuckSeconds,
      // 🔴 直接傳 adapter 回的那個物件 —— **不再由這一層拼一個 windowSeconds 上去**(R3 must-fix 2)。
      searchSummary,
      searchReadFailed,
      // 🔴 只把【兩個 boolean】傳進去 —— 信裡不需要 lastRowAt 那種細節,
      //    而把 null 留在 result 那一層(值班的人看 cron 回應才需要它)。
      {
        stale: searchLogStaleForMessage,
        anonRevoked: searchLogAnonRevokedForMessage === true,
      },
      // 🔴 ⟦b4-NEEDSHUMANNOWATCHER⟧ —— **不命中時零字**(count=0 ⇒ builder 不印那一行)。
      //    🔵 帶 `oldestCreated` 是刻意的:讓讀信的人知道**積了多久**, 而不只是「有幾張」。
      //    🛑 **零 PII、零金額、零單號** —— 帶不帶單號照 2026-08-19 Sean 本人那次的口徑
      //      (他為了查得到而打開了單號)⇒ **要帶要再問他一次, 不由我決定。**
      {
        count: stuckBankCountForMessage,
        oldestCreated: stuckBankOldestForMessage,
        overpaidCount: stuckBankOverpaidCountForMessage,
        overpaidOldest: stuckBankOverpaidOldestForMessage,
      },
    );
    notifiersTotal = deps.notifiers.length;
    // 🔴 **這一行講的是【送】那個階段**:各管道各自送、一管道掛掉不影響另一管道
    //    (`Promise.allSettled`);失敗計數 → route 503(壞掉的管道必須可見)。
    // ⚠️ **它【不】涵蓋【建構】那個階段** —— 那在 `apps/storefront/src/lib/payment/composition.ts`。
    //    🔴 2026-08-21 之前那裡是**串聯**的:LINE 少一個 env ⇒ 整個 factory throw ⇒ Email 也建不起來。
    //    而**本行這句沒有錯,它只涵蓋兩個階段中的一個** —— 而它讓連續兩輪審查以為這一格已經被想過了。
    //    ⇒ 📌 **一句正確而範圍不足的註解,會關掉下一個人的檢查動作。**(codex R3 MF-2)
    const results = await Promise.allSettled(deps.notifiers.map((n) => n.notify(message)));
    notifiersFailed = results.filter((r) => r.status === 'rejected').length;
    // 🔴🔴 **已知缺口(codex R3 MF-3):兩個管道【都】掛掉的那一天,沒有人會知道。**
    //    現況:失敗只變成 `notifiersFailed` → route 回 503 → 進 `net._http_response`,
    //    而那張表**只保留約 6 小時**(2026-08-21 實測 253 列 / 21:16→03:15 UTC)
    //    ⇒ 本 job 一天只跑一次(`0 1 * * *`)⇒ **隔天再查就沒有證據了。**
    //
    // ⚠️ **本片刻意不在這裡補一個落點,而那是判斷不是遺漏**:
    //    任何「記下來」的做法都需要能寫東西 —— 而 2026-08-21 正式庫實查:
    //      payment_confirmer 在 public 底下【可寫入 0 張表】(分母 50)
    //      對照組:postgres 50/50、service_role 20/50、anon 0/50 ⇒ 這把尺分得開
    //    ⇒ 要落點就要 GRANT 或新表 = 鐵則 12③ = **另一片,不是這一片**。
    //    🔴 而在這裡塞一個半成品**會更糟,因為它看起來像機制** ——
    //       下一個人會以為這一格被守住了。
    //
    // ✅ **這一片對這個缺口做的事,是把它放進一個【明天會被打開】的地方**:
    //    `~/pcm-mailbox/G-c0-9b-明天0900管道標記驗收單-20260822.md`
    //    逐字:「**若某天完全沒收到信,不要讀成『沒有異常』**」
    //    🔴 理由:災難日的問題不是「系統沒記錄」,是**沒有人會去找** ——
    //       而『沒收到信』與『今天沒有異常』在收件匣裡是同一個畫面。
    //    ⇒ 一張沒有人查的表解決不了它;一句寫在有人會打開的單子上的話可以。
  }

  return {
    alerted: shouldAlert,
    openCount: summary.openCount,
    refundingCount: summary.refundingCount,
    refundingStuckCount: summary.refundingStuckCount,
    attemptManualReviewCount: summary.attemptManualReviewCount,
    releasedStuckCount: summary.releasedStuckCount,
    pendingDoubleChargeCandidateCount: summary.pendingDoubleChargeCandidateCount,
    orderRefundsStuckCount: summary.orderRefundsStuckCount,
    orderRefundsStuckOvernightCount: summary.orderRefundsStuckOvernightCount,
    orderRefundsManualFailedCount: summary.orderRefundsManualFailedCount,
    manualCustomerSearchCount: searchSummary?.count ?? null,
    manualCustomerSearchActors: searchSummary?.actors ?? null,
    searchLogUnknown: searchLog === null,
    searchLogFailed: searchLogReadFailed,
    searchLogTableExists: searchLog?.tableExists ?? null,
    searchLogLastRowAt: searchLog?.lastRowAt ?? null,
    // 🔴 只有【表在 + 有過列 + 最後一列超過 24h】才算 stale。
    //    表不在 ⇒ false(還沒貼)· 有表沒列 ⇒ false(還沒開始收)—— 兩者都不是異常。
    searchLogStale: searchLogStaleForMessage,
    stuckBankCount: stuckBankCountForMessage,
    stuckBankOldestCreated: stuckBankOldestForMessage,
    stuckBankOverpaidCount: stuckBankOverpaidCountForMessage,
    stuckBankOverpaidOldest: stuckBankOverpaidOldestForMessage,
    // 🔴 兩種成因都算 Unknown:那支 RPC 還沒貼(回 null)· 讀的時候丟例外(readFailed)
    //    ⇒ 📌 而它們與「真的 0 張」在 `stuckBankCount` 上【都印 0】—— 這一欄就是把它們分開的那一格。
    stuckBankUnknown: stuckBank === null || stuckBankReadFailed,
    stuckBankFailed: stuckBankReadFailed,
    // 🔴 極性翻過來:true = 那道門被關掉了(要看)· null = 函式還沒貼(不看)
    searchLogAnonExecuteRevoked: searchLogAnonRevokedForMessage,
    manualCustomerSearchUnknown: searchSummary === null,
    manualCustomerSearchFailed: searchReadFailed,
    orderRefundsStuckUnknown: summary.orderRefundsStuckUnknown,
    shippedNeverEnqueuedCount: summary.shippedNeverEnqueuedCount,
    shippedUnsendableCount: summary.shippedUnsendableCount,
    shipmentsTotalCount: summary.shipmentsTotalCount,
    shippedGapUnknown: summary.shippedGapUnknown,
    orderCreatedPaidNoEmailCount: summary.orderCreatedPaidNoEmailCount,
    // 🔵 訊號4 持續失敗那三格也要進 result —— 否則信裡印了而 cron log/body 上這件事不存在,
    //   ⇒ 事後對不了帳(code-reviewer 2026-09-01 抓)。
    orderCreatedStuckCount: summary.orderCreatedStuckCount,
    orderCreatedStuckOldestMinutes: summary.orderCreatedStuckOldestMinutes,
    orderCreatedStuckUnknown: summary.orderCreatedStuckUnknown,
    orderCreatedNoRecipientCount: summary.orderCreatedNoRecipientCount,
    unpaidCancelledPendingCount: summary.unpaidCancelledPendingCount,
    unpaidCancelledNoRecipientCount: summary.unpaidCancelledNoRecipientCount,
    // 🔴 **三格都要進 result** —— `gapUnknown` 尤其:
    //    「這一段安靜」與「這一段讀不到」在 route 的回應上必須分得開(姊妹線同款)。
    trackingCorrectedPendingCount: summary.trackingCorrectedPendingCount,
    trackingCorrectedNoRecipientCount: summary.trackingCorrectedNoRecipientCount,
    trackingCorrectedGapUnknown: summary.trackingCorrectedGapUnknown,
    // 🔴 **它必須出得去** —— 沒有這一格, adapter 的 fail-closed 在下游就被 `?? 0` 拆掉了
    //   ⇒ 而「安靜」與「這道告警根本沒裝上」會印同一個畫面。
    unpaidCancelledGapUnknown: summary.unpaidCancelledGapUnknown,
    orderCreatedGapUnknown: summary.orderCreatedGapUnknown,
    cronHeartbeatAbnormalCount: summary.cronHeartbeatAbnormalCount,
    cronHeartbeatAbnormalJobs: summary.cronHeartbeatAbnormalJobs,
    cronHeartbeatUnknown: summary.cronHeartbeatUnknown,
    // ⟦b9-RLSHARDEN⟧ 甲:兩個都要帶出來 —— `Unknown` 不帶出去 ⇒ route 讀不到 ⇒
    //   **那條「部署問題走部署管道」的路就不存在**(下面那段註解講的正是同一個坑)。
    bypassRlsRevoked: summary.bypassRlsRevoked,
    bypassRlsUnknown: summary.bypassRlsUnknown,
      // ⟦b9-ACLDRIFT5⟧:兩個都要帶出去 —— `Unknown` 不帶 ⇒ route 讀不到 ⇒ 503 那條路不存在。
      aclDriftDetected: summary.aclDriftDetected,
      aclDriftUnknown: summary.aclDriftUnknown,
      aclDriftFamilies: summary.aclDriftFamilies,
      aclDriftTakenAt: summary.aclDriftTakenAt,
    bypassRlsPrivilegedCount: summary.bypassRlsPrivilegedCount,
    bypassRlsTotalRoleCount: summary.bypassRlsTotalRoleCount,
    /**
     * 🔴 **這一行是本片【最重要】的一行,而我差點沒寫。**
     * 上面把五格排除在 `shouldAlert` 之外,理由是「部署問題走部署管道」——
     * **而那個管道要真的存在。** 退款那組有(route 依 `orderRefundsStuckUnknown` 回 503),
     * 而我第一版**沒有把這個旗標帶出來** ⇒ route 讀不到 ⇒
     * 🔴 **RPC 一直沒 apply ⇒ 這片完全沉默,而沒有任何人知道** —— 正是它要治的那個病。
     * 📌 **「我把它排除在告警之外」與「我把它交給了另一條路」是兩件事,而只有後者需要那條路存在。**
     */
    emailOutboxUnknown: summary.emailOutboxUnknown,
    emailOverdueCount: summary.emailOverdueCount,
    emailDeadLetterCount: summary.emailDeadLetterCount,
    emailStuckSendingCount: summary.emailStuckSendingCount,
    emailQuotaConfirmedCount: summary.emailQuotaConfirmedCount,
    emailQuotaSuspectedCount: summary.emailQuotaSuspectedCount,
    oldestOpenAgeSeconds: summary.oldestOpenAgeSeconds,
    notifiersTotal,
    notifiersFailed,
    errors: notifiersFailed,
  };
}
