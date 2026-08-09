// cancel-action-state.ts — M-4b E10 A9d2-2a:訂單取消 action 的回傳 state + 冪等 token。
//
// 🔴🔴 **維持 client-safe**(零 IO、零敏感值;唯一 import 是同目錄的 `isUuid`,也是純函式)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。
//    ⚠️ **理由已經換過一次**(A13b D1 更正):原本寫的是「A13b 表單要用 `useActionState` 接 state」——
//    那條路 **plan v3 已經換掉**(React 19 form reset 競態會誤送整單取消 ⇒ 改 PRG 整頁化、零 client state)。
//    現在的理由是:本檔被 `result-banner.tsx`(server component)匯入,而它 4 頁共用;
//    保持零 server 相依也讓 D2 之後若有 client 需求不必再拆檔。
//    🔴 `CancelActionState` 那族型別是**舊形狀的殘留**,D2 退場(plan v3.1 §3)。
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
// 🔴 D5 路由要比對的是**完整前綴 `order_cancel_`(含尾底線)**。
//    寫成 `order_cancel` 會連 `order_cancelled` 一起吞掉 —— 成功碼會被誤判成失敗碼。

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
 *   - 真的可能已 commit 的是 `rejected`(可能是 hash 不符 = 前一次其實成功了)、`error`(未知),
 *     以及 🔴 **`bug` 的「payload 形狀不符」那一支**(A9d2-2b 關卡2 R4 補:plan §4.2 表
 *     `docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:239` 明列它屬 `bug`,而它是
 *     **RPC 成功回傳之後** client 端形狀驗證才失敗 ⇒ 交易**已經 commit 了**。
 *     本段前一版只列五個 SQL/PostgREST 碼就下「`bug` 不可能已 commit」的結論,**漏了這一支**)。
 *   - 確定沒留半筆的只有:`retry`(`55P03`/`40P01`)與 `bug` 裡的 `P8C01`/`23514`/`22003`
 *     **都會中止該交易**;`bug` 裡的 `PGRST202`(找不到函式)與 `42501`(ACL 被撤)**根本沒進到函式**。
 *   ⇒ 這四支照樣凍結,但理由是**②同 token 撞 hash + 分不出是哪一種**,不是「都可能已 commit」。
 *
 * 🔴 **陣列是真相、型別從陣列推導**(A13b D1 關卡2 must-fix,推翻我第一版):
 *    第一版是「手寫兩個 union 型別 + 另外手寫兩個 `as const` 陣列 + `satisfies` 對齊」。
 *    那個形狀有一個**兩邊都不會紅**的洞 —— 把 `invalid` 也加進 `CancelSentCode` 的 union、
 *    陣列一個字都不動:`satisfies` 只檢查「陣列元素都在 union 裡」(仍成立)、
 *    窮舉測試比的是陣列 vs `FAILURE_MESSAGES` 的鍵(也沒變)⇒ **全綠**,
 *    而 `invalid` 從此在型別上可以被塞進「已送達」那條路 = 該凍結卻沒凍結。
 *    改用 `typeof ARRAY[number]` 之後,型別與執行期清單**在結構上是同一份東西**,對不齊做不到。
 */
// 🔴 `Object.freeze`(關卡2 R2):`as const` 只在**編譯期**唯讀 —— 執行期 `Reflect.set()` 改得動陣列,
//    而型別是編譯期產物、不會跟著變 ⇒ 上面「型別與執行期是同一份東西」那句宣稱會破功。
export const CANCEL_NOT_SENT_CODES = Object.freeze(['denied', 'invalid'] as const);
export const CANCEL_SENT_CODES = Object.freeze(['rejected', 'retry', 'bug', 'error'] as const);

export type CancelNotSentCode = (typeof CANCEL_NOT_SENT_CODES)[number];
export type CancelSentCode = (typeof CANCEL_SENT_CODES)[number];
export type CancelFailureCode = CancelNotSentCode | CancelSentCode;

/**
 * PRG 的失敗結果碼(A13b plan v3.1 §1a)—— **一律 namespaced**。
 *
 * 🔴 理由是**碰撞**,不是好看:`?r=` 是訂單明細頁**唯一共用的一顆參數**,
 *    而 `result-banner.tsx` 的訊息表已經被改單線佔用了 `invalid` / `denied` / `error` / `not_found`
 *    ⇒ 取消線若直接送 `?r=invalid`,員工會看到**改單的**「表單內容不正確,未儲存」。
 *    關卡1 R1 finding 10 抓到,R2 再確認一次。
 *
 * 🔴 **用模板字面型別而不是另寫一張對照表**:對照表要把六個碼名再打一次,
 *    那正是本檔開頭 `:21` 在避的「兩邊各打一次字串會靜默 typo」。
 */
