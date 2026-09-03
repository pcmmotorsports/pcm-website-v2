// @vitest-environment jsdom
//
// useDeepLinkRestore 入站還原 — Q28①(2026-08-08 Sean 拍板 A|A|A|A):
// `/products` 在 URL 無車時回退讀全站選車鏡,讓 PDP「確認是否適用」選的車跳回列表能同步。
//
// 🔴 本檔用**組合 harness**(reducer + 5 支 hook)而非只 render 單一 hook:本片的行為改變有一半發生在
//    **接縫**上——鏡入站 → cascade.vehicle 非 null → useVehicleUrlSync 把車回寫 URL。只驗 dispatch 會漏掉
//    「URL 被改寫」「頁碼被重置」,更會漏掉 R1 MF-1(useCatalogFilterUrlSync 把那個改寫覆蓋掉)。
//    harness 的 hook 組成與呼叫序刻意對齊 `ProductsPage.tsx:242-280` 的五支:useDeepLinkRestore /
//    useVehicleUrlSync / useCatalogFilterUrlSync / useBrowseUrlState / usePageResetOnFilterChange。
//    (那邊增減 hook,這裡要跟——第一版就是漏掉 useCatalogFilterUrlSync 才讓 MF-1 逃過。)
//
// 🔴 `router.replace` **刻意只記錄、不套用**到 window.location:真實 App Router 的 replace 是導覽、
//    非同步(`/products` 是 force-dynamic,要 RSC 往返才更新網址)。第一版 mock 成同步
//    `history.replaceState` ⇒ 「兩支 hook 在同一輪各送一個 replace、後送的覆蓋先送的」這個窗口
//    在結構上不可構造 = MF-1 那類競態永遠測不出來。故觀察點改成**最後送出的那個網址**
//    (= 真實導覽的終態),effect 之間讀到的 window.location 則維持「replace 尚未落地」的舊值。
//
// 驗收對照 plan §6(`docs/specs/2026-08-08-q28a-products-read-vehicle-context-plan.md`)八條 + R1 三條,
// 每條的翻面突變寫在該條上方。
//
// ⚠️ 仍測不到、如實申報:replace 落地後 server 回新 props → effect 重跑那條路(需真 Next runtime);
//    真瀏覽器端到端本片零覆蓋(worktree 無 .env.local、taxonomy 實測回 0 筆)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useCallback, useMemo, useReducer, useRef } from 'react';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  type CascadeFilterAction,
  type CascadeFilterState,
} from '@pcm/ui';

const hoisted = vi.hoisted(() => ({ replaced: [] as string[] }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: (url: string) => hoisted.replaced.push(url), // 見檔頭:刻意不落 window.location
  }),
}));

import {
  useDeepLinkRestore,
  useVehicleUrlSync,
  useCatalogFilterUrlSync,
  useBrowseUrlState,
  usePageResetOnFilterChange,
} from './products-url-state';
import { writeVehicleContext, clearVehicleContext, VEHICLE_CONTEXT_KEY } from '@/lib/vehicle-context';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'YAMAHA',
    models: [
      { id: 'mt-09', name: 'MT-09', years: [2021, 2022] },
      { id: 'mt-07', name: 'MT-07', years: [2021] },
    ],
  },
  {
    id: 'aprilia',
    name: 'APRILIA',
    models: [{ id: 'rs-660', name: 'RS 660', years: [2022] }],
  },
] as MockMotoBrand[];

const CATEGORIES = [{ id: 'ride', name: '操控部品', children: [] }];
const EXTRAS = { price: null, priceRange: undefined, colors: [], inStock: false, isNew: false, isSale: false };

let actions: CascadeFilterAction[] = [];

