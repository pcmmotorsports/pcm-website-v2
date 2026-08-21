// refund-unknown-state-audit.ts — 讓 unknown-state 這條路**留下一列稽核**。
//
// ── 這支解的是什麼 ─────────────────────────────────────────────────────────
// unknown-state 分支**刻意不 finalize**、帳本那一列從此不再被動(`refund-actions.ts:62-65`
// 逐字「不 finalize 不是漏做 —— unknown-state 在 RPC 端沒有對應 outcome(刻意不可表達)」)。
// 本片**不碰那個決定**:帳本照樣留 processing、照樣不給終態。
// 它只是在**旁邊**記一筆「這件事發生過」,讓一天後回頭看的人有一個起點。
//
// 🔴 **本片跨過 `orders/payment-actions.ts:46` 的字面**(「錢的路徑一律由 RPC 同交易寫」)。
//    不要把這當成慣例鬆動,理由要跟著讀:
//    · 那條規則買到的東西是**原子性** —— 稽核列與錢的動作同生共死,不可能各說各話。
//    · 而**這條路上沒有交易可以參加**:TapPay 已經打完、RPC 端刻意沒有對應 outcome、
//      DB 一個字都不會被寫。⇒「同交易」在這裡不是被違反,是**不存在**。
//    · 考慮過的替代案(新開一支只寫稽核的 RPC)只滿足規則的**字面**:那支 RPC 有它自己的
//      交易,而錢的動作早就結束在 TapPay 那邊 ⇒ 換到的是形式,代價是 migration。
//    ⚠️ **那條規則當初的用意沒有人寫下來,我們沒有替原作者下定論。**
//       主視窗 2026-08-21 判「乙不滿足用意,故選甲」;codex R1 的判定見審查紀錄。
//       **這段爭論刻意留在檔案裡、不結案。** 下一個人有新證據可以推翻它。
//
// 🔴 **它是 best-effort,而失敗【不准無聲】**(主視窗 2026-08-21 條件④)。
//    寫失敗只 `console.error` 就算了 = **複製了這條線本來的病**
//    (我們做一個東西來解決「留不下痕跡」,而它自己也可能留不下痕跡)。
//    ⇒ 本函式回傳 boolean,呼叫端**必須**把 false 變成員工看得到的一句話。
//
// 🔴 措辭紀律(`Q9=甲`):寫進 `after` 的東西**只描述我們觀察到什麼**,不描述對方怎麼了。
//    分類碼的完整理由見 `refund-error-class.ts` 檔頭。
//
// 零金額、零 PII:`after` 只放識別碼與分類碼,`reason` 恆 NULL
// (對齊建表 `20260803150000:577` 逐字「audit.reason 一律 NULL(零自由文字/零 PII)」)。

import { getAdminAuditLogRepository } from '../orders/order-repository';
import {
  classifyRefundError,
  describeUnknownValue,
  type RefundErrorClass,
  type UnknownValueShape,
} from './refund-error-class';

/** 動作代碼。慣例 `<domain>.<entity>.<verb>`,對齊既有的 `order_refund.initiate`。 */
export const REFUND_UNKNOWN_STATE_ACTION = 'order_refund.unknown_state';

/**
 * 走到 unknown-state 的**哪一個**出口。三個出口是三種不同的病,合成一個會把資訊丟掉:
 * · `adapter_threw`                  打 TapPay 時拋了我們認不出的東西 —— 錢動沒動不知道
 * · `finalize_threw_after_accepted`  🔴 TapPay **已受理**(錢很可能動了),而帳本沒結成
 * · `resolved_status_unrecognized`   回來了,但狀態不是已知三態之一(合約漂移)
 */
export type RefundUnknownStateSite =
  | 'adapter_threw'
  | 'finalize_threw_after_accepted'
  | 'resolved_status_unrecognized';

export interface RefundUnknownStateAuditInput {
  readonly site: RefundUnknownStateSite;
  readonly orderId: string;
  readonly refundId: string;
  readonly bankRefundId: string;
  /** TapPay 受理後才有;其餘出口為 null。非空 = 錢很可能已經動了。 */
  readonly tappayRefundId?: string | null;
  /**
   * `adapter_threw` / `finalize_threw_after_accepted` 帶 error;合約漂移那格沒有。
   * 🔴 **不可用 `=== undefined` 判斷有沒有帶**(codex R1 F3):JS 允許 `throw undefined`,
   *    那會讓「真的拋了 undefined」與「這個站點沒有 error」變成同一個畫面。
   *    ⇒ 判準改用 `site`,見 `buildAfter`。
   */
  readonly error?: unknown;
  /**
   * 合約漂移那格帶回來的**原始值**。
   * 🔴 **呼叫端不准先 `String()` 它**(codex R1 F1/F2)—— 那既會 throw、拿到的又是外部自由字串。
   *    本模組只用 `describeUnknownValue()` 取封閉形狀。
   */
  readonly resolvedStatusValue?: unknown;
  readonly actor: string;
  readonly requestId: string;
}

/** 哪些出口**一定**有 error 要分類。用 `site` 判,不用 `error === undefined` 判(F3)。 */
const SITES_WITH_ERROR: ReadonlySet<RefundUnknownStateSite> = new Set([
  'adapter_threw',
  'finalize_threw_after_accepted',
]);

