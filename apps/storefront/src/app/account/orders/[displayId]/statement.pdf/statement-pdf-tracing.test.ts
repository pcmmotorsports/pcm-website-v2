// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

// 片 C3 的守門:**那條 route 的函式包裡,到底有沒有它執行時要讀的那些檔。**
//
// ══ 🔴 為什麼需要它 ═══════════════════════════════════════════════════════
// 這一片踩過的坑,形狀是**只在正式環境發生的豆腐字**:
//   本機 ⇒ 檔就在磁碟上 ⇒ 讀得到 ⇒ 中文正常 ⇒ **完全正常**
//   線上 ⇒ 檔沒被打包進函式 ⇒ 讀不到 ⇒ **PDF 照樣產出來、HTTP 200,而每個中文是方框**
// ⇒ 而 `typecheck` / `lint` / `build` / 任何單元測試**都不會紅** —— 它們不看打包清單。
//
// ⚠️ **射程(照實寫)**:它讀的是 Next 自己的檔案追蹤清單(`*.nft.json`)。
//    那**不是** Vercel 實際打包的 `.func` —— 兩者可能共同漏掉平台層的東西
//    (射程全文在 `docs/plans/2026-08-31-statement-pdf-slice-c-plan.md` §2b)。
//    ⇒ 它答得出「Next 打算帶哪些檔」,答不出「Vercel 真的帶了」。後者要真部署。
//
// 🔴🔴 **而 2026-09-03 正式站那一發證明還缺【第三句】:也答不出「帶了之後解析得到嗎」。**
//    線上逐字 `[statement.pdf] 拒絕產檔 … 內嵌 0 · 拿不到字型檔 0 · 版面 CSS 缺 false`
//    ⇒ 兩個 0 同時成立 = **不是檔案讀不到, 是一個 `@font-face` 都沒宣告** ⇒ `fontPkgDir()` 回 `null`
//    ⇒ ⇒ `require.resolve('@fontsource/noto-sans-tc/package.json')` 在函式裡 **throw**。
//    📌 **而本檔那時候是綠的, 而且它沒有說謊** —— 那 424 支 woff2 的**位元組確實在清單裡**。
//    🛑 **「位元組在不在包裡」與「那個套件解析得到嗎」是兩個問題, 而它們在這份清單上長得一模一樣。**
//    ✅ 佐證(2026-09-03 `-ship` 當場量):`.next/node_modules/` 裡有 `@sparticuz/chromium-<hash>` /
//       `pg-<hash>` / `puppeteer-core-<hash>`,**沒有 `@fontsource`**;而 `.nft.json` 裡
//       `apps/storefront/node_modules` 底下的條目 = **0**(2,843 筆中 2,761 筆走 `.pnpm` 實體路徑)。
//       成因:chromium 那三個被 `import()` ⇒ Next 替它們建了可解析入口;字型**只被 `require.resolve`**
//       (數法:排除 .test 與註解行後,`@fontsource` 真引用 ⇒ 1 支 `statement-pdf.ts:48` 是 `require.resolve`;
//        🟢 同一把尺對 `@sparticuz` ⇒ 1 支 `:178` 是 `import(`;🔵 負對照 `zzq9137never` ⇒ 0)。
//    ⚠️ **未量**:我沒有看到 Vercel 實際打包出來的檔案樹 ⇒ 上面是三個讀數同向的**推論**, 不是量到。
//    ⇒ 🔵 分辨甲(解析失敗)與乙(css 讀不到)的那一格已經補進 log:`字型套件=<路徑|null>`。
//
// 🔴 **而它守的其實是一個【隱含行為】**:那些字型檔進得去,是因為 route 裡的
//    `require.resolve('@fontsource/noto-sans-tc/package.json')` 讓追蹤器把整包拉了進來
//    (2026-08-31 實測 1,977 檔 / 65.07 MB;`next.config.ts` 那四條 glob 是安全帶,
//     而拿掉其中一條重 build ⇒ 數字一模一樣 ⇒ 今天真正生效的是前者)。
//    ⇒ 那個行為哪天變了,**這一格就是唯一會叫的東西**。

const ROUTE_NFT = join(
  __dirname,
  '../../../../../../.next/server/app/account/orders/[displayId]/statement.pdf/route.js.nft.json',
);

