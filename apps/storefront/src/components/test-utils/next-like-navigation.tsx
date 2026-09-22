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
import { act, startTransition, use, useState, useSyncExternalStore } from 'react';
import { vi, type Mock } from 'vitest';

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

/** 每一發送出的導航(含被 latestOnly 丟掉的),給斷言「router 確實送出」。 */
export const sentNavigations: Nav[] = [];

export function setLanded(href: string) {
  landed = normalize(href);
  const u = new URL(landed, window.location.href);
  landedPath = u.pathname;
  landedParams = new URLSearchParams(u.search);
  subs.forEach((f) => f());
}

function enqueue(href: string, method: Nav['method']) {
  const nav = { href: normalize(href), method };
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
    if (nav.method === 'push') window.history.pushState(window.history.state, '', nav.href);
    else window.history.replaceState(window.history.state, '', nav.href);
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
  Object.values(router).forEach((f) => f.mockClear());
  window.history.replaceState(null, '', url);
  setLanded(url);
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
