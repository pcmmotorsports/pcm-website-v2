// @vitest-environment jsdom
//
// PollOrderStatus test(M-3 3DS-S2 callback 自動輪詢)。fake timers + mock fetch + mock useRouter。
// 驗(plan §⑥ 步驟4):
//   - paid → router.refresh() 並停;pending→paid 序列正確
//   - 超時(全 pending、用盡退避)→ 停、不 refresh、不再 fetch
//   - 404 / 401 → 停、不 refresh(fail-closed)
//   - 500 / 網路錯 → 計入次數續試
//   - unmount → cleanup、不再 fetch
//   - 🔴 AbortError 不排下一次 / StrictMode double-mount 不重複輪詢 / late paid callback(stopped 後 resolve)不誤 refresh

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { PollOrderStatus } from './PollOrderStatus';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const fetchMock = vi.fn();

/** 模擬 Response(只用 ok/status/json,對齊 PollOrderStatus 讀取面)。 */
function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PollOrderStatus — 成立路徑', () => {
  it('首輪即 paid → router.refresh() 一次並停止(不再 fetch)', async () => {
    fetchMock.mockResolvedValue(res(200, { status: 'paid' }));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/o1/payment-status', expect.any(Object));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // paid 後停
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('pending → paid 序列:第二輪 paid 才 refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { status: 'pending' }))
      .mockResolvedValueOnce(res(200, { status: 'paid' }));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000); // 第1次 → pending → 排下一次(1500)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500); // 第2次 → paid → refresh
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe('PollOrderStatus — fail-closed', () => {
  it('超時(全 pending、退避用盡)→ 13 次後停、不 refresh', async () => {
    fetchMock.mockResolvedValue(res(200, { status: 'pending' }));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(60000); // > 總退避 ≈51.5s
    expect(fetchMock).toHaveBeenCalledTimes(13);
    expect(refreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(13); // 用盡不再排
  });

  it('400(形狀錯、server UUID gate 後不可達)→ 停、不 refresh、不續試(terminal)', async () => {
    fetchMock.mockResolvedValue(res(400, null));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // terminal、不續試
  });

  it('404(查無/非本人)→ 停、不 refresh、不續試', async () => {
    fetchMock.mockResolvedValue(res(404, null));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 停
  });

  it('401(未登入)→ 停、不 refresh', async () => {
    fetchMock.mockResolvedValue(res(401, null));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('PollOrderStatus — 暫態錯誤續試', () => {
  it('500 → 計入次數續試下一輪', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, null))
      .mockResolvedValue(res(200, { status: 'pending' }));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000); // 500 → 續排
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500); // 續試
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('網路錯(非 AbortError)→ 續試', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(res(200, { status: 'pending' }));
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('PollOrderStatus — 取消/生命週期安全', () => {
  it('unmount → cleanup、不再 fetch', async () => {
    fetchMock.mockResolvedValue(res(200, { status: 'pending' }));
    const { unmount } = render(<PollOrderStatus orderId="o1" />);
    unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).not.toHaveBeenCalled(); // 首次 setTimeout 已被 clearTimeout
  });

  it('🔴 AbortError → 不排下一次(視為終止非錯誤)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortErr);
    render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // AbortError 不續排
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('🔴 StrictMode double-mount → 只一條 active 輪詢(不重複 fetch)', async () => {
    fetchMock.mockResolvedValue(res(200, { status: 'pending' }));
    render(
      <StrictMode>
        <PollOrderStatus orderId="o1" />
      </StrictMode>,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 第一次 mount 的 timer 被 cleanup 清掉、僅第二次 active
  });

  it('🔴 late paid callback(stopped 後才 resolve)→ 不誤 refresh', async () => {
    let resolveFetch: (v: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );
    const { unmount } = render(<PollOrderStatus orderId="o1" />);

    await vi.advanceTimersByTimeAsync(1000); // 觸發 poll → fetch 掛起(未 resolve)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount(); // stopped=true + abort
    resolveFetch(res(200, { status: 'paid' })); // late resolve paid
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshMock).not.toHaveBeenCalled(); // stopped 後 await 檢查擋下、不 refresh
  });
});
