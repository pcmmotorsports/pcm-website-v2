import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// refund-repository.ts — M-3 A7c RW2c:退款兩支 owner RPC 的唯一呼叫端 + 訂單窄讀。
//
// 🔴 稽核由 RPC **同交易**寫(`20260803150000` 步 9 / 步 8),本層不碰 `admin_audit_log`。
//
// 🔴 **回傳碼窮盡收斂**(RPC COMMENT 逐字「呼叫端必斷言 ∈ 全集」;memory
//    `feedback_null-dispatch-rpc-silently-downgrades`):未知碼 / 缺欄 / 非物件一律
//    `RefundCallerBugError` 拋出,不得靜默當成功 —— 動錢路徑上「零錯誤而事情沒發生」
//    與「事情發生了而呼叫端不知道」都是雙退的溫床。
//
// 🔴 admin 訂單顯示層投影**刻意零 tappay_rec_trade_id**(`SupabaseOrderAdapter.ts:90`)⇒
//    退款要的 {display_id, payment_status, tappay_rec_trade_id} 走本檔的窄讀,不擴顯示層投影。

/**
 * initiate 的 9 個固定回傳碼。前 8 碼 = migration `20260803150000:414-416` 逐字。
 *
 * ⛔ ~~🔴 第 9 碼 `REFUND_EXCEEDS_REMAINING` = **#445 步 6b 超退閘**,由 **445b** 建立 ——~~
 * ⛔ ~~**今天庫裡那支 RPC 還不會吐它**,本片刻意先接。~~
 * ⛔ ~~⇒ **445a 必須先 deploy,才准 apply 445b**(順序要寫進 445b migration 檔頭)。~~
 *
 * 🔴🔴 **2026-08-30:上面那段【前提沒有成立】,舊字面留著讓引用它的人同一發撞到這裡。**
 *    `445b` 真的落地時**不是**「RPC 多回一個 JSON 碼」,而是
 *    **`order_refunds` 上一道 BEFORE INSERT trigger,超額直接 `RAISE ... USING ERRCODE='PCM04'`**
 *    (`20260830210000`,2026-08-30 已 apply 上正式庫)。
 *    ⇒ 📌 **RAISE 會讓整筆交易回滾 ⇒ RPC 根本沒有機會回傳任何 JSON** ——
 *       所以那第 9 個碼**今天不可達,而且照現行 445b 的形狀永遠不會可達。**
 *
 * ⚠️ **後果一(codex 關卡2 nit 5 抓到)**:`refund-repository.test.ts` 與
 *    `refund-actions-dispatch.test.ts` 裡驗那個碼的那幾格,**驗的是一條到不了的分支**
 *    ⇒ 它們是綠的,而那個綠**灌大了覆蓋率的印象**。
 * ⚠️ **後果二**:`refund-actions.ts` 那個 `case 'REFUND_EXCEEDS_REMAINING':` 是死碼。
 *
 * ⛔ ~~本片【不刪】它們 —— 刪除是範圍擴張~~
 * ✅ **2026-08-31 刪了(`⟦b4-EXCEEDSDEAD⟧` 甲案,`-48` 批)。而批它的理由是【兩邊的量測】不是推薦**:
 *    甲 = 20 處 / 6 支檔(非註解實碼 15)· **不含任何 migration** · 一顆 commit
 *    乙 = 改回 JSON 碼 ⇒ 要動**已 apply** 的 `20260830210000` ⇒ 一支新 migration ⇒ Sean 的手
 *      🔴 而它要**重做一次已經做完的證明** —— 445b 的併發正確性是**實測**出來的
 *        (`FOR NO KEY UPDATE` 把兩個 session 序列化,harness 7 個量測點)
 *      📌 **⇒ 而「重證」的成本不只是時間,是【那次重證有可能證不出同樣的結論】。**
 *
 * 🔵 **而刪之前我多量了一發,它是決定性的**(先前我只掃 `apps` + `packages`):
 *    `supabase/` 裡 `REFUND_EXCEEDS_REMAINING` ⇒ **4 處,而全部在 445b 那支的【註解】裡**;
 *    `blocked_by` 在 `supabase/` ⇒ **0 處**;
 *    而那支 RPC 自己列出的回傳碼(`20260803150000:415-416`(座標已訂正,見本檔上方那一處)(⛔ ~~舊座標~~ 🔴 **2026-08-31 訂正:那支 RPC 的【最新一代】是 `20260812170000:480` 的 `CREATE OR REPLACE`,不是 `20260803150000`** —— 用 `scripts/latest-definition-of.sh admin_initiate_order_refund` 查到的。✅ **結論不變**:在最新那一代裡重數,仍然恰 8 碼、與 `INITIATE_RESULT_CODES` 逐字相同,而 `REFUND_EXCEEDS_REMAINING` / `blocked_by` 在該代 **0 命中**(負對照現造字面亦 0)。📌 **⇒ 我的結論是對的,而我的【證據指著一份已經被取代的定義】—— 那份舊的當時也是 8 碼,所以【指錯代】與【指對代】印出同一個答案。**) 逐字)是 8 個,**沒有它**。
 *    🔵 正對照 `'INITIATED'` 在 `supabase/` ⇒ 3 · 負對照現造字面 ⇒ 0。
 *    ⇒ 📌 **⇒ 也就是說:那是一份【只存在於 app 這一側】的協定 —— DB 那一側從來沒有實作過它。**
 * ✅ **今天真正在接那個閘的是 `RefundCapGuardError` / `toCapGuard`(本檔下方)。**
 */
