'use client';
// use-catalog-vehicle-intent.tsx — :901 列表頁的車款 = 車款意圖(plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §3-2、§3-4、§3-5 W1)。
//
// 取代兩個舊的東西:
//   - `useVehicleUrlSync`(D,選車 ⇒ 讀 `window.location` 再 `router.replace`):還沒落地時讀到舊網址 ⇒ 把舊車抄回去。
//   - `useDeepLinkRestore` 的車款那段(進站還原):卸載再掛載時 `useSearchParams` 可能是舊的 ⇒ 還原成舊車(實測 6)。
// 三個方向:
//   ① 意圖 ⇒ 選車列(`cascade.vehicle`):意圖變了(進站、外部導航落地、上一頁)⇒ 選車列跟著改,不算客人操作。
//   ② 選車列 ⇒ 意圖(W1):客人自己選車 / 清車 ⇒ 改意圖、寫 / 清選車鏡 ⇒ `writeSearch`(車款由意圖覆寫)。
//   ③ 落地處理:外部導航或上一頁落地時,依網址改意圖(`setLandingHandler`;需要車款字典所以放在頁面)。
// 網址車款判斷一律 `resolveVehicleFromUrl`(只差空白 / 橫線 / 大小寫才自動選;認不得 ⇒ notFound,不回退舊車)。
import { useEffect, useRef, type Dispatch } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  clearVehicle,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  type CascadeFilterAction,
  type CascadeFilterState,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { clearVehicleContext } from '@/lib/vehicle-context';
import { resolveVehicleForUrl, vehicleFromContext } from '@/lib/vehicle-url';
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
import { isFreshLanding, normalizeHref, pendingHistoryLanding, setLandingHandler, writeSearch } from '@/lib/url-writer';

type Vehicle = CascadeFilterState['vehicle'];

function sameVehicle(a: Vehicle, b: Vehicle): boolean {
  if (!a || !b) return a === b;
  return a.brand === b.brand && a.model === b.model && a.year === b.year;
}

/** 意圖畫在選車列上的樣子(認不得的車款不畫,上游 §9-3)。 */
export function vehicleOfIntent(intent: VehicleIntent | null): Vehicle {
  if (!intent || intent.kind !== 'vehicle') return null;
  return { brand: intent.brandName, model: intent.modelName, year: intent.year };
}

/** 選車列上的車 ⇒ 意圖;字典查不到 ⇒ null(照舊保守不動)。 */
function intentOfVehicle(v: NonNullable<Vehicle>, motoBrands: MockMotoBrand[]): VehicleIntent | null {
  const r = resolveVehicleForUrl(v, motoBrands);
  if (!r) return null;
  return {
    kind: 'vehicle',
    segment: r.segment,
    brandName: r.brandObj.name,
    modelName: r.modelObj?.name,
    year: r.modelObj != null ? v.year : undefined,
  };
}

/** 第一次載入:網址有車款就用;沒有 ⇒ 沒有關鍵字時讀選車鏡(照今天),有關鍵字時不讀(上游 §9-3)。 */
function initialIntent(params: URLSearchParams, motoBrands: MockMotoBrand[], keywordActive: boolean): VehicleIntent {
  const fromUrl = intentFromUrl(params, motoBrands);
  if (fromUrl) return fromUrl;
  if (keywordActive) return { kind: 'none' };
  const mirrored = vehicleFromContext(motoBrands);
  return (mirrored && intentOfVehicle(mirrored, motoBrands)) ?? { kind: 'none' };
}

