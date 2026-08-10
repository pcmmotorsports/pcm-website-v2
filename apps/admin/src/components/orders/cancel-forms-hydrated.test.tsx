// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { isUuid } from '../../lib/orders/note-action-state';

// cancel-forms-hydrated.test.tsx — M-4b E10 **A13b 片 2**:取消表單的**真瀏覽器 + React runtime** 測試。
//
// 🔴🔴 **為什麼要有這一支,而不是併進 `cancel-forms-browser.test.tsx`**:
//    那一支量的是「**JS 不在場**」那一側(`renderToStaticMarkup` → 靜態 HTML → 瀏覽器原生送出),
//    它的檔頭「這個 harness 重現得了什麼、重現不了什麼」那段,與
//    `describe('D6-a 判別力邊界…')` 裡的「併回單一 radio 形狀:本 harness **抓不到**」那格,
//    逐字記載了一件**它做不到**的事:
//      「React 19 在 action 完成後的 form reset —— `E-011-STOP` 那個 radio 被勾回 `full` 的直接成因 ——
//        需要 React 在 client 端接管表單才會發生,本 harness 是靜態 HTML、沒有 React runtime ⇒ 重現不了。」
//    本檔就是去補那一面:**把 action 換成真的 function、讓 React 接管送出**。
//
// 🔴🔴 **實測結論(不是推論)**:那條 reset **重現得出來**,而且比原本的理論更利 ——
//    **不需要按返回鍵 / 不需要 bfcache**,reset 就在同一頁、action resolve 之後發生:
//      挑 partial → 送出(body=`partial`)→ React reset → radio 被打回 `defaultChecked` 的 `full`
//      → 員工再按一次送出 → body=**`full`**。
//    ⚠️ **這是機制的重現,不是事故現場的重現**(code-reviewer R1 nit,接受):對照組是一張
//      只有兩顆 radio、沒有 `required` 的裸表單。真表單的第二次點擊會被 `reason_code required`
//      擋住(下面那格自己證的)⇒ 證到的是「**reset 這個機制會把 radio 打回 defaultChecked**」,
//      不是「E-011 當天就是照這條路發生的」。
//    ⇒ `cancel-forms-browser.test.tsx` 那條「本 harness 抓不到 radio 形狀」的誠實記載,
//      在**本檔**不再成立。那一格留在原處(它對**那個** harness 仍然是事實),本檔補上殺得掉的靶:
//      **靶 M2**(把真元件的 hidden `cancel_mode` 改回 radio 對)實測 **KILLED**。
//
// 🔴 **harness 形狀**:esbuild(從 pnpm store 解析)把 entry 打包成瀏覽器 bundle → node http server
//    → playwright 驅動 → 攔 `fetch('/submit')` 的 body。SSR 標記**由 bundle 自己在瀏覽器裡產**
//    (`renderToString` 同一顆 element)⇒ 不可能有「手寫 SSR HTML 與元件漂掉」那種假綠。
//
// 🔴 **`pnpm --filter @pcm/admin lint` 對本檔零判別力**(R1 nit,實查 `eslint.config.js` 的 ignores
//    含 `**/*.test.tsx`)⇒ 三綠裡的 lint 那一格**沒有看過這個檔**。收工回報要照這個字面寫,
//    不要拿「lint exit=0」當本檔的品質證據。守本檔的是 typecheck、vitest 與下面的突變靶。
//
// 🔴🔴 **被合成的東西,逐條列出**(沿用 `cancel-forms-browser.test.tsx` 檔頭的誠實邊界慣例):
//    ① **server action 被換成一個 client function**(esbuild plugin 換掉 `cancel-actions`)。
//       真站是 server action ⇒ 真 Next 會多一顆 `$ACTION_ID` hidden 欄位、且送出走 RSC 協定。
//       **對本檔要量的東西不影響**:React 對「server action」與「client async function」走的是**同一條**
//       function-action 路徑(接管送出 → 等 promise → reset),而本檔量的正是那條 reset。
//       但因此本檔**只主張欄位值**,不主張 body 全等於真站。
//       ⚠️ **而且這顆 stub 永遠 resolve、永遠不拒**(Fable 第三輪 nit):真站的 action 會拒
//       (`invalid` / `denied` / RPC 各種碼)並導頁。⇒ 本檔量到的每一次「送得出去」
//       都只代表**瀏覽器層送得出去**,不代表那份 body 在真站會被接受。
//    ② **整棵樹被打包進瀏覽器**。真站是 RSC:`CancelFormShell`(server)只在 server 跑,
//       瀏覽器只拿到 `CancelFormBody`(`'use client'`)。本檔把 shell 也打包進去了
//       ⇒ 三顆 hidden 與 token 在瀏覽器**又被渲染了一次**(真站只在 server 鑄一次)。
//       ⚠️ 這件事**沒有任何觀測點**:input `value` 的 SSR/client 分歧在 dev 與 prod **都完全無聲**
//         (實測,見下面「守得到什麼」那段)。曾經有一顆 `crypto.randomUUID` 釘子號稱在處理它,
//         理由是假的、已拿掉(見本段之後的 ⚠️)。
//    ③ **SSR 標記用 `renderToString`,不是 `renderToStaticMarkup`**(code-reviewer R1 MF1,實測)。
//       ⚠️ 我第一版用了 `renderToStaticMarkup`,後果**不是**「少了幾個註解節點」而已:
//       它不吐 hydration 需要的文字節點分隔 ⇒ 每次都吐
//       `Hydration failed because the server rendered text didn't match the client.`
//       ⇒ **React 丟掉整棵 SSR 樹改用 client 重建** ⇒ 那三格量到的根本不是 hydration,
//       而 `__reactFiber$` 兩種情況都在、分辨不出來。改 `renderToString` 後實測乾淨。
//       ⇒ 現在每一格都收 `pageerror` **與** `console.error` 並斷言為空(`withHydratedPage`)。
//    ④ **React 是 development build**(`define: process.env.NODE_ENV='"development"'`),真站是 production。
//       ⚠️ **我上一版把這條寫錯了、而且方向是把真站風險講小**(code-reviewer R2 MF1,我複驗確認):
//       我寫「那顆 hydration 錯誤只有 dev build 會吐、真站會安靜地重建整棵樹」——**假的**。
//       實測(三種分歧 × 兩種 build):**text / 結構分歧在 dev 與 prod 都會 throw**
//       (prod 是 `Minified React error #418`,只是訊息不可讀)。留 dev build 是為了**讀得懂**,
//       不是為了「聽得到」。
//    ⑤ **送出後的回應是本 harness 自己回的 200**,不是 `redirect(303)` + PRG。
//       🔴 這一條比看起來重要:真站的 `cancelOrderAction` **每一條出口都 redirect**
//       (`cancel-actions.ts` 的 `failRedirect`×3 + 結尾 `redirect`,回傳型別 `never`)
//       ⇒ action resolve 之後瀏覽器就在換頁。**「reset 之後員工還在同一頁上按第二次」這個構型
//       在真站上可不可達,本 harness 證不了**,它是被合成⑤造出來的觀測窗。
//       ⇒ 下面所有關於 reset 窗口的結論,請讀成「這個機制存在、方向是這樣」,
//         **不要**讀成「真站上員工今天就能這樣操作」。
//
// 🔴🔴 **hydration 守門「守得到什麼」—— 實測三類分歧 × 兩種 build,不是推論**(R2 nit 4):
//
//    | 分歧種類 | dev build | production build |
//    |---|---|---|
//    | **text / 結構**(`renderToStaticMarkup` 那顆) | `pageerror` **throw** | `pageerror` throw(`#418`,訊息壓縮) |
//    | **attribute / className** | 只有 `console.error` | **完全無聲** |
//    | **`<input value>` / `defaultValue`** | **完全無聲** | **完全無聲** |
//
//    ⇒ 本檔收 `pageerror` **加** `console.error` ⇒ 前兩類守得到(第二類靠 dev build,這是留 dev 的實益)。
//    🔴🔴 **第三類守不到,而且那正是 `#357` 會踩的那一類** —— 「client 端重鑄 token」是 input `value`
//      的 SSR/client 分歧 ⇒ **本 harness 對它全盲**。下面那格叫修 `#357` 的人「回來重驗」,
//      請連這句一起讀:**重驗不能只靠跑這支測試**,它看不見你那個改動的主要失效形狀。
//
// ⚠️ **曾經有過的合成:`crypto.randomUUID` 被釘成定值 —— 已拿掉**。
//    我原本的理由是「不釘的話 SSR 與 hydrate 鑄出兩顆不同 token ⇒ 人造 mismatch」。
//    **實測是假的**(R1 MF1 附帶):改 `renderToString` 之後不釘也乾淨 —— React 本來就不比對
//    input 的 `value`。理由假的釘子就不該留,拿掉之後「兩次送出帶同一顆 token」那條斷言才有判別力
//    (釘著的時候全頁 token 都是定值,那條恆真)。
//
// ⚠️ **`hydration 自檢`那格是縱深、不是有判別力的守門(實測,不是客氣話)**:
//    我原本的理由是「bundle 壞掉 ⇒ 頁面退化成靜態 HTML ⇒ 其他格照樣全綠 = 恆真」。
//    **靶 M6 實測推翻了它**:拿掉那條 `__reactFiber$` 斷言,整支測試**仍然全綠**(SURVIVED)。
//    原因是本 harness 的 SSR 標記**由 bundle 自己產**(見 `bundleFor`)⇒ 不掛 bundle 時
//    `#root` 是空的,四格會直接紅在「找不到控制項」(靶 M1/M4 實測:4 紅)。
//    ⇒ 那格留著的理由是**把 harness 的承重假設寫在一個看得到的地方**,不是因為它擋得住什麼。
//    誰要刪它請照這段的實測結果判斷,不要照原本那句錯的理由。
//    (同款處置:`order-return-to.ts:188-193` 的出口形狀複驗。)

