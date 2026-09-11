/**
 * @module @pcm/use-cases/customer-email-shell — 寄給客人的每一封信共用的 HTML 外框(2026-09-12)。
 *
 * 起因:Sean 2026-09-12 逐字「這幾封 email 都要更有質感、資訊內容要一樣,比照付款成功通知那樣美觀,
 *   都要加上 https://www.pcmmotorsports.com/ 網址連結,或在 PCM logo 做超連結」。
 *   plan:`docs/plans/2026-09-12-customer-emails-unified-html-plan.md`(Sean 09-12 02:3x 批)。
 *
 * 外框 = 付款成功信(`paid-email-html.ts`)的頁首 / 訂單編號列 / 聯絡段 / 公司頁尾,**逐字搬過來**。
 *   那封信的真權威是 OD 稿 `email-order-paid-A.html`(不在 repo);其他信沒有稿 ⇒ 照鐵則 1 沿用同一套。
 *   🔴 改樣式前先開那份稿(見 `paid-email-html.ts` 檔頭),不要只改這裡。
 *   🔴 稿的三條硬限制照舊:LOGO 用 `<img>` 外連不要 base64 · 全部 `<table>` + inline style ·
 *      `<style>` 只放 `@media`。
 *   🛑 template literal 裡**不可以寫 HTML 註解** —— 它會原樣寄進客人信箱(2026-09-09 X5F8WG 那封已經洩漏過,
 *      見 `paid-email-html.ts` amountsBlock 前那段)。說明一律寫在 JS 註解。
 */

import {
  ORDER_CONTACT_LEAD,
  PCM_COMPANY_ADDRESS,
  PCM_COMPANY_LINE,
  PCM_LINE_ID,
  PCM_LINE_URL,
} from './order-email-copy';

/** 每封信 LOGO 連過去的網址。Sean 09-12 指定,**寫死 www**(與 LOGO 圖同一個理由:它屬於站,不屬於環境)。 */
export const PCM_WEBSITE_URL = 'https://www.pcmmotorsports.com/';

