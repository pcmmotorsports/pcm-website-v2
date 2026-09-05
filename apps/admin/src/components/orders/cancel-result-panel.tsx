import type { AdminOrderCancellation } from '@pcm/domain';
import {
  CANCEL_SENT_CODES,
  ORDER_CANCELLED_RESULT_CODE,
  ORDER_MARKED_CANCELLED_RESULT_CODE,
  ORDER_MARK_REJECTED_RESULT_CODE,
  toOrderCancelResultCode,
} from '../../lib/orders/cancel-action-state';
import {
  classifyCancelLedger,
  type CancelLedgerVerdict,
} from '../../lib/orders/cancel-ledger-classifier';
import { CancelResultUrlCleanup } from './cancel-result-url-cleanup';

// cancel-result-panel.tsx — M-4b E10 **A13b D5**:取消送出後的**帳本核對面板**。
//
// 🔴🔴 **這是 PRG 換路之後唯一會對員工說「發生了什麼」的地方**。
//    D3 的 classifier 算出五分類、本檔只把 verdict 翻成中文 —— **不得在這裡重算任何分類**
//    (同 `cancel-review-section.tsx` 的紀律:重算一份就會有兩份會漂移的規格)。
//
// 🔴🔴 **成功訊息為什麼在這裡、不在 `ResultBanner`**(D1 關卡2 must-fix,plan §1a v3.2):
//    `?r=` 是**任何人都能自己打的字**,而 banner 掛在 4 個頁面上 ⇒ 對一張根本沒被取消的單
//    貼 `?r=order_cancelled`,靜態文案就會說「取消已完成」。**錯的方向是危險那一邊**:
//    員工看到綠字就不會再去取消它。
//    ⇒ 本檔的成功訊息**一律以帳本為準**:`rt` 對得上帳本才說「已完成」,對不上就照實說對不上。
//    判準一句話:**錯的方向說「沒發生」= 可以靜態;錯的方向說「已發生」= 必須查帳本。**
//
// 🔴 **URL 只決定「要不要顯示面板、對哪一顆 token」,說什麼一律由帳本決定**(plan §1a 表 row 42)。
//    ⇒ 持舊 token 的人把 `?r=` 改成任何一支,看到的都還是帳本裡的真話。
//
// 🔴 **server component、零 `'use client'`**:唯讀顯示。唯一的 client 是網址清除那支
//    (`cancel-result-url-cleanup.tsx`),它不參與任何判定 —— 理由見那支檔頭。

/**
 * 會觸發本面板的結果碼 = **B 類四支(已送到 RPC、結果不明)+ 成功碼**。
 *
 * 🔴 **A 類兩碼(`denied` / `invalid`)刻意不在這裡** —— 它們是「RPC 從未被呼叫」,
 *    帳本裡本來就沒有那筆,查了只是叫 D5 去找鬼。那兩支由既有 `ResultBanner` 出靜態文案。
 * 🔴 兩張表**互斥**是 plan §1a 逐字要求的,而且**兩邊都要有斷言**:只釘一邊的話,
 *    那五顆哪天被誤加進 banner,員工會看到一則安心的靜態文案而**錯過帳本核對**。
 */
export const CANCEL_PANEL_RESULT_CODES: readonly string[] = Object.freeze([
  ...CANCEL_SENT_CODES.map(toOrderCancelResultCode),
  ORDER_CANCELLED_RESULT_CODE,
  // 🔴 第二條路的成功碼(⟦0a-CARDCANCELNOREFUND⟧ 片②)—— 它**不查帳本**,見下面的分支。
  ORDER_MARKED_CANCELLED_RESULT_CODE,
  ORDER_MARK_REJECTED_RESULT_CODE,
]);

export function isCancelPanelResultCode(code: string | undefined): boolean {
  return code !== undefined && CANCEL_PANEL_RESULT_CODES.includes(code);
}

