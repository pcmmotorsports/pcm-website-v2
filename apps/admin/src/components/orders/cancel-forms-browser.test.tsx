// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 🔴 **#363**:本檔 `renderToStaticMarkup(真元件)`,而真元件現在(間接)載入帶
//    `import 'server-only'` 的產生器模組 ⇒ 不 mock 的話本檔 7 格全紅,錯誤逐字是
//    `server-only/index.js:1 This module cannot be imported from a Client Component module`
//    (實測長相、不是推測)。逐檔 mock = 本 repo 既有處置,刻意不開全域 setupFiles。
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';

// cancel-forms-browser.test.tsx — M-4b E10 **A13b D6-a**:兩支取消表單的**真瀏覽器**負測。
//
// 🔴🔴 **為什麼非真瀏覽器不可**(plan §2-3 逐字、codex 原話):約束 3(失敗後不得默默退回整單)
//    的證據只能是「**實際送出去的 body**」。jsdom 不跑表單送出、不跑返回鍵的表單狀態復原 ⇒ 不算數。
//
// 🔴 **harness 形狀**:`renderToStaticMarkup(真元件)` → node http server → playwright 驅動 → 攔 body。
//    全程在**一個測試程序**內、無 fixture 檔 ⇒ 不會有「HTML 過期」那種假綠。
//    ⚠️ **不起真 Next admin、不接 DB**(`E-031-A` 把那類排到 #350 線下);代價逐條寫在下面。
//
// 🔴🔴 **被合成的東西有三樣,逐條列出**(主視窗 `E-050` 裁 A 的條件之一,誠實邊界;
//    ⚠️ 我第一版只寫了一樣 —— R1 must-fix 更正):
//    ① `method="post"`(下面 `withPostMethod`;理由見該函式與本段)。
//    ② **server action 被換成一個字串 URL**(`vi.mock` 掉 `cancel-actions`)⇒ 真 Next 會替
//      server action 額外產一顆 `$ACTION_ID` hidden 欄位,**本 harness 的 body 沒有它**
//      ⇒ 真站的 body 形狀比這裡多一欄。本檔斷言的是「我們自己那幾欄的值」,不是 body 全等。
//    ③ 「判別力邊界」那組另外注入了一份 radio 版 markup(該格自陳)。
//    ④ **送出後的回應是本 harness 自己回的一頁普通 200**,不是正式 action 的
//      `redirect(303)` + PRG(R2 codex 補)⇒ **返回鍵走到的 history 條目與正式站不同**。
//      本檔因此只主張「送出去的欄位集合」,**不主張**「返回鍵在正式站的行為與這裡一致」。
// 🔴 ①的細節:
//    靜態渲染出來的 `<form>` **沒有 method** ⇒ 瀏覽器預設 **GET**(真 Next 才會替 server action
//    產生 POST 接線)。本檔在送出去的 HTML 上補這一個屬性,**其餘 markup 原封不動**。
//    為什麼要補而不是就地測 GET:本測試要守的不變式是「**返回之後送出去的欄位集合仍是 partial**」,
//    而 GET 與 POST 在**返回鍵那一面行為不同**(POST 結果頁返回會有重送確認)⇒ 用 POST 才對得上正式站。
//    ⚠️ 有一條自檢釘住這件事:**拿掉那個合成 method,測試必須紅**(見「harness 自檢」那組)——
//    免得日後有人刪了它、測試靜默退化成 GET 情境還是綠的。
//
// 🔴🔴 **這個 harness 重現得了什麼、重現不了什麼(實測,不是推論)**:
//    ✅ 重現得了:瀏覽器的**表單狀態復原**(`goBack()` 之後欄位值還在)、hidden input 保留 markup 值。
//    ❌ 重現不了:**React 19 在 action 完成後的 form reset** —— 那正是 `E-011-STOP` 那個
//      「radio 被勾回 `full`」事故的直接成因,它需要 React 在 client 端接管表單才會發生,
//      而本 harness 是靜態 HTML、沒有 React runtime。
//    ⇒ **因此本檔不得宣稱「已證明併回單一 radio 會出事」**。它證明的是更窄但確定的一件事:
//      **我們的 markup 裡沒有任何控制項的值能變成 `full`,而且返回後送出的仍是 partial。**
//      逐條實測見「判別力邊界」那組。

