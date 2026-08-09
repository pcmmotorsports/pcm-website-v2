// cancel-action-state.ts — 取消線的**結果碼、導頁 query 建構器、冪等 token**。
//
// ⚠️ 檔名裡的 "action-state" 是歷史:A9d2-2a 時它裝的是 action 的回傳 state;
//    **A13b D2a 起 action 回 `Promise<void>` + 導頁**,那族 state 已成死碼、D2b 整族刪除。
//
// 🔴🔴 **維持 client-safe**(零 IO、零敏感值;唯一 import 是同目錄的 `isUuid`,也是純函式)
//    ⇒ **不得**引入 `server-only` 或任何 server 專用模組。
//    ⚠️ **理由已經換過一次**(A13b D1 更正):原本寫的是「A13b 表單要用 `useActionState` 接 state」——
//    那條路 **plan v3 已經換掉**(React 19 form reset 競態會誤送整單取消 ⇒ 改 PRG 整頁化、零 client state)。
//    現在的理由是:本檔被 `result-banner.tsx`(server component)匯入,而它 4 頁共用;
//    保持零 server 相依也讓 D2 之後若有 client 需求不必再拆檔。
//    🔴 `CancelActionState` 那族型別**已於 D2b 整族刪除**(D2a 起就沒有人呼叫)。
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
//    本檔把這條規則做進**型別**而不是註解 —— D2b 之後承載它的是
//    `CANCEL_NOT_SENT_CODES` / `CANCEL_SENT_CODES` 兩個陣列(型別由它們推導)
//    與 `notSentResultQuery` / `sentResultQuery` 兩支**不相交**的簽章:
//    「沒送到」那支要不到 token、「已送到」那支非給不可。

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

/**
 * 🔴🔴 **D4 / D5 的承接義務 —— 這段是 D2b 刪除舊 state 族時「搶救」出來的**。
 *
 * 被刪的 `CancelActionState` docstring 裡有一份「片 5 / A13b 義務 1-5」清單,逐條處置:
 * **1 = 轉交、不是作廢**(授權閘絕對第一這條**仍然活著**,守門搬到 `cancel-actions.ts` 的 landmine 測試)、
 * **2-3 作廢**(凍結表單與「重新整理要 remount」隨 client state 一起消失)、
 * **4 併進下面的義務 A**(它講的是「不要繞過換鍵機制」,換鍵責任已移到渲染期)、
 * **5 = 下面的義務 B**。
 * 🔴 另有一條**藏在義務 2 裡、不能跟著它一起丟**的:「**B 類(已送到 RPC、結果不明)不得把表單開回去讓他重送**」。
 *   舊形狀用凍結表單做,PRG 之後那個機制沒了 ⇒ **轉交 D5 的 fail-closed**(plan §1c:`rt` 缺失/非 uuid/
 *   拿不到帳本一律顯示「無法核對」,**不得**當成「沒失敗」而開放表單)。這條今天同樣零守門。
 *
 * **義務 A(D4,token 生成)**:規則本身寫在 `generateCancelRequestToken` 的 docstring(產生點與快取層),
 *   這裡**不重抄**(同一條規則養兩份總有一天會不一樣 —— 那正是那支 docstring 自己在講的事)。
 *   🔴 這裡要記的是**守門帳**:「產生點在渲染期、不落快取層」那一半**從來就沒有測試守過**;
 *   「失敗後換一把新的」那一半原本由 `cancelNotSentFailure` 內鑄保證,而那支已隨 D2b 刪掉
 *   ⇒ **在 D4 補上「兩次獨立 render 拿到兩顆不同合法 uuid」之前,兩半都零守門**。
 *   已列進 plan 的 D4 驗收**⑥**(⑤ 是「URL 只准經三支建構器組」,別看錯);
 *   這裡再寫一次,因為讀 code 的人不會先去讀 plan。
 *
 * **義務 B(D5,對帳窗)**:🔴 **投影補了鍵 ≠ 員工對得起來**(A9d2-2b 關卡2 R3→R4 的結論)。
 *   舊形狀的可比對時間窗是「凍結畫面」——那時 `requestToken` 還在 client state、歷程剛被 revalidate 刷新,
 *   **兩顆鍵同時在畫面上**。PRG 之後那個窗**關掉了**:沒有 client state、也沒有凍結畫面。
 *   ⇒ 接班的是 **D3 的帳本 classifier + D5 的面板**(分類邏輯在 D3、消費在 D5,別把分類重寫進面板):
 *   token 改由 URL 的 `rt` 帶著,面板拿它去對 `idempotencyKey`。
 *   🔴 **不准退化成「叫員工自己手抄比對」**——那是 `A-109-A` 明確否決的 C 案(把機器該做的事丟給人)。
 *
 * ⚠️ **兩條都踩在同一個未實測前提上**:「導頁之後那一頁拿到的是重新算過的資料」。
 *   舊形狀踩的是「server action 失敗回傳的同一往返會重算 RSC payload」,PRG 換成了 redirect + 新渲染,
 *   **機制不同、但一樣沒人量過**(plan §6-1 誠實邊界;`E-031-A` 已把「要起真 admin 才量得到」排到 #350 線下)。
 */

/** token 形狀驗證(與產生器同源;轉呼 `isUuid`,不另養正規式)。 */
export function isCancelRequestToken(value: string): boolean {
  return isUuid(value);
}

