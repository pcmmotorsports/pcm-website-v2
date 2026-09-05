// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

// 後台出貨單 PDF 那條 route 的守門:**它執行時要讀的那些檔, 到底有沒有在函式包裡。**
//
// ══ 🔴 為什麼需要它 ═══════════════════════════════════════════════════════
// 這一族踩過的坑, 形狀是**只在正式環境發生的豆腐字**:
//   本機 ⇒ 檔就在磁碟上 ⇒ 讀得到 ⇒ 中文正常 ⇒ **完全正常**
//   線上 ⇒ 檔沒被打包進函式 ⇒ 讀不到 ⇒ **PDF 照樣產出來、HTTP 200,而每個中文是方框**
// ⇒ 而 `typecheck` / `lint` / `build` / 任何單元測試**都不會紅** —— 它們不看打包清單。
//
// 🔴🔴 **而後台這一側【預設就是壞的】** —— 顧客站那 215 筆字型是
//    `next.config.ts` 的 glob 供應的, **不是 `require.resolve` 帶進來的**(P-1 量到)。
//    後台是另一個 app、另一條 route ⇒ 沒補 glob 就是那個狀態。本檔守的就是那組 glob。
//
// ⚠️ **射程(照實寫)**:它讀的是 Next 自己的檔案追蹤清單(`*.nft.json`),
//    那**不是** Vercel 實際打包的 `.func`。⇒ 它答得出「Next 打算帶哪些檔」,
//    答不出「Vercel 真的帶了」, **更答不出「那張紙上的中文是字」**。後者要真部署後有人打開看。
const ROUTE_DIR = join(__dirname);
const NFT = join(
  ROUTE_DIR,
  '../../../../../../../../.next/server/app/print/orders/[id]/shipping/[shipmentId]/shipping.pdf/route.js.nft.json',
);

/** 這一族踩過:守門對著**舊產物**全綠。
 *
 * 🔴🔴 **原本這裡只 `console.warn`**(codex R1 must-fix-4)—— 而 warn **不會讓任何一格紅**
 *    ⇒ 刪掉那組 glob、或把 `PDF_ROUTE` 那個 key 打錯一個字, 只要沒重 build,
 *      下面每一格照樣拿上一次的 NFT 全綠。**那正是這支守門存在要防的那件事本身。**
 *    ✅ 改成硬斷言:清單比它守的原始碼舊 ⇒ 當場紅, 訊息直接給重 build 的指令。 */
function stalenessNote(): string | null {
  if (!existsSync(NFT)) return null;
  const nftAt = statSync(NFT).mtimeMs;
  const guarded = [
    join(ROUTE_DIR, 'route.ts'),
    // 🔴 那組 glob 住在 next.config ⇒ 改了它而沒重 build, 下面每一格拿的是舊 NFT
    //    ⇒ 一把守門沒把「會改變它答案的那支檔」放進新鮮度清單 ⇒ 它守不住自己。
    join(ROUTE_DIR, '../../../../../../../../next.config.ts'),
    join(ROUTE_DIR, '../../../../../../print/print-a4.css'),
    // 🔵 `.nft.json` 是這條 route 的 import 圖決定的 ⇒ 它 import 到的東西也要進清單
    //    (code-reviewer R3:與 R1 must-fix-4 同型 —— 會改變它答案的檔沒進來)。
    join(ROUTE_DIR, '../../../../../../../../../packages/pdf/src/index.ts'),
    join(ROUTE_DIR, '../../../../../../../../../packages/pdf/src/html.ts'),
    join(ROUTE_DIR, '../../../../../../../components/print/shipping-doc.tsx'),
  ].filter((p) => existsSync(p));
  if (guarded.length === 0) return null;
  const newest = Math.max(...guarded.map((p) => statSync(p).mtimeMs));
  if (newest <= nftAt) return null;
  return `⚠️ 這份追蹤清單比它守的原始碼舊 ${Math.round((newest - nftAt) / 60_000)} 分鐘 ⇒ 下面每一格驗的是【上一次 build】那個世界。要驗現在這份 ⇒ 先跑 \`TURBO_FORCE=1 pnpm --filter @pcm/admin build\``;
}

function tracedFiles(): string[] {
  const d = JSON.parse(readFileSync(NFT, 'utf8')) as { files: string[] };
  const base = dirname(NFT);
  return d.files.map((f) => resolve(base, f));
}

