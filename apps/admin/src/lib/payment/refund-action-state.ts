// refund-action-state.ts — M-3 A7c RW2c:退款 action 的回傳 state + 冪等 token + 員工訊息表。
//
// 🔴🔴 **本檔會被 client 端 import**(RW2d 的表單要用 `useActionState` 接 state、讀 `requestToken`)
//    ⇒ 不得引入 `server-only` 或任何 server 專用模組。目前零 import、零 IO、零敏感值。
//
// 🔴 介面形狀 = A9d2-1 拍板的混合形(Sean Q1=A 慣例):**失敗回 state**(員工打的退款原因/金額
//    留在框裡)、**成功才 redirect**(PRG)。簽章 = `(prev, formData) => Promise<RefundActionState>`。
//
// 🔴 **token 的三種去向(本檔最重要的設計;與備註片不同、因為退款 token 會被帳本「終態消耗」)**:
//    RW1a 的 request_id 是全域 UNIQUE(S4)+ 查驗式冪等(G4):列在 processing/confirmed 時同鍵
//    重播回 DUPLICATE;列已終結(deferred/failed)時同鍵重播 = RAISE(「開新請求=新表單=新 token」)。
//    ⇒ ①錢的狀態未定(error / held / in_flight / unknown_state…):**原樣帶回同一把**
//       —— 重按會被 G4 認出,絕不會第二退(A9d2-1 R2-2 同理)。
//    ②列已終結、確定零動錢(deferred / rejected / not_sent):**必須換一把新的**
//       —— 舊 token 已被 S4 永久佔用,帶回舊的會讓「修正後重送」撞 G4 RAISE 變成 bug 畫面。
//    ③成功:redirect(PRG 重渲染自然產新 token)。
//    去向查表 = `FRESH_TOKEN_CODES`;測試對兩邊各釘一格。

/** 成功後 PRG 帶的結果碼(`result-banner.tsx` 以本常數註冊;兩邊共用、typo 結構上不可能)。 */
export const REFUND_SUBMITTED_RESULT_CODE = 'refund_submitted';

/** 表單欄位名(解析器與 RW2d 表單共用單一真相)。 */
export const REFUND_ORDER_ID_FIELD = 'order_id';
export const REFUND_KIND_FIELD = 'kind';
export const REFUND_AMOUNT_FIELD = 'amount';
export const REFUND_CONFIRM_FIELD = 'confirm_code';
export const REFUND_REASON_FIELD = 'reason';
export const REFUND_REQUEST_TOKEN_FIELD = 'request_token';

/**
 * 冪等 token 形狀 = **UUID v4 小寫、嚴格鏡像 RPC 的 regex**(`20260803150000:459`)。
 *
 * 🔴 與備註片的寬鬆版(任意版本、大小寫皆收)**刻意不同**:退款 RPC 對 request_id 是
 *    fail-closed RAISE(P0001)—— 寬收再送過去只會把「表單層就該擋下的形狀錯」變成
 *    「bug 請停手」畫面。`crypto.randomUUID()` 產的就是 v4 小寫,正常路徑零摩擦。
 */
const REFUND_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 產一把冪等 token(RW2d 的 server component 渲染時產、hidden input 回送;Q2=C 慣例)。
 * 🔴 產生點不得落在任何快取層內(`unstable_cache`/`React.cache` 會把 token 凍住)。
 */
export function generateRefundRequestToken(): string {
  return crypto.randomUUID();
}

/** token 形狀驗證(解析器用;與產生器同源)。 */
export function isRefundRequestToken(value: string): boolean {
  return REFUND_TOKEN_RE.test(value);
}

