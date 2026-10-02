/**
 * 員工在後台改的交易信文字(信件文字第 2 片;表 `email_copy_versions`, migration 20261002200000)。
 *
 * 寄信端每一輪讀一次整張表(表很小, 一季改幾次), 每封信再用「排進佇列那一刻」挑生效的版本。
 * 讀不到 ⇒ `listAll` throw;呼叫端分流:還沒交給 Resend 的信用預設文字照寄,
 * 交給過的這一輪先不寄(放回佇列、不算一次嘗試)—— 見 sweep-email-outbox.ts。
 */
export type EmailCopyVersionRow = {
  id: string;
  copyKey: string;
  /** null = 還原成程式預設。 */
  text: string | null;
  savedAt: string;
};

export interface IEmailCopyVersionsReader {
  listAll(): Promise<EmailCopyVersionRow[]>;
}