export const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Noto Sans TC',Arial,sans-serif";
export const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/** HTML 特殊字元逃逸。品名、料號、員工填的字都是**外部資料** ⇒ 一律過這一關。 */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 「到會員中心查看訂單」那顆鈕。呼叫端沒有網址就不要呼叫 —— 連到空網址的按鈕比沒有按鈕糟。 */
export function renderCtaButton(url: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" align="center" style="padding:28px 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="btn-ghost" align="center" style="border:1px solid #2d5f8f;border-radius:3px;">
            <a href="${esc(url)}"
               style="display:block;padding:14px 30px;min-height:44px;box-sizing:border-box;font-family:${SANS};font-size:15px;font-weight:600;color:#2d5f8f;text-decoration:none;">
              到會員中心查看訂單
            </a>
          </td></tr>
        </table>
      </td></tr>
    </table>
`;
}

export type CustomerEmailShellInput = {
  /** `<title>`(信箱不顯示,但少了它部分客戶端會印網址)。 */
  title: string;
  /** 大標題上面那行小字;不給就不印那一行。 */
  kicker?: string;
  headline: string;
  /** 大標題下面那段,**已經是 HTML**(呼叫端負責逃逸)。空字串 = 不印那一段。 */
  leadHtml: string;
  /** `null` ⇒ 訂單編號那一列不印、聯絡段不說「並告訴我們訂單編號」。 */
  orderDisplayId: string | null;
  /** 訂單編號旁邊那一格(付款信的「付款時間」);不給 ⇒ 編號那格吃滿寬。 */
  idRowExtraCellHtml?: string;
  /** 訂單編號列與聯絡段之間的內容,**已經是 HTML**。 */
  bodyHtml: string;
  /** LOGO 圖網址;空字串 = 不印 LOGO(只留右邊那行公司英文名)。 */
  logoUrl: string;
};

export function renderCustomerEmailShell(input: CustomerEmailShellInput): string {
  const { title, kicker, headline, leadHtml, orderDisplayId, idRowExtraCellHtml = '', bodyHtml, logoUrl } =
    input;
  const id = orderDisplayId === null ? null : esc(orderDisplayId);

  // 🔵 2026-09-12:LOGO 包一層 `<a>` 連回官網(Sean 指定)。`text-decoration:none` 讓部分客戶端不在圖下畫底線。
  const logoCell = !logoUrl
    ? ''
    : `<td><a href="${PCM_WEBSITE_URL}" style="text-decoration:none;"><img src="${esc(logoUrl)}" width="132" height="72" alt="PCM MOTOR PARTS"
           style="display:block;border:0;width:132px;height:auto;font-family:${SANS};font-size:14px;font-weight:700;color:#1f2933;"></a></td>`;

  const kickerRow =
    kicker === undefined
      ? ''
      : `        <div class="sub" style="font-family:${SANS};font-size:11px;letter-spacing:.16em;color:#5c6b7a;">${esc(kicker)}</div>
`;
  const headlinePad = kicker === undefined ? '0' : '8px';
  const leadRow =
    leadHtml === ''
      ? ''
      : `
        <div class="sub" style="font-family:${SANS};font-size:14px;line-height:1.75;color:#4a5765;padding-top:10px;">
          ${leadHtml}
        </div>`;

  const idRow =
    id === null
      ? ''
      : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:22px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="hair" style="border-top:1px solid #dde3ea;border-bottom:1px solid #dde3ea;">
          <tr>
            <td class="stack" width="${idRowExtraCellHtml === '' ? '100%' : '50%'}" style="padding:14px 0;vertical-align:top;">
              <div class="sub" style="font-family:${SANS};font-size:11px;letter-spacing:.12em;color:#5c6b7a;">訂單編號</div>
              <div class="ink" style="font-family:${MONO};font-size:17px;font-weight:700;color:#1f2933;padding-top:4px;">${id}</div>
            </td>${idRowExtraCellHtml}
          </tr>
        </table>
      </td></tr>
    </table>
`;

  const contactTail = id === null ? '。' : `，
            並告訴我們訂單編號 ${id}。`;

  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
  @media only screen and (max-width:600px){
    .px{padding-left:20px!important;padding-right:20px!important}
    .amt{font-size:24px!important}
    .stack{display:block!important;width:100%!important}
    .stack-r{text-align:left!important;padding-top:4px!important}
  }
  @media (prefers-color-scheme:dark){
    .sheet{background:#20262e!important}
    .paper{background:#272e38!important}
    .ink{color:#e8ecf1!important}
    .sub{color:#a9b4c2!important}
    .hair{border-color:#3a434f!important}
    .btn-ghost{border-color:#7fa9d4!important;color:#9fc3e8!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef1f4;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sheet" style="background:#eef1f4;">
<tr><td align="center" style="padding:24px 12px 40px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="stack" style="width:100%;max-width:560px;">

  <tr><td class="band" style="background:#ffffff;padding:16px 24px;border-radius:4px 4px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${logoCell}
      <td align="right" style="font-family:${SANS};font-size:11px;letter-spacing:.10em;color:#5c6b7a;">PCM MOTOR PARTS LTD</td>
    </tr></table>
  </td></tr>

  <tr><td class="paper" style="background:#fbfcfd;border-radius:0 0 4px 4px;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:30px 28px 0;">
${kickerRow}        <div class="ink" style="font-family:${SANS};font-size:18px;font-weight:700;line-height:1.35;color:#1f2933;padding-top:${headlinePad};">
          ${esc(headline)}
        </div>${leadRow}
      </td></tr>
    </table>
${idRow}
${bodyHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px hair" style="padding:24px 28px 30px;">
        <div style="border-top:1px solid #dde3ea;padding-top:16px;">
          <div class="sub" style="font-family:${SANS};font-size:12px;line-height:1.85;color:#5c6b7a;">
            ${ORDER_CONTACT_LEAD}
            <a href="${PCM_LINE_URL}" style="color:#2d5f8f;text-decoration:underline;">${PCM_LINE_ID}</a>${contactTail}
          </div>
          <div class="sub" style="font-family:${SANS};font-size:11px;line-height:1.8;color:#647079;padding-top:12px;">
            ${PCM_COMPANY_LINE}<br>
            ${PCM_COMPANY_ADDRESS}
          </div>
        </div>
      </td></tr>
    </table>

  </td></tr>
</table>

</td></tr>
</table>

</body>
</html>
`;
}
