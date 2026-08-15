// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// page.test.tsx — `#16` 的 **MF6 守門:對帳讀取失敗不得把整頁帶走**。
//
// 🔴 這一格的必要性:`today-read.ts` 寫著「寧可炸也不要顯示少算的數字」,那句只證成
//    **那幾格**該炸。第一版把 `await loadTodaySummary()` 裸放在頁面 body ⇒ 對帳一失敗,
//    連 M0-S2 具名身分(這頁原本**唯一在用**的功能)一起 500。
//    把 try/catch 拿掉、或把身分那塊挪進 try 裡,下面第二格就紅。
//
// 🔴 誠實邊界:這是 **jsdom 下對 server component 回傳樹的渲染**,
//    **不證** Next 真的這樣渲染、不證 server action 真的能送出、也不證 DB 行為。
const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  listActiveStaff: vi.fn(),
  loadTodaySummary: vi.fn(),
}));
vi.mock('../lib/session/actor-actions', () => ({ selectActorAction: vi.fn() }));
vi.mock('../lib/session/actor', () => ({
  ACTOR_ID_FIELD: 'actor_id',
  getSessionActor: mocks.getSessionActor,
}));
vi.mock('../lib/staff', () => ({ listActiveStaff: mocks.listActiveStaff }));
vi.mock('../lib/dashboard/today-read', () => ({ loadTodaySummary: mocks.loadTodaySummary }));

import AdminHomePage from './page';

const SUMMARY = {
  ymd: '2026-08-14',
  receivedAmount: 12345,
  newOrderCount: 7,
  refundExceptionCount: 2,
  refundExceptionTruncated: false,
  failedSections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionActor.mockResolvedValue({ id: 's1', label: '小陳' });
  mocks.listActiveStaff.mockResolvedValue([{ id: 's1', label: '小陳' }]);
  mocks.loadTodaySummary.mockResolvedValue(SUMMARY);
});
afterEach(cleanup);

describe('AdminHomePage', () => {
  it('正常時:三格數字與身分選單都在(正向對照,證明下一格的斷言真的看得到東西)', async () => {
    const { container } = render(await AdminHomePage());
    expect(container.textContent).toContain('今日實收');
    expect(container.textContent).toContain('NT$ 12,345');
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.textContent).toContain('切換');
    expect(container.textContent).not.toContain('今日對帳載入失敗');
  });

  it('🔴 MF6:對帳讀取拋錯 ⇒ 只有那一區變失敗卡,身分選單照樣可用', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadTodaySummary.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    expect(container.textContent).toContain('今日對帳載入失敗');
    // 🔴 這三條才是 MF6 的本體:身分那塊**沒有**被一起帶走。
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('select#actor_id')).not.toBeNull();
    expect(container.textContent).toContain('切換');
    // 數字不得留在畫面上(免得員工看到一個沒更新的舊值當今天的)。
    expect(container.textContent).not.toContain('今日實收');

    // 失敗要留痕:靜默吞掉的話,線上永遠不知道這一區壞了。
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
