/**
 * IAnomalyAlertReader:雙扣 anomaly 告警聚合讀 port(M-3 #250)。
 *
 * 🔴 **server-only payment_confirmer 受控窗**:實作(`PgAnomalyAlertReaderAdapter`)走 payment_confirmer
 * 窄權連線呼 owner-defined SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(p_refunding_stuck_seconds,
 * p_pending_dc_window_seconds, p_pending_dc_stuck_seconds)`(SECDEF、`search_path=''`;#250 六計數 + #256 第 7
 * 計數 pending 雙扣候選)。payment_confirmer 對 anomaly 兩表 / attempts / orders 零表權 → 只能經此 SECDEF
 * 受控窗讀 **零 PII 計數**(不下放任何 amount/user/order/rec)。
 *
 * 回傳 / 例外:成功 → `AnomalyAlertSummary`(計數);**transport / 回應形狀不符 → throw**
 * (use-case 不吞、上拋至 cron route → 503 fail-closed,壞掉的告警必須可見)。
 */
import type { AnomalyAlertSummary } from '@pcm/domain';

export interface IAnomalyAlertReader {
  /**
   * 讀雙扣 anomaly + 死卡列 + pending 雙扣候選零 PII 計數摘要。
   * @param refundingStuckSeconds refunding 卡住門檻秒數(route 常數注入、營運參數非 SLA)。
   * @param pendingDcWindowSeconds #256 pending 雙扣候選:兩 paid 單 paid_at 差窗秒數(route 常數、預設 12h)。
   * @param pendingDcStuckSeconds #256 卡住指紋門檻秒數(charged attempt updated_at-created_at 逾此才算卡住;route 常數、預設 10min)。
   */
  getAlertSummary(
    refundingStuckSeconds: number,
    pendingDcWindowSeconds: number,
    pendingDcStuckSeconds: number,
    /**
     * 🔵 出貨信起始線(ISO 8601 UTC;對應 env `SHIPPED_EMAIL_CUTOFF`;2026-08-31 Sean `2 甲`)。
     * 🛑 **`null` = 那一段整段不查** —— 而那不是失敗, 是「還沒上膛」;
     *   實作要落 `shippedGapUnknown`, **不得寫成 0**。
     */
    shippedCutoffIso: string | null,
    /** 🔵 出貨信寬限秒數(Sean `2 甲` = 15 分鐘 = 3 次掃描;呼叫端常數注入、無 DEFAULT)。 */
    shippedGraceSeconds: number,
    /**
     * 🔵 訊號 4 的起始線(ISO 8601 UTC;env `B4_DEPLOY_CUTOFF`,**與寄信端同一顆**)。
     * 🛑 `null` = 那一段整段不查(還沒上膛 / 值不合法)⇒ 落 `orderCreatedGapUnknown`。
     * 🔴 **它與 `shippedCutoffIso` 是兩顆不同的 env** —— 那兩條線分別上線,起始線不是同一刻。
     */
    orderCreatedCutoffIso: string | null,
    /**
     * 🔵 訊號4【持續失敗】那一格的門檻(分鐘)。`null` = 那條線還沒上膛。
     * 🛑 它與 `orderCreatedCutoffIso` 是【兩顆各自獨立的 env】——
     *   任一為 null 就不查那一格, 而不是互相補值。
     */
    orderCreatedStuckMinutes: number | null,
  ): Promise<AnomalyAlertSummary>;

  /**
   * ⟦b9-ENUMWATCH⟧ 片 2:近 `windowSeconds` 秒的**客戶搜尋稽核計數**(零識別字元)。
   *
   * 🔴 **為什麼是【第二支方法】而不是把鍵加進 `getAlertSummary`**:
   *    那支的定義散在四支 migration,而 `20260819130000:208` 逐字寫著
   *    「本函式**不動** summary RPC 一個字 —— 那支有四代定義分散在四支 migration,
   *      **重貼整支會安靜倒退兩代**」。repo 已經為同一個問題決定過兩次(另一次 `20260824040000:9`)。
   *
   * 🛑 **回 `null` = 【查不到】,不是【零筆】** —— 呼叫端必須把它落成
   *    `manualCustomerSearchUnknown`,**不得寫成 0**。
   *    那兩者在畫面上會印同一個數字,而它們是相反的意思。
   *
   * 🔴🔴 **`null` 的唯一合法來源是「那支 RPC 還沒被 apply」**(部署窗口)——
   *    片 2 的碼會比 migration 早上線,而**那是刻意的**:
   *    若 adapter 直接呼叫一支不存在的函式 ⇒ 每輪 cron 炸 ⇒ route 503
   *    ⇒ **整個異常告警停擺** ⇒ 那會是「為了加一個觀測而弄壞了主要功能」,比不加還糟。
   *
   * ⚠️ **而【函式存在但它的函式體壞掉】不得走 `null`,要原封上拋** ——
   *    理由與量測見實作端(`PgAnomalyAlertReaderAdapter`)。
   */
  getManualCustomerSearchSummary(windowSeconds: number): Promise<{
    readonly count: number;
    readonly actors: number;
    /**
     * 🔴🔴 **實作【回傳它真的用了的那個窗口】—— 而這是 R3 must-fix 2。**
     *
     * ⛔ 我原本讓呼叫端在組訊息時自己把 `windowSeconds` 併進物件, 而我的理由逐字是
     *    「那個窗口是【這份量測的一部分】⇒ 它跟著資料走, 就不會失配」。
     * 🛑 **而那句話是假的, 而它正是這一輪被指定去找的那個【大家都同意的前提】**:
     *    **把相關欄位放進同一個物件, 不等於它們來自同一次量測** —— TypeScript 只驗形狀, 不驗來源。
     *    ⇒ 呼叫端可以把 24 小時的計數配上 `3600` ⇒ **型別過、測試過、信上說 1 小時。**
     * ✅ ⇒ 改由**實作**回傳它收到的那個值 ⇒ **那才真的是同一次量測。**
     */
    readonly windowSeconds: number;
  } | null>;

