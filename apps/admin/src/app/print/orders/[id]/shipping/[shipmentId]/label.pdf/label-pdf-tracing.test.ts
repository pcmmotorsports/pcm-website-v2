// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 標籤那條 route 的**打包清單**守門。⟦ship-HCTLABELCAPTURE⟧ 片 D2。
//
// 🔴🔴 **它為什麼存在(2026-09-06 code-reviewer 量出來, 而我原本沒有加這道)**:
//    `htmlToPdf` 走 `@sparticuz/chromium`, 而那幾包 `.br` 的路徑是**執行期字串 join 出來的**
//    ⇒ **靜態追蹤看不到** ⇒ 沒有在 `next.config.ts` 明寫的話, 它們一支都不會進函式包。
//    🛑 而那個世界裡:`pnpm build` rc=0、三綠全綠、`.nft.json` 照樣生得出來,
//      **只有線上真的去產一份 PDF 的那一刻才會 `ENOENT`。**
//    🔬 加 key 之前的兩個讀數:`label.pdf` 的 `.br` = **0** / `shipping.pdf` = **4**。
//
// 🔴🔴 **而「有幾支」不是判準, 【是哪幾支】才是**(codex 2026-09-06 R1 must-fix):
//    ⛔ ~~`expect(br.length).toBeGreaterThan(0)`~~ —— 那個形狀**只要有一支就綠**,
//      而 `@sparticuz/chromium` 執行期會逐支 `inflate()`:`chromium.br` / `fonts.tar.br` /
//      `swiftshader.tar.br`(AL2023 再加 `al2023.tar.br`)。
//      ⇒ 📌 **把 glob 改成只指 `chromium.br`, 舊的那一格照樣綠, 而線上照樣 `ENOENT`。**
//    ✅ 改成核對**檔名集合**, 而集合的來源是**磁碟上那個目錄真的有什麼** —— 不是我背出來的清單。
//
// ⚠️ **射程(照實寫)**:它讀的是 Next 自己的追蹤清單 `*.nft.json`,
//    那**不是** Vercel 實際打包的 `.func` ⇒ 它答得出「Next 打算帶哪些檔」,
//    **答不出「Vercel 真的帶了」, 更答不出「那份 PDF 產得出來」**(那要線上有人打一次)。
const ROUTE_DIR = join(__dirname);
const APP_DIR = join(ROUTE_DIR, '../../../../../../../..');
const SHIPPING_DIR = join(ROUTE_DIR, '../shipping.pdf');
const nftOf = (seg: string) =>
  join(APP_DIR, `.next/server/app/print/orders/[id]/shipping/[shipmentId]/${seg}/route.js.nft.json`);
const NFT = nftOf('label.pdf');
const NFT_SHIPPING = nftOf('shipping.pdf');

/** 清單比它守的原始碼舊 ⇒ **當場紅**(不是 `console.warn` —— warn 不會讓任何一格紅)。 */
function assertFresh(nft: string, routeTs: string): void {
  expect(existsSync(nft), `${nft} 不存在 ⇒ 先跑 TURBO_FORCE=1 pnpm --filter @pcm/admin build`).toBe(true);
  const guarded = [
    // 🔴 **每一份清單要拿【它自己那支 route.ts】驗新鮮度**(codex 2026-09-06 R1 nit)——
    //    原本兩份都拿 label 的那支 ⇒ 出貨單那個正對照可能讀到過期的 NFT 而照樣綠。
    routeTs,
    // 🔴 那組 glob 住在 next.config ⇒ 改了它而沒重 build, 下面每一格拿的是舊清單
    //    ⇒ **一把守門沒把「會改變它答案的那支檔」放進新鮮度清單, 它守不住自己。**
    join(APP_DIR, 'next.config.ts'),
  ];
  // 🔴 **少一條就要出聲, 不可以靜默變短**(`.filter(existsSync)` 那個形狀只擋「全部消失」)。
  for (const g of guarded) {
    expect(existsSync(g), `新鮮度清單裡的 ${g} 不存在 ⇒ 這道守門的分母是假的, 回來修清單`).toBe(true);
  }
  const newest = Math.max(...guarded.map((g) => statSync(g).mtimeMs));
  expect(
    statSync(nft).mtimeMs >= newest,
    `${nft} 比它守的原始碼舊 ⇒ 下面每一格拿的是上一次 build 的答案。` +
      '先跑 `TURBO_FORCE=1 pnpm --filter @pcm/admin build` 再看。',
  ).toBe(true);
}

