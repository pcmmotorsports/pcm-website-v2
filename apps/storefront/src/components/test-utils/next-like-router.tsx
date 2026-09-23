// next-like-router.tsx — :901 測試用的頁面掛載器(plan §4-1)。替身本身在 `next-like-navigation.tsx`。
//
// 用法:
//   vi.mock('next/navigation', async () => (await import('./test-utils/next-like-navigation')).navigationMock);
//   const h = renderNextLike(() => <Page />, { mode: 'latestOnly', url: '/products?vehicle=...' });
//   await h.flushAll();
import { cleanup, render } from '@testing-library/react';
import { Profiler, act, useState, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
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
  type LandingMode,
} from './next-like-navigation';

export { router, sentNavigations } from './next-like-navigation';

export type NextLikeHarness = ReturnType<typeof renderNextLike>;

/**
 * 掛上頁面:外層(不跟頁面卸載)= Gate + UrlWriterMount;頁面元件用 key 包,`remount()` 只換頁面。
 * `withWriter: false` ⇒ 不掛 UrlWriterMount(跑「今天的寫法」負對照時用)。
 */
export function renderNextLike(
  page: () => ReactElement,
  opts: {
    mode: LandingMode;
    url: string;
    withWriter?: boolean;
    keepModuleState?: boolean;
    /** 每一次 React commit 都呼叫(Profiler;DOM 已更新)——「過程中每一次畫面更新」的探針(Codex 片 3 R1 必修 4)。 */
    onCommit?: () => void;
    /**
     * 模擬 SSR + hydration:先 renderToString 拿伺服器的 HTML,清掉模組層狀態(瀏覽器是新的 JS),
     * 再 hydrate ⇒ `useSyncExternalStore` 第一輪用 server snapshot(車款意圖 = null),下一輪才有值(Codex 片 4+5 R1 必修 3)。
     */
    hydrate?: boolean;
  },
) {
  resetNavigation(opts.mode, opts.url);
  // `keepModuleState`:模擬同一個分頁換到別的頁再回來(模組層的意圖與 writer 狀態還在)
  if (!opts.keepModuleState) {
    resetUrlWriterForTests();
    resetVehicleIntentForTests();
  }

  let bump: (() => void) | null = null;
  let showPage: ((v: boolean) => void) | null = null;
  function Shell() {
    const [k, setK] = useState(0);
    const [shown, setShown] = useState(true);
    bump = () => setK((x) => x + 1);
    showPage = setShown;
    return (
      <>
        <Gate />
        <Profiler id="page" onRender={() => opts.onCommit?.()}>
          <div key={k}>{shown ? page() : null}</div>
        </Profiler>
        {opts.withWriter === false ? null : <UrlWriterMount />}
      </>
    );
  }
  let utils: ReturnType<typeof render>;
  if (opts.hydrate) {
    const html = renderToString(<Shell />);
    resetUrlWriterForTests();
    resetVehicleIntentForTests();
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    utils = render(<Shell />, { container, hydrate: true });
  } else {
    utils = render(<Shell />);
  }


  return {
    get container() {
      return utils.container;
    },
    flushOne,
    flushAll,
    pending: pendingNavigations,
    landed: landedHref,
    address: addressHref,
    /** 整個卸載(模擬離開列表頁 / 詳情頁,例如去首頁);模組層狀態不清。 */
    unmountAll: () => utils.unmount(),
    /**
     * 只把頁面元件收起來 / 放回來(外層 layout 與 writer 留著)——
     * 模擬列表頁進 `loading.tsx`:那時頁面還沒登記落地處理。
     */
    setPageMounted: (v: boolean) => act(() => showPage?.(v)),
    /** Next 在上一頁(ACTION_RESTORE)時會丟掉還沒完成的導航 ⇒ 這裡照做。 */
    dropPendingNavigations: () => act(() => reloadNavigation()),
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
    /** 下一頁:與 `back` 同一套(jsdom 的 popstate 也是非同步的)。 */
    forward: async () => {
      const done = new Promise<void>((r) => window.addEventListener('popstate', () => r(), { once: true }));
      window.history.forward();
      await done;
      await act(async () => {});
    },
    /** 沒被攔到的站內導航(例如沒換成 CatalogLink 的連結)。 */
    navigateExternal: (href: string) => act(() => router.push(href)),
    dispose: () => {
      cleanup();
    },
  };
}
