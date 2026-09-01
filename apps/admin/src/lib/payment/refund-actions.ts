'use server';

import { redirect } from 'next/navigation';
import {
  TapPayRefundNotSentError,
  TapPayRefundUnknownStateError,
  toMoneyAmount,
} from '@pcm/domain';
import type { TapPayRefundPayload, TapPayRefundResult } from '@pcm/domain';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import { TapPayConfigError, getTapPayAdapter } from './composition';
import { REFUND_RECORD_QUERY_TIMEOUT_MS, checkRecordBaseline } from './refund-baseline';
import { parseRefundForm } from './refund-form';
// #350d-4:動作做完回發起的那個視圖(order 域五支共用的解析器 + 契約 §5 的單一 revalidate 實作)。
import {
  ORDER_RETURN_TO_FIELD,
  appendResultQuery,
  parseOrderReturnTo,
} from '../orders/order-return-to';
import { revalidateOrderViews } from '../orders/order-revalidate';
import { isRefundUiEnabled } from './refund-ui-flag';
import { listOrderRefunds } from './refund-read';
import { findEffectiveVerdicts } from './refund-correction-read';
import { isBlockingStuckVerdict, isStuckManualVerdict } from './refund-ledger-view';
import { describeUnknownValue } from './refund-error-class';
import { recordRefundUnknownStateAudit } from './refund-unknown-state-audit';
import {
  EMPTY_REFUND_INPUT,
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  REFUND_SUBMITTED_RESULT_CODE,
  generateRefundRequestToken,
  refundFailure,
  type RefundActionState,
  type RefundFailureCode,
  type RefundFormInput,
} from './refund-action-state';
import {
  RefundCallerBugError,
  RefundCapGuardError,
  type CapGuardSqlstate,
  finalizeOrderRefund,
  findOrderForRefund,
  initiateOrderRefund,
  type FinalizeOrderRefundArgs,
  type FinalizeOrderRefundOutcome,
} from './refund-repository';

// ⛔ ~~`const EXCEEDS_FAILURE_CODE: Record<RefundBlockedBy, RefundFailureCode>`~~
// 🔴 **2026-08-31 刪(`⟦b4-EXCEEDSDEAD⟧` 甲案)** —— 它唯一的使用者是那個已刪的
//    `case 'REFUND_EXCEEDS_REMAINING'`,而那個碼 DB 從來沒有回過。
// ⛔ ~~**而它的三個值沒有消失,它們搬到了【真的會發生的那條路】上**~~
// 🔴 **2026-08-31 訂正(codex 對抗審查 must-fix 2 抓到)—— 那句話是【三分之二真】。**
//    當場逐個對:
//      · `amount`    → `exceeds_remaining` ✅ 搬到了(`PCM04`)
//      · `unknown`   → `exceeds_unknown`   ✅ 搬到了(`PCM05`)
//      · `in_flight` → `exceeds_in_flight` 🔴 **沒有搬** —— `PCM06` 對到的是 `db_config`(新的),
//        而 `exceeds_in_flight` 今天**零個產生者**(`grep -rn exceeds_in_flight apps packages`
//        ⇒ 只有型別成員 + 訊息本身 + 一格測試,沒有任何一處在產生它)。
//    📌 **⇒ 我寫「三個值都搬過去」的時候,兩個是真的、第三個我沒有逐個去對。**
//       🔴 **而一個【三分之二真】的句子讀起來與一個全真的句子完全一樣** ——
//          它甚至更可信,因為它具體。
// 🔵 **`exceeds_in_flight` 本身沒刪**:`445b` 只做 `BEFORE INSERT`(`20260830210000:333`),
//    在途那一種未來仍可能需要它;⇒ 它是**留著的空位**,不是遺留的死碼。
//    ⚠️ 而「留著的空位」與「沒清乾淨的死碼」在 code 上長得一樣 —— **差別只在這段字。**

// refund-actions.ts — M-3 A7c RW2c:退款 server action(高風險片、鐵則 12 ①②)。
//
// 流程(plan v3.2 §2 丙 + §3 表,順序即合約):
//   授權(絕對第一)→ 啟用旗標 → 解析 → server 重讀訂單(確認碼/refunded 硬擋/卡交易)
//   → G0 recordQuery baseline → RPC initiate(帳先記)→ adapter.refund() → RPC finalize
//   → 成功才 redirect(PRG;**在一切 try 之外**,A9d2-1 R2-3)。
//
// 🔴 錯誤分派鐵律(§2 丙;`packages/domain/src/payment/types.ts:177-179` JSDoc 同語):
//    refund() 只認 `TapPayRefundNotSentError` 與三態結果;**其他一切 throw = unknown-state
//    ⇒ 不 finalize、列留 processing(S5 擋同單再發)、不自動重發、UI 顯「勿重試」**。
//    「不 finalize」不是漏做 —— unknown-state 在 RPC 端**沒有對應 outcome**(刻意不可表達)。
//
// 🔴 本檔沒有一行稽核 code —— 兩支 RPC 同交易寫 admin_audit_log(G9)。
// 🔴 本片收工時本 action 零呼叫端(入口 = RW2d);對 27 項驗收貢獻 0。

