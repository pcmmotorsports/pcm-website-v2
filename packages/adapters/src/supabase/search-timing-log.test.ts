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
    expect(countInfo(adapter), 'console.info 的行數變了 ⇒ 有人加了或拿掉了一條路').toBe(3);
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
    const liveLine = productsRaw
      .split('\n')
      .find((ln) => ln.includes('[vehicleTaxonomy] cold pages=') && !ln.trimStart().startsWith('//'));
    expect(liveLine, '[vehicleTaxonomy] 那一行不見了(或被註解掉了)⇒ 冷暖就再也看不到').toBeTruthy();
    // 🔴🔴 **`first=` 與 `restAvg=` 這兩個數是承重的**(2026-09-05)——
    //    它們要回答的是「那 945ms/頁 的固定成本住在【第一發】還是【每一發】」:
    //      first ≫ restAvg ⇒ 住在連線層(一次)⇒ RPC 一次往返的收益很大
    //      兩者相近       ⇒ 每一頁都在付      ⇒ 收益小很多, 整個 RPC 案要重估
    //    🛑 少了任何一個, 那個問題就【只能用猜的】—— 而我先前就是只能寫「四個候選都沒量」。
    for (const k of ['first=', 'restAvg=']) {
      expect(productsRaw, `${k} 不見了 ⇒ 「固定成本住在哪一發」就再也判不出來`).toContain(k);
    }
    const products = productsRaw;
    expect(products, '找不到那支 cached loader ⇒ 這一格沒有判別力').toContain(
      'const getVehicleTaxonomyCached = unstable_cache(',
    );
    // 🛑 釘「它在內側」:那一行必須出現在 `unstable_cache(` 之後、而且在同一個 call 的參數裡
    //    —— 用「它在 `['vehicle-taxonomy-v3']` 那個 key 之前」來釘(那是該 call 的第二參數)。
    const openIdx = products.indexOf('const getVehicleTaxonomyCached = unstable_cache(');
    const logIdx = products.indexOf('[vehicleTaxonomy] cold pages=');
    const keyIdx = products.indexOf("['vehicle-taxonomy-v3']");
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