/** 解析 `@fontsource/<pkg>` 的實體目錄(pnpm 把真檔放在 `.pnpm` 底下, symlink 只是連結)。 */
function fontDir(pkg: string): string | null {
  // 🔵 **10 層**到 repo 根:shipping.pdf → [shipmentId] → shipping → [id] → orders → print
  //    → app → src → admin → apps。
  //    ⛔ 病史留著:第一版寫 8 層(當時路徑少一段, 正解是 9)⇒ 落在 `apps/node_modules/.pnpm`
  //      (不存在)⇒ 兩格當場紅, 而它們紅的理由是「解析不到目錄」——
  //      **那正是那一格自檢在防的事**, 所以它是【對的紅】不是壞掉。
  const store = join(ROUTE_DIR, '../../../../../../../../../../node_modules/.pnpm');
  if (!existsSync(store)) return null;
  // 🔵 `.sort()` 不是裝飾:同套件多版本並存時 `readdirSync` 的順序不決定性
  //    ⇒ 分母會隨機換一份(`packages/pdf/src/index.ts` 那支也是明寫 sort 才決定性)。
  const hit = readdirSync(store)
    .sort()
    .find((n) => n.startsWith(`@fontsource+${pkg}@`));
  if (hit === undefined) return null;
  const d = join(store, hit, 'node_modules', '@fontsource', pkg);
  return existsSync(d) ? d : null;
}

