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
  const urls: string[] = [];
  let attempt = 0;
  const browser = {
    newPage: async () => {
      attempt += 1;
      const n = attempt;
      const page = {
        goto: async (url: string) => {
          urls.push(url);
          return gotoBehaviour(n);
        },
        close: async () => {
          closed.pages += 1;
        },
      };
      return page as unknown as Page;
    },
  } as unknown as Browser;
  return { browser, closed, urls, attempts: () => attempt };
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

  it('🔴 連兩發都空回應 ⇒ 丟出去(最多一次), 而【第一發的錯要跟著走】', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 兩發**不同**的錯 —— 這樣才驗得出 cause 帶的是第一發那個, 不是第二發。
    const { browser, attempts } = fakeBrowser(async (n) => {
      throw new Error(n === 1 ? `${REAL_EMPTY} FIRSTONE` : 'page.goto: net::ERR_CONNECTION_REFUSED SECONDONE');
    });
    const caught = await serveHtmlAndVisit(browser, '<p>x</p>', async () => 'ok').catch((e: unknown) => e);
    expect(attempts(), '試了超過兩次 ⇒ 重試上限沒生效').toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const err = caught as Error;
    expect(err.message, '第二發的成因沒帶出來').toContain('SECONDONE');
    // 🔴 **R1 nit**:第一發原本只活在 `console.warn` 裡 ⇒ 讀 CI 紅字的人看不到它,
    //    而**兩發的成因可以不一樣**(這一格就餵了兩個不同的錯)。
    expect(
      (err.cause as Error | undefined)?.message,
      '第一發的錯沒有掛進 cause ⇒ 它只活在 warn 裡, 而紅字上看不到',
    ).toContain('FIRSTONE');
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

  // 🔴🔴 **這一格是 R1 逼出來的, 而【逼出它的是一發沒有紅的突變】**(2026-09-06):
  //    R1 說「拿掉 `arrived ||` 應該會殺掉『斷言不重試』那一格」⇒ 我照著跑 ⇒ **6 格全綠, 一格都沒死。**
  //    🔬 查出來的原因:那一格的斷言訊息是 `expected 105 to be close to 99` ——
  //      它**不含**重試名單上的字 ⇒ 擋住它的是**錯誤訊息比對**, **不是 `arrived`**。
  //    ⇒ 🛑 **所以「斷言失敗絕不重試」這條紀律, 當時【沒有任何一發突變證明得了】** ——
  //      而我在檔頭把它寫成「最重要的一條」。📌 **宣稱最重要的那條, 咬合力最弱。**
  //    ✅ 這一格補的正是**只有 `arrived` 擋得住**的那個世界:
  //      一個**斷言訊息裡剛好含著那個錯誤碼**的失敗(而那不是虛構 ——
  //      本檔自己就有一格在斷言 `ERR_EMPTY_RESPONSE` 這個字串)。
  it('🔴 斷言訊息裡【剛好含著那個錯誤碼】⇒ 仍然不重試(這一格只有 arrived 擋得住)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, attempts } = fakeBrowser(async () => {});
    await expect(
      serveHtmlAndVisit(browser, '<p>x</p>', async () => {
        // 一支在斷言「頁面有沒有印出 ERR_EMPTY_RESPONSE」的測試, 失敗時訊息就會長這樣。
        throw new Error('expected page text to contain ERR_EMPTY_RESPONSE');
      }),
    ).rejects.toThrow('expected page text');
    expect(attempts(), '斷言失敗被重試了 —— 而它只是因為訊息裡有那個字').toBe(1);
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

  // 🔴🔴 **主視窗 2026-09-06 舉的紅旗**:寫死 `localhost` 時它可能先解到 `::1`,
  //    而伺服器若只綁 IPv4 就 `ERR_CONNECTION_REFUSED` ⇒ **然後被本檔的重試吃掉**
  //    ⇒ 📌 **等於把一個新病餵給自己修的那個重試。**
  //    ✅ 修法是**不經過名字解析**:讀 `server.address()` 的 family 組網址。這一格釘住它。
  it('🔴 網址是照【伺服器真的綁到的 family】組的, 不是寫死一個名字', async () => {
    const { browser, urls } = fakeBrowser(async () => {});
    await serveHtmlAndVisit(browser, '<p>x</p>', async () => 'ok');
    expect(urls, '一個網址都沒撈到 ⇒ 這一格是恆真的').toHaveLength(1);
    const url = urls[0]!;
    // 🔵 兩個世界各自對:雙棧機器綁 `::` ⇒ `[::1]`;只有 IPv4 的機器 ⇒ `127.0.0.1`。
    expect(url, `網址是 ${url} —— 兩種 loopback 字面都不是`).toMatch(/^http:\/\/(\[::1\]|127\.0\.0\.1):\d+\/$/);
    // 🔴 負對照:**不可以**是那個要靠 DNS 的名字 —— 那正是紅旗那一格。
    expect(url, '又寫死 localhost 了 ⇒ 解析順序會決定它通不通, 而失敗會被重試吃掉').not.toContain('localhost');
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
