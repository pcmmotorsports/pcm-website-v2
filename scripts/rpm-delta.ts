/**
 * rpm-delta — S3b 價格 delta gate(兩層硬 gate)+ pv_spec_unique preflight
 *
 * 鐵則 12 pricing:S3b 切換零售價來源(price_listing→price_retail)是全站改價、非 no-op。
 *   - 兩層 delta:products by external_id(前台列表/卡片吃商品層基準價)+ variants by sku、各比 price_general。
 *   - 硬 gate:異常列(新價 null/負/NaN/±Infinity/-0;🔴 **`0` 自 2026-08-25 起【不是】異常** —— Sean 拍板 0 元贈品合法)不可覆寫硬 abort;任何正式寫入須帶 --confirm-write(見 rpm-import)。
 * pv_spec_unique preflight:
 *   - final：最終同群 spec 真重複/孤兒撞 → 寫前 abort。
 *   - transition：最終唯一，但現況某 SKU 暫佔另一 SKU 的目標 spec → 分流到 atomic RPC。
 *   兩者都先 source 群內查 + target 模擬(新 product 用 external_id synthetic key)，避免 bulk 中途才 23505。
 *
 * 全程唯讀 target(SELECT、別大 .in() 撞 GET URL 上限);只比 price_general(公開零售、非敏感)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductRow, VariantRow } from './rpm-transform';

const READ_BATCH = 300;
const ABSURD_PRICE = 500_000; // 單價離譜上限(碳纖維部品零售遠低於此、超過疑倉庫資料打錯、列離群給 Sean 瞄)

/** spec 穩定序列化(key 排序、確定性比對) */
function stableSpec(spec: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(spec).sort()) sorted[k] = spec[k]!;
  return JSON.stringify(sorted);
}

/** 分批讀 target 現存 price_general(by key 欄、避免大 .in() 撞 URL 上限) */
async function readExistingPrices(
  tgt: SupabaseClient,
  supplierSlug: string,
  table: string,
  keyCol: string,
  keys: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const batch = keys.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from(table)
      .select(`${keyCol}, price_general`)
      .eq('supplier_slug', supplierSlug)
      .in(keyCol, batch);
    if (error) throw new Error(`readExistingPrices ${table}@${i}: ${error.message}`);
    // supabase-js 動態 select(模板字串)回 ParserError 型、無法靜態推 → 雙 cast escape hatch(同 rpm-load)
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.set(r[keyCol] as string, (r.price_general as number | null) ?? null);
    }
  }
  return out;
}

export interface DeltaLine {
  key: string;
  oldPrice: number | null;
  newPrice: number | null;
  pct: number | null;
}
export interface DeltaReport {
  productChanges: DeltaLine[];
  variantChanges: DeltaLine[];
  newProducts: number;
  newVariants: number;
  newProductKeys: string[]; // M1:新品 external_id(target 查無)——首灌驗價的對象
  newVariantKeys: string[]; // M1:新變體 sku
  abnormal: DeltaLine[]; // 新價 null/負/NaN/±Infinity/-0(硬 abort、不可覆寫)。🔴 `0` 不在裡面(2026-08-25 起合法);`-0` 在(它是負價取整來的)
  outliers: DeltaLine[]; // 漲價/大跌>30%/單價離譜(防呆瞄、非硬擋)
}

