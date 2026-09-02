// email-log-view.ts — 片A:訂單詳情頁「這張單寄過哪幾封信」的**純語意層**。
// 本檔零 I/O、零 React ⇒ 它的每一條規則都測得起來(同 payment-list-view.ts 的分工)。
//
// 🔴 **這一片存在的理由**(規格 `~/pcm-mailbox/規格-片A-訂單詳情頁顯示寄信紀錄-20260902.md` §0):
//    手動單「不填 email 卻照樣寄」這個病, 今天唯一的發現路徑是【客人打電話】——
//    而客服在後台【查不到那封信】。⇒ 本片把那條路接上。
//
// 🔵 **本片的行號引用有一條判準(R3 逼出來的, 寫下來免得下一個人問「為什麼有些改有些沒改」)**:
//    ⛔ **不用行號**:①指向【本檔自己】的位置 ②指向【本片自己的檔】(我今天改了它四次)
//       ③指向【多窗共寫檔】(`docs/phase-1-backlog.md`)—— 這三種**在我寫這段話的期間就會漂**。
//    ✅ **留行號**:指向別片已 commit 的穩定檔(migration / 既有元件)——
//       它們今天全數複驗成立, 而行號在那裡買得到「快速定位」。
//    📌 ⇒ 判準不是「行號好不好」, 是**那支檔【現在有沒有人在寫它】**。

// 🔴🔴 **未知態一律 fail-open —— 這是本檔最重要的一條, 不要「順手」改成白名單**:
//    `-15`(取消信那片)與片B(「這張單不寄信」那個勾)**兩片都要加新的 status 態**,
//    而【本片先上】。⇒ 顯示層若用「白名單 switch, 沒中就不顯示」,
//    新態上線那天會**安靜地消失一列** —— 而那與「這張單沒寄信」在畫面上長得一模一樣,
//    ⇒ ⇒ **那正是本片要修的那個病**。醜沒關係, 消失不行。

/** 正式庫 `email_outbox_status_check` 的封閉集(2026-09-02 唯讀實查 `pg_get_constraintdef`)。 */
export const KNOWN_EMAIL_STATUSES = [
  'pending',
  'sending',
  'sent',
  'failed',
  'skipped_no_real_email',
  'skipped_order_ineligible',
  'skipped_shipment_voided',
] as const;

// 🛑 **這 7 種是【量正式庫】來的, 不是讀 migration 來的** ——
//    而 `-7d` 一開始讀【建表那一支】(`20260717020000:317`)量到 **6** 種:
//    真正的封閉集在 `20260830060000` 被整個換掉(ADD v2 → VALIDATE → DROP 舊 → RENAME)。
//    🔴 而它掃全世代那把尺也漏了:`grep -o "status IN ([^)]*)"` 只印出舊的那一份 ——
//       v2 是**多行**的, 而 grep 逐行看 ⇒ 第一行沒有收尾的 `)` ⇒ 不匹配。
//    📌 **⇒ 一把假設「寫在一行」的尺, 會安靜地只找到舊的那一代。**
//    ⇒ 要重新確認值域, 去問正式庫的 `pg_get_constraintdef`, 不要用單行 grep。

export type EmailLogRow = {
  readonly eventType: string;
  readonly status: string;
  readonly attempts: number;
  /** 這一列還能再試幾次 —— **沒有它就分不出「等一下會再試」與「已經放棄」**。 */
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly sentAt: string | null;
};

/**
 * 撈哪幾欄。**export 出來是為了讓測試釘死它**, 不是為了給別人 import。
 *
 * 🔴🔴 **2026-09-02 code-reviewer R1 must-fix #3:原本這條界線只有【上面那段註解】守著。**
 *    ⇒ 下一個人加一欄 `recipient_email` ⇒ typecheck / lint / build / 全部測試**都是綠的**,
 *      而客人的信箱就上了訂單頁。**沒有任何東西會紅。**
 *    ✅ 機制優先律:改成 export + 一條 `toBe` 逐字釘死
 *       (`email-log-view.test.ts` 搜 `expect(EMAIL_LOG_COLUMNS).toBe`;
 *        封閉集那條搜 `expect([...KNOWN_EMAIL_STATUSES]).toEqual` —— **兩條是不同的閘, 不要混講**)。
 *    ⇒ 要加欄位 ⇒ 你會先撞到那條紅 ⇒ 那時再回去讀規格 §2「不要顯示的」那一節。
 */
