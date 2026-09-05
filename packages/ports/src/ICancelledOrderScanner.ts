/**
 * ICancelledOrderScanner —— 取消信(`order_cancelled`)的掃描 port。
 *
 * 🔴🔴 **它與 `IUnpaidCancelledOrderScanner` 是【兩支】, 而它們的型別同形。**
 * ```
 * order_unpaid_cancelled  = 未付款的單被取消            ← IUnpaidCancelledOrderScanner
 * order_cancelled         = 刷卡且【已全額退款】的整單取消  ← 本支(Sean 2026-09-02 拍甲)
 * ```
 * 🛑 **import 錯一支, typecheck 不會紅**(欄位逐格相同)⇒ 而寄出去的信是不可回收的。
 * ⇒ 📌 接它的人:**在呼叫端旁邊寫一句自己是哪一支**, 不要只靠 import 那一行。
 *
 * 🔵 掃描面 = `public.pcm_cancelled_email_pending`(`20260905310000` 建)。
 *    射程逐條寫在那支 view 的 `COMMENT ON`, 這裡不重抄(抄一份就會漂一份)。
 */
import 'server-only';

/**
 * ICancelledOrderScanner —— 「**刷卡付款、已全額退款**的整單取消、而還沒排過通知信」的窄查詢 port。
 *
 * 🔴🔴 **本檔是從姊妹 port `IUnpaidCancelledOrderScanner` 抄過來改的, 而【下面那一大段射程說明是它的、不是本 port 的】。**
 *    (codex R2 ⑧ 抓到;開檔查證屬實。)⇒ 下面講「未付款」「`payment_expired`」「員工那七值」的段落
 *    **描述的是姊妹那條線**, 保留是因為兩條線的取消路判準共用同一組事實;
 *    🛑 **而本 port 自己的射程是:`payment_method = 'tappay'` + `payment_status = 'refunded'` + `cancelled_at IS NOT NULL`。**
 *    ⇒ 📌 讀本檔的人:**射程以那支 view 的 COMMENT 為準**
 *      (`supabase/migrations/20260905310000_m4b_cancelled_email_pending_view.sql`), 不以下面那段為準。
 *
 * 🔴 **為什麼是掃描式而不是掛在取消動作上**(與 `IPaidOrderScanner` 同一個理由):
 *    掛在動作上 ⇒ 員工按完取消、enqueue 炸掉 ⇒ **那封信永遠沒有人想起來,零訊號**。
 *    掃描式的話,下一輪 cron 會再看到它。
 *
 * 🛑🛑 **射程:只涵蓋【員工按取消】,不含逾時自動取消。**
 *    分辨的欄位是 `cancelled_reason`:
 *    · 逾時那條(`pcm-expire-unpaid-orders`)寫**固定字面** `'payment_expired'`
 *      —— 座標 `20260828060000_..._expire_unpaid_orders_heartbeat.sql:233-235` 逐字
 *         `SET cancelled_at = pg_catalog.now(), cancelled_reason = 'payment_expired'`
 *    · 員工那七值(a8a1 `20260804180000:115-124`,我開檔數過):
 *      `customer_request` / `out_of_stock` / `long_leadtime` / `price_change`
 *      / `duplicate_order` / `internal_error` / `other` —— **不含 `payment_expired`**
 *
 * 🛑🛑 **逾時自動取消【不寄】—— 而那是 Sean 2026-09-03 拍過的乙,不是待決事項。**
 *    逐字(已寫進正式庫的 COMMENT,`20260903040000_...:100-102`):
 *    「**order_unpaid_cancelled 的射程(Sean 2026-09-03 拍乙)**:只涵蓋【員工在後台按下取消】的未付款單。
 *      `expire_unpaid_orders`(pg_cron 自動逾時取消,**一次上限 500 張**)【不涵蓋】——
 *      Sean 逐字『不寄, 只有員工按下取消才寄』。⇒ 那一條路**不得**寫這一列。」
 *
 *    ⛔ ~~我原本在這裡寫「= Sean【未拍板】(題 2)」+「他若答『要寄』:改法是一處 ⇒ 拿掉那道閘」~~
 *    🔴🔴 **那兩句都是假的,而第二句【指向一個會傷到客人的動作】**(code-reviewer must-fix 2):
 *      照它做 ⇒ 拆掉射程閘 ⇒ 逾時線**一輪上限 500 張** ⇒ **一次寄出上百封不可回收的信**,
 *      收件人是一批**下單後沒付錢、早就忘了這件事**的人。
 *    📌 **⇒ 而我把一個【已落檔的拍板】記成【待決】—— 那不是保守, 那是把決定重新打開。**
 *    ⇒ ✅ **要改這個射程,必須拿到 Sean 【新的】一次拍板,而不是「他若答要寄」。**
 *
 * 🔴🔴 **這道判準真正的脆弱點(而它【不是】我原本寫的那一個)**:
 *    ⛔ ~~「它靠『逾時那條寫的是 `payment_expired` 這個字面』⇒ 有人改那個字面就會換一批收件人」~~
 *      —— 那是**舊判準**的脆弱點,而判準已經換掉了(現在不讀任何欄位的值)。
 *    ✅ **新判準的脆弱點是**:**有人加一條【寫 `orders.cancelled_at` 而不寫 `order_cancellations`】
 *      的取消路** ⇒ 那批客人會**安靜地收不到信**。
 *    🔴🔴 **而那條路【昨天就已經存在】**:`admin_mark_order_cancelled`
 *      (`20260902140000`,檔頭 `:106` 逐字「**不寫 `order_cancellations` / `order_cancellation_items`**」,
 *       而 `:383` 寫 `orders.cancelled_at`)。
 *      ⇒ 🛑 **本 port 今天沒有被它咬到,只是因為它要求 `payment_status='refunded'` 而本 port 卡 `unpaid`**
 *      ⇒ 📌 **救我的是【另一道閘】,不是這個不變式** —— 而不變式才是下一個人會依賴的東西。
 *    ⇒ ✅ **判別句(加新取消路的人照這句自問)**:
 *      **「我這條路有沒有寫 `order_cancellations`?沒有 ⇒ 這封信不會寄給我的客人。」**
 *
 * 🟢 **而【部分取消】那條路我量過,四種世界都對**(codex 第二輪問的「反過來的漏」):
 * ```
 * ⛔ ~~「四支取消 RPC 全部都寫 order_cancellations(a8a1 3 · a8a2 2 · a8a3 1 · reason_neutral 1)
 *      ⇒ 沒有一條【員工取消】的路會漏掉那一列」~~ —— **兩半都要訂正**(code-reviewer nit 1):
 *   ① 那些 3 / 2 是【含斷言閘裡的字串字面】(如 a8a1 `:314`/`:360` 的
 *      `position('INSERT INTO public.order_cancellations …' in v_def)`)⇒ 真正的 INSERT 各 **1** 支
 *   ② 那四支是**同一支 `admin_cancel_order` 的四個版本**,只有 `20260830020000` 是活的
 *      ⇒ 📌 「四支都寫」讀起來像四條獨立的路, 而它們是一條路的四個版本
 *   ③ 而全稱句本身為假 —— 見上面 `admin_mark_order_cancelled`
 *
 * 而部分取消(a8a2)只在【每一項都被取消完】時才設 orders.cancelled_at
 *   (`20260805100000:455-467` 的 `v_closed`:沒有任何一項的數量還大於已取消數量)
 * ⇒ 真的部分取消(還有東西留著)⇒ cancelled_at 是 NULL ⇒ **本 port 不撈它** ✅
 * ⇒ 而部分取消把最後一項也取消掉 ⇒ cancelled_at 有值 ⇒ **撈它, 而那是對的**
 *    —— 那張單【實際上就是被取消了】, 客人該知道。
 * ```
 *
 * 🔴 **本 port 會回 PII(兩個 email 欄)** ⇒ 實作 server-only + service_role;
 *    呼叫端只准把它們交給 `outbox.enqueue`,**不得進 log / result / 錯誤訊息**。
 */