function pct(oldP: number | null, newP: number | null): number | null {
  if (oldP == null || oldP === 0 || newP == null) return null;
  return Math.round(((newP - oldP) / oldP) * 1000) / 10;
}
function isAbnormal(newP: number | null): boolean {
  // 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個「送」/ 試用品)
  //   ⇒ 這道硬 gate 原本把贈品判成「價格異常」而在 rpm-import 那裡 throw。
  //
  // 🔴🔴 **而 `Object.is(newP, -0)` 那一半是承重的, 不是囉唆** ——
  //   `rpm-transform.ts` 的 `roundTwd()` 用 `Math.round`,而來源價落在 **`[-0.5, 0)`** 之間時
  //   它回的是 **`-0` 不是 `0`**。
  //   🔴 **2026-08-25 訂正(codex R1 must-fix 2)**:~~原本寫 `(-0.5, 0]`~~ 是**錯的, 而且錯在邊界**。
  //     `-0.5` 本身就會產生 `-0`(`Math.round(-0.5) === -0`)⇒ 區間左端是**閉的**不是開的;
  //     右端 `0` 也不該含(`Math.round(0) === 0`, 正零, 不是 `-0`)。
  //     實測(`node -e` 直接跑 `Math.round(Number(v))`):
  //       `-0.51` ⇒ `-1` | **`-0.5` ⇒ `-0`** | `-0.49` ⇒ `-0` | `-1e-7` ⇒ `-0` | `0` ⇒ `0`
  //       字串來源同樣中招:`"-0"` / `"-0.0"` / `"-0.2"` / `"  -0.2  "` ⇒ 全部 `-0`
  //       負對照:`-1` ⇒ `-1`、`-2` ⇒ `-2`、`0.4` ⇒ `0`、`1` ⇒ `1`(尺分得出兩個世界)
  //   📌 **守門的行為一直是對的**(`Object.is` 蓋住整段 `[-0.5, 0)`)——
  //      錯的是這段註解寫的窗口。**一個讀了它的人會以為 `-0.5` 是安全的。**
  //   而 `-0 <= 0` 為 true、**`-0 < 0` 為 false**
  //   ⇒ **在 `-0` 這一格上**, 本片修改前擋住它的正好就是那個 `<=`(`-0 <= 0` 為 true)。
  //     🔴 **範圍要講準(codex R2 nit 1)**:~~原寫「擋住負價商品的【唯一】那一格」~~ **太寬**——
  //     `-1` / `-2` 這類一般負數由 `newP < 0` 擋得住, 與 `<=` 無關;
  //     **`Object.is` 唯一承重的對象只有 `-0`。**
  //   ⇒ 少了 `Object.is`, 一個【取整成 -0 的】負價來源商品會被當成「0 元贈品」放進網站。
  //   ⚠️ 危險窗口只有 `[-0.5, 0)` —— 再負一點(`-0.51` 起)取整成 `-1`,`< 0` 就擋得住了。
  //   📌 而 `roundTwd` 那一端**不要用正規化去修**(理由寫在該函式的 doc)。
  return newP == null || !Number.isFinite(newP) || newP < 0 || Object.is(newP, -0); // 🔴 NaN/Infinity 也算異常(codex k2 審查 must-fix 2)
}
/**
 * 離群價(防呆給 Sean 瞄、非硬擋):降價政策下「漲價」可疑 / 跌幅 >30% / 單價離譜高
 * / 🆕 從 0 元漲上去。
 *
 * ~~異常列(null/0/負/NaN)已由 isAbnormal 硬擋、不重列此處。~~
 * 🔴 **2026-08-25 訂正:`0` 已經不是異常了**(Sean 拍板 0 元贈品合法)⇒ 上面那句的前提失效。
 *   仍由 isAbnormal 硬擋而不重列於此的是:`null` / 負數 / `NaN` / `Infinity` / `-0`。
 */
function isOutlier(line: DeltaLine): boolean {
  if (line.newPrice != null && Number.isFinite(line.newPrice) && line.newPrice > ABSURD_PRICE) return true;
  // 🔴🔴 **這一條是【本片放行 0 元才產生的盲區】, 不是既有的洞(Sean 2026-08-25 拍甲「要列」)。**
  //   成因:`pct()` 對 `oldP === 0` 直接 `return null`,而下一行 `pct == null ⇒ return false`
  //   ⇒ 一件本來 0 元的贈品下一次變成 5,000 元, **沒有任何東西會提**。
  //   ⚠️ 而漏掉的**不是一兩個特例, 是【0 元 → 500,000 的整段(含 500,000 本身)】** ——
  //      🔴 **2026-08-25 訂正(codex R2 must-fix 3)**:~~原寫「50 萬以上才被接住」~~ **邊界錯了**。
  //      上面那道用的是 `> ABSURD_PRICE` 嚴格大於 ⇒ 實測 `500000 > 500000` 為 **false**
  //      ⇒ 真正被接住的是 **500,001 起**, **`500,000` 整這一格【不】被接住**。
  //      (實測:`499999`⇒false · `500000`⇒false · `500001`⇒true · `600000`⇒true)
  //   📌 它不是「別人留下的債」:**本片修改【之前】** `0` 進不來(`isAbnormal` 的 `<= 0` 擋著)
  //      ⇒ 這個死角當時不存在。**是本片打開它的。**
  //      (🔴 原寫「今天 `0` 進不來」—— 那句話在 patch 套上去的**那一秒就變假**, 而它讀起來像現況描述。)
  if (line.oldPrice === 0 && line.newPrice != null && Number.isFinite(line.newPrice) && line.newPrice > 0) return true;
  if (line.pct == null) return false;
  return line.pct > 0 || line.pct < -30;
}

