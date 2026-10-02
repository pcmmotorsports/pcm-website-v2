// email-copy-catalog.ts —— 2026-10-02 信件文字第 2 片起本體搬到 @pcm/domain(packages/domain/src/catalog/email-copy-catalog.ts),
//   讓後台存檔動作(2c)與寄信程式用同一套檢查。這裡只轉出, 寄信程式的 import 路徑不用改。
export {
  EMAIL_COPY,
  EMAIL_COPY_LOCKED,
  EMAIL_COPY_MAX_LENGTH,
  LINE_INVITE_MARKER,
  emailCopy,
  fillEmailCopy,
  isEmailCopyKey,
  resolveEmailCopyOverrides,
  validateEmailCopyText,
  withEmailCopyOverrides,
} from '@pcm/domain';
export type { EmailCopyEntry, EmailCopyGroup, EmailCopyKey, EmailCopyVersion } from '@pcm/domain';