export type CancelledOrderWithoutEmail = {
  orderId: string;
  displayId: string;
  /** 取消時刻(ISO 8601)。 */
  cancelledAt: string;
  /** 員工選的理由;`null` = 沒有理由 ⇒ 信裡那一段不印。 */
  cancelledReason: string | null;
  /** `orders.notification_email`(建單當下的真值;舊單可能為 null)。 */
  notificationEmail: string | null;
  /** 退化來源:客戶主檔的 email。 */
  customerEmail: string | null;
  /**
   * `orders.order_source` —— 訂單來源(⟦f3-MAILFALLBACKVSRULING⟧ 片 B, 2026-09-05)。
   *
   * 🔴 **本片只是把它接出來, 沒有任何人在用它** —— 分流的判斷在片 C。
   * 值域是 `packages/domain` 的 `OrderSource`(`web` / `manual_phone` /
   * `manual_line` / `manual_other`, CHECK 在 `20260712203000`)。
   * 🛑 這裡刻意用 `string` 不用那個 union:**值域寫兩份, 下一個加來源的人只會改到一份。**
   * ⚠️ `null` 的意思是「view 沒給」而不是「這張單沒有來源」——
   *    `orders.order_source` 是 NOT NULL(`20260712203000`), 所以 `null` 只會在【欄位沒撈到】時出現。
   * 🔴🔴 **而 fail 方向現在就釘死(R1-F11)**:片 C 撞到 `null` ⇒ **照舊寄**(走 fallback)。
   *    🛑 反過來寫(`orderSource !== 'web' ⇒ 不寄`)會讓一個 `null` 把
   *    **真的顧客站訂單靜默不寄** —— 而「沒寄」這件事在畫面上沒有形狀。
   *    📌 兩個方向都會錯, 而錯的代價不對稱:多寄一封信看得見, 少寄一封看不見。
   */
  orderSource: string | null;
  /**
   * 🔴 退款金額 = **回到那張卡的錢**, 唯一來源 `public.pcm_order_card_refunded(order_id)`。
   * ⛔ ~~原本這裡寫「與 `payment_status` 的判定同源(卡 + 人工兩張表的和)」~~
   * 🛑 那一版會說謊:卡退 4000 + 現金退 1000 = 總額 ⇒ 舊公式判 'full'
   *    ⇒ 信說「全額退回**原付款方式**」而那張卡只回了 4000(codex R1 ③;主視窗 2026-09-05 改裁甲)。
   * ⇒ 📌 **不含人工/現金退款、不含 `status='processing'`;含被更正成 `money_moved` 的。**
   */
  refundedAmount: number;
  /**
   * 🔴 `'full'` | `'partial'` —— **算出來的, 不是寫死的**:`card_refunded >= orders.total` 才是 `'full'`。
   * 🛑 **`'partial'` ⇒ 模板那句與那個數字【都不印】**(`sweep-email-outbox.ts` 只在 `'full'` 時印)
   *    ⇒ fail-closed:寧可不講金額, 不講一個可能是謊的金額。
   * ⚠️ 而它**不是**「狀態機與金額對不起來的訊號」—— 混合退款(卡 + 現金)是一個
   *    **狀態機與金額都對、而 kind 就是 'partial'** 的正常世界。
   */
  refundKind: string;
};