// 🔴 `ORDERS_PATH` / `detailPath()` 已於 #350d-4 **具名刪除**(零呼叫端):導頁與 revalidate 的
//    路徑一律由 `return_to`(過 `parseOrderReturnTo`)與 `revalidateOrderViews` 決定。
//    留著一支沒人用的路徑拼接器 = 下一個人繞過 `return_to` 的現成入口
//    (同 `order-detail-route.tsx` 刪掉零呼叫端 prop 的理由)。

/**
 * 碼位安全截斷(給 failed_detail 用):`.slice()` 按 UTF-16 units 切,切在 surrogate pair
 * 中間會產生 lone surrogate → JSON 序列化成不成對的 \uD800 → PG 端直接炸;
 * 按碼位切則永遠是合法字串,且碼位數 ≤ RPC 的 char_length 上限語意一致。
 */
function clipCodepoints(value: string, max: number): string {
  return [...value].slice(0, max).join('');
}

/** 失敗時帶回的員工輸入(Q1=A)。唯一空殼例外=denied(授權閘在讀表單之前);
 *  disabled 在 carryBack 之後才判 ⇒ 帶的是真輸入(RW2d 關卡2 nit 更正舊字面)。 */
function carryBack(formData: FormData): RefundFormInput & { requestToken: string } {
  // #365:回帶欄位同樣走「getAll 恰一筆」——送兩份時不再回顯第一筆,一律回空。
  const read = (field: string): string => readSingleString(formData, field) ?? '';
  const token = read(REFUND_REQUEST_TOKEN_FIELD);
  return {
    kind: read(REFUND_KIND_FIELD),
    amount: read(REFUND_AMOUNT_FIELD),
    reason: read(REFUND_REASON_FIELD),
    confirmCode: read(REFUND_CONFIRM_FIELD),
    // 🔴 原樣帶回;真的拿不到才新產(帶回舊的才能讓重按被 G4 認出,A9d2-1 R2-2 同理)。
    requestToken: token !== '' ? token : generateRefundRequestToken(),
  };
}

/**
 * `445b` 上限閘的三個 SQLSTATE → 員工訊息碼。**窮盡 Record,不是三元鏈**(關卡2 nit 5):
 * union 加第四個碼時這裡編譯會紅,三元鏈會讓它靜默落進 fallback。
 * ⚠️ `PCM05` 兩個語意只映一個 —— 理由與殘餘風險寫在 `refund-repository.ts` 的
 * `CAP_GUARD_SQLSTATES` 上方(`⟦b4-PCM05SPLIT⟧`),此處不重複。
 */
const CAP_GUARD_FAILURE_CODE: Record<CapGuardSqlstate, RefundFailureCode> = {
  PCM04: 'exceeds_remaining',
  PCM05: 'exceeds_unknown',
  PCM06: 'db_config',
};

