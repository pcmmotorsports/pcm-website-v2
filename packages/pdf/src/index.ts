// @pcm/pdf — 「把一份自足的 HTML 交給無頭 Chrome 產成 PDF」的共用能力。
//
// 🔴🔴 **這裡【只有產檔, 沒有版面】** —— 版面留在各自的 app:
//    顧客站的對帳單版面在 `apps/storefront/src/lib/print/statement-html.ts`,
//    而後台的出貨單是**另一份**。把版面搬進來 = 把兩份版面綁在一起, 而它們沒有理由一起改。
//
// 📎 **來源**:2026-09-06 從 `apps/storefront/src/lib/print/statement-pdf.ts` 搬出來
//    (⟦f3-SHIPPDF1⟧ P-1;主視窗 `-f8` 批 plan `docs/plans/2026-09-06-pdf-p1-shared-capability-plan.md`)。
//    🔴 **搬的是【原字面】** —— 下面每一段註解都跟著它解釋的那段碼一起過來(鐵則 6),
//      裡面住著別人量到的數字與拍板紀錄, 不是可以壓縮的裝飾。
//
// 🛑🛑 **它繼承了一個【沒有人在正式環境驗過】的格子**:
//    這條路在 Vercel 上壞過一次 —— **PDF 照樣產出來、HTTP 200, 而每個中文是方框**
//    (資源在本機讀得到、在函式包裡讀不到)。
//    ⇒ 📌 **而搬家本身動到那件事的變因**:字型是用 `require.resolve` 找的,
//      **解析起點跟著這支檔搬了** ⇒ 守它的那道 tracing 測試要跟著改, 並多一格。
//    ⇒ 🔵 **搬完之後當場重量**(顧客站那條 route 的 `.nft.json`;code-reviewer 逼出來的訂正):
//      ⛔ ~~追蹤 2043 檔 · 字型 430 檔~~ —— **那是【搬家前】的讀數**, 我把它寫成了搬家後的狀態。
//      ✅ 現值(⚠️ **時點 2026-09-06 P-1 那一發**;下面 P-2/CARON 之後的讀數在同段末尾):
//        **總筆數 1828** · `noto-sans-tc` **215 筆**(全部走 `node_modules/.pnpm/…` 實體路徑)
//        · 走 `apps/storefront/node_modules` 的 **0** · 走 `packages/pdf/` 的 **0**
//      🛑🛑 **那 215 筆【不是】靠 `require.resolve` 進來的, 是 `next.config.ts` 的四條 root `.pnpm` glob 供應的**
//        ⇒ 📌 **搬家對「字型有沒有被打包」這件事【零改變】** —— 搬家前後都是那四條 glob 在撐。
//      ⛔ ~~🔴 而拉丁那支 `@fontsource/noto-sans` 追蹤到 **0 筆**(它沒有對應的 glob)…本片也沒有修它~~
//      🟢 **2026-09-06 訂正 —— 那一段【每一句】都不再是現值**(⟦ship-PRINTCARONNOTBUNDLED⟧ 修掉了):
//        顧客站 `next.config.ts` 補了拉丁那四條 glob ⇒ **總 1847 檔 · 拉丁 19 筆 · tc 215 筆**。
//        (⚠️ 那些數字量的是**本機 `.nft.json` 列到的檔**, 不是 Vercel `.func`。)
//      🔴 而 `⟦ship-PRINTCARON1⟧` 的**後果**也一起訂正了:
//        ⛔ ~~拉丁沒進包 ⇒ `Č`/`Š` 是方框~~ ⇒ **不會** —— chromium 自帶 `fonts.tar.br` = Open Sans,
//        cmap 逐點 `Č` U+010C true · `Š` U+0160 true · 🔵 負對照 `中` U+4E2D **false**
//        ⇒ 🎯 **拉丁 glob 修的是【排版】, 中文 glob 才是【看不看得懂】。**
//      🛑 **舊字面留刪除線不刪**:它記著「一片已完成的修法可以在函式包裡從來沒成立過」——
//        那個教訓與它今天修好了沒有關係。
//      📌 **而這一段會過期第二次** —— 它住在共用 package 而數字來自兩個 app 的 build
//        ⇒ **沒有任何一把尺會在它過期時變紅。**(2026-09-06 就是這樣被 code-reviewer 抓到的。)
//      ⚠️ 而上面每一個數字答的都是「**Next 打算帶哪些檔**」, 不是「Vercel 真的帶了」,
//        更不是「線上那份 PDF 的中文是對的」。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require_ = createRequire(import.meta.url);