const ORDER = '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c';
const ITEM = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
/**
 * #350d-2:面板視圖的 `return_to`。
 * 🔴 `panel` **必須等於本單**(契約 §6-1)—— 隨手填 `panel=x` 的話正式站上會被 parser 退回明細頁,
 *    那等於這支瀏覽器測試量的是一個真站不會出現的形狀。
 */
const RETURN_TO = `/orders?payment_status=paid&panel=${ORDER}`;

vi.mock('../../lib/orders/cancel-actions', () => ({ cancelOrderAction: '/submit' }));

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

/** 把一份 HTML 掛上 server、開瀏覽器跑一段腳本、回傳所有收到的 POST body。 */
async function withPage(
  bodyHtml: string,
  run: (page: import('playwright').Page) => Promise<void>,
): Promise<string[]> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        bodies.push(raw);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1 id="done">captured</h1></body></html>');
      });
      return;
    }
    // 🔴 GET 也要收:若合成 method 被拿掉,表單會走 GET ⇒ 這裡回一頁沒有 #done 的內容,
    //    讓等待 `#done` 的步驟逾時 ⇒ 測試紅。這就是「拿掉合成 method 必紅」的機制。
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><body>${bodyHtml}</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const page = await browser.newPage();
  try {
    await page.goto(`http://localhost:${port}/`);
    await run(page);
  } finally {
    await page.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
  return bodies;
}

/**
 * 補 `method="post"`(檔頭列的合成①)。抽成函式,好讓自檢那組能明確地「不套用它」。
 * ⚠️ 這**不是唯一**的合成 —— 另兩樣見檔頭(action 被換成字串 URL、radio 版 markup)。
 */
function withPostMethod(html: string): string {
  return html.replace('<form ', '<form method="post" ');
}

/**
 * A13b E1 之後 `maxCancellable: 2` 的品項會多渲染一個數量覆寫欄。
 * 🔴 **本檔量的是「JS 不在場」那一側** —— `renderToStaticMarkup` 沒有 React runtime
 *    (檔頭 `:35-42`),所以這裡看到的行為就是員工把 JS 關掉 / 還沒 hydrate 時的行為。
 *    E1 的三格全部退化成原行為,而**挑數量仍然可用**(覆寫欄是原生控制項、沒有任何值由 JS 組)。
 */
async function renderPartial(): Promise<string> {
  const { PartialCancelForm } = await import('./cancel-order-forms');
  return renderToStaticMarkup(
    <PartialCancelForm returnTo={RETURN_TO}
      orderId={ORDER}
      items={[
        {
          orderItemId: ITEM,
          quantity: 5,
          instockQuantity: 0,
          cancelledQuantity: 0,
          maxCancellable: 2,
        },
      ]}
    />,
  );
}

async function fillAndSubmit(page: import('playwright').Page) {
  await page.check('input[name="cancel_item"]');
  await page.selectOption('select[name="reason_code"]', 'out_of_stock');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#done', { timeout: 10_000 });
}