export const INITIATE_RESULT_CODES = [
  'INITIATED',
  'DUPLICATE_REQUEST',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_REFUNDABLE',
  'ORDER_NO_CARD_TRANSACTION',
  'REFUND_LEDGER_FULL',
  'REFUND_IN_FLIGHT',
  'REFUND_NOTHING_LEFT',
] as const;
export type InitiateResultCode = (typeof INITIATE_RESULT_CODES)[number];

// ⛔ ~~`REFUND_BLOCKED_BY_VALUES = ['amount','in_flight','unknown']` + `type RefundBlockedBy`~~
// 🔴 **2026-08-31 整段刪(`⟦b4-EXCEEDSDEAD⟧` 甲,`-48` 二次批「一起刪」)** ——
//    刪前當場量:`grep -rn 'REFUND_BLOCKED_BY_VALUES\|RefundBlockedBy' apps packages scripts`
//    ⇒ 5 處命中,而**沒有一處是使用**(1 宣告 + 1 型別別名 + 2 已加刪除線的歷史字面
//      + 1 格只驗「這個常數的內容是什麼」的測試)⇒ **零個真實使用者。**
// 📌 **而它值得記的不是死碼本身,是:被刪掉的那段 JSDoc 寫得非常好** ——
//    三個值各自解釋、各自寫了「員工該做什麼」⇒ **它讀起來完全像一個活著的合約。**
//    🔴 **一段寫得越好的註解,越不會讓人去查它還有沒有人在用。**


/** finalize 的 3 個固定回傳碼(`20260803150000:607`)。 */
export const FINALIZE_RESULT_CODES = [
  'FINALIZED',
  'HELD_AMOUNT_MISMATCH',
  'REFUND_NOT_FOUND',
] as const;
export type FinalizeResultCode = (typeof FINALIZE_RESULT_CODES)[number];

/**
 * 本層開放的 outcome = 同步路徑四碼**而已**。恢復出口(recovered_confirmed / manual_failed)
 * 是 RW4 人工流程專屬 —— 型別層就不給 action 拿到,不靠「記得別傳」。
 * 由 FinalizeOrderRefundArgs 判別聯合導出=單一真相、不另養一份會漂移的清單。
 */
export type SyncFinalizeOutcome = FinalizeOrderRefundArgs['outcome'];

/**
 * 呼叫端契約違反(未知碼 / 缺欄 / RPC RAISE)。員工訊息會叫他**停手**,不是「稍後再試」。
 */
export class RefundCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundCallerBugError';
  }
}

