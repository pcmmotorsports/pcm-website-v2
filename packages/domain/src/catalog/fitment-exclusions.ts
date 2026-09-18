// fitment-exclusions.ts — **供應商排除條款的唯一來源**(2026-09-18)。
//
// 🔢 **13 筆,而不是 18** —— 那 18 件裡有 5 件(`BMSR-05` / `DV4-25` / `HCB2K108` /
//   `HCB650R-05` / `HCB650R-06`)的年式欄**今天本來就是對的**(逐件比過原文),
//   ⇒ **刻意不收進來**。收進來只會多 5 筆要維護的東西, 而它們什麼都不需要改。
//
// 🔴 **為什麼需要這支檔**(2026-09-18 開瀏覽器量到的):
//   rpm 商品頁**不吃** `products.description` —— 它用車款與品名組一段中文模板,
//   而那段模板**永遠寫著「對應原廠孔位、可直接安裝」**。
//   ⇒ 供應商原文裡的「Does not fit …」**客人一個字都看不到**
//     (實測 `rpm-xadv04`:`does not fit` 在 HTML 裡 true、在畫面文字裡 **false**)。
//   ⇒ 📌 **所以客人不是看到一句看不懂的話,是看到一句與事實相反的話。**
//
// 🎯 **一份來源,兩個消費者**(Sean 2026-09-18 拍 Q1 甲;主視窗逐字「兩套來源 = 兩份真相 ⇒ 我會擋」):
//   · `scripts/rpm-import` 讀 `years`    ⇒ 寫進 `product_fitments`(匯入時套用 ⇒ **沖不掉**)
//   · 前台 `ProductFitments` 讀 `excludes` ⇒ 畫「這些情況裝不上」那一塊(**不進 DB**)
//   🔵 ② 刻意不走 DB:走 DB 要加欄位 ⇒ migration + 貼板 + 部署時序閘。
//      這裡只有個位數筆、內容是人寫的中文 ⇒ 放 repo 裡**看得到、進得了 review、改了會出現在 diff**。
//   🛑 **代價寫明**:員工**不能自己維護**(要改碼)。量大了要走鐵則 9 的後台 CRUD —— 那是另一件。
//
// 🔴🔴 **`years` 只填【原文逐字講得出年份】的那幾件,其餘一律走 `excludes` 文字。**
//   理由 = Sean 拍 Q1 時否掉「從描述解析」的同一個理由:**錯的年份比沒有年份更糟**。
//   ⚠️ 我**沒有**把 `DV4-18` / `DV4-18E5` / `YAR1-2` 的年份填進去,而它們的年式欄今天確實可疑
//      (見各條 `note`)—— **那是「我不敢填」,不是「沒問題」。** 兩者長得一樣,所以寫出來。
//
// ⚠️ **本表不是那 301 群的清單**,只有「窗 A 2026-09-18 逐件開過原文」的那 18 件裡**需要處理的 13 件**。

/** 一筆排除條款。`years` 與 `excludes` 至少要有一個(對帳會擋)。 */
export type FitmentExclusion = {
  /**
   * 🔴 **鍵用【品牌 slug】,不是供應商、也不是單獨料號**(2026-09-18 Sean 提、窗A 實查):
   *   · **為什麼不能只用料號**:同一個料號跨供應商撞號 ⇒ 實查 **97 組**
   *     (`SELECT external_id FROM products GROUP BY 1 HAVING count(DISTINCT supplier_slug) > 1`)。
   *     只用料號會**張冠李戴** —— 「A 家的 BM06 裝不上 X」跑去掛在 B 家的 BM06 上。
   *     🎯 **那是我們正在治的病的加強版:不是漏講, 是【講錯一件商品】。**
   *   · **為什麼不用供應商而用品牌**:商品頁本來就有品牌(`MockProduct.brandSlug`),
   *     用它**不必多一發查詢、也不必動 `PRODUCT_SELECT_DETAIL`**(讀寫共用常數)。
   *   · 🔵 實查佐證:同【品牌 + 料號】對到一件以上的 ⇒ **0 組**(同日、同一句 SQL 的對照組)。
   * 🛑 **而「供應商 ≠ 品牌」是一個【會變的前提】** —— 全站有幾組「這家供應商賣的是別人的品牌」。
   *   今天那 97 組的品牌都分得開, 而它會變 ⇒ 由對帳的 `duplicate-key` 接住(見下)。
   */
  readonly brandSlug: string;
  /** 群主料號 —— 🔴 對的是 `products.external_id`,**不是** `product_variants.sku`
   *  (2026-09-18 踩過:拿 sku 查 0 筆,而那不是「沒有」,是鍵用錯了)。 */
  readonly externalId: string;
  /** 年式修正:只有原文逐字給得出年份時才填。`[起, 迄]`,迄為 null = 開放式。 */
  readonly years?: readonly {
    readonly modelCode: string;
    /** 🔵 選填:同一個 modelCode 可能跨車廠重複時用來收窄。不填 = 不看車廠。 */
    readonly motoBrand?: string;
    readonly yearStart: number;
    readonly yearEnd: number | null;
  }[];
  /** 給客人看的「裝不上的情況」,一句一條、中文。 */
  readonly excludes?: readonly string[];
  /** 🔵 供應商原文逐字 —— 對帳靠它判斷「條款還在不在」,也讓下一個人核得動。 */
  readonly source: string;
  /** 🛑 我判斷不了的地方寫在這裡,不要假裝沒有。 */
  readonly note?: string;
};

