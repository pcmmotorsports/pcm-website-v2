import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'playwright';
import { serveHtmlAndVisit } from './serve-html-and-visit';

// serve-html-and-visit 的守門 —— **兩個世界都要被構造出來**。
//
// 🔵 **它不起真瀏覽器**:`serveHtmlAndVisit` 只用到 `browser.newPage()`
//    ⇒ 餵一個假的 browser 就驗得完那段重試邏輯, 而**真瀏覽器那一層由呼叫端各自的測試守**。
//    ⇒ 📌 這一格問的是「重試的規矩對不對」, 不是「瀏覽器能不能開」。
//
// 🛑 **它證不到**:真的 `ERR_EMPTY_RESPONSE` 在真 chromium 上長什麼樣 ——
//    那一行字面是從 39b 收割鏈的 `t2.log:136` 逐字抄來的, 不是我編的。

/** 39b 收割鏈 `t2.log:136` 逐字那一行。 */
const REAL_EMPTY = 'page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:54336/';

function fakeBrowser(gotoBehaviour: (attempt: number) => Promise<void>) {
  const closed = { pages: 0 };
  let attempt = 0;
  const browser = {
    newPage: async () => {
      attempt += 1;
      const n = attempt;
      const page = {
        goto: async () => gotoBehaviour(n),
        close: async () => {
          closed.pages += 1;
        },
      };
      return page as unknown as Page;
    },
  } as unknown as Browser;
  return { browser, closed, attempts: () => attempt };
}

afterEach(() => vi.restoreAllMocks());

describe('serveHtmlAndVisit 的重試紀律(兩個世界)', () => {
  it('🔴 第一發空回應、第二發好 ⇒ 過, 而且【印了一行】', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, attempts } = fakeBrowser(async (n) => {
      if (n === 1) throw new Error(REAL_EMPTY);
    });
    const got = await serveHtmlAndVisit(browser, '<p>x</p>', async () => 'ok', { label: '自測' });
    expect(got).toBe('ok');
    expect(attempts(), '沒有重試 ⇒ 這一格的前提沒了').toBe(2);
    // 🔴 **這一行是本檔的重點**:一個安靜的重試會把「機器過載」變成「一切正常」。
    expect(warn, '重試了而沒有印出來 ⇒ 那個訊號永遠不會存在').toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('重試 1 次');
    expect(String(warn.mock.calls[0]?.[0]), '訊息沒帶 label ⇒ 讀 log 的人不知道是哪一支').toContain('自測');
  });

  it('🔴 連兩發都空回應 ⇒ 丟出去(最多一次, 不無限重試)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, attempts } = fakeBrowser(async () => {
      throw new Error(REAL_EMPTY);
    });
    await expect(serveHtmlAndVisit(browser, '<p>x</p>', async () => 'ok')).rejects.toThrow('ERR_EMPTY_RESPONSE');
    expect(attempts(), '試了超過兩次 ⇒ 重試上限沒生效').toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // 🔴🔴 **這一格是那四條紀律裡最重要的一條**:斷言失敗絕不重試。
  //    把它重試掉 = 把一個真的回歸變成「偶爾紅」, 而那比沒有守門更糟。
  it('🔴 visit 裡丟出來的(= 斷言失敗)⇒ 原樣丟, 不重試、不印 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, attempts } = fakeBrowser(async () => {});
    await expect(
      serveHtmlAndVisit(browser, '<p>x</p>', async () => {
        throw new Error('expected 105 to be close to 99');
      }),
    ).rejects.toThrow('expected 105');
    expect(attempts(), '斷言失敗被重試了 —— 這正是本檔明文禁止的那件事').toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('🔵 負對照:一個【不在重試名單上】的 goto 錯誤 ⇒ 原樣丟, 不重試', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, attempts } = fakeBrowser(async () => {
      throw new Error('page.goto: net::ERR_ZZQ9_MADE_UP at http://localhost:1/');
    });
    await expect(serveHtmlAndVisit(browser, '<p>x</p>', async () => 'ok')).rejects.toThrow('ERR_ZZQ9_MADE_UP');
    expect(attempts(), '什麼錯都重試 ⇒ 那不是重試名單, 是無條件重試').toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('🔵 每一發都把分頁收乾淨(重試那一發也是)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, closed } = fakeBrowser(async (n) => {
      if (n === 1) throw new Error(REAL_EMPTY);
    });
    await serveHtmlAndVisit(browser, '<p>x</p>', async () => 'ok');
    expect(closed.pages, '重試時漏關分頁 ⇒ 跑久了會累積').toBe(2);
  });
});
