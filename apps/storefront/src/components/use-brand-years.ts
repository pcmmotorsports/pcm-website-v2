'use client';
// use-brand-years.ts — 選了牌子才把那個牌子的年份抓回來(plan 2026-09-14 P2 的 client 那一半)。
//
// server 給的 `motoBrands` 是瘦身版(`lib/vehicle-tree-payload.ts`):牌子與車款名字都在,
// 年份只在 server 已知會用到的牌子上。本 hook 把「客人在畫面上選到哪個牌子」接到
// `/api/catalog/vehicle-models?brand=<id>`,回來的 `models`(含 years)整包蓋回那個牌子。
//
// 🔴 三件不變式:
//   ① 同一個牌子只抓一次(抓過 / 抓中 / server 已帶 ⇒ 不再打);
//   ② 抓失敗 ⇒ `yearsFailed = true` 讓呼叫端走 `VehicleTaxonomyNotice` 那扇門(「這次讀不到」要講),
//      **不靜默**;那個牌子仍然可以選,只是年份下拉暫時是空的;
//   ③ 蓋回去的是**整個 models 陣列**(不是逐款 merge)—— 端點回的就是同一份字典切出來的,
//      名字與 id 一致;整包換掉最不會留下半新半舊。
//
// 為什麼是 state 不是 context:`motoBrands` 在 `ProductsPage` 已經是一顆 prop 往下傳給
// 十幾個消費端;把它換成 `useState(serverProp)` 之後,每個消費端一個字不用改。

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';

type VehicleModelsResponse = { brandId: string; models: MockMotoModel[] };

export function useBrandYears(serverMotoBrands: MockMotoBrand[]): {
  motoBrands: MockMotoBrand[];
  /** 確保這個牌子(用 **name**,與 cascade.vehicle.brand 同一個字面)的年份在手上。 */
  ensureYearsFor: (brandName: string | null | undefined) => void;
  yearsFailed: boolean;
} {
  const [motoBrands, setMotoBrands] = useState(serverMotoBrands);
  const [yearsFailed, setYearsFailed] = useState(false);
  // 抓過 / 抓中的牌子 id;用 ref 不進 state,免得 effect 依賴它而重跑。
  const inflight = useRef<Set<string>>(new Set());

  // server prop 換了(換頁、換 query 重新 render)⇒ 以新的 prop 為準,重新開始。
  useEffect(() => {
    setMotoBrands(serverMotoBrands);
    inflight.current = new Set();
  }, [serverMotoBrands]);

  const ensureYearsFor = useCallback(
    (brandName: string | null | undefined) => {
      if (!brandName) return;
      const brand = motoBrands.find((b) => b.name === brandName);
      if (!brand || brand.yearsLoaded !== false) return;
      if (inflight.current.has(brand.id)) return;
      inflight.current.add(brand.id);
      void fetch(`/api/catalog/vehicle-models?brand=${encodeURIComponent(brand.id)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`vehicle-models ${res.status}`);
          return (await res.json()) as VehicleModelsResponse;
        })
        .then((body) => {
          setMotoBrands((prev) =>
            prev.map((b) =>
              b.id === body.brandId ? { ...b, models: body.models, yearsLoaded: true } : b,
            ),
          );
        })
        .catch((err) => {
          console.error('[useBrandYears] 年份補抓失敗:', err);
          inflight.current.delete(brand.id); // 讓下一次選同一個牌子能再試一次
          setYearsFailed(true);
        });
    },
    [motoBrands],
  );

  return { motoBrands, ensureYearsFor, yearsFailed };
}
