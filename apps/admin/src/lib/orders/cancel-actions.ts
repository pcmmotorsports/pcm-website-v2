'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { parseOrderCancelForm } from './cancel-form';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  ORDER_CANCELLED_RESULT_CODE,
  cancelNotSentFailure,
  cancelSentFailure,
  type CancelActionState,
  type CancelFormInput,
} from './cancel-action-state';
import { cancelOrder } from './cancel-repository';

// cancel-actions.ts — M-4b E10 A9d2-2c:取消訂單 server action。
//
// 🔴 **混合形**(同備註片 `note-actions.ts:25-26`,Sean 2026-08-02 拍板 Q1=A):
//   失敗回 state、成功才 `redirect()`(PRG,避免重整重送)。
//
// 🔴 **主流程一行 try 都沒有,是刻意的**:`cancel-repository.ts` 永不 throw、把所有失敗
//   收斂成回傳值 ⇒ 「`redirect()` 拋的 NEXT_REDIRECT 被 catch 吞掉、把已經成功的取消
//   分類成失敗」那個坑(plan §2 慣例 2、備註片 `:28-30` 的教訓)在結構上不存在,
//   不是靠下一個人記得把 `redirect()` 寫在 try 外面。
//   ⚠️ **唯一的 try 在 `safeRevalidate()` 裡**(關卡2 codex 後補),它包的是 `revalidatePath`、
//   不是 RPC 也不是 `redirect()` —— 理由寫在那支函式的 docstring。
//   要再加 try 的人:先確認它包不到 `redirect()`。
//
// 🔴 **本檔沒有一行稽核 code** —— `admin_cancel_order` 在同交易寫 `admin_audit_log`。
//
// ⚠️ **成功導頁後畫面上仍然沒有提示**(A13b D1 現況;本段的「要等片 9」已改寫,片 9 = 現在的 D1/D5):
//   `order_cancelled` **刻意沒有**進 `result-banner.tsx` 的訊息表 —— `?r=` 是任何人都能自己打的字,
//   靜態的成功訊息等於對一張沒被取消的單說「已完成」(D1 關卡2 must-fix)。
//   ⇒ 成功訊息移交 **D5**:由 `?rt=` 對取消帳本核對後才顯示。
//   🔴 **因此 D2 有一個硬義務**:成功那條 `redirect` 現在只帶 `r`(見下面 `:` 的成功路徑),
//   **必須一併帶上本次的 request token**,否則 D5 無從分辨「這次成功 / 舊紀錄 / 偽造的網址」。
//   ⚠️ **失敗那六碼也還沒有人送**:D1 只登錄了「沒送到 RPC」的 `denied`/`invalid` 兩支
//   (namespaced 成 `order_cancel_*`),而**本檔目前仍是回 action state、不是導頁**
//   ⇒ 那兩顆碼要等 **D2** 把失敗路徑改成 `redirect` 才會被用到。
//   已送到 RPC 的四支(`rejected`/`retry`/`bug`/`error`)同樣不進 banner,走 D5 的帳本核對面板。
//   ⓘ **未知碼靜默不顯示,現在由守門本身承擔**(#332-2,Sean 2026-08-06 拍板 Q1=A):
//   `result-banner.tsx` 的查表已硬化成 `Object.hasOwn(MESSAGES, code)`
//   ⇒ 任何非自有 key(含 `__proto__` 那族)都走 `return null`。
//   歷史註記:2026-08-02 拍板 B 曾把這個修法退回,那段期間本檔逐字警告過
//   「不要照抄『banner 用 hasOwn 所以未知碼安全』」—— 當時那句話是假的(裸索引),
//   `order_cancelled` 之所以安全只是**因為這個字串剛好不在原型鏈上**。現在理由變成守門本身,
//   兩者結論相同但**依據不同**:D1 接線時可以依賴守門,不必再論證字串「剛好不毒」。

const ORDERS_PATH = '/orders';

/** 🔴 `orderId` 必然已過解析器的 uuid 閘(能走到這裡就代表解析成功)。 */
function detailPath(orderId: string): string {
  return `${ORDERS_PATH}/${orderId}`;
}

/** 授權失敗時用的空輸入 —— 見下面 `denied` 那段的取捨說明。 */
const EMPTY_INPUT: CancelFormInput = {
  cancelMode: '',
  reasonCode: '',
  reasonDetail: '',
  items: [],
};

