import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
  /**
   * 🔵 **自己接手某些請求** —— 回 `true` = 我處理掉了, helper 就**不再**回那份 HTML。
   *
   * 🔴 **它為什麼存在**(2026-09-06 主視窗 `-f8` 派):`cancel-forms-browser.test.tsx` 要**攔表單送出的 body**
   *    ⇒ 它的伺服器對 `POST` 與 `GET` 回不同東西 ⇒ 第一版 helper 只會回一份固定 HTML, 套不進去。
   *    而那一支**正是 backlog `:15807` 記過同型紅的那個已知犯案者** ⇒ 它最需要那道重試。
   * 🛑 **而 `GET` 那一半仍然由 helper 回, 理由是【零收益多一個會漂移的副本】** ——
   *    忠實搬過去的話行為完全相同(R1 實查), 而那份 HTML 的組法就會有兩個地方寫著同一件事。
   *    ⛔ ~~我原本寫「把 GET 也接手 ⇒ 那個機制就散掉了」~~ —— **那是沒量過的反事實**(R1 must-fix)。
   *    🔴 **而我連「那個機制住在哪」都指錯了**:那支檔名為 harness 自檢的 describe **不等 `#done`**
   *      (它只 `waitForLoadState('load')`), 靠的是 `toHaveLength(0)`;
   *      「等 `#done` 逾時」那顆牙住在**另外六格**。⇒ 📌 **指錯守門位置 ⇒ 下一個人會去放寬錯的那一格。**
   */
  handle?: (req: IncomingMessage, res: ServerResponse) => boolean;
  /**
   * 🔵 **只給本檔的自測用** —— 伺服器起好之後、`goto` 之前, 把**完整的 origin** 交出去。
   * 🔴 它存在的理由是**`handle` 那三格要真的打一發 HTTP**(回 true / 回 false / 丟錯),
   *    而假的 browser 打不出請求。⇒ 📌 沒有它, `handle` 就只能靠讀碼相信, 而 R1 指出那是**零格覆蓋**。
   *
   * 🔴🔴 **它交出去的是 origin 不是 port, 而那個差別是我【自己踩到才改的】**(2026-09-06):
   *    第一版交 port、呼叫端自己拼 `http://127.0.0.1:${port}` ⇒ 而伺服器綁的是 `::`
   *    ⇒ **單獨跑 12 發零紅, 而整族一起跑(有負載)時紅了一發**
   *    (`TypeError: fetch failed` / `SocketError: other side closed` / `bytesRead: 0`)。
   *    ⇒ 🛑 **那正是我在這支檔裡剛拿掉的那個假設 —— 我在它的測試裡又犯了一次。**
   *    ⇒ ✅ 交 origin ⇒ 測試打的位址**與 `goto` 打的完全同一個**, 不再各自拼。
   * 🔴 **重試那一發會【再叫它一次】, 而 origin 不同**(R2 nit)——
   *    每一發都重新 `createServer` + `listen(0)` ⇒ **port 是新的**。
   *    ⇒ 📌 呼叫端若把 origin 記在外面, 記到的會是**最後那一發**的;
   *      而它若在 `onOrigin` 裡累積東西, 那個陣列會有**兩發的量**。
   * 🛑 **正式呼叫端不要用它** —— 它不是給測試檔以外的人用的鉤子。
   */
  onOrigin?: (origin: string) => Promise<void>;
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
    const server: Server = createServer((req, res) => {
      // 🔴 呼叫端先看一眼;它說「我處理了」就到此為止(見 `handle` 的 docstring)。
      // 🔴🔴 **而它丟錯要被接住 —— 這一格【就是本族的病】**(R1 升 must-fix):
      //    `handle` 丟錯而沒人接 ⇒ 這個請求**永遠不會有回應** ⇒ `page.goto` 卡到
      //    **30 秒導航逾時**, 而那個錯**不在 `RETRYABLE` 名單上** ⇒ 原樣丟。
      //    ⇒ 📌 一個「呼叫端寫錯」會長成「機器很忙」的樣子, 而且**重試救不了它**。
      //    ⇒ ✅ 回 500:它是**一個看得懂的回應**, 而看得懂的錯比一個 30 秒的沉默好。
      // 🛑🛑 **射程:這道 `try` 只接得住【同步的那一半】**(R2 nit)——
      //    呼叫端在 `req.on('data'/'end')` 的**回呼裡**丟錯, 那已經是另一個 tick,
      //    **這裡接不到** ⇒ 那個請求一樣會永遠沒有回應。
      //    ⇒ 📌 **所以本段擋住的是「handle 本體丟錯」, 不是「handle 這條路上的任何錯」** ——
      //      不要把它讀成後者。(要擋後者得由呼叫端自己在回呼裡包, helper 看不到那一層。)
      try {
        if (opts.handle?.(req, res) === true) return;
      } catch (err) {
        // 🔴 `headersSent` 要問一次(R2 nit):呼叫端可能**已經 `writeHead` 過**才丟錯
        //    ⇒ 這裡再寫一次 header 會**丟出第二個錯**, 而那個錯會蓋掉原本那個。
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`handle threw: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
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
      const origin = `http://${host}:${addr.port}`;
      await opts.onOrigin?.(origin);
      await page.goto(`${origin}/`);
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