const traced = (nft: string): string[] =>
  (JSON.parse(readFileSync(nft, 'utf8')) as { files: string[] }).files;
const brNames = (nft: string): string[] =>
  [...new Set(traced(nft).filter((f) => f.endsWith('.br')).map((f) => f.split('/').pop() ?? ''))].sort();

/** 磁碟上那個套件的 `bin/` 真的有哪幾包 —— **分母來自磁碟, 不是我背的清單**。 */
function brOnDisk(): string[] {
  const pnpm = join(APP_DIR, '../../node_modules/.pnpm');
  const dir = readdirSync(pnpm).find((d) => d.startsWith('@sparticuz+chromium@'));
  expect(dir, '磁碟上找不到 @sparticuz/chromium ⇒ 本檔的分母是假的').toBeTruthy();
  const bin = join(pnpm, dir!, 'node_modules/@sparticuz/chromium/bin');
  return readdirSync(bin).filter((f) => f.endsWith('.br')).sort();
}

describe('label.pdf 的打包清單', () => {
  it('chromium 的每一包 .br 都在(比【集合】, 不是比個數)', () => {
    assertFresh(NFT, join(ROUTE_DIR, 'route.ts'));
    const want = brOnDisk();
    expect(want.length, '磁碟上一包 .br 都沒有 ⇒ 本格恆真, 回來看那個套件裝好了沒').toBeGreaterThan(0);
    // 🔴 訊息要指向**成因**:這一格紅起來的原因幾乎一定是 next.config 那個 key 或 glob 不對,
    //    而 **key 不匹配時 Next 是安靜的** —— build 不會有任何一行字提到它。
    expect(
      brNames(NFT),
      '這條 route 的清單少了某幾包 .br ⇒ 線上 htmlToPdf 會 ENOENT, 而本機三綠全綠。' +
        '先看 next.config.ts 的 LABEL_ROUTE 那個 key 與 CHROMIUM_GLOB。',
    ).toEqual(want);
  });

  it('正對照:出貨單那條也帶了同一組(證明這把尺在別的 route 上也讀得到東西)', () => {
    assertFresh(NFT_SHIPPING, join(SHIPPING_DIR, 'route.ts'));
    expect(brNames(NFT_SHIPPING)).toEqual(brOnDisk());
  });

  // 🔵 **負對照 = 一個【磁碟上真的有、而我們刻意沒有放進這個 key】的東西**:字型。
  //    這條 route 零文字 ⇒ 不需要字型 ⇒ 它們不該在清單裡。
  //    ⇒ 📌 它證明上面那個集合斷言**不是「什麼都會過」** ——
  //      這條 route 的 key 是有選擇性的, 不是把整個 node_modules 掃進來。
  it('負對照:字型【不】在這條 route 的清單裡(而它們在出貨單那條裡)', () => {
    assertFresh(NFT, join(ROUTE_DIR, 'route.ts'));
    assertFresh(NFT_SHIPPING, join(SHIPPING_DIR, 'route.ts'));
    const woff = (nft: string) => traced(nft).filter((f) => f.endsWith('.woff2')).length;
    expect(woff(NFT_SHIPPING), '出貨單那條也沒有字型 ⇒ 本格的分母是假的, 換一個對照').toBeGreaterThan(0);
    expect(woff(NFT), 'label.pdf 帶進了字型 ⇒ 這個 key 收得比它需要的多').toBe(0);
  });
});
