'use client';

// use-lazy-brand-years.ts — 選車元件(VehicleSelect)自己補「目前這個牌子」的年份
//
// 2026-09-29 選車清單瘦身甲案(~/pcm-mailbox/計畫-選車清單瘦身-20260929.md):首頁、購物車、商品頁
// 送到瀏覽器的是底盤清單 —— 牌子、車款名字全在, 年份只留伺服器先補的幾個牌子, 其餘 `yearsLoaded: false`。
//
// 🔴 為什麼掛在「目前顯示的牌子」而不是「點選牌子」那一下(Fable R1 必修 2):
//   購物車從瀏覽器儲存回填的車、商品頁 sessionStorage 那台車都不經過點選, 伺服器也不知道它們;
//   只掛點選的話, 那幾台車的年份欄會永遠停在載入中。
// 🔴 為什麼不直接用 `use-brand-years.ts`(目錄頁那支):
//   ① 它用 `useEffect(() => setMotoBrands(server), [server])` 重設 ⇒ 呼叫端每次 render 傳新陣列
//     (例如 `ProductPage` 的 `motoBrands = []` 預設值)就會一直重設、甚至無限 render;
//     這裡改成「已補的年份另外存一份, 依牌子 id 疊上去」, 不需要重設。
//   ② 它的失敗是全站一個布林、成功也不歸零(R1 必修 3);這裡記「哪幾個牌子失敗」。
// 重試:失敗後客人清掉廠牌再選一次 ⇒ 目前牌子從無變有 ⇒ 這支再打一次。

import { useEffect, useMemo, useRef, useState } from 'react';

import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';

type VehicleModelsResponse = { brandId: string; models: MockMotoModel[] };

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
    void fetch(`/api/catalog/vehicle-models?brand=${encodeURIComponent(needId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`vehicle-models ${res.status}`);
        const body = (await res.json()) as VehicleModelsResponse;
        if (body.brandId !== needId || !Array.isArray(body.models)) {
          throw new Error(`vehicle-models 回傳的牌子或形狀不對(問 ${needId}, 回 ${String(body.brandId)})`);
        }
        setLoaded((prev) => new Map(prev).set(needId, body.models));
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

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}
