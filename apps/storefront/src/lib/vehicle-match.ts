// vehicle-match.ts — 車款打字比對核心(V-1b;值班台 plan verdict「統一=共用核心」之一)。
// 🔴 車種鐵律:只做字面正規化(trim/大小寫/全形半形=NFKC)+ prefix/substring 過濾,候選恆為
// 字典字面、零模糊/相似度/AI 猜;「唯一精確命中才自動套用」規格(REQUIRED-2)供愛車 chips(V-1c)共用。
// 純函式、無 React/DOM 依賴 → node 單測。

/** 查詢正規化:trim + NFKC(全形→半形)+ 小寫。顯示端永遠用字典原字面、本函式只用於比對。 */
export function normalizeVehicleQuery(q: string): string {
  return q.normalize('NFKC').trim().toLowerCase();
}

/**
 * 打字過濾:prefix 命中優先(保序)、其後 substring 命中(保序);查詢空=全清單。
 * 回傳的是原 items 子集(字典字面直出、不改寫)。
 */
export function filterVehicleOptions<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  const q = normalizeVehicleQuery(query);
  if (q === '') return [...items];
  const prefix: T[] = [];
  const substr: T[] = [];
  for (const item of items) {
    const n = normalizeVehicleQuery(nameOf(item));
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
