// cancel-action-state.ts — M-4b E10 A9d2-2a:訂單取消 action 的回傳 state + 冪等 token。
//
// 🔴🔴 **本檔會被 client 端 import**(A13b 的表單要用 `useActionState` 接 state、並讀 `requestToken`)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。目前零 IO、零敏感值
//    (唯一 import 是同目錄的 `isUuid`,它也是 client-safe 的純函式)。
//
// 🔴🔴 **本檔與備註片(`note-action-state.ts`)最大的差異 = 失敗後 token 怎麼處理**。
//    備註片是「失敗一律原樣帶回同一顆 token」;**取消片照抄會出事**(plan §2.1、K1-13):
//    取消 RPC 的冪等格把 `payload_hash` 綁進 `p_order_id + p_reason_code + reason_detail +
//    (整單 `:full` / 部分品項 canonical 串)`(`20260805100000:195-198`),
//    而 hash 不符吐的是**與業務拒絕逐字相同**的通用訊息(`:206-208`)。
//    ⇒ 員工在失敗後改了數量或原因、用同一顆 token 重送 ⇒ **必定**撞 hash ⇒ 吃一句看不懂的拒絕,
//      而且「再改改看」永遠過不了。
//
// 🔴 判準是「**有沒有送到 RPC**」,不是失敗碼的嚴重度(plan §2.1;關卡2 更正過一次:
//    v2 只凍結 `retry`/`bug`,漏了 `rejected`/`error` —— 那兩支同樣**已經送達 RPC**)。
//    本檔把這條規則做進**型別**而不是註解:見 `CancelActionState` 的兩種 failed 形狀。

import { isUuid } from './note-action-state';

/** 成功後 PRG 帶的結果碼(理由同 `NOTE_ADDED_RESULT_CODE`:兩邊各打一次字串會靜默 typo)。 */
export const ORDER_CANCELLED_RESULT_CODE = 'order_cancelled';

/** 表單欄位名(解析器與 A13b 表單共用單一真相,避免兩邊各打一次字串)。 */
export const CANCEL_ORDER_ID_FIELD = 'order_id';
export const CANCEL_REASON_CODE_FIELD = 'reason_code';
export const CANCEL_REASON_DETAIL_FIELD = 'reason_detail';
export const CANCEL_MODE_FIELD = 'cancel_mode';
/** 🔴 **可重複**欄位,每個被勾選的品項一筆,值 = `<order_item_id>:<quantity>`(見解析器)。 */
export const CANCEL_ITEM_FIELD = 'cancel_item';
export const CANCEL_REQUEST_TOKEN_FIELD = 'request_token';

/**
 * 產一把冪等 token。
 *
 * 🔴 產生點必須在 server component 的渲染期、且**不得落在任何快取層內**
 * (`unstable_cache` / `React.cache` 會把 token 凍住 ⇒ 多次載入拿到同一把 ⇒ 第二個人送出時
 *  直接撞冪等格)。理由與前例逐字同 `note-action-state.ts:47-51`。
 *
 * 🔴 **形狀驗證刻意不另寫一條正規式**(plan §2 慣例 5):直接用 `note-action-state` 的 `isUuid`
 * —— 那裡的註解 `:61-68` 記著關卡2 抓過的漂移面(同一條正規式養兩份,總有一天會不一樣)。
 * ⚠️ 代價寫清楚:取消線因此**依賴備註線的檔案**。這是刻意的取捨(單一真相 > 模組獨立),
 *    真要拆得把 `isUuid` 抽到共用檔、兩邊一起改,不是在這裡複製一份。
 */
export function generateCancelRequestToken(): string {
  return crypto.randomUUID();
}

/** token 形狀驗證(與產生器同源;轉呼 `isUuid`,不另養正規式)。 */
export function isCancelRequestToken(value: string): boolean {
  return isUuid(value);
}

/**
 * 失敗碼 —— **依「有沒有送到 RPC」分兩組**,不是依嚴重度。
 *
 * 🔴 這個分組就是 plan §2.1 的規則本身:
 * - **沒送到**(`denied` 授權閘 / `invalid` 解析器擋下)⇒ 保留輸入、**換新 token**、表單可編輯。
 *   舊 token 從未送出、沒有冪等價值。
 * - **已送到**(`rejected` / `retry` / `bug` / `error` **四支全部**)⇒ **凍結表單**,
 *   只給「重新整理本單」一條路。理由:①`rejected`/`bug`/`error` 都可能已 commit
 *   (`rejected` 也可能是 hash 不符 = 前一次其實成功了)②就地改值 + 同 token 必撞 hash。
 *   ⚠️ **精確版**(關卡2 兩輪各修一次;不要把「四支都可能已 commit」當事實寫到別處):
 *   - 真的可能已 commit 的只有 `rejected`(可能是 hash 不符 = 前一次其實成功了)與 `error`(未知)。
 *   - `retry`(`55P03`/`40P01`)與 `bug` 裡的 `P8C01`/`23514`/`22003` **都會中止該交易**,不留半筆。
 *   - `bug` 裡的 `PGRST202`(找不到函式)與 `42501`(ACL 被撤)**根本沒進到函式**。
 *   ⇒ 這四支照樣凍結,但理由是**②同 token 撞 hash + 分不出是哪一種**,不是「都可能已 commit」。
 */