const ORDER = '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c';
const ITEM = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const RETURN_TO = `/orders?payment_status=paid&panel=${ORDER}`;

/**
 * repo 根 = 往上走到看得見 `node_modules/.pnpm` 的那一層。
 * 🔴 **不寫死相對層數**:本檔在 worktree(`pcm-cancel-ui`)與主樹(`pcm-website-v2`)兩邊都要跑得動,
 *    而層數寫死的話搬檔就靜默壞掉(症狀是「找不到 esbuild」,不是「測試紅得看得懂」)。
 */
function findRepoRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, 'node_modules', '.pnpm'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('找不到 node_modules/.pnpm —— repo 佈局變了,本 harness 需要它來解析 esbuild');
}

/**
 * 從 pnpm store 解析 esbuild。
 *
 * 🔴 **刻意不把 esbuild 寫進 `apps/admin/package.json`**:本 repo 目前是多視窗共用 clone,
 *    動 lockfile 等於要求其他所有視窗重跑 install。esbuild 本來就在 store 裡(vitest → vite 的依賴)。
 * ⚠️ 代價據實寫下:這條依賴的是**傳遞依賴的存在**。哪天 vite 不再帶 esbuild,本檔會在這裡
 *    **明確 throw**(不是靜默略過)—— 修法是那時候再把它加成 devDependency。
 *
 * ⚠️ **手寫最小型別**:esbuild 不是 `apps/admin` 的宣告依賴 ⇒ `typeof import('esbuild')`
 *    在 typecheck 會是 TS2307。只描述本檔真正用到的那一支,不假裝有完整型別。
 */