/**
 * 兩個字型套件 —— 🔴 **順序就是修法本身**(⟦ship-PRINTCARON1⟧, 2026-09-04)。
 *
 * `noto-sans-tc` 的 woff2 **沒有 `Č`(U+010C)/ `Š`(U+0160)的字形**,
 * 而它的 `unicode-range` **宣告了**那個範圍 ⇒ 🛑 **宣告不是保證**。
 * 真 PDF 量到(後台那條同款鏈):舊鏈 `Č ⇒ CAAAAA+Helvetica`(靠機器上剛好有);
 * 新鏈 `Č ⇒ NotoSans-Regular` · 🟢 `中 ⇒ NotoSansTC`(中日韓照樣往後落)。
 *
 * 🛑 **而這條路【不能只改 CSS 的字體鏈】** —— 這裡是伺服器裡的無頭 chromium,
 *    字型是**讀位元組 base64 內嵌**進去的。CSS 指名一支沒有被內嵌的字型 ⇒
 *    要嘛落到容器的系統字型(**而那個容器有什麼字型沒有人量過**)、要嘛整格沒作用。
 *    ⇒ 📌 **所以兩個套件都要出現在下面 `fontCss` 與 `readFont` 兩個地方。**
 */
const LATIN_PKG = '@fontsource/noto-sans';
const TC_PKG = '@fontsource/noto-sans-tc';

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
  resolvePkgJson: () => string = () => require_.resolve(`${TC_PKG}/package.json`),
  cwd: string = process.cwd(),
  pkgName: string = TC_PKG,
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
  return findFontPkgInPnpmStore(cwd, pkgName);
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
export function findFontPkgInPnpmStore(cwd: string, pkgName: string = TC_PKG): string | null {
  // 🔴 `pkgName` 是 2026-09-04 加的 —— ⟦ship-PRINTCARON1⟧ 之後**這條路要帶兩個套件**
  //    (拉丁那支有 `Č` / `Š` 的字形, 中日韓那支【沒有】而它的 `unicode-range` 宣告了那個範圍)。
  //    ⚠️ 預設值保持中日韓那支 ⇒ 既有呼叫端與測試字面不變。
  const storeKey = pkgName.replace('/', '+');
  const bare = pkgName.split('/')[1]!;
  // 🔵 兩個 base 對齊 `cssCandidates` 的兩個候選(cwd 是 app 目錄 / 是 repo 根兩種情形)。
  //    正式站量到 `cwd=/var/task/apps/storefront`, 而追蹤到的 `.pnpm` 落在 repo 根
  //    ⇒ 第一個 base(`../../`)是那邊會命中的那一個。
  const storeBases = [
    join(cwd, '..', '..', 'node_modules', '.pnpm'),
    join(cwd, 'node_modules', '.pnpm'),
  ];
  // 🔴 **版本號不寫死** —— `@fontsource+noto-sans-tc@5.3.0` 那個字串會隨升版變,
  //    寫死的話升一次版就靜靜地找不到(而失敗形狀是方框, 不是報錯)。
  const PREFIX = `${storeKey}@`;
  const found: string[] = [];
  for (const base of storeBases) {
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue; // 這個 base 不存在 ⇒ 換下一個。
    }
    for (const e of entries.filter((n) => n.startsWith(PREFIX)).sort()) {
      const dir = join(base, e, 'node_modules', '@fontsource', bare);
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

/**
 * 兩支字型套件的目錄, 一次解析完。
 *
 * 🔴🔴 **為什麼要有這一支, 而不是讓呼叫端各自 `require_.resolve`**(2026-09-06 P-1 搬家當下加):
 *    `require.resolve` 的**解析起點是【呼叫它的那支檔】**。搬家之前那兩顆常數與
 *    `require_` 都住在顧客站的 app 裡 ⇒ 起點是 app;搬進本 package 之後,
 *    **宣告那兩個字型相依的是本 package** ⇒ 📌 **起點應該跟著相依走, 不是跟著呼叫端走。**
 * 🛑 而這一格正是那個【本機好、線上豆腐字】的病灶所在:解析起點錯了不會有例外,
 *    它只會回 `null` ⇒ 一個 `@font-face` 都沒宣告 ⇒ **PDF 照樣產出來, 每個中文是方框。**
 * ⚠️ **本函式不做政策判斷** —— 解析不到就是 `null`, 要不要因此拒絕產檔由呼叫端決定
 *    (與 `fontPkgDir` 同一條原則)。
 */
export function resolveFontPkgs(cwd: string = process.cwd()): {
  latin: string | null;
  tc: string | null;
} {
  return {
    latin: fontPkgDir(() => require_.resolve(`${LATIN_PKG}/package.json`), cwd, LATIN_PKG),
    tc: fontPkgDir(() => require_.resolve(`${TC_PKG}/package.json`), cwd, TC_PKG),
  };
}

/** 兩支字型套件的名字 —— 呼叫端組 `@font-face` 或寫測試時要用到。 */
export { LATIN_PKG, TC_PKG };

// ── 自足 HTML 的組裝(2026-09-06 P-2 由顧客站搬進來;理由見 `html.ts` 檔頭)────────
export {
  buildStatementHtml,
  codepointsOfHtml,
  isInsideDir,
  parseFontFaces,
  type BuildResult,
  type ParsedFace,
} from './html';