/** ProductsPage 車輛線的最小組合(hook 序對齊 ProductsPage.tsx:242-280 的五支)。 */
function Harness({
  motoBrands = BRANDS,
  // 🔵 ⟦搜尋-落點換 /products⟧ R2 must-fix:預設 `false` = **既有行為**,
  //    所有既有格子逐字不變;只有本片新增的兩格會傳 `true`。
  keywordActive = false,
}: {
  motoBrands?: MockMotoBrand[];
  keywordActive?: boolean;
}) {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [cascade, rawDispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const dispatch = useCallback((a: CascadeFilterAction) => {
    actions.push(a);
    rawDispatch(a);
  }, []);
  const { page, setPage, sort, perPage } = useBrowseUrlState(searchParams);
  const skipPageResetOnce = useRef(false);
  const brandAppliedOnce = useRef(false);
  const filterResetKeyRef = useRef<string | null>(null);
  // 形狀對齊 ProductsPage.tsx:256 的 useMemo:motoBrands 換 identity(server 回新 props)⇒ effect 重跑
  const restoreSources = useMemo(
    () => ({ categories: CATEGORIES, productBrands: [] as { id: string }[], motoBrands }),
    [motoBrands],
  );

  useDeepLinkRestore({
    searchParams,
    motoBrands,
    categories: CATEGORIES,
    productBrands: [],
    dispatch,
    skipPageResetOnce,
    brandAppliedOnce,
    keywordActive,
  });
  useVehicleUrlSync(cascade.vehicle, motoBrands);
  useCatalogFilterUrlSync(cascade, EXTRAS, restoreSources);
  usePageResetOnFilterChange(
    JSON.stringify([cascade, EXTRAS, sort, perPage]),
    skipPageResetOnce,
    setPage,
    filterResetKeyRef,
  );

  // 🔵 `category` 是 2026-09-03 加的(R2 must-fix 那組要斷言它)—— 加一個觀察欄,
  //    而**既有格子沒有一個在讀它** ⇒ 加了不影響任何既有斷言。
  return (
    <output data-testid="s">
      {JSON.stringify({ vehicle: cascade.vehicle, category: cascade.category, page })}
    </output>
  );
}

type Observed = {
  vehicle: CascadeFilterState['vehicle'];
  category: CascadeFilterState['category'];
  page: number;
};

/** 掛 harness 於指定 URL;`url` = 導覽終態(最後送出的 replace,沒送過則維持進站網址)。 */
function mountAt(
  initial: string,
  opts: { strict?: boolean; motoBrands?: MockMotoBrand[]; keywordActive?: boolean } = {},
) {
  window.history.replaceState(null, '', initial);
  const tree = (mb?: MockMotoBrand[]) => (
    <Harness motoBrands={mb} keywordActive={opts.keywordActive} />
  );
  const wrap = (mb?: MockMotoBrand[]) =>
    opts.strict ? <StrictMode>{tree(mb)}</StrictMode> : tree(mb);
  const { rerender } = render(wrap(opts.motoBrands));
  return {
    /** 換一份 taxonomy 重繪(模擬 server 回新 props、車款下架) */
    withTaxonomy(mb: MockMotoBrand[]) {
      rerender(wrap(mb));
    },
    get state(): Observed {
      return JSON.parse(screen.getByTestId('s').textContent ?? '{}') as Observed;
    },
    /** 終態網址的 query（含 `?`;空 query = 空字串），語意同 window.location.search */
    get url(): string {
      const last = hoisted.replaced.at(-1) ?? initial;
      const qs = last.split('?')[1] ?? '';
      return qs ? `?${qs}` : '';
    },
  };
}

/** 預置一面鏡(模擬 PDP `commit()` 或首頁選車寫入)。 */
function seedMirror(v: { brandId: string; modelId?: string; year?: number }) {
  writeVehicleContext({ ...v, label: 'seeded' });
}

beforeEach(() => {
  actions = [];
  hoisted.replaced.length = 0;
});

afterEach(() => {
  cleanup();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
  window.history.replaceState(null, '', '/products');
});

// ── ⟦搜尋-落點換 /products⟧ 2026-09-03 · R2 must-fix ─────────────────────────
//
// 🔴🔴 **關鍵字結果頁上, facet 不得被還原進 cascade。**
//    `/products?search=` 走關鍵字資料路, 而**那條路吃不到任何 facet**。
//    而 `cascade` 一被灌進去, 它就同時餵給 `FilterSide`(checkbox 打勾)/
//    `CascadeFilterTop` / `ProductsMobileControls` / **`PageHeader`(頁面標題!)**
//    ⇒ 📌 每一個都聲稱那個條件生效了, 而清單根本沒被它縮過。
//
// 🛑 **而我第一版只在 ProductsPage 把 `ActiveChips` 藏起來** —— 那是修被點名的實例,
//    不是修那個類別。R2 逐字抓到 `FilterSide` 照樣打勾。
describe('useDeepLinkRestore × 關鍵字結果頁不還原 facet(R2 must-fix)', () => {
  it('🔴 有關鍵字 + URL 有車 ⇒ cascade.vehicle 保持空(標題與側欄才不會說謊)', () => {
    const h = mountAt('/products?search=cark9650&vehicle=yamaha:mt-09:2022', {
      keywordActive: true,
    });
    expect(h.state.vehicle ?? null).toBeNull();
  });

  it('🔴 有關鍵字 + URL 有分類 ⇒ cascade.category 保持空', () => {
    const h = mountAt('/products?search=cark9650&category=操控部品', { keywordActive: true });
    expect(h.state.category ?? null).toBeNull();
  });

  // 🔴🔴 **這一格比 R2 抓到的那個更糟, 因為它【不需要網址上有任何 facet】。**
  //    本 hook 逐字 `const v = urlVehicle ?? vehicleFromContext(motoBrands);`
  //    ⇒ URL 沒有 vehicle 時**回退讀全站選車鏡**
  //    ⇒ 客人先選了車、再搜一個關鍵字 ⇒ 網址乾乾淨淨 `/products?search=X`
  //    ⇒ ⇒ **標題印「YAMAHA MT-09」而商品是關鍵字撈的、完全沒按那台車過濾。**
  //    ⇒ 📌 R2 那個要手打網址;**這一格是正常動線**(自審 2026-09-03 抓到)。
  it('🔴🔴 有關鍵字 + 鏡有車(網址乾淨)⇒ 鏡【不得】被套上, URL 也不得被改寫', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2022 });
    const h = mountAt('/products?search=cark9650', { keywordActive: true });
    expect(h.state.vehicle ?? null, '鏡被套上 ⇒ 標題會印一台沒有在過濾的車').toBeNull();
    expect(h.url, '還把車寫回 URL ⇒ 那個謊會被客人分享出去').not.toContain('vehicle=');
  });

  // 🔵🔵 **負對照 —— 而它擋的是「把整支 hook 關掉」那種修法。**
  it('🔵 負對照:沒有關鍵字 ⇒ 鏡照樣套上(§6-2 的既有行為零變動)', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2022 });
    const h = mountAt('/products', { keywordActive: false });
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
  });
});

