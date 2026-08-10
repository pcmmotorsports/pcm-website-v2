import { describe, expect, it } from 'vitest';
import { appendResultQuery, parseOrderReturnTo } from './order-return-to';

// order-return-to.test.ts — #350d 契約 §3 的守門。
//
// 🔴 這支的壞法全都**沒有執行期訊號**:放行一條壞網址 ⇒ 員工被導去別的地方或看到 500;
//    誤殺一條好網址 ⇒ 篩選被靜默洗掉。兩種都不會丟錯,只會安靜地做錯事。

const ORDER = '11111111-2222-4333-8444-555555555555';
const FALLBACK = `/orders/${ORDER}`;

describe('parseOrderReturnTo — 放行(合法的站內視圖網址)', () => {
  it.each([
    ['/orders', '/orders'],
    [FALLBACK, FALLBACK],
    ['/orders?payment_status=paid&page=3', '/orders?payment_status=paid&page=3'],
    [`/orders?payment_status=paid&panel=${ORDER}`, `/orders?payment_status=paid&panel=${ORDER}`],
  ])('%s 原樣放行', (raw, expected) => {
    expect(parseOrderReturnTo(raw, ORDER)).toBe(expected);
  });

  it('🔴 重複鍵的多勾選軸逐個保留(用 set 重建會只剩最後一個)', () => {
    expect(parseOrderReturnTo('/orders?order_source=web&order_source=manual_line', ORDER)).toBe(
      '/orders?order_source=web&order_source=manual_line',
    );
  });

  it('🔴 percent-encoded 的中文參數值放行(decode 後的字元集**不驗**)', () => {
    // 真正送進 Location header 的是**還沒 decode** 的那個字串 ⇒ latin-1 那條對 raw 成立就夠了。
    // 突變:把字元集那道也套到 decoded ⇒ 這條紅(而症狀是員工的篩選被靜默洗掉)。
    const href = '/orders?order_no=%E4%B8%AD%E6%96%87';
    expect(parseOrderReturnTo(href, ORDER)).toBe(href);
  });
});

describe('parseOrderReturnTo — 剝掉一次性參數(契約 §2 硬條件 1 的第二道)', () => {
  it('🔴 `r` / `rt` / `correct` 一律剝掉,其餘逐字保留', () => {
    // 不剝的話 action 會再接一顆 ⇒ `?rt=舊&rt=新` 重複鍵 ⇒ D3 classifier fail-closed
    // ⇒ 面板永遠只說「查不到取消紀錄」;`r` 重複則是 `typeof === 'string'` 為假 ⇒ 零橫幅。
    expect(
      parseOrderReturnTo(
        `/orders?payment_status=paid&r=order_cancelled&rt=${ORDER}&correct=x&panel=${ORDER}`,
        ORDER,
      ),
    ).toBe(`/orders?payment_status=paid&panel=${ORDER}`);
  });

  it('剝完沒有剩下任何參數 → 乾淨的路徑(不留孤零零的問號)', () => {
    expect(parseOrderReturnTo('/orders?r=saved', ORDER)).toBe('/orders');
  });
});

describe('parseOrderReturnTo — `return_to` 不得決定「哪一張單」(契約 §6-1)', () => {
  const OTHER = '99999999-8888-4777-8666-555555555555';

  it('🔴 `panel` 指向別張單 → fallback(不是照著導過去)', () => {
    // 不擋的話:對 A 單按儲存,畫面卻在 **B 單的面板**上說「已儲存變更」。
    // 突變:把 `panels[0] !== orderId` 那道拿掉 ⇒ 這條紅。
    expect(parseOrderReturnTo(`/orders?panel=${OTHER}`, ORDER)).toBe(FALLBACK);
  });

  it('🔴 `panel` 重複鍵 → fallback(不去猜哪一顆算數)', () => {
    expect(parseOrderReturnTo(`/orders?panel=${ORDER}&panel=${ORDER}`, ORDER)).toBe(FALLBACK);
  });

  it('`panel` 就是這張單 → 放行(正向對照:證明上面兩條不是恆真)', () => {
    expect(parseOrderReturnTo(`/orders?panel=${ORDER}`, ORDER)).toBe(`/orders?panel=${ORDER}`);
  });

  it('🔴 一次性參數先剝、再比對 panel(`?panel=<本單>&r=saved` 要放行)', () => {
    expect(parseOrderReturnTo(`/orders?panel=${ORDER}&r=saved`, ORDER)).toBe(
      `/orders?panel=${ORDER}`,
    );
  });
});

