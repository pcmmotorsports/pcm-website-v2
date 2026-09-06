import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser, Page } from 'playwright';

// serve-html-and-visit —— 「起一個只回這份 HTML 的伺服器 → 用瀏覽器打開它」那一段, 收成一支。
//
// ══ 🔴 它為什麼存在(2026-09-06 39b 收割鏈實撞, 主視窗 `-f8` 派)══════════════
//    收割鏈第一發 `test2` 兩支 browser 測試紅, 而紅字**不是斷言失敗**:
//      `t2.log:136` 逐字 `Error: page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:54336/`
//      `:152` 同型(port 54316)
//    ⇒ **測試自己起的那個伺服器把連線接了、然後一個位元組都沒回。**
//    🔬 成因是負載:`harvest-chain.sh:281-282` 的 test2 段是
//      `pnpm vitest --run --maxWorkers=2` **讓 vitest 自己排** —— 沒走
//      `browser-test-family.py --run`(那支才是序列跑)⇒ 這一族會跟別的東西搶。
//    ⚠️ 板上記過同型:`docs/phase-1-backlog.md:15807`(`cancel-forms-browser`)· `:20021`。
//
// ══ 🛑🛑 它【不是】把那件事修好了 —— 這一段不要被讀掉 ══════════════════════
//    它把**一個硬紅換成一個比較慢的綠**, **完全沒有動到根因**(負載)。
//    ⇒ 📌 根因那一半在別的地方(主段要不要排除這一族、族段要不要另跑 serial),
//      主視窗 2026-09-06 裁 A:主段不排除、族段另跑 serial ⇒ **主段裡這一族照樣會搶**
//      ⇒ **本檔就是主段那一半的補法。** 兩件不衝突, 而也不互相取代。
//
// ══ 🔴 重試的四條紀律(每一條都有理由, 不要自己放寬)══════════════════════
//    ① **只重試連線層的兩種**:`ERR_EMPTY_RESPONSE` / `ERR_CONNECTION_REFUSED`。
//       ⛔ **絕不重試斷言失敗** —— 那兩種在 rc 上一樣, 而處置相反
//         (一個是機器忙, 一個是碼壞了;把後者重試掉 = 把一個真的回歸變成偶爾紅)。
//    ② **最多一次。** 重試兩次以上代表這不是瞬時, 而那時要看到紅。
//    ③ **單位是「起伺服器 + 開分頁 + goto」整段, 不是只有 goto。**
//       空回應代表**那個 socket 已經被接了又斷** ⇒ 對同一個 port 再 goto 會一直失敗。
//    ④ 🔴🔴 **重試那一發【一定要印一行】。**
//       **一個安靜的重試會把「這台機器過載了」變成「一切正常」** ——
//       ⇒ 📌 而那正是這個 repo 一直被燒的那一類:**訊號沒有產生, 與訊號沒被讀到, 印同一個綠。**
//       重試變頻繁時要有人看得到, 而沒有印出來的話**那個訊號永遠不會存在**。

/** 這兩種是「連線層」的錯 —— 機器忙, 不是碼壞了。 */
const RETRYABLE = ['ERR_EMPTY_RESPONSE', 'ERR_CONNECTION_REFUSED'];

function isTransientGotoError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE.some((code) => msg.includes(code));
}

export type ServeHtmlOptions = {
  /** 瀏覽器視窗大小 —— 量版面的那幾支要它。 */
  viewport?: { width: number; height: number };
  /** 出現在重試訊息裡, 讓人知道是哪一支在重試(預設不帶)。 */
  label?: string;
};

