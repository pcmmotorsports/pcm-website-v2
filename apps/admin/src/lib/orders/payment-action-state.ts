// payment-action-state.ts — M-4b E10 #15-B2-b:手動收款登錄 action 的回傳 state 與**逐碼映射**。
//
// 🔴🔴 **本檔會被 client 端 import**(表單用 `useActionState` 接 state)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。目前零 import、零 IO、零敏感值。
//
// 🔴 **本片真的需要表單一次性冪等鍵**:`admin_record_manual_payment` 的 `p_request_id`
//    在 `order_payments` 上有 UNIQUE(`order_payments_request_id_uniq`)、且 RPC 的 G8
//    逐欄比對六個輸入(`20260810200000:271-283`)—— 同鍵同內容回 `idempotent:true`、
//    同鍵**不同內容**一律通用 RAISE。⇒ 每次 render 重產 = 手滑按兩次就記兩筆收款。
//
// 🔴 **文案全部暫定稿**(鎖結構不鎖字),待 Sean 肉眼驗後定案。

/** 表單欄位名(解析器與表單共用單一真相)。 */
export const PAY_ORDER_ID_FIELD = 'order_id';
export const PAY_RAIL_FIELD = 'rail';
export const PAY_AMOUNT_FIELD = 'amount';
/** 匯款軌的**銀行入帳日**(`<input type="date">`,`YYYY-MM-DD`)。現金軌沒有這一欄。 */
export const PAY_RECEIVED_DATE_FIELD = 'received_date';
export const PAY_BANK_REFERENCE_FIELD = 'bank_reference';
export const PAY_PAYER_NOTE_FIELD = 'payer_note';
/**
 * 一次性冪等鍵(RPC 參數型別是 **uuid**,不是 text)。
 *
 * 🔴 **冪等的作用域是「這張單」不是全域**(opus R2 nit6):
 *    `20260810100000:381-383` 逐字 —— `CREATE UNIQUE INDEX order_payments_request_id_uniq
 *    ON public.order_payments (order_id, request_id) WHERE request_id IS NOT NULL`
 *    ⇒ 同一把鍵用在**另一張單**上,DB **擋不到**、會是兩筆各自成立的收款。
 *    ⇒ B2-c 換單就必須重鑄(用 `mintPaymentFormStamp()`),不可跨單沿用同一把。
 */
export const PAY_REQUEST_ID_FIELD = 'request_id';

/**
 * 🔴 **現金軌的收款時點,由 server 在「鑄表單」那一刻蓋章、隨表單送出**(關卡2 codex MF1)。
 *
 * 為什麼不是在 action 裡 `new Date()`:那樣**同一把冪等鍵重送會得到不同的時點** ——
 * RPC 的 G8 逐欄比對六個輸入(`20260810200000:271-283`,`received_at` 也在內),
 * 對不上就一律通用 RAISE ⇒ 首送已 commit、回應在半路掉了的那次重送,
 * 員工會看到「失敗」,而錢其實已經在帳上。
 *
 * 🔴🔴 **lockstep 是機制、不是口頭約定**(opus R2 MF3):`mintPaymentFormStamp()`
 *    **一次回兩個值**,B2-c 只准用它 ⇒ 物理上鑄不出「只換一半」的組合。
 *    ⚠️ **姊妹片的先例正好相反、不可照抄**:`receipt-record-form.tsx:81` 逐字
 *    `const [requestId, setRequestId] = useState('')` —— **client 端鑄鍵**。
 *    照抄的後果很具體:`request_id` 活在 client state、`cash_received_at` 來自 server render
 *    ⇒ 一次 `router.refresh()` 只換掉 server 那半 ⇒ 同鍵不同內容 ⇒ G8 通用 RAISE
 *    ⇒ **一次合法的首次送出被拒**,而員工完全看不出原因。
 *
 * ⚠️ **已知天花板(刻意收下)**:時點 = **開表單**的時刻,不是按下送出的時刻。
 *    表單開著很久才送 ⇒ 兩者會差,而且**差值沒有上界、系統一律靜默接受**
 *    (RPC 只擋未來與早於建單,中間任何值都合法)。真要「按下去那一刻」又要保住冪等,
 *    得由 RPC 自產時點(Q1=A「由人輸入」下不成立)⇒ 不在本片自作主張。
 * ⚠️ **本層無法保證這個值真的是 server 蓋的**(FormData 可偽造)—— 蓋章是 B2-c 的事,
 *    本層只驗形狀;越界的值由 RPC 的 G4(未來)與 G7(下限)擋。
 *    🔴 **「與匯款軌日期欄同處境」只在『界』上成立,出處上不成立**(opus R2 nit7):
 *    匯款日是**人工輸入、有人負責**;現金這個值對外**宣稱是系統蓋的章**,
 *    被偽造之後帳上會出現一個追不到人的時點。⇒ **B2-c 的 UI 文案不得寫「系統自動記錄」**
 *    這類把它講成可信來源的話。
 */