/** 兩層 delta:products(external_id)+ variants(sku),各比現存 vs 新 price_general */
export async function computeDelta(
  tgt: SupabaseClient,
  supplierSlug: string,
  productRows: ProductRow[],
  variantRows: VariantRow[],
): Promise<DeltaReport> {
  const existProd = await readExistingPrices(tgt, supplierSlug, 'products', 'external_id', productRows.map((p) => p.external_id));
  const existVar = await readExistingPrices(tgt, supplierSlug, 'product_variants', 'sku', variantRows.map((v) => v.sku));

  const productChanges: DeltaLine[] = [];
  const abnormal: DeltaLine[] = [];
  const newProductKeys: string[] = [];
  for (const p of productRows) {
    const known = existProd.has(p.external_id);
    const oldPrice = known ? existProd.get(p.external_id)! : null;
    const line: DeltaLine = { key: p.external_id, oldPrice, newPrice: p.price_general, pct: pct(oldPrice, p.price_general) };
    if (!known) newProductKeys.push(p.external_id);
    else if (oldPrice !== p.price_general) productChanges.push(line);
    if (isAbnormal(p.price_general)) abnormal.push(line);
  }

  const variantChanges: DeltaLine[] = [];
  const newVariantKeys: string[] = [];
  for (const v of variantRows) {
    const known = existVar.has(v.sku);
    const oldPrice = known ? existVar.get(v.sku)! : null;
    const line: DeltaLine = { key: v.sku, oldPrice, newPrice: v.price_general, pct: pct(oldPrice, v.price_general) };
    if (!known) newVariantKeys.push(v.sku);
    else if (oldPrice !== v.price_general) variantChanges.push(line);
    if (isAbnormal(v.price_general)) abnormal.push(line);
  }

  const outliers = [...productChanges, ...variantChanges].filter(isOutlier);
  return {
    productChanges,
    variantChanges,
    newProducts: newProductKeys.length,
    newVariants: newVariantKeys.length,
    newProductKeys,
    newVariantKeys,
    abnormal,
    outliers,
  };
}