export async function initiateRefundAction(
  _prev: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  // ① 授權閘。🔴 絕對第一,連讀一個欄位都在它之後(未授權者送爛表單拿到的是 denied
  //    而非 invalid;測試用 get() 會爆的地雷 FormData 釘住短路)。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return refundFailure('denied', EMPTY_REFUND_INPUT, generateRefundRequestToken());
  }

  const carried = carryBack(formData);
  const input: RefundFormInput = {
    kind: carried.kind,
    amount: carried.amount,
    reason: carried.reason,
    confirmCode: carried.confirmCode,
  };

  // ② 啟用旗標(server 閘;RW2d 的按鈕只是同一旗標的顯示面,兩端讀同一函式 —— 見 refund-ui-flag.ts)。
  //    🔴 **action 自己也要驗**,不只藏按鈕 —— 「UI 不顯示」擋不住直接 POST action
  //    (A1 片同型教訓:可見性看伺服端閘,不看畫面)。
  if (!isRefundUiEnabled()) return refundFailure('disabled', input, carried.requestToken);

  // ③ 解析(純形狀;業務判定單一真相在 RPC)。
  const parsed = parseRefundForm(formData);
  if (!parsed.ok) return refundFailure('invalid', input, carried.requestToken);

  // 🔴 #350d-4 C1:動作做完回發起的那個視圖(面板裡退款 ⇒ 回面板)。
  //    綁在 `parsed.orderId`(已過 uuid 閘)上 —— 契約 §6-1:`return_to` 只決定視圖、不決定哪一張單。
  //    🔴 **這一條碰錢,但它決定不了「退哪一張單的錢」**:退款目標自始至終是 `parsed.orderId`
  //    (`:141` 的 `findOrderForRefund`、`:207`/`:217` 的 initiate 都吃它),`return_to` 只影響
  //    「PRG 之後畫面停在哪」。非法值 fail-closed 退回本單明細頁,**不影響已經送出去的退款**。
  // 🔴 #365(codex 關卡2 MF)**`return_to` 刻意不進入口清單,這是判斷不是遺漏**:
  //    它**不決定寫什麼、只決定寫完停在哪一頁**,而它的非法值已經有自己的 fail-closed
  //    (`parseOrderReturnTo` 退回本單的視圖)。為了一個「導頁目的地壞掉」而把整筆寫入退掉,
  //    代價與風險不成比例(員工要重打一次,而資料面零風險)。
  //    ⇒ 本片的契約字面收窄成:**入口擋門負責「值會影響寫入決策」的欄位**;
  //      只影響導頁的欄位走自己的 fallback。
  const returnTo = parseOrderReturnTo(
    readSingleString(formData, ORDER_RETURN_TO_FIELD),
    parsed.orderId,
  );

  const httpRequestId = await getRequestId();
  // 🔴 log 紀律(A9d2-1 H11 同型):reason 是營運文字 → 只記長度;
  //    冪等鍵=表單 token ≠ HTTP x-request-id ⇒ 兩者都記才對得回稽核鏈。
  console.info('[admin/payment/refund] order_refund.initiate.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    kind: parsed.kind,
    amount: parsed.amount,
    reason_length: [...parsed.reason].length,
  });

  const logError = (stage: string, error: unknown, extra: Record<string, unknown> = {}) => {
    // 🔴 只記 code 與 message 前 200 字,**不得**記 details / hint(PG DETAIL 會帶整列內容)。
    const summary = (error ?? {}) as { code?: unknown; message?: unknown };
    console.error(`[admin/payment/refund] ${stage}`, {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: typeof summary.code === 'string' ? summary.code : undefined,
      message: String(summary.message ?? '').slice(0, 200),
      ...extra,
    });
  };

  // ④ server 重讀訂單(app 層縱深;RPC G12/白名單仍是權威)。
  let order;
  try {
    order = await findOrderForRefund(parsed.orderId);
  } catch (error) {
    logError('訂單重讀失敗', error);
    return refundFailure('error', input, parsed.requestToken);
  }
  if (!order) return refundFailure('order_not_found', input, parsed.requestToken);
  // 確認碼 = 訂單號末 4 碼、server 端驗(Sean Q2=A;actor 是自報身分,這道是「你真的在退
  // 這一張」的人因閘,不是授權)。
  if (order.displayId.slice(-4) !== parsed.confirmCode) {
    return refundFailure('confirm_mismatch', input, parsed.requestToken);
  }
  // Q1=A refunded 硬擋(app 鏡像;RPC G12 = REFUND_LEDGER_FULL 是權威)。
  if (order.paymentStatus === 'refunded') {
    return refundFailure('already_refunded', input, parsed.requestToken);
  }
  const recTradeId = order.tappayRecTradeId;
  if (recTradeId === null || recTradeId.trim() === '') {
    return refundFailure('no_card_transaction', input, parsed.requestToken);
  }

  // ④-b 🔴🔴 **卡住的人工判定閘(`#890` 片4,2026-08-30)—— 這一道是 server 端的,不是畫面。**
  //
  // 為什麼一定要有這一道:`refund-entry-gate.ts` 那道**只決定渲不渲染**,而它自己的檔頭
  // 逐字寫著 server 端「**擋不住**」⇒ **只改畫面 = 把按鈕藏起來,不是一道閘** ——
  // 持有效後台 session 直接送本 action 就繞過去了(`#806` 那個錢洞就是這個形狀:
  // `manual-refund-actions.ts:59` 逐字「這道閘被拿掉過一次,**而那是一個真的錢洞**」)。
  //
  // ══ 🔴 這道閘【擋得住什麼、擋不住什麼】—— codex R1 逼出來的實話 ════════════════
  //  ✅ 擋得住:一筆判定沒有人擔保 / 判定說錢動了 / 我們讀不到帳本或判定。
  //  🛑 **擋不住金額** —— 而這一格我第一版寫錯了,原句宣稱「餘額沒被高估 ⇒ 重試安全」:
  //     ① `pcm_order_refundable_remaining`(`20260820100000:231-248`)**第二段就是**
  //        「join 更正 view、扣掉 `corrected_to='money_moved'` 的 failed 列」
  //        ⇒ `money_moved` 那一種 **DB 本來就扣了**,我說的「被高估」對它不成立。
  //        ⇒ 我們仍然擋它,理由改成:**那筆錢已經退出去了,再退一次是第二次付款。**
  //     ② 🔴🔴 **更致命**:那支函式今天**沒有任何 RPC 消費它**
  //        —— `refund-repository.ts:18-22` 逐字「`REFUND_EXCEEDS_REMAINING` 由 **445b** 建立,
  //        **今天庫裡那支 RPC 還不會吐它**」⇒ **本地沒有金額上限這道閘,445b 還不存在。**
  //     ⇒ 📌 **今天的金額上界是【TapPay 自己的帳】**:步 ⑤ 的 `checkRecordBaseline`
  //        讀 Record 的 `amount`(= 收單行端剩餘可退、會隨每次退款遞減,
  //        `refund-baseline.ts:32`),`full` 遇到 0 直接 `nothing_left`。
  //     🔴🔴 **而那個上界【只蓋卡片這一渠道】**(R3 consider-1,2026-08-30 抓到;
  //        我原句寫「比我們的強」= 把它講成了全域上界,**那是錯的**):
  //        `pcm_order_refundable_remaining` 第三段會扣 `order_manual_refunds`
  //        (`20260820100000:255-258`),而**本 action 從來不讀它**、`445b` 不存在,
  //        **TapPay 對銀行匯退完全是盲的**。
  //        ⇒ 實例:一張單收 NT$20 ⇒ 先登記非卡退 NT$10(本地餘 10)⇒ 員工發起 TapPay 全額
  //          ⇒ TapPay 那邊看到的餘額仍是 20 ⇒ 退 20 ⇒ **客人拿到 30。兩道閘都不會響。**
  //        ⚠️ **那條路不需要任何卡住的列 ⇒ 與本片無關、本片也沒有開它** ——
  //          它是既有的 `445b` 缺口。寫在這裡,是因為我差一點把它寫成「已經有上界了」。
  //     ⇒ ⚠️ **所以本片放行的那一格,倚賴的是【人的判定】加【TapPay 的帳】,不是本地額度閘。**
  //        這是**殘餘風險,不是我自己接受的** —— 已列給 Sean(見交件)。
  //
  // ══ 🛑 **這道閘【擋不住】的第二件事:讀完之後 DB 還會變(TOCTOU)** ═══════════════
  //  codex 在兩輪各指出一種形狀,而**它們是同一層**:
  //   ① R1:先把判定改成 `no_money_moved` 過閘 ⇒ 退款進行中再改回 `money_moved`。
  //   ② R2:閘讀完之後,另一個交易把一列 `processing` 改成 `manual_failed`
  //         ⇒ initiate RPC **不重查這個狀態** ⇒ 那一列在我們眼裡從來不存在。
  //  🔴 **兩個都關不掉在這一層** —— 要關需要「讀判定與 initiate 在同一交易/同一把鎖」,
  //     那是動 RPC ⇒ 鐵則 12①③ ⇒ **另一片、要 Sean 批**。
  //  ✅ 這一層做得到的是**留痕**:擋下與放行兩條路都把當下讀到的
  //     `refund_id + seq + corrected_to` 寫進 log ⇒ 事後查得出「這一發是照哪一版做的決定」。
  //  ⚠️ **留痕不是防護** —— 它讓那件事事後看得見,不是讓它不會發生。
  //  🛑 **這是殘餘風險,而它【不是我自己接受的】**(R6:殘餘風險永不自宣接受)——
  //     已列給 Sean。**他說了才算。**
  //  📌 而觸發它需要一個**有效後台 session 的人刻意配合時序** —— 那個人本來就退得了款;
  //     這道閘從頭到尾防的是「判定沒有人擔保」,不是防一個決心作假的內部人。
  //
  // 🔴 fail-closed 的方向:讀不到帳本、讀不到更正紀錄、**帳本被截斷** ⇒ 一律擋。
  //    擋錯的代價是員工重整一次;放行錯的代價是多退一筆錢。**兩邊不對稱。**
  // ⚠️ 判準本體在 `refund-ledger-view.ts` 的 `isBlockingStuckVerdict`,與畫面那道**共用同一支**。
  try {
    const ledger = await listOrderRefunds(parsed.orderId);
    // 🔴🔴 **截斷 ⇒ 擋(codex R1 must-fix)**:`listOrderRefunds` 只回**最新** 100 列
    //    (`refund-read.ts:78` `ORDER_REFUNDS_LIMIT = 100`,`order('created_at', desc)`)。
    //    ⇒ 一列較舊的 `manual_failed` 落在第 101 列之後時,`stuckIds` 會是**空的**
    //      ⇒ 這道閘直接放行,而畫面上那道也看不到它。
    //    📌 **「我沒看到卡住的列」與「沒有卡住的列」是兩個宣稱** —— 而截斷正是它們分開的那一刻。
    if (ledger.truncated) {
      logError('退款帳本被截斷 ⇒ 看不完整 ⇒ 擋下', new Error('ledger truncated'), {
        rows_seen: ledger.rows.length,
      });
      return refundFailure('stuck_verdict_unknown', input, parsed.requestToken);
    }
    const stuckIds = ledger.rows.filter(isStuckManualVerdict).map((row) => row.id);
    // 🔴 沒有卡住的列 ⇒ 直接過,**不發那一發查詢**(絕大多數訂單走這條)。
    if (stuckIds.length > 0) {
      const verdicts = await findEffectiveVerdicts(stuckIds);
      // 型別漂移也當讀不到(同 `refund-exceptions/page.tsx` 那一格:不是 Map 就別往下 `.get()`)。
      if (!(verdicts instanceof Map)) {
        logError('更正紀錄型別漂移 ⇒ 擋下', new Error('verdicts not a Map'));
        return refundFailure('stuck_verdict_unknown', input, parsed.requestToken);
      }
      const blocking = ledger.rows.filter((row) => isBlockingStuckVerdict(row, verdicts));
      if (blocking.length > 0) {
        // 🔴 **三態各回各的碼**(codex R1 must-fix):被擋的原因不同,員工的下一步也不同。
        //    只要**有一列**是「已更正為錢動了」,就用那一句 —— 它是三者裡最該讓人停手的。
        const moneyMoved = blocking.some(
          (row) => verdicts.get(row.id)?.correctedTo === 'money_moved',
        );
        logError('卡住的人工判定擋下退款', new Error('stuck verdict'), {
          blocking_count: blocking.length,
          money_moved: moneyMoved,
          // 🔴 把**當下讀到的那一版**記進稽核:更正是 append-only 且帶 `seq`
          //    (`20260814190000` 的 view = `DISTINCT ON … ORDER BY seq DESC`)。
          //    🔴🔴 **`seq` 必須配 `refund_id`**(codex R2 must-fix):`seq` 是**每一筆退款各自**
          //       編號的(`20260814190000:92,104`)⇒ 一張單有多列時,一個裸的 `[1, 1]`
          //       **指不出是哪一筆的第 1 版** ⇒ 事後查不回去。
          //       📌 一個沒有主詞的版本號,與沒有記是一樣的。
          //    ⚠️ 它**不能**防「先改成放行、退完再改回去」(那需要同一交易或鎖,見交件的殘餘風險)
          //      —— 它讓那件事**留得下痕跡**,而不是讓它不可能。
          verdicts_seen: blocking.map((row) => ({
            refund_id: row.id,
            seq: verdicts.get(row.id)?.seq ?? null,
            corrected_to: verdicts.get(row.id)?.correctedTo ?? null,
          })),
        });
        return refundFailure(
          moneyMoved ? 'stuck_verdict_money' : 'stuck_verdict',
          input,
          parsed.requestToken,
        );
      }
      // 🔴 放行的那一發也記:**這一格是稽核鏈上唯一寫得出「我們為什麼放它過」的地方。**
      console.info('[admin/payment/refund] order_refund.stuck_verdict.allowed', {
        request_id: httpRequestId,
        order_id: parsed.orderId,
        stuck_count: stuckIds.length,
        // 🔴 同上:`seq` 配 `refund_id`,否則事後查不出「放行那一發是照哪一筆的哪一版」。
        verdicts_seen: stuckIds.map((id) => ({
          refund_id: id,
          seq: verdicts.get(id)?.seq ?? null,
          corrected_to: verdicts.get(id)?.correctedTo ?? null,
        })),
      });
    }
  } catch (error) {
    // 🔴 讀失敗 ⇒ **擋**,不是放行。我們不知道有沒有,那就當作有。
    logError('卡住判定閘讀取失敗(fail-closed 擋下)', error);
    return refundFailure('stuck_verdict_unknown', input, parsed.requestToken);
  }

  // ⑤ adapter(composition 是唯一取得管道;設定錯 = 具名 TapPayConfigError,
  //    「找管理者」與「稍後再試」是兩種完全不同的值班動作 —— N4 前置債)。
  let adapter;
  try {
    adapter = getTapPayAdapter();
  } catch (error) {
    logError('adapter 建構失敗', error);
    return refundFailure(
      error instanceof TapPayConfigError ? 'config' : 'error',
      input,
      parsed.requestToken,
    );
  }

  // ⑥ G0 baseline:Record 反查 + 斷言全套;任一不成立 → RPC 零呼叫(fail-closed)。
  //    🔴 自帶 ≤10s 逾時(RW2b 契約債:recordQuery 預設無逾時;慢回應會把 maxDuration 60s
  //    的餘額吃到不足 refund 的 30s,退款送出後才被平台砍在半路 = 自製 unknown-state)。
  let recordResult;
  try {
    recordResult = await adapter.recordQuery(
      { recTradeId },
      { signal: AbortSignal.timeout(REFUND_RECORD_QUERY_TIMEOUT_MS) },
    );
  } catch (error) {
    logError('Record 反查失敗', error);
    return refundFailure('record_unavailable', input, parsed.requestToken);
  }
  const baseline = checkRecordBaseline(recordResult, recTradeId, parsed.kind);
  if (!baseline.ok) {
    console.error('[admin/payment/refund] G0 baseline 不成立', {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: baseline.code,
      detail: baseline.detail,
    });
    return refundFailure(baseline.code, input, parsed.requestToken);
  }

  // ⑦ RPC initiate(帳先記、後打 API;G3 凍結額:full=Record 剩餘額 / partial=員工輸入)。
  let initiated;
  try {
    // kind 判別分支逐欄具名(不 spread;互斥由 InitiateOrderRefundArgs 判別聯合在編譯期釘死)。
    initiated = await initiateOrderRefund(
      parsed.kind === 'partial'
        ? {
            orderId: parsed.orderId,
            kind: 'partial',
            amount: parsed.amount,
            recordAmount: null,
            recordRefundedBefore: baseline.refundedBefore,
            reason: parsed.reason,
            actor: authorization.actorId,
            requestId: parsed.requestToken,
          }
        : {
            orderId: parsed.orderId,
            kind: 'full',
            amount: null,
            recordAmount: baseline.recordAmount,
            recordRefundedBefore: baseline.refundedBefore,
            reason: parsed.reason,
            actor: authorization.actorId,
            requestId: parsed.requestToken,
          },
    );
  } catch (error) {
    revalidateOrderViews({
      orderId: parsed.orderId,
      returnTo,
      scope: 'refund',
      // 🔴 用 **HTTP x-request-id**、不是表單 token(code-reviewer must-fix 1):本檔 `:125-126`
      //    的紀律逐字寫「冪等鍵=表單 token ≠ HTTP x-request-id ⇒ 兩者都記才對得回稽核鏈」,
      //    而我原本讓同一個 `request_id` 欄在同一支 action 裡放兩種值 —— 事故當天拿
      //    x-request-id 撈整條鏈,revalidate 那行會撈不到。
      //    ⚠️ 本檔其餘 `requestId: parsed.requestToken` 是**送進 RPC 的冪等鍵**,那些是對的、不要一起改。
      requestId: httpRequestId,
    });
    // 🔴 上限閘(`445b`)要**排在契約違反之前** —— 它不是 bug,是業務結果,
    //    而三個碼要找的人各不相同(`refund-repository.ts` 的 `RefundCapGuardError` 註解)。
    if (error instanceof RefundCapGuardError) {
      logError(`initiate 被上限閘擋下(${error.sqlstate})`, error);
      // ⟦b4-CAPMSGNUM⟧ `PCM04` 帶得出 DB 算好的上限 ⇒ 讓那個數字進員工看到的那句話。
      // 🔴 **只有 `PCM04` 有**:`PCM05` 的語意是「算不出上限」⇒ 它【本來就沒有數字】,
      //    而 `error.cap` 在那條路上是 `null` ⇒ 這裡不必分支,`remainingCapSuffix` 自己會空手。
      //    ⇒ 📌 分支寫在【值】上不寫在【碼】上 —— 碼會長,而「有沒有數字」永遠只有一個答案。
      return refundFailure(CAP_GUARD_FAILURE_CODE[error.sqlstate], input, parsed.requestToken, {
        remainingCap: error.cap,
      });
    }
    if (error instanceof RefundCallerBugError) {
      logError('initiate 契約違反', error);
      return refundFailure('bug', input, parsed.requestToken);
    }
    // 🔴 transient(回應斷在路上):INSERT 可能已 commit。token 原樣帶回 ⇒ 員工用同一張
    //    表單重試會被 G4 認出(DUPLICATE 或全新 initiate),不會第二退。
    logError('initiate 失敗', error);
    return refundFailure('error', input, parsed.requestToken);
  }
  // 帳本自此可能有新列/新狀態 —— 之後所有 return 都要讓**兩個視圖**重取(契約 §5)。
  revalidateOrderViews({
    orderId: parsed.orderId,
    returnTo,
    scope: 'refund',
    requestId: httpRequestId,
  });

  let succeeded = false;

  if (initiated.result !== 'INITIATED') {
    switch (initiated.result) {
      case 'DUPLICATE_REQUEST':
        // 同 token 重播(G4 查驗過指紋)。confirmed=前次已完成 → 視同成功;
        // processing=前次還在路上(或已 crash)→ **不重打 refund()** —— 無從得知 wire
        // 發過沒有,fail-closed 交給 S5 卡住 + RW4 收拾,這正是查驗式冪等買到的安全。
        if (initiated.rowStatus === 'confirmed') {
          succeeded = true;
        } else {
          return refundFailure('in_flight', input, parsed.requestToken);
        }
        break;
      case 'REFUND_IN_FLIGHT':
        return refundFailure('in_flight', input, parsed.requestToken);
      case 'REFUND_LEDGER_FULL':
        return refundFailure('ledger_full', input, parsed.requestToken);
      case 'ORDER_NOT_FOUND':
        return refundFailure('order_not_found', input, parsed.requestToken);
      case 'ORDER_NOT_REFUNDABLE':
        return refundFailure('not_refundable', input, parsed.requestToken);
      case 'ORDER_NO_CARD_TRANSACTION':
        return refundFailure('no_card_transaction', input, parsed.requestToken);
      case 'REFUND_NOTHING_LEFT':
        return refundFailure('nothing_left', input, parsed.requestToken);
      // ⛔ ~~case 'REFUND_EXCEEDS_REMAINING': …EXCEEDS_FAILURE_CODE[initiated.blockedBy]~~
      // 🔴 **2026-08-31 刪(`⟦b4-EXCEEDSDEAD⟧` 甲案)** —— 那支 RPC 從來沒有回過這個碼
      //    (它自己列出的回傳碼是 8 個,`20260803150000:415-416`(座標已訂正,見本檔上方那一處)(⛔ ~~舊座標~~ 🔴 **2026-08-31 訂正:那支 RPC 的【最新一代】是 `20260812170000:480` 的 `CREATE OR REPLACE`,不是 `20260803150000`** —— 用 `scripts/latest-definition-of.sh admin_initiate_order_refund` 查到的。✅ **結論不變**:在最新那一代裡重數,仍然恰 8 碼、與 `INITIATE_RESULT_CODES` 逐字相同,而 `REFUND_EXCEEDS_REMAINING` / `blocked_by` 在該代 **0 命中**(負對照現造字面亦 0)。📌 **⇒ 我的結論是對的,而我的【證據指著一份已經被取代的定義】—— 那份舊的當時也是 8 碼,所以【指錯代】與【指對代】印出同一個答案。**) 逐字,**沒有它**;
      //     而 `blocked_by` 在整個 `supabase/` ⇒ **0 處**)。
      // ✅ **而今天真的在做那件事的是 `445b` 的 trigger + `PCM04`** ——
      //    它走的是**例外**那條路(上方 `RefundCapGuardError`),不是這個 switch。
      //    ⇒ 📌 **兩條路長得完全不同,而它們的員工訊息是同一句** —— 那不是巧合,
      //      是 `CAP_GUARD_FAILURE_CODE` 刻意對到同一個 `exceeds_remaining`。
      // 🔴 窮盡守(本片新增):原本這個 switch **沒有 default**。
      //    ⚠️ 它擋的**不是** RPC 在 runtime 吐出未知碼 —— 那個更早就被
      //    `refund-repository.ts` 的碼表白名單 throw 掉了(`:270`),到不了這裡;
      //    也不是「靜默當成功」—— `:461-463` 的 `if (!succeeded)` 早就 fail-closed 給 bug 文案。
      //    **它擋的是開發者**:日後把新碼加進碼表**與** outcome union 卻漏接 case 時,
      //    原本要等 runtime 落到那句籠統的 bug 文案才看得出來;改成 never ⇒ **typecheck 就紅**。
      //    (第一版註解把前兩件事講成「沒有任何東西會紅」,是假的;code-reviewer 抓到並實測。)
      default: {
        const unhandled: never = initiated;
        throw new RefundCallerBugError(
          `initiate 回傳未分派的碼:${JSON.stringify(unhandled).slice(0, 200)}`,
        );
      }
    }
  } else {
    // ⑧ 打 TapPay。payload 由 kind 分流(discriminated union;full 不帶 amount 欄=型別層保證)。
    //    🔴 不傳 request-scoped signal(員工關頁不該中止動錢中的呼叫;adapter 30s 上限恆在)。
    const payload: TapPayRefundPayload =
      parsed.kind === 'partial'
        ? {
            kind: 'partial',
            transactionId: recTradeId,
            amount: { amount: toMoneyAmount(initiated.refundAmount), currency: 'TWD' },
            bankRefundId: initiated.bankRefundId,
          }
        : { kind: 'full', transactionId: recTradeId, bankRefundId: initiated.bankRefundId };

    let refundResult: TapPayRefundResult;
    try {
      refundResult = await adapter.refund(payload);
    } catch (error) {
      if (error instanceof TapPayRefundNotSentError) {
        // 確定未送出(fetch 零呼叫)→ 結案 not_sent(→failed;錢沒動、token 已被終態消耗)。
        const outcome = await finalizeSafely(
          {
            refundId: initiated.refundId,
            outcome: 'not_sent',
            tappayRefundId: null,
            refundAmountWire: null,
            failedDetail: `TapPay pre-flight 拒絕:${clipCodepoints(error.message, 400)}`,
            actor: authorization.actorId,
            requestId: parsed.requestToken,
          },
          logError,
        );
        if (outcome === 'FINALIZED') {
          return refundFailure('not_sent', input, parsed.requestToken);
        }
        return refundFailure(
          outcome === 'THREW' ? 'finalize_failed' : 'bug',
          input,
          parsed.requestToken,
        );
      }
      // 🔴 unknown-state:**不 finalize**、列留 processing、不自動重發(§2 丙鐵律)。
      logError('refund unknown-state', error, { bank_refund_id: initiated.bankRefundId });
      // 🔴 帳本那一列不動(刻意),但在稽核表旁邊留一筆 —— 否則原因只活在這一次 console。
      const auditOutcome = await recordRefundUnknownStateAudit({
        site: 'adapter_threw',
        orderId: parsed.orderId,
        refundId: initiated.refundId,
        bankRefundId: initiated.bankRefundId,
        // 🔴🔴 `#906`:這一欄**在此之前恆為 null** —— 而那不是因為 TapPay 沒給。
        //    那顆編號在 adapter 那一刻**還在 wire 裡**,而它只進了 log 與錯誤訊息的字面,
        //    **型別層沒有任何東西帶它出來** ⇒ 這裡伸手要,而上游給不出。
        //    ⇒ 正式庫 08-22 實測:`key_present=true / value=null` —— 欄位在、值恆空。
        //    ✅ 改法是在 adapter 那一側新增 `TapPayRefundUnknownStateError.refundId`,
        //      **不是在這裡 parse 錯誤訊息的字串** —— 四個分支裡只有一個把它寫進字面,
        //      而那一個的格式沒有任何東西釘著。
        //    ⚠️ 而它仍然**可以是 null**:那表示 TapPay 這一次沒給,不是我們弄丟。
        //    ⚠️ 本段刻意不含小括號與大括號 —— refund-unknown-state-audit.test.ts 的切段器
        //      不解析註解,它有一格明文擋「註解裡出現括號」。那不是龜毛,是它切錯段會靜靜地放行。
        tappayRefundId:
          error instanceof TapPayRefundUnknownStateError ? error.refundId : null,
        error,
        actor: authorization.actorId,
        requestId: parsed.requestToken,
      });
      return refundFailure('unknown_state', input, parsed.requestToken, {
        auditUnconfirmed: auditOutcome !== 'written',
      });
    }

    if (refundResult.status === 'accepted') {
      // ⑨ 立即 finalize(縮窗;refundId 證據與金額比對 G7 都在 RPC)。
      let outcome: FinalizeOrderRefundOutcome;
      try {
        outcome = await finalizeOrderRefund({
          refundId: initiated.refundId,
          outcome: 'accepted',
          tappayRefundId: refundResult.refundId,
          refundAmountWire: refundResult.refundAmount,
          failedDetail: null,
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        });
      } catch (error) {
        // 🔴 錢已受理、帳本卡 processing:唯一正確指示=勿重試、走 RW4(不分 bug/transient
        //    —— 兩者的值班動作相同,而「可重試」在這裡是災難)。
        logError('accepted 後 finalize 失敗', error, {
          bank_refund_id: initiated.bankRefundId,
          tappay_refund_id: refundResult.refundId,
        });
        // 🔴 這一格最貴:TapPay 已受理 ⇒ 錢很可能動了,而帳本沒結成。稽核必須帶對帳碼。
        const auditOutcome = await recordRefundUnknownStateAudit({
          site: 'finalize_threw_after_accepted',
          orderId: parsed.orderId,
          refundId: initiated.refundId,
          bankRefundId: initiated.bankRefundId,
          tappayRefundId: refundResult.refundId,
          error,
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        });
        return refundFailure('unknown_state', input, parsed.requestToken, {
          auditUnconfirmed: auditOutcome !== 'written',
        });
      }
      if (outcome.result === 'FINALIZED') {
        succeeded = true;
      } else if (outcome.result === 'HELD_AMOUNT_MISMATCH') {
        return refundFailure('held', input, parsed.requestToken);
      } else {
        logError('accepted 後 finalize 回 REFUND_NOT_FOUND', outcome);
        return refundFailure('bug', input, parsed.requestToken);
      }
    } else if (refundResult.status === 'deferred') {
      // 10024(僅 partial 可達):還不能做、零動錢、鍵已作廢 → deferred 終態、額度釋出。
      const outcome = await finalizeSafely(
        {
          refundId: initiated.refundId,
          outcome: 'deferred_not_captured',
          tappayRefundId: null,
          refundAmountWire: null,
          failedDetail: null,
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        },
        logError,
      );
      if (outcome === 'FINALIZED') return refundFailure('deferred', input, parsed.requestToken);
      return refundFailure(
        outcome === 'THREW' ? 'finalize_failed' : 'bug',
        input,
        parsed.requestToken,
      );
    } else if (refundResult.status === 'rejected') {
      // rejected(10051,僅 partial 可達):超額、零動錢 → failed;diagnostic 進 failed_detail。
      const outcome = await finalizeSafely(
        {
          refundId: initiated.refundId,
          outcome: 'rejected_out_of_range',
          tappayRefundId: null,
          refundAmountWire: null,
          failedDetail: clipCodepoints(`TapPay ${refundResult.wireStatus}:${refundResult.msg}`, 450),
          actor: authorization.actorId,
          requestId: parsed.requestToken,
        },
        logError,
      );
      if (outcome === 'FINALIZED') return refundFailure('rejected', input, parsed.requestToken);
      return refundFailure(
        outcome === 'THREW' ? 'finalize_failed' : 'bug',
        input,
        parsed.requestToken,
      );
    } else {
      // 🔴 fail-closed 收口(關卡2 兩線同抓):resolved 卻不是三態之一 = adapter 合約漂移或
      //    畸形值(domain JSDoc 明寫未實證碼日後可能補結果態)。誤標成 rejected 會 finalize
      //    →failed、釋放 S5 額度、換新 token —— 若錢其實已動 = 打開雙退窗。
      //    「不明就是不動」:不 finalize、列留 processing 走 RW4。
      // 🔴 **不要 `String(...)` 這個值**(codex R1 F2):它會執行外部物件的 toString /
      //    Symbol.toPrimitive ⇒ **可以 throw**,而這裡一 throw,稽核沒寫、`refundFailure`
      //    也沒回,整條失敗路徑就斷在這一行。改成整個值往下傳,由 `describeUnknownValue`
      //    只用 `typeof` 取封閉形狀。
      const resolvedStatusValue: unknown = (refundResult as { status?: unknown }).status;
      logError('refund 回傳非三態(合約漂移)', null, {
        resolved_status_shape: describeUnknownValue(resolvedStatusValue),
        bank_refund_id: initiated.bankRefundId,
      });
      const auditOutcome = await recordRefundUnknownStateAudit({
        site: 'resolved_status_unrecognized',
        orderId: parsed.orderId,
        refundId: initiated.refundId,
        bankRefundId: initiated.bankRefundId,
        resolvedStatusValue,
        actor: authorization.actorId,
        requestId: parsed.requestToken,
      });
      return refundFailure('unknown_state', input, parsed.requestToken, {
        auditUnconfirmed: auditOutcome !== 'written',
      });
    }
  }

  if (!succeeded) {
    // 走到這裡=上面分支漏了 return(結構上不該發生);fail-closed 給 bug 而非誤導成功。
    return refundFailure('bug', input, parsed.requestToken);
  }

  // ⑩ 成功才 PRG。🔴 在一切 try 之外(redirect 拋 NEXT_REDIRECT,包進 try 會被 catch
  //    吞成失敗 state ⇒ 「錢退了、畫面卻說失敗」= 員工再退一次;A9d2-1 R2-3)。
  redirect(appendResultQuery(returnTo, `r=${REFUND_SUBMITTED_RESULT_CODE}`));
}

/**
 * 零動錢分支(not_sent / deferred / rejected)的 finalize 包裝:throw → 'THREW'
 * (呼叫端映 `finalize_failed`:列卡 processing 待 RW4,錢沒動);
 * 回非 FINALIZED 碼 → 原樣回傳(呼叫端映 bug)。
 * 🔴 accepted 分支**刻意不用本包裝** —— 它的 throw 語意是 unknown_state(錢已受理),
 *    兩者的員工指示不同,不得共用一條錯誤路。
 */
async function finalizeSafely(
  args: FinalizeOrderRefundArgs,
  logError: (stage: string, error: unknown, extra?: Record<string, unknown>) => void,
): Promise<'FINALIZED' | 'THREW' | 'UNEXPECTED'> {
  try {
    const outcome = await finalizeOrderRefund(args);
    if (outcome.result === 'FINALIZED') return 'FINALIZED';
    logError(`finalize(${args.outcome}) 回非預期碼`, outcome);
    return 'UNEXPECTED';
  } catch (error) {
    logError(`finalize(${args.outcome}) 失敗`, error);
    return 'THREW';
  }
}
