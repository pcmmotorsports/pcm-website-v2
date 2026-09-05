/**
 * IBankOrderCreatedScanner —— 匯款單成立信(`bank_order_created`)的掃描 port。
 *
 * 🔵 掃描面 = `public.pcm_bank_order_created_email_pending`(`20260906170000` 建, 2026-09-06 已貼)。
 *    **射程逐條寫在那支 view 的 `COMMENT ON`, 這裡不重抄** —— 抄一份就會漂一份。
 *
 * 🔴🔴 **它與 `IPaidOrderScanner` 的差別, 一句話**:
 * ```
 * order_created       = 客人【已經付了】⇒ 信在講「我們收到錢了」
 * bank_order_created  = 客人【還沒付】  ⇒ 信在講「請匯到這個帳號、匯這麼多、幾天內」
 * ```
 * 🛑 **兩封是【兩封不同的信】, 不是同一封的兩個狀態** —— 匯款單成立時寄本封,
 *    客人真的匯進來、`payment_status` 翻 `paid` 之後才寄 `order_created`。
 *    ⇒ 📌 **共用 `order_created` 的 dedup_key 會讓第二封永遠寄不出去**(那正是開新 event_type 的理由)。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴🔴 **這封信會印公司收款帳號 ⇒ 它是這一族裡後果最重的一封**
 * ══════════════════════════════════════════════════════════════════
 * · **印錯帳號 = 客人把錢匯到別的地方**(`packages/domain/src/order/remittance-info.ts:10` 逐字)。
 * · **印錯金額 = 客人多匯或少匯** ⇒ 而 view 那一側已經擋掉「算不出來」的單
 *   (`balance_due` 為 NULL / ≤ 0 / > total 一律不收錄)。
 * · ⇒ 🛑 **所以本 port 的每一格「拿不到就不寄」都不是防禦性程式碼, 是那條規則的一部分。**
 */
import 'server-only';

/**
 * 一列「等著寄匯款單成立信」的單。
 *
 * 🔴 **金額三欄都帶著走, 而不是只帶 `balanceDue`**:信上要印**三行**
 *    (訂單金額 / 已收 / 應付餘額), 而「已收」= `total - balanceDue` ——
 *    📌 **在這裡帶 `total` 比在模板層再查一次便宜, 而且它與 `balanceDue` 是【同一個快照】**
 *      ⇒ 兩個數字一定加得起來。
 * 🛑 **不要為了方便多帶一欄** —— 這一族的 view 含 PII(兩個 email 欄), 多曝一欄就是多一份。
 */
export type BankOrderCreatedWithoutEmail = {
  orderId: string;
  displayId: string;
  /** 下單時刻(ISO)。**期限句要它** —— `remittanceDeadlineSentence(createdAt)`。 */
  createdAt: string;
  /** `orders.total`。整數(分/角以外的單位不在本專案的值域裡)。 */
  total: number;
  /**
   * 應付餘額。🔴 **來源是 `order_balance_base_v` 那條【錢的規則】的唯一一份。**
   * ⚠️ **走到這裡的一定是正數且 ≤ total** —— view 已經把 NULL / ≤0 / >total 全部排除。
   *    ⇒ 📌 而型別上仍是 `number` 不是「保證正數」的型別:**那道保證住在 SQL 裡, 不在型別裡**,
   *      所以呼叫端**不可以**把「型別是 number」讀成「值一定合理」。
   */
  balanceDue: number;
  /** 結帳時填的通知信箱(優先)。 */
  notificationEmail: string | null;
  /** 會員帳號的信箱(退化用)。 */
  customerEmail: string | null;
  /** 單子從哪來。⚠️ view 已經只收 `'web'`, 帶出來是為了**寫 log 時說得出是誰**。 */
  orderSource: string | null;
};

export type ListBankOrderCreatedWithoutEmailInput = {
  /**
   * 只看**這個時點之後建立**的單。
   *
   * 🔴🔴 **那顆 env 必須是 cutoff, 不是 on/off** —— 這是 R3-MF6, 而它有前科:
   *    布林 flag 翻 `true` 的那一秒, view 會掃到**所有歷史未付款匯款單**
   *    ⇒ 🛑 **一次寄出一疊, 而信收不回來**(鐵則 12⑤)。
   *    📎 同款教訓逐字記在 `apps/storefront/src/app/api/cron/email-sweep/route.ts` 取消信那一段。
   *
   * 🔵 **而這條線用 `created_at` 是【對的】, 與取消線那個已知歧義不同**:
   *    取消線的契約寫 `cancelled_at` 而實作卡 `created_at`(見 `ICancelledOrderScanner` 那段訂正);
   *    本線要問的本來就是「**這張單是什麼時候建立的**」—— 因為期限也是從 `created_at` 起算
   *    (`remittanceDeadlineLabel` 逐字 `created_at + PCM_REMITTANCE_EXPIRE_DAYS`)。
   *    ⇒ 📌 **收件範圍與期限用同一個時間欄, 不會出現「他收到信時已經過期」那種單。**
   */
  cutoff: string;
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

export type ListBankOrderCreatedWithoutEmailResult = {
  rows: BankOrderCreatedWithoutEmail[];
  scannedPages: number;
  /** 🔴 撈滿上限 ⇒ `true`。呼叫端要據此決定要不要告警, **不是靜靜地只寄前 N 封**。 */
  truncated: boolean;
};

export interface IBankOrderCreatedScanner {
  listBankOrderCreatedWithoutEmail(
    input: ListBankOrderCreatedWithoutEmailInput,
  ): Promise<ListBankOrderCreatedWithoutEmailResult>;
}