export const PAY_CASH_RECEIVED_AT_FIELD = 'cash_received_at';

/** 成功後 PRG 帶的結果碼。 */
export const PAYMENT_RECORDED_RESULT_CODE = 'payment_recorded';
/** 冪等重放(同鍵同內容)⇒ 對員工等同成功:那筆收款已經在帳上。 */
export const PAYMENT_DUPLICATE_RESULT_CODE = 'payment_duplicate';

/**
 * 本表單做得出來的兩條軌。
 *
 * 🔴 **`card` 不在裡面是 RPC 的規則,不是 UI 偏好**(`20260810200000:162-166` 明文拒收)——
 *    但列表**讀得到** card(正式站現況全是它)⇒ 讀寫兩側的軌別集合本來就不同,別互相對齊。
 */
export const PAYMENT_RAILS = ['bank_transfer', 'cash'] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

export type PaymentFailureCode =
  // ── RPC 的具名 SQLSTATE(逐碼映射,見 `paymentFailureCodeFor`)
  | 'isolation' // P8C01
  | 'actor_invalid' // P2B39
  | 'received_at_out_of_range' // P2B38(一碼兩義)
  | 'refunded_state' // P2B41
  | 'row_count' // P2B40
  | 'rejected' // P0001(一碼多義:輸入形狀 + 業務拒絕)
  | 'forbidden' // 42501
  // ── app 層自己的閘
  | 'denied'
  | 'invalid'
  | 'bug'
  | 'error';

/**
 * 🔴 **逐碼映射,fail-closed**(plan §3.2 + codex must-fix #10)。
 *
 * 🔴 **不得走 `classifyPgError`**:那支只認 `P0001`、其餘一律歸「可重試」⇒ 具名碼會被講成
 *    「網路問題請稍後再試」,而重試**永遠不會好**(#371 的症狀就是這個)。
 * 🔴 **三分,不是二分**(關卡2 codex MF3 → opus R2 MF1,兩輪各修一半):
 *    · **DB 噴的、語意明確的碼**(`22007` 畸形日期 / `57014` statement timeout / 任何
 *      非連線類 SQLSTATE)⇒ 那個 statement 已中止、整筆回滾 ⇒ `'bug'`(文案逐字「沒有寫入」)。
 *    · **連線類的碼** ⇒ `'error'`(文案逐字「可能已經寫進去了」)。**這一格是 R2 補的**:
 *      我原本寫「有碼 ⇒ 一定沒寫入」,**對連線類不成立** —— postgrest-js 對非 2xx 是
 *      `error = JSON.parse(body)`(`PostgrestBuilder.ts:513`),`code` 是回應方寫什麼就是什麼,
 *      **不是** statement 中止的證明。COMMIT 成功之後才斷線,照樣會帶著碼上來。
 *    · **空字串的碼** ⇒ `'error'`。⚠️ 真實的 client 端網路失敗**不是缺鍵、是 `code: ''`**
 *      (同檔 `:378` 逐字 `let code = ''`、`:430` 原樣塞進 error 物件)。
 *    ⇒ 兩個方向的假話都要避免:對確定沒寫入的說「可能已經寫進去」= 白查一輪帳;
 *      對可能已寫入的說「沒有寫入」= 員工再登一次、**換了新的 request_id、G8 擋不到 ⇒ 重複入帳**。
 *
 * ⚠️ `P2B02`(隔離閘)不在本表:本 RPC 的隔離閘噴的是 **`P8C01`**
 *    (`20260810200000:135` 逐字),與到貨線那支不同碼。照抄會得到一格永遠不觸發的假映射。
 */
const SQLSTATE_TO_FAILURE: Record<string, PaymentFailureCode> = {
  P8C01: 'isolation',
  P2B39: 'actor_invalid',
  P2B38: 'received_at_out_of_range',
  P2B41: 'refunded_state',
  P2B40: 'row_count',
  P0001: 'rejected',
  '42501': 'forbidden',
};