type EsbuildLike = {
  build(options: Record<string, unknown>): Promise<{ outputFiles?: { text: string }[] }>;
};

function loadEsbuild(root: string): EsbuildLike {
  const store = join(root, 'node_modules', '.pnpm');
  const dirs = readdirSync(store)
    .filter((d) => d.startsWith('esbuild@'))
    .sort();
  // 多版本並存時取排序最後一顆:本 harness 只用 `build()` 這一支最穩定的 API,版本差異不影響結果。
  // ⚠️ **這是字典序、不是版本序**(R1 nit):`esbuild@0.9.0` 會排在 `esbuild@0.25.0` 後面。
  //    今天 store 裡只有一顆(實查)⇒ 只是潛伏。真的變成多顆時,請照「哪一顆 build 得起來」挑,
  //    不要以為這行拿到的是最新版。
  const picked = dirs[dirs.length - 1];
  if (picked === undefined) {
    throw new Error(`${store} 裡沒有 esbuild@* —— 見本檔 loadEsbuild 的註解`);
  }
  const require_ = createRequire(import.meta.url);
  return require_(join(store, picked, 'node_modules', 'esbuild', 'lib', 'main.js')) as EsbuildLike;
}

const ROOT = findRepoRoot();
const esbuild = loadEsbuild(ROOT);

