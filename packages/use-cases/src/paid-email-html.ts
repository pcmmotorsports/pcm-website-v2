/**
 * @module @pcm/use-cases/paid-email-html — 付款成功通知信的 **HTML 本文**(A 版 · 收據型)
 *
 * ══ 這支檔是什麼 ═════════════════════════════════════════════════════════════
 * 吃一份 `PaidEmailContext`,吐一段 HTML 字串。**純函式,不讀 DB、不寄信、不接線。**
 *
 * 真權威 = OD 專案 `pcm-524f` 的 `email-order-paid-A.html`(252 行,Sean 2026-08-23 拍 A 版)。
 *   路徑前綴 `~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/`
 *   ⚠️ 那份稿**不在本 repo 裡** ⇒ 本檔是照它逐段搬的,不是照記憶寫的。
 *   🔴 鐵則 1「design 直接搬、不翻譯」:所有 inline style 逐字抄稿,**沒有改成 Tailwind、沒有抽 class**。
 *      改樣式前先開那份稿,不要改這裡。
 *
 * ══ 🔴 稿自己標了三條硬限制,照做,不要自己判斷 ═══════════════════════════════
 *   1. **付款時間要用【真的付款完成時間】** —— Sean 逐字:「寧可這一欄不印,
 *      也不要拿訂單成立時間頂替」。⇒ 本檔 `paidAt` 是 optional,**缺了就整個 `<td>` 不印**。
 *      理由不是好不好看:下單先、匯款後,兩個時間常差好幾天,客人拿去對帳會對不起來。
 *   2. **LOGO 用 `<img>` 外連,不要 base64** —— Gmail 超過 102KB 會把信剪掉。
 *      ⇒ 本檔收 `logoUrl`,不內嵌任何圖。
 *   3. **全部 `<table>` + inline style**,`<style>` 只放 `@media`(被砍掉也不影響可讀性)。
 *      ⇒ **不要退回 `<div>` + `<style>`**,信箱不吃。
 *
 * ══ 🔴 稿上有一段【我沒有無條件搬】,而那是刻意的 ═══════════════════════════════
 *   稿 `:207-217` 有一塊「**訂單明細 PDF 已附在這封信裡**」。
 *   🛑 而那是一句**對客人的事實宣稱** —— 這封信有沒有真的附 PDF,**不是模板決定的**。
 *      印了而沒附 ⇒ 客人往下滑找不到 ⇒ 我們在信裡對他說了一句假話,而信寄出去收不回來。
 *   ⇒ 所以本檔把它做成 `hasPdfAttachment` 旗標,**預設 false ⇒ 不印那一塊**。
 *      接線的人要印它,得先讓那封信真的帶附件,然後把旗標打開。
 *   📌 一個「照稿搬」的動作,搬到這一格會變成【搬一句還不成立的話】。
 *
 * ══ 🔴 稿上還有一段是【稿註】,它自己叫我刪掉 ═══════════════════════════════
 *   稿 `:52-58` 那條深色橫幅逐字寫著「這一條是稿註,不是信的內容,實作時整段刪掉」⇒ 已刪。
 *
 * ══ 天花板(寫出來,不假裝這裡涵蓋了)═══════════════════════════════════════
 *   · **沒有在任何真的信箱裡開過。**本檔的驗收是「餵資料 ⇒ 吐出正確的 HTML」,
 *     不是「Gmail / Outlook 打開來長對」。那是另一件事,而它需要真的寄一封。
 *   · 深色模式那幾條 `@media` 是**逐字抄稿**的,而**沒有量過**它在哪些客戶端生效。
 *   · 102KB 那條上限:本檔提供 `paidEmailHtmlBytes()` 讓呼叫端當場量,
 *     **而本檔不自己擋** —— 擋不擋是寄送端的決定,而它才知道附件有多大。
 */

import type { PaidEmailContext } from '@pcm/ports';

/**
 * 模板需要、而 `PaidEmailContext` **沒有**的那幾樣。
 *
 * 🔴 它們單獨成一個型別,是為了讓「缺什麼」看得見 ——
 *    合進 context 會讓下一個人以為那些資料已經有人在載了。
 */