export function printDeltaReport(r: DeltaReport, opts: { full?: boolean; json?: boolean } = {}): void {
  if (opts.json) {
    // 🔴🔴 2026-08-25(codex R1 must-fix 3):**不可以用 `JSON.stringify(r, null, 2)`。**
    //   `JSON.stringify(-0)` ⇒ `0` ⇒ 一列【非法的 `-0`】(來源 `"-0.2"` 之類的負價)
    //   在這份 JSON 裡會印成 `"newPrice": 0`,而**合法的 0 元贈品也印 `0`** ——
    //   ⇒ **證據自己把兩個世界合流了。** 擋是有擋住(`isAbnormal` 會 abort),
    //     但事後拿這份 JSON 追「為什麼 abort」的人**分不出是負價還是贈品**。
    //   📌 這正是本片在防的那個病(0 與「不是 0 的東西」印同一個字), 而它長在我們自己的量具上。
    //   ⇒ 用 replacer 把 `-0` 轉成**字串** `"-0"`:它在 JSON 裡與數字 `0` 天生分得開。
    //   ⚠️ **不要改成把 `-0` 正規化成 `0`** —— 那是把唯一的證據抹掉, 與 `roundTwd` 那條同一個理由。
    //   ⚠️ 型別代價寫明:**這一格會從 `number` 變成 `string`, 而它會出現在【三個地方】。**
    //     🔴 **2026-08-25 訂正(codex R2 must-fix 4)**:~~原寫「`-0` 只出現在 abnormal 列,
    //        而那條路一定 abort」~~ —— **兩半都是假的。**
    //        ① 上面建表的迴圈裡, `productChanges.push` 與 `abnormal.push` 是**兩個獨立的 if**
    //           (不是 else)⇒ 一列 `-0` 只要 `oldPrice !== newPrice` 就**同時**進 `productChanges`;
    //           而 `outliers` 是從 `productChanges` 濾出來的 ⇒ **同一列可以三處都在**
    //           (實例:`oldPrice=10, newPrice=-0` ⇒ pct 為 -100% ⇒ 也算離群)。
    //        ② `--delta-json` 是在**硬 abort 之前**印的, 而 dry-run 根本不會走到 abort
    //           ⇒ **「那條路一定 abort」對 dry-run 不成立。**
    //     ⇒ **所以型別代價比原本寫的大:任何吃這份 JSON 的下游, 在 `productChanges` /
    //        `outliers` 這兩個【正常清單】裡也可能拿到字串 `"-0"`。**
    //     🔴 **而這段原本只談 `newPrice`, 漏了 `pct`**(code-reviewer must-fix 1)——
    //        `pct` 在一般降價上就會是 `-0`, 所以它**必須被排除在字串化之外**, 見下方 replacer。
    //        ⇒ 受影響的欄位只有 `oldPrice` / `newPrice`, **不含 `pct`**。
    //     ⇒ 仍然選擇這個代價, 理由是**可分辨性優先**:`-0` 若印成 `0`, 它與合法贈品
    //        **在證據上永久無法區分**;而字串 `"-0"` 至少會讓下游**當場壞掉或當場看見**,
    //        不會安靜地走過去。🔴 **這是知情之下的取捨, 不是「反正碰不到」。**
    //     📌 下游若要吃這份 JSON 做運算, 請先過濾 `typeof v === 'string'`。
    //     ✅ **2026-08-25 實查:現行下游消費者 = 0**(三把尺 + 負對照, 都在 repo 內)
    //        ① `grep -rn 'delta-json'` ⇒ 4 命中 = 本檔兩句註解 + `rpm-import.ts` 的旗標定義 + help 文字
    //        ② `grep -rn 'printDeltaReport'` ⇒ 唯一呼叫端 `rpm-import.ts` 只是 `console.log`
    //        ③ `grep -rn 'rpm-import' scripts docs` ⇒ 155 命中, 其中【會吃 JSON 的】0
    //        負對照(同尺換不存在的字)三發皆 0 / rc=1 ⇒ 尺會動。
    //        🔴 **這是【當時】的量測 ——** 哪天有人接了程式去 parse 這份 JSON,
    //        上面那個取捨就要重新拿出來問, 不要因為它寫在這裡就當成永久成立。
    // 🔴🔴 **`k !== 'pct'` 不是防禦性寫法, 它是【必要條件】(code-reviewer must-fix 1)**:
    //   `pct()` 是 `Math.round(((new-old)/old)*1000)/10` ⇒ **任何跌幅小於 0.05% 的一般降價**
    //   都會落進 `Math.round` 的 `[-0.5, 0)` 窗口而回 `-0`。實測:
    //     `2001 → 2000` / `5000 → 4999` / `151600 → 151599` ⇒ 三者 pct 皆為 `-0`
    //     負對照 `1000 → 999` ⇒ `-0.1`(不是 -0)⇒ 尺會動
    //   ⇒ 少了這個 key 條件, 一發 8878 筆的日常 delta 會印出**一堆乾乾淨淨的 1 元降價**
    //     長成 `"pct": "-0"` ⇒ **下一個人會看到滿screen 假陽性, 然後學會忽略這個訊號。**
    //   📌 **那正是本段在防的病(兩個世界印同一個字), 只是方向反過來** ——
    //     這次是「正常的東西被印成異常」, 而它比反過來更難發現, 因為沒有人會來報案。
    //   ⚠️ `pct` 是**衍生顯示值**:它的符號在 `oldPrice` / `newPrice` 兩欄已經看得見
    //     ⇒ 讓它印成 `0` **不損失任何證據**。而 `newPrice` 的 `-0` 沒有別的欄位可以還原, 所以留著。
    console.log(JSON.stringify(r, (k, v) => (Object.is(v, -0) && k !== 'pct' ? '-0' : v), 2)); // --delta-json:機器可讀全量證據
    return;
  }
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : 50;
  console.log('\n=== 價格 delta gate(兩層)===');
  console.log(`商品層變價: ${r.productChanges.length} / 變體層變價: ${r.variantChanges.length}`);
  console.log(`新商品: ${r.newProducts} / 新變體: ${r.newVariants} / 🔴異常(null/負/NaN/±Inf/-0): ${r.abnormal.length} / ⚠️離群: ${r.outliers.length}`);
  // 🔴 離群價(防呆、Sean 瞄此即可、非全 8878 筆):降價政策下漲價可疑 / 跌幅>30% / 單價離譜
  if (r.outliers.length) {
    console.log(`⚠️ 離群價清單(${r.outliers.length}、Sean 瞄此即可、防倉庫資料打錯):`);
    console.table(r.outliers.slice(0, cap));
  } else {
    console.log('✅ 無離群價(全在合理降價區間)');
  }
  console.log(`-- 商品層 delta ${opts.full ? '(全量)' : '前 50'} --`);
  console.table(r.productChanges.slice(0, cap));
  console.log(`-- 變體 delta ${opts.full ? '(全量)' : '前 50'} --`);
  console.table(r.variantChanges.slice(0, cap));
  console.log(`(完整 ${r.productChanges.length} 商品 / ${r.variantChanges.length} 變體變價;--delta-full 印全量、--delta-json 出 JSON 留證)`);
  if (r.abnormal.length) {
    console.log('🔴 異常列(硬 abort、不可覆寫):');
    console.table(r.abnormal.slice(0, cap));
  }
}