/**
 * 合成①:把 server action 換成一個把 FormData POST 出去的 client function。
 * 🔴 **必須是 `async`**:React 只在 action 回傳 promise 時才等它 resolve 再 reset ——
 *    同步 action 也會 reset,但等不到 body 落地,測試會 race。
 */
const stubActionsPlugin = {
  name: 'stub-cancel-actions',
  setup(build: { onResolve: Function; onLoad: Function }) {
    build.onResolve({ filter: /cancel-actions$/ }, () => ({
      path: 'stub-cancel-actions',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `export async function cancelOrderAction(formData) {
        await fetch('/submit', { method: 'POST', body: new URLSearchParams(formData) });
      }`,
      loader: 'js',
    }));
    // 🔴 **#363**:`cancel-order-forms.tsx` 現在(間接)import 一個帶 `import 'server-only'`
    //    的模組,而本 harness **把整棵樹打包進瀏覽器** ⇒ 不換掉它,bundle 會載到那顆
    //    非 react-server 條件下就會拋的 shim(症狀:整份 bundle 掛掉 ⇒ 依本檔既有的
    //    「SSR 標記由 bundle 自己產」設計,那不是靜默退化、四格會紅,但錯誤看不出根因)。
    //    ⚠️ 用**獨立的 `empty` namespace**、不是塞進上面那個 `stub` ——
    //    `stub` 的 onLoad 對整個 namespace 一律吐 cancel-actions 的內容,
    //    把 `server-only` 導進去會讓它拿到一份 `cancelOrderAction`(能跑,但字面與事實不符)。
    build.onResolve({ filter: /^server-only$/ }, () => ({
      path: 'server-only',
      namespace: 'empty',
    }));
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
  },
};

/**
 * 把一段「產生 element」的 JSX 打包成瀏覽器 bundle。
 *
 * 🔴 **SSR 標記由 bundle 自己在瀏覽器裡產**(`renderToString(el)` → `innerHTML` → `hydrateRoot(root, el)`):
 *    同一顆 element 餵給兩邊 ⇒ 手寫 SSR HTML 那類漂移**構造不出來**。
 * 🔴 **必須是 `renderToString`,不是 `renderToStaticMarkup`** —— 見檔頭合成③(實測:後者必 mismatch)。
 */
async function bundleFor(elementExpression: string): Promise<string> {
  const entry = `
    import { hydrateRoot } from 'react-dom/client';
    import { renderToString } from 'react-dom/server';
    import { PartialCancelForm } from '${ROOT}/apps/admin/src/components/orders/cancel-order-forms';
    async function submitStub(formData) {
      await fetch('/submit', { method: 'POST', body: new URLSearchParams(formData) });
    }
    /** E-011 的形狀:單一 form + radio、\`full\` 是 defaultChecked。**正向對照專用,不是生產碼**。 */
    function RadioVariantForm() {
      return (
        <form action={submitStub}>
          <input type='radio' name='cancel_mode' value='full' defaultChecked />
          <input type='radio' name='cancel_mode' value='partial' />
          <button type='submit'>送出取消申請</button>
        </form>
      );
    }
    const el = ${elementExpression};
    const root = document.getElementById('root');
    root.innerHTML = renderToString(el);
    hydrateRoot(root, el);
  `;
  const built = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: join(ROOT, 'apps', 'admin', 'src'),
      loader: 'tsx',
      sourcefile: 'hydrate-entry.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [stubActionsPlugin as never],
  });
  return built.outputFiles![0]!.text;
}

