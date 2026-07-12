// M-4a M0-S3 SSO 登入安全事件日誌 —— Fable 對抗審 MF2 的輕量替身。
//
// 🔴 這**不是** admin_audit_log 正式接線。全 admin_audit_log DB 接線=S3b(Sean Q2=A 已延後登入稽核/身分整合);
//    本檔只寫結構化 server log(Vercel runtime log 可撈),留最小鑑識軌跡,補上 Fable 指出的
//    「code 攔截 race 真發生時零軌跡、事後無從偵測異常登入」。best-effort:不擋登入。
// 🔴 絕不記 code / secret / session token / cookie 值 —— 只記事件、結果、correlation id、amr(非敏感)、失敗類別。
// 相對 import 見 session.ts 註解(本檔無 import,純函式)。

export type SsoLoginOutcome = 'success' | 'fail';

export interface SsoLoginLogFields {
  readonly requestId: string;
  /** 失敗類別(config-missing / state-mismatch / exchange-failed / sign-failed-config);成功省略。 */
  readonly reason?: string;
  /** 成功時的 amr(如 ['pwd','totp']);非敏感。 */
  readonly amr?: readonly string[];
}

/** 寫一筆 SSO 登入事件到 server log。成功=info、失敗=warn(值班撈 warn 即異常登入候選)。 */
export function logSsoLogin(outcome: SsoLoginOutcome, fields: SsoLoginLogFields): void {
  const record: Record<string, unknown> = {
    evt: 'sso.login',
    outcome,
    request_id: fields.requestId,
    source_app: 'quote',
  };
  if (fields.reason) record.reason = fields.reason;
  if (fields.amr) record.amr = fields.amr.join('+');
  const line = JSON.stringify(record);
  // 安全事件鑑識軌跡刻意走 server stdout(Vercel runtime log);MF2 stopgap,正式接 admin_audit_log=S3b。
  // 成功=info、失敗=warn(值班撈 warn 即異常登入候選)。
  if (outcome === 'success') console.info(line);
  else console.warn(line);
}
