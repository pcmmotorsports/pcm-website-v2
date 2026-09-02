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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createElement } from 'react';
import type { MemberOrderDetail } from '@pcm/domain';
import { StatementDoc } from '@/components/print/statement-doc';
import { buildStatementHtml, isInsideDir } from '@/lib/print/statement-html';

const require_ = createRequire(import.meta.url);

/**
 * fontsource 那個套件的根目錄。**拿不到回 `null`**(呼叫端據此判, 見 `StatementPdfHtml.fontPkgDir`)。
 *
 * ══ 為什麼是【候選鏈】而不是一句 `require.resolve` ═══════════════════════════
 * 🔴🔴 **`require.resolve` 在 Vercel 的函式裡 throw —— 這是量到的, 不是推的**
 *    (2026-09-03 18:40 正式站, 部署 `dpl_2rjvRX8hRL32Y36gBn67YDpQfR8H`):
 *      `拒絕產檔 … 內嵌 0 · 拿不到字型檔 0 · 版面 CSS 缺 false · 字型套件=null`
 *    成因(⚠️ **射程分兩半, 不要讀成同一級**):
 *      · **量到的**:`require.resolve` 在那邊 throw(`字型套件=null` 是它的直接讀數)。
 *      · ⛔ ~~「那 212 支 woff2 的位元組**進得了函式包**」~~ ⇒ **那句我寫超過了**
 *        (code-reviewer must-fix):唯一讀數是**本機 `.nft.json`**(`.pnpm` 底下 2,192 筆),
 *        而 `statement-pdf-tracing.test.ts` 檔頭逐字「答得出 Next 打算帶哪些檔,
 *        **答不出 Vercel 真的帶了**」—— **丙就是死在這一格。**
 *        ✅ 正確說法:**本機清單裡有 2,192 筆;正式站有沒有帶, 未量。**
 *    **而沒有一個 Node 解析得到的 `node_modules/@fontsource/noto-sans-tc`** ——
 *    `.next/node_modules/` 只有被 `import()` 的那幾個(chromium / pg / puppeteer-core)。
 *    ⇒ 🛑 **「位元組在包裡」與「這個套件解析得到」是兩個宣稱。**
 *
 * 🎯 **而修法就印在同一行 log 的【綠色那一格】旁邊**:`版面 CSS 缺 false`
 *    ⇒ 同一支函式裡的 `cssCandidates` 用 `process.cwd()` 相對路徑讀檔, **在正式站成功了**。
 * 🛑🛑 **而那個佐證【比它看起來的窄】**(code-reviewer 2026-09-03 抓到, 寫出來不要讓下一個人高估):
 *    `cssCandidates` 走的是 `join(cwd, 'src', 'styles')` —— **全程待在 `apps/storefront` 裡面**;
 *    而候選② 要**跨出 app 目錄兩層**(`../../node_modules/.pnpm`)。
 *    ⇒ 📌 **「cwd 相對讀得到」被證實過的只有【往內】那一種, 【往外兩層】那一種正式站讀數 = 0。**
 *    ⇒ ⚠️ 唯一另一組 `../../` 資源是 chromium 那四支 `.br`, 而 `route.ts` 先 return 500
 *      ⇒ **正式站從來沒走到過它們** ⇒ **這一步是丁唯一沒有任何正式站讀數的環節。**
 *    ⇒ ⇒ **所以這裡照抄那個【已經會動】的形狀:給幾個候選、讀不到就回 null。**
 *    📌 我們盯著那行 log 看了三次都只讀「哪一格是紅的」, 而**綠的那一格說出了修法**。
 *
 * ⛔ ~~先前試過【丙】:`next.config.ts` 加 glob 把 app 層那棵 pnpm symlink 樹列進追蹤清單~~
 *    ⇒ 🔴 **已在正式站證偽**(同上那一發)。**不要再試那條路** —— 理由與實測寫在 `next.config.ts`。
 *
 * ⚠️ **本函式【本機必然成功】** —— 本機 `require.resolve` 就過了, 第一個候選就回。
 *    ⇒ **下面那條 cwd 候選在本機通常【不會被執行到】** ⇒ 🛑 **本機全綠證不到它在 Vercel 上會動。**
 *    ⇒ 驗收只有一個地方看得到:**打那個網址, 看那張紙上的中文是【字】不是方框。**
 *      (🔴 **不要看 log** —— 成功時 route 回 200, 而那行只住在 500 分支, 一個字都不印。)
 */
