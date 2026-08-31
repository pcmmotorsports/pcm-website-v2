// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
// 🔴 **而它守的其實是一個【隱含行為】**:那些字型檔進得去,是因為 route 裡的
//    `require.resolve('@fontsource/noto-sans-tc/package.json')` 讓追蹤器把整包拉了進來
//    (2026-08-31 實測 1,977 檔 / 65.07 MB;`next.config.ts` 那四條 glob 是安全帶,
//     而拿掉其中一條重 build ⇒ 數字一模一樣 ⇒ 今天真正生效的是前者)。
//    ⇒ 那個行為哪天變了,**這一格就是唯一會叫的東西**。

const ROUTE_NFT = join(
  __dirname,
  '../../../../../../.next/server/app/account/orders/[displayId]/statement.pdf/route.js.nft.json',
);

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
