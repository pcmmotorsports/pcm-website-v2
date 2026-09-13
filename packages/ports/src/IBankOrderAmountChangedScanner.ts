/**
 * IBankOrderAmountChangedScanner —— 部分取消補寄信(`bank_order_amount_changed`)的掃描 port。
 *
 * 🔵 掃描面 = `public.pcm_bank_order_amount_changed_email_pending`
 *    (`20260913010000`,**2026-09-13 已貼正式庫** —— Sean 自己在 SQL Editor 貼的)。
 *    **射程逐條寫在那支 view 的 `COMMENT ON`,這裡不重抄** —— 抄一份就會漂一份。
 *
 * 🔴🔴 **它與 `IBankOrderCreatedScanner` 的差別, 一句話**:
 * ```
 * bank_order_created         一列 = 一張單    信在講「請匯這個數」
 * bank_order_amount_changed  一列 = 一次取消  信在講「那個數改了, 請改匯這個」
 * ```
 * 🛑 **粒度不同是承重的, 不是風格** —— 唯一鍵 `(event_type, dedup_key)` 不含 order_id
 *    (`20260717020000:377`)⇒ 一列一張單會讓**同一張單的第二次取消永遠撈不出來**,
 *    而 Sean 2026-09-13 A1 甲逐字要「第二次取消也要寄」。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴🔴 **這封信會印公司收款帳號與一個【新的】金額**
 * ══════════════════════════════════════════════════════════════════
 * · 它比匯款成立信多一層風險:**客人手上已經有一封舊的了** ⇒ 印錯 = 兩個數字打架。
 * · ⇒ 🛑 本 port 的每一格「拿不到就不寄」都不是防禦性程式碼, 是那條規則的一部分。
 */
import 'server-only';

/**
 * 一列「等著補寄新金額」的**取消**。
 *
 * 🔴 **`cancellationId` 是這一族與匯款成立信最大的差別** —— 它是 `dedup_key` 的前半,
 *    而**鍵決定了「同一張單的第二次取消寄不寄得出去」**。
 * 🛑 **不要為了方便多帶一欄** —— 這一族的 view 含 PII(兩個 email 欄), 多曝一欄就是多一份。
 */
export type BankOrderAmountChangedWithoutEmail = {
  orderId: string;
  /**
   * 🔴 `order_cancellations.id` —— **那一次取消**。
   * 🔬 一次部分取消在該表寫 **1 列** —— 承重點是**函式本體 + 唯一鍵**, 不是實資料:
   *    · 2026-09-13 正式庫唯讀:`pg_get_functiondef(admin_cancel_order)` 裡該表的 INSERT
   *      只有 **1 個點**(單列 VALUES + RETURNING id)+ 表上 `UNIQUE (order_id, idempotency_key)`
   *    · ⚠️ **而實資料沒有驗到部分取消**(那時該表 4 列, 4 列全是【整單取消】)
   *      ⇒ 📌 **它是推得的, 不是實測的**。⛔ 我原本只寫「量過的」而把這句 caveat 丟了
   *        (Fable 2026-09-13 F6;migration 檔頭 `:34-35` 有寫, 我搬過來時漏了)。
   *  ⇒ 一次取消一把鍵。
   */
  cancellationId: string;
  displayId: string;
  /**
   * 🔵 **訂單的**下單時刻(ISO)—— **不是取消時間**。期限句要它
   * (`remittanceDeadlineSentence(createdAt)`)。
   * ⇒ 📌 **期限不因取消延後**, 與那封成立信講的是同一天。
   *   ⚠️ 沿用既有行為, 非本片決定;Sean 未答「取消後要不要重新給期限」。
   */
  createdAt: string;
  /**
   * `effective_total` —— 扣掉已取消品項、**券整張作廢算回原價**、運費照規則重算之後的訂單金額。
   * ⚠️ ⇒ 📌 **用過券的單, 這個數可能比客人下單時看到的【高】。**
   *    Sean 2026-09-13 答 A2 甲 = 照寄, 並另答「信裡要講一句為什麼」。
   */
  total: number;
  /**
   * `effective_balance_due`。
   * ⚠️ **走到這裡的一定是正數且 ≤ total** —— view 已經把 NULL / ≤0 / >total 全部排除。
   *    ⇒ 📌 而型別上仍是 `number`:**那道保證住在 SQL 裡, 不在型別裡**,
   *      所以呼叫端**不可以**把「型別是 number」讀成「值一定合理」。
   */
  balanceDue: number;
  /** 結帳時填的通知信箱(優先)。 */
  notificationEmail: string | null;
  /** 會員帳號的信箱(退化用)。 */
  customerEmail: string | null;
  /** 單子從哪來。⚠️ view 已經只收 `'web'`,帶出來是為了**寫 log 時說得出是誰**。 */
  orderSource: string | null;
};

/**
 * 🔴🔴 **本型別【沒有 `cutoff`】, 而那是一個刻意的差異 —— 理由要看完**。
 *
 * 姊妹那支(`ListBankOrderCreatedWithoutEmailInput`)有 `cutoff`,而它擋的是
 * 「布林 flag 翻 true 的那一秒掃到所有歷史單 ⇒ 一次寄出一疊」(R3-MF6)。
 *
 * 🛑 **而同一個東西套到本型別會【安靜地漏寄】**:
 * ```
 * 本 view 吐的 `created_at` 是【訂單的】下單時刻(繼承自 pcm_bank_order_still_mailable),
 * 而本片真正關心的時間是【那一次取消發生在什麼時候】—— 而 view 【沒有吐】那一欄。
 * ⇒ 對 `created_at` 下 cutoff ⇒ 一張【很久以前下單、今天才被部分取消】的單會被濾掉
 * ⇒ 📌 客人手上那封舊信永遠是錯的金額, 而【沒有任何東西會叫】。
 * ```
 * ✅ **那個保護在本型別由 view 自己的時間地板做**:
 *    `oc.created_at >= public.pcm_bank_amount_changed_email_floor()` 烤在述詞裡
 *    ⇒ 📌 **它是不變式, 不是參數** —— 沒有人可以在呼叫端把它調寬。
 *
 * 🔴 **哪天真的需要一個可調的 cutoff ⇒ 它必須吃【取消時間】, 而那要先讓 view 多吐一欄**
 *    (`oc.created_at`)—— 那是一支新 migration(**貼板 138 起**), 不是在這裡加一個參數。
 *    ⚠️ **不要**退而求其次拿 `created_at` 湊 —— 那就是上面那個安靜漏寄。
 */
export type ListBankOrderAmountChangedWithoutEmailInput = {
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

export type ListBankOrderAmountChangedWithoutEmailResult = {
  rows: BankOrderAmountChangedWithoutEmail[];
  scannedPages: number;
  /** 🔴 撈滿上限 ⇒ `true`。呼叫端要據此決定要不要告警,**不是靜靜地只寄前 N 封**。 */
  truncated: boolean;
};

export interface IBankOrderAmountChangedScanner {
  listBankOrderAmountChangedWithoutEmail(
    input: ListBankOrderAmountChangedWithoutEmailInput,
  ): Promise<ListBankOrderAmountChangedWithoutEmailResult>;
}
