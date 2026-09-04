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
import { subtotalLabelOf } from '@pcm/domain';
import {
  formatOrderAmount,
  orderAmountsBalance,
  ORDER_CONTACT_LEAD,
  ORDER_LINE_TITLE_MISSING,
  ORDER_PAID_HTML_LEAD_SENTENCE,
  ORDER_PAID_NEXT_STEP_SENTENCE,
  PCM_COMPANY_ADDRESS,
  PCM_COMPANY_LINE,
  PCM_LINE_ID,
  PCM_LINE_URL,
} from './order-email-copy';

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
  /**
   * LOGO 的 https 位址。🔴 不要 base64(稿 `:70-73`)。缺了就不印 LOGO,只留右邊那行公司英文名。
   * 預設 `PCM_EMAIL_LOGO_URL`(見下面那個常數與它旁邊的三段)。
   */
  logoUrl?: string;
  /** 「到會員中心查看訂單」那顆鈕的完整網址。缺了就不印那顆鈕 —— 一顆連到空網址的按鈕比沒有按鈕糟。 */
  orderUrl?: string;
  /** 🔴 這封信**真的**帶了明細 PDF 附件嗎。預設 `false`。見檔頭那段。 */
  hasPdfAttachment?: boolean;
};

/**
 * 付款信 LOGO 的預設位址。
 *
 * ══ 🔴 為什麼是【硬編碼】而不是 env(2026-09-01,主視窗傾向硬編碼,我同意並補理由)══
 *   這個值的壽命綁在 **Sean 對網域的決定**上,不綁在部署環境上 ——
 *   ⇒ 它在 dev / preview / production **都是同一個值**,而 env 的用途是讓它們不同。
 *   🔴 而更重要的:env 會讓「**它為什麼是這個值**」失去落點 ——
 *      下一個看到破圖的人拿到的是一個變數名,而不是下面這三段。
 *   ⚠️ 代價明寫:換網域要改碼 + 重新部署。而那件事**本來就要有人看過**(見第三段)。
 *
 * ══ ① 接線前置(可判定,而它今天過了)═══════════════════════════════════════
 *   `curl -sI https://www.pcmmotorsports.com/pcm-logo.png | head -1` ⇒ 必須 **200**
 *   🟢 2026-09-01 13:1x 實測 ⇒ **200**(🔵 負對照 同網域現造檔名 ⇒ **404** ⇒ 那把尺是活的)
 *
 * ══ ② 而 `shop.` 那一側【今天量不出來】—— 不要拿它當驗收 ═══════════════════
 *   2026-09-01 實測:`shop.../pcm-logo.png` ⇒ **429**、`shop.` 首頁 ⇒ **429**、
 *   🔵 而**現造的不存在檔名也 ⇒ 429** ⇒ **它對「存在」與「不存在」印同一個東西,判別力 0。**
 *   🛑 **⇒ 所以 429【不得判綠】。** 要驗那一側,判準是三態不是兩態:
 *      200 ⇒ 綠 / 404 ⇒ 紅 / **429 ⇒ ENV-FAIL(工具自己跑不起來),不是綠也不是紅**。
 *   ✅ 而今天真正驗得到的那一格改成看 repo:`apps/storefront/public/pcm-logo.png`
 *      存在(66,739 bytes,2026-09-01 量)⇒ 它答的是「**部署之後會有**」,
 *      答不出「現在通不通」—— **而那正是它誠實的射程。**
 *   🔴 為什麼要驗那一側:`www` 今天掛在**另一個 Vercel 專案**(官網 landing),
 *      而它之後會移轉到顧客站 ⇒ **同一個路徑要在兩個專案上都有**,移轉那天才不會斷。
 *      📌 而重點不是「兩邊都有 LOGO」,是【**兩邊在同一個路徑上都有**】——
 *         官網原本就有一份,而它的路徑是 `assets/brand/…` ⇒ 那樣移轉照樣斷。
 *
 * ══ ③ 🔴 而上面那道 curl 是【一次性】的,而信是【永久】的 ═══════════════════
 *   今天 200、明年 404 ⇒ **那封信還在客人信箱裡**,而它會變成一個破圖框。
 *   ⇒ 📌 **一次性的前置擋得住「寫的當下就假」,擋不住「未來變假」。**
 *   ✅ **Sean 2026-09-01 拍板:知情接受 + 記在板上**,不做持續監看(原話一個字「甲」)。
 *      ⇒ 板上那一列的錨 = 標題逐字,用標題查不要用編號 ——
 *        ⚠️ 而本註解寫的當下那一列**還沒進 `dev`**(我量過:`505306c7` 不在 `origin/dev` 上)
 *        ⇒ 搜不到不代表沒有,先 `git log --all --grep` 找那顆。
 *   🛑 **這一段不重寫全文** —— 全文在板子那一列;這裡只留「為什麼你看到 404 不是打錯」。
 */
