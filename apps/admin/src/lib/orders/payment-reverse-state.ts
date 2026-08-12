// payment-reverse-state.ts — M-4b E10 #372-A12 入口片:沖銷 action 的回傳 state 與**逐碼映射**。
//
// 🔴🔴 **本檔會被 client 端 import**(島元件顯示 `message`)⇒ **不得**引入 `server-only`
//    或任何 server 專用模組。目前零 import、零 IO、零敏感值。
//
// 🔴 **不與 `payment-action-state.ts` 合檔**:那支是**登錄**表單的碼表,兩支 RPC 的碼集合不同
//    (登錄 `P2B39`/`P2B40` vs 沖銷 `P2B42`/`P2B43`)。合檔的第一個後果就是有人照抄隔壁那格,
//    得到一格永遠不觸發的假映射 —— 那支自己的 :107-108 已經記過一次同款的坑。
//
// 🔴 **沖銷 RPC 沒有冪等鍵**(`admin_reverse_manual_payment(p_payment_id, p_actor, p_reason)`
//    三個參數,見 `database.types.ts` 的 `Args`)⇒ 本檔**沒有**登錄那支的「印章」機制,
//    別照抄。防重送靠的是 RPC 的 G8(`reverses_payment_id` 查已沖),不是 app 層。

/**
 * 失敗碼。
 *
 * 🔴 `unknown` 與 `wrote` 是**兩件事,不可合併**:
 *  · `unknown` = 我們**不知道**沖銷成功了沒(連線斷在半路)⇒ 文案要走雙分支。
 *  · `wrote`   = RPC **已經 COMMIT**、只是回傳形狀讀不懂 ⇒ 文案要講死「已完成」。
 * 合成一個的話,已完成的那種會拿到「可能沒完成、沒有就再沖一次」——
 * 而員工照做時那筆已經沖掉了,他會去沖**列表上新出現的那列負數**(那是沖銷紀錄本身)
 * ⇒ 原本那筆收款被加回帳上。
 */
export type ReverseFailureCode =
  // ── RPC 的具名 SQLSTATE(逐碼映射,見 `reverseFailureCodeFor`)
  | 'isolation' // P8C01
  | 'actor_invalid' // P2B42
  | 'not_reversible' // P2B44(一碼兩義:卡軌拒 / 已被沖銷)
  | 'row_count' // P2B43(一碼兩義:沖銷列筆數 / 稽核筆數)
  | 'rejected' // P0001(一碼五義)
  | 'forbidden' // 42501
  // ── 不是 SQLSTATE 的兩個
  | 'unknown' // 連線類 / 空碼:不知道寫進去了沒
  | 'wrote' // 已 COMMIT、回傳讀不懂
  // ── app 層自己的閘
  | 'denied'
  | 'invalid'
  | 'bug';

/**
 * 🔴 **逐碼映射,fail-closed**。三分同姊妹片 `payment-action-state.ts:95-105`:
 *  · 具名碼 ⇒ 自己那格;
 *  · 連線類 ⇒ `unknown`(**可能已經 commit**,不得講「沒有寫入」);
 *  · 其餘 DB 噴的碼 ⇒ `bug`(statement 已中止、整筆回滾)。
 *
 * ⚠️ 碼的來源=`20260812150000:364-480` 逐行讀出的 11 個 `RAISE`
 * (含**沒有** `USING ERRCODE` 的 5 條,那些走 PG 預設的 `P0001`):
 * `P8C01`×1 / `P2B42`×1 / `P2B44`×2 / `P2B43`×2 / `P0001`×5。
 * 另加 PG 層的 `42501`(無 EXECUTE 權限)—— 它不在那 11 條裡,是 GRANT 面的碼。
 */
const SQLSTATE_TO_FAILURE: Record<string, ReverseFailureCode> = {
  P8C01: 'isolation',
  P2B42: 'actor_invalid',
  P2B44: 'not_reversible',
  P2B43: 'row_count',
  P0001: 'rejected',
  '42501': 'forbidden',
};

/**
 * 連線類:**寫進去了沒,一律不確定**(同姊妹片 :126-132 的判準,逐字沿用)。
 * `08*` = connection exception 族;`57P0*` = admin/crash shutdown;
 * `PGRST000-003` = PostgREST 自己連不到 DB 或還沒起來。
 * 這些都可能發生在**交易已經 COMMIT 之後**。
 */
