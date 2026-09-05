// statement-pdf — 「把一個 React 元素變成一份 PDF」的兩支原語(2026-09-01 從 route 抽出來)。
//
// ══ 為什麼抽 ═══════════════════════════════════════════════════════════════
// 這段碼原本整段長在 `app/account/orders/[displayId]/statement.pdf/route.ts` 裡,
// 而**寄訂單信要附一份 PDF** 時需要同一條路(⟦b4-MAILPDF1⟧)。
// 🔴 而【不是把 route 包成函式再去打自己的網址】—— 那要把客人的 session cookie
//    轉發進 headless Chrome。route 自己的檔頭把那個決定寫得很清楚, 這裡沿用:
//    **拿到資料 → 自己 render 成 HTML → 餵給 Chrome**, 中間不經過任何一次 HTTP。
//
// 🛑 **抽成【兩支】而不是一支, 是刻意的**:
//    · `buildStatementPdfHtml()` —— 純資源組裝, **不 throw**, 回一組數字讓呼叫端自己判
//    · `htmlToPdf()`             —— 只做 Chrome 那一段, **會 throw**
//    ⇒ 📌 因為「要不要因為缺字型而拒絕產檔」是**政策**, 而政策該留在呼叫端:
//      route 拒絕時回 404/500, 而寄信那條路拒絕時該做什麼**還沒有人拍板**。
//      ⇒ ⇒ 把政策焊進函式裡, 下一個呼叫端就只能接受它或整支複製一份。
//
// 🔴🔴 **它繼承了一個【沒有人驗過】的格子, 寫在這裡不要讓它消失**:
//    route 檔頭記著這條路在 Vercel 上壞過一次 —— **PDF 照樣產出來、HTTP 200,
//    而每個中文是方框**(資源在本機讀得到、在函式包裡讀不到)。修法寫了,
//    而**「它現在是好的」沒有人在正式環境驗過**。⇒ 抽出來不改變那個風險, 也不解決它。
//    ⚠️ 唯一在守它的是 `statement.pdf/statement-pdf-tracing.test.ts`(讀 `.nft.json`),
//       而它自己寫著「答得出 Next 打算帶哪些檔, 答不出 Vercel 真的帶了」。
//
// ⚠️ **`maxDuration = 60` 是估的** —— route 檔頭逐字「我沒有量過任何一段」。
//    2026-09-01 本機量了一發, 而**那個數字不在測試裡**(codex R1 nit:我原本寫「寫在測試裡」,
//    而測試沒有 timing ⇒ 那句話是假的)⇒ 它在那一顆 commit 的 body 裡:
//      n=1  HTML 64ms · 開瀏覽器 609ms · 產檔 466ms · 合計 1,139ms · 258,046 bytes
//      n=12 HTML 29ms · 開瀏覽器  88ms · 產檔 263ms · 合計   380ms · 261,632 bytes
//    🛑 **而那不是 `htmlToPdf` 跑出來的** —— 是用 playwright 的 chromium 跑同一份 HTML。
//       `@sparticuz/chromium` 在 macOS 上 `spawn ENOEXEC` ⇒ **本函式本機執行不了**
//       ⇒ ⇒ **Vercel 冷啟還要解壓 66 MB, 這組數字不能拿去回答 `maxDuration` 夠不夠。**
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { resolveFontPkgs } from '@pcm/pdf';
import type { MemberOrderDetail } from '@pcm/domain';
import { StatementDoc } from '@/components/print/statement-doc';
import { buildStatementHtml, isInsideDir } from '@/lib/print/statement-html';

// ══ 🔴 下面這三段【搬走了】(2026-09-06 P-1)══════════════════════════════════
//    `LATIN_PKG` / `TC_PKG` / `fontPkgDir` / `findFontPkgInPnpmStore` / `htmlToPdf`
//    現在住在 `@pcm/pdf`(`packages/pdf/src/index.ts`), **原字面連同註解一起搬過去**。
// 🔴 **為什麼是搬而不是複製**:後台要產同一種檔;複製一份 ⇒ 兩份會分岔,
//    而**分岔的那一天沒有訊號**(本 repo 記過:互補集的定義在兩邊各寫一份, 遲早不互補)。
// 🛑 **而字型的解析起點跟著搬了** —— 相依現在宣告在 `@pcm/pdf` 的 package.json,
//    所以這裡改叫 `resolveFontPkgs()`(它在 package 內部解析)而不是自己 `require_.resolve`。
// 🔵 **下面仍然 re-export 那幾支** —— 既有測試從本檔 import 它們,
//    而本片的驗收條件第一條逐字是「顧客站那族測試【零改動】仍全綠」
//    ⇒ 📌 改測試去配合搬家 = 把守門搬成我要的形狀。**所以搬的是碼, 不是測試的入口。**
// 🔵 **只 re-export 呼叫端真的 import 的那三支**(code-reviewer nit)——
//    `LATIN_PKG` / `TC_PKG` 搬家前是 module-private, re-export 會讓它們變成 app 的公開面,
//    而 app 側零呼叫端。要用的人去 `@pcm/pdf` 拿。
export { fontPkgDir, findFontPkgInPnpmStore, htmlToPdf } from '@pcm/pdf';