/**
 * 這份追蹤清單**是哪一次 build 產的** —— 而它與現在的原始碼是不是同一份。
 *
 * 🔴🔴 **2026-09-01 codex 抓到的假綠**:本檔原本只驗「`.nft.json` 存在」。
 *    當天實測:`.next` 是 **11:02** 而被它守的原始碼是 **13:01**
 *    ⇒ ⇒ 📌 **那一發驗的是【改動前】的產物, 而它印全綠。**
 *      而它綠得很有說服力 —— 每一格都通過, 只是通過的是上一個世界。
 * ✅ 所以現在多問一句:**產物比它守的原始碼舊嗎?**
 * 🛑 而它**不 throw、只出聲**(照本 repo 那條「一道紅著而沒有出路的守門會被整支刪掉」):
 *    有人只是想跑單元測試而沒有 build ⇒ 硬擋他等於逼他刪掉這支檔。
 *    ⇒ ⇒ 而**下面那幾格會照樣跑** —— 它們對舊產物仍然有意義, 只是意義不是「現在是好的」。
 */
function stalenessNote(): string | null {
  const nftAt = statSync(ROUTE_NFT).mtimeMs;
  const guarded = [
    join(__dirname, 'route.ts'),
    join(__dirname, '../../../../../lib/print/statement-pdf.ts'),
    // 🔴 **2026-09-03 補(codex 抓到, 而它正是本片改的那支檔)**:
    //    `outputFileTracingIncludes` 就住在 `next.config.ts` ⇒ **改了 glob 而沒重 build,
    //    下面那組「丙」的守門會拿【舊的 NFT】全綠** —— 而那正是它要擋的那種假綠。
    //    ⇒ 📌 一把守門, 沒有把「會改變它答案的那支檔」放進新鮮度清單 ⇒ 它守不住自己。
    join(__dirname, '../../../../../../next.config.ts'),
  ].filter((p) => existsSync(p));
  const newest = Math.max(...guarded.map((p) => statSync(p).mtimeMs));
  if (newest <= nftAt) return null;
  const mins = Math.round((newest - nftAt) / 60_000);
  return `⚠️ 這份追蹤清單比它守的原始碼舊 ${mins} 分鐘 ⇒ 下面每一格驗的是【上一次 build】那個世界, 不是現在這份碼。要驗現在這份 ⇒ 先跑 \`TURBO_FORCE=1 pnpm --filter @pcm/storefront build\``;
}

function tracedFiles(): string[] {
  if (!existsSync(ROUTE_NFT)) {
    throw new Error(
      `讀不到 ${ROUTE_NFT} —— 先跑 \`TURBO_FORCE=1 pnpm --filter @pcm/storefront build\``,
    );
  }
  return (JSON.parse(readFileSync(ROUTE_NFT, 'utf8')).files as string[]) ?? [];
}