/**
 * 🔴🔴 **fail-closed:面板出現的那一次渲染,兩支取消表單一律不給**(義務 B 的另一半)。
 *
 * D3 負責「分不清楚時回 `unreadable`」,**本規則負責「結果頁上不准就地重送」**。
 * 舊形狀用「凍結表單」做,PRG 之後那個機制沒了,接手的就是這條。
 *
 * 🔴🔴 **R2 codex must-fix:我第一版按 verdict 分流(只有 `miss_complete` 准重開),
 *    那與我自己寫的文案自相矛盾** —— 文案叫他「請重新整理本單再確認一次,仍然沒有才重送」,
 *    而閘卻在**同一次渲染**就把表單打開了 ⇒ 員工不必重整就能按第二次,
 *    那正是這條規則要防的動作。
 * ⇒ 改成**形狀上的規則,不是查表**:`?r=` 帶著結果碼的那一次渲染 = 結果頁 ⇒ **表單不出現**;
 *   員工照文案重新整理 ⇒ 網址回到 canonical(沒有 `r`/`rt`)⇒ 面板消失、表單自然回來。
 *   ⇒ **「重新整理」本身就是重開表單的機制**,不必另外發一張通行證。
 * 🔴 **這條同時買到一件安全的東西**:重送一定發生在一次**全新的頁面載入**之後,
 *   而那次載入會重新查一次帳本 ⇒ 直接緩解 `miss_complete` 踩的「導頁後讀取新鮮度」前提
 *   (backlog **#357**)。按 verdict 分流反而會讓最危險的那格用**同一份可能過期的讀取**去放行。
 * ⚠️ A 類兩碼(`denied`/`invalid`,RPC 從未被呼叫)**不走本面板** ⇒ 不受這條影響,
 *   表單照常開著 —— 那是對的:什麼都沒送出去,本來就該讓他改一改再送。
 */
export function cancelFormsAllowedOnResultPage(resultCode: string | string[] | undefined): boolean {
  // 🔴 **陣列(重複 query key)也不給** —— 這裡與面板的分流刻意**不對稱**,原因是兩者的
  //    fail-closed 方向相反:面板「看不懂就不說話」(不顯示),表單「看不懂就不放行」(不顯示)。
  //    若照面板那套寫成「非字串 ⇒ 當作沒有結果碼」,`?r=order_cancel_retry&r=x` 會變成
  //    **面板不出現、表單卻開著** = 員工看不到警告卻按得下第二次,那是 fail-open。
  if (Array.isArray(resultCode)) return false;
  return !isCancelPanelResultCode(resultCode);
}

/**
 * ✅ **D6-a 已接線**(2026-08-10 更新;D5 收工當時本函式零消費端、義務 B 還是零守門)。
 *
 * 現況消費鏈:`app/orders/[id]/page.tsx`(原封轉 `?r=`)→ `order-detail-route.tsx`
 * → `OrderDetail` → `OrderCancelBlock` 的 `showForms`;面板版 `app/@panel/orders/page.tsx` 同樣接。
 * 守門:`app/orders/[id]/cancel-wiring.test.tsx`(結果頁不給表單 / A 類照常給 / 重複鍵不放行 /
 * 預設 fail-closed / 區塊自己也 fail-closed),突變 W1/W2/W2b/W3/W5 各自轉紅。
 * ⚠️ **仍要記得的邊界**:本函式只認 `?r=`,**不認「這頁的資料有多新」** ——
 * `miss_complete` 那格踩的未證前提(backlog **#357**)不因為接線而消失。
 */

type PanelTone = 'ok' | 'warn' | 'error';

/**
 * 五分類 → 員工看到的字(plan §1c 表)。
 *
 * 🔴 **`miss_complete` 不得寫成斷言句**(`E-044-Q` 主視窗裁 A):plan 原字面是
 *    「這筆**沒有寫進去**,可以重送」,而那句話踩在兩個**沒人量過**的前提上
 *    (跨單 token / 導頁後讀取新鮮度,backlog **#357**)⇒ 說錯的代價是第二筆刪不掉的取消。
 *    ⇒ 改成「**目前查不到這筆**,重新整理再確認一次;仍然沒有才重送」。
 *    ⚠️ 這不是保守措辭潔癖 —— 它是本片唯一一句會讓員工去按第二次的話。
 *
 * 🔴 **`match_other_actor` 不得寫死「登記人不是你」**:`actor` 為 `null`(尚未選人)時,
 *    D3 會 fail-closed 走這一格 —— 那時的事實是「**認不出你是誰**」,不是「登記人不是你」。
 *    文案要同時容得下兩種(處置相同:與同事確認)。
 */