/**
 * 這個目錄**用得上嗎** —— 判的是「執行時真的會讀的那幾支檔在不在」。
 *
 * 🔴🔴 **不判 `package.json`**(code-reviewer 2026-09-03 must-fix):執行時讀的是
 *    `400.css` / `700.css`(下面 `fontCss` 那段)與 `files/*.woff2`(`readFont`)——
 *    `package.json` 只是「這個套件成立」的**代理**。
 *    ⇒ 📌 **而這支檔的整段病史就是「位元組在 ≠ 用得到」** —— 拿代理當判準等於再演一次:
 *      平台若剝掉 `package.json`, 這裡會回 null, **而它旁邊的字型檔全都在**。
 * 🔵 兩個候選**共用同一道判** —— 否則候選①「解析成功但目錄裡沒有 CSS」時會直接回那條路徑,
 *    **永遠落不到候選②**(同一位 reviewer 的 must-fix:判的是「非 null」不是「可用」)。
 */
function isUsableFontPkg(dir: string): boolean {
  return existsSync(join(dir, '400.css')) && existsSync(join(dir, '700.css'));
}

/**
 * @param resolvePkgJson 候選①的解析器。**收成參數的唯一理由是【測那個接縫】** ——
 *   本機它一定成功 ⇒ 沒有這個注入點, 「①失敗會不會真的落到②」那一格**測不到**,
 *   而 reviewer 實測:把候選①改成 `return null` ⇒ **12 格全綠**(我原本三發突變全在②內部)。
 */
export function fontPkgDir(
  resolvePkgJson: () => string = () => require_.resolve('@fontsource/noto-sans-tc/package.json'),
  cwd: string = process.cwd(),
): string | null {
  // 候選①:正常的 Node 解析。本機與一般部署走這條;Vercel 函式裡它 throw。
  // 🔴🔴 **這一行同時是【打包追蹤】的錨, 不得刪**(原句 2026-09-01 就在, 我改寫 docstring 時
  //    一度把它弄不見了 —— code-reviewer must-fix 要求搬回來):
  //    `statement-pdf-tracing.test.ts` 逐字寫著那 1,977 個字型檔進得了函式包,
  //    **靠的就是這個 `require.resolve`**(本機清單裡 `.pnpm` 那 2,192 筆的來源)。
  //    ⇒ 🛑 **它今天在 Vercel 上 throw, 而那【不是】把它刪掉的理由** —— 刪了會抽掉追蹤。
  try {
    const dir = dirname(resolvePkgJson());
    if (isUsableFontPkg(dir)) return dir;
    // 🔵 解析成功而目錄不可用 ⇒ **繼續往下試**, 不要回一條讀不到東西的路徑。
  } catch {
    // 落到候選②。**吞掉例外是刻意的** —— 這一格的語意是「這條路找不到」, 不是「壞了」。
  }

  // 候選②:cwd 相對去 pnpm 的 store 裡找。
  return findFontPkgInPnpmStore(cwd);
}

/**
 * 候選② 的本體 —— **抽成具名 export 的唯一理由是【它在本機跑不到】**。
 *
 * 🛑🛑 `fontPkgDir()` 的候選① (`require.resolve`) **在本機一定會過** ⇒ 本函式**永遠不會被執行到**
 *    ⇒ 📌 **它是「只在正式站才走的那條路」, 而那正是最不該只靠肉眼的那一種碼。**
 *    ⇒ ✅ 收成 `cwd` 參數 + 具名 export ⇒ 測試餵一個**假的 store 佈局**就走得到它,
 *      **不必等部署**。(⚠️ 而那仍然只證得了【這段邏輯】, 證不到 Vercel 的檔案樹長怎樣。)
 *
 * @param cwd 通常是 `process.cwd()`;測試餵臨時目錄。
 */