describe('後台出貨單 PDF:那條 route 的函式包裡有沒有它要讀的檔', () => {
  it('🔴 前提:那份追蹤清單存在(不在 ⇒ 下面每一格都是在量一個不存在的東西)', () => {
    expect(existsSync(NFT), `${NFT} 不存在 ⇒ 先 build`).toBe(true);
    expect(stalenessNote(), '追蹤清單過期 ⇒ 下面每一格驗的是上一次 build 那個世界').toBeNull();
  });

  it('🔴 版面 CSS 在清單裡 —— 少了它那條 route 會拒絕產檔(pageCss === null)', () => {
    // 🔴 **連路徑一起問**(codex R1 nit):只比檔名尾端的話, 任何一支同名 CSS 都能讓它綠,
    //    而那條 route 讀的是 `apps/admin/src/app/print/print-a4.css` 那一支。
    const want = resolve(ROUTE_DIR, '../../../../../../print/print-a4.css');
    const hit = tracedFiles().filter((p) => p === want);
    expect(hit.length, `追蹤清單裡沒有 ${want}`).toBeGreaterThan(0);
  });

  it('🔴 chromium 那四包壓縮檔在清單裡 —— 少了它線上是 ENOENT, 而 build 全綠', () => {
    // 它們是【執行期用字串 join 出來的路徑】, 靜態追蹤看不到 ⇒ 只能靠 glob。
    // 🔴 **逐檔名問, 不只數支數**(codex R1 must-fix-6):只斷言「恰好四支 .br」的話,
    //    少了 `chromium.br` 而多混進一支無關的 `.br` ⇒ 依然是 4 ⇒ 假綠。
    const br = tracedFiles().filter((p) => p.endsWith('.br'));
    for (const name of ['chromium.br', 'al2023.tar.br', 'fonts.tar.br', 'swiftshader.tar.br']) {
      expect(br.filter((p) => p.endsWith(`${sep}${name}`)).length, `清單裡沒有 ${name}`).toBe(1);
    }
    expect(br.length, `.br 共 ${br.length} 支(預期恰好那四支)`).toBe(4);
  });

  // 🔴🔴 **兩支字型【各自】問。**
  //    ⛔ ~~顧客站那支守門只問了 tc 那一支, 而拉丁那支在那邊追蹤到 0 筆~~
  //    🟢 **2026-09-06 訂正:那兩句現在都是假的**(⟦ship-PRINTCARONNOTBUNDLED⟧ 那顆修掉了)——
  //      顧客站現在拉丁那支有 5 格在問, 追蹤到 **19 筆**。
  //    ⇒ 📌 **保留這一段是因為它記著【本檔為什麼從第一天就兩支都問】**:
  //      當時顧客站確實只守一支, 而「補了一格卻漏掉真正沒被守的那一支」是這一族的母題。
  //    🛑 **而它過期這件事本身值得留在這裡**:一句用來解釋自己存在理由的註解,
  //      在【別的 app】被修好的那一天會變成假的, 而**這一支檔的三綠不會有任何反應**。
  for (const pkg of ['noto-sans', 'noto-sans-tc']) {
    it(`🔴 ${pkg}:400/700 的 woff2 支數 = 磁碟實數(少一支就紅)`, () => {
      const dir = fontDir(pkg);
      expect(dir, `解析不到 @fontsource/${pkg} 的實體目錄 ⇒ 本格在量一個不存在的東西`).not.toBeNull();
      const traced = tracedFiles().filter((p) => p.startsWith(dir! + sep));
      const onDisk = (suffix: string) =>
        readdirSync(join(dir!, 'files')).filter((n) => n.endsWith(suffix)).length;
      for (const suffix of ['-400-normal.woff2', '-700-normal.woff2']) {
        const n = traced.filter((p) => p.endsWith(suffix)).length;
        expect(n, `${pkg}${suffix}:清單 ${n} 支 vs 磁碟 ${onDisk(suffix)} 支`).toBe(onDisk(suffix));
        // 🔵 兩邊都是 0 會讓上面那格通過 ⇒ 分母自檢。
        expect(onDisk(suffix), `磁碟上 ${pkg}${suffix} 是 0 ⇒ 上面那格零判別力`).toBeGreaterThan(0);
      }
      // `400.css` / `700.css` 也要在 —— 只放 woff2 會換來「解析成功而內嵌 0」。
      for (const css of ['400.css', '700.css']) {
        expect(traced.filter((p) => p.endsWith(`${sep}${css}`)).length, `${pkg}/${css} 不在清單裡`).toBe(1);
      }
    });
  }

  // 🔴🔴 **這一格是 codex R1 must-fix-1 的那個突變的唯一死法。**
  //    第一版路徑是 `shipping/[shipmentId].pdf/route.ts`(動態段 + 副檔名)⇒ Next 16.3.0 把它
  //    與既有的 `[shipmentId]` 頁編成**逐字相同的 regex**, `.pdf` 從 regex 裡整個消失、兩條互相遮蔽。
  //    🛑 而那個世界裡:`pnpm build` 綠、三綠綠、`.nft.json` 生得出來、**上面每一格都綠**。
  //    ⇒ 📌 上面問的是「檔有沒有被帶進去」, **沒有一格在問「這條網址打不打得到」**。
  it('🔴 這條 .pdf 路由有自己的 regex —— 沒有跟既有那張列印頁撞在一起', () => {
    const manifest = join(ROUTE_DIR, '../../../../../../../../.next/routes-manifest.json');
    expect(existsSync(manifest), `${manifest} 不存在 ⇒ 先 build`).toBe(true);
    const routes = (
      JSON.parse(readFileSync(manifest, 'utf8')) as {
        dynamicRoutes: { page: string; regex: string }[];
      }
    ).dynamicRoutes;
    const byPage = (page: string) => routes.filter((r) => r.page === page);
    const pdf = byPage('/print/orders/[id]/shipping/[shipmentId]/shipping.pdf');
    const page = byPage('/print/orders/[id]/shipping/[shipmentId]');
    expect(pdf.length, '這條 .pdf 路由不在 routes-manifest 裡').toBe(1);
    expect(page.length, '既有那張列印頁不在 routes-manifest 裡 ⇒ 本格的分母是假的').toBe(1);
    expect(pdf[0]!.regex, '兩條路由的 regex 相同 ⇒ 它們互相遮蔽').not.toBe(page[0]!.regex);
    // 🔵 正對照:`.pdf` 這一段真的活在 regex 裡(不是只是「兩條剛好不一樣」)。
    expect(pdf[0]!.regex).toContain('shipping\\.pdf');
  });

  // ⛔ ~~負對照 = 一個現造的套件名必須查無~~(2026-09-06 作廢, code-reviewer R3)——
  //    那個目錄根本不存在 ⇒ **守門成立與守門壞掉兩個世界它都印 0** ⇒ 它證不到任何事。
  // ✅ 改成問一個【磁碟上真的有、而我們刻意沒有放進 glob】的東西:`500` 字重。
  //    磁碟 > 0 而清單 = 0 ⇒ 證明上面那些 `toBe(onDisk)` 不是「什麼都會過」。
  it('🔵 負對照:磁碟上有而 glob 沒收的字重(500)必須不在清單裡', () => {
    const dir = fontDir('noto-sans-tc');
    expect(dir, '解析不到目錄 ⇒ 本格零判別力').not.toBeNull();
    const onDisk = readdirSync(join(dir!, 'files')).filter((n) => n.endsWith('-500-normal.woff2')).length;
    expect(onDisk, '磁碟上沒有 500 字重 ⇒ 本格是恆真的, 換一個沒被 glob 收的東西').toBeGreaterThan(0);
    const traced = tracedFiles().filter((p) => p.endsWith('-500-normal.woff2'));
    expect(traced, `磁碟 ${onDisk} 支 500 字重, 而清單裡有 ${traced.length} 支 —— glob 只收 400/700`).toHaveLength(0);
  });
});