export type PaidEmailChrome = {
  /**
   * 付款完成時間,**已經格式化好的字串**(稿上是 `2026-08-23 14:07`)。
   * 🔴 拿不到就不要傳 ⇒ 那一格整個不印(Sean 2026-08-23 拍板)。
   * ⚠️ 刻意收字串不收 `Date`:時區與格式是呼叫端的決定,而本檔不該替它猜台北時間。
   */
  paidAtText?: string;
  /** LOGO 的 https 位址。🔴 不要 base64(稿 `:70-73`)。缺了就不印 LOGO,只留右邊那行公司英文名。 */
  logoUrl?: string;
  /** 「到會員中心查看訂單」那顆鈕的完整網址。缺了就不印那顆鈕 —— 一顆連到空網址的按鈕比沒有按鈕糟。 */
  orderUrl?: string;
  /** 🔴 這封信**真的**帶了明細 PDF 附件嗎。預設 `false`。見檔頭那段。 */
  hasPdfAttachment?: boolean;
};

/** HTML 特殊字元逃逸。品名與料號是**外部資料**(供應商匯入、員工手打)⇒ 一律過這一關。 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 金額 → 稿上那個樣子(千分位、無小數、無貨幣符號)。
 * 🔴 稿上「訂單金額」旁邊的「新臺幣」是**模板的靜態標籤**,不跟著數字走(型別檔 `:90` 逐字)。
 */
function money(n: number): string {
  return Math.trunc(n).toLocaleString('en-US');
}

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Noto Sans TC',Arial,sans-serif";
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/** 主旨。稿 `:55` 逐字:**固定模板 + 訂單編號,不夾客戶欄位**。 */
export function paidEmailSubject(ctx: PaidEmailContext): string {
  return `PCM 訂單 ${ctx.orderDisplayId} 付款成功通知`;
}

/**
 * 產生付款成功通知信的 HTML 本文。
 *
 * 🔴 **本函式不檢查 `linesTruncated`。** 那是**呼叫端**的 fail-closed 責任
 *    (型別檔 `:63-64` 逐字:為 `true` 時呼叫端必須不寄)——
 *    而它必須擋在「寄不寄」那一層,不是「長什麼樣」這一層:
 *    📌 **一封少了兩項的信,與一封正常的信,在這裡長得一模一樣。**
 *    ⇒ 若改成本函式丟例外,那道保護會變成「模板有沒有被呼叫到」的副作用,而那不可靠。
 */
