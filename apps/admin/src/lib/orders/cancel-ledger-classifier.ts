// cancel-ledger-classifier.ts — M-4b E10 **A13b D3**:`rt` + 取消帳本 → 五分類窮舉(純函式,零 IO)。
//
// 🔴🔴 **這是 PRG 換路之後唯一還說得出真話的東西**。舊形狀(client state + 凍結表單)
//    的可比對時間窗隨 `CancelActionState` 一起消失(D2b);接班的是
//    **本檔的分類 + D5 的面板**:token 由 URL 的 `rt` 帶著,拿它去對帳本的 `idempotencyKey`。
//    ⇒ **分類邏輯只准在這裡**,D5 只把 verdict 翻成中文(同 `cancel-review-section.tsx:22-24` 的紀律:
//    重算一份就會有兩份會漂移的規格)。
//
// 🔴 **URL 只決定「要不要顯示面板、對哪一顆 token」,說什麼一律由本檔產出**(plan v3 §1a 表 row 42)。
//    ⇒ 本檔**刻意不收結果碼**:持舊 token 的人把 `?r=` 改成任何一支,看到的都還是帳本裡的真話。
//
// 🔴 **fail-closed 的方向**(plan §1c):分不清楚一律往「無法核對」倒,**不得**倒向
//    「沒失敗 / 沒寫進去」—— 後者會把表單開回去讓他重送,而取消一旦寫進去就拿不回來
//    ⇒ 重送 = 第二筆刪不掉的取消。
//    ⚠️ **「刪不掉」的精確依據**(R1 nit 5 更正原本指錯的錨點):明細表
//    `order_cancellation_items` 是 DB 層 append-only(`20260805100000_m4b_e10_a8a2_partial_cancel.sql:17`
//    逐字「對 order_cancellation_items 零 UPDATE/DELETE」);**header 表 `order_cancellations` 沒有那道**,
//    靠的是 items→header 的 `ON DELETE RESTRICT` 加上「現行規劃無任何片 DELETE/UPDATE 取消明細」
//    (`20260730140000_m4b_e10_a7t_cancellation_consistency_triggers.sql:235` 的 COMMENT 逐字,
//     同段並要求日後真要刪改時**必須先補鎖 parent + 隔離級 fail-closed 閘**)。
//    結論不變,但別把 header 的 append-only 講成 DB 保證的。
//    這條就是 `cancel-action-state.ts:69-71` 記的那筆零守門債(義務 B),D3/D5 各認領一半:
//    **本檔負責「分不清楚時回 `unreadable`」,D5 負責「拿到 `unreadable` 不得開表單」**。
//
// 🔴🔴 **本檔的 fail-closed 只涵蓋「看得出來的分不清楚」——三種看不出來的它擋不住**
//    (codex R2 三條 must-fix,逐條實查屬實;**這段是為了不讓上面那句宣稱大於事實**):
//    本檔**擋得住**的:`rt` 缺失 / 非 uuid / 重複鍵陣列、`cancellations === null`、`cancellationsTruncated`。
//    本檔**結構上擋不住**的,三條全部只影響 `miss_complete` 那一格(= 唯一一句「可以重送」):
//      ① **跨單**:冪等鍵唯一性是 `UNIQUE (order_id, idempotency_key)`
//         (`20260730130000_m4b_e10_a7_order_cancellations.sql:118-119`)= 跨單不唯一,
//         而本函式收到的是「某一張單的帳本」,看不到 token 原本屬於哪張單。
//      ② **新鮮度**:「導頁後那頁拿到的是重算過的資料」這個前提**沒人量過**
//         (`cancel-action-state.ts:88-90` 逐字)⇒ 已 commit 但這次沒讀到,長得跟「沒寫進去」一樣。
//      ③ **假完整**:`cancellationsTruncated` 是 `rows.length >= 100` 算的
//         (`mappers/order-cancellations.ts:142`)⇒ 伺服器 `max-rows` 若被調到 100 以下,
//         截斷發生在更低的數字上而本旗標**恆 false**(backlog **#325** 逐字記載的共同前提)。
//    ⇒ 三條都不是本片引入的、也都不是本片改得掉的(要 orderId 綁定 / 強制新鮮讀 / max-rows 健康閘)。
//    ⇒ **處置(`E-044-Q` 已裁 A+D,主視窗 2026-08-10;晨報向 Sean 知會)**:
//      **A** = 保留五分類、只把 `miss_complete` 的文案降成非斷言句(義務寫在該格 docstring);
//      **D** = ①② 合立 backlog **#353**(跨單綁定 + 導頁後讀取新鮮度);③ 已由 **#325** 管、不重造。
//      裁掉的:B(收掉這一格 ⇒ 要改 Sean 已核的 §1c 五分類字面)、C(加一顆今天沒人填得誠實的旗標)。

import type { AdminOrderCancellation } from '@pcm/domain';
import { isCancelRequestToken } from './cancel-action-state';