// ── M1:新品驗價(Codex R1 2026-07-19 must-fix M1)──
/**
 * 價格 delta gate 的結構性盲區:它只比得出「變價」——**新品沒有舊價可比**(oldPrice=null、
 * pct=null → isOutlier 直接 return false)。首灌時 648 群全是新品 → 整批價格零檢查,
 * 錯 100 倍也照上架(異常列只擋 null/負/NaN/-0 —— **`0` 不擋了**,而 10 元跟 100 萬都算「正常」)。
 *
 * 補兩層:
 *   ① **對源逐筆比對**(任何時候都硬擋):把商品/變體要寫的 price_general,對「從來源列獨立重算」
 *      的值。這是查 transform 接線是否還對(接錯欄=接到經銷價/成本、忘了 round、單位錯位),
 *      不是查來源本身對不對。刻意不呼叫 rpm-transform 的實作,避免同一個 bug 兩邊一起錯。
 *   ② **絕對價區間**(僅首灌硬擋、日常只報):落在 [floor, ceiling] 外 → 疑單位/小數點錯位。
 *      日常不硬擋是實查決定(2026-07-19 報價單庫:gbracing 45 筆 < 100 元、eazigrip/evotech 各 2 筆 80 元
 *      = 真實便宜小件);拿它當日常硬閘會天天誤殺 gbracing 同步。首灌是一次性人工監控場景、擋得起。
 */
export const NEW_ITEM_PRICE_FLOOR = 100; // 元;低於此疑小數點/單位錯位(實查最低真實價=gbracing 50 元、故僅首灌硬擋)
export const NEW_ITEM_PRICE_CEILING = ABSURD_PRICE; // 與離群價同上限(實查最高真實價=akrapovic 151,600)

export interface NewItemPriceIssue {
  level: 'product' | 'variant';
  key: string;
  price: number | null; // 要寫進網站的值
  sourcePrice: number | null; // 從來源列獨立重算的值
  reason: 'source-mismatch' | 'below-floor' | 'above-ceiling';
  detail: string;
}