function isConnectionClass(sqlstate: string): boolean {
  return /^08/.test(sqlstate) || /^57P0/.test(sqlstate) || /^PGRST00[0-3]$/.test(sqlstate);
}

export function reverseFailureCodeFor(sqlstate: string | null | undefined): ReverseFailureCode {
  // 沒有碼(或空字串=真實的 client 端 fetch 失敗)⇒ 真的不確定。
  if (typeof sqlstate !== 'string' || sqlstate === '') return 'unknown';
  const known = SQLSTATE_TO_FAILURE[sqlstate];
  if (known !== undefined) return known;
  // 順序有意義:先認具名碼,再挑連線類,最後才是「DB 噴的、確定中止」。
  if (isConnectionClass(sqlstate)) return 'unknown';
  return 'bug';
}

/**
 * 🔴🔴 **本表每一句都是合約字面**(plan `D-600-PLAN.md` §12,Sean 2026-08-12 批 v4)。
 *    測試用 `toBe()` 全等比對、不是 `toContain` ⇒ 改任何一個字都會紅。
 *    **要改字必須回頭重問**,不在實作可拍板的範圍。
 *
 * 🔴 **不得寫 markdown 記號或 emoji**:本表的字串會被原樣塞進 DOM
 *    (`**…**` 與 🔴 在畫面上就是字面上的星號跟紅點;姊妹片 :161-164 立過這條)。
 *
 * 🔴 **只有 `unknown` 那句准出現重試指令,而且必須是有條件的**:
 *    其餘每一句都代表「這次呼叫什麼也沒做」或「已經做完了」——
 *    給無條件的「再試一次」會讓員工去按那列不該按的沖銷列。
 */
const FAILURE_MESSAGES: Record<ReverseFailureCode, string> = {
  // ── 核可句 C:唯一的雙分支句。負分支點名「回到原本那一筆」,
  //    因為 RPC 的 G8(`20260812150000:414-422`)保證「沒有沖銷列存在時再沖一次」就是一次正常首沖。
  unknown:
    '沖銷可能已經完成,也可能沒有。請先重新整理這一頁,再看你剛才要沖的那一筆收款:' +
    '如果它已經標成「已沖銷」,就是成功了,到此為止,不要再按任何按鈕。' +
    '如果它沒有「已沖銷」的標記,代表沖銷沒有完成,請回到原本那一筆再沖一次。' +
    '注意:不要去沖列表上新出現的那一列負數,那是沖銷紀錄本身,沖掉它會把原本那筆收款加回帳上。',
  // ── 核可句 D:終態,零重試指令。兩義(卡軌 / 已被沖銷)都代表這次呼叫什麼也沒做,
  //    而重按只會拿到同一個碼。**不宣稱是哪一義**:app 層拿不到 constraint 名(該前提未實測,
  //    見 `shipment-error-view.ts:28` 逐字自陳)⇒ 設計刻意不依賴它。
  not_reversible:
    '這一筆現在不能沖銷。最常見的原因是它已經被沖掉了 —— 可能是你上一次按的其實成功了。' +
    '請重新整理這一頁,看那一筆是不是已經標成「已沖銷」:是的話就已經完成了,不用再做任何事。' +
    '如果不是,請通知系統維護。',
  // ── 核可句 E:已 COMMIT。講死「已經完成」,並明說不要再沖一次。
  wrote:
    '沖銷已經完成了,只是系統讀不懂回應。請重新整理這一頁確認那一筆已經標成「已沖銷」。不要再沖一次。',
  isolation: '系統設定有問題(交易隔離層級不對),這次沒有沖成,整筆已經回滾。請找工程處理。',
  actor_invalid: '你的操作者身分無效或已停用,這次沒有沖成,整筆已經回滾。請重新登入;還是不行請找工程。',
  // 🔴 「這次沒有沖成」這五個字是**守門要求的統一字面**,不是贅字:
  //    整族回滾類訊息都必須含它,才有一條機器驗得到的「方向沒被講反」判準。
  //    (2026-08-12 我自己新加那格當場抓到本句漏了它 —— 改文案,不鬆綁斷言。)
  row_count:
    '沖銷沒有寫進帳本(系統異常),這次沒有沖成,整筆已經回滾,帳上沒有任何變化。請不要重複按,先找工程確認。',
  rejected:
    '這一筆現在不能沖銷,或是送出的內容不正確(例如沒有填沖銷原因),這次沒有沖成,整筆已經回滾。' +
    '請先重新整理這一頁看那一筆的狀態,再決定要不要處理。',
  forbidden: '沒有權限執行沖銷,這次沒有沖成,整筆已經回滾。請找工程確認權限設定。',
  denied: '沒有權限或登入狀態已失效,這次沒有沖成。',
  invalid: '沖銷原因是必填的,請填寫之後再送出。這次沒有沖成。',
  bug: '系統狀態異常,這次沒有沖成,整筆已經回滾。請重新整理這一頁確認之後再操作,不要重複按。',
};

