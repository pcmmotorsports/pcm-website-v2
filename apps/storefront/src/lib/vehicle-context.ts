// vehicle-context.ts — 跨頁車款 context(V-1c;值班台 plan verdict Q5+REQUIRED-3)。
// 🔴 語意:URL `?vehicle=` 恆為第一真相、storage 只是鏡(供 V-2 PDP/購物車「同 session 帶入」
// =Sean Q2=A;跨 session 靠車庫、不越權持久化 → sessionStorage 非 localStorage)。
// 純函式+防禦讀取:JSON.parse try/catch+形狀逐欄驗證,壞資料→null 絕不 throw;storage 以參數
// 注入(預設 window.sessionStorage)=node 可測、SSR 安全(呼叫端只在 client 事件內呼)。
// design 先例:design ProductPage.jsx L40-82 SPA globalVehicle 跨頁=本檔為其 storefront 轉譯。

export const VEHICLE_CONTEXT_KEY = 'pcm.vehicle.v1'; // key 帶版本、schema 演進換 key

export type VehicleContextValue = {
  /** taxonomy slug 三段(與 URL ?vehicle= 同 id 空間) */
  brandId: string;
  modelId?: string;
  year?: number;
  /** 顯示 label(字典字面組合;僅顯示用、比對一律回字典) */
  label: string;
  // V-2a REQUIRED-3(值班台):字典名稱字面 additive optional 欄——寫入點本手握名稱、供購物車
  // 自動帶入(路徑1)組 CartItem kind:'dict' 用(避免 label 反解析=脆)。舊 context 缺此欄
  // → 讀回為 undefined → 消費端不自動帶入(零猜);不 bump KEY=非 breaking、防禦讀取容缺欄。
  brandName?: string;
  modelName?: string;
  savedAt: number;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null; // storage 拒絕存取(隱私模式等)→ 靜默略過、URL 真相不受影響
  }
}

export function writeVehicleContext(
  value: Omit<VehicleContextValue, 'savedAt'>,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(VEHICLE_CONTEXT_KEY, JSON.stringify({ ...value, savedAt: Date.now() }));
  } catch {
    // 配額滿/拒絕寫入 → 靜默略過(鏡而已)
  }
}

export function clearVehicleContext(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(VEHICLE_CONTEXT_KEY);
  } catch {
    // 同上
  }
}

/** 防禦讀取:缺/壞 JSON/形狀不符 → null(絕不 throw);不驗值是否仍在字典(消費端自驗)。 */
export function readVehicleContext(
  storage: StorageLike | null = defaultStorage(),
): VehicleContextValue | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(VEHICLE_CONTEXT_KEY);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.brandId !== 'string' || o.brandId === '') return null;
    if (o.modelId !== undefined && typeof o.modelId !== 'string') return null;
    if (o.year !== undefined && !Number.isInteger(o.year)) return null;
    if (typeof o.label !== 'string' || typeof o.savedAt !== 'number') return null;
    // additive 名稱字面欄:present 必為 string、缺欄=undefined(舊 context 相容、不擋整筆)
    if (o.brandName !== undefined && typeof o.brandName !== 'string') return null;
    if (o.modelName !== undefined && typeof o.modelName !== 'string') return null;
    return {
      brandId: o.brandId,
      modelId: o.modelId as string | undefined,
      year: o.year as number | undefined,
      label: o.label,
      brandName: o.brandName as string | undefined,
      modelName: o.modelName as string | undefined,
      savedAt: o.savedAt,
    };
  } catch {
    return null;
  }
}