describe('parseOrderReturnTo — fail-closed 一律退回 /orders/{orderId}', () => {
  it.each([
    ['非字串(缺欄位)', null],
    ['非字串(多檔上傳型)', 42],
    ['空字串', ''],
    ['站外絕對網址', 'https://evil.example/steal'],
    ['protocol-relative', '//evil.example/steal'],
    ['埋在 query 裡的 scheme', '/orders?next=https://evil.example'],
    ['站內 gadget(..)', '/orders/../../api/sso/start'],
    ['編碼過的 gadget(%2e%2e)', '/orders/%2e%2e/%2e%2e/api/sso/start'],
    ['前綴假冒(/ordersevil)', '/ordersevil'],
    ['別的後台路徑', '/customers'],
    ['相對路徑', 'orders?x=1'],
    ['換行(header injection 形狀)', '/orders?x=1\nLocation: https://evil.example'],
    ['tab', '/orders?x=\t1'],
    ['NUL(不屬於 \\s、靠 hasControlChars 那道擋)', `/orders?x=${String.fromCharCode(0)}`],
    ['DEL(同上)', `/orders?x=${String.fromCharCode(0x7f)}`],
    ['非 latin-1 原文', '/orders?order_no=中文'],
    ['壞的 percent-encoding', '/orders?x=%zz'],
  ])('%s → fallback', (_label, raw) => {
    expect(parseOrderReturnTo(raw, ORDER)).toBe(FALLBACK);
  });

  it('🔴 超過 512 字 → fallback(邊界:512 放行、513 退回)', () => {
    // 突變:把上限拿掉或改成 `>=` ⇒ 其中一條紅。兩條一起寫才量得到「邊界在哪」,
    // 只寫「很長的退回」的話上限設成 5000 也會綠。
    const pad = (total: number) => `/orders?x=${'a'.repeat(total - '/orders?x='.length)}`;
    expect(pad(512)).toHaveLength(512);
    expect(parseOrderReturnTo(pad(512), ORDER)).toBe(pad(512));
    expect(parseOrderReturnTo(pad(513), ORDER)).toBe(FALLBACK);
  });

  it('🔴 長度上限量的是**吐出去的那個字串**,不是只量 raw', () => {
    // `URLSearchParams.toString()` 會重新編碼(`~` → `%7E`,一個字元變三個)⇒ 只量 raw 的話
    // 一條 210 字的合法輸入可以吐出 600+ 字的 Location,而「上限 512」那個宣稱就大於事實。
    // 突變:把出口那道長度檢查拿掉 ⇒ 這條紅。
    const raw = `/orders?x=${'~'.repeat(200)}`;
    expect(raw.length).toBeLessThan(512);
    expect(parseOrderReturnTo(raw, ORDER)).toBe(FALLBACK);
  });

  it('🔴 fallback 用的是傳進來的 orderId(不是寫死的 /orders)', () => {
    // 非法 return_to 不該把正在看這張單的員工踢回列表(契約 §3)。
    const other = '99999999-8888-4777-8666-555555555555';
    expect(parseOrderReturnTo('https://evil.example', other)).toBe(`/orders/${other}`);
  });
});

describe('appendResultQuery', () => {
  it('沒有 query 用 `?`;已有 query 用 `&`(面板網址本來就帶 query)', () => {
    // 突變:寫死 `?` ⇒ 第二條紅,而症狀是面板網址上整串篩選被蓋掉。
    expect(appendResultQuery('/orders/x', 'r=saved')).toBe('/orders/x?r=saved');
    expect(appendResultQuery('/orders?panel=x', 'r=saved')).toBe('/orders?panel=x&r=saved');
  });
});
