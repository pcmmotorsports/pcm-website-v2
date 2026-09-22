// next-like-router.tsx — :901 單元測試用的 Next App Router 替身(plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §4-1)。
//
// 照原型實測(`~/pcm-mailbox/901-原型-20260922/實測結果-20260922.md`,Next 16.3.0)建模:
//   - 導航送出後、落地前:`useSearchParams` 與 `window.location` 都還是舊的(除非呼叫端自己 replaceState 預寫)。
//   - 落地(`flush()`)時 Next 把網址列改成那一發(replace ⇒ replaceState;push ⇒ pushState),`useSearchParams` 才變。
//   - 兩種落地模型:`sequential`(dev:每一發依序落地)、`latestOnly`(production:新的一發丟掉還沒落地的舊一發)。
//   - 導航在 React transition 裡:送出時用 `startTransition` 讓一個會 suspend 的元件等「清單清空」,
//     所以呼叫端 `useTransition` 的 `isPending` 會一直是 true 到全部落地(實測 5)。
//
// 用法:
//   vi.mock('next/navigation', async () => (await import('./test-utils/next-like-router')).navigationMock);
//   const h = renderNextLike(() => <Page />, { mode: 'latestOnly', url: '/products?vehicle=...' });
//   await h.flushAll();
// 🔴 這支不能 import 任何會 import `next/navigation` 的模組:它就是那個 mock 的來源(循環 import 會拿到真的 Next)。
import { act, startTransition, use, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { vi, type Mock } from 'vitest';
import { isLocalURL } from 'next/dist/shared/lib/router/utils/is-local-url';

export type LandingMode = 'sequential' | 'latestOnly';
type Nav = { href: string; method: 'replace' | 'push' };
type Deferred = { promise: Promise<void>; resolve: () => void };

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const normalize = (href: string) => {
  const u = new URL(href, window.location.href);
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
};

// ── 替身狀態(模組層;每個測試由 renderNextLike 重設)──
let mode: LandingMode = 'sequential';
let landed = '/';
let landedParams = new URLSearchParams();
let landedPath = '/';
let queue: Nav[] = [];
let drain: Deferred | null = null;
let setGate: ((p: Promise<void>) => void) | null = null;
const subs = new Set<() => void>();

/** 整頁離站(站外連結):完整目的網址與方式(assign = 一般連結、replace = location.replace)。 */
export const documentNavigations: { href: string; method: 'assign' | 'replace' }[] = [];

/** 每一發送出的導航(含被 latestOnly 丟掉的),給斷言「router 確實送出」。 */
export const sentNavigations: Nav[] = [];

export function setLanded(href: string) {
  landed = normalize(href);
  const u = new URL(landed, window.location.href);
  landedPath = u.pathname;
  landedParams = new URLSearchParams(u.search);
  subs.forEach((f) => f());
}

/**
 * Next 的 canonicalUrl = `createHrefFromUrl(new URL(href, location))` = pathname + search + hash(原樣,不重新編碼)。
 * 歷史紀錄與「要不要新增一筆」都用這個原樣字串比(Codex 片 3 R3 必修 2);`useSearchParams` 才是解析後的值。
 */
const rawHref = (href: string) => {
  const u = new URL(href, window.location.href);
  return u.pathname + u.search + u.hash;
};

function enqueue(href: string, method: Nav['method']) {
  const nav = { href: rawHref(href), method };
  sentNavigations.push(nav);
  if (mode === 'latestOnly') queue = [];
  queue.push(nav);
  if (!drain) drain = deferred();
  const p = drain.promise;
  startTransition(() => setGate?.(p));
}

type HrefFn = (href: string, opts?: { scroll?: boolean }) => void;
export const router: {
  replace: Mock<HrefFn>;
  push: Mock<HrefFn>;
  refresh: Mock<() => void>;
  prefetch: Mock<() => void>;
  back: Mock<() => void>;
  forward: Mock<() => void>;
} = {
  replace: vi.fn((href: string) => enqueue(href, 'replace')),
  push: vi.fn((href: string) => enqueue(href, 'push')),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(() => window.history.back()),
  forward: vi.fn(),
};

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const navigationMock: {
  useRouter: () => typeof router;
  useSearchParams: () => URLSearchParams;
  usePathname: () => string;
  redirect: Mock<() => void>;
  notFound: Mock<() => void>;
} = {
  useRouter: () => router,
  useSearchParams: () => useSyncExternalStore(subscribe, () => landedParams, () => landedParams),
  usePathname: () => useSyncExternalStore(subscribe, () => landedPath, () => landedPath),
  redirect: vi.fn(),
  notFound: vi.fn(),
};

/** 讓導航 transition 一直 pending 到清單清空(Next 的 router 狀態更新會 suspend 到 RSC 回來)。 */
export function Gate() {
  const [p, set] = useState<Promise<void> | null>(null);
  setGate = set;
  if (p) use(p);
  return null;
}

/** 落地一發(sequential = 最早那發;latestOnly = 唯一剩下那發)。回傳落地的網址,沒有就是 null。 */
export async function flushOne(): Promise<string | null> {
  const nav = queue.shift();
  if (!nav) return null;
  const land = () => {
    // Next 16.3.0 app-router.js:59:push 的目的網址與網址列相同 ⇒ 不新增紀錄、改用 replace(Codex 片 3 R2 必修 4)
    if (nav.method === 'push' && rawHref(window.location.href) !== nav.href) originals().push(NEXT_STATE, '', nav.href);
    else originals().replace(NEXT_STATE, '', nav.href);
    setLanded(nav.href);
  };
  if (queue.length > 0) {
    // 🔴 還有沒落地的:用同步 act。async act 會讓 React 放棄等那個 suspend 中的 transition,
    //    `isPending` 提早變 false(2026-09-22 實驗:同一段程式 sync act 維持 true、async act 變 false)。
    act(land);
    return nav.href;
  }
  await act(async () => {
    land();
    drain?.resolve();
    drain = null;
  });
  return nav.href;
}

export async function flushAll(): Promise<void> {
  // 落地時頁面可能補送新的一發(例如外部落地後補寫車款)⇒ 一直落到清單真的空
  for (let i = 0; i < 50 && queue.length > 0; i += 1) await flushOne();
  if (queue.length > 0) throw new Error('next-like-router: 50 發還沒落完,可能是寫入者互相觸發的迴圈');
}

/** 每個測試開頭:換落地模型、清掉清單與紀錄、設定起始網址。 */
export function resetNavigation(m: LandingMode, url: string): void {
  mode = m;
  queue = [];
  drain = null;
  sentNavigations.length = 0;
  documentNavigations.length = 0;
  Object.values(router).forEach((f) => f.mockClear());
  installHistoryPatch();
  originals().replace(NEXT_STATE, '', url);
  setLanded(url);
}

// ── Next 16.3.0 `client/components/app-router.js` 對 history 的處理(Codex 片 3 R1 必修 1)──
//   - Next 自己寫的紀錄帶 `__NA`;呼叫端 `replaceState / pushState` 時 state 帶著 `__NA` ⇒ Next 不管(只改網址列);
//     **不帶 ⇒ Next 會把自己的 router 同步成那個網址**(`useSearchParams` 立刻變)。
//     ⇒ writer 預寫時若把 state 弄丟(例如傳 null),這裡會讓已落地提早變,測試抓得到。
//   - popstate:`event.state` 是 null ⇒ Next 不處理;帶 `__NA` ⇒ 回到那筆(這裡 = 已落地改成網址列)。
const NEXT_STATE = { __NA: true };
type HistoryFn = (data: unknown, unused: string, url?: string | URL | null) => void;
let saved: { push: HistoryFn; replace: HistoryFn } | null = null;
function originals() {
  return saved ?? { push: window.history.pushState.bind(window.history), replace: window.history.replaceState.bind(window.history) };
}
function installHistoryPatch() {
  if (saved) return;
  saved = { push: window.history.pushState.bind(window.history), replace: window.history.replaceState.bind(window.history) };
  const wrap = (orig: HistoryFn): HistoryFn =>
    function patched(data, unused, url) {
      if ((data as { __NA?: boolean } | null)?.__NA) return orig(data, unused, url);
      orig({ ...(data as object | null), ...NEXT_STATE }, unused, url);
      if (url) setLanded(String(url));
    };
  window.history.pushState = wrap(saved.push);
  window.history.replaceState = wrap(saved.replace);
  window.addEventListener('popstate', (e) => {
    if (!(e.state as { __NA?: boolean } | null)?.__NA) return;
    // Next 在上一頁(ACTION_RESTORE)時直接把 router 狀態換成歷史那一筆 ⇒ 還沒完成的導航【不會】再落地
    //   (client/components/app-router-instance.js 的 restore;片 3 R5 nit ①)。替身照做,否則會做出真 Next 沒有的狀態。
    act(() => {
      queue = [];
      drain?.resolve();
      drain = null;
      setLanded(window.location.href);
    });
  });
}

/**
 * `next/link` 的替身:點擊處理順序照 Next 16.3.0 `client/app-dir/link.js` 的 `linkClicked`
 * (onClick ⇒ 已取消就停 ⇒ 修飾鍵 / 中鍵 / target / download 交給瀏覽器 ⇒ onNavigate 可取消 ⇒ transition 裡送導航)。
 * 用法:vi.mock('next/link', async () => ({ default: (await import('./next-like-navigation')).FakeLink }));
 */
export function FakeLink({
  href,
  replace,
  onClick,
  onNavigate,
  children,
  prefetch: _prefetch,
  scroll: _scroll,
  ...rest
}: {
  href: string;
  replace?: boolean;
  prefetch?: unknown;
  scroll?: unknown;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  onNavigate?: (e: { preventDefault: () => void }) => void;
  children?: ReactNode;
} & Record<string, unknown>) {
  void _prefetch;
  void _scroll;
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        const target = e.currentTarget.getAttribute('target');
        const modified = (target && target !== '_self') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.nativeEvent.which === 2;
        if (modified || e.currentTarget.hasAttribute('download')) return;
        // 直接用 Next 的 `isLocalURL`(不自己判斷):站外 ⇒ 交給瀏覽器;`//host/...` 這種 Next 判成站內(Codex 片 3 R3 必修 1)
        if (!isLocalURL(href)) {
          // Next link.js:60:站外 + replace ⇒ 取消預設、location.replace;站外沒 replace ⇒ 瀏覽器照連結整頁離開。
          //   jsdom 不能真的換頁 ⇒ 取消預設,改記在 documentNavigations(Codex 片 3 R4 必修)
          e.preventDefault();
          documentNavigations.push({ href: new URL(href, window.location.href).href, method: replace ? 'replace' : 'assign' });
          return;
        }
        e.preventDefault();
        let cancelled = false;
        onNavigate?.({ preventDefault: () => (cancelled = true) });
        if (cancelled) return;
        // Next 之後把它當成站內導航送出;解析後是別的網域 ⇒ app-router.js:214 整頁離開(push ⇒ assign、replace ⇒ replace)
        const resolved = new URL(href, window.location.href);
        if (resolved.origin !== window.location.origin) {
          documentNavigations.push({ href: resolved.href, method: replace ? 'replace' : 'assign' });
          return;
        }
        startTransition(() => enqueue(href, replace ? 'replace' : 'push'));
      }}
    >
      {children}
    </a>
  );
}

/** 重新整理:丟掉還沒落地的導航,已落地 = 網址列。 */
export function reloadNavigation(): void {
  queue = [];
  drain?.resolve();
  drain = null;
  setLanded(window.location.href);
}

export const pendingNavigations = () => queue.map((n) => n.href);
export const landedHref = () => landed;
export const addressHref = () => normalize(window.location.href);