export const FITMENT_EXCLUSIONS: readonly FitmentExclusion[] = [
  // ── 年份講得出來的(填 years + 同時給客人一句話)──────────────────────
  {
    brandSlug: 'rpm-carbon',
    externalId: 'XADV04',
    // 🔵 `yearStart` 的出處:原文逐字「Honda X-ADV 750 2017-2020」給得出起年。
    //    (DB CHECK `product_fitments_year_state_valid` 也不允許 year_start 為 NULL ⇒ 省不掉。)
    years: [{ modelCode: 'X-ADV 750', yearStart: 2017, yearEnd: 2020 }],
    excludes: ['2021 年以後的 X-ADV 750 裝不上'],
    source: '!! Does not fit 2021+ Model !!',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'KAZ900RS-10',
    // 🔵 `yearStart` 出處:原文逐字「Kawasaki Z900RS 2017-2019」。
    //    🛑 而 `modelCode` 這個字串**必須與來源的寫法逐字相同**才套得上 ——
    //       套不上會由 `applyExclusionYears` 擲錯(它不再靜默略過)。
    years: [{ modelCode: 'Z900RS', yearStart: 2017, yearEnd: 2019 }],
    excludes: ['2020 年以後的 Z900RS 裝不上'],
    source: 'Does not fit 2020+ Model !! Please confirm with us before you buy!!',
  },

  // ── 排除條款【不是年份】的(只填 excludes)────────────────────────────
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DV4-18',
    excludes: ['只適用 EURO4 車型', '2021 年的 Euro5 車型裝不上'],
    source: '!! NOTE: Only for EURO4 Models - Does not fit 2021 Euro 5 Models !! Please contact us when you are unsure about your bike Model.',
    note:
      '🛑 年式欄今天是 Panigale V4 2018–2021, 而原文說 2021 Euro5 裝不上 ⇒ 看起來矛盾。' +
      '而 Euro4/Euro5 是【排放規格】不是年份, 同一年式可能兩種都有 ⇒ 我不敢直接砍 2021。' +
      '⇒ 走文字, 並把這句疑慮留在這裡給下一個人。',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DV4-18E5',
    excludes: ['只適用 EURO5 車型', 'EURO4 車型裝不上'],
    source: '!! NOTE: Only for EURO5 Models - Does not fit Euro 4 Models !! Please contact us when you are unsure about your bike Model.',
    note: '同 DV4-18:年式欄含 2018–2021(那正是 Euro4 年份)⇒ 可疑, 而我不敢改年份。',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'YAR1-2',
    // ⛔ ~~'2025 年以後的車型裝不上'~~ 🔴 R1 訂正:**比原文寬**。原文只講 R1,
    //    而這件商品還掛 MT-10 / YZF-R6 兩個開放式年份 ⇒ 客人會讀成「這台車 2025 以後都裝不上」。
    excludes: ['2025 年以後的 YZF-R1 裝不上'],
    source: 'Yamaha R1 2009-2024 (Does not fit 2025+ Model !!! )',
    note:
      'R1 那幾列已經到 2024 ✅;而 MT-10 是「2022 年起」、YZF-R6 是「2017 年起」兩個開放式 ' +
      '⇒ 它們會涵蓋 2025+。要不要把那兩列收成有迄年, 我判斷不了(原文只講 R1)⇒ 沒動。',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'ATU42104',
    excludes: ['Tuono V4 "Factory" 版本裝不上'],
    source: '(Does not fit "Factory") Model!!!',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DUCMO937-06',
    excludes: ['Monster 937 SP 裝不上'],
    source: 'DOES NOT FIT Monster 937 SP',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'BMS1K2KR02',
    excludes: ['M1000R 搭配 Akrapovic 排氣管時裝不上'],
    source: 'Does not fit M1000R with Akrapovic Performance Exhaust',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DPV42525',
    excludes: ['搭配原廠排氣管時裝不上'],
    source: 'Does not fit with stock exhaust!',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'BMS1K2K-24',
    // ⛔ ~~'與 Brake Lever Guard 同時安裝時會衝突'~~ 🔴 訂正:我先前看到的原文被截斷成
    //    "in connection with the B…", 而我【猜】了一個配件名。完整原文是 M Performance 腳踏組。
    //    📌 那一猜是這批裡最該記的一次:**截斷的原文與完整的原文長得一樣, 只有去取全文才分得出來。**
    excludes: ['與 BMW S1000RR M Performance 腳踏組同時安裝時會衝突'],
    source: 'Notice: Does not fit in connection with the BMW S1000RR M Performance Rear Set',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DSFV22506',
    // ⛔ ~~'部分 V 系列車型裝不上'~~ 🔴 2026-09-18 訂正:我先前讀到的原文【被截斷】成
    //    "Does not fit V…" ⇒ 只好寫通稱。拿完整原文重看是明確的 **V2S**。
    excludes: ['V2S 車型裝不上(本品為標準版 V2 專用)'],
    source: 'Does not fit V2S Models.',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DSFV22507',
    // ⛔ ~~'部分 V 系列車型裝不上'~~ 🔴 同上訂正:完整原文是 **V2 標準版**(本品為 V2S 專用)。
    excludes: ['標準版 V2 車型裝不上(本品為 V2S 專用)'],
    source: 'Does not fit V2 (Standard) Models.',
  },
  {
    brandSlug: 'rpm-carbon',
    externalId: 'DCM1201',
    // ⛔ ~~'部分 Multistrada 車型裝不上'~~ 🔴 訂正:完整原文明確指 **Enduro 版**。
    excludes: ['Multistrada 1200 / 1260 的 Enduro 版裝不上'],
    source: 'It does not fit any Multistrada 1260/1200 Enduro Models !! For Enduro Models, refer to this',
    note: '🔵 原文已取完整。另外這件的年式欄是「—」(來源就沒有年份), 本片沒補年份。',
  },
];