/** 🔴 只放固定字集與識別碼。**任何來自外部的自由字串都不進這裡。** */
function buildAfter(input: RefundUnknownStateAuditInput): Record<string, unknown> {
  // 🔴 F3:兩個 threw 出口即使 `error` 真的是 `undefined`,也要分類成 'other',
  //    不可以記成 null —— null 的意思是「這個出口本來就沒有 error」。
  const errorClass: RefundErrorClass | null = SITES_WITH_ERROR.has(input.site)
    ? classifyRefundError(input.error)
    : null;

  // 🔴 F1/F8:不存原字面,存封閉形狀。`''` 與「沒帶」也因此分得開
  //    (前者 type='string' length=0,後者 type='undefined')。
  const shape: UnknownValueShape | null =
    input.site === 'resolved_status_unrecognized'
      ? describeUnknownValue(input.resolvedStatusValue)
      : null;

  return {
    site: input.site,
    order_id: input.orderId,
    refund_row_id: input.refundId,
    bank_refund_id: input.bankRefundId,
    tappay_refund_id: input.tappayRefundId ?? null,
    error_class: errorClass,
    resolved_status_type: shape ? shape.type : null,
    resolved_status_length: shape ? shape.length : null,
  };
}

/**
 * 🔴 稽核寫入的硬逾時(codex R1 F5)。
 *
 * best-effort 的失敗面不只「reject」,還有**永遠不 settle**(DB client 卡住而不報錯)。
 * `try/catch` 與「永不 throw」都處理不了不 settle ⇒ 那條 `await` 會把**整個 server action
 * 掛在那裡**,員工看到的不是那句 unknown-state 訊息,是一個轉不完的圈。
 * **一個為了留痕而加的東西,反過來把主流程堵死** —— 這正是本片要防的病的鏡像。
 *
 * 🔴 **逾時之後那個寫入【可能還是會成功】** —— 我們沒有取消它,也取消不了。
 *    ⇒ 於是有一個看起來像 bug 的合法狀態:**畫面說「連紀錄都沒寫成」,而稽核表裡真的有那一列。**
 *    這個方向是**刻意選的**:讓員工多截一次圖是無害的,而反過來
 *    (說「有紀錄」但其實沒有)會讓一筆去向不明的錢**永遠沒有人去查**。
 *    ⚠️ 下一個人撈到那一列、又看到員工回報「畫面說沒寫成」時 —— **那不是矛盾,是這一格。**
 *
 * ⓘ `work` 在輸掉 race 之後若 reject,不會變成 unhandled rejection:
 *    `Promise.race` 對每個 racer 都掛了 onRejected,只是 race 已 settle ⇒ 那次 reject 被吞掉。
 */
export const REFUND_AUDIT_WRITE_TIMEOUT_MS = 3_000;

/** 逾時就當沒寫成。回傳 `'timeout'` 讓呼叫端的 log 分得出是哪一種失敗。 */
export async function withAuditTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; kind: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, kind: 'timeout' }), timeoutMs);
  });
  try {
    return await Promise.race([work.then((value) => ({ ok: true as const, value })), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 稽核寫入的結果。**只有 `written` 是確定的。**
 *
 * 🔴 **為什麼不是 boolean**(codex R2 F2):原本回 `false` 時,員工看到的那句話寫
 *    「連內部紀錄都沒有寫成」——**那是一句可能為假的話**:
 *    · `timeout` ⇒ 我們只是不等了,那個寫入**可能第 3.1 秒才成功**;
 *    · `failed`  ⇒ 連 reject 都不保證沒寫進去(insert 已 commit、回應才斷線)。
 *    ⇒ 兩種都只能說「**無法確認**」。宣稱「沒寫成」會讓下一個人撈到那一列時
 *      以為畫面壞了,也可能讓值班的人重複處理。
 *    ⇒ 字面必須等於事實(PCM §6),所以這裡分三態、文案改成「無法確認」。
 */
export type RefundAuditWriteOutcome = 'written' | 'failed' | 'timeout';

/**
 * 寫一列 unknown-state 稽核。
 * @returns `'written'` = 確定寫進去了;其餘兩種 = **無法確認**(呼叫端必須讓員工看到)。
 * 🔴 本函式**永不 throw** —— 它是失敗路徑上的補救,不可以再把主流程弄壞。
 */
export async function recordRefundUnknownStateAudit(
  input: RefundUnknownStateAuditInput,
): Promise<RefundAuditWriteOutcome> {
  try {
    const raced = await withAuditTimeout(
      getAdminAuditLogRepository().record(
        {
          action: REFUND_UNKNOWN_STATE_ACTION,
          target: `order:${input.orderId}`,
          before: null,
          after: buildAfter(input),
          // reason 恆 NULL:零自由文字、零 PII(對齊帳本 RPC 的既有紀律)。
        },
        {
          // 🔴 用 `requestToken` 而不是另產一把 —— 它與帳本那一列的 `request_id` 相同,
          //    下一個人才 join 得起來(「這列稽核」對「那筆退款」)。
          actor: input.actor,
          requestId: input.requestId,
          sourceApp: 'admin',
        },
      ),
      REFUND_AUDIT_WRITE_TIMEOUT_MS,
    );
    if (!raced.ok) {
      console.error('[admin/payment/refund] unknown-state 稽核寫入逾時', {
        request_id: input.requestId,
        bank_refund_id: input.bankRefundId,
        site: input.site,
        timeout_ms: REFUND_AUDIT_WRITE_TIMEOUT_MS,
      });
      return 'timeout';
    }
    return 'written';
  } catch (error) {
    console.error('[admin/payment/refund] unknown-state 稽核寫入失敗', {
      request_id: input.requestId,
      bank_refund_id: input.bankRefundId,
      site: input.site,
      // 🔴 連這裡都不印原文:同一條紀律,console 也是一個會被轉走的地方。
      write_error_class: classifyRefundError(error),
    });
    return 'failed';
  }
}