/**
 * 🔴 finalize 的「回應解析失敗」專屬子型別(RW4 關卡2 codex R2 must-fix):
 * RPC RAISE=交易**確定回滾**(零寫入);但走到回應解析才炸=RPC 已成功、交易**已 commit**、
 * 只是回傳形狀不可信 —— 兩者的員工指示相反(前者「沒寫入」/後者「可能已完成、先確認現況」),
 * 共用一個型別會讓呼叫端把已寫入說成沒寫入。子類化保持既有 `instanceof RefundCallerBugError`
 * 行為不變(同步路徑零行為差),恢復 action 先驗子型別。
 */
export class RefundFinalizeParseError extends RefundCallerBugError {
  constructor(message: string) {
    super(message);
    this.name = 'RefundFinalizeParseError';
  }
}

/**
 * 🔴 RPC 的 RAISE → `RefundCallerBugError`(A9d2-1 F4 同型判別)。
 *
 * 本呼叫路徑上的 RAISE 面:①兩 RPC 步 1-2 的輸入/互斥面(P0001)②G4 同鍵指紋不符 /
 * 已終結重放(P0001)③CAS 失敗(P0001)④帳本 trigger 守門(**自訂 SQLSTATE `P7Cxx`**,
 * `20260801120000` + RW1a 新增 —— 它們被 RPC 打中=RPC 前置沒篩到=同屬呼叫端契約面)
 * ⑤狀態機 RAISE(P0001)。全部是「停手」語意,收斂一致。
 * 前提(grep supabase/migrations 實查):orders 表唯一 trigger = `orders_freeze_shipping_snapshot_bi`
 * (BEFORE **INSERT**、`20260725120000:104-105`)⇒ G8 的 orders UPDATE 路徑上零其他 RAISE 源;
 * ⛔ ~~order_refunds 的三支 trigger 全在上列 ④⑤。~~ 🔴 **這句 2026-08-30 起不成立,舊字面留著**
 * ——`445b`(`20260830210000`)在 order_refunds 上又掛了一支 `order_refunds_a445b_cap_guard_bi`,
 * 而它吐的 `PCM04/05/06` **既不是 ④ 也不是 ⑤** ⇒ 由下方 `toCapGuard` 接,**不走本函式**。
 * 📌 **⇒ 不要拿這句推出「`isRpcRaise` 的分母是完整的」** —— 它從來只答「哪些碼算契約違反」。
 */
/**
 * 🔴 `445b` 上限閘的自訂 SQLSTATE(`20260830210000`)—— **它們刻意不走 `isRpcRaise`。**
 *
 * 為什麼要另開一道:`RefundCallerBugError` 的語意是「**呼叫端寫錯了**」,員工訊息叫他停手。
 * 而 `PCM04`(退款金額超過上限)**不是 bug,是一個正常的業務結果** —— 員工的正確動作是
 * **改個金額再送一次**,不是停手找維護。兩者合流 ⇒ 畫面上分不出來 ⇒ 員工被叫去做錯的事。
 *
 * 三個碼各自對應誰去處理:
 *   `PCM04` 超額            ⇒ 員工自己改金額(`exceeds_remaining`)
 *   `PCM05` 算不出上限      ⇒ 停手、通知系統維護(`exceeds_unknown`)
 *   `PCM06` 隔離級別不對    ⇒ 停手、通知**管理者查資料庫設定**(`db_config`)
 * 📌 **一個失敗碼的用途是【告訴人去找誰】** —— 三個不同的人 ⇒ 三個碼,不合流。
 *
 * ⚠️ 本型別**不繼承** `RefundCallerBugError` —— 繼承會讓既有的
 * `error instanceof RefundCallerBugError` 分支先攔到它,而那正是本註解要防的合流。
 */
