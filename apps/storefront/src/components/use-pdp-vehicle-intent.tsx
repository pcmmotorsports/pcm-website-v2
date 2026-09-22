'use client';
// use-pdp-vehicle-intent.tsx — :901 商品詳情頁的車款 = 同一個車款意圖(plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §3-6)。
//
// 與列表頁(`use-catalog-vehicle-intent.tsx`)同一套規則,少了「選車列」那一半:
//   - 初始化:網址有車款就用(只差空白 / 橫線 / 大小寫也算);認不得 ⇒ notFound(不讀選車鏡);沒有 ⇒ 讀選車鏡。
//   - 落地處理:外部導航 / 上一頁落地時依網址改意圖;上一頁到沒有車款的網址 ⇒ 沒有車、清選車鏡。
//   - 登記車款字典:`navigateToCatalog` 在商品頁發起導航時也能在當下交接車款(§3-2)。
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { clearVehicleContext } from '@/lib/vehicle-context';
import { vehicleFromContext, resolveVehicleForUrl } from '@/lib/vehicle-url';
import {
  getVehicleIntent,
  initVehicleIntent,
  intentFromUrl,
  mirrorIntent,
  setKnownTaxonomy,
  setVehicleIntent,
  useVehicleIntent,
  type VehicleIntent,
} from '@/lib/vehicle-intent';
import { isFreshLanding, pendingHistoryLanding, setLandingHandler } from '@/lib/url-writer';

/** 網址沒有車款時的回退:讀選車鏡(同一 session 帶入;商品頁沒有關鍵字那條例外)。 */
function fromMirror(motoBrands: MockMotoBrand[]): VehicleIntent {
  const mirrored = vehicleFromContext(motoBrands);
  if (!mirrored) return { kind: 'none' };
  const r = resolveVehicleForUrl(mirrored, motoBrands);
  if (!r) return { kind: 'none' };
  return {
    kind: 'vehicle',
    segment: r.segment,
    brandName: r.brandObj.name,
    modelName: r.modelObj?.name,
    year: r.modelObj != null ? mirrored.year : undefined,
  };
}

export function usePdpVehicleIntent(opts: {
  searchParams: { toString(): string };
  motoBrands: MockMotoBrand[];
}): VehicleIntent | null {
  const { motoBrands } = opts;
  const pathname = usePathname();
  const firstRender = useRef(true);

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(opts.searchParams.toString());
    const here = `${pathname}?${params.toString()}`;
    if (getVehicleIntent() === null) {
      initVehicleIntent(intentFromUrl(params, motoBrands) ?? fromMirror(motoBrands));
    } else if (firstRender.current && isFreshLanding(here)) {
      // 從別頁進來(含上一頁):網址指名車款就用它;上一頁到沒有車款的網址就是沒有車(不先畫上一頁的舊車)
      const fromUrl = intentFromUrl(params, motoBrands);
      if (fromUrl) initVehicleIntent(fromUrl, { force: true });
      else if (pendingHistoryLanding() !== null) initVehicleIntent({ kind: 'none' }, { force: true });
      else if (getVehicleIntent()?.kind === 'notFound') initVehicleIntent({ kind: 'none' }, { force: true });
    }
  }
  firstRender.current = false;

  useEffect(() => {
    setKnownTaxonomy(motoBrands);
  }, [motoBrands]);

  useEffect(
    () =>
      setLandingHandler((params, source) => {
        const next = intentFromUrl(params, motoBrands);
        if (next) {
          setVehicleIntent(next);
          if (next.kind === 'vehicle') mirrorIntent(next);
          return;
        }
        if (source === 'history') {
          setVehicleIntent({ kind: 'none' });
          clearVehicleContext();
        } else if (getVehicleIntent()?.kind === 'notFound') {
          setVehicleIntent({ kind: 'none' });
        }
      }),
    [motoBrands],
  );

  return useVehicleIntent();
}