export type ListCancelledWithoutEmailInput = {
  /**
   * 只看這個時點之後被取消的單。
   * 🔴 **與出貨信的 cutoff 同一個理由**:上線那一刻之前的舊單**一律不補寄** ——
   *    否則第一次跑會對一批早就忘了這件事的人寄出一堆信。
   *
   * 🛑🛑 **2026-09-03 訂正:上面那句話與實作【不一致】, 而實作比它窄**(codex must-fix)。
   *    實作(本檔的 adapter 與 `get_order_unpaid_cancelled_gap_counts`)兩道閘都下:
   *    `cancelled_at >= cutoff` **且** `created_at >= cutoff`。
   *    ⇒ 📌 **差在這一種單**:**建立於 cutoff 之前、而在 cutoff 之後才被員工取消**
   *      —— 契約說要納入(它「在這個時點之後被取消」), 而**實作把它排除**
   *      ⇒ 🔴 **那位客人不會收到取消通知, 而沒有任何東西會叫。**
   *
   *    🔬 **我量到的(拋棄式 PG 17.10, 2026-09-03)**:
   *    在真實不變式 `cancelled_at >= created_at` 之下,`created_at >= cutoff`
   *    **蘊含** `cancelled_at >= cutoff` ⇒ **`cancelled_at` 那道閘在任何一列合法資料上
   *    都沒有判別力** —— 拿掉它, 八列的測試結果**一格都不變**。
   *    只有一列「取消早於建立」的**不可能資料**隔離得出它(本尊 0 / 拿掉它 1)。
   *    ⇒ 🎯 **⇒ 真正在決定收件範圍的是 `created_at`, 而契約寫的是 `cancelled_at`。**
   *
   *    ⚠️ **本次【不改行為】** —— 改它會改變誰收得到信, 那是 Sean 的決定不是我的;
   *    而 `created_at` 那道閘在姊妹線有明確理由(PRD §5 R3:晚翻 paid 的舊單會被誤寄),
   *    在取消這條線上**沒有人寫過理由**。⇒ 已交主視窗開列。
   */
  cutoff: string;
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

export type ListCancelledWithoutEmailResult = {
  rows: CancelledOrderWithoutEmail[];
  scannedPages: number;
  truncated: boolean;
};

export interface ICancelledOrderScanner {
  listCancelledWithoutEmail(
    input: ListCancelledWithoutEmailInput,
  ): Promise<ListCancelledWithoutEmailResult>;
}