/**
 * 失敗原因碼(全部走 state;成功唯一出口是 redirect)。
 *
 * 語意三類:①員工自己改得掉/等一下再看 ②停手、走對帳或異常清單 ③停手、找維護/管理者。
 * ⛔ ~~「這筆錢動了沒有」在每一則訊息裡**明寫**,不留員工自己猜的空間。~~
 * 🔴 **2026-08-30 實量:這句話不成立,舊字面留著讓引用它的人同一發撞到這裡。**
 *   30 條訊息裡,**19 條沒有「錢沒有動」四個字**;`already_refunded` / `no_card_transaction` /
 *   `in_flight` / `held` / `unknown_state` / `bug` / `error` / `db_config` 這 **8 條**
 *   「沒有發起」與「錢沒有動」**兩句都沒有**。(數法在下方 FAILURE_MESSAGES 註解。)
 * ✅ **它該讀成【目標】不是【現況】** —— 而寫成現況的代價是:下一個人會用它**反推**
 *   「這句訊息沒寫錢沒動 ⇒ 所以錢動了」,而那個推論在這 8 條上是錯的。
 */
export type RefundFailureCode =
  // ── 本層閘
  | 'denied'
  | 'disabled'
  | 'invalid'
  | 'confirm_mismatch'
  // ── server 重讀訂單(app 層縱深;RPC G12/白名單仍是權威)
  | 'order_not_found'
  | 'already_refunded'
  | 'no_card_transaction'
  | 'not_refundable'
  // 🔴 `#890` 片4(2026-08-30):卡住的人工判定擋下退款。
  //    **三碼不可合併**(codex R1 must-fix;同上面 `#445` 那三碼的理由):
  //    被擋的原因不同,員工的下一步也完全不同 —— 合成一句就是「擋得莫名其妙」。
  //    ⚠️ 我第一版就是一碼吃四種世界,而那句文案只對其中一種是真的。
  | 'stuck_verdict'          // 還沒有人更正過 ⇒ 去異常清單更正判定
  | 'stuck_verdict_money'    // 已更正為「錢動了」⇒ **停手**,那筆錢已經退出去了
  | 'stuck_verdict_unknown'  // 帳本或更正紀錄讀不到 ⇒ 稍後再試 / 找維護
  // ── G0 baseline(TapPay Record 反查)
  | 'record_unavailable'
  | 'record_shape_bad'
  | 'record_state_bad'
  | 'nothing_left'
  // ── RPC initiate 業務態
  | 'ledger_full'
  | 'in_flight'
  // ── #445 超退閘(RPC 步 6b)。🔴 **三碼不可合併**:被擋的原因不同,員工的下一步也不同
  //    (改金額 / 去處理另一筆 / 停手找人)——合成一句話就是 §0-E 第 2 條說的「擋得莫名其妙」。
  | 'exceeds_remaining'
  | 'exceeds_in_flight'
  | 'exceeds_unknown'
  // ── refund() 三態/錯誤分派(§3 表)
  | 'deferred'
  | 'rejected'
  | 'not_sent'
  | 'held'
  | 'unknown_state'
  | 'finalize_failed'
  // ── 系統面
  | 'config'
  // 🔴 `db_config`(PCM06)與 `config` 不合流:`config` 是 TapPay 環境設定,
  //    這一格是**資料庫**設定 —— 兩者要找的人不同。合流會讓員工去問錯的人。
  | 'db_config'
  | 'bug'
  | 'error';

/**
 * 🔴 這些碼代表「帳本列已終結、token 已被 S4 永久消耗」⇒ state 必須帶**新** token
 * (見檔頭 ②;其餘一律原樣帶回)。三碼共同前提:錢確定沒動(deferred/rejected 是 TapPay
 * 明確拒絕、not_sent 是 pre-flight 未送出),所以「換鍵重來」是安全的。
 */
export const FRESH_TOKEN_CODES: ReadonlySet<RefundFailureCode> = new Set([
  'deferred',
  'rejected',
  'not_sent',
]);

