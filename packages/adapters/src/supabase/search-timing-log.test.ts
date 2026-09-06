// @vitest-environment node
//
// ⏱️ **釘住那幾行計時 log 存在** —— 板列 `⟦search-TRGMEXPRIDX⟧`。
//
// 🔴 **為什麼要一格測試守一行 log**:它是**量具**, 不是功能 ——
//    功能壞了客人會叫, 而**量具被刪掉沒有任何人會叫**, 下一個查「那 3.7 秒在哪」的人
//    只會看到一片安靜, 而那與「量到了、沒有慢」印同一個東西。
//
// 🔴🔴 **兩支檔一起釘, 而那是 code-reviewer R1 的 must-fix**:
//    adapter 那一層只量得到 route `Promise.all` **四條腿裡的一條**
//    ⇒ 只釘 adapter 會讓「不在 DB」被讀成「不在伺服器」。
//
// ⛔ **本檔證不到什麼(逐條寫, 不要讓全綠被讀成「線上真的在印」)**:
//    · 它讀的是**原始碼字面**, 不是跑起來 ⇒ 證得了「那行還在」, 證不了「線上印得出來」,
//      也證不了那些毫秒數是對的。
//    · 🛑 **三種改法會讓它綠著卻不印**:①整段包進 `if (process.env.X)`
//      ②搬進一個沒人呼叫的 helper ③換成一個 prod 會濾掉的 logger。
//      **①②本檔擋不到**;③靠下面的 `console.info(` 計數擋得到 —— **只擋得到 ③, 不要當成擋住三種。**

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ADAPTER = new URL('./SupabaseProductAdapter.ts', import.meta.url);
const ROUTE = new URL(
  '../../../../apps/storefront/src/app/api/search/route.ts',
  import.meta.url,
);
const PRODUCTS = new URL('../../../../apps/storefront/src/lib/products.ts', import.meta.url);