export const EMAIL_LOG_COLUMNS = 'event_type,status,attempts,max_attempts,created_at,sent_at';

/** 狀態的中文字面。**未知態回 null** ⇒ 由呼叫端 fail-open 印原始字串。 */
export function emailStatusLabel(status: string): string | null {
  switch (status) {
    case 'pending':
      return '排隊中';
    case 'sending':
      return '寄送中';
    case 'sent':
      return '已寄出';
    case 'failed':
      return '寄送失敗';
    case 'skipped_no_real_email':
      return '沒寄(沒有真的信箱)';
    case 'skipped_order_ineligible':
      return '沒寄(這張單不符合寄信條件)';
    case 'skipped_shipment_voided':
      return '沒寄(出貨單已作廢)';
    default:
      // 🔴 **不要在這裡回一句「未知」** —— 那會把【是哪一種未知】吃掉,
      //    而下一個人 debug 時看到的是一個沒有資訊的詞。
      return null;
  }
}

/** 事件種類的中文字面。未知回 null(同上, 由呼叫端印原始字串)。 */
export function emailEventLabel(eventType: string): string | null {
  switch (eventType) {
    case 'order_created':
      return '訂單成立通知';
    case 'order_shipped':
      return '出貨通知';
    default:
      // 🔵 `-15` 正在加 `order_cancelled` ⇒ 它上線那天這裡會走到 default ⇒ 印原始字串。
      return null;
  }
}

/** 顯示用的一列:label 為 null 時呼叫端要印 raw。 */
export type EmailLogEntry = {
  readonly eventLabel: string | null;
  readonly eventRaw: string;
  readonly statusLabel: string | null;
  readonly statusRaw: string;
  readonly isKnownStatus: boolean;
  readonly attempts: number;
  readonly maxAttempts: number;
  /**
   * 已經放棄(次數燒完)。
   *
   * 🔴 **`failed` 是雙義的, 而那個歧義在畫面上沒有形狀**
   *    —— `20260830060000:178` 逐字:「終態界線不在 status 而在 attempts」。
   *    ⇒ 同一個「寄送失敗」, 可能是【5 分鐘後 cron 會再試】, 也可能是【已放棄、要人去重排】。
   *    ⇒ ⇒ 員工看不出差別就會做出相反的動作:一個該等、一個該去 /settings/mail 按重排。
   * 🔵 判準逐字照同表鄰居 `lib/mail/dead-letter-read.ts:93`(`attempts >= max_attempts`),
   *    不自己發明第二套 —— 兩處判不同會讓「重排鈕出現在哪一列」與這裡對不起來。
   */
  readonly isDead: boolean;
  readonly createdAt: string;
  readonly sentAt: string | null;
};

