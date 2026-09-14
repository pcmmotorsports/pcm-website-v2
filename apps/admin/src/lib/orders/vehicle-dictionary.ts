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
 * 表單兩欄 ⇒ RPC 形狀。
 * 🔴 `pick` 只在「員工看到的字 = 選那一列時的字」才算數 —— 選完又改字 ⇒ 以他改後的字為準(照打)。
 *    這一條讓「畫面上看到什麼就存什麼」成立, 不靠 island 記得清 hidden。
 */
export function resolveManualOrderVehicle(text: string | null, pick: string | null): ManualOrderVehicleInput | null {
  const t = squash(text ?? '');
  if (t === '') return null;
  const p = parseVehiclePick(pick);
  if (p !== null && squash(p.display) === t) {
    return vehicleFromHit(p.hit, splitVehicleText(t).year);
  }
  return vehicleFromText(t);
}
