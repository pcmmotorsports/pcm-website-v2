// vehicle-intent.ts — :901 車款意圖:客人現在要的車款,**單一來源、放模組層**(跨元件卸載保留)。
//
// plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §3-2。
// 為什麼放模組層:實測(`~/pcm-mailbox/901-原型-20260922/實測結果-20260922.md`)卸載再掛載時
//   `useSearchParams` 可能還是舊網址,只放元件 state 的車款會被舊網址蓋回(S8)。
// 誰可以改:客人的操作(選車、清車、清除全部、移除車款條件、點建議)與外部導航落地(`url-writer` 的落地處理)。
// 誰讀:所有寫網址的地方(`writeSearch` 會用它覆寫車款參數)、帶車款的連結、加入購物車、選車列。
import { useSyncExternalStore } from 'react';
import { resolveVehicleFromUrl, withVehicleParam } from '@/lib/vehicle-url';
import { writeVehicleContext } from '@/lib/vehicle-context';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

export type VehicleIntent =
  | { kind: 'vehicle'; segment: string; brandName: string; modelName?: string; year?: number }
  | { kind: 'none' }
  /** 網址上認不得的車款:原字串保留在網址上,提示區塊才會是無狀態的 */
  | { kind: 'notFound'; input: string };

/** `null` = 這一頁還沒初始化(第一次載入的落地處理會設定它) */
let intent: VehicleIntent | null = null;
const listeners = new Set<() => void>();

export function getVehicleIntent(): VehicleIntent | null {
  return intent;
}

export function setVehicleIntent(next: VehicleIntent): void {
  intent = next;
  listeners.forEach((f) => f());
}

/**
 * 第一次掛載時在 render 裡初始化(還沒初始化才設)。不通知訂閱者 —— render 當中通知會讓別的元件在
 * render 時 setState;訂閱者之後讀 `getVehicleIntent()` 自然拿到這個值。
 */
export function initVehicleIntent(first: VehicleIntent, opts: { force?: boolean } = {}): void {
  if (intent === null || opts.force) intent = first;
}

/** 網址 ⇒ 意圖(網址沒有車款輸入 ⇒ null,由呼叫端決定)。判斷規則在 `resolveVehicleFromUrl`。 */
export function intentFromUrl(params: URLSearchParams, motoBrands: MockMotoBrand[]): VehicleIntent | null {
  const r = resolveVehicleFromUrl(params, motoBrands);
  if (r.kind === 'ok') {
    return { kind: 'vehicle', segment: r.segment, brandName: r.vehicle.brand, modelName: r.vehicle.model, year: r.vehicle.year };
  }
  if (r.kind === 'notFound') return { kind: 'notFound', input: r.input };
  return null;
}

/** 選車鏡跟著意圖(與舊 `useVehicleUrlSync` 同一份欄位;購物車、商品頁讀它)。 */
export function mirrorIntent(v: Extract<VehicleIntent, { kind: 'vehicle' }>): void {
  writeVehicleContext({
    brandId: v.segment.split(':')[0]!,
    modelId: v.modelName !== undefined ? v.segment.split(':')[1] : undefined,
    year: v.year,
    label: [v.brandName, v.modelName, v.year].filter((x) => x != null).join(' '),
    brandName: v.brandName,
    modelName: v.modelName,
  });
}

/**
 * 目前頁面的車款字典(列表頁 / 商品頁掛上時登記)。給 `navigateToCatalog` 在發起導航當下就把目的網址的車款
 * 交接給意圖(plan §3-2):之後的操作以它為底,不會被舊意圖蓋回去(實測 S10)。
 */
let knownTaxonomy: MockMotoBrand[] | null = null;
export const setKnownTaxonomy = (t: MockMotoBrand[] | null): void => {
  knownTaxonomy = t;
};
export const getKnownTaxonomy = (): MockMotoBrand[] | null => knownTaxonomy;

export function subscribeVehicleIntent(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 伺服器端與第一次 render 一律回 `null`(還沒初始化),避免 hydration 不一致。 */
export function useVehicleIntent(): VehicleIntent | null {
  return useSyncExternalStore(subscribeVehicleIntent, getVehicleIntent, () => null);
}

/** 把網址參數的車款改成意圖指定的樣子(意圖是 `null` 時不動)。 */
export function applyVehicleIntent(params: URLSearchParams, current: VehicleIntent | null): URLSearchParams {
  if (!current) return params;
  if (current.kind === 'vehicle') return withVehicleParam(params, current.segment);
  if (current.kind === 'none') return withVehicleParam(params, null);
  return withVehicleParam(params, current.input);
}

/** 只給測試用:回到「還沒初始化」。 */
export function resetVehicleIntentForTests(): void {
  intent = null;
  knownTaxonomy = null;
  listeners.clear();
}