export class RefundCapGuardError extends Error {
  readonly sqlstate: CapGuardSqlstate;
  /**
   * 🔴 **與 `sqlstate` 同值,而它不是重複**(codex 關卡2 nit 4):
   * 把原始 PostgrestError 收進 `cause` **保不住頂層 `.code`** —— 而事故當天照 SQLSTATE
   * 撈 log 的人讀的正是 `.code`,他會撈到 `undefined` ⇒ **漏件,而漏的那一筆長得像沒發生。**
   * ⇒ 這裡把它補回頂層。⚠️ 下游若真要 `details`/`hint`,那些仍在 `cause` 上。
   */
  readonly code: CapGuardSqlstate;
  /**
   * ⟦b4-CAPMSGNUM⟧ **DB 算好的那個數字** —— `PCM04` 才有,其餘碼是 `null`。
   *
   * 🔴 **它為什麼不是從 message 挖出來的**:本 repo 明文紀律「分類依 SQLSTATE、
   *    **不解析 RPC message 的內容**」(`manual-refund-repository.ts` 檔頭)。
   *    從人話字串挖數字 = 做一個**跟著文案漂**的解析器:DB 那句話改一個字,
   *    員工看到的金額就變成 `undefined` —— 而**三綠不會紅、型別也不會紅**。
   * ⇒ 所以 `20260902000000` 把它放進 `DETAIL` 的 JSON,而這裡讀那個欄位。
   * ⚠️ 解析失敗 ⇒ `null`,**不是 throw** —— 這條路上錢已經確定沒有動,
   *    為了一個「訊息裡少一個數字」把員工丟到 bug 畫面是更糟的交換。
   */
  readonly cap: number | null;
  constructor(
    sqlstate: CapGuardSqlstate,
    message: string,
    options?: { cause?: unknown; cap?: number | null },
  ) {
    super(message);
    this.name = 'RefundCapGuardError';
    this.sqlstate = sqlstate;
    this.code = sqlstate;
    // 🔴 **【codex R2 MF3 折一半】不變式搬進 constructor, 不是只放在唯一的 producer 裡。**
    //    上一版把「只有 PCM04 有 cap」綁在 `capFromDetails` ⇒ 那只守住了**今天唯一那個**呼叫端。
    //    ⇒ 日後有人直接 `new RefundCapGuardError('PCM05', …, { cap: 300 })`,
    //      員工會看到「算不出上限」後面跟著一個上限 —— **一句自我矛盾的話**, 而沒有東西會紅。
    //    ⇒ 📌 **一個只在【目前唯一的入口】成立的規則, 不是不變式, 是巧合。**
    //    ⇒ ⇒ 放在 constructor ⇒ 不論誰建它、從哪裡建, 都成立。
    this.cap = sqlstate === 'PCM04' ? (options?.cap ?? null) : null;
    // 🔴 原始 PostgrestError 掛在 cause 上(關卡2 nit 13)—— 換掉它會讓 `details`/`hint`
    //    在下游消失,而 `refund-recovery-actions.ts` 那條路正在讀原始物件的 `code`。
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/**
 * 三個碼對到哪個員工訊息 —— **窮盡 Record,不是三元鏈**(關卡2 nit 5)。
 * 🔴 union 日後加第四個碼(PCM07…)時這裡**編譯會紅**;三元鏈會讓它靜默落進 fallback。
 *
 * ⚠️ **`PCM05` 有兩個語意而這裡只映一個**(關卡2 Important 4,開 migration 量的):
 *   `20260830210000:237-241` = **找不到訂單**(DB 的話是「請重新整理後確認」)
 *   `20260830210000:270-276` = **算不出上限**(「請找工程確認」)
 *   COMMENT `:297` 逐字「PCM05=算不出上限**或查無訂單**」。
 * ⇒ 同一個 SQLSTATE ⇒ **app 層分不出來**。這裡選 `exceeds_unknown`(勿重試、通知維護),
 *   理由是**錯的方向比較安全**:把「該重新整理」的人送去找維護 ⇒ 白跑一趟、錢不動;
 *   反過來把「系統算不出上限」說成「重新整理就好」⇒ 他會一直按。
 * 🛑 **真正的修法是在 migration 裡把它拆成兩個碼**,而那支已 apply ⇒ 要新的一支。
 *   已開列 `⟦b4-PCM05SPLIT⟧`。**這一格是殘餘風險,不自宣接受。**
 */
export const CAP_GUARD_SQLSTATES = ['PCM04', 'PCM05', 'PCM06'] as const;
export type CapGuardSqlstate = (typeof CAP_GUARD_SQLSTATES)[number];

/**
 * ⟦b4-CAPMSGNUM⟧ 從 `PostgrestError.details` 讀出 DB 算好的可退上限。
 *
 * 🔴 **每一步都可能不成立,而每一步不成立都回 `null`**(而不是丟例外):
 *    ①`details` 不是字串(舊版 DB 還沒 apply ⇒ 它是空字串或 undefined)
 *    ②不是合法 JSON  ③沒有 `cap` 欄  ④`cap` 不是有限數字
 * ⇒ 📌 **這四種在畫面上長得一樣:那句話就是沒有數字** —— 與今天的行為完全相同。
 *   ⇒ ⇒ 所以【DB 還沒 apply 新的那一支】時,這一整條路是安全的:訊息退回舊樣子,不會壞。
 */
function capFromDetails(sqlstate: CapGuardSqlstate, error: unknown): number | null {
  // 🔴 **【codex R1 MF3】綁 SQLSTATE, 而它原本只寫在註解裡。**
  //    原版註解逐字宣稱「`PCM04` 才有,其餘碼是 `null`」—— 而**碼沒有在做那件事**:
  //    `PCM05` 的語意是【算不出上限】, 它若哪天也帶了一個 `cap`,
  //    員工會在「算不出上限」那句話後面看到一個上限 ⇒ **一句自我矛盾的話。**
  //    ⇒ 📌 **一個寫在註解裡的不變式, 不是不變式。**
  if (sqlstate !== 'PCM04') return null;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'string' || details.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const cap = (parsed as { cap?: unknown }).cap;
  // 🔴 **【codex R1 MF2】`Number.isFinite` 收得太寬** —— 它放行負數、小數,
  //    以及**超過 2^53 之後已經被 `JSON.parse` 動過手腳**的整數(DB 那側是 `bigint`)。
  //    ⇒ 三種都會讓員工看到一個**錯的金額**, 而畫面完全正常。
  //    ⇒ ⇒ 這個值的形狀是【非負的安全整數(單位:元)】—— 照那個形狀收, 不是照「是不是數字」。
  //    🔵 而 DB 那側已經 `GREATEST(v_cap, 0)` ⇒ 負數本來就不該出現;
  //       這裡再擋一次是因為**兩邊各自都會改**, 而只有這一側看得到員工。
  return typeof cap === 'number' && Number.isSafeInteger(cap) && cap >= 0 ? cap : null;
}

/** 認得就回具名錯,認不得回 null(**不是 boolean** —— 呼叫端要用到那個碼)。 */
function toCapGuard(fn: string, error: unknown): RefundCapGuardError | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (!(CAP_GUARD_SQLSTATES as readonly unknown[]).includes(code)) return null;
  const detail = String((error as { message?: unknown }).message ?? '').slice(0, 200);
  return new RefundCapGuardError(code as CapGuardSqlstate, `${fn} 被上限閘擋下(${code}):${detail}`, {
    cause: error,
    cap: capFromDetails(code as CapGuardSqlstate, error),
  });
}

function isRpcRaise(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P0001' || (typeof code === 'string' && /^P7C/.test(code));
}

function toCallerBug(fn: string, error: { message?: unknown }): RefundCallerBugError {
  return new RefundCallerBugError(
    `${fn} 拒收本次呼叫(RAISE):${String(error.message ?? '').slice(0, 200)}`,
  );
}

// ── 訂單窄讀 ────────────────────────────────────────────────────────────────

export type RefundableOrderSnapshot = {
  displayId: string;
  paymentStatus: string;
  tappayRecTradeId: string | null;
};

/** 退款前的 server 重讀(app 層縱深;RPC 的 G12/白名單/P7C02-03 仍是權威)。查無 → null。 */
export async function findOrderForRefund(
  orderId: string,
): Promise<RefundableOrderSnapshot | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('orders')
    .select('display_id, payment_status, tappay_rec_trade_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    displayId: data.display_id,
    paymentStatus: data.payment_status,
    tappayRecTradeId: data.tappay_rec_trade_id,
  };
}