export const VERDICT_TEXT: Record<CancelLedgerVerdict, { title: string; hint: string; tone: PanelTone }> = {
  unreadable: {
    title: '查不到取消紀錄(讀取失敗)',
    // ⚠️ 畫面文字裡不要寫 markdown 星號 —— JSX 會逐字印出來(D4 同一個坑犯過一次)。
    hint: '這不代表沒有送出。請重新整理本單再確認一次;若重整後仍然這樣,請通知系統維護,先不要重送。',
    tone: 'error',
  },
  match_same_actor: {
    title: '你剛才那筆已經寫進去了',
    hint: '取消紀錄裡找得到你這次送出的那一筆,不需要再送一次。展開下方「影響範圍與取消紀錄」可以看到明細。',
    tone: 'ok',
  },
  match_other_actor: {
    title: '找到相符的取消紀錄,但登記人不是你(或系統認不出你是誰)',
    // 🔴 2026-08-29 `Q-CANCELHINT` = 甲(Sean 批「改成指向會生效的那條路」)。
    //    ~~原句「也可能是你還沒在右上角選人」~~ —— 那半句在正式站上叫人去按一顆按了不會生效的鈕。
    //    成因:`actor === null` 有【四種】來源(`session/actor.ts` 的 `getSessionActorWithSource`),
    //    而「去右上角選人」只對其中一種有用(`self-selected`,它要求 `ADMIN_REQUIRE_REAL_IDENTITY`
    //    是關的)—— 那顆旗標 2026-08-25 已設為 `1` ⇒ **線上到得了這句話的世界,那半句全是白工**。
    //    危害不是「文案不精確」:他去選人 ⇒ 選單會顯示他選的人 ⇒ **看起來成功了** ⇒ 回頭重送
    //    ⇒ actor 仍是 null ⇒ 又一次 `match_other_actor`。而這一頁自己下一句正是「不要直接再送一次」。
    //
    // 🔴🔴 **而【不准】在這裡叫他登出重登** —— `app/page.tsx:100-104` 那段 codex 關卡2 R4 must-fix
    //    的理由在這裡一字不變地成立:上游還沒送 `sub` 時他登出就回不來,而舊票還讀得到東西。
    //    (順帶量到:`grep -rlEi 'logout|signout|sign-out' apps/admin/src/app` ⇒ **0** 檔
    //     ⇒ 這個後台**根本沒有登出入口**;正對照 `login|sso` ⇒ 64 檔、負對照 `logoutzz9q` ⇒ 0。)
    //
    // ⇒ **指向哪條會生效的路**:本元件只拿得到 `actor: string | null`,分不出那四種世界
    //    (接 `source` 進來 = 動取消動線的資料流,而本頁在鐵則 12 ① 上 ⇒ 能改字就不動資料流)。
    //    而**首頁那張「具名身分」卡分得出來**(`app/page.tsx:243` 印 `ACTOR_SOURCE_COPY[copyKey]`,
    //    五個世界各一句,含「請改用個人帳號登入」與「請先不要登出…先找管理員確認」)
    //    ⇒ 這句話把他送去那裡,而不是自己猜他在哪一種。
    //
    // ⚠️ **用字是線I 挑的,不是 Sean 挑的**(他批的是方向:「改成指向會生效的那條路」)
    //    ⇒ **他一個字就能改**。安全的那半(「與同事確認、不要直接再送一次」)**逐字沒動**。
    // 🔴 **codex R1 must-fix 1**(2026-08-29):~~「(這種情況下右上角那顆選單選了也不會生效)」~~
    //    **在 `self-selected + actor=null` 那個世界是【假的】** —— 那裡選單真的會生效,
    //    而那正是唯一有效的解法 ⇒ 我原本那句會叫他放棄它。
    //    ⇒ 改成「不一定選了就生效」:**四種世界裡每一種都為真**,而它把「是哪一種」
    //      交給分得出來的那一頁(首頁那張卡),不在這裡猜。
    //    ⚠️ 不用「多數情況下」這種頻率副詞 —— 那會讓一個沒有人量過的比例矇混過關。
    hint: '可能是同事同時在處理,也可能是系統這次認不出你是誰。請先與同事確認,不要直接再送一次;而右上角那顆選單【不一定】選了就生效 —— 要知道你這次是哪一種情況、該做什麼,看後台首頁「具名身分」那張卡。',
    tone: 'warn',
  },
  miss_truncated: {
    title: '無法斷定這筆有沒有寫進去',
    hint: '這張單的取消紀錄太多、目前只看得到最近的一批,你這筆可能在沒列出來的那批裡。請通知系統維護協助確認,先不要重送。',
    tone: 'error',
  },
  miss_complete: {
    title: '目前查不到這筆取消',
    hint: '取消紀錄裡沒有你這次送出的那一筆。請重新整理本單再確認一次;仍然沒有,才重新送一次。',
    tone: 'warn',
  },
};

