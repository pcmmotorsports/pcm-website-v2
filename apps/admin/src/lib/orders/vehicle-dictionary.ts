import { filterVehicleOptions, looseVehicleKey } from '@pcm/domain';
// vehicle-dictionary.ts — 後台建單「車種」一格的純函式層(#956 乙, 2026-09-14):
//   · 員工打的一串字(例 `2021 CBR`)⇒ 拆年份 + 關鍵字
//   · 字典命中列 ⇒ 顯示字面 / 送 RPC 的 {kind:'dict'} 形狀
//   · 沒對到 ⇒ {kind:'free', raw}(照打照存;source 由 RPC 寫 manual_text, client 不送)
// 🔴 零 I/O:查字典那一發在 `vehicle-dictionary-action.ts`(server action, 走員工閘)。

/** 字典一列(`vehicle_taxonomy_public`:moto_brand / model_code / year_start / year_end)。 */
export type VehicleDictionaryHit = {
  readonly brand: string;
  readonly model: string;
};

/** 送 RPC `p_vehicle` 的形狀(判別式與 order_items.vehicle_snapshot 同款;`source` 不送 —— RPC 自己寫)。 */
export type ManualOrderVehicleInput =
  | { kind: 'dict'; brand: string; model: string; year?: number }
  | { kind: 'free'; raw: string; year?: number };

/**
 * 2026-10-02 Sean:後台車種搜尋要跟顧客站一樣聰明 ⇒ 比對共用顧客站的 vehicle-match(@pcm/domain), 不另寫一份:
 *   大小寫、連字號、空格、全形半形都忽略(looseVehicleKey);開頭命中排前、中段命中其次(filterVehicleOptions)。
 * 本函式只多做兩件事:同品牌同車型去重、同一組裡「越短越接近」排前(GSX 先列 GSX-8T 再列 GSX1300R Hayabusa), 最多 max 筆。
 * 字典沒有的車 ⇒ 空陣列(畫面照舊只剩「照打」)。
 */
export function rankVehicleHits(all: readonly VehicleDictionaryHit[], query: string, max: number): VehicleDictionaryHit[] {
  const seen = new Set<string>();
  const uniq: VehicleDictionaryHit[] = [];
  for (const h of all) {
    const k = `${h.brand}|${h.model}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(h);
  }
  uniq.sort(
    (a, b) =>
      looseVehicleKey(a.model).length - looseVehicleKey(b.model).length ||
      a.model.localeCompare(b.model) ||
      a.brand.localeCompare(b.brand),
  );
  return filterVehicleOptions(uniq, query, (h) => h.model).slice(0, max);
}

/**
 * 資料庫那一頭的粗篩(PostgREST 的 ilike 不能先去掉連字號):查詢折疊後的每個字元之間都插 %,
 * 例「gsx8s」⇒ `%g%s%x%8%s%`, 對得到「GSX-8S」。它是超集, 真正的比對與排序在 rankVehicleHits。
 * 折疊後不到 2 個字 ⇒ null(不查)。
 */
export function looseIlikePattern(query: string, anchored = false): string | null {
  const key = looseVehicleKey(query).replace(/[%_\\]/g, '');
  if ([...key].length < 2) return null;
  // anchored = 開頭命中那一組(例「mt」⇒ `m%t%`):短查詢的中段命中可能超過 1000 列, 開頭命中另撈一次, 保證排最前的那些不會被截掉。
  return `${anchored ? '' : '%'}${[...key].join('%')}%`;
}

/** 員工打的字 ⇒ {year?, q}:開頭 4 碼年份(1900-2100)拆出來, 其餘去頭尾空白當關鍵字。 */
export function splitVehicleText(text: string): { year: number | undefined; q: string } {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^((?:19|20)\d{2})(?:\s+(.*))?$/.exec(t);
  if (m) {
    const year = Number(m[1]);
    if (year >= 1900 && year <= 2100) return { year, q: (m[2] ?? '').trim() };
  }
  return { year: undefined, q: t };
}

/** 字典命中 ⇒ 員工看到的一串字(年份有就帶;與圖上「2021 CBR1000RR-R」同形)。 */
export function vehicleHitDisplay(hit: VehicleDictionaryHit, year: number | undefined): string {
  return year === undefined ? hit.model : `${year} ${hit.model}`;
}

/** 選了字典列 ⇒ dict 形狀。 */
export function vehicleFromHit(hit: VehicleDictionaryHit, year: number | undefined): ManualOrderVehicleInput {
  return year === undefined
    ? { kind: 'dict', brand: hit.brand, model: hit.model }
    : { kind: 'dict', brand: hit.brand, model: hit.model, year };
}

/** 照打 ⇒ free 形狀;全空 ⇒ null(沒填車)。 */
export function vehicleFromText(text: string): ManualOrderVehicleInput | null {
  const { year, q } = splitVehicleText(text);
  if (q === '') {
    // 只打了一個年份、沒有車名 ⇒ 年份當 raw 存(比丟掉好;RPC 那邊 raw 非空即可)。
    if (year === undefined) return null;
    return { kind: 'free', raw: String(year) };
  }
  return year === undefined ? { kind: 'free', raw: q } : { kind: 'free', raw: q, year };
}

/** 隱藏欄位 `vehicle_pick`(選了字典列才有)⇒ 解回 dict;壞形狀 ⇒ null(當成沒選, 走照打)。 */
export function parseVehiclePick(raw: string | null): { hit: VehicleDictionaryHit; display: string } | null {
  if (raw === null || raw === '') return null;
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j !== 'object' || j === null) return null;
    const o = j as Record<string, unknown>;
    if (typeof o['brand'] !== 'string' || typeof o['model'] !== 'string' || typeof o['display'] !== 'string') return null;
    if (o['brand'].trim() === '' || o['model'].trim() === '') return null;
    return { hit: { brand: o['brand'].trim(), model: o['model'].trim() }, display: o['display'] };
  } catch {
    return null;
  }
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * 2026-10-02 Sean:「年份」一格(建單畫面與訂單頁「編輯個資」共用)。留白 ⇒ undefined;4 碼西元年 1900-2100 ⇒ 數字;其他 ⇒ 'invalid'。
 * 範圍與 RPC 同一條(建單函式 263:251-257、編輯個資第 6 代)。
 */
export function parseVehicleYear(raw: string | null): number | undefined | 'invalid' {
  const t = (raw ?? '').trim();
  if (t === '') return undefined;
  const y = Number(t);
  return /^\d{4}$/.test(t) && y >= 1900 && y <= 2100 ? y : 'invalid';
}

/**
 * 表單兩欄 ⇒ RPC 形狀。
 * 🔴 `pick` 只在「員工看到的字 = 選那一列時的字」才算數 —— 選完又改字 ⇒ 以他改後的字為準(照打)。
 *    這一條讓「畫面上看到什麼就存什麼」成立, 不靠 island 記得清 hidden。
 * 2026-10-02 Sean:多一格「年份」(`year`)。有填 ⇒ 蓋過車種開頭打的年份;沒填 ⇒ 照舊從車種開頭拆。
 */
export function resolveManualOrderVehicle(
  text: string | null,
  pick: string | null,
  year?: number,
): ManualOrderVehicleInput | null {
  const t = squash(text ?? '');
  if (t === '') return null;
  const p = parseVehiclePick(pick);
  const v = p !== null && squash(p.display) === t ? vehicleFromHit(p.hit, splitVehicleText(t).year) : vehicleFromText(t);
  return v === null || year === undefined ? v : { ...v, year };
}