/**
 * 重取明細頁(plan §2 慣例 3:**失敗路徑也要 revalidate**;前例 `note-actions.ts:133-135`)——
 * `rejected` / `error` / `bug` 的 payload 形狀那一支都可能已經寫進去了,不重取的話員工會停在
 * 看不到那筆取消的舊畫面。這也是片 4 義務 5 的「可比對時間窗」:歷程當場刷新、token 還在 client state。
 *
 * 🔴 **拋錯不得往外傳**(關卡2 codex must-fix):它是「讓畫面新一點」的動作,不是取消成功與否的一部分。
 * 讓它炸出去 = 補償 log 與凍結 state 全部消失、員工重載換到新 token,而前一次可能已 commit
 * ⇒ 換一顆 token 的部分取消**擋不住**(見上面凍結那段)。這是本片唯一的 try,且離 `redirect()` 很遠。
 */
function safeRevalidate(orderId: string, requestId: string): void {
  try {
    revalidatePath(detailPath(orderId));
  } catch (thrown) {
    console.error('[admin/orders/cancel] revalidate 失敗(不影響取消結果)', {
      request_id: requestId,
      order_id: orderId,
      message: String((thrown as { message?: unknown } | null)?.message ?? '').slice(0, 200),
    });
  }
}

/**
 * 失敗時原樣帶回員工輸入(**未解析、未正規化**)。
 *
 * 🔴 `items` 用 `getAll`:品項是可重複欄位,`get()` 只拿得到第一筆
 * ⇒ 「勾了 5 個」會靜默變成「只帶回第 1 個」(同 `cancel-form.ts:41-42` 的理由)。
 */
function carryBack(formData: FormData): CancelFormInput {
  const read = (field: string): string => {
    const value = formData.get(field);
    return typeof value === 'string' ? value : '';
  };
  return {
    cancelMode: read(CANCEL_MODE_FIELD),
    reasonCode: read(CANCEL_REASON_CODE_FIELD),
    reasonDetail: read(CANCEL_REASON_DETAIL_FIELD),
    items: formData
      .getAll(CANCEL_ITEM_FIELD)
      .filter((value): value is string => typeof value === 'string'),
  };
}

