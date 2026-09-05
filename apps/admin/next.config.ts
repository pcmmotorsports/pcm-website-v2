import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { assertDevDbGate } from './src/lib/dev-db-guard-gate';

// PCM 後台 admin — 純殼(M-4a M0-S1)。目前不接資料、不做登入、無 Sentry/自訂 webpack。
// 未來 slice 依需求(SSO 收端 middleware、圖片網域等)再擴,擴時走鐵則 8 重大改動 plan。
// ── 🔴🔴 出貨單 PDF 那條 route 的檔案追蹤(⟦f3-SHIPPDF1⟧ P-2, 2026-09-06)────────
//
// **為什麼需要它**:那條 route 在執行期讀三種檔 —— 版面 CSS、兩個字型套件的 CSS 與 woff2、
// 以及 chromium 的四包壓縮檔。而 Next 的靜態追蹤**只跟得上 `import` / `require`**:
//   · `require.resolve('@fontsource/…/package.json')` ⇒ 追得到(而那是【隱含行為】)
//   · `readFileSync(join(dir, '400.css'))` / `join(input,'chromium.br')` ⇒ **追不到**
// 🛑 而拉不進去的失敗形狀**本來**是最糟的那一種:**PDF 照樣產出來、HTTP 200, 而每個中文是方框**
//   ⇒ typecheck / lint / build / 單元測試**都不會紅** —— 它們不看打包清單。
// 🔵 **2026-09-06 起這句要訂正**(codex R2 nit):route 那一側加了一道中文探針閘之後,
//   「中文整包沒到」現在會**拒絕產檔回 500**, 不再是安靜的 200。
//   ⚠️ 而**那不是可以少一條 glob 的理由** —— 閘只讓失敗變吵, 它沒有把字型放進函式包。
//   少了下面這幾條, 結果從「客人拿到看不懂的紙」變成「員工按了什麼都印不出來」。
//
// 🔴🔴 **拉丁那支【兩個都要】。**
//    ⛔ ~~顧客站那一份**只有 tc** … 拉丁在顧客站的追蹤清單裡是 0 筆~~
//    🟢 **2026-09-06 訂正:顧客站補上了**(⟦ship-PRINTCARONNOTBUNDLED⟧)⇒ 那邊現在是 **19 筆**,
//      而**這四條 glob 與那邊逐字相同**(機械比過)。
//    ⇒ 📌 **後台這一側從第一天就把兩支都列上, 不複製那個洞** —— 這句仍然是本檔存在的理由。
//    ⚠️ **而兩邊【不是完全一致】**:顧客站另有四條 app 層的死 glob(本檔沒有),
//      且本檔用 `FONT_GLOBS` 單一來源 flatMap 兩支、顧客站是八行硬寫
//      ⇒ 🛑 **加第三支字型時兩邊會再分岔**, 那是一個已知缺口不是疏漏。
//
// ⚠️ **路徑基準 = app 目錄** ⇒ `../../` 就是 repo 根(同顧客站那一份的慣例)。
// ⛔ ~~**而這幾條【還沒有被量過】** …照抄形狀、尚未跑過對照~~(2026-09-06 作廢, codex R2 nit)
// ✅ **量過了**(本片 P-2 那一發 `pnpm --filter @pcm/admin build`, rc=0):
//    那條 route 的 `.nft.json` 共 **1557 檔 / 92.1 MB** ——
//    `noto-sans-tc` **215** · 拉丁 `noto-sans` **19** · chromium `.br` **4** · `print-a4.css` **2**。
//    ⚠️ 數字帶著它的時點與層級走:2026-09-06 · **本機 build 的 Next 追蹤清單**, 不是 Vercel 的 `.func`。
// 🔴 而真正在看著它的仍然是那支 tracing 守門, 不是這幾行 —— 註解不會在 glob 打錯時變紅。
// 🔴🔴 **這個 key 必須逐字等於 Next 自己給那條 route 的 id, 而 key 不匹配時 Next 是【安靜的】**
//    ⇒ 打錯一個字 = 這一整組 glob 一個檔都不帶, 而 build 全綠、`.nft.json` 照樣生得出來。
//    ✅ 守它的是 `shipping.pdf/shipping-pdf-tracing.test.ts`(它去數真的被帶進去幾支)。
// ⛔ ~~`/print/orders/\\[id\\]/shipping/\\[shipmentId\\].pdf`~~(2026-09-06 作廢)——
//    那個形狀是【動態段 + 副檔名】, 而 Next 16.3.0 把它與既有的 `[shipmentId]` 頁
//    **編成逐字相同的 regex**(`.pdf` 從 regex 裡整個消失)⇒ 兩條互相遮蔽。
//    改成靜態段 `[shipmentId]/shipping.pdf`(同顧客站 `statement.pdf` 的形狀)。詳 route.ts 檔頭。
const PDF_ROUTE = '/print/orders/\\[id\\]/shipping/\\[shipmentId\\]/shipping.pdf';
const FONT_GLOBS = ['noto-sans', 'noto-sans-tc'].flatMap((pkg) => [
  `../../node_modules/.pnpm/@fontsource+${pkg}@*/node_modules/@fontsource/${pkg}/package.json`,
  `../../node_modules/.pnpm/@fontsource+${pkg}@*/node_modules/@fontsource/${pkg}/{400,700}.css`,
  `../../node_modules/.pnpm/@fontsource+${pkg}@*/node_modules/@fontsource/${pkg}/files/*-400-normal.woff2`,
  `../../node_modules/.pnpm/@fontsource+${pkg}@*/node_modules/@fontsource/${pkg}/files/*-700-normal.woff2`,
]);

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    [PDF_ROUTE]: [
      './src/app/print/print-a4.css',
      // chromium 的四包壓縮檔 —— 它們是**執行期用字串 join 出來的路徑**, 靜態追蹤看不到
      //   ⇒ 檔不在 = 那條 route 在線上 `ENOENT`, 而 build 全綠。
      '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/*.br',
      ...FONT_GLOBS,
    ],
  },
};