/**
 * 員工看到的字。🔴 動錢路徑的鐵律:凡「狀態未定」一律寫**勿重試**;
 * 凡「錢沒動」明寫「錢沒有動」——這行字就是防第二退的最後一道人因防線。
 *
 * ⚠️ **而這條鐵律今天【沒有】被全面套用,數字寫在這裡免得下一個人以為它是全稱句**
 * (2026-08-30 實量,關卡2 must-fix 2 抓到我把它寫成全稱):
 * ```
 * 總條數 30 · 沒有「錢沒有動」19 · 沒有「沒有發起」13 · 兩句都沒有 8
 * 兩句都沒有的那 8 條:already_refunded / no_card_transaction / in_flight / held /
 *                      unknown_state / bug / error / db_config
 * 數法:把本 Record 逐條抽出來比字面(不是 grep 全檔 —— 註解裡也有這幾個字)
 * ```
 * 🔴 **`db_config` 在那 8 條裡是【刻意的】**:它的字是 Sean 逐字核可的,**我不自行補字**
 *    (`⟦b4-PCM06COPY⟧` 端他一個字);其餘 7 條**不是本片造成的,也不是本片修的**。
 *
 * ══ 🔴🔴 **2026-09-01 逐條實查:那 7 條【不是「還沒補」,是大多數【不能補】】** ══════
 *    ⟦b4-MONEYLINE⟧ 原本被寫成「要不要一起補」而卡著等 Sean。追過每一條的**產生點**之後,
 *    方向是反的。而判準**不是我發明的** —— 它就寫在本檔下面 `db_config` 那一段:
 *      「真正的理由**不靠「大家都有」**,靠這一句本身:PCM06 時交易已回滾、錢確實沒動
 *        —— 那是**這一格自己**的事實,**不是慣例**。」
 *
 *    🔴 **而最重要的是那句話的【形狀】**:
 *      **「退款沒有發起」與「錢沒有動」是【兩個宣稱】,它們在同一條 code 上可以一真一假。**
 *      ⇒ 而「補或不補」這個問法**預設了它是一個值** ⇒ 📌 **題目的形狀決定了答案的形狀。**
 *
 *    **逐條(判準:這個 code 被 return 的那一刻,錢有沒有離開我們?三個答案不是兩個)**:
 *    ```
 *    no_card_transaction  refund-actions.ts:218-220  RPC 之前 · 根本沒有卡交易   ⇒ 兩半都可補
 *    already_refunded     refund-actions.ts:215-216  RPC 之前 · paymentStatus 已是 refunded
 *                         ⇒ ✅ 可補「退款沒有發起」  🛑 **不得補「錢沒有動」**
 *                         🔴 理由具體:觸發條件正是【這張單已經全額退款】⇒ 錢動過
 *                            ⇒ 補了員工會以為客人沒收到 ⇒ **他會再退一次。**
 *                            ⇒ 那不是文案不精確, 是**一句會導致重複退款的文案**。
 *    in_flight  :456/:460   RPC 之後 · 有一筆正在處理中          ⇒ 🔴 那一筆正在動
 *    held       :600        RPC 之後 · TapPay 已受理而金額不符   ⇒ 🔴 可能已離開
 *    unknown_state :557/:593/:668  請求可能已送達 TapPay         ⇒ 🔴 **不知道**
 *    error      :206 訂單重讀失敗(RPC 前)+ :435 initiate 失敗
 *               🔴 而 :433-434 自己寫著「transient(回應斷在路上):INSERT 可能已 commit」
 *    bug        :430 契約違反(RPC 前)+ :603 accepted 後 finalize NOT_FOUND + :676 fallthrough
 *    ```
 *    🔴🔴 **`error` / `bug` 是比「三個答案」更糟的第四種形狀:一句話涵蓋好幾個世界,**
 *    **而那些世界的錢狀態不同** ⇒ 問題不是「錢動了沒」,是**這一句話沒有資格回答那個問題**。
 *    🛑 **而「不知道」那一種不能補任何一句關於錢的話** —— 補「動了」或「沒動」**都是在假裝知道**。
 *      📌 **一個誠實的「我不知道」,比兩個方向的猜測都安全。**
 *    🔵 **而「在 RPC 之前 / 之後」是機械可判的**(`:216`/`:220` < `:456`)
 *      ⇒ **下一個人可以自己重跑這個判準,不必相信這張表。**
 *
 *    ⚠️ **本次【只寫下判斷,一個字的文案都沒有改】** —— 改文案要另一個授權(見 ⟦b4-MONEYLINE⟧)。
 *    🔴 **而順帶量到一格,它讓上面那段更重要**:這幾句文案在測試檔裡出現 **0 次**
 *      ⇒ **改它(或把它改回去)都不會有任何東西紅。⇒ 這段註解就是它今天唯一的守門。**
 */
