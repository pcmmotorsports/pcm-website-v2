import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import bundleAnalyzer from '@next/bundle-analyzer';
// 🔴 與 admin 同一顆正式庫閘(MAIN-127 ④;單一事實,不複製 —— 複製的那天起兩道閘就開始漂)。
//    storefront 是「唯一量到實際打過正式庫痕跡」的入口:.env.local ref=2 + SERVICE_ROLE=1,
//    .next/cache/fetch-cache 21 檔含正式庫 ref(2026-08-23 主視窗量測,量具限定=只認 fetch-cache)。
//    ⚠️ 跨 app 相對 import 在 legacy TS-config loader 下是用 cwd 解析的(loader bug):
//    cwd=apps/storefront(正常起法、turbo 亦同)解析得到;cwd≠專案目錄的調用會 fail-safe 崩潰。
import { assertDevDbGate } from '../admin/src/lib/dev-db-guard-gate';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/* 🔴 片 C3(2026-08-31):把那條 route 執行時要讀的檔拉進它的函式包。
 * ⛔ ~~把【編譯後的 CSS 與字型檔】拉進來~~ —— 那是第一版的說法, 而實作已經不是那樣了
 *    (codex 連抓兩輪:我改了實作而這一行沒跟著改)。現行讀的是**原始碼 CSS** 與 `@fontsource`。
 *
 *    為什麼需要它:伺服器產 PDF 那條路自己組 HTML(設計 B),而它在執行時要**讀檔**:
 *      · 版面 CSS ⇒ `src/styles/print-a4.css` + `statement.css`(**原始碼**)
 *      · 字型     ⇒ `@fontsource/noto-sans-tc`(住 `node_modules`)
 *    ⇒ 那些檔不拉進函式包的話, 線上那條 route 會讀不到 ⇒ 走 fail closed(500)。
 *    ⛔ ~~第一版讀 `.next/static/` 的編譯產物~~ —— 那條路不成立, 理由在下面那段實驗數字。
 *       (codex 抓到這段註解與實作已經相反 —— 我改了實作而沒改它。)
 *
 *    🔴 **為什麼是 `outputFileTracingIncludes` 而不是 `vercel.json` 的 `includeFiles`**:
 *    Vercel 官方文件 `https://vercel.com/docs/functions/limitations`
 *    (頁面自標 last_updated 2026-08-24)逐字:
 *      「You can use `includeFiles` and `excludeFiles` to specify items which may affect
 *        the function size. **These configurations are not supported in Next.js**,
 *        instead use `outputFileTracingIncludes`.」
 *
 *    🛑 **這一格是【未驗】的**:我在本機用 Next 自己的追蹤清單(`*.nft.json`)量到它有沒有把
 *       那些檔算進來 —— 而**那把尺不是 Vercel 實際打包的東西**(射程寫在
 *       `docs/plans/2026-08-31-statement-pdf-slice-c-plan.md` §2b)。
 *       真的要答, 要量目標 `.func`(`vercel build` 的 Build Output)。 */
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // 🔴🔴 **這個 key 是【glob】,不是路徑字面。**Next 動態區段的方括號 `[displayId]`
    //    在 glob 裡是**字元類別** ⇒ 寫 `/account/orders/[displayId]/statement.pdf`
    //    **永遠不會命中**,而它**不報錯、不警告** —— build 照樣綠,那些檔就是沒進去。
    //    實測(2026-08-31,一次只變一個變因):
    //      key 用字面 `[displayId]` ⇒ 命中 0
    //      key 用 `'**'`(最大對照)  ⇒ 命中 48   ⇒ 機制是好的
    //      key 用 `/account/orders/**` + `./src/styles/print-a4.css` ⇒ 命中 1 ⇒ **key 對了**
    // 🔵 **2026-08-31 收窄**(codex 關卡2 R4 nit):原本是 `/account/orders/**/statement.pdf`,
    //    而 `**` 會命中任何巢狀的 `statement.pdf` route ⇒ 未來多一條同名 route 就會被塞進
    //    66 MB 的 chromium。改成把方括號**跳脫**掉, 只命中這一條。
    // 🔴 **而這個收窄敢做的唯一理由, 是那道守門已經在了** ——
    //    `statement-pdf-tracing.test.ts` 那格「`.br` 必須是 4 支且逐支點名」。
    //    收窄的失敗形狀是**靜靜地 0 個檔**(區段改名 / 跳脫寫錯), 而那正是今天修的那個病。
    //    ⇒ **沒有那道守門的話, 這個 nit 不該收** —— 為了未來的整潔去換一個安靜的失敗, 不划算。
    // 🟢 實測(一次只變一個變因, 各一發 build):
    //      `**`              ⇒ .br 4 / files 2839
    //      `\[displayId\]`   ⇒ .br 4 / files 2839   ← 採用這個
    //      `\[zzq9137\]`(現造負對照) ⇒ .br **0** / files 2618  ← 證明這把 key 是活的
    '/account/orders/\\[displayId\\]/statement.pdf': [
      './src/styles/print-a4.css',
      './src/styles/statement.css',
      // ── 字型 ──────────────────────────────────────────────────────────
      // 🔴🔴 **實測:這四條【今天是多餘的】** —— route 裡那句
      //    `require.resolve('@fontsource/noto-sans-tc/package.json')` 已經讓 Next 把
      //    **整包**追進去了(2026-08-31 量:1,977 檔 / 65.07 MB, 九個字重 × woff+woff2)。
      //    拿掉其中一條(`package.json`)重 build ⇒ **一模一樣的 1,977 / 65.07 MB** ⇒ 不是它造成的。
      // ⛔ 而我一度在 commit body 裡寫「只 include 400+700 那 212 支 = 6.26 MB」——
      //    **那是我以為的, 不是量到的。真值是整包。**
      // 🛑 **那為什麼還留著這四條**:上面那個「整包被追進來」是 Next 追蹤器的**隱含行為**,
      //    它哪天改了, 失敗形狀是**線上豆腐字而 build 全綠** ⇒ 這四條是那一格的安全帶。
      //    ⇒ 而真正在看著它的是 `statement-pdf-tracing.test.ts` 那道守門, 不是這幾行。
      '../../node_modules/.pnpm/@fontsource+noto-sans-tc@*/node_modules/@fontsource/noto-sans-tc/{400,700}.css',
      '../../node_modules/.pnpm/@fontsource+noto-sans-tc@*/node_modules/@fontsource/noto-sans-tc/package.json',
      // ── chromium 的那四包壓縮檔 ────────────────────────────────────────
      // 🔴🔴 **2026-08-31 量到的:它們一支都沒被 trace 進來(`.br` 條數 = 0)。**
      //    而 `route.ts:201` 呼叫 `chromium.executablePath()`, 那支函式的實作逐字是
      //    `inflate(join(input, "chromium.br"))`(`@sparticuz/chromium/build/index.js:128-133`,
      //    四支全要:chromium / fonts.tar / swiftshader.tar / al2023.tar)
      //    ⇒ **檔不在 = 那條 route 在線上 `ENOENT`**, 而 build 全綠、`Route (app)` 表上它還在。
      // 🔴 **為什麼 Next 追蹤器抓不到**:那四支是**執行期用字串 join 出來的路徑**,
      //    不是 `import` / `require` ⇒ 靜態追蹤看不到它們。字型那包會被整包追進來是因為
      //    route 裡有一句真的 `require.resolve(...)`;**這裡沒有那句, 所以沒有那個運氣。**
      // 📌 ⇒ 兩個相依都在 `package.json` 裡、都被 `pnpm install` 裝好了,
      //    而**「裝了」與「被打包進那條 route」是兩個宣稱** —— 這一格就是那句話的實例。
      '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/*.br',

      '../../node_modules/.pnpm/@fontsource+noto-sans-tc@*/node_modules/@fontsource/noto-sans-tc/files/*-400-normal.woff2',
      '../../node_modules/.pnpm/@fontsource+noto-sans-tc@*/node_modules/@fontsource/noto-sans-tc/files/*-700-normal.woff2',

      // ── 🔴🔴 拉丁那支 `@fontsource/noto-sans` ⟦ship-PRINTCARONNOTBUNDLED⟧(2026-09-06 補)──
      //
      // **它一直不在這裡, 而那不是疏忽 —— 是【沒有人問過它】。**
      // `⟦ship-PRINTCARON1⟧` 那一片(2026-09-04)為了 `Č` / `Š` 這種帶符號的拉丁字母
      // 把這支字型加進相依、也在 route 裡讀它;而**打包那一半從來沒有人補**。
      // ⛔ ~~而它的失敗形狀比中文那支更陰險:整張紙看起來完全正常, 只有那幾個 `Č` / `Š` 是方框~~
      // 🔴🔴 **那句是錯的, 而我在測試檔訂正之後【把這一份原封留著】**(codex R2 must-fix —— 同一個宣稱兩個落點,
      //    我只修了一個)。📌 **這正是「改對了一處而它的雙胞胎還在」那個形狀, 本片自己犯了一次。**
      // ✅ **量到的**(我自己跑的, 不是讀來的):chromium 那包 `fonts.tar.br` 解開 = Open Sans
      //    (Regular / Bold / Italic 三支), 而 Open Sans 的 cmap 逐點問:
      //      `Č` U+010C **true** · `Š` U+0160 **true** · `A` **true** · 🔵 負對照 `中` U+4E2D **false**
      //    ⇒ 🎯 **只要那份 PDF 產得出來, `Č` 就【不會】是方框** —— 它會被那支替代字型畫出來。
      //    ⇒ 🎯 **而中文不一樣**:Open Sans 沒有 CJK ⇒ 中文那組 glob 少了就真的是方框。
      // ⇒ 📌 **所以這四條拉丁 glob 修的是【排版】不是【看不看得懂】** ——
      //    那幾個字會換一張臉(本機量到是 Helvetica, `9ec3ad3af`), 而不是消失。
      //    ⚠️ 那顆 Linux 容器實際會挑哪一支**我們沒量過**, 而它不影響上面那個結論。
      //
      // 🔵 **兩個世界都量了(同一個檔、只加下面四條、各一發 build)**:
      //    改前:總 1828 檔 · 拉丁 `@fontsource/noto-sans` **0** 筆 · `noto-sans-tc` 215 筆
      //    改後:總 **1847** 檔 · 拉丁 **19** 筆(8×400.woff2 + 8×700.woff2 + 400.css + 700.css + package.json)
      //    ⛔ ~~見同片 commit body(與守門那一格的斷言同一個數)~~ —— **兩句都不對**(code-reviewer R3):
      //      守門**沒有任何一格**在斷言 1847;而 19 也不是一格, 是**兩格**(8/8 那格與 1/1/1 那格)。
      //      ⇒ 📌 一個把讀者指去「另一個地方有同樣的數字」的註解, 在那個數字不存在時**讀起來一樣通順**。
      //    ⇒ 📌 **那個 0 是【量到的】不是推的** —— `⟦f3-SHIPPDF1⟧` P-1 當場數出來的。
      //
      // 🔴 **四條要一起** —— ⛔ ~~理由與 tc 那組逐字相同:只放 `package.json` 會換來「解析成功而內嵌 0」~~
      //    **那句對這個 runtime 是錯的**(codex R1 nit, 我開檔複驗 `packages/pdf/src/index.ts:98`):
      //    `isUsableFontPkg(dir)` 逐字是 `existsSync(400.css) && existsSync(700.css)`
      //    ⇒ **只有 `package.json` 的目錄會被候選①【拒絕】並落到候選②**, 不會停在「解析成功而內嵌 0」。
      // ✅ **四條各自的理由(逐項對得上碼, 而【權重不一樣】—— codex R2 nit)**:
      //    · `400.css` / `700.css` —— **這兩條最要緊**:`isUsableFontPkg`
      //      (`packages/pdf/src/index.ts:98` 逐字 `existsSync(400.css) && existsSync(700.css)`)
      //      拿它們當可用性判準, 而候選②也只判這兩支。少了 ⇒ 這個目錄不算數。
      //    · `files/*.woff2` —— `readFont` 真正讀的位元組;少了是「有 `@font-face` 而沒有字」。
      //    · `package.json` —— **只承載候選①**(拉丁那支的 `require.resolve` 在
      //      `packages/pdf/src/index.ts:231`;⛔ ~~我原本引 `:108`~~ —— 那是 `TC_PKG` 的**預設參數**,
      //      受詞不對, codex R2 抓到)。候選②不讀它 ⇒ **少了它不會讓整條路死掉**, 只是少一條路。
      // ✅ **這四條的字面與後台那一份逐字相同**(`apps/admin/next.config.ts`, ⟦f3-SHIPPDF1⟧ P-2 `eb4c55894`;
      //    機械比過 4/4 byte-identical)。
      // ⚠️ ⛔ ~~兩個 app 從今天起一致~~ —— **那句比證據寬**(code-reviewer R3):
      //    本檔另有四條 **app 層的死 glob**(後台沒有), 而後台用 `FONT_GLOBS` 單一來源 flatMap 兩支、
      //    本檔是**八行硬寫** ⇒ 🛑 **加第三支字型時兩邊會再分岔。** 那是已知缺口, 不是疏漏。
      '../../node_modules/.pnpm/@fontsource+noto-sans@*/node_modules/@fontsource/noto-sans/package.json',
      '../../node_modules/.pnpm/@fontsource+noto-sans@*/node_modules/@fontsource/noto-sans/{400,700}.css',
      '../../node_modules/.pnpm/@fontsource+noto-sans@*/node_modules/@fontsource/noto-sans/files/*-400-normal.woff2',
      '../../node_modules/.pnpm/@fontsource+noto-sans@*/node_modules/@fontsource/noto-sans/files/*-700-normal.woff2',

      // ── 🔴🔴 修法【丙】(2026-09-03 `-ship`;⟦f3-SHIPPDF1⟧ 與 ⟦b4-MAILPDF1⟧ 同一個根因)──
      //
      // 🛑 **上面那些路徑全部指向 `.pnpm` 的【實體目錄】,而 Node 的解析器走不到那裡。**
      //    2026-09-03 正式站逐字:`拒絕產檔 … 內嵌 0 · 拿不到字型檔 0 · 字型套件=null`
      //    ⇒ 兩個 0 同時成立 = **不是檔案讀不到, 是一個 `@font-face` 都沒宣告**
      //    ⇒ `fontPkgDir()` 回 `null` ⇒ `require.resolve('@fontsource/noto-sans-tc/package.json')` **throw**。
      // 🔴 **成因是【檔案在、而模組入口不在】**(當場量):
      //    · `.next/node_modules/` 有 `@sparticuz/chromium-<hash>` / `pg-<hash>` / `puppeteer-core-<hash>`
      //      —— 那三個都被 `import()` ⇒ Next 替它們建了**解析得到的入口**;
      //      而 `ls .next/node_modules/@fontsource` ⇒ **No such file or directory**。
      //    · `.nft.json` 2,843 筆裡走 `apps/storefront/node_modules` 的 = **0**(2,761 筆走 `.pnpm`)。
      //    ⇒ 📌 **字型只被 `require.resolve` 碰到(`statement-pdf.ts:48`), 而那是【執行期】的東西,
      //      Next 不會為它建入口。** 位元組進得去, 解析進不去 —— **兩件事, 而清單上長得一樣。**
      //
      // 🛑🛑 **2026-09-06 起這四條【不再匹配任何檔】** —— ⟦f3-SHIPPDF1⟧ P-1 把那兩個
      //    `@fontsource/*` 的相依從 app 搬進 `@pcm/pdf` ⇒ `apps/storefront/node_modules/@fontsource`
      //    這個 symlink **已經不存在**;當場量:`.nft.json` 裡走 app 層的筆數 = **0**。
      //    ⇒ 🔴 **而 glob 不匹配時 Next 是【靜默】的** ⇒ 這四條今天是死設定, 而畫面上看不出來。
      //    ⇒ 📌 **不在本片刪它們** —— 刪掉會讓 `statement-pdf-tracing.test.ts` 的那一格負對照
      //      **無聲地變成恆真**(它靠「舊位置查無」證明自己會動)。要刪要連那一格一起處置。
      // ✅ **所以下面【四條】指的是 app 層那棵 pnpm symlink 樹**(`apps/storefront/node_modules/@fontsource/…`),
      //    (⛔ ~~原文寫「三條」~~ —— codex 2026-09-03 抓到:實際是四條, 而我在兩處都寫了三。
      //     數法 `grep -c "'\./node_modules/@fontsource" apps/storefront/next.config.ts` ⇒ 4。)
      //    那正是 Node 從 route 往上走時**唯一找得到的位置**。
      // 🔴 **四條要【一起】** —— 解析成功之後 `fontPkgDir()` 回的是**這個路徑**,
      //    而 `400.css` / `700.css` / `files/*.woff2` 都會從**這裡**讀 ⇒ 只放 `package.json`
      //    會換來一個新的失敗:**解析成功而 `內嵌 0`**(= `字型套件` 印出一條路徑而字還是沒嵌)。
      //
      // ⛔ ~~⚠️⚠️ **本條【尚未證明有效】,而它的失敗方式很安靜**~~
      // 🔴 **2026-09-03 18:40 更新:不再是「尚未證明有效」,是【已證明無效】**(見上面那一大段)。
      //    ⇒ 📌 兩者差很多:前者叫下一個人去驗, 後者叫他**不要再驗**。原句留著加刪除線。
      // ⚠️ 而下面這段【當時的未驗標記】保留不動 —— 它記的是「我事前就知道成敗點在哪」:
      //    tracing 會不會**保留 symlink**
      //    (而不是把它解成 `.pnpm` 實體路徑、或整個略過)**我沒有驗過**。
      //    ⇒ 🔵 **判別讀數(一發就分得出來)**:build 後數 `.nft.json` 裡走
      //      `apps/storefront/node_modules` 的條目 —— **改前是 0**,那就是現成的負對照。
      //    ⇒ 🛑 **而本機【必然說謊】**:本機那棵樹本來就在磁碟上 ⇒ `require.resolve` 本機
      //      **無論如何都會成功** ⇒ **本機三綠全綠證不到這一條有沒有用。**
      //      ⇒ ⇒ 🔴🔴 **丙成功的定義 —— 而我第一版寫錯了(codex R2 抓到, must-fix)**:
      //      ⛔ ~~「打一發 ⇒ 那行 log 的 `字型套件` 從 `null` 變成一條路徑」~~
      //      🛑 **那行 log 只住在 `route.ts` 的【500 分支】** —— 丙成功時 route 回 200,
      //         而**成功那條路一個字都不印**(唯一的另一筆 `console.warn` 要 `uncovered > 0`
      //         或 `skippedMissing > 0` 才會出聲)⇒ 📌 **我的驗收條件只在【失敗的世界】印得出東西。**
      //      ⇒ ⇒ ✅ **正確的觀察值是那張紙本身**:打那個網址 ⇒ **真的下載到一個 PDF**
      //         **而且打開來中文是【字】不是方框 □□□**。
      //      🛑 **而「log 裡不再出現 `拒絕產檔`」不算** —— 那是【缺席當證據】:
      //         沒有人打那條 route 時, 它一樣不會出現。
      // ══════════════════════════════════════════════════════════════════
      // 🔴🔴🔴 **丙已在【正式站】證偽 —— 不要再試這條路。**(2026-09-03 18:40:16)
      //
      //   部署 `dpl_2rjvRX8hRL32Y36gBn67YDpQfR8H`(= `origin/main` `87e30eaf`, 含本段的 commit `6a77d978`),
      //   **等 `readyState=READY` 之後才打**, 逐字:
      //     [statement.pdf] 拒絕產檔 displayId=C8MYDB · 內嵌 0 · 拿不到字型檔 0
      //                     · 版面 CSS 缺 false · 字型套件=null · cwd=/var/task/apps/storefront
      //     HTTP 500 · 0 bytes · content-type 空
      //
      // 🎯 **`字型套件=null` ⇒ `require.resolve` 仍然 throw ⇒ 那四條 glob 沒有解決解析問題。**
      // 🟢 **而那一發有判別力(三格都證得出來, 不是尺壞掉)**:
      //   ① `lastDeployment` 換了 ⇒ 打的是含丙的那一版
      //   ② 等 READY 才打(前兩次踩過建置中那個坑, 這次沒有)
      //   ③ `字型套件` 那一欄**存在** ⇒ `ee34bcf7` 生效了 ⇒ 印 `null` 是「解析失敗」,
      //      **不是「這一版沒有那一欄」** —— 兩者在畫面上會長一樣, 而 ③ 把它們分開了。
      //
      // 🛑 **那為什麼【不 revert】**(主視窗-87 2026-09-03 裁):
      //   ① 零行為風險(只是多列幾支檔進追蹤清單)② 下面那組守門五格是資產
      //   ③ 🔴 **revert 會讓「我們試過丙而它沒用」這件事從碼裡消失 ⇒ 下一個人會再試一次。**
      // ⚠️ **代價照實記**:這四條讓那 215 支檔在函式包裡**多存在一份**(約 6.47 MB, codex 量),
      //   而它們今天**沒有任何用途** —— 留著的理由是上面那個 ③, 不是它們有效。
      //
      // 📌 **它為什麼會失敗(我當時就標了未驗, 而答案是「不保留」)**:
      // 🔴🔴 **2026-09-06 訂正:上面這一段裡有【三句互斥】**(codex R1 nit, 我當場量了才確認):
      //    ① 「這四條 2026-09-06 起不再匹配任何檔」(真 —— 當場量:走 `apps/storefront/node_modules` 的筆數 = **0**)
      //    ② 「刪掉會讓那一格負對照無聲變恆真」
      //    ③ 「它們讓那 215 支檔多存在一份(約 6.47 MB)」
      //    ⇒ 🛑 **①成立的話 ③就不成立了** —— 一組不匹配任何檔的 glob 帶不進 6.47 MB。
      //      而 ②也站不住:舊位置**現在就已經是 0**, 刪掉這四條不會改變那個 0。
      //    ⇒ ✅ **③ 那個 6.47 MB 是 2026-09-03 的讀數, 當時 app 層那棵 symlink 樹還在。**
      //      ⛔ ~~數字沒錯, 錯的是它沒有跟著時點走~~ —— **我補了時點而漏了層級**(codex R2 nit):
      //      那個數字量的是**本機 `.nft.json` 列到的檔在磁碟上的位元組**,
      //      **不是** Vercel `.func` 裡實際佔的空間。⇒ 📌 §6-b 要的是**兩個**都跟著走:
      //      **時點 + 量測層級**, 而我第一次訂正只補了前者。
      //    ⇒ 📌 **「不刪」這個決定仍然成立, 而它現在只剩【一條腿】**:
      //      revert 會讓「我們試過丙而它沒用」從碼裡消失, 下一個人會再試一次。②③ 兩條腿已經斷了。
      //
      //   我寫過「tracing 會不會**保留 symlink** 我沒有驗過 ⇒ 這是這條路的成敗點」。
      //   ⇒ 本機 `.nft.json` 確實出現了 215 筆 app 層路徑(`../`×7)⇒ **本機讀數是好的**;
      //   ⇒ 而正式站仍然 `null` ⇒ **Vercel 那一層沒有把它變成一個 Node 找得到的模組入口。**
      //   ⇒ ⇒ 🛑 **「本機追蹤清單裡有」與「函式裡解析得到」是兩個宣稱** —— 這是第二次同型。
      // ══════════════════════════════════════════════════════════════════
      // 🔵 路徑基準 = **app 目錄**(對齊上面那些:`../../` 就是 repo 根)⇒ 這裡用 `./`。
      './node_modules/@fontsource/noto-sans-tc/package.json',
      './node_modules/@fontsource/noto-sans-tc/{400,700}.css',
      './node_modules/@fontsource/noto-sans-tc/files/*-400-normal.woff2',
      './node_modules/@fontsource/noto-sans-tc/files/*-700-normal.woff2',
    ],
    // 🛑🛑 **`./.next/static/**` 放進來是【沒有用的】—— 同一發實驗量到的:**
    //    同一個 key、同一次 build,`./src/styles/print-a4.css` ⇒ 1 而 `./.next/static/media/*.woff2` ⇒ 0。
    //    ⇒ `outputFileTracingIncludes` **拉不進 Next 自己的建置產物**(那是它的輸出目錄)。
    //    ⇒ 🔴 **所以「執行時從 `.next/static` 讀編譯後的字型檔」這條路在 Vercel 上不成立**,
    //      而它在本機**完全正常**(本機那些檔就在那裡)⇒ **這是一個只在正式環境發生的豆腐字。**
    //    ⇒ 字型要走一條 traceable 的來源(`node_modules` 或 repo 內的檔) —— 見片 C plan §2c。
  },
};

// dev 專屬資料庫閘;為什麼在 config、時序、射程與逃生門語意見 apps/admin/next.config.ts 註解。
const CONFIG_DIR = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) assertDevDbGate(CONFIG_DIR);
  return withBundleAnalyzer(nextConfig);
}