describe('useDeepLinkRestore × 全站選車鏡(Q28①)', () => {
  // §6-1 突變:把 `urlVehicle ?? vehicleFromContext(...)` 兩側對調 ⇒ 只紅這條
  it('§6-1 URL 有車 + 鏡有不同車 → URL 勝(鏡不得覆蓋)', () => {
    seedMirror({ brandId: 'aprilia', modelId: 'rs-660' });
    const h = mountAt('/products?vehicle=yamaha:mt-09:2022');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
  });

  // §6-2 突變:拿掉 `?? vehicleFromContext(motoBrands)` ⇒ 只紅這條(與 §6-8）
  it('§6-2 URL 無車 + 鏡有車 → 車被套上,且 URL 被改寫成含 ?vehicle=', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2022 });
    const h = mountAt('/products');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
    expect(h.url).toBe('?vehicle=yamaha%3Amt-09%3A2022');
  });

  // §6-3 突變:vehicleFromContext 的 `if (!modelObj) return null` 改成降級回 { brand } ⇒ 只紅這條
  it('§6-3 鏡的車款已不在 taxonomy(改名/下架)→ 整筆忽略、URL 不動', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-01-discontinued' });
    const h = mountAt('/products');
    expect(h.state.vehicle).toBeNull();
    expect(h.url).toBe('');
  });

  // §6-4 反向守門:防本片誤傷「乾淨逛列表」。突變:讓 vehicleFromContext 在鏡空時回一台假車 ⇒ 只紅這條
  it('§6-4 URL 無車 + 鏡空 → 逐字同現況(零 dispatch、URL 不動、頁碼不動)', () => {
    const h = mountAt('/products?page=3');
    expect(h.state.vehicle).toBeNull();
    expect(actions).toEqual([]);
    expect(h.url).toBe('?page=3');
    expect(h.state.page).toBe(3);
  });

  // §6-5 突變:同 §6-2(拿掉 `??` 回退不會紅這條——這條守的是「清掉的車不得復活」方向)
  it('§6-5 PDP 清除車輛(鏡已清)→ 逛 /products 車不回來', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09' });
    clearVehicleContext(); // = ProductFitmentCheck 清除鈕 / useVehicleUrlSync 真清除分支
    const h = mountAt('/products');
    expect(h.state.vehicle).toBeNull();
    expect(h.url).toBe('');
  });

  // §6-6(Sean 拍板 A:不設 skipPageResetOnce)。突變:把 `if (urlVehicle || …)` 改回無條件設 ⇒ 只紅這條
  it('§6-6 ?page=3 無車 + 鏡有車 → 回第 1 頁(鏡入站=篩選條件真的變了)', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09' });
    const h = mountAt('/products?page=3');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09' });
    expect(h.state.page).toBe(1);
  });

  // §6-6 反向:URL 深連結指名的那一頁不得被本片改動。突變:改成無條件不設 skip ⇒ 只紅這條
  it('§6-6b ?vehicle=…&page=3 → 停在第 3 頁(URL 還原照舊 skip 一次)', () => {
    const h = mountAt('/products?vehicle=yamaha:mt-09&page=3');
    expect(h.state.page).toBe(3);
  });

  // §6-7 StrictMode 雙跑。
  // 🔴 誠實口徑:本 hook **沒有**「不重複 dispatch」這個性質,鏡入站在 dev 雙跑下確實 dispatch 兩輪
  //    (檔內 :435 逐字:「select 類冪等可吸收」;守一次的只有非冪等的 toggleBrand)。第一版斷言寫成
  //    「呼叫次數 = 1」實測即紅 —— 那是量錯東西,已改成釘住真正被依賴的性質=**結果冪等**。
  // 突變:把 selectVehicleModel 的還原改成非冪等寫法(例:先 clear 再 select 的兩段式)⇒ 雙跑後
  //    year 會被第二輪的 clear 洗掉 ⇒ 只紅這條。
  it('§6-7 StrictMode 雙跑 → 結果與單跑逐字相同(select 冪等吸收;dispatch 本就跑兩輪)', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2022 });
    const strict = mountAt('/products', { strict: true });
    const doubled = { state: strict.state, url: strict.url };
    expect(actions.filter((a) => a.type === 'vehicle/select-brand').length).toBeGreaterThan(1); // 雙跑事實

    cleanup();
    hoisted.replaced.length = 0;
    window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2022 });
    const single = mountAt('/products');
    expect(doubled.state).toEqual(single.state);
    expect(doubled.url).toEqual(single.url);
    expect(single.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
  });

  // §6-8 突變:壞參數短路鏡(parseVehicleFromUrl 回 null 時直接 return)⇒ 只紅這條
  it('§6-8 ?vehicle=garbage + 鏡有車 → 套鏡的車,並把壞參數改寫乾淨', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09' });
    const h = mountAt('/products?vehicle=not-a-brand%3Anope');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09' });
    expect(h.url).toBe('?vehicle=yamaha%3Amt-09');
  });

  // 鏡有車但 taxonomy 整個空(型錄/RPC 掛掉)→ 不得憑鏡瞎套。與 §6-3 同族、不同缺失源。
  it('taxonomy 空清單 → 鏡不套(fail-safe 對齊 URL 側)', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09' });
    const h = mountAt('/products', { motoBrands: [] });
    expect(h.state.vehicle).toBeNull();
    expect(h.url).toBe('');
  });

  // ── R1(code-reviewer)三條 must-fix 的回歸 ────────────────────────────────
  // MF-1:useCatalogFilterUrlSync 用「還沒有 vehicle」的舊網址算 next、覆蓋掉 useVehicleUrlSync 的 replace。
  // 觸發要件=URL 上有它會改寫、而 state 對不上的軸(extras 從不從 URL 還原,`filter-state.ts:63-71`)。
  // 突變:拿掉該 hook 的讓路守衛 ⇒ 終態網址變 `/products`(vehicle 與 pmin/pmax 一起沒了)⇒ 只紅這條。
  it('MF-1 ?pmin&pmax 進站 + 鏡有車 → vehicle 不被 useCatalogFilterUrlSync 覆蓋掉', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2022 });
    const h = mountAt('/products?pmin=1000&pmax=5000');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09', year: 2022 });
    expect(h.url).toContain('vehicle=yamaha%3Amt-09%3A2022');
  });

  // MF-1 反向:taxonomy 查無時 useVehicleUrlSync 本來就不寫 URL ⇒ 讓路守衛**不得永久 hold** 住五軸同步。
  // 可達路徑=車入站後型錄重匯把該車款拿掉(cascade 有車、taxonomy 已無)。
  // 🔴 這條是守衛條件用 `resolveVehicleForUrl` 而非「`cascade.vehicle` 非 null」的理由。
  // 突變:把守衛條件放寬成只看 `cascade.vehicle` ⇒ 只紅這條(pmin/pmax 從此清不掉)。
  it('MF-1b 車在 cascade 但 taxonomy 已查無 → 不 hold,五軸照常同步', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09' });
    const h = mountAt('/products?pmin=1000&pmax=5000');
    expect(h.url).toContain('vehicle='); // 前提:車已入站、vehicle 的 replace 已送出
    h.withTaxonomy([]); // 型錄重匯:該車款不見了
    expect(h.url).toBe(''); // 五軸被清乾淨=既有行為,未被本片的守衛卡住
  });

  // MF-3:skipPageResetOnce 是單一共用旗標、一次 filterResetKey 變動只消化得掉一次。
  // 突變:條件改回 `if (urlVehicle || urlCategory || urlBrands.length > 0)` ⇒ 只紅這條。
  it('MF-3 ?category=…&page=3 + 鏡有車(混合來源)→ 仍回第 1 頁', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09' });
    const h = mountAt('/products?category=操控部品&page=3');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09' });
    expect(h.state.page).toBe(1);
  });

  // MF-3 反向:車不來自鏡時,URL 深連結指名的頁碼照舊不得被動。突變:改成無條件不設 skip ⇒ 只紅這條。
  it('MF-3b ?category=…&page=3(鏡空)→ 停在第 3 頁', () => {
    const h = mountAt('/products?category=操控部品&page=3');
    expect(h.state.page).toBe(3);
  });

  // MF-4:鏡存的年份已不在該車型的年份清單(型錄重匯收斂)⇒ 丟年份、保留車款,不是整筆丟也不是照套。
  // 突變:`year: ctx.year` 不驗 ⇒ 這條紅(會套上 2019 並寫進 URL)。
  it('MF-4 鏡的年份已不在該車型年份清單 → 丟年份、保留廠牌車款', () => {
    seedMirror({ brandId: 'yamaha', modelId: 'mt-09', year: 2019 }); // taxonomy 只有 2021/2022
    const h = mountAt('/products');
    expect(h.state.vehicle).toMatchObject({ brand: 'YAMAHA', model: 'MT-09' });
    expect(h.state.vehicle?.year).toBeUndefined();
    expect(h.url).toBe('?vehicle=yamaha%3Amt-09');
  });
});