// ── RPC 1:initiate ─────────────────────────────────────────────────────────

/**
 * 🔴 kind 判別聯合(關卡2 codex must-fix):RPC 的互斥是合約(弄反=RAISE,而且發生在
 * INSERT 之前=無害、但發生在呼叫端手滑時 typecheck 就該紅)——
 * partial 必帶正整數 amount + recordAmount null;full 相反(recordAmount=Record 凍結額)。
 */
export type InitiateOrderRefundArgs = {
  orderId: string;
  /** G0 baseline(Record `refunded_amount`;欄缺時 action 已 abort、不得傳 0 充數)。 */
  recordRefundedBefore: number;
  reason: string;
  actor: string;
  requestId: string;
} & (
  | { kind: 'full'; amount: null; recordAmount: number }
  | { kind: 'partial'; amount: number; recordAmount: null }
);

export type InitiateOrderRefundOutcome =
  | {
      result: 'INITIATED';
      refundId: string;
      bankRefundId: string;
      /** RPC 凍結額(full=Record 剩餘額 / partial=員工輸入);= refund() 的預期受理額。 */
      refundAmount: number;
    }
  | {
      result: 'DUPLICATE_REQUEST';
      refundId: string;
      bankRefundId: string;
      refundAmount: number;
      rowStatus: 'processing' | 'confirmed';
    }
  // ⛔ ~~| { result: 'REFUND_EXCEEDS_REMAINING'; remaining: number | null; blockedBy: RefundBlockedBy }~~
  //    🔴 **2026-08-31 刪(`⟦b4-EXCEEDSDEAD⟧` 甲案)** —— 那支 RPC 從來沒有回過這個碼:
  //    它自己列出的回傳碼是 8 個(`20260803150000:415-416`(座標已訂正,見本檔上方那一處) 逐字),**沒有它**;
  //    而 `blocked_by` 在整個 `supabase/` ⇒ **0 處**。
  //    ⇒ 📌 **那是一份【只存在於 app 這一側】的協定 —— DB 那一側從來沒有實作過它。**
  //    ✅ 而今天真的在做那件事的是 `445b` 的 trigger + `RefundCapGuardError`(本檔下方)。
  | {
      result:
        | 'ORDER_NOT_FOUND'
        | 'ORDER_NOT_REFUNDABLE'
        | 'ORDER_NO_CARD_TRANSACTION'
        | 'REFUND_LEDGER_FULL'
        | 'REFUND_IN_FLIGHT'
        | 'REFUND_NOTHING_LEFT';
    };

