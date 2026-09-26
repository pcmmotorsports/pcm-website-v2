/**
 * @module @pcm/use-cases/account-disabled-email — 停用帳號按「忘記密碼」時寄的通知信(2026-09-26 Sean Q30 甲)。
 *
 * 停用的帳號不寄重設密碼連結(重設了也登不進去), 改寄這封告訴他帳號已停用、怎麼聯絡我們。
 * 外框沿用 `customer-email-shell.ts`(同一套頁首、聯絡段、公司頁尾);沒有訂單 ⇒ `orderDisplayId: null`。
 * 🛑 template literal 裡不可以寫 HTML 註解(會原樣寄進客人信箱, 見 customer-email-shell.ts 檔頭)。
 * 內容固定、不帶任何會變的值:同一帳號同一小時重送時, Resend 的防重複鍵要求內容完全相同才會當成同一封。
 */
import { renderCustomerEmailShell, SANS } from './customer-email-shell';
import { PCM_LINE_ID, PCM_LINE_URL } from './order-email-copy';
import { PCM_EMAIL_LOGO_URL } from './paid-email-html';

export const ACCOUNT_DISABLED_EMAIL_SUBJECT = 'PCM 帳號已停用通知';

const LEAD = '我們收到這個 Email 的重設密碼申請。這個帳號目前已停用，所以沒有寄出重設密碼連結。';
const BODY = `此帳號已停用，如有疑問請加 LINE ${PCM_LINE_ID} 聯絡我們。`;
const NOT_YOU = '如果這不是您本人申請的，可以忽略這封信，您的帳號資料不會有任何變動。';

export function renderAccountDisabledEmail(): { subject: string; text: string; html: string } {
  const html = renderCustomerEmailShell({
    title: ACCOUNT_DISABLED_EMAIL_SUBJECT,
    headline: '您的 PCM 帳號已停用',
    leadHtml: LEAD,
    orderDisplayId: null,
    bodyHtml: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:22px 28px 0;">
        <div class="ink" style="font-family:${SANS};font-size:15px;line-height:1.75;color:#1f2933;">
          此帳號已停用，如有疑問請加 LINE
          <a href="${PCM_LINE_URL}" style="color:#2d5f8f;text-decoration:underline;">${PCM_LINE_ID}</a>
          聯絡我們。
        </div>
        <div class="sub" style="font-family:${SANS};font-size:13px;line-height:1.75;color:#5c6b7a;padding-top:12px;">
          ${NOT_YOU}
        </div>
      </td></tr>
    </table>
`,
    logoUrl: PCM_EMAIL_LOGO_URL,
  });
  const text = [
    '您的 PCM 帳號已停用',
    '',
    LEAD,
    '',
    BODY,
    `LINE：${PCM_LINE_URL}`,
    '',
    NOT_YOU,
  ].join('\n');
  return { subject: ACCOUNT_DISABLED_EMAIL_SUBJECT, text, html };
}
