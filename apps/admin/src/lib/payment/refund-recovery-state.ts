// refund-recovery-state.ts — M-3 A7c RW4:恢復流程(對帳判定+人工結案)的 state、欄位名、員工訊息表。
//
// 🔴🔴 本檔會被 client 端 import(異常清單頁的操作元件用 `useActionState` 接兩支 action)
//    ⇒ 不得引入 `server-only` 或任何 server 專用模組(refund-action-state.ts 同紀律)。
//
// 🔴 兩支 action 的介面形狀 = A9d2-1 混合形慣例:**失敗回 state、成功才 redirect(PRG)**。
//    判定(judge)是唯讀動作、沒有「成功 redirect」—— 成功=回 `judged` state 給員工看讀數。
//
// 🔴 token 去向(比退款發起單純):結案 token 只餵 finalize 的 audit `request_id`,
//    重放權威是 RPC 的 G5 CAS(第二次結案=RAISE,map 成 `finalize_rejected` 停手訊息)——
//    沒有「終態消耗換新鍵」問題,失敗一律原樣帶回。
//
// 🔴 措辭鐵律(F25;wiring oracle 全域掃):不得出現「還能退」「剩餘可退」字面 ——
//    本流程的讀數一律稱「Record 差額」「帳本已登記」,不對員工宣稱任何「可退」語意。

import type { RefundRecoveryVerdict } from './refund-judgment';

/** 成功後 PRG 帶的結果碼(result-banner.tsx 以本常數註冊)。 */
export const REFUND_MARKED_FAILED_RESULT_CODE = 'refund_marked_failed';
export const REFUND_RECOVERED_RESULT_CODE = 'refund_recovered';

/** 表單欄位名(解析器與清單頁操作元件共用單一真相)。 */
export const RECOVERY_REFUND_ID_FIELD = 'refund_id';
export const RECOVERY_RESOLUTION_FIELD = 'resolution';
export const RECOVERY_DR_CODE_FIELD = 'dr_code';
export const RECOVERY_CONFIRM_FIELD = 'confirm_code';
export const RECOVERY_REQUEST_TOKEN_FIELD = 'request_token';

/**
 * 失敗原因碼(兩支 action 共用一張表;judge 用得到的子集=
 * denied/invalid/not_found/already_finalized/not_exception_yet/config/record_unavailable/bug/error,
 * 其餘為 resolve 專用 —— 別再用「前 N 碼」描述,插碼就過期;opus R2 N2)。
 * 語意同退款發起片的三分法:①員工可自行重試/稍候 ②停手走人工對帳 ③停手找維護。
 * 「這次有沒有動到任何東西」在每一則訊息裡明寫;唯一例外=finalize_unknown(不明就說不明)。
 */
export type RecoveryFailureCode =
  // ── 本層閘
  | 'denied'
  | 'invalid'
  // ── 帳本重讀
  | 'not_found'
  | 'already_finalized'
  | 'not_exception_yet'
  // ── Record 反查
  | 'config'
  | 'record_unavailable'
  // ── 結案(resolve 專用)
  | 'confirm_mismatch'
  | 'verdict_mismatch'
  | 'evidence_mismatch'
  | 'finalize_rejected'
  | 'finalize_unknown'
  | 'bug'
  // ── 系統面
  | 'error';

const FAILURE_MESSAGES: Record<RecoveryFailureCode, string> = {
  denied: '沒有權限或登入狀態已失效,沒有執行任何動作。',
  invalid: '表單內容不正確,沒有執行任何動作。',
  not_found: '找不到這筆退款(可能已被移除),沒有執行任何動作。請重新整理清單。',
  already_finalized:
    '這筆退款已不在「處理中」(可能剛被結案),沒有執行任何動作。請重新整理清單確認現況。',
  not_exception_yet:
    '這筆退款還不符合異常條件(未滯留超過門檻、也沒有 TapPay 受理證據),沒有執行任何動作。' +
    '同步流程可能仍在進行,現在結案有風險,請稍後再處理。',
  config:
    '金流環境設定不完整或不一致,無法對帳。這不是重試會好的問題,請通知管理者檢查環境設定。',
  record_unavailable:
    '查不到 TapPay 交易現況(連線失敗或逾時),沒有執行任何動作。稍後可再試一次。',
  confirm_mismatch:
    '確認碼與這筆退款的訂單號末 4 碼不符,沒有執行任何動作。請對照本列的訂單編號重新輸入。',
  verdict_mismatch:
    '送出當下重新對帳的結果,與你要執行的動作不符 —— 沒有寫入任何結案。' +
    '畫面上的判定可能已過期,請重新執行「對帳判定」再決定。',
  evidence_mismatch:
    '輸入的退款編號與這筆退款保存的 TapPay 受理證據不一致,沒有寫入。' +
    '請回 TapPay Portal 確認「同一筆」退款的編號;不確定時停手並通知系統維護。',
  finalize_rejected:
    '結案被拒(這筆可能剛被別人結案,或不符合結案守門),沒有寫入。' +
    '請重新整理清單確認現況;勿重複操作。',
  // 🔴 codex 關卡2 MF 折入:finalize 途中斷線=**結果不明**(可能已寫入成功)。
  //    不得寫「這次沒有完成」—— 那是沒被驗證的斷言;指示=先確認現況、確認前什麼都別做。
  finalize_unknown:
    '結案結果不明(請求可能已完成)。請重新整理清單確認這筆的現況;' +
    '在確認之前,勿重複操作、勿回訂單頁重新發起退款。',
  bug: '系統呼叫異常,請停手並通知系統維護;這筆的現況以重新整理後的清單為準。',
  error: '系統讀取失敗,這次沒有完成。請重新整理後再試;持續失敗請通知系統維護。',
};