export function toEmailLogEntry(row: EmailLogRow): EmailLogEntry {
  const statusLabel = emailStatusLabel(row.status);
  return {
    eventLabel: emailEventLabel(row.eventType),
    eventRaw: row.eventType,
    statusLabel,
    statusRaw: row.status,
    isKnownStatus: statusLabel !== null,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    isDead: row.attempts >= row.maxAttempts,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

/**
 * 空狀態那一句 —— **主視窗 2026-09-02 拍板第 ③ 版**。
 *
 * 🔴 而三版的差異是【指向哪裡】, 選 ③ 的理由要留著:
 *    ①「這張單目前沒有寄過任何信。」⇒ 只是把空白換成一句話, **沒有換掉那個歧義**
 *    ②「…如果客人說收到了, 請截圖回報。」⇒ 把一個【可能正常】的情況寫成需要回報
 *       ⇒ 製造誤報, **而閘死於誤報遠比死於漏報常見**
 *    ③ 同時擋住兩種誤讀:不會被讀成「壞了」, 也不會被讀成「一定正常」
 * 🛑 而空態**不得整區消失** —— 員工分不出「沒寄」與「這頁壞了」。
 *
 * 🔴🔴 **2026-09-02 code-reviewer R1 must-fix #2:括號裡那句被換掉了, 舊字面留著讓人搜得到。**
 *    ⛔ ~~「(手動建立的單可能本來就不寄信)」~~ —— **它描述一個今天不存在的機制。**
 *    ⇒ enqueue 的條件實查是 `email/SupabasePaidOrderScannerAdapter.ts:194`
 *      逐字 `.eq('payment_status', 'paid')` —— **零 manual 排除**;
 *      而片B(「這張單不寄信」那個勾)尚未上線。
 *    ⇒ ⇒ 所以一張**已付款**的手動單空著 = **異常**, 而舊那句話告訴員工那是正常。
 *    📌 **而那正是本片要修的那個病** —— 一句安撫的話, 把一個該被發現的缺口關掉了。
 *
 * 🔴🔴🔴 **2026-09-02 code-reviewer R2 又判 must-fix —— 第二版【同樣不成立】, 兩版舊字面都留著。**
 *    ⛔ ~~「(系統只對已付款的單寄通知信)」~~ —— 它只看了**訂單成立信**那一條路。
 *    ⇒ **出貨信是另一條**:`20260822010000:254` 的 `pcm_shipped_email_pending`,
 *      它的 `WHERE` 有四個部分:`s.shipped_at IS NOT NULL` / `s.deleted_at IS NULL` /
 *      **收件人至少一個非空**(`notification_email` 或 `c.email`)/ 去重 anti-join
 *      —— **而 `payment_status` 述詞一個都沒有**(本窗自己開檔複驗過, 不是照抄審查者)。
 *      ⛔ ~~原句寫「`WHERE` 逐字只有」那三項~~ —— R3 nit:**那是一句完整性宣稱, 而我少列了一項**。
 *      📌 ⇒ 結論(零 `payment_status`)是對的, 而「逐字只有」比我實際查證的範圍大一格 ——
 *         **一個為了讓證據看起來更硬而用的詞, 讓那句話變成假的。**
 *    ⇒ ⇒ 一張**未付款而已出貨**的單空著 = 異常, 而第二版一樣告訴員工那是正常。
 *    🛑 **⇒ 同一個病、同一個方向, 我連犯兩次 —— 而第二次是在【修第一次】的時候犯的。**
 *
 * 🔴 **而 R2 還指出反方向, 那是我完全沒想到的一格**:
 *    cutoff(`storefront/.../api/cron/email-sweep/route.ts:119/402`)之前的舊單, 一列都不會排
 *    ⇒ 那種**已付款**的舊單空著是**正常**的, 而第二版會讓員工把它讀成異常 ⇒ **假警報**。
 *    📌 **⇒ 一句話同時可以【該叫的時候不叫】與【不該叫的時候叫】—— 兩個方向都錯。**
 *
 * ✅ **第三版的形狀改了:不再宣稱原因, 改成【列出可能性】。**
 *    空的原因至少三類, 而顯示層**看不到**其中任何一類的判斷依據:
 *      ① 還沒付款(訂單成立信只認 paid)
 *      ② 開始寄信之前的舊單(cutoff)
 *      ③ 沒有可寄的信箱 ⇒ 落 `pcm_shipped_email_unsendable`, **outbox 零痕跡**
 *         (`SupabaseShippedOrderScannerAdapter.ts:15-23`)
 *    🎯 **⇒ 一句我證不出來的因果, 不要寫進畫面。列可能性不做宣稱, 兩個方向都不會錯。**
 *    🔵 而片B(不寄信勾)上線會再多一類 ⇒ 做片B 的人回來加, 不必改句型。
 */
export const EMAIL_LOG_EMPTY_TEXT =
  '這張單目前沒有寄過任何信。空著不一定是異常 —— 還沒付款、開始寄信之前的舊單、或沒有可寄的信箱, 都不會留下紀錄。';