export type OrderCancelFailureResultCode = `order_cancel_${CancelFailureCode}`;

export function toOrderCancelResultCode(code: CancelFailureCode): OrderCancelFailureResultCode {
  return `order_cancel_${code}`;
}

/**
 * D2 組導頁 query 的**唯一入口**,而且**刻意拆成三支不相交的簽章**(D1 窄 R3 must-fix)。
 *
 * 🔴 為什麼不留一支扁平的 `toQuery(code, token?)`:那樣「成功路徑最自然的單行寫法」會是
 *    `?r=…` 忘了帶 `rt`,而它**編譯、測試、lint 全綠** —— 症狀要到員工真的取消完、
 *    D5 面板拿不到 token 才浮出來:**畫面一片空白**(比 D1 之前更差,而且落在錢的那一面)。
 *    拆開之後,「已送到 RPC」與「成功」這兩類**在型別上就要不到不帶 token 的版本**
 *    ⇒ D2 忘記帶 = 編譯期紅,不是靠註解提醒下一個人。
 *
 * 🔴 分法對齊唯一判準「有沒有送到 RPC」:
 *    - `notSentResultQuery` —— 沒送到(RPC 從未被呼叫)⇒ **沒有帳本可查**,不需要也不該帶 token。
 *    - `sentResultQuery` —— 已送到、結果不明 ⇒ D5 必須拿 token 去帳本核對,`requestToken` **必填**。
 *    - `cancelledResultQuery` —— 成功 ⇒ 同樣必填:D5 要分得出「這次成功 / 帳本裡的舊紀錄 / 偽造的網址」。
 *
 * ⚠️ 回傳的是 query 字串本體(不含 `?`),呼叫端自己接在路徑後面。
 *    token 是 uuid(`generateCancelRequestToken`)⇒ 無需 encode;不是 uuid 的東西本來就不該走到這裡。
 */
export function notSentResultQuery(code: CancelNotSentCode): string {
  return `r=${toOrderCancelResultCode(code)}`;
}

export function sentResultQuery(code: CancelSentCode, requestToken: string): string {
  return `r=${toOrderCancelResultCode(code)}&rt=${requestToken}`;
}

export function cancelledResultQuery(requestToken: string): string {
  return `r=${ORDER_CANCELLED_RESULT_CODE}&rt=${requestToken}`;
}

/**
 * 員工看到的字(plan §4.2 表,逐字)。
 *
 * 🔴 **`bug`/`error`/`retry` 一律叫他「重新整理確認」而不是「稍後再試」** ——
 * 取消帳本 append-only(`20260805100000:17` 對 `order_cancellation_items` 零 UPDATE/DELETE),
 * 「稍後再試」會誘導重按,而重按可能就是第二筆刪不掉的取消。
 * 🔴 `rejected` 也要叫他重新整理:它同時涵蓋「這張單真的不能取消」與「hash 不符
 * (= 前一次其實成功了)」,兩者都不該就地重送。
 *
 * 🔴 **不得寫成 `Object.freeze({ ... })`**(D1 窄 R3 must-fix,實測):把物件字面直接包進 `freeze()`
 * 會讓 TS 的 **excess-property check 消失** —— 多打一顆不存在的碼**編譯期不紅**
 * (探針三形狀實跑:直接標註→TS2353 紅、`freeze({...})`→**綠**、先宣告再 freeze→紅)。
 * 我在 R2 加 freeze 時就是這樣把自己前一輪驗過的那道閘拆掉的,而註解還留著「tsc 會紅」。
 * ⇒ 形狀固定成「**先宣告 `_SOURCE` 常數(帶標註)→ 再 freeze**」,兩層都在。
 *
 🔴 **A13b D1 起本表被匯出**:`denied` / `invalid` 兩則由 `result-banner.tsx` **逐字沿用**
 *    (PRG 導頁後由 banner 顯示),不在那邊另寫一份 —— 兩份文案遲早會分岔。
 *    ⚠️ 另外四則(`rejected`/`retry`/`bug`/`error`)**目前仍只服務舊的 client state 形狀**;
 *    plan v3.1 §1a 要把它們換成帳本核對面板的動態文案(D5),**在那片落地之前不要說它們已被取代**。
 */