describe('片 C3:statement.pdf 這條 route 的追蹤清單', () => {
  const files = tracedFiles();
  const count = (re: RegExp) => files.filter((f) => re.test(f)).length;

  it('量具自檢:清單本身要夠大(空清單會讓下面每一格都恆綠)', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  // 🔴 **格名 2026-09-03 改過, 而斷言【一個字沒動】**(主視窗-87 准, `-ship` 執行):
  //    ⛔ ~~舊名「量具自檢②:這份清單【不比它守的原始碼舊】」~~
  //    🛑 那個名字宣稱的是【清單是新的】, 而下面那行斷言**兩個世界都收** ⇒ 它恆綠。
  //    📌 **⇒ 只看綠紅的人(CI / 掃測試名的人)會把「綠」讀成「新鮮」** —— 而它從來沒有這個意思。
  //    ✅ 新名照它**實際在做的事**寫:印一行出來。**恆綠是刻意的**, 理由在 `stalenessNote()` 的 docstring。
  it('📎 印出這份清單相對原始碼的新鮮度 —— 🛑 本格【恆綠】, 判別力在印出來那一行、不在斷言', () => {
    const note = stalenessNote();
    // 🔴 **不 throw, 而是把那句話印在【判定的正上方】** —— 它與「綠」在同一個畫面上,
    //    而人讀的就是那幾行。(2026-09-01 那次假綠的成因不是沒有訊號, 是沒有任何訊號。)
    if (note !== null) process.stdout.write(`\n${note}\n`);
    // 🛑 而這一格**本身仍然要綠** —— 它守的是「有沒有把這件事講出來」, 不是「你有沒有 build」。
    //    ⇒ 判別力在上面那行輸出:兩個世界印**不同的東西**(過期 ⇒ 有那句;同步 ⇒ 一個字都沒有)。
    expect(typeof note === 'string' || note === null).toBe(true);
  });

  it('✅ 版面 CSS 的【原始碼】在裡面 —— route 讀的是它,不是編譯產物', () => {
    // ⛔ 第一版讀 `.next/static/` 的編譯產物 ⇒ 那條路在 Vercel 上不成立:
    //    `outputFileTracingIncludes` 拉不進 Next 自己的輸出目錄(next.config.ts 有實驗數字)。
    expect(count(/src[\\/]styles[\\/]print-a4\.css/)).toBeGreaterThan(0);
    expect(count(/src[\\/]styles[\\/]statement\.css/)).toBeGreaterThan(0);
  });

  it('✅ 字型的 CSS 與 woff2 都在裡面(400 與 700 各自要有)', () => {
    expect(count(/@fontsource.*noto-sans-tc[\\/]400\.css/)).toBeGreaterThan(0);
    expect(count(/@fontsource.*noto-sans-tc[\\/]700\.css/)).toBeGreaterThan(0);
    // 🔴 只問「有沒有 woff2」不夠 —— 一支也是有。這張紙要的是**成批的中文子集**。
    expect(count(/@fontsource.*noto-sans-tc[\\/]files[\\/].*-400-normal\.woff2/)).toBeGreaterThan(50);
    expect(count(/@fontsource.*noto-sans-tc[\\/]files[\\/].*-700-normal\.woff2/)).toBeGreaterThan(50);
  });

  it('✅ chromium 與 puppeteer 的 JS 在裡面', () => {
    expect(count(/@sparticuz[\\/]chromium/)).toBeGreaterThan(0);
    expect(count(/puppeteer-core/)).toBeGreaterThan(0);
  });

  // 🔴🔴 **這一格被推翻過 —— 而推翻它的理由比它原本的內容重要。**
  //    ⛔ ~~`it('chromium 的 brotli binary 不在', () => expect(count(/\.br$/)).toBe(0))`~~
  //    codex 抓到:**我把一個【未解的洞】寫成了【通過條件】**。
  //    那個 0 不是好消息 —— 如果 Vercel 就是照 NFT 清單打包, 那 `chromium.executablePath()`
  //    在線上**沒有壓縮包可以解** ⇒ 這條 route 固定 500。
  //    📌 **⇒ 而它會躺在一份「131 格全綠」的報表裡, 長得像一個已經驗過的東西。**
  //    ✅ 改成 `it.todo` —— 它在報表上是**待辦**, 不是綠燈。它會一直在那裡叫,
  //       直到有人真的部署一次、打那條 route、看 `executablePath()` 回什麼。
  //    ⛔ ~~`it.todo('🛑 未解:… 缺的那一道是【真部署一次、打這條 route、
  //       看 chromium.executablePath() 回什麼】')`~~
  // 🔴🔴 **2026-08-31 解掉了, 而【解法不是那個 todo 指的那一道】。**
  //    那個 todo 誠實地標了「未解」, 而它把缺的那一步寫成**最貴的那一種**(真部署)。
  //    真正缺的是**開 `@sparticuz/chromium/build/index.js` 讀兩分鐘**:
  //      `:128-133` 逐字 `inflate(join(input, "chromium.br"))` + fonts / swiftshader / al2023
  //      ⇒ 那四支是**執行期用字串 join 出來的路徑**, 不是 `import` ⇒ **靜態追蹤看不到**
  //      ⇒ 檔不在 = 線上 `ENOENT`, 而 build 全綠、`Route (app)` 表上它還在。
  //    ✅ 修法是 `next.config.ts` 加一條 glob 收那四支 ⇒ 實測 `.br` **0 → 4**。
  // 📌 **⇒ 這一格真正的教訓不是「我漏了四個檔」, 是【我把驗證路徑指到了最貴的那一條】** ——
  //    而「要真部署才知道」聽起來比「去讀那支套件的碼」**更嚴謹**,
  //    所以它不會被質疑, 它會被排進待辦然後等。**一個指錯方向的 todo 會保護自己。**
  // 🛑 而字型那包被整包追進去是因為 route 裡有一句**真的** `require.resolve()` ⇒
  //    **那是運氣, 不是機制。**兩個相依都在 `package.json` 裡、都裝好了,
  //    而「裝了」與「被打包進那條 route」是兩個宣稱。
  // ══ 🛑 這一支測試【證不到】什麼(codex 關卡2 must-fix④)══════════════════════
  //    本檔量的是 **Next 自己的追蹤清單 `*.nft.json`**, 而 Vercel 實際打包的是
  //    `.vercel/output/functions/**/*.func`。**那是兩個東西。**
  //    ⇒ 本檔全綠只證「Next 把那些檔【列】進來了」,
  //      **不證**「Vercel 把它們【放】進函式包了」, 也不證「相對位置沒變」
  //      —— 而 `chromium.executablePath()` 是用 `join(__dirname,'../../bin')` 找的,
  //         位置變了 = 檔在包裡也照樣 ENOENT。
  // 🔴 **缺的那一道, 具名, 而且【不是】「真部署一次」**(上一版就是這樣寫而它把人指去最貴的路):
  //    ① 最便宜:`vercel build` 產 `.vercel/output/functions/…statement.pdf.func`, 數裡面的 `.br`
  //       🛑 **本窗做不到** —— 它要先 `vercel link` 到 Sean 的專案, 那是對外動作、不歸施工窗拍。
  //       ⇒ **做得到的人 = 有 Vercel 存取的那個窗 / Sean 本人。**
  //    ② 次便宜:對【已部署的預覽】打一發那條 route, 看它回 200 還是 ENOENT 的 500。
  // 📌 ⇒ 寫成「誰做得到 + 哪一道」而不是「未解」—— **一個沒有承接人的待辦不會被做。**
  it('🔴 chromium 的四支 .br 壓縮包在裡面 —— 少任何一支, 這條 route 線上 ENOENT', () => {
    const br = files.filter((f) => /\.br$/.test(f));
    expect(br.length).toBe(4);
    // 逐支點名 —— 只數 4 的話, 四支換成別的四支也會過。
    for (const name of ['chromium.br', 'fonts.tar.br', 'swiftshader.tar.br', 'al2023.tar.br']) {
      expect(count(new RegExp(`@sparticuz[\\\\/]chromium[\\\\/]bin[\\\\/]${name.replace('.', '\\.')}$`)), name).toBe(1);
    }
  });

  it('📎 那四支 .br 真的在磁碟上(追到一個不存在的路徑等於沒追到)', () => {
    const br = files.filter((f) => /\.br$/.test(f));
    expect(br.length).toBe(4);
    for (const rel of br) {
      expect(existsSync(resolve(dirname(ROUTE_NFT), rel)), `追蹤清單指到一個不存在的檔:${rel}`).toBe(
        true,
      );
    }
  });

  it('🔴 那一【頁】不該被塞進這些字型(glob 收窄的守門)', () => {
    const pageNft = join(
      __dirname,
      '../../../../../../.next/server/app/account/orders/[displayId]/statement/page.js.nft.json',
    );
    const pageFiles = (JSON.parse(readFileSync(pageNft, 'utf8')).files as string[]) ?? [];
    // 正對照:那一頁的清單本身要非空(否則這個 0 沒有意義)
    expect(pageFiles.length).toBeGreaterThan(50);
    expect(pageFiles.filter((f) => /@fontsource.*woff2/.test(f)).length).toBe(0);
  });

  it('負對照:一個現造的字串必須查無(證明這把尺不是恆真)', () => {
    expect(count(/qx4m7-negctl-20260831/)).toBe(0);
  });

  it('📎 記錄:那些被追進去的檔真的在磁碟上(追到一個不存在的路徑等於沒追到)', () => {
    const dir = dirname(ROUTE_NFT);
    const sample = files.filter((f) => /@fontsource.*-400-normal\.woff2/.test(f)).slice(0, 5);
    expect(sample.length).toBe(5);
    for (const rel of sample) {
      const abs = resolve(dir, rel);
      expect(existsSync(abs), `追蹤清單指到一個不存在的檔:${rel}`).toBe(true);
      expect(statSync(abs).size).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 修法【丙】的守門(2026-09-03 `-ship`)—— 而**它必須用【解析過】的路徑,不能用字串比對**
//
// **背景**:正式站逐字 `拒絕產檔 … 內嵌 0 · 拿不到字型檔 0 · 字型套件=null`
// ⇒ `require.resolve('@fontsource/noto-sans-tc/package.json')` 在函式裡 throw。
// ⇒ 修法丙 = 讓 **app 層那棵 pnpm symlink 樹**進到追蹤清單裡(`next.config.ts` 那【四條】 `./node_modules/…`;
//   ⛔ ~~原文寫「三條」~~ —— codex R2 抓到我 R1 只改了 next.config.ts 那兩處、漏了本檔這一處),
//   因為那是 Node 從 route 往上走時找得到的位置(`.pnpm` 實體目錄**不在**解析路徑上)。
//
// 🛑🛑 **這一格的量法是踩過一次坑之後才對的 —— 那個坑值得寫在這裡:**
//    我第一版用 `/apps[\\/]storefront[\\/]node_modules/` 去 grep 那份清單 ⇒ **改前 0、改後也 0**
//    ⇒ 我差一點宣告「丙失敗、換乙」。
//    🔴 **成因:`.nft.json` 裡的路徑是【相對】的(`../../../…`)** ——
//      它們**結構上不可能**含有 `apps/storefront` 這個字面 ⇒ 那把尺在兩個世界都印 0。
//    📌 **⇒ 一把在【成功】與【失敗】都印同一個數的尺, 它的 0 不是答案。**
//    ✅ **⇒ 所以下面先 `resolve` 再比對** —— 量的是「這條路徑指到哪」, 不是「這個字串長什麼樣」。
//
// ⚠️ **本組證不到什麼(與檔頭那三句同一種)**:它答得出「Next 打算帶那棵樹」,
//    答不出「Vercel 真的帶了」, 更答不出「帶了之後 `require.resolve` 成功」。
//    🔴🔴 **丙成功的定義在正式站, 而我第一版寫錯了(codex R2, must-fix)**:
//    ⛔ ~~「那行 log 的 `字型套件` 從 `null` 變成一條路徑」~~ —— **那行 log 只在 500 分支**,
//       丙成功時 route 回 200 而**成功那條路一個字都不印** ⇒ 我的驗收條件只在失敗的世界看得到。
//    ✅ **正確的觀察值 = 那張紙本身**:真的下載到 PDF, 而且中文是【字】不是方框 □□□。
//    🛑 「log 裡不再出現 `拒絕產檔`」**不算** —— 沒有人打那條 route 時它一樣不會出現(缺席當證據)。
//    ⇒ 而**本機必然說謊** —— 本機那棵樹本來就在磁碟上, `require.resolve` 本機無論如何都會成功。
// 🔴🔴 **2026-09-03 18:40 更新:修法丙【已在正式站證偽】** —— 完整實測(部署 ID / 時刻 / 三格判別力)
//    在 `apps/storefront/next.config.ts` 那段 `🔴🔴🔴 丙已在正式站證偽` 註解裡。
//    🛑 **下面這五格【不是現行修法的守門】** —— 現行走的是【丁】(`statement-pdf.ts` 的候選鏈:
//       `require.resolve` 失敗就 cwd 相對去 pnpm store 找)。
//    ⇒ 那為什麼留著:那四條 glob 主視窗-87 裁不 revert(零行為風險 · 這五格是資產 ·
//      **revert 會讓「試過丙而它沒用」從碼裡消失, 下一個人會再試一次**)⇒ 五格跟著留。
//    ⇒ 📌 **讀到這裡的人要知道:它們綠, 【不代表】那張紙上的中文會是字。**
describe('📎 修法丙(已證偽, 保留為紀錄):app 層 node_modules 那棵樹有沒有進到追蹤清單', () => {
  const ROUTE_DIR = dirname(ROUTE_NFT);
  const APP_FONT_DIR = resolve(
    ROUTE_DIR,
    '../../../../../../../node_modules/@fontsource/noto-sans-tc',
  );
  const resolved = () => tracedFiles().map((f) => resolve(ROUTE_DIR, f));
  // 🔴 **加目錄邊界(codex R2 抓到)**:裸 `startsWith` 會把 `…/noto-sans-tc-evil/x` 也算進來
  //    ⇒ 一個同前綴的鄰居目錄可以讓下面每一格【假綠】。
  //    📎 同 `lib/print/statement-html.ts` 的 `isInsideDir` 那一格 —— **同一個坑, 這是第二次。**
  const underAppFontDir = () =>
    resolved().filter((p) => p === APP_FONT_DIR || p.startsWith(APP_FONT_DIR + sep));

  it('🟢 量具自檢:那個 app 層目錄真的在磁碟上(不在的話下面每一格都是在量一個不存在的東西)', () => {
    expect(existsSync(APP_FONT_DIR), `${APP_FONT_DIR} 不存在 ⇒ pnpm 佈局變了, 本組要重寫`).toBe(true);
  });

  it('🔴 `require.resolve` 要的那支 `package.json` 在清單裡 —— 少了它就是 `字型套件=null`', () => {
    const got = underAppFontDir().filter((p) => p.endsWith('/package.json'));
    expect(got, 'app 層的 package.json 沒被追進去 ⇒ 修法丙沒生效').toHaveLength(1);
  });

  it('🔴 解析成功之後【還要讀得到】的那些也在 —— 只放 package.json 會換來「解析成功而內嵌 0」', () => {
    const under = underAppFontDir();
    expect(under.filter((p) => p.endsWith('/400.css'))).toHaveLength(1);
    expect(under.filter((p) => p.endsWith('/700.css'))).toHaveLength(1);
    // 🔴 只問「有沒有 woff2」不夠 —— 一支也是有。這張紙要的是成批的中文子集。
    // 🔴🔴 **完整性用【磁碟實數】比, 不用寫死的門檻(codex R2 抓到)**:
    //    ⛔ ~~`>50`~~ ⇒ ⛔ ~~`>=100`~~ —— 兩個都是**寫死的數**, 而實測是 106
    //    ⇒ `>=100` 仍然允許**任意 6 支遺失而全綠**, 那會產出一張**局部缺字**的紙。
    // ✅ 改成「NFT 裡的支數 === 磁碟上該目錄實際有幾支」⇒ **少一支就紅**,
    //    而字型套件改版時兩邊一起變 ⇒ **不會變成一把每次升版都誤報的尺。**
    // 🛑 而這一格的分母是 `readdirSync` ——【磁碟】是它的真相來源, 不是我記得的 106。
    const onDisk = (suffix: string) =>
      readdirSync(join(APP_FONT_DIR, 'files')).filter((n) => n.endsWith(suffix)).length;
    for (const suffix of ['-400-normal.woff2', '-700-normal.woff2']) {
      const traced = under.filter((p) => p.endsWith(suffix)).length;
      expect(traced, `${suffix}:NFT ${traced} 支 vs 磁碟 ${onDisk(suffix)} 支`).toBe(onDisk(suffix));
      // 🔵 而「兩邊都是 0」會讓上面那格通過 ⇒ 分母自檢:磁碟上本來就該有成批的子集。
      expect(onDisk(suffix), `磁碟上 ${suffix} 是 0 ⇒ 上面那格零判別力`).toBeGreaterThan(50);
    }
  });

  it('🔵 負對照:一個現造的同層目錄必須查無(證明上面不是恆真)', () => {
    const fake = resolve(ROUTE_DIR, '../../../../../../../node_modules/@zzq9137never');
    expect(resolved().filter((p) => p.startsWith(fake))).toHaveLength(0);
  });

  it('🟢 正對照:Next 自己建的 `.next/node_modules` 入口也還在(尺對兩種形狀都會動)', () => {
    const nextOwn = resolve(ROUTE_DIR, '../../../../../../node_modules');
    expect(resolved().filter((p) => p.startsWith(nextOwn)).length).toBeGreaterThan(0);
  });
});