export function renderPaidEmailHtml(ctx: PaidEmailContext, chrome: PaidEmailChrome = {}): string {
  const { paidAtText, logoUrl, orderUrl, hasPdfAttachment = false } = chrome;
  const id = esc(ctx.orderDisplayId);

  // ── 品項列 ────────────────────────────────────────────────────────────────
  // 🔴 `title` / `variantSku` 可以是 null(型別檔 `:46/:48`)。
  //    品名缺 ⇒ 印一個看得出「這裡本來有東西」的字,**不要印空白** ——
  //    空白那一列與「這張單只有兩項」長得一樣。
  const lineRows = ctx.lines
    .map((l) => {
      const title = l.title === null ? '(品名未記錄)' : esc(l.title);
      const skuRow =
        l.variantSku === null
          ? ''
          : `<div class="sub" style="font-family:${MONO};font-size:11px;color:#64707d;padding-top:3px;">${esc(l.variantSku)}</div>`;
      return `          <tr>
            <td style="padding:14px 0;border-bottom:1px solid #e7ecf1;vertical-align:top;">
              <div class="ink" style="font-family:${SANS};font-size:14px;font-weight:600;line-height:1.5;color:#1f2933;">${title}</div>
${skuRow ? `              ${skuRow}\n` : ''}            </td>
            <td align="center" style="padding:14px 0;border-bottom:1px solid #e7ecf1;vertical-align:top;">
              <span class="ink" style="font-family:${MONO};font-size:14px;color:#1f2933;">${l.quantity}</span>
            </td>
            <td align="right" style="padding:14px 0;border-bottom:1px solid #e7ecf1;vertical-align:top;">
              <span class="ink" style="font-family:${MONO};font-size:14px;color:#1f2933;">${money(l.lineTotal)}</span>
            </td>
          </tr>`;
    })
    .join('\n');

  // ── 付款時間那一格 ────────────────────────────────────────────────────────
  // 🔴 Sean 拍板:拿不到 `paid_at` 就把整個 `<td>` 拿掉(稿 `:104-105` 逐字)。
  //    ⚠️ 而拿掉之後左邊那格要吃滿寬 —— 否則訂單編號會孤零零地縮在左半邊。
  const paidAtCell =
    paidAtText === undefined
      ? ''
      : `
            <td class="stack stack-r" width="50%" align="right" style="padding:14px 0;vertical-align:top;">
              <div class="sub" style="font-family:${SANS};font-size:11px;letter-spacing:.12em;color:#5c6b7a;">付款時間</div>
              <div class="ink" style="font-family:${MONO};font-size:14px;color:#1f2933;padding-top:6px;">${esc(paidAtText)}</div>
            </td>`;
  const idCellWidth = paidAtText === undefined ? '100%' : '50%';

  // ── 折扣那一列 ────────────────────────────────────────────────────────────
  // 🔴 `discountTotal` 是**正值**(型別檔 `:85`,DB CHECK >= 0)⇒ 負號由這裡加,不是資料帶的。
  //    ⇒ 沒有折扣時整列不印 —— 印一行「折扣 −0」會讓客人以為有一筆他沒看到的折抵。
  const discountRow =
    ctx.discountTotal > 0
      ? `          <tr>
            <td style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;" class="sub">折扣</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">−${money(ctx.discountTotal)}</td>
          </tr>\n`
      : '';

  // 🔴 運費 0 那一列**照印** —— 與折扣不同族:
  //    「免運」是客人想確認的一件事,而空白會讓他懷疑運費是不是漏算了。
  const shippingRow = `          <tr>
            <td style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;" class="sub">運費</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">${money(ctx.shippingFee)}</td>
          </tr>`;

  const logoCell =
    logoUrl === undefined
      ? ''
      : `<td><img src="${esc(logoUrl)}" width="132" height="72" alt="PCM MOTOR PARTS"
           style="display:block;border:0;width:132px;height:auto;font-family:${SANS};font-size:14px;font-weight:700;color:#1f2933;"></td>`;

  const ctaBlock =
    orderUrl === undefined
      ? ''
      : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" align="center" style="padding:28px 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="btn-ghost" align="center" style="border:1px solid #2d5f8f;border-radius:3px;">
            <a href="${esc(orderUrl)}"
               style="display:block;padding:14px 30px;min-height:44px;box-sizing:border-box;font-family:${SANS};font-size:15px;font-weight:600;color:#2d5f8f;text-decoration:none;">
              到會員中心查看訂單
            </a>
          </td></tr>
        </table>
      </td></tr>
    </table>
`;

  const pdfBlock = !hasPdfAttachment
    ? ''
    : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:26px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f4f7;border-radius:3px;">
          <tr>
            <td width="40" valign="top" style="padding:14px 0 14px 14px;">
              <div style="width:26px;height:32px;border:1px solid #9aa8b6;border-radius:2px;font-family:${MONO};font-size:10px;font-weight:700;color:#5c6b7a;text-align:center;line-height:32px;">PDF</div>
            </td>
            <td style="padding:14px 14px 14px 10px;">
              <div class="ink" style="font-family:${SANS};font-size:13px;font-weight:600;color:#1f2933;">訂單明細 PDF 已附在這封信裡</div>
              <div class="sub" style="font-family:${SANS};font-size:12px;line-height:1.7;color:#5c6b7a;padding-top:3px;">
                在手機上請往下滑到信件底部；電腦版在信件標題下方。需要報帳或留存時可以直接使用。
              </div>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
`;

  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>PCM 訂單付款成功通知</title>
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
        <div class="sub" style="font-family:${SANS};font-size:11px;letter-spacing:.16em;color:#5c6b7a;">付款成功通知</div>
        <div class="ink" style="font-family:${SANS};font-size:18px;font-weight:700;line-height:1.35;color:#1f2933;padding-top:8px;">
          我們收到您的付款了
        </div>
        <div class="sub" style="font-family:${SANS};font-size:14px;line-height:1.75;color:#4a5765;padding-top:10px;">
          這封信是這筆交易的明細。我們會盡快為您安排出貨，出貨後會再寄一封通知給您。
        </div>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:22px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="hair" style="border-top:1px solid #dde3ea;border-bottom:1px solid #dde3ea;">
          <tr>
            <td class="stack" width="${idCellWidth}" style="padding:14px 0;vertical-align:top;">
              <div class="sub" style="font-family:${SANS};font-size:11px;letter-spacing:.12em;color:#5c6b7a;">訂單編號</div>
              <div class="ink" style="font-family:${MONO};font-size:17px;font-weight:700;color:#1f2933;padding-top:4px;">${id}</div>
            </td>${paidAtCell}
          </tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:24px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr class="hair">
            <td style="font-family:${SANS};font-size:11px;letter-spacing:.12em;color:#5c6b7a;padding:0 0 8px;border-bottom:1px solid #dde3ea;">品項</td>
            <td align="center" width="52" style="font-family:${SANS};font-size:11px;letter-spacing:.12em;color:#5c6b7a;padding:0 0 8px;border-bottom:1px solid #dde3ea;">數量</td>
            <td align="right" width="96" style="font-family:${SANS};font-size:11px;letter-spacing:.12em;color:#5c6b7a;padding:0 0 8px;border-bottom:1px solid #dde3ea;">小計</td>
          </tr>

${lineRows}
        </table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:16px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;" class="sub">小計</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">${money(ctx.subtotal)}</td>
          </tr>
${shippingRow}
${discountRow}          <tr class="hair">
            <td style="border-top:1px solid #dde3ea;padding:14px 0 0;">
              <div class="ink" style="font-family:${SANS};font-size:14px;font-weight:700;color:#1f2933;">訂單金額</div>
              <div class="sub" style="font-family:${SANS};font-size:11px;color:#5c6b7a;padding-top:2px;">新臺幣</div>
            </td>
            <td align="right" style="border-top:1px solid #dde3ea;padding:14px 0 0;">
              <span class="ink amt" style="font-family:${MONO};font-size:22px;font-weight:700;color:#1f2933;letter-spacing:-.01em;">${money(ctx.total)}</span>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
${ctaBlock}${pdfBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px hair" style="padding:24px 28px 30px;">
        <div style="border-top:1px solid #dde3ea;padding-top:16px;">
          <div class="sub" style="font-family:${SANS};font-size:12px;line-height:1.85;color:#5c6b7a;">
            有任何問題，回覆這封信或加入官方 LINE
            <a href="https://lin.ee/egsf1Jy" style="color:#2d5f8f;text-decoration:underline;">@pcmmoto</a>，
            並告訴我們訂單編號 ${id}。
          </div>
          <div class="sub" style="font-family:${SANS};font-size:11px;line-height:1.8;color:#647079;padding-top:12px;">
            派達有限公司　統一編號 90003020<br>
            新北市新莊區化成路736巷18號1樓
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

/**
 * 這段 HTML 有多少 bytes(UTF-8)。
 *
 * 🔴 **Gmail 超過 102KB(104,857 bytes)會把信剪掉** —— 而被剪掉的是**下半部**,
 *    也就是金額合計、CTA 與公司資訊。稿 `:72-73` 就是為了這條才禁 base64。
 * 🛑 **本函式只量,不擋。** 擋不擋是寄送端的決定 —— 只有它知道附件加進去之後總共多大,
 *    而**本檔量到的數字不含附件**。
 */
export function paidEmailHtmlBytes(html: string): number {
  return Buffer.byteLength(html, 'utf8');
}

/** Gmail 開始剪信的門檻(bytes)。呼叫端自己比,本檔不比。 */
export const GMAIL_CLIP_BYTES = 102 * 1024;