const FAILURE_MESSAGES: Record<RefundFailureCode, string> = {
  denied: '沒有權限或登入狀態已失效,退款沒有發起。',
  disabled: '退款功能目前未啟用(上線前置未完成),退款沒有發起。',
  invalid: '表單內容不正確(金額、原因或確認碼格式有誤),退款沒有發起。',
  confirm_mismatch: '確認碼與訂單號末 4 碼不符,退款沒有發起。請對照訂單號重新輸入。',
  // 🔴🔴 **【codex 換角度那一問抓到的】「請重新整理後確認」不是一個【有終點】的指示。**
  //    ⛔ ~~原句:「找不到這張訂單,退款沒有發起。請重新整理後確認。」~~
  //    ⇒ 訂單如果是**真的不在了**(被刪、ID 失效), 重新整理一百次也不會有 —— 而那句話沒有出口
  //      ⇒ 員工會一直按。**一句做不到的下一步比沒有下一步糟**(同檔 `stuck_verdict_unknown` 上方
  //      已經記過一次同款, 而這一格重犯了)。
  //    ⇒ ⇒ 改成【有界的重試 + 出口】:重整一次;還是沒有 ⇒ 停手、通知維護。
  //    🔴 而這一格會因為 `⟦b4-PCM05SPLIT⟧`(`PCM07`)而**多接到一整條路的流量**
  //      ⇒ 修它不是順手, 是那一片把更多人送到這句話面前之後的必要條件。
  order_not_found:
    '找不到這張訂單,退款沒有發起。請重新整理一次確認;' +
    '若仍然找不到,請勿反覆重試,並通知系統維護。',
  // 🔴 **只補【前半】。後半「錢沒有動」在這一格是假的** —— 觸發條件正是「這張單已經全額退款」
  //    ⇒ 錢動過。補了員工會以為客人沒收到 ⇒ **他會再退一次**(逐條實查見本檔上方那張表)。
  //    ⚠️ 這一格由 `refund-action-state.test.ts` 釘住,而它釘的是【那個事實】不是這一版措辭。
  already_refunded: '這張訂單已標記為全額退款,不能再發起退款。退款沒有發起。',
  // ✅ 兩半都成立:`refund-actions.ts:218-220` 在任何 RPC 之前 return,而這張單根本沒有卡交易。
  no_card_transaction: '這張訂單沒有信用卡交易紀錄,無法走線上退款。退款沒有發起、錢沒有動。',
  not_refundable: '這張訂單的付款狀態不允許退款,退款沒有發起。',
  // 🔴 措辭三格,而三句的**下一步各不相同**(codex R1 must-fix:第一版一句吃四種世界):
  //    ①明寫「錢沒有動」(指這一次,動錢路徑鐵律)②講得出下一步 ③不得寫成「無法退款」。
  stuck_verdict:
    '這張訂單有一筆退款被人工判定為「沒有動到錢」而還沒有人更正過判定,這次退款沒有發起、錢沒有動。' +
    '請先到「退款異常」清單確認那一筆的判定,更正之後再回來退款。',
  // 🔴 **這一句不得叫他去更正** —— 已經有人更正過了,而更正的結論是「錢動了」。
  //    叫他再去更正一次,等於暗示他把它翻成放行值。**那正是這道閘要防的事。**
  stuck_verdict_money:
    '這張訂單有一筆退款已經被人工更正為「錢有動」—— 那筆錢已經退出去了,這次退款沒有發起、錢沒有動。' +
    '若你確定還要再退一次,請先與主管確認金額,並到「退款異常」清單核對那一筆的紀錄。',
  // 🔴 讀不到 ⇒ **不對錢下任何斷言**,也不叫他去更正(他看不到要更正什麼)。
  // ⚠️ **不寫「重新整理就好」**(R3 nit-1):這一碼也涵蓋「帳本超過顯示上限」那一種,
  //    而那一種**重整一百次也不會自己好** —— 一句做不到的下一步比沒有下一步糟。
  stuck_verdict_unknown:
    '現在讀不到這張訂單的完整退款帳本或判定更正紀錄,為了安全先擋下,這次退款沒有發起、錢沒有動。' +
    '可以先重新整理試一次;若仍然一樣,請通知系統維護(這張單的退款紀錄可能已超過顯示上限,重整不會改善)。',
  record_unavailable:
    '查不到 TapPay 交易現況(連線失敗或逾時),退款沒有發起、錢沒有動。稍後可再試一次。',
  record_shape_bad:
    'TapPay 交易紀錄與這張訂單對不起來(筆數或識別碼異常),退款沒有發起。請停手並通知系統維護。',
  record_state_bad:
    'TapPay 端的交易狀態不允許退款(可能已退畢、已取消或待付款),退款沒有發起。請先到 TapPay 後台對帳。',
  nothing_left:
    'TapPay 端已無可退金額,退款沒有發起。若你剛才有送過退款,請重新整理查看這張單的退款狀態,勿直接重發。',
  ledger_full: '這張訂單的退款帳本已滿(已標記全額退款),退款沒有發起。',
  in_flight:
    '這張訂單已有一筆退款正在處理中,這次沒有重複發起。請稍後重新整理查看結果;若超過 30 分鐘未完成,會出現在異常清單。',
  // 🔴 措辭鐵律(`refund-ledger-view.ts:4-8`):三句都**不得**出現「還能退」「剩餘可退」——
  //    值班照著錯的名字按下去 = 同一筆錢退兩次。oracle = `refund-wiring.test.tsx:341`。
  // ⚠️ 三句**這一片先不報數字**,但理由不是「不能報」——`Q-445-R4-1` 已拍 **A**(2026-08-14):
  //    守門式要**扣掉已取消金額**(部分取消不下修 `orders.total`;`admin_cancel_order` 只寫
  //    cancelled_at/cancelled_reason/updated_at,`20260805100000:462-467`)⇒ A 案落地後那個數字
  //    才等於「該退的錢」。數字進訊息 + 可點錨點 = **445a-2**,排在 445b 的新式子之後。
  //    🔴 在 445b 落地前就把數字寫進這三句 = 講一個比實際可退額高的數,正是措辭鐵律要防的事。
  exceeds_remaining:
    '退款金額超過這張單目前可受理的上限,退款沒有發起、錢沒有動。請降低金額後重新發起。',
  exceeds_in_flight:
    '這張單有另一筆退款佔著額度(處理中,或已失敗但需人工判定),所以這次被擋下、錢沒有動。請先到下方「退款紀錄」把那一筆處理掉,再回來發起。',
  // 🔴 關卡2 nit:這裡**不准用 Markdown 粗體** —— `refund-section.tsx` 是
  //    `<p role='alert'>{state.message}</p>` 純文字輸出,沒有任何 renderer
  //    ⇒ 寫 `**不是**` 員工會看到字面上的星號。動錢路徑的訊息不留這種雜訊。
  exceeds_unknown:
    '算不出這張單目前的退款額度,退款沒有發起、錢沒有動。這不是金額問題,請勿重試,並通知系統維護。',
  deferred:
    'TapPay 尚未請款,這筆退款現在還不能做(這次的請求已作廢、錢沒有動)。請款完成後,請重新發起一次。',
  rejected:
    'TapPay 拒絕了這筆退款(金額超出可退範圍),這筆已記為失敗、錢沒有動。請先對帳確認可退金額,再重新發起。',
  not_sent:
    '退款請求沒有送出(參數未通過檢查),這筆已記為失敗、錢沒有動。修改內容後可重新發起。',
  held:
    'TapPay 受理的金額與登記金額不符,這筆退款已保留為「狀態確認中」。請通知系統維護走對帳流程;不要重複發起。',
  unknown_state:
    '退款狀態不明(請求可能已送達 TapPay)。請勿重試、勿重複發起;這筆會保留在處理中,請通知系統維護對帳確認。',
  finalize_failed:
    '退款結果已確定(錢沒有動),但帳本結案沒有完成;這筆會保留在處理中並進異常清單。請通知系統維護,勿重複發起。',
  config:
    '金流環境設定不完整或不一致,退款沒有發起。這不是重試會好的問題,請通知管理者檢查環境設定。',
  // 🔴 **這一句是 Sean 2026-08-30 逐字核可的原句,一個字都沒有加。**
  //    端他的題與他的原話「可以」在 `~/pcm-mailbox/plan-PCM04映射-20260830.md` §4 與主視窗當日對話。
  //    ⇒ 落點寫在這裡是為了讓下一個想改它的人知道**它被誰定過** —— 不是我們隨手寫的。
  // ⚠️ 而我端他的是這一句、不是我原本的草稿;草稿多兩件事,**兩件都還沒有他的字**:
  //    ① ⛔ ~~草稿說「資料庫設定」而這句說「系統設定」~~ ✅ **2026-08-31 已解決:改成「資料庫設定」**
  //    ② 草稿有「退款沒有發起、錢沒有動」—— ⛔ ~~本檔其餘每一句失敗訊息都帶這句~~
  //       🔴 **那句話是假的(關卡2 must-fix 2 實量:30 條裡 19 條沒帶,8 條兩句都沒帶)**,
  //       而我拿它當端 Sean 那題的理由 ⇒ **一個前提為假的決策題**。舊字面留著。
  //       ✅ 真正的理由不靠「大家都有」,靠這一句本身:**PCM06 時交易已回滾、錢確實沒動**,
  //          而員工看不到這句可能以為錢已經出去了 —— 那是**這一格自己**的事實,不是慣例。
  //    ⇒ ⛔ ~~兩件都已端回去問,不自行補字~~ ✅ **2026-08-31 兩件都定稿了(Sean「依照推薦」)。**
  //    🔵 而那段等待是有價值的:**在他回答之前,這裡放的是他核可過的那一版,不是我補的字。**
  // 🔴 **定稿(Sean 2026-08-31,原話「依照推薦」⇒ `-48` 端的五題全推甲 ⇒ 兩格都甲)**:
  //    ④ 甲 =「系統設定」⇒「**資料庫設定**」· ⑤ 甲 = 補上「退款沒有發起、錢沒有動。」
  // ⛔ ~~'系統設定與預期不符,請通知維護。'~~(2026-08-30 他核可的第一版,舊字面留著)
  // ⚠️ **而這個授權的形狀要寫下來**:他答的是「依照推薦」——
  //    **他沒有逐題看選項字面,他批的是那份推薦**。⇒ 引用它時不要寫成「他選了甲」。
  db_config: '資料庫設定與預期不符,請通知維護。退款沒有發起、錢沒有動。',
  // 🔴 涵蓋 G4 指紋不符(plan §2 G4 fable N7):full 重送時凍結額隨 Record 漂移 → RAISE 落進本碼,
  //    那不是系統壞掉、是「金額已變動」—— 文案必須讓員工知道正確動作是重新發起,而非一味停手。
  bug:
    '系統呼叫異常,退款狀態請以訂單頁與對帳為準。若你是把同一張退款表單重新送出,可能是可退金額已變動——請重新整理頁面後重新發起;否則請停手並通知系統維護,不要重複按送出。',
  error:
    '退款登記未完成,可以用同一張表單稍後再試——系統會辨識這筆請求並回報它的現況;請不要重新整理頁面後另開新請求。',
};