/**
 * 五分類(plan §1c 表,逐格對應)。**窮舉**:每一種輸入都落得進其中一格,沒有 fallthrough。
 *
 * 🔴 `unreadable` 同時是「讀不到」與**所有 fail-closed 出口**的匯流格(rt 缺失 / 非 uuid / 帳本 null)——
 *    三者對員工的處置完全相同(都是「不知道,先去重新整理確認,不要重送」),
 *    拆成三碼只會讓文案表多兩列而畫面行為一模一樣(同 `cancel-view.ts:110-112` 對三種帳本病理的立場)。
 *    ⚠️ 要分辨是哪一種,看的是 log 不是 UI。
 */
export type CancelLedgerVerdict =
  /** 帳本沒讀到,或 `rt` 缺失 / 形狀不對 ⇒ **不代表沒送出** */
  | 'unreadable'
  /** 找到 `idempotencyKey === rt` 的列,且登記人 = 本人 */
  | 'match_same_actor'
  /** 找到了,但登記人不是本人(或**認不出本人是誰**,見 `actor`) */
  | 'match_other_actor'
  /** 沒找到,**且**歷程被截斷 ⇒ 可能在沒列出的那批裡,無法斷定 */
  | 'miss_truncated'
  /**
   * 沒找到,且**看得到的這批**完整 ⇒ 這筆沒有寫進去。
   *
   * 🔴🔴 **這一格最貴 —— 它是唯一一句「可以重送」,而它踩在一個沒人量過的前提上**(R1 must-fix 2)。
   *    前提 = 「導頁之後那一頁拿到的是重新算過的資料」。舊形狀踩的是 server action 同一往返會重算
   *    RSC payload,PRG 換成 redirect + 新渲染,**機制不同、一樣沒人量過**
   *    (`cancel-action-state.ts:88-90` 逐字;`E-031-A` 已把「要起真 admin 才量得到」排到 #350 線下)。
   *    ⇒ 若 RPC 其實已 commit 而這次渲染還沒看到那一列(快取 / 複本 / 重算沒發生),
   *    本格會對員工說「可以重送」⇒ 第二筆刪不掉的取消。
   * ⇒ 🔴 **D5 的文案義務**:本格不得寫成斷言句(「這筆沒有寫進去」),
   *    要寫成「**目前查不到這筆**,重新整理再確認一次;仍然沒有才重送」。
   */
  | 'miss_complete';

/**
 * 分類所需的最小形狀。
 *
 * 🔴 帳本欄位用 `Pick<AdminOrderCancellation, …>` 綁住真型別(慣例逐字同
 *    `cancel-view.ts:121` 的 `CancelViewOrder`)⇒ 上游欄位改名會在**型別層**轉紅,不是靜默失效。
 */
export type CancelLedgerInput = {
  /**
   * URL 的 `rt`,**原封轉進來、呼叫端不要先 narrow**。
   *
   * 🔴 型別**涵蓋頁層 `searchParams` 的每一種形狀,另多容許呼叫端顯式的 `null`**
   *    (`app/orders/[id]/page.tsx:52` 實查是 `Record<string, string | string[] | undefined>`,
   *     **沒有** `null`)⇒ 三種非字串形狀都收得進來:鍵不存在(`undefined`)、
   *    `?rt=a&rt=b` 的**重複鍵**(`string[]`)、呼叫端顯式的 `null`。
   *    ⚠️ 本句原本寫「逐字同形」= 宣稱大於事實(codex R2 nit),已收窄。
   * 🔴 **`string[]` 是 R1 must-fix 3 補的,不是為了寬鬆**:原本型別只收 `string | null | undefined`,
   *    於是 `classifyCancelLedger` 裡那道 `typeof !== 'string'` **從宣告型別根本到不了 = 死守門**,
   *    而「重複鍵怎麼處置」這個 fail-closed 決定就被推回 D5 —— D5 最自然的寫法是 `rt[0]`,
   *    等於**挑一顆**去比對帳本,那正是本檔要收攏的東西。收進來之後那道閘才是活的(有負測釘住)。
   *    ⚠️ 重複 query key 在本 repo 有前例(memory `reference_nextjs-duplicate-query-key-segment-collision`)。
   */
  requestToken: string | string[] | null | undefined;
  /**
   * 目前 session 的具名身分(`session/actor.ts` 的 `StaffActor.id`);`null` = 尚未選人。
   *
   * 🔴 **`null` 一律走 `match_other_actor`、不走 `match_same_actor`**(fail-closed):
   *    認不出「本人是誰」時**不得**宣稱「你剛才那筆已經寫進去了」——
   *    那句話會讓員工直接收工,而實際可能是同事送的另一筆。
   *    ⚠️ 代價寫清楚給 D5:`match_other_actor` 的文案因此**不可**寫死「登記人不是你」,
   *    要容得下「認不出你是誰」這一種(兩者的處置相同:與同事確認)。
   * ⚠️ 這裡的 actor **不是授權邊界**(`session/actor.ts:6-7` 逐字:cookie 承載、使用者自選、未驗證)。
   *    本檔只拿它做「這筆是不是你送的」的顯示層比對,不拿它擋任何東西。
   */
  actor: string | null;
  /** `null` = 沒讀到(**不是**「沒被取消過」;`mappers/order-cancellations.ts:118-120`) */
  cancellations: readonly Pick<AdminOrderCancellation, 'actor' | 'idempotencyKey'>[] | null;
  /** 只表示觸及 `ORDER_CANCELLATIONS_EMBED_LIMIT`(`mappers/order-cancellations.ts:142`) */
  cancellationsTruncated: boolean;
};