/** 剝掉註解 —— 🔴 少了它, 一行【被註解掉的】log 會被算成還在。 */
function stripComments(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function countInfo(code: string): number {
  return (code.match(/console\.info\(/g) ?? []).length;
}

describe('搜尋那條路的計時量具', () => {
  const adapter = stripComments(readFileSync(ADAPTER, 'utf8'));
  const route = stripComments(readFileSync(ROUTE, 'utf8'));

  it('🔴 adapter:三條 return 路徑各一行, 一條都不能少', () => {
    // 🔵 先證這把尺接上了 —— 抓不到函式本身的話下面在量一個不相干的檔。
    expect(adapter, '找不到 searchByKeyword ⇒ 這一格沒有判別力').toContain(
      'async searchByKeyword(',
    );
    // 🛑 `rpc-empty` 是 R1 抓到的那一格:0 筆的搜尋【本來一行都不印】,
    //    而「沒有 log」與「這條路很快」長一樣 —— 那正是本片要防的病。
    for (const path of ['path=rpc', 'path=rpc-empty', 'path=legacy']) {
      expect(adapter, `${path} 不見了 ⇒ 那條路線上就再也量不到`).toContain(path);
    }
    // 🔴🔴 **2026-09-07:從 3 改成 4, 而【那不是把守門調鬆】—— 本格的前提換了。**
    //   ⛔ ~~`.toBe(3)`~~ ⇒ 本格原本的前提是「`console.info` 的行數 == return 路徑數」,
    //   而 `⟦search-RPC1000FALLBACK⟧` 加的第 4 行**不是一條 return 路徑** ——
    //   它是 `trySearchIdsWithBrand` 裡的一行資訊(`v2 total=… > ids=… ⇒ 已由 RPC 端 LIMIT 截斷`),
    //   印完**繼續往下走**。⇒ 📌 **前提壞掉的那一刻, 這個數字就不再代表它的標籤在說的東西。**
    //   ✅ 所以下面**另外把那四行各自釘住**:少了數量對不上會紅, 而**改錯內容也會紅**
    //     —— 只比數量的話, 「拿掉 rpc-empty 那行 + 加一行別的」是全綠的。
    expect(countInfo(adapter), 'console.info 的行數變了 ⇒ 有人加了或拿掉了一條路').toBe(4);
    expect(
      adapter,
      '截斷那行不見了 ⇒ 「上游截了幾筆」在 log 裡沒有形狀, 而客人看到的件數與清單會對不上',
    ).toContain('已由 RPC 端 LIMIT 截斷');
  });

  it('🔴 route:四條腿各自要有數字, 否則只量得到其中一條', () => {
    expect(route, '找不到那發 Promise.all ⇒ 這一格沒有判別力').toContain('Promise.all([');
    for (const leg of ['products=', 'brands=', 'categories=']) {
      expect(route, `${leg} 不見了 ⇒ 那條腿變回零儀器`).toContain(leg);
    }
    // 🔴🔴 **車款那一腿 2026-09-05 從搜尋這條路上拿掉了**(`⟦search-TRGMEXPRIDX⟧`)——
    //    量到它佔 route total 的 92%(冷 11.8~12.6 秒), 而這條路上沒有人畫它。
    //    ✅ **而 log 裡那個欄位【留著】, 值改成 `skipped`** ——
    //       直接刪掉的話, 讀 log 的人分不出「這一腿很快」與「這一腿根本沒跑」。
    //    🛑 所以這一格釘的是 `vehicles=skipped` **這個字面**, 不是 `vehicles=` 前綴:
    //       有人把它改回去撈, 這一格會紅 ⇒ 而那正是我要他停下來讀板列的時候。
    expect(route, 'vehicles=skipped 不見了 ⇒ 有人把那一腿加回搜尋了, 先讀 ⟦search-TRGMEXPRIDX⟧').toContain(
      'vehicles=skipped',
    );
    expect(countInfo(route)).toBe(1);
  });

  it('🔴 兩支都要用 performance.now(), 不要 Date.now()', () => {
    // 🛑 `Date.now()` 是牆鐘、**非單調** —— NTP 校時會讓它倒退 ⇒ 量時距會出現負數。
    for (const [name, code] of [
      ['adapter', adapter],
      ['route', route],
    ] as const) {
      expect(code, `${name} 沒有用 performance.now()`).toContain('performance.now()');
    }
  });

  it('🔴 車款清單那支:冷的時候要印一行, 而它必須在 unstable_cache 的【內側】', () => {
    // 🔴🔴 **這一行的存在【就是】「這一發是冷的」那個判準**(`⟦search-VEHTAXSLOW⟧`)——
    //    寫在外側的話它每一發都印 ⇒ **冷暖就再也分不出來**, 而那正是我們要量的東西。
    // 🛑 **這一支【不能】用上面那個 `stripComments`** —— 我試過, 它把整檔吃成空白:
    //    `products.ts` 裡有 `/*` 出現在字串/URL 裡, 而那個粗暴的區塊註解 regex 會從那裡
    //    一路吞到下一個 `*/`。⇒ 📌 **一把在別的檔上好用的尺, 換一個檔就可能整個壞掉**,
    //    而它壞掉的樣子是「什麼都找不到」= 與「那一行真的不見了」**印同一個紅**。
    // ✅ 改法:讀原文, 而**逐行**確認那一行不是被 `//` 註解掉的。
    const productsRaw = readFileSync(PRODUCTS, 'utf8');
    // 🔴 **釘的是 `'[vehicleTaxonomy] cold '` 不含 `pages=`**(2026-09-06 改 RPC 之後)——
    //   ⛔ ~~`'[vehicleTaxonomy] cold pages='`~~ 那個受詞已經沒有了:一發拿完, **沒有「頁」這個東西**。
    //   🎯 **而這一格的【意圖】一個字都沒變**:那一行的存在就是「這一發是冷的」那個判準。
    //     ⇒ 📌 **釘意圖不釘實作** —— 釘到 `pages=` 等於把「怎麼拿資料」也一起釘死了。
    const liveLine = productsRaw
      .split('\n')
      .find((ln) => ln.includes('[vehicleTaxonomy] cold ') && !ln.trimStart().startsWith('//'));
    expect(liveLine, '[vehicleTaxonomy] 那一行不見了(或被註解掉了)⇒ 冷暖就再也看不到').toBeTruthy();
    // 🔵 **新約定:那一行必須帶 `n=`** —— 它是「這一發拿到幾列」, 而少了它, 一行只印 `cold ms=…`
    //   的 log 分不出「快取沒中」與「拿到一份空的」。
    expect(liveLine, 'n= 不見了 ⇒ 冷的那一發拿到幾列就看不到了').toContain('n=');
    // ⛔⛔ **[主詞已消失 · 2026-09-06]** 這裡原本釘 `first=` 與 `restAvg=`:
    //   ~~它們要回答「那 945ms/頁 的固定成本住在【第一發】還是【每一發】」~~
    //   🔴 **改成一發 RPC 之後, 那個問題【不存在了】** —— 只有一次往返, 沒有「之後那幾頁」可以比。
    //   🛑 **所以這兩個釘樁不是過期, 是它們問的那件事被解決掉了** ——
    //     ⇒ 不改成別的字面(改了會變成為了讓測試有事做而發明一個問題)。
    //   📎 那兩個數當時的讀數與結論留在 `products.ts` 的 `[已作廢]` 標頭裡。
    const products = productsRaw;
    expect(products, '找不到那支 cached loader ⇒ 這一格沒有判別力').toContain(
      'const getVehicleTaxonomyCached = unstable_cache(',
    );
    // 🛑 釘「它在內側」:那一行必須出現在 `unstable_cache(` 之後、而且在同一個 call 的參數裡
    //    —— 用「它在那個 cache key 之前」來釘(那是該 call 的第二參數)。
    //   🔵 **key 的版本號【不寫死在這裡】**(2026-09-06):它 v3 → v4 換過一次, 而**換鍵是正常維護**
    //     ⇒ 寫死版本號會讓一個正確的改動紅在一個與它無關的斷言上。⇒ 用前綴比對。
    const openIdx = products.indexOf('const getVehicleTaxonomyCached = unstable_cache(');
    const logIdx = products.indexOf('[vehicleTaxonomy] cold ');
    const keyIdx = products.indexOf("['vehicle-taxonomy-v");
    expect(keyIdx, '找不到那個 cache key ⇒ 這一格沒有判別力').toBeGreaterThan(0);
    expect(logIdx > openIdx && logIdx < keyIdx, '那一行跑到 unstable_cache 外面了 ⇒ 每發都印 ⇒ 冷暖分不出來').toBe(
      true,
    );
  });

  it('🔵 負對照:這把尺在【該說沒有】的時候會說沒有', () => {
    // 🛑 少了這一格, 一個永遠回 true 的 toContain 會讓上面在兩個世界都綠。
    expect(stripComments('// path=rpc')).not.toContain('path=rpc');
    expect(countInfo(stripComments('// console.info(x)'))).toBe(0);
    expect(adapter).not.toContain('path=這個字串不存在');
  });
});