/**
 * 起一個只回 `html` 的伺服器, 用一個新分頁打開它, 把分頁交給 `visit`, 然後收乾淨。
 *
 * 🔴🔴 **網址是從【伺服器真的綁到哪】組出來的, 不是寫死 `localhost`**
 *    (2026-09-06 主視窗 `-f8` 舉紅旗, 而它是對的):
 *    ⛔ 我第一版寫死 `http://localhost:${port}` ——
 *      **`localhost` 可能先解到 `::1`, 而伺服器若只綁 IPv4 就會 `ERR_CONNECTION_REFUSED`**
 *      ⇒ 🛑 **然後被本檔剛加的重試吃掉** ⇒ 📌 **等於把一個新病餵給自己修的那個重試。**
 *    🔬 **本機實測**(`listen(0)` 不帶 host):綁到 `{"address":"::","family":"IPv6"}`,
 *      `localhost` 解析順序 `::1` → `127.0.0.1`, 三種網址(localhost / 127.0.0.1 / [::1])**都回 200**
 *      ⇒ ✅ **這台機器上沒有那個問題** —— 而 **「這台機器上沒事」不是「它不會發生」**
 *      (關掉雙棧、或 IPv6 被停用的機器上就不是這個答案, 而 CI 不是這台機器)。
 *    ⇒ ✅ **修法是把那個假設整個拿掉**:讀 `server.address()` 的 family,
 *      IPv6 ⇒ `[::1]`、IPv4 ⇒ `127.0.0.1`。**兩個世界各自對, 而且不經過任何名字解析。**
 *    🔵 `CLAUDE.md` 那條「瀏覽器一律用 `localhost`」**射程不涵蓋這裡** ——
 *      它講的是 **Next dev 對 `127.0.0.1` 把 chunk 擋成 403**, 而本檔服務的是自己組的 HTML、零 chunk。
 *
 * 🛑 `visit` 裡丟出來的東西(= 斷言失敗)**原樣往上丟, 不重試、不包裝**。
 */
export async function serveHtmlAndVisit<T>(
  browser: Browser,
  html: string,
  visit: (page: Page) => Promise<T>,
  opts: ServeHtmlOptions = {},
): Promise<T> {
  /** 🔴 第一發的錯要**跟著**第二發丟出去(R1 nit):否則它只活在 `console.warn` 裡,
   *    而讀 CI 紅字的人看不到「第一發是為什麼掛的」—— 兩發的成因可以不一樣。 */
  let firstErr: unknown;
  for (let attempt = 1; ; attempt += 1) {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address() as AddressInfo;
    // 🔴 **從它真的綁到的 family 組網址** —— 理由見檔頭那段紅旗。
    const host = addr.family === 'IPv6' ? '[::1]' : '127.0.0.1';
    const page = await browser.newPage(opts.viewport === undefined ? {} : { viewport: opts.viewport });
    let arrived = false;
    try {
      await page.goto(`http://${host}:${addr.port}/`);
      arrived = true;
      // 🔴 `arrived` 之後丟出來的都是 `visit` 的錯(= 斷言)⇒ 下面那個 catch 不會重試它。
      return await visit(page);
    } catch (err) {
      if (arrived || !isTransientGotoError(err)) throw err;
      if (attempt > 1) {
        // 🔵 帶著第一發的錯一起丟 —— `cause` 讓 CI 紅字看得到兩發各自的成因。
        throw new Error(
          `serveHtmlAndVisit: 連續兩發都在連線層失敗(${opts.label ?? 'unlabelled'})—— ` +
            `第二發:${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
          { cause: firstErr },
        );
      }
      firstErr = err;
      // 🔴 這一行是本檔的重點, 不是附帶 —— 見檔頭紀律 ④。
      console.warn(
        `[serve-html-and-visit] goto 連線層失敗(${opts.label ?? 'unlabelled'}), 重試 1 次 —— ` +
          `這【不是】碼壞了, 是機器忙;而它變頻繁時代表那一段該序列跑。原錯:` +
          `${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
    } finally {
      // 🔴 **兩段分開**(R1 nit):`page.close()` 丟錯的話, 下面那個 `server.close()` 就不會跑
      //    ⇒ **漏一個 server**。而這一族的病正好是負載 ⇒ 漏掉的那些會累積。
      //    ⚠️ 原本那五支是同一個形狀 ⇒ **不是本片引入的**, 而現在集中在一處 ⇒ 修一次全族受益。
      try {
        await page.close();
      } catch {
        /* 關分頁失敗不該蓋掉真正的錯, 也不該擋住下面關 server */
      }
      // 🔴 **等它真的關完, 不是叫一聲就走**(2026-09-06 核 diff 時抓到)——
      //    `orders-status-visibility-browser.test.tsx` 原本逐字是
      //    `await new Promise<void>((r) => server.close(() => r()));` ⇒ 它**等**。
      //    ⛔ 我第一版寫成裸 `server.close()` ⇒ 那只是**要求**它關, 不等它關完。
      //    ⇒ 🛑 而這一族的病正好是**負載**:沒關完的 socket 疊起來, 會餵養它自己要修的那個東西。
      //    ⇒ 📌 一個「搬過去的時候順手簡化掉」的等待, 在 diff 上看不出重量。
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
}
