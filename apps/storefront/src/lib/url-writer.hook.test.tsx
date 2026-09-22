// @vitest-environment jsdom
// url-writer.hook.test.tsx — 經過真的 `useUrlWriter`(掛在外層)與仿 Next router 的時序檢查。
// 片 2 Codex R2:必修 1 ~ 3 與 nit(①要經過 hook 的 transition 完成才驗得到)。
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect } from 'react';
import { renderNextLike, router, type NextLikeHarness } from '@/components/test-utils/next-like-router';
import { setLandingHandler, pushNavigation, writeSearch } from './url-writer';
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
