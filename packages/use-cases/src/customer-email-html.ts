/**
 * @module @pcm/use-cases/customer-email-html — 付款成功信以外那 6 封客人信的 HTML 版(2026-09-12)。
 *
 * 🔴 **內容不重寫,排版而已**:HTML 的內文 = 純文字那一份的【同一組 body 行】(`sweep-email-outbox.ts`
 *   每個 build*Text 產出的那一組)⇒ 兩份資訊一定一樣(Sean 09-12「資訊內容要一樣」)。
 *   ⇒ 📌 改文案只改 build*Text 那一處,HTML 自動跟上;**不要在這裡另外寫字**。
 * 🔵 大標題用這封信的主旨(`order-email-assembly.ts` 那組,已經在寄的字)⇒ 本檔零新文案。
 *   這 6 封沒有設計稿 ⇒ 外框沿用付款成功信(`customer-email-shell.ts`),內文用它的字級與顏色。
 */

import { esc, MONO, renderCtaButton, renderCustomerEmailShell, SANS } from './customer-email-shell';
import { PCM_EMAIL_LOGO_URL } from './paid-email-html';

export type TextEmailHtmlInput = {
  /** 這封信的主旨 ⇒ 當大標題與 `<title>`。 */
  subject: string;
  orderDisplayId: string | null;
  /** 純文字那一份的內文行(不含開頭的「您好」、不含結尾的會員中心 / LINE / 公司段 —— 那些由外框給)。 */
  bodyLines: readonly string[];
  /** 「到會員中心查看訂單」鈕;`undefined` ⇒ 不印那顆鈕。 */
  orderUrl: string | undefined;
};

/**
 * 「標籤  值」的那種行,例:`退款金額  NT$ 12,800` / `戶名      派達有限公司`。
 * 🔴 標籤限 1-8 個非空白字、後面接 2 個以上【半形】空白(二審 nit):放寬成 `\s{2,}` 的話,
 *    品名 / 箱號裡剛好有兩個空白或全形空白就會被拆成左右兩欄。出貨品項行以「· 」開頭 ⇒ 不會中。
 */
const LABEL_VALUE = /^(\S{1,8}) {2,}(\S.*)$/;

function renderLine(line: string): string {
  const kv = LABEL_VALUE.exec(line);
  if (kv) {
    return `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td class="sub" style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;">${esc(kv[1]!)}</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">${esc(kv[2]!)}</td>
          </tr></table>`;
  }
  if (/^https?:\/\/\S+$/.test(line)) {
    return `          <div style="font-family:${SANS};font-size:14px;line-height:1.75;padding:2px 0;"><a href="${esc(line)}" style="color:#2d5f8f;text-decoration:underline;word-break:break-all;">${esc(line)}</a></div>`;
  }
  return `          <div class="ink" style="font-family:${SANS};font-size:14px;line-height:1.75;color:#1f2933;padding:2px 0;">${esc(line)}</div>`;
}

/** body 行 → 段落(純文字裡的空行 = 段落界線)。 */
function renderBody(lines: readonly string[]): string {
  const paragraphs: string[][] = [[]];
  for (const line of lines) {
    if (line === '') paragraphs.push([]);
    else paragraphs[paragraphs.length - 1]!.push(line);
  }
  return paragraphs
    .filter((p) => p.length > 0)
    .map(
      (p) => `    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:18px 28px 0;">
${p.map(renderLine).join('\n')}
      </td></tr>
    </table>
`,
    )
    .join('');
}

export function renderTextEmailHtml(input: TextEmailHtmlInput): string {
  return renderCustomerEmailShell({
    title: input.subject,
    headline: input.subject,
    leadHtml: '',
    orderDisplayId: input.orderDisplayId,
    bodyHtml: renderBody(input.bodyLines) + (input.orderUrl === undefined ? '' : renderCtaButton(input.orderUrl)),
    logoUrl: PCM_EMAIL_LOGO_URL,
  });
}