/**
 * uuid 的十六進位字面**大小寫不分**(`isCancelRequestToken` 的正規式帶 `/i`,
 * `note-action-state.ts:42`)⇒ 比對前兩側都正規化。
 *
 * 🔴 **這不是潔癖,是 fail-open 的洞**:直接 `===` 時,一顆大小寫不同的合法 token 會**找不到**
 * ⇒ 落 `miss_complete` = 對員工說「這筆沒有寫進去,可以重送」,而它其實寫進去了。
 * 方向錯的那一邊正好是 append-only 帳本最貴的那一邊。
 * ⚠️ 目前的產生端(`crypto.randomUUID()`)與 PostgREST 都吐小寫、實務上撞不到 ——
 * 但 `rt` 來自**網址**,員工手抄/大寫化改一改就構造得出來,而型別與正規式都不會擋。
 */
function normalizeToken(token: string): string {
  return token.toLowerCase();
}

/**
 * `rt` + 帳本 → 五分類。**純函式**:同輸入恆同輸出、無 IO、不丟例外。
 *
 * 🔴🔴 **本檔不驗「這顆 `rt` 屬於哪一張單」——它只認得餵進來的這本帳**(R1 must-fix 4)。
 *    冪等鍵的唯一性是 **`UNIQUE (order_id, idempotency_key)`**
 *    (`supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql:118-119`)= **跨單不唯一**。
 *    ⇒ 帶著 X 單的合法 `rt` 落在 Y 單頁(舊書籤 / 手改網址 / 轉貼連結),Y 單的帳本裡當然沒有它
 *    ⇒ 落 `miss_complete` = 對員工說「可以重送」,而那筆其實好好地在 X 單裡。
 *    ⚠️ plan §1c 的殘餘風險段只談了 `match_*` 那個方向(關聯洩漏),**沒談這個方向**。
 * ⇒ 🔴 **D5 承接**:D5 手上有 order,顯示面板前要先確認「這顆 `rt` 是這張單的表單鑄的」;
 *    做不到就別把 `miss_complete` 寫成斷言句(上面 `miss_complete` 的文案義務已涵蓋)。
 *
 * 🔴 **閘的順序有判別力,不是任意的**:`match_*` 必須排在 `cancellationsTruncated` **之前**。
 *    反過來的話,「歷程被截斷但要找的那顆就在看得見的這批裡」會被回成 `miss_truncated`
 *    (「無法斷定」)—— 明明帳本已經給了確定的答案。負測釘死這一格。
 *    ⚠️ 相對地,`unreadable` 那兩道(token 形狀 / 帳本 null)誰先誰後**觀察不到**
 *    (兩條都回同一格)⇒ **不宣稱**它們的順序被測過。
 */
export function classifyCancelLedger(input: CancelLedgerInput): CancelLedgerVerdict {
  const { requestToken, actor, cancellations, cancellationsTruncated } = input;

  // fail-closed ①②:`rt` 缺失 / 形狀不對。形狀驗證與產生器同源(不另養正規式)。
  if (typeof requestToken !== 'string' || !isCancelRequestToken(requestToken)) return 'unreadable';
  // fail-closed ③:帳本沒讀到。🔴 `[]` **不走這裡** —— 空陣列是「真的沒被取消過」這個事實。
  if (cancellations === null) return 'unreadable';

  const wanted = normalizeToken(requestToken);
  // 🔴 `find` 取第一筆就夠:同一張單的 `idempotency_key` 有 UNIQUE 約束
  //    (`supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql:118-119`
  //     `UNIQUE (order_id, idempotency_key)`,且 `:409-410` 有驗收 SQL 釘住它的定義字面)
  //    ⇒ 本單的可見列裡最多命中一筆,不存在「要挑哪一筆」的問題。
  const matched = cancellations.find(
    (entry) => normalizeToken(entry.idempotencyKey) === wanted,
  );
  if (matched) {
    return actor !== null && matched.actor === actor ? 'match_same_actor' : 'match_other_actor';
  }

  // 沒找到:看得見的範圍是不是全部,決定「不知道」還是「確定沒有」。
  return cancellationsTruncated ? 'miss_truncated' : 'miss_complete';
}