/**
 * 成功碼專用的覆寫。
 *
 * 🔴 **只有 `match_same_actor` 才准說「已完成」**(R1 must-fix 1 之後收窄;原本寫 `match_*`,
 *    那會把 `match_other_actor` 也算進來 = 吃掉 D3 的 actor fail-closed)。
 *    這是驗收④(偽造 `?r=order_cancelled` 對一張沒被取消的單不得顯示「已完成」)的落點:
 *    碼說成功、帳本說找不到或不是你 ⇒ **以帳本為準**,照 `VERDICT_TEXT` 說,不會有任何綠字。
 */
/**
 * 🔴 走 `admin_mark_order_cancelled` 成功時的文案。
 * **它與 `CANCELLED_MATCH_TEXT` 刻意不同**:那一支說「取消已完成(帳本已核對)」,
 * 而這條路**沒有取消單可以核對** —— 說同一句話等於對它說謊。
 */
/**
 * 🔴 第二條路**被拒**的文案(主視窗 2026-09-05 裁 B=乙)。
 * **它要講的不是「失敗了」, 是「這張單不走這條路」** —— 而那兩件事的下一步不同。
 */
export const MARK_REJECTED_TEXT = {
  tone: 'warn' as const,
  title: '這張單不能用這個方式結掉',
  // 🔴🔴 **我五分鐘前才寫完一道掃 Markdown 星號的守門, 然後在這裡又犯一次。**
  //    那道守門掃的是 `BLOCK_REASON_TEXT`(隔壁檔), 而本檔的文案**不在它的分母裡**。
  //    ⇒ 📌 **一道守門的射程止於它掃的那個常數** —— 而同一個病可以換一支檔重來。
  //    ⇒ ⇒ 所以本檔也補一格同款的守門(`cancel-result-panel.test.tsx`)。
  hint:
    '「把這張單結掉」只適用於刷卡收款、而且錢已經全額退完的單,' +
    '並且這張單先前沒有部分取消過。' +
    '⚠️ 這不是系統出錯 —— 請重新整理本單看一次現在的狀態;若你認為它應該可以,請告知系統維護。',
};

export const MARKED_CANCELLED_TEXT = {
  tone: 'ok' as const,
  title: '這張單已經標記為取消',
  hint:
    '錢先前已經全額退還,這一步只把訂單狀態收尾,沒有再動到任何一筆錢。' +
    '⚠️ 這條路不會在「取消紀錄」裡留下一筆 —— 那裡查不到是正常的,不是漏記。',
};

export const CANCELLED_MATCH_TEXT: { title: string; hint: string; tone: PanelTone } = {
  title: '取消已完成',
  // 🔴 **措辭刻意說「這顆單號對應的取消」而不是「你剛才那次」**(R2 codex must-fix 1):
  //    token 命中證明的是「**這顆 token 的取消存在於帳本**」,不是「你這一次的操作成功了」。
  //    可構造的差異:同一張單可以有多筆部分取消 ⇒ 員工按返回鍵回到**舊的**結果網址
  //    (帶著上一次那顆 token),命中的是上一次那筆,而他這次要取消的品項可能一件都沒送出。
  //    ⚠️ 這與 backlog **#357**(跨單 token / 導頁後讀取新鮮度)是同一族的「URL 不新鮮」問題,
  //    本片擋不掉、也不假裝擋掉:文案只陳述帳本證得了的事,並要他去對明細。
  hint: '取消紀錄裡找得到這次網址帶的那一筆。請展開下方「影響範圍與取消紀錄」核對品項與數量是不是你要取消的。',
  tone: 'ok',
};

