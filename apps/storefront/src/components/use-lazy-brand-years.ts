'use client';

// use-lazy-brand-years.ts — 選車元件(VehicleSelect)自己補「目前這個牌子」的年份
//
// 2026-09-29 選車清單瘦身甲案(~/pcm-mailbox/計畫-選車清單瘦身-20260929.md):首頁、購物車、商品頁
// 送到瀏覽器的是底盤清單 —— 牌子、車款名字全在, 年份只留伺服器先補的幾個牌子, 其餘 `yearsLoaded: false`。
//
// 🔴 為什麼掛在「目前顯示的牌子」而不是「點選牌子」那一下(Fable R1 必修 2):
//   購物車從瀏覽器儲存回填的車、商品頁 sessionStorage 那台車都不經過點選, 伺服器也不知道它們;
//   只掛點選的話, 那幾台車的年份欄會永遠停在載入中。
// 🔴 為什麼取代舊的 `use-brand-years.ts`(目錄頁原本那支, 2026-09-29 刪除):
//   ① 它用 `useEffect(() => setMotoBrands(server), [server])` 重設 ⇒ 呼叫端每次 render 傳新陣列
//     (例如 `ProductPage` 的 `motoBrands = []` 預設值)就會一直重設、甚至無限 render;
//     這裡改成「已補的年份另外存一份, 依牌子 id 疊上去」, 不需要重設。
//   ② 它的失敗是全站一個布林、成功也不歸零(R1 必修 3);這裡記「哪幾個牌子失敗」。
// 用在:VehicleSelect(首頁 / 購物車 / 商品頁)、目錄頁 ProductsPage 與它的三個選車元件
//   (CascadeFilterTop / MobileVehicleSheet / FilterDrawerVehicleTab)。
// 重試:失敗後客人清掉廠牌再選一次 ⇒ 目前牌子從無變有 ⇒ 這支再打一次。

import { useEffect, useMemo, useRef, useState } from 'react';

import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';

type VehicleModelsResponse = { brandId: string; models: MockMotoModel[] };

/** 年份還沒補到時年份欄的字(四個選車元件共用;不是「不限年份」)。 */
export const YEARS_LOADING_TEXT = '年份載入中…';
/** 補年份失敗時年份欄的字。390 寬首頁那一格放得下的長度;重選同一個牌子不會觸發重打, 所以要「清除」再選。 */
export const YEARS_FAILED_TEXT = '年份讀取失敗，請清除廠牌再選';
/** 補年份那一發最多等多久(含讀回應內容)。超過就當失敗, 走上面那句與「清除再選」重試。
 *  🔴 為什麼要有:沒有上限時 API 一直不回, 手機面板的套用鈕會停在「年份載入中…」到瀏覽器自己放棄為止。 */
export const YEARS_FETCH_TIMEOUT_MS = 8000;

export function useLazyBrandYears(
  motoBrands: MockMotoBrand[],
  currentBrandName: string | null | undefined,
): { motoBrands: MockMotoBrand[]; yearsPending: boolean; yearsFailed: boolean } {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, MockMotoModel[]>>(() => new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const inflight = useRef<Set<string>>(new Set());

  const current = currentBrandName ? motoBrands.find((b) => b.name === currentBrandName) : undefined;
  const needId = current && current.yearsLoaded === false && !loaded.has(current.id) ? current.id : null;

  useEffect(() => {
    if (needId === null || inflight.current.has(needId)) return;
    inflight.current.add(needId);
    setFailed((prev) => withoutId(prev, needId));
    void loadBrandModels(needId)
      .then((models) => {
        setLoaded((prev) => new Map(prev).set(needId, models));
      })
      .catch((err) => {
        console.error('[useLazyBrandYears] 年份補抓失敗:', err);
        setFailed((prev) => new Set(prev).add(needId));
      })
      .finally(() => {
        inflight.current.delete(needId);
      });
  }, [needId]);

  const merged = useMemo(
    () =>
      loaded.size === 0
        ? motoBrands
        : motoBrands.map((b) => {
            const models = loaded.get(b.id);
            return models ? { ...b, models, yearsLoaded: true } : b;
          }),
    [motoBrands, loaded],
  );

  return {
    motoBrands: merged,
    yearsPending: needId !== null,
    yearsFailed: needId !== null && failed.has(needId),
  };
}

/**
 * 同一個牌子正在補的那一發(模組層, 全頁共用)。
 * 🔴 為什麼要有:目錄頁 ProductsPage、桌機選車列、手機面板各自掛一份這支 hook, 同一個牌子會同時打 3 發
 *    (2026-09-29 正式站實點量到)。同牌子進行中就等同一個 Promise。
 * 🔴 一結束(成功、失敗、逾時)就從這裡拿掉:成功的年份各元件自己存;失敗要讓「清除廠牌再選」能再打一發。
 * ⏱️ 8 秒逾時從第一個要的元件算起;晚加入的元件只等剩下的時間(伺服器對這個牌子已經那麼久沒回)。
 */
const pendingByBrand = new Map<string, Promise<MockMotoModel[]>>();

function loadBrandModels(brandId: string): Promise<MockMotoModel[]> {
  const existing = pendingByBrand.get(brandId);
  if (existing) return existing;
  // 用 AbortController + setTimeout 而不是 `AbortSignal.timeout()`:後者 Safari / iOS 16 才有(iOS 15 及更早沒有), 呼叫就直接丟錯。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YEARS_FETCH_TIMEOUT_MS);
  const request = fetch(`/api/catalog/vehicle-models?brand=${encodeURIComponent(brandId)}`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`vehicle-models ${res.status}`);
      const body = (await res.json()) as VehicleModelsResponse;
      if (body.brandId !== brandId || !Array.isArray(body.models)) {
        throw new Error(`vehicle-models 回傳的牌子或形狀不對(問 ${brandId}, 回 ${String(body.brandId)})`);
      }
      return body.models;
    })
    .finally(() => {
      clearTimeout(timer);
      // 只刪自己那一發(測試的 reset 之後可能已經有新的一發在表上)。
      if (pendingByBrand.get(brandId) === request) pendingByBrand.delete(brandId);
    });
  pendingByBrand.set(brandId, request);
  return request;
}

/** 僅測試用, 正式碼不得呼叫:清掉進行中的共用請求(某一格留下一發永遠不回的假請求時, 不讓它漏到下一格)。 */
export function resetBrandYearsRequestsForTests(): void {
  pendingByBrand.clear();
}

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}