export function findFontPkgInPnpmStore(cwd: string): string | null {
  // 🔵 兩個 base 對齊 `cssCandidates` 的兩個候選(cwd 是 app 目錄 / 是 repo 根兩種情形)。
  //    正式站量到 `cwd=/var/task/apps/storefront`, 而追蹤到的 `.pnpm` 落在 repo 根
  //    ⇒ 第一個 base(`../../`)是那邊會命中的那一個。
  const storeBases = [
    join(cwd, '..', '..', 'node_modules', '.pnpm'),
    join(cwd, 'node_modules', '.pnpm'),
  ];
  // 🔴 **版本號不寫死** —— `@fontsource+noto-sans-tc@5.3.0` 那個字串會隨升版變,
  //    寫死的話升一次版就靜靜地找不到(而失敗形狀是方框, 不是報錯)。
  const PREFIX = '@fontsource+noto-sans-tc@';
  const found: string[] = [];
  for (const base of storeBases) {
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue; // 這個 base 不存在 ⇒ 換下一個。
    }
    for (const e of entries.filter((n) => n.startsWith(PREFIX)).sort()) {
      const dir = join(base, e, 'node_modules', '@fontsource', 'noto-sans-tc');
      // 🔴 **判的是【執行時真的會讀的那幾支檔】, 不是 `package.json`**(見 `isUsableFontPkg`)。
      //    只看目錄名等於相信 store 的長相;而只看 `package.json` 是拿代理當判準。
      if (isUsableFontPkg(dir)) found.push(dir);
    }
  }
  // 🛑 **命中多支時的行為要明寫(主視窗-87 要求), 而 pnpm 底下【真的會】多支**:
  //    兩個套件依賴不同版本時 store 裡會並存。
  //    ⇒ **取 `found` 的第一支, 而不是「隨便一支」** —— 理由是**決定性**:同一棵樹每次都選同一個,
  //    ⚠️ **而它的精確語意是【base① 優先, base 內字典序】**(code-reviewer 抓到我原句比實作寬):
  //      `sort()` 只排**每個 base 內部**, `found` 是跨 base 串接 ⇒ 兩個 base 同時命中時,
  //      base② 的 `4.9.0` **不會**贏過 base① 的 `5.10.0`。行為仍然決定性, 只是不是全域字典序。
  //      否則兩次部署可能嵌到不同版本的字型而**沒有任何東西會叫**。
  //    ⚠️ 這是**字典序**不是語意版本序(`5.9.0` 會排在 `5.10.0` 後面)⇒ **它不保證挑到最新**,
  //      只保證**每次挑同一個**。要挑最新是另一件事, 而今天 store 裡只有一支(實測)。
  //    🔵 **而選了哪一支看得見** —— 呼叫端把它印進 log 的 `字型套件=<路徑>`。
  return found.length > 0 ? (found[0] as string) : null;
}

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

  const pkg = fontPkgDir();
  // 400 + 700 —— 那張紙上有 22 條 `font-weight: 700`(`print-a4.css`)。
  const fontCss =
    pkg === null
      ? ''
      : ['400.css', '700.css']
          .map((f) => readTextOrNull(join(pkg, f)))
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
      if (pkg === null) return null;
      const p = resolve(pkg, rel);
      // 🔴 防目錄逃逸 —— `p.startsWith(pkg)` **不是目錄邊界**(`isInsideDir` 有自己的測試)。
      if (!isInsideDir(pkg, p)) return null;
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
  });

  return {
    html: built.html,
    embedded: built.embedded,
    skippedMissing: built.skippedMissing,
    uncovered: built.uncovered.length,
    missingCss: pageCss.length === 0,
    fontPkgDir: pkg,
  };
}

/**
 * 把自足的 HTML 交給 headless Chrome 產成 A4 PDF。**會 throw**(呼叫端自己接)。
 *
 * 🔴 動態 import —— 讓 chromium 那 66 MB 只在**真的要產檔**時才進記憶體。
 *    (它進不進【函式包】是 tracing 的事, 與這裡無關。)
 */
export async function htmlToPdf(html: string): Promise<Uint8Array<ArrayBuffer>> {
  // 🔴 回傳型別釘 `Uint8Array<ArrayBuffer>` 而不是裸 `Uint8Array`(= `ArrayBufferLike`):
  //    `NextResponse` 的 `BodyInit` 只吃前者 ⇒ 寫成裸的會讓呼叫端**再包一次 `new Uint8Array(...)`**
  //    = 多複製一份整個 PDF 的位元組, 而那不是原本那條 route 在做的事。
  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