function asRecord(fn: string, data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new RefundCallerBugError(`${fn} 回傳非物件:${JSON.stringify(data)?.slice(0, 200)}`);
  }
  return data as Record<string, unknown>;
}

function requireString(fn: string, row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value === '') {
    throw new RefundCallerBugError(`${fn} 回傳缺 ${key}:${JSON.stringify(row).slice(0, 200)}`);
  }
  return value;
}

/** 凍結額必為正整數(RPC CHECK refund_amount>0 保證;非正=合約漂移,fail-loud 不放行到 refund())。 */
function requirePositiveInt(fn: string, row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RefundCallerBugError(
      `${fn} 回傳缺 ${key} 或非正整數:${JSON.stringify(row).slice(0, 200)}`,
    );
  }
  return value;
}

// ⛔ ~~`function requireNonNegativeIntOrNull(fn, row, key): number | null`~~(連它上方那段 JSDoc)
// 🔴 **2026-08-31 刪(`⟦b4-EXCEEDSDEAD⟧` 甲,codex 對抗審查 must-fix 1 抓到)** ——
//    它唯一的呼叫點是已刪的 `REFUND_EXCEEDS_REMAINING` 解析區塊。當場量:
//    `grep -rn requireNonNegativeIntOrNull apps packages scripts` ⇒ **只剩宣告本身,0 個呼叫者。**
// 🔴 **而這一格是【我漏掉的第三個】,不是我找到的**:同一片我已經自己抓到
//    `REFUND_BLOCKED_BY_VALUES` 與 `RefundBlockedBy` 兩個,**然後就停了**。
//    📌 **⇒ 我找的是【我記得自己加過什麼】,而 codex 找的是【現在誰沒有呼叫者】——
//       兩個分母不一樣,而我那個分母的上界是我的記憶。**
// 🔵 它被刪掉的那段 JSDoc 值得留一句:它寫著「`0` 合法 / `null` 合法 / 負值=合約漂移」,
//    **那個區分是對的,而且將來 `⟦b4-CAPMSGNUM⟧` 把 cap 值從 `DETAIL` 帶回來時會再需要它一次。**
//    ⇒ 到時**重寫**,不要從這裡挖 —— 那時的合法值集合要重新回答一次。