const REAL_PARTIAL = `<PartialCancelForm
  returnTo='${RETURN_TO}'
  orderId='${ORDER}'
  items={[{ orderItemId: '${ITEM}', quantity: 5, instockQuantity: 0, cancelledQuantity: 0, maxCancellable: 2 }]}
/>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

type PageRun = (page: Page, bodies: string[]) => Promise<void>;

/**
 * 掛頁 → 跑腳本 → 回傳收到的所有 POST body。
 * `withBundle: false` 給「harness 承重假設」那格用(也是靶 M1 全域套用的那個開關)。
 *
 * 🔴 **`pageerror` 與 `console.error` 一律收、一律斷言為空**(R1 MF1 + R2 nit 4):
 *    hydration 分歧是**瀏覽器端**的訊號,node 這邊什麼都收不到 ⇒ 不收的話,
 *    「React 丟掉 SSR 樹改用 client 重建」會**完全靜默**,而下面三格照樣全綠、卻不是在量 hydration。
 *    收兩種是因為兩類分歧走不同管道(檔頭那張表);**第三類(input value)兩種都收不到**,同表。
 */
async function withHydratedPage(
  bundle: string,
  run: PageRun,
  options: { withBundle?: boolean } = {},
): Promise<string[]> {
  const withBundle = options.withBundle ?? true;
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        bodies.push(raw);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
      return;
    }
    if (req.url === '/entry.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(bundle);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><body><div id="root"></div>${
        withBundle ? '<script src="/entry.js"></script>' : ''
      }</body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text().slice(0, 200)}`);
  });
  try {
    await page.goto(`http://localhost:${port}/`);
    await run(page, bodies);
  } finally {
    await page.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
  // 🔴 放在 finally 之後:先確定資源收乾淨,再讓這條決定紅綠。
  expect(pageErrors).toEqual([]);
  return bodies;
}

/** React 真的接管了這棵 DOM 才算數(fiber 是 React 掛在 DOM node 上的私有 key)。 */
async function hasReactFiber(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('#root form');
    return el === null ? false : Object.keys(el).some((k) => k.startsWith('__reactFiber$'));
  });
}

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#root form');
      return el !== null && Object.keys(el).some((k) => k.startsWith('__reactFiber$'));
    },
    undefined,
    { timeout: 15_000 },
  );
}