export type CancelNotSentCode = 'denied' | 'invalid';
export type CancelSentCode = 'rejected' | 'retry' | 'bug' | 'error';
export type CancelFailureCode = CancelNotSentCode | CancelSentCode;

/**
 * 員工看到的字(plan §4.2 表,逐字)。
 *
 * 🔴 **`bug`/`error`/`retry` 一律叫他「重新整理確認」而不是「稍後再試」** ——
 * 取消帳本 append-only(`20260805100000:17` 對 `order_cancellation_items` 零 UPDATE/DELETE),
 * 「稍後再試」會誘導重按,而重按可能就是第二筆刪不掉的取消。
 * 🔴 `rejected` 也要叫他重新整理:它同時涵蓋「這張單真的不能取消」與「hash 不符
 * (= 前一次其實成功了)」,兩者都不該就地重送。
 */
const FAILURE_MESSAGES: Record<CancelFailureCode, string> = {
  denied: '沒有權限或登入已失效,取消沒有送出。',
  invalid: '表單內容不正確,取消沒有送出。',
  rejected:
    '這張單目前不能取消(狀態可能剛變動)。請重新整理本單確認後再決定,不要重複按。',
  bug:
    '系統狀態異常,取消可能已經寫進去了。請重新整理確認,並通知系統維護,不要重複按。',
  retry: '系統忙碌,這次沒完成。請重新整理本單確認後再送一次。',
  error: '取消可能已經寫進去了。請重新整理本單確認之後再決定要不要重送。',
};

/** 失敗時原樣帶回的員工輸入(只有「沒送到 RPC」那組才帶得回)。 */
export type CancelFormInput = {
  /**
   * 🔴 `'full'` / `'partial'`(關卡2 must-fix 補):少了它,「部分取消但零品項」失敗後
   * state 與整單取消**長得一模一樣** ⇒ 重繪時會把員工彈回錯的模式,
   * 而那兩個模式送出去的後果差很多(整單取消會取消全部品項)。
   * 型別是 string 不是 CancelMode:它是**原樣帶回的員工輸入**,可能根本不合法。
   */
  cancelMode: string;
  reasonCode: string;
  reasonDetail: string;
  /** 原始的 `<order_item_id>:<quantity>` 字串陣列(未解析;整單取消為空陣列) */
  items: readonly string[];
};