export function useCatalogVehicleIntent(opts: {
  searchParams: URLSearchParams | { toString(): string };
  motoBrands: MockMotoBrand[];
  keywordActive: boolean;
  cascadeVehicle: Vehicle;
  dispatch: Dispatch<CascadeFilterAction>;
  /**
   * 意圖帶動選車列改變時呼叫。`fromMirror: false` = 來自網址 / 外部導航 / 上一頁 / 卸載再掛載,不是客人改篩選
   * ⇒ 頁碼保留;`true` = 進站時從選車鏡帶進來 = 篩選條件真的變了 ⇒ 回第 1 頁(舊 `useDeepLinkRestore` 拍板 A、R1 MF-3)。
   */
  onIntentDrivenChange: (fromMirror: boolean) => void;
  /** 外部導航 / 上一頁落地時,頁面其他篩選狀態跟著網址(Codex R4 必修 ①)。在意圖更新之後呼叫。 */
  onLanding: (params: URLSearchParams) => void;
}): void {
  const { motoBrands, keywordActive, cascadeVehicle, dispatch, onIntentDrivenChange } = opts;
  const onLandingRef = useRef(opts.onLanding);
  onLandingRef.current = opts.onLanding;
  const router = useRouter();

  // 只在意圖還沒初始化時(這個分頁第一次進列表頁 / 重新整理)讀網址;卸載再掛載沿用模組層的意圖。
  // 🔵 從別頁來到這一頁(網址還沒被 writer 處理過)而網址指名了車款 ⇒ 第一次 render 就用網址的車,
  //    不先畫出上一頁留下的意圖再改(否則會閃一下舊車)。卸載再掛載(已處理過的網址)不重讀(實測 6)。
  const fromMirror = useRef(false);
  const firstRender = useRef(true);
  const pathname = usePathname();
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(opts.searchParams.toString());
    const here = `${pathname}?${params.toString()}`;
    const pendingHistory = pendingHistoryLanding();
    const fromHistory = pendingHistory !== null && normalizeHref(pendingHistory) === normalizeHref(here);
    if (getVehicleIntent() === null) {
      const first = initialIntent(params, motoBrands, keywordActive);
      fromMirror.current = first.kind === 'vehicle' && intentFromUrl(params, motoBrands) === null;
      initVehicleIntent(first);
    } else if (firstRender.current && fromHistory) {
      // 🔴 上一頁(在別頁按、或頁面還在載入時按):第一次 render 就照歷史網址。
      //   🔴 這一格【不能】包在 `isFreshLanding` 裡:上一頁的目的網址可能與上次處理過的網址是同一個字串
      //   (例如先清車、再選車還沒落地時按上一頁),那時 `isFreshLanding` 是 false,
      //   而沒有這一格就會先用舊意圖寫一輪、再被落地處理改掉 ⇒ 兩邊來回、整頁卡住(Fable 片 4+5 R3 必修)。
      initVehicleIntent(intentFromUrl(params, motoBrands) ?? { kind: 'none' }, { force: true });
    } else if (firstRender.current && isFreshLanding(here)) {
      const fromUrl = intentFromUrl(params, motoBrands);
      if (fromUrl) initVehicleIntent(fromUrl, { force: true });
      else if (getVehicleIntent()?.kind === 'notFound') initVehicleIntent({ kind: 'none' }, { force: true });
    }
  }
  firstRender.current = false;
  const intent = useVehicleIntent();

  useEffect(() => {
    setKnownTaxonomy(motoBrands);
  }, [motoBrands]);

  // ③ 落地處理
  useEffect(
    () =>
      setLandingHandler((params, source) => {
        const next = intentFromUrl(params, motoBrands);
        if (next) {
          setVehicleIntent(next);
          if (next.kind === 'vehicle') mirrorIntent(next);
        } else if (getVehicleIntent()?.kind === 'notFound') {
          // 認不得的車款不是客人選的:換到沒有車款的網址 ⇒ 選車列本來就是空的 ⇒ 沒有車(上游 §9-3「維持目前選車」)
          setVehicleIntent({ kind: 'none' });
        } else if (source === 'history') {
          // 網址沒有車款:上一頁 ⇒ 以歷史網址為準(沒有就是沒有,不補回);外部導航 ⇒ 保留意圖、由 writer 補寫
          // 選車鏡跟著清(否則重新整理會把鏡裡的車再帶回來;Codex 片 4+5 R1 必修 5)
          setVehicleIntent({ kind: 'none' });
          clearVehicleContext();
        }
        onLandingRef.current(params);
      }),
    [motoBrands],
  );

  // ① 意圖 ⇒ 選車列
  // ① 派給選車列的那台車:② 看到同一台時就知道「這是意圖帶動的,不是客人選的」(避免兩邊來回)
  //   🔴 用清單不是單一值:① 與 ② 可能在同一次 commit 先後跑,單一值會被 ① 蓋掉 ② 還沒讀到的那一筆
  //   (Fable 片 4+5 R3 必修的另一半)。
  const drivenVehicles = useRef<Vehicle[]>([]);
  const onDriven = useRef(onIntentDrivenChange);
  onDriven.current = onIntentDrivenChange;
  useEffect(() => {
    if (!intent) return;
    const want = vehicleOfIntent(intent);
    if (sameVehicle(want, cascadeVehicle)) return;
    drivenVehicles.current.push(want);
    onDriven.current(fromMirror.current);
    // 從鏡帶進來的車可能已被字典校正(例如年份已不在清單)⇒ 鏡寫回校正後的值(必修 5)
    if (fromMirror.current && intent.kind === 'vehicle') mirrorIntent(intent);
    fromMirror.current = false;
    if (!want) {
      dispatch(clearVehicle());
      return;
    }
    dispatch(selectVehicleBrand(want.brand));
    if (want.model) dispatch(selectVehicleModel(want.model));
    if (want.year !== undefined) dispatch(selectVehicleYear(want.year));
    // 只看意圖變化;選車列的變化由下一段判斷是不是客人操作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, dispatch]);

  // ② 選車列 ⇒ 意圖(W1):只在選車列真的變了、而且不是意圖帶動的時候
  const prevCascade = useRef(cascadeVehicle);
  useEffect(() => {
    if (sameVehicle(prevCascade.current, cascadeVehicle)) return;
    prevCascade.current = cascadeVehicle;
    if (sameVehicle(vehicleOfIntent(getVehicleIntent()), cascadeVehicle)) return;
    const hit = drivenVehicles.current.findIndex((v) => sameVehicle(v, cascadeVehicle));
    if (hit >= 0) {
      drivenVehicles.current.splice(hit, 1); // ① 派下去的那一台,不是客人選的;用掉就丟
      return;
    }
    drivenVehicles.current = []; // 客人自己選了 ⇒ 之前派下去而沒用到的都作廢
    if (!cascadeVehicle) {
      setVehicleIntent({ kind: 'none' });
      clearVehicleContext();
    } else {
      const next = intentOfVehicle(cascadeVehicle, motoBrands);
      if (!next || next.kind !== 'vehicle') return; // 字典查不到 ⇒ 保守不動(照舊)
      setVehicleIntent(next);
      mirrorIntent(next);
    }
    writeSearch(router, () => {});
  }, [cascadeVehicle, motoBrands, router]);
}