/** 失敗時帶回的員工輸入(Q1=A:退款原因是打字成本最高的一欄,必須留住)。 */
export type RefundFormInput = {
  kind: string;
  amount: string;
  reason: string;
  confirmCode: string;
};

export const EMPTY_REFUND_INPUT: RefundFormInput = {
  kind: '',
  amount: '',
  reason: '',
  confirmCode: '',
};

/** action 回傳型別(`useActionState` 的 state)。 */
export type RefundActionState =
  | { status: 'idle'; requestToken: string }
  | {
      status: 'failed';
      code: RefundFailureCode;
      message: string;
      /** 🔴 員工輸入原樣帶回。唯一空殼例外=denied(授權閘在讀表單之前);disabled 的
       *  carryBack 在旗標閘之前已讀到表單 ⇒ 帶的是真輸入(RW2d R1 N3 更正本行過期字面)。 */
      input: RefundFormInput;
      /** 🔴 去向依 FRESH_TOKEN_CODES(檔頭三種去向)。 */
      requestToken: string;
    };

/**
 * 組失敗 state。token 去向在**這裡集中決定**,呼叫端不必(也不准)自己判斷 ——
 * 分散判斷正是「某條路忘了換鍵/忘了保留」這類洞的來源。
 */
/**
 * 🔴 稽核連寫都沒寫成時,接在訊息後面的那一句(主視窗 2026-08-21 條件④)。
 *
 * 為什麼要有它:unknown-state 的稽核是 best-effort。**寫失敗如果只進 console,
 * 就複製了這條線本來的病** —— 我們做一個東西來解決「留不下痕跡」,而它自己也可能留不下痕跡,
 * 而畫面上看起來一切正常。這一句把那個失敗**從無聲變成有聲**。
 *
 * ⚠️ 純文字,**不准用 Markdown** —— `refund-section.tsx` 是 `<p role='alert'>{state.message}</p>`,
 *    沒有任何 renderer(同檔 `exceeds_unknown` 上方那條註解已經記過一次)。
 */