export const PCM_EMAIL_LOGO_URL = 'https://www.pcmmotorsports.com/pcm-logo.png';

/**
 * 「到會員中心查看訂單」那顆鈕的網址。**基底由呼叫端傳進來,本檔不讀 `process.env`。**
 *
 * ══ 🔴 為什麼 CTA 讀 env, 而 LOGO 是硬編碼 —— 兩者【方向相反】而那是刻意的 ══════
 *   下一個人一定會問這件事, 所以寫在這裡:
 *
 *   **LOGO**:那張圖在**官網專案與顧客站的同一個路徑上各放一份** ⇒ 移轉那天不論誰接手都活著
 *     ⇒ 所以可以直接指向**未來那個網域**(`www`)。代價是**今天先壞一陣子**,而 Sean 選了它。
 *
 *   🔴 **CTA 不一樣**:它連的是**客人的訂單頁**, 而那一頁**只有顧客站有** ——
 *      官網那個 landing 專案上沒有 ⇒ **今天指向 `www` 會是一顆點下去到不了的鈕**。
 *      🛑 而本板記過:**死入口比沒入口糟**。
 *   ⇒ ✅ 所以 CTA 跟著 `NEXT_PUBLIC_SITE_URL` 走(今天 = `shop`)⇒ **今天連得到**;
 *      移轉那天 Sean 改那顆 env ⇒ 新寄的信自動變 `www`。
 *   ⚠️ **代價一樣要明寫**:已經寄出去的信裡是 `shop` 的連結 ⇒ `shop` 關掉那天它們會失效。
 *      ⇒ 📌 **與 LOGO 是同一種「未來變假」, 只是我們這一次選了相反的邊** ——
 *         因為 LOGO 壞掉是**難看**, 而 CTA 壞掉是**客人點了到不了**。
 *
 * ══ 🔴 而本檔【不自己讀 env】—— 這一格我推翻了「在這裡讀」的做法, 理由三條 ══════
 *   ① 已經有一支 prod-safe 的 `resolveSiteUrl()`(`apps/storefront/src/lib/site-url.ts:20`),
 *      它處理了「未設 + production ⇒ 回 undefined、絕不吐 localhost」。
 *      ⇒ **在這裡再寫一份 = 兩份會漂的同義邏輯**,而漂了之後這一份不會紅。
 *   ② `packages/use-cases` 是共用層 ⇒ 它不該知道呼叫它的是哪一個 app 的哪一顆 env。
 *   ③ 讀 env 的函式**測不動** —— 而這一格要測的正是「env 沒設 ⇒ 不印那顆鈕」。
 *   ⇒ ✅ 所以基底**當參數傳進來**:呼叫端(那條 cron route)把 `resolveSiteUrl()` 餵進來。
 *      🔵 **淨效果與「在這裡讀 env」完全相同, 而它可測、且零重複。**
 *
 * @param siteUrl 站台基底(呼叫端給 `resolveSiteUrl()` 的回傳值;未設 ⇒ 傳 `undefined`)
 * @returns 完整網址;**基底缺了或不是絕對 http(s) ⇒ 回 `undefined`** ⇒ 呼叫端就不會印那顆鈕。
 */
