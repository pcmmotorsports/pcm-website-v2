// sweep-failure.ts —— 結算排程每一步失敗時記下「哪一步 + 錯誤代碼」(⟦settle-sweep 錯誤紀錄與告警⟧ 2026-10-04, Sean QY 甲)。
//
// 為什麼:正式站 7 天 13 次 503 都只有 `errors: 1`, 看不出哪一步、什麼錯 —— 每個 catch 都把錯誤吞掉。
//   計畫 ~/Projects/pcm-mailbox/計畫-settle-sweep-錯誤紀錄與告警-20261004.md。
// 🔴 只記代碼, 不記 message:adapter 丟的已是通用訊息 + code(PgChargeAttemptAdapter / PgWebhookInboxAdapter 的 sanitizeError),
//    但逐筆那兩步經過 settleCharge, 可能丟出 adapter 以外的錯誤, 訊息內容不保證不含個資或連線字串。
// 🔴 orderId 只在逐筆步驟帶上:可帶單號、不帶金額(packages/domain/src/payment/anomaly-alert.ts 檔頭的告警規則)。

export type SweepFailure = { step: string; code: string; orderId?: string };

/** 一輪最多記幾筆(超過只加 errors 計數, 不讓 log 與回應無上限長大)。 */
export const MAX_SWEEP_FAILURES = 10;

const SAFE_CODE = /^[A-Za-z0-9_]{1,40}$/;
/** adapter 的 sanitizeError 在錯誤沒有 code 時, 訊息固定以「(transport)」結尾(連線中斷等)。 */
const TRANSPORT_SUFFIX = '(transport)';

/** 錯誤代碼:合格的 code 照記;adapter 標成 transport 的記 transport;其餘 unknown。 */
export function sweepFailureCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.endsWith(TRANSPORT_SUFFIX)) return 'transport';
  return 'unknown';
}

/** 記一筆失敗(已滿 MAX_SWEEP_FAILURES 就不記;errors 計數由呼叫端自己加)。 */
export function pushSweepFailure(list: SweepFailure[], step: string, err: unknown, orderId?: string): void {
  if (list.length >= MAX_SWEEP_FAILURES) return;
  const code = sweepFailureCode(err);
  list.push(orderId === undefined ? { step, code } : { step, code, orderId });
}
