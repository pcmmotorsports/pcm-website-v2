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
  committed = next; // 這條路來自客人的操作或落地處理,都在畫面提交之後 ⇒ 購物車立刻跟上
  listeners.forEach((f) => f());
}

/**
 * **已經畫到畫面上**的那一份車款意圖。加入購物車讀這一份,不讀上面那個「最新的」。
 *
 * 🔴 為什麼要分兩份(Codex 總審必修 1):`initVehicleIntent(..., { force: true })` 是在 **render 當中**
 *   改模組層的值,而那一次 render **不保證會畫出來** —— React 可以暫停或丟掉它(換頁時很常見)。
 *   只有一份的話:新頁那次 render 被丟掉,客人眼前還是舊頁(畫面、網址、選車鏡都是 MT-07),
 *   而加入購物車已經讀到新頁那台 R7 ⇒ **看到的與買到的不同,而且不會有任何提示**。
 *   ⇒ 這一份只在 effect 裡跟上(effect 只有畫面真的提交才會跑),所以它永遠等於客人看到的那台。
 */
let committed: VehicleIntent | null = null;
export function commitVehicleIntent(): void {
  committed = intent;
}
export function getCommittedVehicleIntent(): VehicleIntent | null {
  return committed;
}

/**
 * 第一次掛載時在 render 裡初始化(還沒初始化才設)。不通知訂閱者 —— render 當中通知會讓別的元件在
 * render 時 setState;訂閱者之後讀 `getVehicleIntent()` 自然拿到這個值。
 */
export function initVehicleIntent(first: VehicleIntent, opts: { force?: boolean } = {}): void {
  if (intent === null || opts.force) intent = first;
}

/**
 * 網址上有一台**驗不了**的車:車款清單讀不到(商品頁的通用商品 route 不撈清單、或那一發查詢失敗),
 * 所以「認不認得這台車」判不出來。值 = 網址上那個原字串;沒有就是 null。
 *
 * 🔴 為什麼要記它(Codex 總審必修 2):少了這一格,「不用查」與「查不到」長得一模一樣,而兩者的安全做法相反 ——
 *   · 不用查(通用商品、網址也沒有車):可以退回選車鏡,把客人這一 session 選的車帶進購物車。
 *   · 查不到而網址指名了一台:退回選車鏡 = **客人網址上寫 R7、購物車卻帶 MT-07**,
 *     而且舊意圖還會把 R7 從網址上蓋掉。
 *   ⇒ 驗不了的時候當作**沒有車**(加購不帶車、網址原封不動):看得見的缺優於安靜的錯。
 * 🔵 這不是「認不得的車」那條規則(那條是清單讀得到、而裡面沒有這台;它照舊顯示提示與 3 台建議)。
 */
let unverifiedUrlVehicle: string | null = null;
export function setUnverifiedUrlVehicle(input: string | null): void {
  unverifiedUrlVehicle = input;
}
export function getUnverifiedUrlVehicle(): string | null {
  return unverifiedUrlVehicle;
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
  // 網址上那台車驗不了 ⇒ 原封不動,不拿舊意圖去蓋掉客人指名的那一台(Codex 總審必修 2)
  if (unverifiedUrlVehicle !== null) return params;
  if (!current) return params;
  if (current.kind === 'vehicle') return withVehicleParam(params, current.segment);
  if (current.kind === 'none') return withVehicleParam(params, null);
  return withVehicleParam(params, current.input);
}

/** 只給測試用:回到「還沒初始化」。 */
export function resetVehicleIntentForTests(): void {
  intent = null;
  committed = null;
  unverifiedUrlVehicle = null;
  knownTaxonomy = null;
  listeners.clear();
}