/** 以 (brandSlug, externalId) 取一筆。找不到回 `undefined` —— 沒有條款是常態,不是錯誤。 */
export function findFitmentExclusion(
  brandSlug: string,
  externalId: string,
): FitmentExclusion | undefined {
  return FITMENT_EXCLUSIONS.find(
    (e) => e.brandSlug === brandSlug && e.externalId === externalId,
  );
}

// ── 對帳 ────────────────────────────────────────────────────────────────
//
// 🔴🔴 **這道對帳是硬要件,不是選配。** 理由逐字寫在 plan 裡:
//   **只有例外表而沒有對帳,就是「今天對、三個月後靜靜過期」那種東西。**
//
// 它擋的是兩種靜默失效:
//   ① 那個料號從供應商目錄消失  ⇒ 這條例外已經沒有對象, 而它會永遠留在檔案裡
//   ② 那句原文從描述裡不見了    ⇒ 供應商改了條款, 而我們還在對客人講舊的那一句
//
// 🛑 **對帳不過會怎樣(寫死,不是印警告)**:
//   · `scripts/rpm-import` 那一側 ⇒ **擋住匯入**。
//     理由:**印一行沒人看的警告不算防線 —— 而匯入紅了一定有人處理。**
//   · 測試那一側 ⇒ 一格**會紅的測試**(不是 `console.warn`)。
//
// 🔵 寫成**純函式**是為了讓負對照餵得進動過手腳的輸入 —— 同 `brand-content-coverage` 那一族。