export function paidEmailOrderUrl(
  siteUrl: string | undefined,
  orderDisplayId: string,
): string | undefined {
  // 🔴 `isAbsoluteHttpUrl` 的判準逐字對齊 `site-url.ts:31`(`/^https?:\/\//`)——
  //    不是我另訂一套。⇒ 那邊放行的、這邊也放行,兩份不會對同一個值給不同答案。
  if (siteUrl === undefined) return undefined;
  const base = siteUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return undefined;
  // 🔴 單號進網址要 encode —— 它今天是 `[A-Z0-9]`,而**那是今天的產號規則不是欄位約束**。
  // 🔴🔴 **本機位址一律不進客人的信**(code-reviewer R1 追加 must-fix)。
  //    **失敗路徑是真的, 不是理論**:`lib/site-url.ts:27` 在 `NODE_ENV !== 'production'`
  //    且 `NEXT_PUBLIC_SITE_URL` 未設時回 **`'http://localhost:3000'`**(不是 `undefined`),
  //    而上面那道只檢 `^https?://` ⇒ **放行**。
  //    ⇒ 🎯 有人照 `docs/runbooks/local-admin-with-real-data-probe.md` 在本機對真資料打這條
  //      cron route ⇒ **真客人收到一個連到他自己電腦的連結。**
  //    📌 **⇒ 而我原本只在 route 那側寫了「production 缺 env ⇒ 不印」——**
  //      **那是兩種形狀裡【會擋的那一半】, 而我只記錄了那一半。**
  //    🛑 擋在**這裡**不擋在呼叫端:呼叫端會有第二個第三個, 而這支函式是所有人的必經之路。
  // 🔴🔴 **改成解析 URL 比 hostname, 不比字串前綴**(codex 對抗審查 must-fix)。
  //    ⛔ ~~我第一版是 `/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/`~~ —— **那是一份黑名單,**
  //      而它漏掉:`127.0.0.2`(整個 127/8 都是回送)· `10.x` · `192.168.x` · `172.16-31.x`,
  //      以及 `http://user@127.0.0.1`(**認證資訊在前, 前綴比對看到的是 `user@…`**)。
  //    📌 **⇒ 黑名單在跟下一個沒想到的形狀賽跑** —— 而本 repo 已經記過同一句(token 前綴那條)。
  //    ✅ **改成:解析出真正的 hostname, 再問它是不是內網。**
  //    🛑 而**解析失敗 ⇒ 不印**(fail-closed):一個我看不懂的網址, 不該出現在客人的信裡。
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return undefined;
  }
  // 🔴 **先問「它是不是一個 IPv4 字面」, 再問「它是不是內網」** ——
  //    ⛔ ~~我第一版直接 `/^10\./.test(host)`~~ ⇒ 🔴 **`http://10.example.com` 這種【合法網域】被擋掉。**
  //      抓到它的是我自己那一格反向世界 —— **而少了反向世界, 一道「什麼都擋」的閘會全綠。**
  //    📌 ⇒ 這一格是那條紀律的實例:**只驗「該擋的擋了」, 一支 `return undefined` 也會通過。**
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLoopbackOrPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    (isIpv4 &&
      (/^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^169\.254\./.test(host)));
  if (isLoopbackOrPrivate) return undefined;
  return `${base}/account/orders/${encodeURIComponent(orderDisplayId)}`;
}

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
  // 🔴🔴 **委派到共用來源(2026-09-03 A1)** —— 而這一刀【第一次做的時候沒有落地】:
  //    我那一發 python 在後面一個 assert 就中止了, **而中止發生在寫檔之前** ⇒ 這一段沒被改到,
  //    **而我在 `order-email-copy.ts` 留下的註解已經寫著「排版那份也委派到這裡」。**
  //    ⇒ 📌 **一個沒發生的寫入 + 一句描述意圖的註解 = 一個宣稱, 而三綠看不到它**
  //      (`noUnusedLocals` 沒開 ⇒ 未使用的 import 不紅;code-reviewer R1 才抓到)。
  //    🎯 **⇒ 我描述的是我的意圖, 不是那個動作的結果。**
  //    ✅ **為什麼非委派不可**:純文字那份也要印同一筆金額;兩份各一個實作 ⇒ 有人給其中一個
  //      加了小數位 ⇒ **同一封信裡兩個數字**, 而客人看到哪一份不是我們決定的。
  return formatOrderAmount(n);
}

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Noto Sans TC',Arial,sans-serif";
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/** 主旨。稿 `:55` 逐字:**固定模板 + 訂單編號,不夾客戶欄位**。 */
export function paidEmailSubject(ctx: PaidEmailContext): string {
  return `PCM 訂單 ${ctx.orderDisplayId} 付款成功通知`;
}

/**
 * PDF 那一塊對客人說的那一句話。**模板與守門共用這一個常數。**
 *
 * 🔴 **為什麼不各寫一份**:守門要比對的就是這句話。兩邊各一份 ⇒ 有人改了模板而沒改守門 ⇒
 *    **守門靜靜地不再守任何東西, 而它照樣全綠**(本 repo 記過同型:斷言被重打一份在測試裡)。
 */