async function waitForBodies(bodies: string[], count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (bodies.length < count) {
    if (Date.now() > deadline) throw new Error(`等不到第 ${count} 個 POST(收到 ${bodies.length} 個)`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('片 2 harness 判別力本體:React 19 的 function-action reset 看得見嗎', () => {
  it('🔴🔴 正向對照:E-011 的 radio 形狀 ⇒ 送出後 React reset 把它打回 full,第二次送出就是整單取消', async () => {
    // 🔴 **這一格綠,下面所有格才有意義**:它證明本 harness 觀察得到那條 reset。
    //    它一旦紅(reset 沒發生 / React 沒接管),「真元件兩次都送 partial」就退化成
    //    「靜態 HTML 本來就不會變」= 恆真。
    // ⚠️ 這是**本檔自建的對照組**,不是生產碼 —— 生產碼裡沒有任何叫 `cancel_mode` 的可編輯控制項。
    const bundle = await bundleFor('<RadioVariantForm />');
    const bodies = await withHydratedPage(bundle, async (page, captured) => {
      await waitForHydration(page);
      await page.check('input[name="cancel_mode"][value="partial"]');
      expect(await page.isChecked('input[value="partial"]')).toBe(true);

      await page.click('button[type="submit"]');
      await waitForBodies(captured, 1);

      // 🔴 action resolve 之後 React 才 reset ⇒ 等它把 radio 打回去。
      await page.waitForFunction(() => {
        const full = document.querySelector<HTMLInputElement>('input[value="full"]');
        return full?.checked === true;
      }, undefined, { timeout: 10_000 });
      expect(await page.isChecked('input[value="partial"]')).toBe(false);

      await page.click('button[type="submit"]');
      await waitForBodies(captured, 2);
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe('cancel_mode=partial'); // 員工挑的
    expect(bodies[1]).toBe('cancel_mode=full'); // 🔴 E-011:他什麼都沒改,送出去的卻是整單
  }, 120_000);

  it('⚠️ harness 承重假設:不掛 bundle ⇒ 什麼都不會有(縱深格,見檔頭 M6)', async () => {
    // ⚠️ **這格沒有判別力,是刻意留的縱深** —— 靶 M6 實測:拿掉下面那條 fiber 斷言,
    //    整支測試仍然全綠。真正殺掉「沒有 React」的是靶 M1/M4(其他四格直接紅)。
    //    留著的作用是把「本 harness 的一切都建立在 bundle 有跑」這件事寫在一個測試名字裡。
    // ⚠️ 順帶(R2 nit 9):`withHydratedPage` 尾端那條 `pageErrors` 斷言在本格也是恆真
    //    (沒有 script 就沒有 JS 會出錯)。本格總共三條斷言、三條都沒有判別力 —— 誠實記著。
    const bundle = await bundleFor('<RadioVariantForm />');
    await withHydratedPage(
      bundle,
      async (page) => {
        expect(await hasReactFiber(page)).toBe(false);
        expect(await page.locator('#root form').count()).toBe(0); // 沒 bundle 就沒人畫這棵樹
      },
      { withBundle: false },
    );
  }, 60_000);
});

describe('片 2 真元件:同一條 reset 路徑之下,送出去的永遠是 partial', () => {
  it('🔴🔴 hydrate → 填表送出 → React reset → 直接再按送出:第二次 POST 根本發不出去', async () => {
    // 🔴 **本片存在的理由**:上面那格證明了 reset 真的會發生;這格證明它**打不到我們**。
    //    對照 E-011 四個成因:單一 form + radio(我們沒有:`cancel_mode` 只有一顆且是 hidden)、
    //    送出鈕文字由狀態決定(沒有:server 端寫死)、整單那支殘留品項欄(沒有)、
    //    client/server 兩份分岔(A13b E1 的不變式 (i)(ii)(iii) 關掉)。
    //
    // 🔴 **實測比我預期的更嚴**:我原本寫的斷言是「第二次送出去的是更少的東西」。
    //    真跑之下**第二次根本送不出去** —— reset 把 `reason_code` 清空,而它帶 `required`
    //    ⇒ 原生表單驗證先擋。`cancel-form-body.tsx:50` 那句「reason_code 為空 ⇒ 原生 required 先擋」
    //    在片 1 是**推論**,這裡把它變成**實測**。
    const bundle = await bundleFor(REAL_PARTIAL);
    const bodies = await withHydratedPage(bundle, async (page, captured) => {
      await waitForHydration(page);
      await page.check('input[name="cancel_item"]');
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      await page.fill(`input[name="cancel_item_qty__${ITEM}"]`, '1');

      await page.click('button[type="submit"]');
      await waitForBodies(captured, 1);

      // reset 已經發生的證據:員工勾的 checkbox 被清掉(hidden 欄不受影響 —— 那正是重點)。
      await page.waitForFunction(() => {
        const box = document.querySelector<HTMLInputElement>('input[name="cancel_item"]');
        return box?.checked === false;
      }, undefined, { timeout: 10_000 });

      // 🔴 **擋住第二次送出的是哪一道,直接量出來**(不是從「沒收到 POST」反推 ——
      //    「沒收到」有很多來源,memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
      const gate = await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>('select[name="reason_code"]');
        const form = document.querySelector<HTMLFormElement>('#root form');
        return {
          reasonValue: select?.value ?? null,
          reasonValid: select?.checkValidity() ?? null,
          formValid: form?.checkValidity() ?? null,
        };
      });
      expect(gate).toEqual({ reasonValue: '', reasonValid: false, formValid: false });

      await page.click('button[type="submit"]');
      // ⚠️ **這條「沒發生」的斷言,承重的是上面那組 `formValid:false`,不是這裡的等待長度**
      //    (R1 nit:等待型的 not-happened 斷言,風險方向是假綠)。留 1 秒只是讓觀察落地。
      await page.waitForTimeout(1_000);
      expect(captured).toHaveLength(1);

      // 🔴 **正向對照:表單不是壞掉了,是被擋住了。** 重新填完整 ⇒ 第二次送得出去。
      //    (沒有這段,上面那條 `toHaveLength(1)` 與「hydrate 之後表單整個死掉」分不出來。)
      // 🔴🔴 **刻意「不重打數量」** —— 這正是員工會做的事:他上一次已經改成 1 件了。
      await page.check('input[name="cancel_item"]');
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      await page.click('button[type="submit"]');
      await waitForBodies(captured, 2);
    });

    expect(bodies).toHaveLength(2);
    // 🔴 兩次都是 partial —— hidden 欄被 reset 也只會回到 markup 上的 `partial`,
    //    而 markup 上沒有任何值是 `full`(這正是 E-011 之後改成兩支獨立表單的原因)。
    for (const body of bodies) {
      expect(new URLSearchParams(body).get('cancel_mode')).toBe('partial');
    }
    const first = new URLSearchParams(bodies[0]!);
    const second = new URLSearchParams(bodies[1]!);
    expect(first.get('cancel_item')).toBe(`${ITEM}:2`);
    expect(first.get(`cancel_item_qty__${ITEM}`)).toBe('1');

    // 🔴🔴🔴 **數量回彈:這是本檔唯一量到「方向是變多」的一格**(code-reviewer R1 MF2 抓到,我漏了)。
    //    reset 把數量覆寫欄還原成 `defaultValue`(= `maxCancellable`),而員工只重勾了品項、重選了原因,
    //    **沒有理由再去改一次那個他上次已經改過的數字** ⇒ 第二次送出的是 **2 件**,不是 1 件。
    //    ⚠️ 這**不推翻** `cancel-form-body.tsx` 的不變式 (ii)(它說的是「**React state** 做的三件事
    //    不可能讓取消變多」)—— 幹這件事的是**原生 `defaultValue` 還原**,不是 state。
    //    但「不變式成立」與「員工不會多取消一件」是兩回事,後者今天靠的是別的東西:
    expect(second.get(`cancel_item_qty__${ITEM}`)).toBe('2');
    // 🔴 **今天擋在前面的是同一顆 token**:兩次送出帶的 `request_token` 完全相同
    //    ⇒ 撞 `payload_hash` / 冪等鍵而被 RPC 擋下。這正是 `cancel-form-body.tsx` 記過的
    //    「那道意外的守門會跟著 `#357` 的修法一起消失」——**修 `#357` 的人必須回來重驗這一格**。
    expect(second.get('request_token')).toBe(first.get('request_token'));
    // 🔴 用共用的 `isUuid`,**不自己再寫一條正規式**(R2 nit 5):`cancel-action-state.ts` 的
    //    `generateCancelRequestToken` 段逐字禁止過「同一條正規式養兩份,總有一天會不一樣」。
    //    這條同時是「不是兩顆 null 撞在一起」的正向對照。
    expect(isUuid(first.get('request_token') ?? '')).toBe(true);
    // ⚠️ **可達性**:真站每條出口都 `redirect()`(檔頭合成⑤)⇒ 這個「還留在同一頁按第二次」的
    //    構型在真站上可不可達,本 harness 證不了。上面兩條是**機制與方向**的證據,不是事故重現。
  }, 120_000);

  it('🔴 A13b E1 的三格:第一次在**真瀏覽器 + 真表單送出**之下量', async () => {
    // 🔴 E-061 §6 殘項①:「JS 在場時真正送出去的 body 沒有在真瀏覽器量過」。這格補上。
    // ⚠️ **精確一點**(R1 nit):jsdom 那側本來就跑 React(RTL 會跑 effect),
    //    差別不在「有沒有 React」,而在**真瀏覽器 + 真的表單送出 + 真的 POST body**。
    const bundle = await bundleFor(REAL_PARTIAL);
    const bodies = await withHydratedPage(bundle, async (page, captured) => {
      await waitForHydration(page);
      // ① 零勾選 ⇒ 送出鈕 disabled(SSR 那一側是 enabled,見 cancel-forms-browser.test.tsx)
      //    🔴 用 `waitForFunction` 不用一次性 `isDisabled()`(R1 nit):`enhanced` 是在 passive
      //    effect 才翻,而 `waitForHydration` 等的是 fiber 掛載 —— 兩者之間有一個會 flaky 的窗口。
      await page.waitForFunction(
        () => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled === true,
        undefined,
        { timeout: 10_000 },
      );
      // ② 原因非 other ⇒ 說明欄整個不渲染(SSR 那一側恆在)
      await page.check('input[name="cancel_item"]');
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      expect(await page.locator('textarea[name="reason_detail"]').count()).toBe(0);
      // ③ 改成 other ⇒ 說明欄出現且 required
      await page.selectOption('select[name="reason_code"]', 'other');
      expect(await page.locator('textarea[name="reason_detail"]').count()).toBe(1);
      expect(await page.locator('textarea[name="reason_detail"]').getAttribute('required')).not.toBe(
        null,
      );
      await page.fill('textarea[name="reason_detail"]', '客人反悔');
      await page.click('button[type="submit"]');
      await waitForBodies(captured, 1);
    });

    const params = new URLSearchParams(bodies[0]!);
    expect(params.get('reason_code')).toBe('other');
    expect(params.get('reason_detail')).toBe('客人反悔');
    expect(params.get('cancel_mode')).toBe('partial');
  }, 120_000);

  it('🔴 reset 窗口的兩格(hasItem / reason_detail 停在舊值):**從推論級升成實測級**', async () => {
    // 🔴🔴 `cancel-form-body.tsx` 的不變式 (ii) 認列過這兩格。原註記寫的是
    //    「這兩格是推論級,不是實測級(Fable 假設審查 C1)…要等片 2 才量得到」——
    //    ⚠️ **那句已經被本片改寫掉了**(同一個 commit 的另一半 diff,現在是「✅ 片 2 已量到」),
    //    所以不要照著去那個檔找原句;要看的是它現在的樣子。這一格就是片 2 欠的那筆帳。量到的三件事:
    //      ① `hasItem` 停在 `true` ⇒ DOM 零勾選、送出鈕**仍可按**(state 沒跟著 reset 走)
    //      ② `reasonCode` 停在 `other` ⇒ 說明欄**仍留在 DOM**(body 反而多一欄的那格)
    //      ③ 但兩格都**到不了 POST**:`reason_code` 被 reset 成空 + `required` ⇒ 原生驗證先擋
    //    ⇒ 認列的**判斷**(已知、fail-closed、不宣稱不可能)逐條成立;**字面已隨本片改寫成「已兌現」**。
    // ⚠️ 本檔量的是「同一頁內 reset」這個窗口。`#357` 那個「返回鍵 + stale token」構型
    //    是**另一條路**(檔頭合成⑤:本 harness 不做 PRG),仍未量 —— 不要把這格讀成它也被覆蓋了。
    const bundle = await bundleFor(REAL_PARTIAL);
    await withHydratedPage(bundle, async (page, captured) => {
      await waitForHydration(page);
      await page.check('input[name="cancel_item"]');
      await page.selectOption('select[name="reason_code"]', 'other');
      await page.fill('textarea[name="reason_detail"]', '客人反悔');
      await page.click('button[type="submit"]');
      await waitForBodies(captured, 1);
      await page.waitForFunction(() => {
        const box = document.querySelector<HTMLInputElement>('input[name="cancel_item"]');
        return box?.checked === false;
      }, undefined, { timeout: 10_000 });

      const observed = await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
        const select = document.querySelector<HTMLSelectElement>('select[name="reason_code"]');
        return {
          itemChecked: document.querySelector<HTMLInputElement>('input[name="cancel_item"]')!.checked,
          buttonDisabled: button!.disabled,
          detailStillRendered: document.querySelectorAll('textarea[name="reason_detail"]').length,
          reasonValue: select!.value,
          formValid: document.querySelector<HTMLFormElement>('#root form')!.checkValidity(),
        };
      });
      expect(observed).toEqual({
        itemChecked: false, // DOM 被 reset 清空
        buttonDisabled: false, // ① state 沒跟著清 ⇒ 鈕仍可按
        detailStillRendered: 1, // ② state 還記得 other ⇒ 說明欄還在
        reasonValue: '', // 但 select 本身被清空了
        formValid: false, // ③ ⇒ 原生 required 擋住,兩格都到不了 POST
      });

      // 🔴 **自癒**:容器掛的是 `onChange` 委派(`cancel-form-body.tsx:117`)⇒ 員工下一個動作
      //    就會觸發 `syncFromDom`、state 追回 DOM。窗口只存在到「他再碰一下表單」為止。
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      const healed = await page.evaluate(() => ({
        buttonDisabled: document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
        detailStillRendered: document.querySelectorAll('textarea[name="reason_detail"]').length,
      }));
      expect(healed).toEqual({ buttonDisabled: true, detailStillRendered: 0 });
      // ⚠️ 這裡**刻意不再斷言 `captured.length`**(R1 nit:從上一個 POST 到這裡沒有任何動作
      //    構造得出第二個 POST ⇒ 那條會是恆真)。「第二次送不出去」由上一格負責,那格有 gate 前置斷言。
    });
  }, 120_000);
});