/**
 * 🔴 **原本這句寫「連內部紀錄都沒有寫成,系統事後查不到它」——那是一句可能為假的話。**
 * (codex R2 F2)逾時只代表我們不等了,那個寫入**可能第 3.1 秒才成功**;
 * 連 reject 都不保證沒寫進去(insert 已 commit、回應才斷線)。
 * ⇒ 只能說「**無法確認**」。字面必須等於事實 —— 而它會被員工照著做事。
 */
export const REFUND_AUDIT_UNCONFIRMED_SUFFIX =
  '另外:這筆的內部紀錄有沒有寫成,系統無法確認。請立刻截圖這個畫面,並通知系統維護。';

/**
 * ⟦b4-CAPMSGNUM⟧ **DB 算好的上限接在訊息後面的那一句。**
 *
 * 🔴 **措辭鐵律(`refund-ledger-view.ts:4-8`)禁「還能退」「剩餘可退」** ——
 *    這裡用的是【那句話自己已經在用的詞】「上限」,不新造名詞。
 * 🔴 **不准用 Markdown**:`refund-section.tsx` 是 `<p role='alert'>{state.message}</p>`,
 *    純文字輸出,寫粗體員工會看到字面上的星號(同檔 `exceeds_unknown` 上方那條註解)。
 * 🔴 **單位跟著 DB 走**:`20260830210000` 那句人話逐字是「只剩 % 元可退」⇒ 這裡也用「元」。
 *    ⇒ 兩邊用不同單位詞是一個**看不出來**的錯:畫面正常、數字對、而意思差 100 倍。
 * ⚠️ **這句話的字面仍然是 Sean 的** —— 本片做的是【讓那個數字拿得到】。
 *    他要改字, 改這一行即可(而 `refund-money-line-forbidden.test.ts` 會繼續守住禁字)。
 */