/**
 * 對帳用的來源商品(只要這幾個欄位,不綁任何一邊的 row 型別)。
 *
 * 🔴🔴 **2026-09-18 實跑之後的重大更正 —— `description` 這一欄【在報價單來源上比不了】。**
 *   乾跑實測(`--dry-run --supplier=rpm`)⇒ 13 筆全部判 `clause-gone` ⇒ **匯入整個被擋死**。
 *   去看來源到底寫什麼(逐字):
 *     `XADV04` 來源 description = 「採用乾式碳纖維製造,具備抗紫外線塗層,可取代原廠側蓋件。
 *                                  適用車款與年式以本頁標示為準」
 *   ⇒ 🎯 **來源那一側早就改寫成中文了,那句英文 `Does not fit 2021+` 根本不在裡面。**
 *      它只活在**顧客站那份凍結的英文副本**(rpm 的 `syncDescription=false` ⇒ 從來沒被同步過)。
 *   ⇒ 🛑 **所以「條款還在不在」這件事今天【沒有一個地方量得到】**:
 *        · 對來源比 ⇒ 永遠不中(那裡沒有英文)
 *        · 對顧客站比 ⇒ 永遠中(那份是凍結的、不會變)⇒ **一道永遠綠的閘 = 沒有閘**
 *   ⇒ ✅ 處置:`checkClause` 預設 **false**,`source` 退成**留證用**(讓下一個人核得動),不當閘的輸入。
 *      📌 **而這件事本身是個發現**:來源說「適用車款與年式**以本頁標示為準**」——
 *         它把責任指向適用車款表,**而那張表的年式欄是「—」**。⇒ 年式修正比原本以為的更該做。
 */
export type ExclusionSourceProduct = {
  readonly brandSlug: string;
  readonly externalId: string;
  /**
   * 🔴 **供應商 slug —— 它【不是鍵】,只用來偵測撞號。**
   *   來源那一份的粒度是【每列一變體】⇒ **同一件商品本來就會出現很多列**,
   *   所以「列數 > 1」是常態、**不是撞號**。
   *   🔬 第一版判準寫成 `rows.length > 1`, 而測試當場把它抓了下來
   *      (那一格現在還在:「同一件商品的多個變體不算撞號」)。
   *   ⇒ ✅ 真正的撞號 = 同一個(品牌, 料號)底下出現**一個以上的供應商**。
   */
  readonly supplierSlug?: string;
  /** 供應商原文描述;`null` = 那件商品沒有描述。 */
  readonly description: string | null;
};

export type ExclusionReconcileViolation =
  | { readonly kind: 'missing-product'; readonly brandSlug: string; readonly externalId: string }
  | { readonly kind: 'duplicate-key'; readonly brandSlug: string; readonly externalId: string; readonly count: number }
  | { readonly kind: 'clause-gone'; readonly brandSlug: string; readonly externalId: string; readonly source: string }
  | { readonly kind: 'empty-entry'; readonly brandSlug: string; readonly externalId: string };

/** 🔵 組合鍵的分隔字串。供應商 slug 與料號都不含這兩個字元(2026-09-18 實查 301 群全表)。 */
const KEY_SEP = '::';

