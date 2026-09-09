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
    // 🔴🔴 **2026-09-07:改成數【`path=` 那三行】, 而那【不是把守門調鬆】—— 是把它對準它自己的標籤。**
    //   ⛔ ~~`expect(countInfo(adapter)).toBe(3)`~~ 數的是**整支檔的 `console.info` 總數**,
    //   而它的標籤說的是「**三條 return 路徑**各一行」。那兩件事在 2026-09-07 之前剛好相等,
    //   ⇒ 📌 **一個靠巧合成立的等式** —— `⟦search-RPC1000FALLBACK⟧` 在 `trySearchIdsWithBrand`
    //     加了一行 `range 超界 ⇒ 當空頁` 的資訊(**另一個函式、不是 `searchByKeyword` 的 return 路徑**),
    //     它就紅了, 而訊息說「有人加了或拿掉了一條路」—— **那句話是錯的。**
    // ✅ 改成直接數那三個 `path=` 標籤:少一條會紅, **而在別處加一行資訊不會誤報**。
    const pathLines = (adapter.match(/path=(rpc-empty|rpc|legacy)/g) ?? []).length;
    expect(pathLines, '三條 return 路徑的 `path=` 標籤少了一個 ⇒ 那條路線上再也量不到').toBe(3);
    // 🔵 而總數仍然釘住, 只是改成「至少三條」+ 逐條列出今天有哪些, 讓新增一行**要有人明寫**。
    expect(countInfo(adapter), 'console.info 少於三行 ⇒ 一定有 path 沒印').toBeGreaterThanOrEqual(3);
    expect(
      adapter,
      'range 超界那行不見了 ⇒ 深分頁超界會掉進 throw ⇒ 整個搜尋 503(2026-09-03 那次的形狀)',
    ).toContain('range 超界');
  });

  it('🔴 route:四條腿各自要有數字, 否則只量得到其中一條', () => {
    expect(route, '找不到那發 Promise.all ⇒ 這一格沒有判別力').toContain('Promise.all([');
    for (const leg of ['products=', 'brands=', 'categories=', 'vehicles=']) {
      expect(route, `${leg} 不見了 ⇒ 那條腿變回零儀器`).toContain(leg);
    }
    // 🔴🔴 **[2026-09-09 · 這一格【咬到了它要咬的那件事】, 而答案是「放行」—— 留痕]**
    //   ⛔ ~~`expect(route).toContain('vehicles=skipped')`~~
    //   🛑 它原本釘的是字面 `vehicles=skipped`,訊息逐字寫著「有人把那一腿加回搜尋了,
    //      先讀 ⟦search-TRGMEXPRIDX⟧」⇒ 📌 **它照設計紅了,而讀完板列之後的結論是【該加回來】。**
    //   ✅ **兩個理由,兩個都不是「我想加」**:
    //     ① **Sean 2026-09-09 自己重開 2026-09-04 那板、拍【甲 = 打開車款區】** ——
    //        他看到「沒有找到 rsv4」逐字問「為何不是直接模糊搜尋 RSV4 可能出現結果」。
    //        ⇒ 那一腿被拿掉的前提逐字是「**這條路上沒有人畫它**」,而**那個前提今天不成立了**。
    //     ② 那 92% / 冷 11.8~12.6 秒是 `6c075c294`(09-05)量的,而**隔天** `a5f0cce12`(09-06)
    //        「車輛樹改一發 RPC —— 13 次往返變 1 次」把那個 13 頁 OFFSET 循序迴圈換掉了。
    //   🔬 **2026-09-09 本窗實測(鑽機 localhost:3020,不是引註解)**:
    //        暖 `vehicles=` **1 / 1 / 2 ms**;隔 70 秒等快取過期各打一發 ⇒ **2 / 2 / 44 ms**
    //        (最貴那發 route total 234ms)。資料源本身直打 PostgREST **23 / 9 / 21 ms**、DB 內 **2.0 ms**。
    //   ⚠️ **而那些數字【不能拿去說正式站也這麼快】** —— 鑽機只有 **3 台車 / 2 個廠牌**,
    //      正式庫是 **3,818 台 / 66 廠牌**。⇒ 📌 **這是本格的天花板,寫在這裡免得它變成第二個「12 秒」。**
    //   ✅ **這一格現在釘的是「四條腿都要有數字」** —— 它守的事沒變(不准有腿變回零儀器),
    //      換掉的是那個 `skipped` 字面。要再拿掉那一腿的人,一樣會在這裡紅。
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