function remainingCapSuffix(cap: number | null | undefined): string {
  // 🔴 **【codex R1 MF1】不得寫「目前的上限是」** —— 那句話是假的。
  //    那個數字是 DB 在**擋下這一發的那一刻**算的, 而例外一回滾, 鎖就放掉了
  //    ⇒ 別的交易可以立刻改變它 ⇒ 員工讀到它的時候, 它已經是**過去式**。
  //    ⇒ 📌 而寫成「目前」的代價是具體的:員工照著那個數字重送, 又被擋一次,
  //      而他會以為是系統壞了 —— **一個過期的數字比沒有數字更難處理。**
  //    ⇒ ⇒ 所以字面寫「剛才算出來的」, 並明說可能已經變了。
  //    🔵 這與 §6-b 的「數字要離開量測現場時把範圍寫在旁邊」是同一條, 而這裡的範圍是【時點】。
  //
  // 🔴🔴 **【codex R3 —— 換角度那一輪抓到的, 而它比前兩輪的都重】**
  //    前兩輪問的是「這片碼對不對」。R3 問的是「員工看到那句話之後【下一步會做什麼】」。
  //    ⇒ 答案:**他很可能直接照那個 X 重送。**
  //    ⇒ 而 X 是【系統容許的最高額】, 不是【這次該退給客人的金額】——
  //      它已經扣掉處理中/已完成的退款, 但它不知道這一筆的退款【目的】是什麼。
  //    🛑 **⇒ 所以本片如果只是印一個數字, 它把一個【模糊的問題】換成一個【更有權威感的錯誤提示】**
  //      —— 而那比沒有數字糟:員工照著退, 而那個數字看起來是系統給的。
  //    ⇒ ⇒ 所以那句話必須自己說出「這不是該退的金額」。**這一句不是禮貌, 是這片能不能上的條件。**
  //    🔵 codex R3 逐字建議「先把訊息改成明確警告 X 不是應退金額,請勿直接照抄」⇒ 已照做。
  return typeof cap === 'number' && Number.isSafeInteger(cap) && cap >= 0
    ? `(剛才算出來的上限是 ${cap} 元。這是系統容許的最高額,不是這次該退的金額 —— ` +
      `請先確認這次要退多少,再重送;這個數字也會隨其他退款變動。)`
    : '';
}

/**
 * ⟦b4-CAPMSGNUM⟧ 全部失敗碼。
 *
 * 🔴 **分母由碼表自己產, 不是手打一份清單** —— 手打的那份在下一次加碼時會**安靜地少一格**,
 *    而少掉的那一格正是「沒有人想到要檢查」的那一個。
 *    (本檔另一支測試裡就有一份手打的 `ALL`, 而它只列了 7 個。)
 */
export const REFUND_FAILURE_CODES = Object.keys(FAILURE_MESSAGES) as RefundFailureCode[];

export function refundFailure(
  code: RefundFailureCode,
  input: RefundFormInput,
  submittedToken: string,
  options?: { readonly auditUnconfirmed?: boolean; readonly remainingCap?: number | null },
): RefundActionState {
  const base = `${FAILURE_MESSAGES[code]}${remainingCapSuffix(options?.remainingCap)}`;
  return {
    status: 'failed',
    code,
    message: options?.auditUnconfirmed ? `${base}${REFUND_AUDIT_UNCONFIRMED_SUFFIX}` : base,
    input,
    requestToken: FRESH_TOKEN_CODES.has(code) ? generateRefundRequestToken() : submittedToken,
  };
}