/**
 * 🔴 **連線類的碼:寫進去了沒**,一律不確定。
 *  · `08*` = PG 的 connection exception 族;`57P0*` = admin shutdown / crash shutdown。
 *  · `PGRST000-003` = PostgREST 自己的連線/啟動類碼(它連不到 DB、或還沒起來)。
 * 這些都可能發生在**交易已經 COMMIT 之後**,所以不能講「沒有寫入」。
 */
function isConnectionClass(sqlstate: string): boolean {
  return (
    /^08/.test(sqlstate) ||
    /^57P0/.test(sqlstate) ||
    /^PGRST00[0-3]$/.test(sqlstate)
  );
}

export function paymentFailureCodeFor(sqlstate: string | null | undefined): PaymentFailureCode {
  // 沒有碼(或空字串=真實的 client 端 fetch 失敗)⇒ 真的不確定寫進去了沒。
  if (typeof sqlstate !== 'string' || sqlstate === '') return 'error';
  const known = SQLSTATE_TO_FAILURE[sqlstate];
  if (known !== undefined) return known;
  // 🔴 順序有意義:先認具名碼,再挑連線類,最後才是「DB 噴的、確定中止」。
  if (isConnectionClass(sqlstate)) return 'error';
  return 'bug';
}

/**
 * 員工看到的字。🔴 中文字面暫定、結構鎖字不鎖。
 *
 * 三條特別交代:
 * ① `received_at_out_of_range` 是**一碼兩義**(未來 / 早於建單),而 app 層**拿不到 constraint 名**
 *    (PostgREST 的錯誤物件不帶它)⇒ 一句話要同時涵蓋兩邊,不能猜。
 * ② `row_count` **必須叫員工不要重按**:那是 `order_payments` 上有 BEFORE INSERT trigger
 *    靜默吞列的病(`20260810200000:298-307`),整筆已回滾、重按只會再吞一次。
 * ③ `error` 的措辭**不可以是「請重試」** —— 連線在半路斷掉時那筆可能已經 commit,
 *    叫他重試就是叫他製造第二筆收款。
 */
const FAILURE_MESSAGES: Record<PaymentFailureCode, string> = {
  isolation: '系統設定有問題(交易隔離層級不對),這筆收款沒有寫入。請找工程處理,不是稍後再試。',
  actor_invalid: '你的操作者身分無效或已停用,這筆收款沒有寫入。請重新登入;還是不行請找工程。',
  received_at_out_of_range:
    '收款時點不在可接受的範圍 —— 不能填未來的時間,也不能早於這張單成立的時間。請改日期。',
  refunded_state: '這張單已經有退款紀錄,不能再登錄收款。',
  row_count:
    '收款帳本沒有收到這筆(系統異常,已整筆回滾)。🔴 **請不要重複按送出**,先找工程確認。',
  // 🔴🔴 `P0001` **不只是「這張單不能登錄」** —— 它也涵蓋 RPC 的 G8「同一把鍵、內容不一樣」
  //    (`20260810200000:271-284`:六欄有一欄對不上就走通用 RAISE)。
  //    而「同一把鍵已經有一筆」意味著**那一筆已經 commit 了**。⇒ 災難序(Fable R4 F1):
  //    首送 commit、回應斷 → `'error'`(照規則沿用同一組 stamp)→ 員工改了金額重送 →
  //    G8 內容不符 → `P0001` → 若這句叫他「重新整理再試一次」= 重鑄新鍵 → **第二筆入帳**。
  //    ⇒ 這句**必須先叫他看明細**,重新整理只能排在確認之後。
  rejected:
    '這張單現在不能登錄收款,或是送出的內容不正確。' +
    '🔴 **先看收款明細有沒有已經登錄的那一筆**(可能上一次其實已經記進去了);' +
    '確認沒有之後,再重新整理頁面確認這張單的狀態、重新送一次。',
  forbidden: '沒有權限執行這個動作,這筆收款沒有寫入。請找工程確認權限設定。',
  denied: '沒有權限或登入狀態已失效,這筆收款沒有寫入。',
  invalid: '表單內容不正確,這筆收款沒有寫入。',
  // 🔴 `bug` 同時涵蓋「app 層自己判定的異常」與「DB 噴了我不認得的碼」——
  //    後者**確定沒有寫入**(statement 已中止、整筆回滾),文案要講死,不要留餘地。
  bug: '系統狀態異常,這筆收款沒有寫入。請重新整理這張單確認之後再操作,不要重複按送出。',
  // 🔴 只有「連錯誤碼都沒有」「連線類的碼」「已寫入但讀不懂」才走這句。
  // 🔴🔴 **這句話絕對不可以叫員工「重新整理」**(窄確認輪 MF4:折面②與折面③互打)——
  //    重新整理會讓 server 重新 render ⇒ **重鑄一把新的 `request_id`** ⇒ 再送出時
  //    RPC 的 G8 認不出這是同一次 ⇒ **擋不到 ⇒ 真的變成第二筆收款**。
  //    ⇒ 文案只准叫他**往下看列表**,並明說重新整理會發生什麼事。
  error:
    '寫入失敗,但這筆收款**可能已經寫進去了**。請直接看下方的收款明細裡有沒有這一筆:' +
    '有就是已經記好了(不用再送);沒有才重新送出這張表單。' +
    '🔴 **先不要重新整理頁面** —— 重新整理會換一把新的鍵,那時再送就會變成第二筆收款。',
};

