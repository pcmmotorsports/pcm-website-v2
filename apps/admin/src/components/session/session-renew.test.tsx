// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { SessionRenew } from './session-renew';

// session-renew.test.tsx — 靜默續期前端那一半的守門。
//
// 🔴🔴 **這支檔為什麼在 2026-08-27 才補**:片二(`5276411e`)新增了一支 82 行的
//    client 元件而**零測試** ⇒ code-reviewer 補審在同一支檔裡抓到 **四條 must-fix**,
//    而三綠**全綠** —— 因為沒有任何東西在跑它。
//    📌 判別句:**「它沒有紅」與「有東西在看它」是兩件事。**
//
// 本檔斷言的是**行為**(有沒有去敲、還會不會再敲),不是實作細節。

const OK = (outcome: string, status = 200): Response =>
  ({ type: 'basic', status, json: async () => ({ outcome }) }) as unknown as Response;

describe('片二 · SessionRenew 靜默續期', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => OK('fresh'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('[C1] 🔴 mount 就【立刻】敲一次 —— 不是等滿一個巡邏間隔(補審 M4)', async () => {
    // 🔴 原本只有 setInterval ⇒ 從一個放很久的分頁回來, 第一發要等 60 秒,
    //    而票只有 15 分鐘。拿掉 `void tick()` ⇒ 這一格紅。
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/session/renew');
  });

  it('[C2] 🔴 一定要帶 redirect: manual —— 它是這一片的承重件', async () => {
    // 沒有它 ⇒ fetch 跟著 303 跑到跨來源 ⇒ CORS 擋住 ⇒ 失敗變不透明,
    // 「我來晚了」與「網路壞了」就分不出來了。
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'manual' });
  });

  it('[C3] ✅ 正對照:一切正常 ⇒ 會【一直】巡邏下去', async () => {
    // 沒有這一格的話, [C4]/[C5] 在「它根本沒在巡邏」時也是綠的。
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('[C4] 🔴 chain-expired ⇒ 停下來,不再敲(再敲答案也一樣)', async () => {
    fetchMock.mockImplementation(async () => OK('chain-expired', 401));
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchMock, 'chain-expired 之後還在敲 ⇒ 每分鐘一次白工').toHaveBeenCalledTimes(1);
  });

  it('[C5] 🔴🔴 not-active(403)⇒ 【不得】停 —— 它與「DB 掛掉」是同一個值(補審 M3 / #933)', async () => {
    // 🔴 **本檔最重要的一格。** `resolveActiveStaffById` 對「被停用」與「DB 查詢失敗」
    //    回同一個 null ⇒ 403。把它當終局 ⇒ staff 表抖兩秒, 全體分頁永久停止續期,
    //    15 分鐘後所有人被踢去跑完整 SSO。
    //    ⚠️ 而那個病在真實世界【不會每天發生】⇒ 沒有這一格就沒有人會發現它回來。
    fetchMock.mockImplementation(async () => OK('not-active', 403));
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock, '403 被當成終局 ⇒ 一次 DB 抖動變成全體重新登入').toHaveBeenCalledTimes(2);
  });

  it('[C6] 🔴 連續三發被閘導走 ⇒ 才停 —— 不是第一發就放棄(codex 補審 nit)', async () => {
    // 🔴 `opaqueredirect` 對「票真的死了」與「那台 instance 讀不到 env」是同一個形狀。
    //    第一發就停 ⇒ 一次瞬時故障 = 這個分頁的人 15 分鐘後被登出, 而畫面上零訊號。
    fetchMock.mockImplementation(
      async () => ({ type: 'opaqueredirect', status: 0 }) as unknown as Response,
    );
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0); // 第 1 發
    await vi.advanceTimersByTimeAsync(60_000); // 第 2 發
    expect(fetchMock, '第二發就停了 ⇒ 容錯沒生效').toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); // 第 3 發 ⇒ 到門檻
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchMock, '第三發之後還在敲 ⇒ 永遠不會停').toHaveBeenCalledTimes(3);
  });

  it('[C6b] ✅ 中間插一發正常的 ⇒ 計數要歸零, 不得累積成「總共三次」', async () => {
    // 沒有這一格的話, 一個只會累加、不會歸零的計數器也是綠的
    // ⇒ 一個人開著分頁一整天、偶爾抖三次, 就被永久停掉。
    let n = 0;
    fetchMock.mockImplementation(async () => {
      n += 1;
      return n % 2 === 1
        ? ({ type: 'opaqueredirect', status: 0 } as unknown as Response)
        : OK('fresh');
    });
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000 * 6);
    expect(fetchMock, '計數沒歸零 ⇒ 一天抖三次就被永久停掉').toHaveBeenCalledTimes(7);
  });

  it('[C7] 網路壞掉 / body 不是 JSON ⇒ 什麼都不做, 下一輪照樣試', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock, '網路抖一下就放棄續期 ⇒ 使用者 15 分鐘後被踢').toHaveBeenCalledTimes(2);
  });

  it('[C8] 分頁回到前景 ⇒ 立刻補敲一次(筆電睡醒那一格, 補審 M4)', async () => {
    render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    // jsdom 的 visibilityState 預設就是 'visible'
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('[C9] unmount ⇒ 計時器要收乾淨, 不得繼續敲', async () => {
    const { unmount } = render(<SessionRenew />);
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
