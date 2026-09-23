// @vitest-environment jsdom
// url-writer.hook.test.tsx — 經過真的 `useUrlWriter`(掛在外層)與仿 Next router 的時序檢查。
// 片 2 Codex R2:必修 1 ~ 3 與 nit(①要經過 hook 的 transition 完成才驗得到)。
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { renderNextLike, router, type NextLikeHarness } from '@/components/test-utils/next-like-router';
import { setLandingHandler, pushNavigation, registerLinkTarget, writeSearch } from './url-writer';
import { getVehicleIntent, setVehicleIntent, type VehicleIntent } from './vehicle-intent';

import { vi } from 'vitest';
vi.mock('next/navigation', async () => (await import('@/components/test-utils/next-like-navigation')).navigationMock);

const R7: VehicleIntent = { kind: 'vehicle', segment: 'yamaha:yzf-r7', brandName: 'Yamaha', modelName: 'YZF-R7' };
const MT07: VehicleIntent = { kind: 'vehicle', segment: 'yamaha:mt-07', brandName: 'Yamaha', modelName: 'MT-07' };
const bySegment: Record<string, VehicleIntent> = { 'yamaha:yzf-r7': R7, 'yamaha:mt-07': MT07 };

const calls: { vehicle: string | null; source: string }[] = [];
/** 最小的頁面:登記落地處理(網址有車款 ⇒ 改意圖;上一頁到沒車款 ⇒ none)。 */
function Page() {
  useEffect(
    () =>
      setLandingHandler((params, source) => {
        const v = params.get('vehicle');
        calls.push({ vehicle: v, source });
        if (v && bySegment[v]) setVehicleIntent(bySegment[v]!);
        else if (source === 'history') setVehicleIntent({ kind: 'none' });
      }),
    [],
  );
  return null;
}
/** 載入畫面:還沒登記落地處理。 */
function Loading() {
  return null;
}

let h: NextLikeHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
  calls.length = 0;
});
const vehicleOf = (href: string) => new URL(href, 'http://x').searchParams.get('vehicle');

