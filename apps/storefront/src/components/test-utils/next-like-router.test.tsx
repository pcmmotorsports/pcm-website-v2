// @vitest-environment jsdom
// next-like-router 替身自己的檢查:它若不像 Next,後面 T1 ~ T15 全部白測。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { renderNextLike, router, sentNavigations, type NextLikeHarness } from './next-like-router';
import { documentNavigations } from './next-like-navigation';

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

  it('push 比的是原樣網址:yamaha:mt-07 ⇒ yamaha%3Amt-07 與換 hash 都會新增紀錄(Next app-router.js:59);hash 保留', async () => {
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products?vehicle=yamaha:mt-07' });
    const { act } = await import('react');
    const before = window.history.length;
    act(() => { router.push('/products?vehicle=yamaha%3Amt-07'); });
    await h.flushAll();
    expect(window.history.length).toBe(before + 1);
    act(() => { router.push('/products?vehicle=yamaha%3Amt-07#bottom'); });
    await h.flushAll();
    expect(window.history.length).toBe(before + 2);
    expect(window.location.hash).toBe('#bottom');
  });

  it('FakeLink 照 Next isLocalURL:`//example.com/…` 算站內 ⇒ 會呼叫 onNavigate;`https://example.com/…` 交給瀏覽器 ⇒ 不呼叫', async () => {
    const { FakeLink } = await import('./next-like-navigation');
    const { render, fireEvent } = await import('@testing-library/react');
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products' });
    const a = vi.fn();
    const b = vi.fn();
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop);
    const r = render(
      <>
        <FakeLink href="//example.com/products?filter=new" onNavigate={a}>甲</FakeLink>
        <FakeLink href="https://example.com/products?filter=new" onNavigate={b}>乙</FakeLink>
      </>,
    );
    fireEvent.click(r.getByText('甲'), { button: 0 });
    fireEvent.click(r.getByText('乙'), { button: 0 });
    document.removeEventListener('click', stop);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(sentNavigations).toHaveLength(0); // 解析後是別的網域 ⇒ 不排進站內佇列
    // 兩個都真的整頁離站(不是「什麼都沒發生」),帶完整目的網址與方式
    expect(documentNavigations).toEqual([
      { href: 'http://example.com/products?filter=new', method: 'assign' },
      { href: 'https://example.com/products?filter=new', method: 'assign' },
    ]);
  });

  it('FakeLink 站外 + replace ⇒ location.replace(Next link.js:60)', async () => {
    const { FakeLink } = await import('./next-like-navigation');
    const { render, fireEvent } = await import('@testing-library/react');
    h = renderNextLike(() => <Probe />, { mode: 'sequential', url: '/products' });
    const r = render(<FakeLink href="https://example.com/x" replace>丙</FakeLink>);
    fireEvent.click(r.getByText('丙'), { button: 0 });
    expect(documentNavigations).toEqual([{ href: 'https://example.com/x', method: 'replace' }]);
    expect(sentNavigations).toHaveLength(0);
  });
});