/**
 * action 回傳型別(`useActionState` 的 state)。
 *
 * 🔴🔴 **凍結是 UX 層,不是安全邊界**(關卡2 R2 打掉我前一版的整套推理,連續兩處錯):
 *
 * ① **`prevState` 是 client 送回來的參數,不是 server 保存的可信狀態**。`useActionState` 會把
 *    上一輪的 state 序列化給瀏覽器、下一次送出時再帶回來 ⇒ 持有效 session 的人可以偽造 `idle`
 *    繞過任何以它為依據的凍結。⇒ **凍結永遠只能當成「防止誠實員工手滑」**,
 *    絕不可寫成「這樣就不會有第二筆取消」。
 * ② 我前一版還寫了「把凍結判斷排在授權閘之前」—— **錯得更嚴重**:偽造 `prevState: null`
 *    會在授權之前就 TypeError 炸成 500。⇒ **授權閘照舊絕對第一**(plan §2 慣例 1 不偏離、
 *    我先前說要向主視窗申報偏離的那句話作廢),凍結判斷排在它後面,而且要防呆讀:
 *    `if (prevState?.status === 'failed' && prevState.outcome === 'sent') return prevState;`
 *
 * 🔴 **真正擋住「第二筆不可逆取消」的是 RPC 的冪等鍵**(`order_id + idempotency_key` UNIQUE
 *    `20260730130000:118-119` + `payload_hash` 比對 `20260805100000:206-208`),**不是這個型別**。
 *    本檔能做的只有:不讓 action **不小心**拿到一把新鍵。
 *
 * 🔴 **`sent` 為什麼要帶回 `input` 與 `requestToken`**(關卡2 R2 must-fix,推翻我前一版的「都不帶」):
 *    前一版以為「不帶 = 湊不出重送」,但 ①②已證明擋不住;而**代價是真的**——
 *    - 員工看不到自己剛送出什麼 ⇒ 重新整理後對著取消歷程也不知道哪一筆是自己那次;
 *    - 而 A9g 的歷程投影**刻意沒有** `idempotency_key`(片 3 判定它是內部機制)⇒ 沒有 token 就
 *      真的對不起來,併發或舊紀錄會被誤認成本次 ⇒ 可能重複取消、或該做的沒做。
 *    - 反過來,**帶著同一顆 token 反而更安全**:萬一 UI 真的重送,同 token + 同 payload
 *      會被 RPC 吸收成 `idempotent:true`;把 token 丟掉才是在誘導 action 去鑄新的那把。
 *
 * ⇒ 兩種 failed 形狀的差別**只剩語意**:`outcome` 告訴呼叫端「這次有沒有送到 RPC」。
 *   `not_sent` 的 token 是**新鑄的**(舊的沒送出、沒有冪等價值);
 *   `sent` 的 token 是**原本那一顆**(對得起帳本、重送會被冪等吸收)。
 *
 * 🔴 **片 5 / A13b 的義務(本檔保證不了,逐條列出來給它們配測試)**:
 *   1. 授權閘第一;凍結判斷緊接其後,用 `prevState?.` 防呆。
 *   2. `sent` 狀態的表單 `fieldset disabled`,只給「重新整理本單」。
 *   3. 🔴 **「重新整理」必須是整頁重載或讓表單真的 remount**(關卡2 R2 must-fix):
 *      用 `router.refresh()` 不會重置 client state、`useActionState` 也不會重新吃 `initialState`
 *      ⇒ 表單會**永遠卡在凍結**,員工被鎖死。要嘛整頁導頁、要嘛給表單一個會變的 `key`。
 *      A13b 要配一條測試釘住這條。
 *   4. 不要自己手刻 `CancelNotSentState` 字面(會繞過下面 builder 的換鍵機制);
 *      這條型別擋不住,只能靠片 5 的測試。
 */
export type CancelNotSentState = {
  status: 'failed';
  outcome: 'not_sent';
  code: CancelNotSentCode;
  message: string;
  /**
   * 🔴 **必為新鑄的一把**,由 `cancelNotSentFailure` 自己產(關卡2 must-fix:原本是收呼叫端傳什麼
   * 就回什麼 ⇒ 片 5 把舊 token 原樣傳回來完全符合型別、現有測試也全綠)。
   * 舊 token 從未送出、沒有冪等價值,換掉可避免日後撞 hash ——
   * 這件事現在是**本檔的機制**,不是片 5 的自律。
   */
  requestToken: string;
  input: CancelFormInput;
};

export type CancelSentState = {
  status: 'failed';
  outcome: 'sent';
  code: CancelSentCode;
  message: string;
  /**
   * 🔴 **原本那一顆**(不是新鑄的):它是這次寫進 RPC 的冪等鍵,
   * 是員工/維運把畫面對回取消帳本的唯一線索,也讓萬一的重送被冪等吸收。
   */
  requestToken: string;
  /** 🔴 員工剛送出的內容 —— 重新整理後要對得出「哪一筆是我那次」。 */
  input: CancelFormInput;
};

export type CancelActionState =
  | { status: 'idle'; requestToken: string }
  | CancelNotSentState
  | CancelSentState;

/**
 * 組「沒送到 RPC」的失敗 state:保留輸入 + 換新 token。
 * 訊息表與碼一對一 ⇒ 新增碼卻忘了寫訊息會在型別層轉紅。
 */
export function cancelNotSentFailure(
  code: CancelNotSentCode,
  input: CancelFormInput,
): CancelNotSentState {
  return {
    status: 'failed',
    outcome: 'not_sent',
    code,
    message: FAILURE_MESSAGES[code],
    // 🔴 呼叫端**不能**指定 token:能指定就能傳回舊的那把(關卡2 must-fix)。
    requestToken: generateCancelRequestToken(),
    input,
  };
}

/**
 * 組「已送到 RPC」的失敗 state:**原樣**帶回這次用的 token 與員工輸入。
 * 🔴 這裡**刻意不鑄新 token**(與 `cancelNotSentFailure` 相反)——
 *    新鍵 = 全新 payload_hash 列 = 同一份 payload 會真的再取消一次。
 */
export function cancelSentFailure(
  code: CancelSentCode,
  input: CancelFormInput,
  requestToken: string,
): CancelSentState {
  return {
    status: 'failed',
    outcome: 'sent',
    code,
    message: FAILURE_MESSAGES[code],
    requestToken,
    input,
  };
}