/** 員工剛才打的內容(失敗時原樣帶回;不帶回 = 「保留輸入」是空宣稱)。 */
export type PaymentFormValues = {
  rail: string;
  amount: string;
  receivedDate: string;
  bankReference: string;
  payerNote: string;
};

export const EMPTY_PAYMENT_VALUES: PaymentFormValues = {
  rail: '',
  amount: '',
  receivedDate: '',
  bankReference: '',
  payerNote: '',
};

export type PaymentActionState =
  | { status: 'idle' }
  | {
      status: 'failed';
      code: PaymentFailureCode;
      message: string;
      values: PaymentFormValues;
    };

/**
 * 🔴 **丟出來的東西 → 給員工的碼**(窄確認輪 MF2:把分派做成機制,不要留給每個呼叫端自己 catch)。
 *
 * B2-b2 的 action 只准這樣寫:`catch (e) { return paymentFailure(paymentFailureCodeForThrown(e), carried); }`
 * —— 通用的 `catch → 'bug'` 會把**已經寫進去**的那種失敗講成「沒有寫入」,
 * 員工於是再送一次(而且如果他先重新整理,鍵也換了)⇒ **重複入帳**。
 *
 * 🔴🔴 **但那個 `try` 絕對不可以把 `redirect()` 包進去**(Fable R4 F2:上面那句話與 PRG 相撞)——
 *    Next 的 `redirect()` **是用 throw 實作的**。照字面把成功路徑一起包進同一個 try:
 *    寫入成功 → `redirect()` 拋 `NEXT_REDIRECT` → 被這個 catch 接住 →
 *    它既沒有 `wrote` 也沒有 `sqlstate` ⇒ 落 `'bug'` ⇒ 逐字說「沒有寫入」⇒ **重複入帳**。
 *    ⇒ 硬條款:**`try` 只包 parse 與 `recordManualPayment`;`redirect()` 一定在 try 之外**
 *    (姊妹片 `receipt-actions.ts:38-40` 立過同一條,理由逐字相同)。
 *    真的非包不可時,catch 第一件事是把 `NEXT_REDIRECT` 原樣 rethrow。
 *
 * 🔴 用**結構**判斷不用 `instanceof`:本檔是 client 也 import 得到的模組,
 *    不能 import server-only 的 repository;而且跨模組邊界的 `instanceof` 本來就脆。
 *  · `wrote === true`(`PaymentWroteButUnreadableError`)⇒ **已寫入** ⇒ `'error'`。
 *  · 有 `sqlstate` 欄(`PaymentWriteError`)⇒ 走逐碼映射。
 *  · 其餘(真的沒預期到的例外)⇒ `'bug'`。
 */
export function paymentFailureCodeForThrown(error: unknown): PaymentFailureCode {
  if (typeof error !== 'object' || error === null) return 'bug';
  const e = error as { wrote?: unknown; sqlstate?: unknown };
  if (e.wrote === true) return 'error';
  if (typeof e.sqlstate === 'string' || e.sqlstate === null) {
    return paymentFailureCodeFor(e.sqlstate as string | null);
  }
  return 'bug';
}

/** 組失敗 state。訊息表與碼一對一 ⇒ 新增碼卻忘了寫訊息會在型別層轉紅。 */
export function paymentFailure(
  code: PaymentFailureCode,
  values: PaymentFormValues,
): PaymentActionState {
  return { status: 'failed', code, message: FAILURE_MESSAGES[code], values };
}