export const PAID_EMAIL_PDF_ATTACHED_SENTENCE = '訂單明細 PDF 已附在這封信裡';

/**
 * 🔴 **送出去之前的最後一道:信裡說了「PDF 已附在這封信裡」, 而附件裡沒有 PDF ⇒ throw。**
 *
 * 🛑 **這道守門存在的理由,是【兩個獨立的事實可以不一致】**:
 *    · `hasPdfAttachment` 是一個**自由布林**, 由呼叫端斷言
 *    · 而**真的有沒有附件**, 由 `sender.send({ attachments })` 決定
 *    ⇒ 📌 **兩者今天沒有任何東西綁著。翻開旗標而忘了附檔 ⇒ 那句話直接對客人說謊,**
 *      **而信會【成功寄出】、三綠全綠、沒有任何一格會紅。**
 *    ⇒ ⇒ 🎯 **這正是本 repo 記過的形狀:失敗的形狀是【成功】。**
 *
 * ✅ **判準用「html 裡有沒有那句話」而不是「旗標是不是 true」** —— 那一格刻意的:
 *    旗標只是**產生**那句話的其中一條路;而客人讀到的是**那句話**。
 *    ⇒ 未來有人用別的方式印出同一句(複製一段模板、另開一個 chrome 欄), 這道尺**照樣抓得到**。
 *
 * ⚠️ **射程 —— 三格, 而它證不到的東西要跟它抓得到的一樣顯眼**:
 *    ① 只認附件檔名以 `.pdf` 結尾。改附件命名規則 ⇒ 這道尺要一起改
 *       (而那一刻它會**紅**, 不會靜靜地放行 —— 那是刻意選的方向)。
 *    ② 🔴 **它只看 `html` 那一份, 看不到 `text` 那一份。** 而純文字是**收信軟體不顯示 HTML 時
 *       客人唯一讀得到的那一份** ⇒ 有人把同一句話加進 `buildEmailText` ⇒ **這道尺安靜放行**。
 *       (今天沒破:`buildEmailText` 那條路零命中。而「今天沒破」不是保護。)
 *    ③ `includes` 對客人資料太寬:品名走 `esc()` 而那句話零可逃逸字元 ⇒ 一個**逐字**叫
 *       「訂單明細 PDF 已附在這封信裡」的品名會讓那封信永遠寄不出去。已知、不加碼防。
 */
