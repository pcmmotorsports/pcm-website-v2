// next-like-router.tsx — :901 測試用的頁面掛載器(plan §4-1)。替身本身在 `next-like-navigation.tsx`。
//
// 用法:
//   vi.mock('next/navigation', async () => (await import('./test-utils/next-like-navigation')).navigationMock);
//   const h = renderNextLike(() => <Page />, { mode: 'latestOnly', url: '/products?vehicle=...' });
//   await h.flushAll();
import { cleanup, render } from '@testing-library/react';
import { act, useState, type ReactElement } from 'react';
import { UrlWriterMount } from '@/components/UrlWriterMount';
import { resetUrlWriterForTests } from '@/lib/url-writer';
import { resetVehicleIntentForTests } from '@/lib/vehicle-intent';
import {
  Gate,
  addressHref,
  flushAll,
  flushOne,
  landedHref,
  pendingNavigations,
  reloadNavigation,
  resetNavigation,
  router,
  setLanded,
  type LandingMode,
} from './next-like-navigation';

export { router, sentNavigations } from './next-like-navigation';

export type NextLikeHarness = ReturnType<typeof renderNextLike>;

/**
 * 掛上頁面:外層(不跟頁面卸載)= Gate + UrlWriterMount;頁面元件用 key 包,`remount()` 只換頁面。
 * `withWriter: false` ⇒ 不掛 UrlWriterMount(跑「今天的寫法」負對照時用)。
 */
export function renderNextLike(page: () => ReactElement, opts: { mode: LandingMode; url: string; withWriter?: boolean }) {
  resetNavigation(opts.mode, opts.url);
  resetUrlWriterForTests();
  resetVehicleIntentForTests();

  let bump: (() => void) | null = null;
  function Shell() {
    const [k, setK] = useState(0);
    bump = () => setK((x) => x + 1);
    return (
      <>
        <Gate />
        <div key={k}>{page()}</div>
        {opts.withWriter === false ? null : <UrlWriterMount />}
      </>
    );
  }
  let utils = render(<Shell />);

  const onPop = () => act(() => setLanded(window.location.href));
  window.addEventListener('popstate', onPop);

  return {
    get container() {
      return utils.container;
    },
    flushOne,
    flushAll,
    pending: pendingNavigations,
    landed: landedHref,
    address: addressHref,
    /** 卸載再掛載頁面元件(外層不動)。 */
    remount: () => act(() => bump?.()),
    /** 重新整理:清掉所有模組層狀態、還沒落地的導航;保留網址列與 sessionStorage(選車鏡),重新掛載。 */
    reload: async () => {
      utils.unmount();
      reloadNavigation();
      resetUrlWriterForTests();
      resetVehicleIntentForTests();
      await act(async () => {
        utils = render(<Shell />);
      });
    },
    /** 上一頁:jsdom 會非同步發 popstate;等它處理完。 */
    back: async () => {
      const done = new Promise<void>((r) => window.addEventListener('popstate', () => r(), { once: true }));
      window.history.back();
      await done;
      await act(async () => {});
    },
    /** 沒被攔到的站內導航(例如沒換成 CatalogLink 的連結)。 */
    navigateExternal: (href: string) => act(() => router.push(href)),
    dispose: () => {
      window.removeEventListener('popstate', onPop);
      cleanup();
    },
  };
}
