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
import { isFreshLanding, normalizeHref, pendingHistoryLanding, setLandingHandler } from '@/lib/url-writer';

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

  // 🔴 車款字典是空的(通用商品 route 不撈字典、或字典讀不到)⇒ 什麼都判不了:
  //   這時**不要**把意圖初始化成「沒有車」,否則選車鏡裡那台車會被當成不存在
  //   ⇒ 加入購物車不帶車、回目錄頁也拿不回來(Fable 片 9+10 R1 必修 1)。
  //   意圖維持 null ⇒ `readSearchVehicle` 自然退回選車鏡,目錄頁(有字典)進來時再初始化。
  if (typeof window !== 'undefined' && motoBrands.length > 0) {
    const params = new URLSearchParams(opts.searchParams.toString());
    const here = `${pathname}?${params.toString()}`;
    const pendingHistory = pendingHistoryLanding();
    const fromHistory = pendingHistory !== null && normalizeHref(pendingHistory) === normalizeHref(here);
    if (getVehicleIntent() === null) {
      initVehicleIntent(intentFromUrl(params, motoBrands) ?? fromMirror(motoBrands));
    } else if (firstRender.current && fromHistory) {
      // 上一頁:第一次 render 就照歷史網址(不包在 isFreshLanding 裡,理由同列表頁那支)
      initVehicleIntent(intentFromUrl(params, motoBrands) ?? { kind: 'none' }, { force: true });
    } else if (firstRender.current && isFreshLanding(here)) {
      const fromUrl = intentFromUrl(params, motoBrands);
      if (fromUrl) initVehicleIntent(fromUrl, { force: true });
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
        if (motoBrands.length === 0) {
          // 字典是空的 ⇒ 認不認得那台車判不了(同上面初始化那一段)。
          // 🔴 但「網址上根本沒有車款」這件事**不需要字典也判得出來**(Fable 片 9+10 R3 consider 2):
          //   認不得的車 ⇒ 點到沒帶車款的通用商品 ⇒ 少了這一段就會留著 notFound,
          //   於是那個認不得的字串被補回網址、頁面還畫「找不到這台車」。列表頁與有字典的商品頁都會放掉,
          //   只有通用商品頁不放 ⇒ 這裡補齊。方向與現行規則一致:改成「沒有車」,不撿選車鏡裡的舊車。
          if (intentFromUrl(params, motoBrands) === null && getVehicleIntent()?.kind === 'notFound') {
            setVehicleIntent({ kind: 'none' });
          }
          return;
        }
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