const FAILURE_MESSAGES_SOURCE: Record<CancelFailureCode, string> = {
  denied: '沒有權限或登入已失效,取消沒有送出。',
  invalid: '表單內容不正確,取消沒有送出。',
  rejected:
    '這張單目前不能取消(狀態可能剛變動)。請重新整理本單確認後再決定,不要重複按。',
  // 🔴 本行的「可能已經寫進去了」**是精確的、不是保守措辭**(關卡2 R3 提矛盾 → R4 推翻 R3):
  //    `bug` 涵蓋的「payload 形狀不符」發生在 RPC 成功回傳**之後** ⇒ 那一支真的已經寫進去了。
  //    上面 :64-70 是逐支的精確版;要引事實請引那一段,別只看這行文案。
  bug:
    '系統狀態異常,取消可能已經寫進去了。請重新整理確認,並通知系統維護,不要重複按。',
  retry: '系統忙碌,這次沒完成。請重新整理本單確認後再送一次。',
  error: '取消可能已經寫進去了。請重新整理本單確認之後再決定要不要重送。',
};

// 🔴 `Object.freeze`(關卡2 nit):本表 D1 起被匯出,凍住才擋得掉「呼叫端事後改一句話」——
//    那會讓 action 回的訊息與 banner 顯示的訊息分岔,而兩邊都不會紅。
//    🔴 **凍在這裡、不凍在字面上**:理由見上面 docstring(freeze 包字面會吃掉 excess-property check)。
export const FAILURE_MESSAGES: Readonly<Record<CancelFailureCode, string>> =
  Object.freeze(FAILURE_MESSAGES_SOURCE);

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
 *    - 而歷程那一側的鍵 **A9d2-2b 已補上**(`AdminOrderCancellation.idempotencyKey`)——
 *      這讓帶回 token 更必要,不是更不必要:歷程對得起來的前提,是員工這側手上還握著同一顆。
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
 *   5. 🔴 **投影補了鍵 ≠ 員工對得起來 —— 比對要發生在「凍結畫面」上,不是重載之後**
 *      (A9d2-2b 關卡2 R3 提出 → R4 更正其論證;沒有這條,片 5 把 1-4 全做對、
 *      配好測試,員工當天仍可能對不了帳):
 *      - 可比對的時間窗 = **凍結畫面**。慣例 3「失敗路徑也 `revalidatePath`」(plan §2 慣例 3、
 *        前例 `note-actions.ts:133-135`)會讓歷程**當場刷新**、新列進得來;
 *        而 `requestToken` 還在 client state 裡 ⇒ **兩顆鍵此刻同時在畫面上**。
 *      - 🔴 **義務 2 的整頁重載會關掉這個窗**:重載後 server 重鑄 `initialState`、
 *        手上那顆 token 就沒了(單純 remount 則不一定換 —— 那取決於傳進去的 `initialState`)。
 *      ⇒ 片 5/A13b 必須讓凍結畫面**自己**把 `idempotencyKey === requestToken` 的那一列標出來,
 *        不要把比對推遲到重載之後。A13b 配測試釘住「凍結畫面指得出是哪一列」。
 *      🔴 **不是叫員工手抄比對**(手抄是 `A-109-A` 裁示明確否決的 C 案:「把機器該做的事丟給人」);
 *      🔴 **也不要把 token 塞進 URL query**(關卡2 R4:它會進瀏覽器歷史與 Referer;
 *        它不是授權密鑰,但是內部冪等/重放識別碼,沒有必要為了跨重載而外洩一層)。
 *      ⚠️ **本條踩在一個未實測的前提上**(關卡2 R5 標記):「server action 失敗回傳的**同一往返**
 *        會重算當前路由的 RSC payload」。本 repo 的備註片已在 production 依賴同一行為
 *        (`note-actions.ts:133-134` 註解大意:不重取的話員工會停在看不到那筆備註的舊畫面)⇒ 前例支持,
 *        但沒人對取消片實測過。**A13b 實作時順手證一次**;若當版 Next 不是這個行為,
 *        這條的時間窗就不存在、要回頭重想(不要默默改成 URL query)。
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