  /**
   * 搜尋日誌健康度(⟦search-LOGSILENTZERO⟧)。
   *
   * 🔴 **三個值的語意各自釘死, 因為它們代表的是【不同的世界】而不是程度差別**:
   * ```
   * tableExists = false        那張表還沒貼      ⇒ 印「未貼」, 【不告警】
   * lastRowAt   = null 而表在   還沒開始收        ⇒ 【不告警】(主視窗 2026-09-04 裁乙)
   * lastRowAt   > 24h 前        寫入停了          ⇒ 告警
   * anonCanExecute = null      那支函式還沒貼    ⇒ 【不告警】
   * anonCanExecute = false     🔴 那道門被關掉了 ⇒ 告警
   * ```
   * 🛑 **`null` 與 `false` 不得合併** —— 合併之後「還沒貼」會被告警成「有人把門關了」,
   *    而那會讓值班的人去查一個不存在的事故。
   *
   * ⛔ **原提案是「近 24h 0 列就告警」(甲), 而它被推翻** ——
   *    主視窗逐字:「**甲每天半夜假紅一次, 假紅會被人關掉(閘死於誤報比漏報常見)**」。
   *
   * ⚠️ 讀不到(函式還沒貼)⇒ 回 `null`, 與其他訊號同款 ⇒ 呼叫端走 `*Unknown` ⇒ 503。
   */
  getSearchLogHealth(): Promise<{
    readonly tableExists: boolean;
    readonly lastRowAt: string | null;
    readonly anonCanExecute: boolean | null;
  } | null>;

  /**
   * ⟦b4-NEEDSHUMANNOWATCHER⟧ + ⟦b4-PAIDTHENOVERPAID⟧ 卡住的匯款單, **兩個世界分開數**
   * (三態:`unpaid` / `paid` / `partiallyPaid`;主視窗 2026-09-05 `Q1=乙`)。
   * 兩邊共同條件:`bank_transfer` + 未取消 + OP6a 判 `overpaid` / `needs_human`。
   *
   * ```
   * A `stuckCount`    仍 unpaid    + 已收淨額 > 0            客人的訂單頁還在說「請匯款」⇒ 他會再匯一次
   * B `overpaidCount` 已付款/部分付款 + 已收淨額 > orders.total  畫面正常, 而錢多收了 ⇒ 要退給他
   * ```
   * 🛑 **兩個數字不合成一個** —— 合了之後讀信的人**分不出該打哪一種電話**。
   * ⚠️ **B 的預篩用 `orders.total`, 而 OP6a 算的是它自己那一套** ⇒ 有退款的單兩者會不一致
   *    ⇒ 🔴 **會漏掉一種「total 對不上而 OP6a 判 overpaid」的單**。那是刻意的取捨
   *    (不預篩的話這支 RPC 會對每一張已付款匯款單叫一次 OP6a)⇒ 板列 ⟦b4-PAIDTHENOVERPAID⟧。
   *
   * 🔴 **那兩種是 `20260904230000` 刻意不翻狀態的** —— 錢在庫裡, 而狀態停在 `unpaid`
   * ⇒ 客人的訂單頁仍顯示「請於 5 天內匯款」+ 銀行帳號(`OrderDetailView.tsx:598`)
   * ⇒ 🎯 **他會再匯一次。**
   *
   * 🛑 而 2026-09-05 實測:`grep -rl needs_human apps/admin/src` ⇒ 2 支, **兩支都是物流**
   * ⇒ **後台零面在看這件事** ⇒ 這支 RPC 是它的第一個觀眾。
   *
   * ⚠️ 讀不到(函式還沒貼)⇒ 回 `null`, 與其他訊號同款 ⇒ 呼叫端走 `*Unknown`。
   * 🔵 `oldestCreated` 讓讀信的人知道**積了多久**, 而不只是「有幾張」。
   */
  /**
   * ⟦supply-SYNCTIMEOUTPARTIAL⟧ 每日供應商同步的「卡住」讀數。
   *
   * 🔴 **`staleOpen` 的定義是【最新那一列沒有回填, 而且已經超過門檻】** ——
   *    也就是「開工寫了、收工沒寫」⇒ 那一班被砍在中途。
   * 🔵 **`openRecent` 刻意分開**:開著而還沒超過門檻 = **正在跑**, 不是卡住。
   *    ⇒ 📌 合成一格的話, 每天同步進行中的那幾分鐘都會叫。
   * 🔴🔴 **`suppliersSeen` 是分母, 而它【必須】跟著回** ——
   *    「零列」與「這套留痕從來沒裝過」印同一個 0;沒有分母就分不開。
   * 🛑 **回 `null` = 那支 RPC 不在**(DB 還沒貼)⇒ 照本檔既有成例:**讀不到就不叫**,
   *    部署問題走部署管道, 不變成一封每天寄的信。
   */
  getSupplierSyncStaleCounts(): Promise<{
    readonly staleOpen: number;
    readonly staleSuppliers: readonly string[];
    readonly openRecent: number;
    readonly failedLatest: number;
    readonly suppliersSeen: number;
    readonly staleHours: number;
  } | null>;

  getStuckBankOrdersHealth(): Promise<{
    readonly stuckCount: number;
    readonly oldestCreated: string | null;
    readonly overpaidCount: number;
    readonly overpaidOldest: string | null;
  } | null>;

}