/**
 * 登記退款(帳先記、後打 API)。逐欄具名送、不 spread(A9d2-1 慣例;spread 繞過
 * TS 多餘屬性檢查)。RAISE → `RefundCallerBugError`;回傳逐碼驗形狀後收斂成 union。
 */
export async function initiateOrderRefund(
  args: InitiateOrderRefundArgs,
): Promise<InitiateOrderRefundOutcome> {
  const fn = 'admin_initiate_order_refund';
  const { data, error } = await createSupabaseServiceClient().rpc(fn, {
    p_order_id: args.orderId,
    p_kind: args.kind,
    p_amount: args.amount,
    p_record_refunded_before: args.recordRefundedBefore,
    p_record_amount: args.recordAmount,
    p_reason: args.reason,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) {
    // 🔴 上限閘先判 —— 它的三個碼都不是 P0001/P7Cxx,不會被下一行攔走,
    //    但順序寫死在這裡是為了讓「不合流」這件事在碼上看得見。
    const capGuard = toCapGuard(fn, error);
    if (capGuard) throw capGuard;
    if (isRpcRaise(error)) throw toCallerBug(fn, error);
    throw error;
  }
  const row = asRecord(fn, data);
  const result = row.result;
  if (typeof result !== 'string' || !(INITIATE_RESULT_CODES as readonly string[]).includes(result)) {
    throw new RefundCallerBugError(`${fn} 回傳非預期碼:${JSON.stringify(result)}`);
  }
  if (result === 'INITIATED') {
    return {
      result,
      refundId: requireString(fn, row, 'refund_id'),
      bankRefundId: requireString(fn, row, 'bank_refund_id'),
      refundAmount: requirePositiveInt(fn, row, 'refund_amount'),
    };
  }
  if (result === 'DUPLICATE_REQUEST') {
    const rowStatus = requireString(fn, row, 'status');
    if (rowStatus !== 'processing' && rowStatus !== 'confirmed') {
      // G4 只對 processing/confirmed 回 DUPLICATE(終結列是 RAISE);出現其他值=合約漂移。
      throw new RefundCallerBugError(`${fn} DUPLICATE_REQUEST 帶非預期 status:${rowStatus}`);
    }
    return {
      result,
      refundId: requireString(fn, row, 'refund_id'),
      bankRefundId: requireString(fn, row, 'bank_refund_id'),
      refundAmount: requirePositiveInt(fn, row, 'refund_amount'),
      rowStatus,
    };
  }
  return {
    result: result as Exclude<
      InitiateResultCode,
      'INITIATED' | 'DUPLICATE_REQUEST'
    >,
  };
}

// ── RPC 2:finalize ─────────────────────────────────────────────────────────

/**
 * 🔴 outcome 判別聯合(關卡2 codex must-fix;鏡像 RPC 步 2 的參數矩陣):
 * accepted 必帶 wire refundId + wire 金額(G7 比對);deferred 全 null;
 * rejected/not_sent 只可帶診斷文字(≤500;呼叫端碼位截 450 留餘裕)。
 * 非法組合(如 deferred 帶 refundId)在編譯期就紅,不等 RPC RAISE。
 */
export type FinalizeOrderRefundArgs = {
  refundId: string;
  actor: string;
  requestId: string;
} & (
  | { outcome: 'accepted'; tappayRefundId: string; refundAmountWire: number; failedDetail: null }
  | {
      outcome: 'deferred_not_captured';
      tappayRefundId: null;
      refundAmountWire: null;
      failedDetail: null;
    }
  | {
      outcome: 'rejected_out_of_range' | 'not_sent';
      tappayRefundId: null;
      refundAmountWire: null;
      failedDetail: string | null;
    }
);

export type FinalizeOrderRefundOutcome =
  | { result: 'FINALIZED'; statusAfter: string; paymentStatusAfter: string }
  | { result: 'HELD_AMOUNT_MISMATCH'; statusAfter: string; paymentStatusAfter: string }
  | { result: 'REFUND_NOT_FOUND' };

/**
 * 🔴 RW4 恢復出口專用判別聯合(鏡像 RPC 步 2 矩陣的恢復半邊):
 * recovered_confirmed 必帶 Portal 真 DR 碼(P7C09/P7C13 由 DB 收口);
 * manual_failed 必帶含 Record 證據數字的 failed_detail。
 * 與 `FinalizeOrderRefundArgs`(同步四碼)刻意分型 —— 同步 action 拿不到恢復碼、
 * 恢復 action 拿不到同步碼,「記得別傳」不是防護,型別才是。
 */
export type RecoveryFinalizeArgs = {
  refundId: string;
  actor: string;
  requestId: string;
} & (
  | { outcome: 'recovered_confirmed'; tappayRefundId: string; failedDetail: null }
  | { outcome: 'manual_failed'; tappayRefundId: null; failedDetail: string }
);

/** 結案。unknown-state **沒有對應 outcome** —— 呼叫端不得為它呼本函式(列留 processing 走 RW4)。 */
export async function finalizeOrderRefund(
  args: FinalizeOrderRefundArgs,
): Promise<FinalizeOrderRefundOutcome> {
  return callFinalizeRpc({
    refundId: args.refundId,
    outcome: args.outcome,
    tappayRefundId: args.tappayRefundId,
    refundAmountWire: args.refundAmountWire,
    failedDetail: args.failedDetail,
    actor: args.actor,
    requestId: args.requestId,
  });
}

/** RW4 人工結案(判定閘在 action 端:送出當下重判、判定不符不得呼到這裡)。 */
export async function finalizeRecoveryOrderRefund(
  args: RecoveryFinalizeArgs,
): Promise<FinalizeOrderRefundOutcome> {
  return callFinalizeRpc({
    refundId: args.refundId,
    outcome: args.outcome,
    tappayRefundId: args.tappayRefundId,
    // 恢復路徑不帶 wire 金額(RPC 步 2:accepted 以外帶了就 RAISE)。
    refundAmountWire: null,
    failedDetail: args.failedDetail,
    actor: args.actor,
    requestId: args.requestId,
  });
}

/** 兩個出口共用的唯一 wire 點(參數矩陣已由上面兩個判別聯合各自釘死)。 */
async function callFinalizeRpc(params: {
  refundId: string;
  outcome: string;
  tappayRefundId: string | null;
  refundAmountWire: number | null;
  failedDetail: string | null;
  actor: string;
  requestId: string;
}): Promise<FinalizeOrderRefundOutcome> {
  const fn = 'admin_finalize_order_refund';
  const { data, error } = await createSupabaseServiceClient().rpc(fn, {
    p_refund_id: params.refundId,
    p_outcome: params.outcome,
    p_tappay_refund_id: params.tappayRefundId,
    p_refund_amount_wire: params.refundAmountWire,
    p_failed_detail: params.failedDetail,
    p_actor: params.actor,
    p_request_id: params.requestId,
  });
  if (error) {
    // 🔴 上限閘先判 —— 它的三個碼都不是 P0001/P7Cxx,不會被下一行攔走,
    //    但順序寫死在這裡是為了讓「不合流」這件事在碼上看得見。
    const capGuard = toCapGuard(fn, error);
    if (capGuard) throw capGuard;
    if (isRpcRaise(error)) throw toCallerBug(fn, error);
    throw error;
  }
  // 🔴 自此交易已 commit —— 解析失敗一律升為 RefundFinalizeParseError(見 class 註解)。
  try {
    const row = asRecord(fn, data);
    const result = row.result;
    if (
      typeof result !== 'string' ||
      !(FINALIZE_RESULT_CODES as readonly string[]).includes(result)
    ) {
      throw new RefundCallerBugError(`${fn} 回傳非預期碼:${JSON.stringify(result)}`);
    }
    if (result === 'REFUND_NOT_FOUND') return { result };
    return {
      result: result as 'FINALIZED' | 'HELD_AMOUNT_MISMATCH',
      statusAfter: requireString(fn, row, 'status_after'),
      paymentStatusAfter: requireString(fn, row, 'payment_status_after'),
    };
  } catch (parseError) {
    if (parseError instanceof RefundCallerBugError) {
      throw new RefundFinalizeParseError(parseError.message);
    }
    throw parseError;
  }
}