describe('D6-a 真瀏覽器負測:失敗後返回再送,送出去的仍是部分取消', () => {
  it('🔴 填表 → 送出 → goBack() → 直接再按送出:兩次 POST body 都是 partial', async () => {
    const html = withPostMethod(await renderPartial());
    const bodies = await withPage(html, async (page) => {
      await fillAndSubmit(page);
      // 🔴 plan §2-3 的字面情境:返回之後**不重填**,直接按送出。
      await page.goBack();
      await page.waitForLoadState('load');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#done', { timeout: 10_000 });
    });

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toContain('cancel_mode=partial');
      // 🔴 這一條就是約束 3:**任何情況下都不得送出整單取消**。
      expect(body).not.toContain('cancel_mode=full');
      expect(body).toContain(`cancel_item=${encodeURIComponent(`${ITEM}:2`)}`);
      // 🔴 #350d-2:`return_to` 也要真的出現在**送出去的 body** 裡(codex 關卡2 nit):
      //    只補必填 prop 而不斷言 body,等於沒量到接線 —— 而漏掉它的症狀是
      //    每次取消都靜默走 fallback、把面板關掉。
      expect(body).toContain(`return_to=${encodeURIComponent(RETURN_TO)}`);
    }
  }, 60_000);

  it('🔴 返回之後 hidden 欄位保留 markup 值 ⇒ 兩次帶的是同一顆 request_token', async () => {
    // 🔴🔴 **這條把 D4 的「認列」升級成實測事實**:D4 當時只是引用 plan 探針的字面
    //    「hidden input 維持 markup 值」,現在是對**我們自己的元件**量到的。
    //    後果照 `cancel-action-state.ts` 檔頭:改了原因或勾選再送 ⇒ 同 token 配不同 payload
    //    ⇒ 撞 `payload_hash` ⇒ `rejected` ⇒ 員工看到「這張單目前不能取消」,而且「再改改看」永遠過不了。
    //    ⇒ 這是**已知未解**、交由後續片處置,不是本片宣稱修好的東西。
    const html = withPostMethod(await renderPartial());
    const bodies = await withPage(html, async (page) => {
      await fillAndSubmit(page);
      await page.goBack();
      await page.waitForLoadState('load');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#done', { timeout: 10_000 });
    });

    const tokens = bodies.map((b) => new URLSearchParams(b).get('request_token'));
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toBeTruthy();
    expect(tokens[0]).toBe(tokens[1]);
  }, 60_000);
});

describe('D6-a harness 自檢:合成的 method 被拿掉就要紅', () => {
  it('🔴 不套 withPostMethod ⇒ 表單走 GET ⇒ 收不到任何 POST', async () => {
    // 🔴 主視窗 `E-050` 裁 A 的條件:**防止日後有人刪掉那個合成、讓測試靜默退化成 GET 情境還是綠的**。
    //    這條直接證明「有沒有套 method」是可觀察的差異,不是無關緊要的細節。
    const html = await renderPartial();
    const bodies = await withPage(html, async (page) => {
      await page.check('input[name="cancel_item"]');
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      await page.click('button[type="submit"]');
      await page.waitForLoadState('load');
    });
    expect(bodies).toHaveLength(0);
  }, 60_000);
});

