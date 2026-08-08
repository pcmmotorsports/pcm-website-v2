// vehicle-match.ts — 車款打字比對核心(V-1b;值班台 plan verdict「統一=共用核心」之一)。
// 🔴 車種鐵律:只做字面正規化(trim/大小寫/全形半形=NFKC)+ prefix/substring 過濾,候選恆為
// 字典字面、零模糊/相似度/AI 猜;「唯一精確命中才自動套用」規格(REQUIRED-2)供愛車 chips(V-1c)共用。
// 純函式、無 React/DOM 依賴 → node 單測。

/** 查詢正規化:trim + NFKC(全形→半形)+ 小寫。顯示端永遠用字典原字面、本函式只用於比對。 */
export function normalizeVehicleQuery(q: string): string {
  return q.normalize('NFKC').trim().toLowerCase();
}

/**
 * 寬鬆比對鍵:在 `normalizeVehicleQuery` 之上再去掉分隔符(空白 / 連字號)。
 * **只給「打字過濾」用**(`filterVehicleOptions`)—— Sean 2026-08-08:打「RS6」要找得到「RS 660」。
 *
 * 🔴 **絕對不要把這段併進 `normalizeVehicleQuery`**。那支有四個消費者,其中兩個在資料層:
 *   - `vehicle-taxonomy.ts:76-77` 拿它當**節點去重鍵** ⇒ 去分隔符會把「MT 09」與「MT-09」
 *     折成同一個節點,兩台不同的車變一台(該檔 `:20-21` 逐字:「空白與連字號不互折,仍保留兩節點」)。
 *   - `fitment-match.ts:40-43` 拿它做 **PDP「這台車適用嗎」的精確比對** ⇒ 去分隔符會產生
 *     **假的「✓ 適用」**。那正是 codex MF-1 修掉的東西(該檔 `:6-10` 逐字:「slugify 會把『MT 09』
 *     與『MT-09』壓成同一 slug…**選 A 車命中 B 車 fitment 的假 ✓**」),而 `:3` 逐字寫著
 *     「**錯誤的「✓ 適用」比空白更糟(買錯裝不上=信任毀)**」。
 *
 * 🔴 **也不要讓 `uniqueExactMatch` 吃它**:那支決定「要不要**自動**替客人套上這台車」。
 *   兩邊猜錯的代價不對稱 —— 過濾寬鬆最差是候選多幾筆、**客人自己挑**(沒有錯誤結果落地);
 *   自動套用寬鬆則是客人打「rs6」被系統直接套上「RS 660」,而他要的可能是「RS 660 R」
 *   ⇒ 違反 REQUIRED-2「唯一精確命中才自動套用」的零猜規格。
 *
 * **只去 `\s` 與 `-`,不多不少**:`-` 是必要的(「gsx8」要命中「GSX-8S」);不去 `.` `/` `+` ——
 * 現行車款字面沒有靠它們區分的證據,而多去一個字元就多一分誤命中,等有實例再加。
 * ⚠️ `-` 只涵蓋 **ASCII hyphen**;NFKC **不會**把 `–`(en dash)/`—`(em dash)/`‐`(U+2010)折成它。
 *   後果是**找不到**、不是找錯(方向安全)。掃過 `mock-moto-brands.ts` 零實例 ⇒ 現在不處理;
 *   **真資料若出現那幾種破折號要重評**(R1 nit-⑩)。
 * ⚠️ **副作用(刻意接受、非本片目標)**:`vehicleLabel` 用**空格**串「品牌 車型」,空格折平之後
 *   「yamahamt」會命中「YAMAHA MT-09」= **跨詞命中**。吃 label 的有 `FilterDrawerVehicleTab`
 *   的跨層搜尋與 `garage-chip` 的建議清單兩條路;那多半是想要的(客人本來就常連著打),
 *   但它沒被派工單提過 ⇒ 在此申報並補了測試(R1 nit-⑦)。
 */
export function looseVehicleKey(s: string): string {
  return normalizeVehicleQuery(s).replace(/[\s-]+/g, '');
}

/**
 * 打字過濾:prefix 命中優先(保序)、其後 substring 命中(保序);查詢空=全清單。
 * 回傳的是原 items 子集(字典字面直出、不改寫)。
 * 🔴 2026-08-08 起比對走 `looseVehicleKey`(**不是** `normalizeVehicleQuery`)——見該函式註解:
 *   這一層寬鬆是安全的(只影響候選清單、客人自己挑),但同樣的寬鬆放到資料層會做出假的「✓ 適用」。
 */
export function filterVehicleOptions<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  const strict = normalizeVehicleQuery(query);
  if (strict === '') return [...items]; // 真的沒打字 → 全清單(既有行為)
  // 🔴 查詢**只由分隔符組成**(客人打了一個「-」或幾個空白)⇒ 寬鬆鍵會變成空字串。
  //   若照「空查詢」處理會回**整份清單**,而畫面上的標題仍寫「符合『-』的車款」= 字面說謊
  //   (`FilterDrawerVehicleTab.tsx` 的 `searching` 判斷用的是 `query.trim() !== ''`,對「-」為 true)。
  //   ⇒ 這格退回嚴格鍵,保留舊行為(只列名稱真的含連字號的)。R1 nit-⑥ 抓到。
  const key = looseVehicleKey(query) === '' ? normalizeVehicleQuery : looseVehicleKey;
  const q = key(query);
  const prefix: T[] = [];
  const substr: T[] = [];
  for (const item of items) {
    const n = key(nameOf(item));
    if (n.startsWith(q)) prefix.push(item);
    else if (n.includes(q)) substr.push(item);
  }
  return [...prefix, ...substr];
}

/**
 * 唯一精確命中(REQUIRED-2 自動套用條件):正規化後全等的候選恰一個 → 回它;否則 null。
 * (0 個或多個=不自動套用,呼叫端展開建議清單讓客人明選=零猜。)
 */
export function uniqueExactMatch<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T | null {
  const q = normalizeVehicleQuery(query);
  if (q === '') return null;
  const hits = items.filter((item) => normalizeVehicleQuery(nameOf(item)) === q);
  return hits.length === 1 ? (hits[0] as T) : null;
}

/**
 * V-1d 字面構造收斂(值班台記錄項):「品牌 車型」顯示字面的唯一構造點。
 * chips 精確比對/表單組名/建議清單 label 全走此函式;slug 化(dict 欄)後比對走名稱字面
 * lookup、此字面只剩顯示用途。
 */
export function vehicleLabel(brandName: string, modelName: string): string {
  return `${brandName} ${modelName}`;
}