const TONE_CLASS: Record<PanelTone, string> = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
};

export type CancelResultPanelProps = {
  /** URL 的 `?r=`(原封轉入,不要先 narrow) */
  resultCode: string | string[] | undefined;
  /** URL 的 `?rt=`(原封轉入 —— 重複鍵的 fail-closed 由 D3 的 classifier 收攏) */
  requestToken: string | string[] | null | undefined;
  /** 目前 session 的具名身分;`null` = 尚未選人 */
  actor: string | null;
  cancellations: readonly Pick<AdminOrderCancellation, 'actor' | 'idempotencyKey'>[] | null;
  cancellationsTruncated: boolean;
};

/**
 * 取消結果面板。**不是本面板該顯示的碼就回 `null`**(一般載入頁面時什麼都不畫)。
 *
 * 🔴 `resultCode` 收 `string[]` 是為了與頁層 `searchParams` 同形:重複鍵
 *    (`?r=a&r=b`)⇒ 非字串 ⇒ 不匹配任何面板碼 ⇒ 不顯示面板(fail-closed 方向:不亂說話)。
 */
export function CancelResultPanel({
  resultCode,
  requestToken,
  actor,
  cancellations,
  cancellationsTruncated,
}: CancelResultPanelProps) {
  const code = typeof resultCode === 'string' ? resultCode : undefined;
  if (!isCancelPanelResultCode(code)) return null;

  const verdict = classifyCancelLedger({
    requestToken,
    actor,
    cancellations,
    cancellationsTruncated,
  });

  // 🔴🔴 **只有 `match_same_actor` 才准說「已完成」**(R1 must-fix 1 更正,我第一版把
  //    `match_other_actor` 也算成 matched —— 那等於**把 D3 的 actor fail-closed 整格吃掉**)。
  //    可構造的錯:系統認不出操作者是誰(`actor === null` 的四種來源,D3 一律走 `match_other_actor`),
  //    或他手上是同事 / 自己更早那筆部分取消的 token(一張單可以有多筆取消)
  //    ⇒ 開 `?r=order_cancelled&rt=<那顆>` 就看到綠字「取消已完成」,
  //    而**他這次要取消的品項可能一件都沒送出** —— 看到綠字就不會再去取消它。
  //    ⇒ `match_other_actor` 一律沿用 `VERDICT_TEXT`(warn + 與同事確認),不升成 ok。
  // 🔴🔴 **第二條路(`admin_mark_order_cancelled`)的成功【不查帳本】**
  //    —— 主視窗 2026-09-05 裁 A=甲。那支 RPC **不寫 `order_cancellations`**
  //    (`20260902140000:106-107` 逐字)⇒ 拿 token 去核對**必定查不到**,
  //    而「查不到」在這個面板上長得跟失敗一樣。
  //    ⇒ 📌 **兩條路的成功訊息不同, 那是【事實】不是缺陷** —— 一條有取消單、一條沒有。
  //    🛑 而這一句**把「沒有取消單」講出來**, 不是藏起來:下一個拿 token 去帳本找的人
  //       要在這裡就知道找不到是正常的。
  const text =
    code === ORDER_MARK_REJECTED_RESULT_CODE
      ? MARK_REJECTED_TEXT
      : code === ORDER_MARKED_CANCELLED_RESULT_CODE
      ? MARKED_CANCELLED_TEXT
      : code === ORDER_CANCELLED_RESULT_CODE && verdict === 'match_same_actor'
        ? CANCELLED_MATCH_TEXT
        : VERDICT_TEXT[verdict];

  return (
    <section
      role='status'
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${TONE_CLASS[text.tone]}`}
    >
      <p className='font-medium'>{text.title}</p>
      <p className='mt-1 text-xs'>{text.hint}</p>
      <CancelResultUrlCleanup />
    </section>
  );
}