/**
 * 失敗碼 —— **依「有沒有送到 RPC」分兩組**,不是依嚴重度。
 *
 * 🔴 這個分組就是 plan §2.1 的規則本身:
 * - **沒送到**(`denied` 授權閘 / `invalid` 解析器擋下)⇒ **導頁、不帶 `rt`、不保留輸入**(`E-014-A` Q2=A)。
 *   ⚠️ D2a 前的字面是「保留輸入、換新 token、表單可編輯」——三句都隨 PRG 換路作廢:
 *   新 token 改由**下次整頁渲染時表單自己鑄**(D4 硬驗收)。「舊 token 從未送出、沒有冪等價值」這點不變。
 * - **已送到**(`rejected` / `retry` / `bug` / `error` **四支全部**)⇒ **導頁(D5 之後由帳本核對面板說「寫進去了沒有」;在那之前畫面空白)**。
 *   ⚠️ D2a 前的字面是「凍結表單、只給重新整理一條路」——那個 UX 閘隨 client state 一起消失了,
 *   接手的是 D5 的帳本核對(它說得出真話,而凍結旗標攔不住偽造)。
 *   理由:①**其中幾支可能已 commit**(逐支的精確版在下面 ⚠️ 那段,**不要引用這一行當事實**)
 *   ②就地改值 + 同 token 必撞 hash。
 *   ⚠️ **精確版**(關卡2 兩輪各修一次;不要把「四支都可能已 commit」當事實寫到別處):
 *   - 真的可能已 commit 的是 `rejected`(可能是 hash 不符 = 前一次其實成功了)、`error`(未知),
 *     以及 🔴 **`bug` 的「payload 形狀不符」那一支**(A9d2-2b 關卡2 R4 補:plan §4.2 表
 *     `docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:239` 明列它屬 `bug`,而它是
 *     **RPC 成功回傳之後** client 端形狀驗證才失敗 ⇒ 交易**已經 commit 了**。
 *     本段前一版只列五個 SQL/PostgREST 碼就下「`bug` 不可能已 commit」的結論,**漏了這一支**)。
 *   - 確定沒留半筆的只有:`retry`(`55P03`/`40P01`)與 `bug` 裡的 `P8C01`/`23514`/`22003`
 *     **都會中止該交易**;`bug` 裡的 `PGRST202`(找不到函式)與 `42501`(ACL 被撤)**根本沒進到函式**。
 *   ⇒ 這四支照樣**不讓他就地重送**,但理由是**②同 token 撞 hash + 分不出是哪一種**,不是「都可能已 commit」。
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
 *    那正是 `ORDER_CANCELLED_RESULT_CODE` 的 docstring 在避的「兩邊各打一次字串會靜默 typo」。
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
 *    ⇒ **經由這三支組 URL 時**,忘記帶 = 編譯期紅,不是靠註解提醒下一個人。
 *
 * ⚠️ **這道保證的邊界(窄 R3 F1,說清楚免得比實際大)**:它只在「有走這三支」時成立。
 *    `ORDER_CANCELLED_RESULT_CODE` 與 `toOrderCancelResultCode` 仍是公開匯出
 *    (banner 要拿它當 computed key、D5 要拿它比對)⇒ 有人手拼 `?r=order_cancelled` 照樣編得過。
 *    **收掉匯出面不可行**(那兩個消費端是真的需要)⇒ 約束改放在**驗收層**:
 *    plan §3 的 D4/D5 驗收明列「導頁 URL 只准經這三支建構器組」。
 *
 * 🔴 分法對齊唯一判準「有沒有送到 RPC」:
 *    - `notSentResultQuery` —— 沒送到(RPC 從未被呼叫)⇒ **沒有帳本可查**,不需要也不該帶 token。
 *    - `sentResultQuery` —— 已送到、結果不明 ⇒ D5 必須拿 token 去帳本核對,`requestToken` **必填**。
 *    - `cancelledResultQuery` —— 成功 ⇒ 同樣必填:D5 要分得出「這次成功 / 帳本裡的舊紀錄 / 偽造的網址」。
 *
 * ⚠️ 回傳的是 query 字串本體(不含 `?`),呼叫端自己接在路徑後面。
 * ⚠️ **`requestToken: string` 沒有形狀約束**(窄 R3 nit F2:`cancelledResultQuery('denied')` 編得過)。
 *    刻意不在這裡加 runtime 檢查 —— 它會在**錢的失敗路徑上**多開一個新的拋出點。
 *    形狀由兩側夾住:**進來的那一側**已過解析器的 `isCancelRequestToken`(`cancel-form.ts`);
 *    **出去的那一側**由 D5 的 classifier **fail-closed**(rt 缺失/非 uuid ⇒ 一律「無法核對」,
 *    不得當成「沒失敗」把表單開回去,plan §1c)。token 是 uuid ⇒ 無需 encode。
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
 *    ⚠️ 另外四則(`rejected`/`retry`/`bug`/`error`)**D2a 之後已經沒有人顯示它們** ——
 *    action 改成導頁帶 `?r=&rt=`,而那四碼刻意不進 banner、要等 **D5** 的帳本核對面板。
 *    ⇒ 在 D5 落地之前,那四條路徑員工畫面上是空白的(plan §3 排序原則:D5 之前不接線曝光)。
 */
const FAILURE_MESSAGES_SOURCE: Record<CancelFailureCode, string> = {
  denied: '沒有權限或登入已失效,取消沒有送出。',
  invalid: '表單內容不正確,取消沒有送出。',
  rejected:
    '這張單目前不能取消(狀態可能剛變動)。請重新整理本單確認後再決定,不要重複按。',
  // 🔴 本行的「可能已經寫進去了」**是精確的、不是保守措辭**(關卡2 R3 提矛盾 → R4 推翻 R3):
  //    `bug` 涵蓋的「payload 形狀不符」發生在 RPC 成功回傳**之後** ⇒ 那一支真的已經寫進去了。
  //    上面 :110-117 是逐支的精確版;要引事實請引那一段,別只看這行文案。
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