/** 去 HTML 標籤 + 壓空白 + 轉小寫 —— 比對條款前兩邊都要過這一關。 */
function normalizeClause(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 把例外表對一份來源目錄核一次。**回傳空陣列 = 全部對得上。**
 *
 * ⚠️ **射程寫清楚**(免得被讀成「例外表全對」):
 *   · 它驗「那個料號還在不在」與「那句原文還在不在描述裡」
 *   · 🛑 它**不驗**中文寫得對不對、也不驗年份填得對不對 —— 那兩件今天沒有機器判得動。
 */
export function reconcileFitmentExclusions(
  source: readonly ExclusionSourceProduct[],
  table: readonly FitmentExclusion[] = FITMENT_EXCLUSIONS,
  opts: { readonly checkClause?: boolean } = {},
): readonly ExclusionReconcileViolation[] {
  // 🔴 **同一個 key 會有很多列** —— 來源 view 的粒度是【每列一變體】(`rpm-fetch.ts:14` 逐字)。
  //   ⛔ ~~`new Map(source.map(...))`~~ 那樣寫是 **last-wins**:同群多變體互相覆蓋,
  //      留下的是排序最後那一列 ⇒ 擋不擋取決於 sku 排序、**不可重現**。
  //   ✅ 收成陣列、**任一列命中就算過**。
  const byKey = new Map<string, ExclusionSourceProduct[]>();
  for (const p of source) {
    const k = `${p.brandSlug}${KEY_SEP}${p.externalId}`;
    const arr = byKey.get(k);
    if (arr) arr.push(p);
    else byKey.set(k, [p]);
  }
  const out: ExclusionReconcileViolation[] = [];
  for (const e of table) {
    if ((e.years?.length ?? 0) === 0 && (e.excludes?.length ?? 0) === 0) {
      out.push({ kind: 'empty-entry', brandSlug: e.brandSlug, externalId: e.externalId });
    }
    const rows = byKey.get(`${e.brandSlug}${KEY_SEP}${e.externalId}`);
    if (!rows || rows.length === 0) {
      out.push({ kind: 'missing-product', brandSlug: e.brandSlug, externalId: e.externalId });
      continue;
    }
    // 🔴🔴 **同一個【品牌 + 料號】對到一件以上 ⇒ 擋住, 不要靜靜挑一個。**
    //   今天實查是 **0 組**, 而 **0 會變** —— 多一家供應商賣同一個品牌的同一個料號就撞。
    //   🛑 靜靜挑一個 = 把「講錯一件商品」變成一個沒有人會發現的結果。
    //   🔵 而它與上面那兩種走【同一個出口】(同一個 violations 陣列、同一個 gate),
    //      不是另外印一行沒人看的東西。
    const suppliers = new Set(rows.map((r) => r.supplierSlug).filter((x): x is string => x != null));
    if (suppliers.size > 1) {
      out.push({ kind: 'duplicate-key', brandSlug: e.brandSlug, externalId: e.externalId, count: suppliers.size });
      continue;
    }
    // 🔴🔴 **而上面那一格在【正式路徑上是死碼】,寫下來**(2026-09-18 R1 must-fix 2):
    //   一次匯入只讀自己那家的目錄 ⇒ 傳進來的每一列 `supplierSlug` 必然同值 ⇒ `size` 恆為 1。
    //   它要守的那件事(**別家**供應商賣同品牌同料號)**在這一層看不到** —— 別家的商品根本不在 `source` 裡。
    //   ⇒ ✅ 真正在守它的是 `scripts/rpm-import.ts` 那一發**對 target 庫**的查詢(`.neq('supplier_slug', …)`)。
    //   ⇒ 🛑 這一格**留著是為了單元測試餵得進那個形狀**, 而**不要把它當成生產端的防線** ——
    //      那正是「看起來在守、而尺量不到它要量的東西」那一族。
    if (opts.checkClause !== true) continue; // 見上面 ExclusionSourceProduct 的註解:預設不比條款
    // 🔵 比對前兩邊都先**去 HTML 標籤 + 壓空白 + 轉小寫** ——
    //    來源那一側是 HTML,而 needle 是生字串:標籤或換行只要落在中間就比不中,
    //    而 `DOES NOT FIT Monster 937 SP` 還是大小寫不同的寫法。
    const needle = normalizeClause(e.source).slice(0, 40).trim();
    const hit = rows.some((r) => needle !== '' && normalizeClause(r.description ?? '').includes(needle));
    if (needle !== '' && !hit) {
      out.push({ kind: 'clause-gone', brandSlug: e.brandSlug, externalId: e.externalId, source: needle });
    }
  }
  return out;
}

/** 把違規印成人看得懂的一行(匯入擋下來時要印這個)。 */
export function formatExclusionViolation(v: ExclusionReconcileViolation): string {
  switch (v.kind) {
    case 'missing-product':
      return `🔴 ${v.brandSlug}/${v.externalId}:例外表有這一筆, 而來源目錄裡【沒有這個料號】⇒ 這條例外已經沒有對象。`;
    case 'clause-gone':
      return `🔴 ${v.brandSlug}/${v.externalId}:那句原文在描述裡【找不到了】⇒ 供應商可能改了條款, 而我們還在對客人講舊的那一句。原文前段:「${v.source}」`;
    case 'duplicate-key':
      return `🔴 ${v.brandSlug}/${v.externalId}:同一個【品牌 + 料號】對到 ${v.count} 件商品 ⇒ 這條例外會【掛錯商品】。` +
        '這個鍵今天的前提是「品牌+料號唯一」(2026-09-18 實查 0 組撞號), 而它剛剛不成立了。⇒ 這條例外要改鍵, 不要靜靜挑一個。';
    case 'empty-entry':
      return `🔴 ${v.brandSlug}/${v.externalId}:這一筆 years 與 excludes 都是空的 ⇒ 它不會對客人產生任何效果。`;
  }
}
