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
// 🔴 本檔現在會 `importOriginal` 真的 `freshness-read`(見下方那顆 mock 的理由),
//    而那支檔 `import 'server-only'` ⇒ jsdom 下會拋。全 repo 90 支測試檔用同一句解。
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  listActiveStaff: vi.fn(),
  loadTodaySummary: vi.fn(),
  loadDataFreshness: vi.fn(),
  loadCronHeartbeats: vi.fn(),
}));
vi.mock('../lib/session/actor-actions', () => ({ selectActorAction: vi.fn() }));
vi.mock('../lib/session/actor', () => ({
  ACTOR_ID_FIELD: 'actor_id',
  getSessionActor: mocks.getSessionActor,
}));
vi.mock('../lib/staff', () => ({ listActiveStaff: mocks.listActiveStaff }));
vi.mock('../lib/dashboard/today-read', () => ({ loadTodaySummary: mocks.loadTodaySummary }));
// 🔴 `freshnessLabel` **刻意不 mock** —— 它是那一行字的真正作者。
//    mock 掉它,下面「量不到」那一格就會變成在驗我自己寫的假字串。
vi.mock('../lib/dashboard/freshness-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadDataFreshness: mocks.loadDataFreshness,
}));
// 同上:`unreadableReport` **刻意不 mock** —— 它是「量不到長什麼樣」的唯一作者。
vi.mock('../lib/dashboard/cron-heartbeat-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCronHeartbeats: mocks.loadCronHeartbeats,
}));

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
  mocks.loadDataFreshness.mockResolvedValue({ hoursAgo: 3, stale: false, abnormal: false, unreadableReason: null });
  mocks.loadCronHeartbeats.mockResolvedValue({
    jobs: [
      { jobName: 'pcm-settle-sweep', label: '結帳掃描', minutesAgo: 1, consecutiveFailures: 0, abnormal: false, note: '1 分前成功' },
    ],
    neverBeat: [],
    unknownJobs: [],
    unreadableReason: null,
  });
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
    // 🔴 灰字那一行是【常亮的值】⇒ 正常時它就要在畫面上,不是只有出事才出現。
    expect(container.textContent).toContain('供應商資料最後更新:3 小時前');
    expect(container.querySelector('[data-testid="data-freshness"]')?.className).toContain(
      'text-muted-foreground',
    );
  });

  // ══ 資料新鮮度那一行的兩個世界(`q1: 甲`,Sean 2026-08-28)══════════════════
  it('🔴 資料舊了 ⇒ 同一行字轉成 destructive 色(而字照樣在)', async () => {
    mocks.loadDataFreshness.mockResolvedValue({ hoursAgo: 40, stale: true, abnormal: true, unreadableReason: null });
    const { container } = render(await AdminHomePage());
    expect(container.textContent).toContain('供應商資料最後更新:40 小時前');
    expect(container.querySelector('[data-testid="data-freshness"]')?.className).toContain(
      'text-destructive',
    );
  });

  it('🔴🔴 R1 must-fix:時間戳在未來 ⇒ 也要用警示色(它【不是】stale,而它是唯一確定有東西寫錯的世界)', async () => {
    // 這一格是補上來的:原本三發突變沒有任何一發碰到這條路,
    // 而漏掉它的時候「文字層印了、顏色層把它藏回去」全綠。
    mocks.loadDataFreshness.mockResolvedValue({
      hoursAgo: -3.2,
      stale: false,
      abnormal: true,
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const line = container.querySelector('[data-testid="data-freshness"]');
    expect(line?.textContent).toContain('未來');
    expect(line?.className).toContain('text-destructive');
    expect(line?.className).not.toContain('text-muted-foreground');
  });

  it('🔴 新鮮度讀取拋錯 ⇒ 印「量不到」,**不得留白**,而其他區照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadDataFreshness.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    const line = container.querySelector('[data-testid="data-freshness"]');
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain('量不到');
    expect(line?.textContent?.trim()).not.toBe(''); // 空白 = 與「還沒載完」同形,那是這片在修的病
    expect(line?.className).toContain('text-destructive');
    // 這一格掛掉不得把對帳與身分帶走
    expect(container.textContent).toContain('今日實收');
    expect(container.querySelector('select#actor_id')).not.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ══ 排程心跳那一區(3a)══════════════════════════════════════════════════
  it('🔴 正常時那一區就在畫面上(常亮的值,不是只有出事才出現)', async () => {
    const { container } = render(await AdminHomePage());
    expect(container.querySelector('[data-testid="cron-health"]')).not.toBeNull();
    const row = container.querySelector('[data-testid="cron-job-pcm-settle-sweep"]');
    expect(row?.textContent).toContain('結帳掃描');
    expect(row?.className).toContain('text-muted-foreground');
  });

  it('🔴 某一支異常 ⇒ 那一列轉 destructive 色(而字照樣在)', async () => {
    mocks.loadCronHeartbeats.mockResolvedValue({
      jobs: [
        { jobName: 'pcm-settle-sweep', label: '結帳掃描', minutesAgo: 99, consecutiveFailures: 0, abnormal: true, note: '已經 99 分沒成功(門檻 6 分)' },
      ],
      neverBeat: [],
      unknownJobs: [],
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const row = container.querySelector('[data-testid="cron-job-pcm-settle-sweep"]');
    expect(row?.textContent).toContain('99 分沒成功');
    expect(row?.className).toContain('text-destructive');
    expect(row?.className).not.toContain('text-muted-foreground');
  });

  it('🔴 兩種漂移印【不同的句子】,而且各自附「該怎麼辦」', async () => {
    mocks.loadCronHeartbeats.mockResolvedValue({
      jobs: [],
      neverBeat: ['pcm-expire-unpaid-orders'],
      unknownJobs: ['pcm-brand-new-job'],
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="cron-health"]')?.textContent ?? '';
    expect(t).toContain('從來沒寫過心跳');
    expect(t).toContain('pcm-expire-unpaid-orders');
    expect(t).toContain('接線了沒');            // 該怎麼辦①
    expect(t).toContain('沒在看的心跳');
    expect(t).toContain('pcm-brand-new-job');
    expect(t).toContain('白名單過期');          // 該怎麼辦②
  });

  it('🔴 心跳讀取拋錯 ⇒ 印「量不到」,不得留白,而其他區照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadCronHeartbeats.mockRejectedValue(new Error('boom'));
    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="cron-health"]');
    expect(box?.textContent).toContain('量不到');
    expect(box?.textContent?.trim()).not.toBe('');
    expect(container.textContent).toContain('今日實收'); // 沒有把別區帶走
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