/** 來源單值 → 整數 TWD;null/空/非法 → null(獨立實作,不共用 rpm-transform 的 roundTwd) */
export function independentPrice(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * 群基準價獨立重算 = min(price_retail) 取整(對齊 rpm-transform 的「群內最低零售價」規則、但另寫一份)。
 * 任一列價非法 → null(transform 那側該群基準也會落 null、再由異常列硬 abort 接手)。
 */
export function independentGroupPrice(rows: { price_retail: string | number | null }[]): number | null {
  if (!rows.length) return null;
  let min: number | null = null;
  for (const r of rows) {
    const n = independentPrice(r.price_retail);
    if (n === null) return null;
    if (min === null || n < min) min = n;
  }
  return min;
}

/**
 * 新品驗價。`items` = 本次判定為新品的商品/變體(key、要寫的價、來源獨立重算價)。
 * `enforceBand`:首灌傳 true(絕對區間也算 issue);日常傳 false(只留對源比對)。
 */
export function checkNewItemPrices(
  items: { level: 'product' | 'variant'; key: string; price: number | null; sourcePrice: number | null }[],
  opts: { enforceBand: boolean; floor?: number; ceiling?: number } = { enforceBand: false },
): NewItemPriceIssue[] {
  const floor = opts.floor ?? NEW_ITEM_PRICE_FLOOR;
  const ceiling = opts.ceiling ?? NEW_ITEM_PRICE_CEILING;
  const issues: NewItemPriceIssue[] = [];
  for (const it of items) {
    const { level, key, price, sourcePrice } = it;
    if (price !== sourcePrice) {
      issues.push({
        level,
        key,
        price,
        sourcePrice,
        reason: 'source-mismatch',
        detail: `要寫 ${price} ≠ 來源獨立重算 ${sourcePrice}(transform 接線疑接錯欄/漏取整/單位錯位)`,
      });
      continue; // 接線已不可信,不必再談區間
    }
    if (!opts.enforceBand || price === null) continue;
    if (price < floor) {
      // 🔴 `${price}` 會把 `-0` 字串化成 `"0"` ⇒ 一個【負價取整來的 -0】與【真贈品 0】
      //   在這句 detail 上長得一模一樣。分開印, 理由與 --delta-json 那段同源。
      const shown = Object.is(price, -0) ? '-0' : String(price);
      issues.push({ level, key, price, sourcePrice, reason: 'below-floor', detail: `${shown} < 首灌下限 ${floor}(疑小數點/單位錯位)` });
    } else if (price > ceiling) {
      issues.push({ level, key, price, sourcePrice, reason: 'above-ceiling', detail: `${price} > 首灌上限 ${ceiling}(疑倉庫資料打錯)` });
    }
  }
  return issues;
}

export function printNewItemPriceReport(
  issues: NewItemPriceIssue[],
  counts: { newProducts: number; newVariants: number; enforceBand: boolean },
): void {
  console.log('\n=== 新品驗價(M1、對來源逐筆比對)===');
  console.log(
    `新商品 ${counts.newProducts} / 新變體 ${counts.newVariants};` +
      `絕對價區間硬擋=${counts.enforceBand ? '開(首灌)' : '關(日常、只留對源比對)'}`,
  );
  if (!issues.length) {
    console.log('✅ 新品價與來源獨立重算逐筆相符、無區間異常');
    return;
  }
  console.error(`🔴 新品驗價 ${issues.length} 筆問題、寫入模式將 abort:`);
  console.table(issues.slice(0, 50));
  if (issues.length > 50) console.log(`(另有 ${issues.length - 50} 筆未列)`);
}

export function hasPriceChange(r: DeltaReport): boolean {
  return r.productChanges.length > 0 || r.variantChanges.length > 0;
}
export function hasAbnormal(r: DeltaReport): boolean {
  return r.abnormal.length > 0;
}

export interface SpecCollision {
  externalId: string;
  kind: 'final' | 'transition';
  spec: string;
  skus: string[];
}

/**
 * 純模擬(可測):source 最終 spec 重複 + target 既有變體併入 + 同批 SKU 中途換位。
 * 🔴 V1(2026-07-05 審查 F3):`deletedSkus` = 變體級對賬已排定硬刪的孤兒 sku——變體 upsert 前會先刪,
 * 故**不併入**模擬(否則「變體改名、spec 不變」→ 新 sku 恆撞已死孤兒 → 該供應商同步永久卡死、無工具可解)。
 */
export function simulateSpecCollisions(
  variantsByExternalId: Map<string, { sku: string; spec: Record<string, string> }[]>,
  idByExt: Map<string, string>,
  existByProduct: Map<string, { sku: string; spec: Record<string, string> }[]>,
  deletedSkus: Set<string>,
): SpecCollision[] {
  const collisions: SpecCollision[] = [];
  for (const [externalId, srcVariants] of variantsByExternalId) {
    const srcSkus = new Set(srcVariants.map((v) => v.sku));
    const desiredSpecBySku = new Map(srcVariants.map((v) => [v.sku, stableSpec(v.spec)]));
    const bySpec = new Map<string, string[]>();
    const add = (sku: string, spec: Record<string, string>): void => {
      const s = stableSpec(spec);
      const arr = bySpec.get(s);
      if (arr) arr.push(sku);
      else bySpec.set(s, [sku]);
    };
    for (const v of srcVariants) add(v.sku, v.spec); // source 群內
    const pid = idByExt.get(externalId);
    if (pid) {
      for (const ev of existByProduct.get(pid) ?? []) {
        // target 既有變體:source 有(將被 upsert 覆寫)跳過;已排定刪除(V1 孤兒)跳過;其餘併入模擬
        if (!srcSkus.has(ev.sku) && !deletedSkus.has(ev.sku)) add(ev.sku, ev.spec);
      }
    }
    for (const [spec, skus] of bySpec) {
      if (skus.length > 1) collisions.push({ externalId, kind: 'final', spec, skus });
    }

    // target 目前的 spec 雖會被同批 source SKU 覆寫，仍可能在「逐列 upsert 的中途」
    // 暫時佔住另一列的目標 spec。例:BL 現為黑、desired 要改藍；base desired 要改黑，
    // 若 base 先寫就會在 BL 尚未離開前撞 pv_spec_unique。只報「佔位者也會搬走」的情境；
    // 佔位者不搬＝上方 final collision，孤兒已排刪＝寫入前會先釋放，皆不重複列。
    if (pid) {
      const current = existByProduct.get(pid) ?? [];
      const currentOwnerBySpec = new Map(
        current.filter((v) => !deletedSkus.has(v.sku)).map((v) => [stableSpec(v.spec), v.sku]),
      );
      for (const desired of srcVariants) {
        const desiredSpec = stableSpec(desired.spec);
        if ((bySpec.get(desiredSpec)?.length ?? 0) > 1) continue; // final collision 已報
        const occupantSku = currentOwnerBySpec.get(desiredSpec);
        if (!occupantSku || occupantSku === desired.sku || !srcSkus.has(occupantSku)) continue;
        const occupantCurrentSpec = desiredSpec;
        const occupantDesiredSpec = desiredSpecBySku.get(occupantSku);
        if (!occupantDesiredSpec || occupantDesiredSpec === occupantCurrentSpec) continue; // 不搬＝final collision
        collisions.push({ externalId, kind: 'transition', spec: desiredSpec, skus: [desired.sku, occupantSku] });
      }
    }
  }
  return collisions;
}

/**
 * pv_spec_unique(product_id, spec) preflight。
 * source 群內(external_id 分群)最終 spec 重複 + target 模擬：
 * ① 既有變體〔source 無、亦未排定刪除〕併入後是否真撞；
 * ② source SKU 的 desired spec 是否仍被同批另一 SKU 暫佔(transition hazard)。
 * 新 product(target 查無 id)→ 只查 source 群內(external_id 即 synthetic key)。
 * `deletedSkus`:V1 變體級對賬排定硬刪的孤兒(upsert 前已清、不參與模擬;預設空=舊行為)。
 */
export async function preflightSpecUnique(
  tgt: SupabaseClient,
  supplierSlug: string,
  variantsByExternalId: Map<string, VariantRow[]>,
  deletedSkus: Set<string> = new Set(),
): Promise<SpecCollision[]> {
  const externalIds = [...variantsByExternalId.keys()];

  // target:external_id → product id(只查要寫的群)
  const idByExt = new Map<string, string>();
  for (let i = 0; i < externalIds.length; i += READ_BATCH) {
    const batch = externalIds.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from('products')
      .select('id, external_id')
      .eq('supplier_slug', supplierSlug)
      .in('external_id', batch);
    if (error) throw new Error(`preflight products@${i}: ${error.message}`);
    for (const r of (data ?? []) as { id: string; external_id: string }[]) idByExt.set(r.external_id, r.id);
  }

  // target:product_id → 既有變體 (sku, spec)
  const existByProduct = new Map<string, { sku: string; spec: Record<string, string> }[]>();
  const productIds = [...idByExt.values()];
  for (let i = 0; i < productIds.length; i += READ_BATCH) {
    const batch = productIds.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from('product_variants')
      .select('product_id, sku, spec')
      .in('product_id', batch);
    if (error) throw new Error(`preflight variants@${i}: ${error.message}`);
    for (const r of (data ?? []) as { product_id: string; sku: string; spec: Record<string, string> | null }[]) {
      const arr = existByProduct.get(r.product_id);
      const entry = { sku: r.sku, spec: r.spec ?? {} };
      if (arr) arr.push(entry);
      else existByProduct.set(r.product_id, [entry]);
    }
  }

  return simulateSpecCollisions(variantsByExternalId, idByExt, existByProduct, deletedSkus);
}