export function assertPdfClaimMatchesAttachments(
  html: string | null,
  attachments: readonly { readonly filename: string }[] | undefined,
): void {
  if (html === null || !html.includes(PAID_EMAIL_PDF_ATTACHED_SENTENCE)) return;
  const hasPdf = (attachments ?? []).some((a) => a.filename.toLowerCase().endsWith('.pdf'));
  if (hasPdf) return;
  throw new Error(
    `信裡寫了「${PAID_EMAIL_PDF_ATTACHED_SENTENCE}」而附件裡沒有 .pdf ` +
      `(附件 ${(attachments ?? []).length} 個)。fail-closed:不寄。`,
  );
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
  // 🔴 `logoUrl` 有預設,而 `paidAtText` / `orderUrl` **刻意沒有** ——
  //    那兩個的值是**每一封信不同**的(付款時間、單號),沒有一個「預設」說得通;
  //    而 LOGO 是**每一封信都一樣**的一個站台常數。
  //    ⇒ 📌 有沒有預設,判準是「這個值屬於這封信,還是屬於這個站」。
  //    ⚠️ 而傳 `logoUrl: undefined` 進來會拿到預設值(物件解構的預設只認 `undefined`)——
  //       要**明確不印 LOGO**,傳 `logoUrl: ''` ⇒ 空字串是 falsy,下面那道用的是 `!logoUrl`。
  const {
    paidAtText,
    logoUrl = PCM_EMAIL_LOGO_URL,
    orderUrl,
    hasPdfAttachment = false,
  } = chrome;
  const id = esc(ctx.orderDisplayId);

  // ── 品項列 ────────────────────────────────────────────────────────────────
  // 🔴 `title` / `variantSku` 可以是 null(型別檔 `:46/:48`)。
  //    品名缺 ⇒ 印一個看得出「這裡本來有東西」的字,**不要印空白** ——
  //    空白那一列與「這張單只有兩項」長得一樣。
  const lineRows = ctx.lines
    .map((l) => {
      const title = l.title === null ? ORDER_LINE_TITLE_MISSING : esc(l.title);
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

  // ── 🔴🔴 加不起來就不印金額(2026-09-04 線【帳號】`-account`;`⟦b4-INVOICE5PCT⟧` 第 5 步)──
  //
  // 🛑🛑 **先讀這兩句, 它們決定你怎麼引用這道閘**(2026-09-04 唯讀實查 + codex R2):
  //   ① **它【不是】在防髒資料** —— 正式庫有 `orders_total_balances` ⇒
  //      `CHECK (total = subtotal + shipping_fee - discount_total + tax_total)`
  //      ⇒ 🎯 **一列不平衡的訂單在 DB 上寫不進去。**
  //   ② 🔴 **閘守【資料的一致】, 測試守【印出來的東西】—— 兩個機制【不可互相冒充】。**
  //      **renderer 少印一項 ⇒ 資料四數照樣平衡 ⇒ 本閘不會叫**;攔那個的是測試。
  //      ⇒ 📌 **一道閘的說明若把測試的功勞算進來, 下一個人會刪掉測試而以為閘還在保護他。**
  //
  // **病灶**:DB 的等式是 `total = subtotal + shipping_fee - discount_total + tax_total`,
  // 而本檔的金額區 ⛔ ~~**只列前三項**~~ ⇒ 🔴 **`tax_total > 0` 的那一天, 客人會收到一張【加不起來】的帳。**
  // ✅ **2026-09-04 第 7 步訂正:稅額那一列已經加上了**(見下方 `taxRow`)⇒ **這一段講的是【本片之前】的狀態。**
  //    🔵 而這道閘**留著** —— 它防的是**下一個被加進 `total` 而沒人記得印的欄位**。
  //
  // 🛑 **而在本片之前, 這道判斷【只裝在純文字那一份】**(`sweep-email-outbox.ts:432`)——
  //    🔬 量到的:`grep -c 'orderAmountsBalance'` 本檔 **0** · 那一支 **2**(🟢 兩個世界印不同的數)。
  //    ⇒ 🎯 **所以那天兩份信會【各出一種病】**:純文字那份**整段不印**, 而本份**照印一張兜不攏的帳**
  //      —— 而**客人看到哪一份, 是他的收信軟體決定的**(`sweep-email-outbox.ts:423` 逐字)。
  //
  // ✅ **判準與那一份【共用同一支函式】** —— 不重寫一份, 因為兩份各判各的就是這個病的下一種形狀。
  // ✅ **動作也與那一份一致:整段不印**(品項表 + 金額區), 而**信照寄**,
  //    客人仍看得到訂單編號、CTA 與頁尾。⇒ 📌 **一張看不到明細的帳, 比一張兜不攏的帳好。**
  // 🛑 **而我【沒有】加一句「明細請至會員中心查看」之類的解釋** —— 那是**文案**, 而文案是 Sean 拍的。
  //    純文字那一份在這條路上也是**沉默的**, 兩份保持一致;要加解釋, 兩份一起加。
  //
  // 🔴🔴 **這道閘【擋不到資料】—— 它擋的是【我們自己】**(2026-09-04 codex R1 nit ⇒ 唯讀實查確認):
  //    正式庫上有 `orders_total_balances` ⇒
  //    `CHECK (total = subtotal + shipping_fee - discount_total + tax_total)`
  //    ⇒ 🎯 **一列不平衡的訂單在 DB 上【寫不進去】。**
  //    ⇒ 📌 **所以本閘為真時漏掉的那個世界不存在** —— 它防的**不是髒資料**。
  //
  //    🔴🔴 **而它會叫的範圍比我第一版寫的【窄】**(codex 對抗審查 R2 must-fix, 它是對的):
  //      ⛔ ~~我寫「renderer 少印一項、mapper 少接一欄、判準少一個加數 —— 三種它都攔」~~
  //      ✅ **實際只攔得到後兩種**:
  //        · **mapper 少接一欄** ⇒ 那個數字進來是錯的 ⇒ 四數兜不攏 ⇒ **本閘叫** ✅
  //        · **判準少一個加數** ⇒ 本閘自己就是那個判準 ⇒ 改壞它 ⇒ 測試叫 ✅
  //        · 🔴 **renderer 少印一項** ⇒ **資料四數照樣平衡** ⇒ **本閘【不會叫】** ❌
  //      🎯 **⇒ 而「renderer 少印稅」正是本片修的那個 bug** —— 📌 **所以修它的不是這道閘, 是【測試】。**
  //      ⇒ 🛑 **兩個機制不可互相冒充**:閘守【資料的一致】, 測試守【印出來的東西】。
  //        一道閘的說明若把測試的功勞算進來, 下一個人會刪掉測試而以為閘還在保護他。
  //
  // ⚠️ **本段【證不到】什麼**:
  //    ① 證不到 `total` 本身對不對 —— 它只驗**這四個數字之間**的關係(那一支函式檔頭已寫)。
  //    ② 🔴 證不到 **PDF 附件那一份**:`hasPdfAttachment` 為真時信上仍寫「訂單明細 PDF 已附在這封信裡」,
  //       而**那份 PDF 走的是另一條 render 路徑, 有沒有同樣的病本窗【未查】。**
  const amountsBalance = orderAmountsBalance({
    subtotal: ctx.subtotal,
    shippingFee: ctx.shippingFee,
    discountTotal: ctx.discountTotal,
    total: ctx.total,
    taxTotal: ctx.taxTotal,
  });

  // 🔴 稅額那一列:**有稅才印**(2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 7 步)。
  //    形狀跟【折扣】同族、與【運費】不同族:
  //      · 折扣 0 不印 —— 印「折扣 −0」會讓客人以為有一筆他沒看到的折抵
  //      · 運費 0 照印 —— 「免運」是客人想確認的一件事
  //      · 🔵 **稅 0 不印** —— 今天每一張單的稅都是 0(價格含稅), 印一列「稅額 0」
  //        會讓客人以為**這筆交易沒有被課稅**, 而那是錯的:稅**內含在售價裡**。
  //    🛑 而「稅額」這兩個字**不是我發明的文案** —— Sean 2026-09-04 選項字面逐字:
  //      「乙 = **稅額**單獨記一欄, 你打的單價原樣保留。」
  const taxRow =
    ctx.taxTotal > 0
      ? `          <tr>
            <td style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;" class="sub">稅額</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">${money(ctx.taxTotal)}</td>
          </tr>
`
      : '';

  // 🔴 運費 0 那一列**照印** —— 與折扣不同族:
  //    「免運」是客人想確認的一件事,而空白會讓他懷疑運費是不是漏算了。
  const shippingRow = `          <tr>
            <td style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;" class="sub">運費</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">${money(ctx.shippingFee)}</td>
          </tr>`;

  const logoCell =
    !logoUrl
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
              <div class="ink" style="font-family:${SANS};font-size:13px;font-weight:600;color:#1f2933;">${PAID_EMAIL_PDF_ATTACHED_SENTENCE}</div>
              <div class="sub" style="font-family:${SANS};font-size:12px;line-height:1.7;color:#5c6b7a;padding-top:3px;">
                在手機上請往下滑到信件底部；電腦版在信件標題下方。需要報帳或留存時可以直接使用。
              </div>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
`;

  // 🔴 品項表 + 金額區是**一個邏輯單位** —— 加不起來時兩塊一起不印,
  //    不可以只擋金額區:一張有品項小計而沒有總額的信, 客人一樣會自己加。
  // 🔴🔴 **不印明細的那封信, 不可以繼續說自己是明細**(codex 對抗審查 R1 must-fix, 2026-09-04)。
  //    `ORDER_PAID_HTML_LEAD_SENTENCE` 逐字是「這封信是這筆交易的明細。」
  //    ⇒ 🎯 **金額區被上面那道閘拿掉之後, 這一句就是【假的】** —— 而它印在信的最上面。
  //    🛑 **而純文字那一份【沒有】這個宣稱** ⇒ 兩份信不一致, 而不一致的那一半在說謊。
  //
  // ✅ **動作是【拿掉一句變成假的話】, 不是【加一句新的】** ——
  //    加新文案要 Sean 拍;**移除一個已經不成立的宣稱不用**, 而且它讓兩份信回到一致(兩份都不宣稱)。
  //    ⇒ 📌 客人仍看得到「我們收到您的付款了」與下一步那句, 信的用途沒有變。
  const leadSentence = amountsBalance ? ORDER_PAID_HTML_LEAD_SENTENCE : '';

  const amountsBlock = !amountsBalance
    ? ''
    : `    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
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
          <!-- 🔴 **這裡的「小計」與上面【品項表欄頭】那個「小計」是【兩個不同的東西】**
               (b4-TAXSURFACES, 2026-09-04 Sean 拍甲):
               · 欄頭那個 = **行小計**(單價 × 數量), 受詞是「這一列」
               · 這裡這個 = **訂單小計**, 受詞是「整張單」
               ⇒ 🛑 **只有這一個要加「(未稅)」** —— Sean 拍板那句講的是這一個。
               ⚠️ **而行小計那一欄在有稅時【也是未稅的】**(Sean 選乙:單價原樣保留)
                  ⇒ 📌 那是一題**還沒被問過**的:欄頭要不要也加。**本片不代他決定, 已記板。**
               🔴🔴 **這段註解裡【不可以出現反引號】** —— 它住在一個 template literal 裡,
                  反引號會把字串當場切斷。⛔ 我第一版寫了一對包住 b4 那個錨, 而 typecheck 報的是
                  TS1127 Invalid character、指向註解 ⇒ **看起來像編碼問題, 而其實是字串被切斷了。** -->
          <tr>
            <td style="font-family:${SANS};font-size:13px;color:#4a5765;padding:5px 0;" class="sub">${subtotalLabelOf('小計', ctx.taxTotal)}</td>
            <td align="right" class="ink" style="font-family:${MONO};font-size:13px;color:#1f2933;padding:5px 0;">${money(ctx.subtotal)}</td>
          </tr>
${shippingRow}
${discountRow}${taxRow}          <tr class="hair">
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
          ${leadSentence}${ORDER_PAID_NEXT_STEP_SENTENCE}
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

${amountsBlock}${ctaBlock}${pdfBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px hair" style="padding:24px 28px 30px;">
        <div style="border-top:1px solid #dde3ea;padding-top:16px;">
          <div class="sub" style="font-family:${SANS};font-size:12px;line-height:1.85;color:#5c6b7a;">
            ${ORDER_CONTACT_LEAD}
            <a href="${PCM_LINE_URL}" style="color:#2d5f8f;text-decoration:underline;">${PCM_LINE_ID}</a>，
            並告訴我們訂單編號 ${id}。
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

/**
 * 這段 HTML 有多少 bytes(UTF-8)。
 *
 * 🔴 **Gmail 超過 102KB 會把信剪掉** —— 而被剪掉的是**下半部**,
 *    也就是金額合計、CTA 與公司資訊。稿 `:72-73` 就是為了這條才禁 base64。
 *
 * ══ 🔴🔴 而【圖不算在那 102KB 裡】—— 這一格最容易讀反 ═══════════════════════
 *   那條上限量的是**這封信的 HTML 本體**,不是它引用到的東西。
 *   ⇒ 一張外連的 LOGO 不論多大(我們這張 **66,739 bytes**),進到信裡的只有
 *     `<img src="…">` 那個標籤 —— 2026-09-01 實測 **324 bytes**
 *     (有 LOGO 12,306 vs 明確不印 11,982)。
 *   ✅ **⇒ 這正是稿禁 base64 的全部理由**:同一張圖 base64 之後會直接進本體。
 *      ⛔ ~~我第一版寫「66,739 bytes ≈ 門檻的 64%」~~ **作廢** ——
 *      🔴 **base64 會脹 4/3** ⇒ 66,739 × 4/3 ÷ 104,448 = **85.2%**(當場算的,不是估的)。
 *      📌 而我第一版是**拿原始檔大小直接除** —— 一個少了一步換算的數字,
 *         它讀起來完全正常,而且**方向是往安全那一側偏**(64% 比 85% 沒那麼嚇人)。
 *   🛑 **⇒ 所以「12% 很安全」這句話的前提是【圖在外面】。**
 *      哪天有人為了「怕圖載不到」把它內嵌回來,本體會從 12% 跳到 **97%**(11,982 + 88,985),
 *      **而三綠與那 25 格測試一個都不會紅**(它們驗的是字串長對,不是大小)。
 *   ⚠️ 而本檔的 `paidEmailHtmlBytes()` **量的也只有本體** —— 附件不在裡面。
 * 🛑 **本函式只量,不擋。** 擋不擋是寄送端的決定 —— 只有它知道附件加進去之後總共多大,
 *    而**本檔量到的數字不含附件**。
 */
export function paidEmailHtmlBytes(html: string): number {
  return Buffer.byteLength(html, 'utf8');
}

/** Gmail 開始剪信的門檻(bytes)。呼叫端自己比,本檔不比。 */
export const GMAIL_CLIP_BYTES = 102 * 1024;