// 🔴 **dev 專屬的資料庫閘。判定在 `src/lib/dev-db-guard.ts`、接線在 `src/lib/dev-db-guard-gate.ts`(皆有測試),
//    這裡只負責把 config 自己的目錄交給它。** storefront 的 next.config.ts 接同一顆。
//
// 落點為什麼是本檔(不是 `predev`、不是 `instrumentation.ts`):見 commit body(faa31274)。
// 🔴 **時序是量到的**:Next 16.3.0 `next/dist/server/config.js`
//    `:1404 loadEnvConfig(...)` 早於 `:1453 await import(<next.config>)`
//    ⇒ 本檔 evaluate 時 `.env.local` 已在 `process.env`。**反過來這道閘會恆綠。**
// ⚠️ **已知射程(codex R1)**:程式化啟動 `next({ dev: true, conf })` 會跳過本檔。
//    本 repo 2026-08-22 實查**沒有** custom server(`apps/*/server.*` 不存在、無程式化啟動)
//    ⇒ 今天不可達;有人日後加 custom server 時,本閘會安靜失效 ——
//    但 proxy.ts 的 DB 本機條件(R2 ⑤)跑在 app 層、任何啟動路徑都經過,補掉其中 auth 那一半。
//
// 🔴 **目錄用 config 檔自己的位置,不用 `process.cwd()`(R2 MF-1)**:
//    Next 載 .env* 的基準是專案目錄(= 本檔所在目錄),cwd 只是「人從哪裡打指令」——
//    兩者不同時(如 `next dev apps/admin` 從 repo 根跑),讀 cwd 會把檔面的逃生門誤判成指令列的。
//    ⚠️ 2026-08-23 量到:今天那種調用因 legacy TS-config loader 的相對 import 解析 bug 而
//    fail-safe 崩潰(Cannot find module),本行護的是未來 loader 修好之後的世界。
//    `import.meta.dirname` 在 Next 的 SWC-CJS 轉譯路徑量測過存在(2026-08-23 探針);
//    `??` 後備給只保證 `import.meta.url` 的載入器(vitest / vite-node)。
const CONFIG_DIR = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) assertDevDbGate(CONFIG_DIR);
  return nextConfig;
}