function readTextOrNull(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export interface StatementPdfHtml {
  /**
   * 自足的 HTML —— 版面 CSS 內嵌、字型內嵌成 data: URI。
   *
   * 🛑 **「對外網路請求 0」是【內容的性質】, 不是這裡強制的**(codex R1 must-fix):
   *    `htmlToPdf` **沒有**攔截 Chrome 的請求 ⇒ 元件或 CSS 哪天長出一個 `url(https://…)` /
   *    `@import` / `srcset`, **伺服器就會真的去抓它**(對外, 或對內網 ⇒ SSRF 面)。
   * ✅ **今天守它的是 `statement-pdf.test.ts` 的一格**:掃產出的 HTML,
   *    任何非 `data:` 的資源引用一律紅 ⇒ **那是【內容側】的守門, 不是【瀏覽器側】的閘。**
   * 🔴 **為什麼不在 `htmlToPdf` 裡加請求攔截**(是判斷, 寫出來讓人推翻我):
   *    `@sparticuz/chromium` 是 Linux binary ⇒ **本機根本跑不起來**(macOS `spawn ENOEXEC`)
   *    ⇒ 我加的攔截**一行都驗不到**, 而它擋錯東西時的形狀是「PDF 少了某個資源」——
   *      那正是這條路壞過的那一種(200 而畫面不對)。
   *    ⇒ ⇒ 📌 **在一條我跑不動的路上加一道我驗不了的閘, 風險高於它擋的東西。**
   *    ⇒ 要做那道閘, 前置是「有一個跑得動 `@sparticuz/chromium` 的環境」—— 而那不在這一片。
   */
  html: string;
  /** 內嵌成功的字型子集數。**0 = 整張紙每個中文都會是方框**(部署壞了, 不是客人的名字)。 */
  embedded: number;
  /** 宣告了而檔案讀不到的子集數。 */
  skippedMissing: number;
  /** 這張紙上「沒有任何 face 宣告涵蓋」的字數 ⇒ 那幾個字會是空白。 */
  uncovered: number;
  /** 兩支版面 CSS 一支都讀不到 ⇒ 那是一張沒有任何樣式的紙。 */
  missingCss: boolean;
  /**
   * `@fontsource/noto-sans-tc` 解析到的目錄,**解析不到就是 `null`**。
   *
   * 🔴 **它存在的唯一理由是【分辨兩個印一樣的失敗】**(2026-09-03 正式站那一發):
   *   甲 `require.resolve` 失敗 ⇒ 這裡是 `null` ⇒ 一個 `@font-face` 都沒宣告
   *   乙 解析成功, 而 `400.css` / `700.css` 讀不到 ⇒ 這裡是**一條路徑**, 而 `fontCss` 一樣是空的
   *   ⇒ ⇒ 🛑 **甲乙都會讓 `embedded === 0` 且 `skippedMissing === 0`** —— 兩個 0 的意思相反而長得一樣。
   * 🔵 **本欄【不參與任何判斷】** —— 它只給 log 讀。加它的那一顆 commit 沒有動任何 `if`。
   */
  fontPkgDir: string | null;
}

/**
 * 把一份訂單組成【自足的列印用 HTML】。**不做政策判斷** —— 只回一組數字讓呼叫端自己判。
 *
 * 🛑🛑 ⛔ ~~本函式「不 throw」~~ **那句是假的, 而它會害到相信它的人**(codex R1 must-fix):
 *    `await import('react-dom/server')` 可以 reject、`renderToStaticMarkup` 可以 throw
 *    (元件裡任何一個例外)、`buildStatementHtml` 也可以。
 *    ⇒ 📌 **我沒有寫 try/catch, 所以它們會原樣往上拋** —— 而我在 docstring 裡寫「不 throw」
 *      ⇒ ⇒ 寄信那條路若照著它不 catch, **一次渲染例外會把整個寄信工作打斷**。
 * ✅ **現行事實**:它**只擋一種**錯 —— 讀不到檔(`readTextOrNull` / `fontPkgDir` 各自吞掉)
 *    ⇒ 那一種會變成「數字很難看」而不是例外。**其餘一律往上拋, 呼叫端自己 catch。**
 * 🔵 而**刻意不包一層 try/catch**:包了就是把「渲染壞了」變成「數字難看」,
 *    而那兩件事該走不同的出口(前者是 bug, 後者是資料/部署問題)。
 *
 * 🛑 呼叫端要自己決定拿這組數字做什麼 —— 現行 route 的政策是
 *    `embedded === 0 || missingCss` ⇒ 拒絕產檔(Sean 2026-08-31 拍乙:**缺字照產、只記 log**,
 *    而那個「乙」被收窄到 `uncovered` 那一種, 不含上面那兩種)。
 */
export async function buildStatementPdfHtml(
  order: MemberOrderDetail,
): Promise<StatementPdfHtml> {
  // 🔴 **`process.cwd()` 是什麼, 我們【沒有量到】** —— 兩個候選都試, 都找不到就讓上面那道閘接住。
  const cssCandidates = [
    join(process.cwd(), 'src', 'styles'),
    join(process.cwd(), 'apps', 'storefront', 'src', 'styles'),
  ];
  const pageCss = cssCandidates
    .flatMap((dir) => [join(dir, 'print-a4.css'), join(dir, 'statement.css')])
    .map(readTextOrNull)
    .filter((css): css is string => css !== null)
    .filter((css, i, all) => all.indexOf(css) === i)
    .join('\n');

  // 🔴 **兩個套件, 而【拉丁排前面】** —— 理由與量測在 `LATIN_PKG` 的 docstring。
  //    ⚠️ 這裡的順序只影響 `fontCss` 裡 `@font-face` 的先後;真正決定紙上用哪支的是
  //    `print-a4.css` 的 `--pd-body` / `--pd-disp` 字體鏈, 而那兩張紙**逐位元組共用同一份**。
  // 🔴 **解析起點跟著相依走** —— 那兩個 `@fontsource/*` 現在宣告在 `@pcm/pdf`,
  //    所以由它自己解析(見那支檔 `resolveFontPkgs` 的 docstring)。
  const { latin: pkgLatin, tc: pkgTc } = resolveFontPkgs();
  // 🛑 **解析不到的那一支【跳過】而不是整個回空** —— 少一支子集不該讓整張單產不出來
  //    (與 `readFont` 的 docstring 同一條原則)。
  const pkgs = [pkgLatin, pkgTc].filter((d): d is string => d !== null);
  // 400 + 700 —— 那張紙上有 22 條 `font-weight: 700`(`print-a4.css`)。
  const fontCss = pkgs
    .flatMap((dir) => ['400.css', '700.css'].map((f) => readTextOrNull(join(dir, f))))
    .filter((css): css is string => css !== null)
    .join('\n');

  // 🔴 `react-dom/server` 只能【動態】import —— Next 的 App Router 對它有一道靜態 import 閘。
  const { renderToStaticMarkup } = await import('react-dom/server');

  const built = buildStatementHtml({
    // 🔴🔴 **`printButton: false` 鎖在這裡, 不由呼叫端傳**(codex R1 must-fix):
    //    ⛔ ~~第一版收一個任意的 `ReactElement`~~ ⇒ 下一個呼叫端(寄信)漏傳那一顆 prop
    //       ⇒ **正式環境 500**(那顆鈕是 `'use client'`, 而這裡沒有 client boundary;
    //         2026-08-31 實際發生過, Vercel runtime log 逐字
    //         `Attempted to call StatementPrintButton() from the server`)
    //    ⇒ ⇒ 📌 而**既有守門只掃現行那條 route** ⇒ 新呼叫端漏傳時, 沒有任何一格會紅。
    //    ✅ 收 `order` 而不是收元素 ⇒ **那個錯誤在型別上就構造不出來。**
    // 🔵 `createElement` 而不是 `StatementDoc({ order })` —— 後者是【直接呼叫元件】,
    //    那在今天可行(它是純函式)而在它哪天用到 hook 的那天會安靜地壞掉。
    bodyHtml: renderToStaticMarkup(
      createElement(StatementDoc, { order, printButton: false }),
    ),
    pageCss,
    fontCss,
    readFont: (rel) => {
      // 🔴 **兩個套件的 `src:url()` 都是 `./files/…`** ⇒ 同一個 `rel` 要在兩個目錄裡各試一次。
      //    🟢 而檔名不會撞:拉丁那支叫 `noto-sans-latin-…`, 中日韓那支叫 `noto-sans-tc-…`
      //    ⇒ 一個 `rel` 最多命中一支。**而即使哪天撞了, 先命中的贏 —— 順序是決定性的。**
      for (const dir of pkgs) {
        const p = resolve(dir, rel);
        // 🔴 防目錄逃逸 —— `p.startsWith(dir)` **不是目錄邊界**(`isInsideDir` 有自己的測試)。
        //    🛑 **每一支各判一次** —— 用其中一支的邊界去判另一支等於沒判。
        if (!isInsideDir(dir, p)) continue;
        if (existsSync(p)) return new Uint8Array(readFileSync(p));
      }
      return null;
    },
  });

  return {
    html: built.html,
    embedded: built.embedded,
    skippedMissing: built.skippedMissing,
    uncovered: built.uncovered.length,
    missingCss: pageCss.length === 0,
    // 🔵 這一欄只給 log 讀(它【不參與任何判斷】, 見型別上的 docstring)。
    //    ⚠️ 兩個套件之後它報的仍是**中日韓那支** —— 因為它存在的理由是分辨
    //    「`require.resolve` 失敗」與「解析成功而 CSS 讀不到」, 而那個病兩支同構。
    //    🛑 **拉丁那支解析失敗時這一欄看不出來** —— 那是已知缺口, 不是它壞了。
    fontPkgDir: pkgTc,
  };
}