/**
 * 🔴 **丟出來的東西 → 給員工的碼**(同姊妹片 :263-271 的結構判斷,不用 `instanceof`:
 *    本檔 client 也 import 得到,不能 import server-only 的 repository;
 *    而且跨模組邊界的 `instanceof` 本來就脆)。
 *  · `wrote === true` ⇒ **已 COMMIT** ⇒ `'wrote'`。
 *  · 有 `sqlstate` 欄 ⇒ 走逐碼映射。
 *  · 其餘 ⇒ `'bug'`。
 */
export function reverseFailureCodeForThrown(error: unknown): ReverseFailureCode {
  if (typeof error !== 'object' || error === null) return 'bug';
  const e = error as { wrote?: unknown; sqlstate?: unknown };
  if (e.wrote === true) return 'wrote';
  if (typeof e.sqlstate === 'string' || e.sqlstate === null) {
    return reverseFailureCodeFor(e.sqlstate as string | null);
  }
  return 'bug';
}

export type ReverseResult =
  | { ok: true }
  /** `code` 帶過 server↔client 邊界:client 只拿字串的話,只能用正規式去訊息裡撈碼。 */
  | { ok: false; code: ReverseFailureCode; message: string };

/** 組失敗結果。訊息表與碼一對一 ⇒ 新增碼卻忘了寫訊息會在型別層轉紅。 */
export function reverseFailure(code: ReverseFailureCode): ReverseResult {
  return { ok: false, code, message: FAILURE_MESSAGES[code] };
}

/**
 * 給測試用的**唯讀**核可句取用口。
 *
 * ⚠️ 匯出的是查詢函式、不是整張表:表本身匯出的話,測試最省力的寫法會變成
 * 「拿表去比表」(讀表驗表)—— 那正是 R3 F3 抓到的自我引用形狀。
 */
export function reverseMessageFor(code: ReverseFailureCode): string {
  return FAILURE_MESSAGES[code];
}

// ────────────────────────────────────────────────────────────────────────────
// 確認詞(核可句 A / B)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **兩句必須不同,而且沖銷列那句要講明「恢復」**(plan §12 A/B,合約字面)。
 *
 * 一般收款列沖掉 = 這筆錢從「已收」扣掉;
 * **沖銷列**沖掉 = 沖銷之沖銷 = **把原本那筆收款恢復到帳上**(Sean 2026-08-10「誤沖=沖銷之沖銷」)。
 * 兩者方向相反,共用一句確認詞等於在最需要分辨的那一刻不給分辨。
 */
export const REVERSE_CONFIRM_PAYMENT =
  '要沖銷這一筆收款嗎?沖掉之後,這筆錢會從「已收」裡扣掉。原本那一筆不會消失,系統會另外記一列沖銷紀錄。';

export const REVERSE_CONFIRM_REVERSAL =
  '這一列是沖銷更正,不是一筆收款。沖掉它等於把原本那筆收款恢復到帳上,「已收」會加回去。確定要這樣做嗎?';

/**
 * 成功後的正面確認(關卡2 R2 nit7)。
 *
 * 🔴 **為什麼需要一句話,而不是「面板收起來就代表成功」**:收起來與「什麼都沒發生」
 *    在畫面上長得一樣。這條路上「看不出有沒有成功」正是會讓員工再按一次的形狀。
 * ⚠️ 它**不取代**列上的「已沖銷」徽章 —— 徽章是重取之後才會出現的;
 *    這句是重取還沒回來(或 revalidate 失敗)那段空窗期唯一的回饋。
 * 🔴 同 §12 紀律:零 markdown 記號、零 emoji(會原樣進 DOM)。
 */
export const REVERSE_SUCCESS =
  '沖銷完成了。這一筆會標成「已沖銷」,「已收」金額也重新算過。不用再按任何按鈕。';

/** 表單欄位名(解析器與島元件共用單一真相)。 */
export const REVERSE_PAYMENT_ID_FIELD = 'payment_id';
export const REVERSE_REASON_FIELD = 'reason';