/**
 * 判定結果給員工看的字(暫定、待 Sean 肉眼定稿)。
 * 🔴 七碼中只有 not_executed / executed 會伴隨結案按鈕;其餘五碼=停+告警、純人工(§4-1)。
 */
export const VERDICT_MESSAGES: Record<RefundRecoveryVerdict, string> = {
  not_executed:
    'Record 差額為 0:這筆退款的錢沒有動。可輸入確認碼後按「標記失敗」結案' +
    '(送出時會再對帳一次確認)。',
  executed:
    'Record 差額與登記金額一致:這筆退款的錢已退出。請到 TapPay Portal 取得這筆退款的' +
    '退款編號,輸入後按「恢復結案」。',
  evidence_contradiction:
    '這筆退款保存了 TapPay 受理證據,但 Record 差額為 0 —— 兩個讀數互相矛盾' +
    '(可能是 Record 尚未反映、或 Portal 端曾介入)。請停手,以 TapPay Record/Portal ' +
    '人工對帳並通知系統維護;矛盾未解前本筆不提供結案按鈕。',
  delta_mismatch:
    'Record 差額與登記金額不一致 —— 可能有 Portal 場外操作的痕跡。請停手,' +
    '以 TapPay Record/Portal 人工對帳並通知系統維護;本筆不提供結案按鈕。',
  other_in_flight:
    '同一張訂單另有處理中的退款,差額無法歸屬。請停手並通知系統維護(這不應該發生)。',
  record_shape_bad:
    'TapPay 交易紀錄查詢結果異常(查無、多筆或欄位缺漏),讀數不可信。請停手並通知系統維護。',
  record_state_bad:
    'TapPay 端交易狀態異常(待付款/已取消/錯誤),讀數不可信。請停手並通知系統維護。',
};

/** 判定成功時帶回的讀數(全部來自送出當下的 Record 與帳本;client 只顯示、不推導)。 */
export type RecoveryJudgeReadings = {
  verdict: RefundRecoveryVerdict;
  /** S2 baseline。 */
  baseline: number;
  /** Record 現值(shape/state 異常時無讀數 → null)。 */
  refundedNow: number | null;
  delta: number | null;
  /** 本列凍結額。 */
  refundAmount: number;
  /** RF8:同單 confirmed 列金額總和(帳本已登記;與 Record 累計對帳用)。 */
  ledgerConfirmedSum: number;
  /**
   * RF8 對帳結論(opus C1 折入:期望和要把**本列**算進去,否則 executed 時恆「不一致」
   * =每次正確恢復都拉假警報)。期望和 = executed → 已登記+本列額;not_executed → 已登記;
   * 其餘判定讀數已不可信 → null(只並列數字、不下結論)。
   */
  ledgerMatchesRecord: boolean | null;
  /** RF8:confirmed 列缺對帳碼筆數(P7C09 下應恆 0;>0 = 資料異常)。 */
  confirmedMissingRefundId: number;
  /** 判定時刻(ISO;讀數是這一刻的快照,結案時會重判)。 */
  judgedAtIso: string;
};

/** 判定 action 的 state。 */
export type RefundJudgeState =
  | { status: 'idle' }
  | { status: 'failed'; code: RecoveryFailureCode; message: string }
  | ({ status: 'judged'; message: string } & RecoveryJudgeReadings);

/** 結案 action 的 state(成功唯一出口=redirect)。 */
export type RefundResolveState =
  | { status: 'idle'; requestToken: string }
  | {
      status: 'failed';
      code: RecoveryFailureCode;
      message: string;
      /** 原樣帶回(重放權威=G5 CAS,見檔頭 token 段)。 */
      requestToken: string;
      /** 員工輸入的退款編號原樣帶回。 */
      drCode: string;
      /** 員工輸入的確認碼原樣帶回(標記失敗的人因閘;Q2=A 同款)。 */
      confirmCode: string;
    };

export function judgeFailure(code: RecoveryFailureCode): RefundJudgeState {
  return { status: 'failed', code, message: FAILURE_MESSAGES[code] };
}

export function resolveFailure(
  code: RecoveryFailureCode,
  requestToken: string,
  input: { drCode: string; confirmCode: string },
): RefundResolveState {
  return {
    status: 'failed',
    code,
    message: FAILURE_MESSAGES[code],
    requestToken,
    drCode: input.drCode,
    confirmCode: input.confirmCode,
  };
}