describe('D6-a 判別力邊界:這個 harness 抓得到什麼', () => {
  it('🔴 markup 裡的 cancel_mode 若被改成 full,本測試會紅(證明斷言不是恆真)', async () => {
    // 🔴 **沒有這條,上面那兩條就只是「跑得完」而不是「守得住」**。
    //    這裡刻意把真元件的 markup 改壞(把 hidden 的 partial 換成 full),
    //    證明「`not.toContain('cancel_mode=full')`」真的會在壞掉時翻紅。
    const broken = withPostMethod(
      (await renderPartial()).replace('value="partial"', 'value="full"'),
    );
    const bodies = await withPage(broken, async (page) => {
      await fillAndSubmit(page);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('cancel_mode=full');
  }, 60_000);

  it('⚠️ 併回單一 radio 形狀:本 harness **抓不到**(誠實記載,不是通過)', async () => {
    // 🔴🔴 **這條測試存在的目的是把「抓不到」釘成事實,不是把它藏起來。**
    //    plan §2-3 期望的突變是「把兩支 form 併回單一 radio ⇒ 測試必須轉紅」。
    //    實測結果:**radio 版在本 harness 下照樣送出 partial** ——
    //    因為瀏覽器的表單狀態復原會把使用者選的 partial 還原回來,
    //    而 `E-011-STOP` 那個事故的成因是 **React 19 在 action 完成後的 form reset**
    //    (把 radio 打回 `defaultChecked` 的 full),那需要 React 在 client 端接管表單才會發生,
    //    本 harness 是靜態 HTML、**沒有 React runtime** ⇒ 重現不了。
    //    ⇒ **不得宣稱「已證明併回 radio 會出事」**。真要守那一面,得起真 Next admin
    //      (`E-031-A` 已排到 #350 線下)。本檔守的是更窄但確定的一面:
    //      **我們的 markup 裡沒有任何控制項的值能變成 full。**
    const radioVariant = withPostMethod(
      (await renderPartial()).replace(
        /<input type="hidden" name="cancel_mode" value="partial"\/?>/,
        '<input type="radio" name="cancel_mode" value="full" checked/>' +
          '<input type="radio" name="cancel_mode" value="partial"/>',
      ),
    );
    const bodies = await withPage(radioVariant, async (page) => {
      await page.check('input[name="cancel_mode"][value="partial"]');
      await fillAndSubmit(page);
      await page.goBack();
      await page.waitForLoadState('load');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#done', { timeout: 10_000 });
    });
    // 兩次都是 partial ⇒ 這個 harness 對「radio 形狀」沒有判別力。實測結果照實釘住。
    expect(bodies).toHaveLength(2);
    expect(bodies.every((b) => b.includes('cancel_mode=partial'))).toBe(true);
  }, 60_000);
});

describe('A13b E1 真瀏覽器(JS 不在場側):數量覆寫欄照樣送得出去', () => {
  it('🔴 改成 1 件送出 ⇒ body 帶 cancel_item=<id>:2 與 cancel_item_qty__<id>=1', async () => {
    // 🔴 checkbox 的值仍是 `:2`(可取消上限)、覆寫欄才是員工挑的數字 ——
    //    兩個都要在 body 裡,解析器才有東西可以比上界(`cancel-form.ts` 的 `applyQuantityOverride`)。
    const html = withPostMethod(await renderPartial());
    const bodies = await withPage(html, async (page) => {
      await page.check('input[name="cancel_item"]');
      await page.fill(`input[name="cancel_item_qty__${ITEM}"]`, '1');
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#done', { timeout: 10_000 });
    });

    expect(bodies).toHaveLength(1);
    const params = new URLSearchParams(bodies[0]!);
    expect(params.get('cancel_item')).toBe(`${ITEM}:2`);
    expect(params.get(`cancel_item_qty__${ITEM}`)).toBe('1');
    expect(params.get('cancel_mode')).toBe('partial');
  }, 60_000);

  it('🔴 零 JS 之下說明欄仍在、送出鈕仍按得下去(E1 的兩格確實退化成原行為)', async () => {
    // 🔴 關卡1 R2 #6:驗收寫了「零 JS 恆渲染」卻沒有對應斷言 ⇒ 若哪天 SSR 初始就藏起來,
    //    只看 jsdom 那側是看不出來的(jsdom 一定 hydrate)。這條在**真瀏覽器**上量。
    const html = withPostMethod(await renderPartial());
    const bodies = await withPage(html, async (page) => {
      expect(await page.locator('textarea[name="reason_detail"]').count()).toBe(1);
      expect(await page.locator('button[type="submit"]').isDisabled()).toBe(false);
      await page.check('input[name="cancel_item"]');
      await page.selectOption('select[name="reason_code"]', 'out_of_stock');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#done', { timeout: 10_000 });
    });
    // 沒填說明 ⇒ 非 other 的正常路徑,`reason_detail` 是空字串而不是缺欄(零 JS 側的實況)。
    expect(new URLSearchParams(bodies[0]!).get('reason_detail')).toBe('');
  }, 60_000);
});
