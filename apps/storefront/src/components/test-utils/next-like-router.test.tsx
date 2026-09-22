// @vitest-environment jsdom
// next-like-router 替身自己的檢查:它若不像 Next,後面 T1 ~ T15 全部白測。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { renderNextLike, router, sentNavigations, type NextLikeHarness } from './next-like-router';

vi.mock('next/navigation', async () => (await import('./next-like-navigation')).navigationMock);

let h: NextLikeHarness | null = null;
afterEach(() => h?.dispose());

let pendingLog: boolean[] = [];
let go: ((href: string) => void) | null = null;
function Probe() {
  const sp = useSearchParams();
  const [isPending, start] = useTransition();
  pendingLog.push(isPending);
  go = (href) => start(() => router.replace(href));
  return <p data-testid="landed">{sp.toString()}</p>;
}

describe('next-like-router', () => {
  it('送出後落地前:useSearchParams 與網址列都還是舊的;isPending 為 true 到全部落地', async () => {
    pendingLog = [];
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products?a=1' });
    await h.remount(); // 不影響
    const { act } = await import('react');
    act(() => go!('/products?a=2'));
    act(() => go!('/products?a=3'));
    expect(h.container.querySelector('[data-testid=landed]')?.textContent).toBe('a=1');
    expect(h.address()).toBe('/products?a=1');
    expect(pendingLog.at(-1)).toBe(true);
    await h.flushOne();
    expect(h.landed()).toBe('/products?a=2');
    expect(h.address()).toBe('/products?a=2'); // Next 把網址列改成落地那發
    expect(pendingLog.at(-1)).toBe(true); // 還有一發沒落地
    await h.flushOne();
    expect(h.container.querySelector('[data-testid=landed]')?.textContent).toBe('a=3');
    expect(pendingLog.at(-1)).toBe(false);
  });

  it('latestOnly:新的一發丟掉還沒落地的舊一發,只落最後一發;送出的紀錄仍有兩發', async () => {
    h = renderNextLike(() => <Probe />, { mode: 'latestOnly', url: '/products?a=1' });
    const { act } = await import('react');
    act(() => go!('/products?a=2'));
    act(() => go!('/products?a=3'));
    expect(h.pending()).toEqual(['/products?a=3']);
    await h.flushAll();
    expect(h.landed()).toBe('/products?a=3');
    expect(sentNavigations.map((n) => n.href)).toEqual(['/products?a=2', '/products?a=3']);
  });

  it('reload 保留網址列與 sessionStorage,丟掉還沒落地的導航', async () => {
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products?a=1' });
    sessionStorage.setItem('k', 'v');
    window.history.replaceState(window.history.state, '', '/products?a=9'); // 呼叫端預寫過的網址列(保留 Next 的 state)
    const { act } = await import('react');
    act(() => go!('/products?a=2'));
    await h.reload();
    expect(h.landed()).toBe('/products?a=9');
    expect(h.pending()).toEqual([]);
    expect(sessionStorage.getItem('k')).toBe('v');
  });

  it('🔴 預寫時把 Next 的 history state 弄丟(傳 null)⇒ Next 會同步 ⇒ 已落地立刻變(替身要能抓到這種錯)', async () => {
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products?a=1' });
    const { act } = await import('react');
    act(() => window.history.replaceState(null, '', '/products?a=5'));
    expect(h.landed()).toBe('/products?a=5');
    act(() => window.history.replaceState(window.history.state, '', '/products?a=6'));
    expect(h.landed()).toBe('/products?a=5'); // 保留 state ⇒ Next 不管
  });

  it('push 到與網址列相同的網址 ⇒ 不新增紀錄(Next app-router.js:59)', async () => {
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products?a=1' });
    const { act } = await import('react');
    const before = window.history.length;
    act(() => window.history.replaceState(window.history.state, '', '/products?a=7')); // 預寫
    act(() => { router.push('/products?a=7'); });
    await h.flushAll();
    expect(window.history.length).toBe(before);
    act(() => { router.push('/products?a=8'); });
    await h.flushAll();
    expect(window.history.length).toBe(before + 1);
  });
});
