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
