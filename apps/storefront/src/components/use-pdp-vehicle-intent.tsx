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
import { vehicleFromContext, resolveVehicleForUrl, vehicleUrlParam } from '@/lib/vehicle-url';
import {
  getVehicleIntent,
  commitVehicleIntent,
  initVehicleIntent,
  intentFromUrl,
  mirrorIntent,
  setKnownTaxonomy,
  setUnverifiedUrlVehicle,
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
  /**
   * 車款清單這一發**撈失敗**(route 給的)。
   * 🔴 不能用「字典是不是空的」代替:route 對「這一頁不需要撈」也給空字典而 failed = false
   *   (`app/products/[slug]/page.tsx:236-240`),而那兩件事的安全做法相反。
   */
  taxonomyFailed?: boolean;
}): VehicleIntent | null {
  const { motoBrands, taxonomyFailed = false } = opts;
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

  // 畫面每次真的提交之後,把「已提交的那一份」對齊(購物車讀它;理由見 `getCommittedVehicleIntent`)
  useEffect(() => {
    commitVehicleIntent();
  });

  // 🔴 網址指名了一台車、而這一頁沒有車款清單可以驗(Codex 總審必修 2)⇒ 標成「驗不了」:
  //   購物車這時不帶車、網址也不被舊意圖蓋掉(理由寫在 `setUnverifiedUrlVehicle` 的說明)。
  //   在 effect 裡設、離開這一頁就清掉 —— render 當中改全域值正是必修 1 要避免的事。
  const searchString = opts.searchParams.toString();
  useEffect(() => {
    const input = vehicleUrlParam(new URLSearchParams(searchString));
    setUnverifiedUrlVehicle(taxonomyFailed && input !== null ? input : null);
    return () => setUnverifiedUrlVehicle(null);
  }, [taxonomyFailed, searchString]);

  useEffect(() => {
    setKnownTaxonomy(motoBrands);
  }, [motoBrands]);

  useEffect(
    () =>
      setLandingHandler((params, source) => {
        // 🔴 「網址上有沒有車款」不需要字典就判得出來 ⇒ 這一段要排在空字典守衛【之前】
        //   (Codex 總審必修 3)。反過來的話:客人看通用商品 ⇒ 去別頁選車 ⇒ 按上一頁回到這個
        //   沒有車款的網址 ⇒ 空字典守衛直接結束、跳過下面的清除 ⇒ 意圖與選車鏡還留著後來選的那台車,
        //   畫面沒有車而加入購物車帶著車。
        if (vehicleUrlParam(params) === null) {
          if (source === 'history') {
            // 上一頁:以歷史網址為準(沒有就是沒有),選車鏡跟著清,否則重新整理會把它帶回來
            setVehicleIntent({ kind: 'none' });
            clearVehicleContext();
          } else if (getVehicleIntent()?.kind === 'notFound') {
            // 認不得的車款不是客人選的 ⇒ 換到沒有車款的網址就是沒有車(不撿選車鏡裡的舊車)
            setVehicleIntent({ kind: 'none' });
          }
          return;
        }
        if (motoBrands.length === 0) return; // 網址有車款而字典是空的 ⇒ 認不認得判不了(上面那發 effect 已經標成「驗不了」)
        const next = intentFromUrl(params, motoBrands);
        if (next) {
          setVehicleIntent(next);
          if (next.kind === 'vehicle') mirrorIntent(next);
        }
      }),
    [motoBrands],
  );

  return useVehicleIntent();
}