describe('片 2 R2', () => {
  it('nit / R1 ①:外部落地後補送的車款,不會被同一輪完成清掉;接著清車 ⇒ 最後沒有車款', async () => {
    h = renderNextLike(() => <Page />, { mode: 'sequential', url: '/products?vehicle=yamaha:yzf-r7' });
    await h.flushAll();
    act(() => pushNavigation(router, '/products?filter=new', { external: true }));
    await h.flushOne(); // 外部目標落地 ⇒ writer 補送帶 R7 的一發
    expect(h.pending().some((p) => vehicleOf(p) === 'yamaha:yzf-r7')).toBe(true);
    act(() => {
      setVehicleIntent({ kind: 'none' });
      writeSearch(router, () => {});
    });
    await h.flushAll();
    expect(vehicleOf(h.landed())).toBeNull();
    expect(getVehicleIntent()).toEqual({ kind: 'none' });
  });

  it('必修 1:頁面還在載入時按上一頁 ⇒ 頁面掛好後照上一頁處理(改成沒有車款、refresh)', async () => {
    let ready = false;
    let setReady: (() => void) | null = null;
    function Switch() {
      return ready ? <Page /> : <Loading />;
    }
    h = renderNextLike(() => <Switch />, { mode: 'sequential', url: '/products' });
    setReady = () => (ready = true);
    act(() => setVehicleIntent(R7));
    window.history.pushState(null, '', '/products?vehicle=yamaha:yzf-r7');
    await h.back(); // 回到沒有車款的 /products,頁面還是載入畫面
    expect(calls).toHaveLength(0);
    setReady();
    await h.remount(); // 頁面掛好 ⇒ 登記落地處理
    expect(calls.at(-1)).toEqual({ vehicle: null, source: 'history' });
    expect(getVehicleIntent()).toEqual({ kind: 'none' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('必修 2:MT-07 頁還在載入就離開,之後進 R7 頁 ⇒ 不會先送出 MT-07', async () => {
    h = renderNextLike(() => <Loading />, { mode: 'sequential', url: '/products?vehicle=yamaha:mt-07' });
    await h.flushAll();
    h.unmountAll(); // 去首頁
    h.dispose();
    h = renderNextLike(() => <Page />, { mode: 'sequential', url: '/products?vehicle=yamaha:yzf-r7', keepModuleState: true });
    await h.flushAll();
    expect(calls.map((c) => c.vehicle)).toEqual(['yamaha:yzf-r7']);
    expect(router.replace.mock.calls.map((c) => vehicleOf(c[0]))).not.toContain('yamaha:mt-07');
  });

  it('必修 3:處理過的網址 ⇒ 去首頁 ⇒ 上一頁回到同一個網址 ⇒ 照上一頁處理', async () => {
    h = renderNextLike(() => <Page />, { mode: 'sequential', url: '/products' });
    await h.flushAll();
    expect(calls).toEqual([{ vehicle: null, source: 'external' }]);
    h.unmountAll(); // 去首頁(列表頁的 writer 不在了)
    window.history.pushState(null, '', '/');
    const back = new Promise<void>((r) => window.addEventListener('popstate', () => r(), { once: true }));
    window.history.back();
    await back;
    h.dispose();
    router.refresh.mockClear();
    h = renderNextLike(() => <Page />, { mode: 'sequential', url: '/products', keepModuleState: true });
    await h.flushAll();
    expect(calls.at(-1)).toEqual({ vehicle: null, source: 'history' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('片 2 R3', () => {
  it('必修 1:同一個外框裡,載入 MT-07 中改去 R7 ⇒ 頁面準備好時只處理 R7,不送 MT-07', async () => {
    // MT-07 那一頁一直在載入;R7 落地的同一次 commit 頁面就掛好(Codex 描述的時序)
    function Switch() {
      return useSearchParams().get('vehicle') === 'yamaha:yzf-r7' ? <Page /> : <Loading />;
    }
    h = renderNextLike(() => <Switch />, { mode: 'sequential', url: '/products?vehicle=yamaha:mt-07' });
    await h.flushAll(); // MT-07 落地,頁面還在載入 ⇒ 擱著
    await h.navigateExternal('/products?vehicle=yamaha:yzf-r7');
    await h.flushAll(); // R7 落地,同一次 commit 頁面掛好
    expect(calls.map((c) => c.vehicle)).toEqual(['yamaha:yzf-r7']);
    expect(router.replace.mock.calls.map((c) => vehicleOf(c[0]))).not.toContain('yamaha:mt-07');
    expect(getVehicleIntent()).toEqual(R7);
  });

  it('必修 2:離開列表頁前有沒送完的目標 ⇒ 用一般連結回到同一個網址 ⇒ 改排序不會帶回那個目標', async () => {
    h = renderNextLike(() => <Page />, { mode: 'sequential', url: '/products?vehicle=yamaha:yzf-r7' });
    await h.flushAll();
    act(() => registerLinkTarget('/products?filter=new')); // 點了「新品上架」但沒去成
    h.unmountAll(); // 離開到首頁
    h.dispose();
    h = renderNextLike(() => <Page />, { mode: 'sequential', url: '/products?vehicle=yamaha:yzf-r7', keepModuleState: true });
    await h.flushAll();
    act(() => writeSearch(router, (p) => p.set('sort', 'price')));
    const sentUrl = router.replace.mock.calls.at(-1)?.[0] as string;
    expect(new URL(sentUrl, 'http://x').searchParams.get('filter')).toBeNull();
    expect(new URL(sentUrl, 'http://x').searchParams.get('sort')).toBe('price');
  });
});

// 🔴 片 6 Fable R4 consider C1 / C2(2026-09-24 真瀏覽器重現,`~/pcm-mailbox/c1c2-走查-20260924/C1C2-報告.md`):
//   點「就是現在這頁」的連結時,writer 把還沒落地的導航與擱著的同步一起作廢,卻沒有讓頁面照現在這頁同步
//   ⇒ 頁面的篩選狀態停在客人上一步(C2:點「商品目錄」後又被寫回舊分類;C1:排序選單與列表不一致)。
//   把 `registerLinkTarget` 同頁分支改回「只清不同步」,這兩格會紅。
describe('片 6 R4 C1 / C2:點同一頁的連結要讓頁面照這一頁同步', () => {
  const seen: { qs: string; source: string }[] = [];
  function FilterPage() {
    useEffect(() => setLandingHandler((params, source) => void seen.push({ qs: params.toString(), source })), []);
    return null;
  }
  afterEach(() => {
    seen.length = 0;
  });

  it('C2:點分類還沒落地就點「商品目錄」(= 現在這頁)⇒ 頁面照 /products 同步,網址列回到 /products', async () => {
    h = renderNextLike(() => <FilterPage />, { mode: 'latestOnly', url: '/products' });
    await h.flushAll();
    expect(seen).toEqual([{ qs: '', source: 'external' }]);
    act(() => writeSearch(router, (p) => p.set('category', '後視鏡'))); // 預寫網址列,還沒落地
    act(() => {
      registerLinkTarget('/products'); // CatalogLink 的 onClick
      router.push('/products'); // 接著 Next Link 導航
    });
    expect(seen.at(-1), '頁面沒有照 /products 同步 ⇒ 舊分類會被寫回網址').toEqual({ qs: '', source: 'external' });
    expect(seen).toHaveLength(2);
    await h.flushAll();
    expect(h.address(), '網址列要回到客人最後點的那一頁').toBe('/products');
    expect(h.landed()).toBe('/products');
  });

  it('C1:新品上架先落地、排序那一發還在路上時再點一次新品上架 ⇒ 頁面照新品上架同步', async () => {
    h = renderNextLike(() => <FilterPage />, { mode: 'sequential', url: '/products?category=操控部品' });
    await h.flushAll();
    act(() => {
      registerLinkTarget('/products?filter=new');
      router.push('/products?filter=new');
    });
    act(() => writeSearch(router, (p) => p.set('sort', 'price-asc'))); // 以新品上架為底,還沒落地
    await h.flushOne(); // 新品上架先落地 ⇒ 擱著同步、等排序那一發
    const before = seen.length;
    act(() => registerLinkTarget('/products?filter=new')); // 再點一次 = 已落地那一頁
    expect(seen.length, '擱著的同步被清掉而沒有補做 ⇒ 排序選單停在「價格低到高」').toBe(before + 1);
    expect(seen.at(-1)).toEqual({ qs: 'filter=new', source: 'external' });
  });
});