export async function cancelOrderAction(
  prevState: CancelActionState | undefined,
  formData: FormData,
): Promise<CancelActionState> {
  // ① 授權閘。🔴 **絕對第一,連讀一個欄位都在它之後**(plan §2 慣例 1)——
  //    未授權者送爛表單要拿到 `denied` 而不是 `invalid`,否則等於對未授權者洩漏表單規則。
  //    🔴 代價:`denied` 因此**不保留員工輸入**(拿不到就回不了)。同備註片 `:88-93` 的取捨,
  //    理由 = denied 意謂 session 已失效,他下一步一定要重新登入,留著也接不回去。
  const authorization = await authorizeAdminMutation();
  if (!authorization) return cancelNotSentFailure('denied', EMPTY_INPUT);

  // ② 凍結短路。🔴 **緊接授權閘之後**(片 4 交棒義務 1),且用 `prevState?.` 防呆讀 ——
  //    `prevState` 是 client 送回來的參數,偽造 `undefined` 不得在授權前把這裡炸成 500。
  // 🔴🔴 **這是 UX 層、不是安全邊界**:持有效 session 者可以偽造 `idle` 繞過它。
  // 🔴 **而且「RPC 的 UNIQUE 會擋住第二筆」是過度保證**(關卡2 codex must-fix 抓到我寫太滿):
  //    `(order_id, idempotency_key)` UNIQUE + payload hash(`cancel-action-state.ts:166-167`)
  //    只擋得住**同一顆 token** 的重送。換一顆新 token 送同一份 payload:
  //    - 整單取消 → 會被 RPC 的業務檢查擋(單已取消);
  //    - **部分取消 → 擋不住** —— 分次累積本來就是合法用法,剩餘量夠就真的再扣一次。
  //    ⇒ 這條路唯一的防線是**員工看得到歷程、且對得出哪一筆是自己那次**
  //      (= A9d2-2b 把 `idempotencyKey` 補進投影的理由,以及下面義務 5 的比對)。
  //    這裡的凍結只是不讓誠實員工在凍結畫面上手滑重送,不要把它算進安全論證。
  // 🔴 **排在解析之前也是承重的**(code-reviewer 抓到:搬到解析之後整份測試照樣全綠):
  //    凍結中的畫面若送出爛表單,解析會先擋下來回 `invalid` ——而 `invalid` 會**換新 token**
  //    ⇒ 新 payload_hash ⇒ 同一份 payload 真的再取消一次,正是 §2.1 要防的事。
  // 🔴 原樣回 `prevState`、不重建:它本來就是 client 自己的 state,回給他自己不構成任何信任面;
  //    重建反而要對 client 送的 `code` 做驗證,會讓人誤以為這裡是信任邊界。
  if (prevState?.status === 'failed' && prevState.outcome === 'sent') return prevState;

  const carried = carryBack(formData);

  // ③ 解析。任一形狀不合 → `invalid`:保留輸入、**換新 token**(builder 內鑄)。
  //    舊 token 從未送到 RPC、沒有冪等價值(plan §2.1)。
  const parsed = parseOrderCancelForm(formData);
  if (!parsed.ok) return cancelNotSentFailure('invalid', carried);

  const httpRequestId = await getRequestId();
  // 🔴 **不記 `reasonDetail` 全文**(員工打的營運內容),只記長度 —— 同備註片 `:104` 的慣例。
  // 🔴 兩個 id 都記:冪等鍵是表單 token、不等於 HTTP `x-request-id`,兩者都留才對得回去。
  console.info('[admin/orders/cancel] order_cancel.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    reason_code: parsed.reasonCode,
    reason_detail_length: parsed.reasonDetail === null ? 0 : [...parsed.reasonDetail].length,
    // 🔴 `null` = 整單取消。記筆數而不是品項內容:品項 id 對除錯沒用,筆數看得出模式對不對。
    mode: parsed.items === null ? 'full' : 'partial',
    item_count: parsed.items === null ? null : parsed.items.length,
  });

  const outcome = await cancelOrder({
    orderId: parsed.orderId,
    reasonCode: parsed.reasonCode,
    reasonDetail: parsed.reasonDetail,
    items: parsed.items,
    actor: authorization.actorId,
    requestToken: parsed.requestToken,
  });

  if (!outcome.ok) {
    // 🔴 **`P0001` 路徑必須記 message**(plan §4.2 補償條款,不是選配):`P0001` 同時是
    //    「這張單不能取消」與「我們送了畸形參數」的 SQLSTATE,判別器從 UI 分支移到這裡。
    //    這裡對**所有**失敗碼都記 —— 只挑 `P0001` 記等於再養一個會漂移的判別式。
    //    ⚠️ `logMessage` 由 repository 截成 200 字且**不含** `details`/`hint`(那會帶整列內容)。
    console.error('[admin/orders/cancel] 取消失敗', {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: outcome.code,
      sqlstate: outcome.sqlstate,
      message: outcome.logMessage,
    });
    // 🔴 **revalidate 排在 log 之後、且不准吃掉回傳**(關卡2 codex must-fix):
    //    原本它排在最前面 —— 它一拋錯,補償 log、原 token 與凍結 state 就**全部不會發生**,
    //    員工拿到 500、重載換到新 token,而前一次可能已經 commit ⇒ 正是重複部分取消的路。
    safeRevalidate(parsed.orderId, httpRequestId);
    // 🔴 **原樣帶回這次送出的 token**(不鑄新的):換新鍵 = 全新 payload_hash =
    //    同一份 payload 會真的再取消一次(`cancel-action-state.ts:265-266`)。
    // 🔴 **`carried` 也要原樣帶回**:片 4 義務 5 的比對要在凍結畫面上做,
    //    而畫面得先知道「員工剛送出的是什麼」才畫得出那一列。
    return cancelSentFailure(outcome.code, carried, parsed.requestToken);
  }

  // 🔴 成功也留一行 log:把 `request_token` 對回 `cancellation_id` ——
  //    災難當天員工手上只有 token,而帳本上的鍵是 cancellation_id,靠這行才接得起來。
  //    (稽核本體在 DB 的 `admin_audit_log`,這行是營運可觀測面、不是稽核。)
  console.info('[admin/orders/cancel] order_cancel.done', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    order_id: parsed.orderId,
    cancellation_id: outcome.cancellationId,
    idempotent: outcome.idempotent,
    closed: outcome.closed,
  });
  safeRevalidate(parsed.orderId, httpRequestId);

  // 🔴 `idempotent: true` 也是成功:它意謂 RPC 認出同鍵同 payload 而吸收掉這次重送
  //    ——顯示成錯誤會誘導員工換一把 token 重送 = 冪等設計反而製造第二筆取消
  //    (同備註片對 `DUPLICATE_REQUEST` 的處置,`note-actions.ts:45-47`)。
  // ④ 成功才 PRG。🔴 在任何 try 之外 —— 全檔唯一的 try 在 `safeRevalidate()` 裡、
  //    包的是 `revalidatePath`,碰不到這一行(關卡2 R2 更正我原本寫的「本檔根本沒有 try」)。
  redirect(`${detailPath(parsed.orderId)}?r=${ORDER_CANCELLED_RESULT_CODE}`);
}
