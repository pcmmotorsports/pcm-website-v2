// @vitest-environment jsdom
//
// SearchOverlay 守門 — 每一格都問「這個檢查在【成立】與【不成立】兩個世界會印不同的東西嗎」。
//
// G1:**監聽器真的存在**。這片的整個病灶就是「入口在、監聽器不在」(Header.tsx:62 逐字)——
//     `openSearch()` 四個月來發事件而沒有人聽,而**點下去不報錯、不跳頁、不開面板**。
//     ⇒ 拿掉 addEventListener ⇒ 本格轉紅。這是唯一擋得住那個病復發的一格。
//
// G2:**「這次查不到」≠「我們沒有這件商品」**。API 掛掉時若照樣畫「沒有找到 X」,
//     一次 DB 抖動就會告訴客人我們沒貨。兩個世界各自斷言,不是只看有沒有紅。
//
// G3:**`price: null` 印「—」不是「NT$ 0」**(catalog-page.ts:80 那條拍板:null 與 0 處置相反)。
//     一行 `?? 0` 會把兩半黏回去,而**畫面上看不出來** ⇒ 只有這格量得到。
//
// G4:**「查看所有結果」導到 `/search?q=`**,不是 `/products` —— A 案的落點就在這一格,
//     導錯了客人會拿到一個沒篩選的列表(那正是主視窗當初裁定要避開的「更具體的謊」)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SearchOverlay, freshItems } from './SearchOverlay';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function openWith(query: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('pcm-open-search', { detail: { query } }));
  });
}

/** 兩個世界共用的假 fetch:okItems 給成功世界、reject/503 給失敗世界。 */
function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

beforeEach(() => {
  push.mockClear();
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ONE_ITEM = {
  items: [{ slug: 'akrapovic-1', brand: 'Akrapovič', name: '鈦合金全段排氣管', price: 88000, image: null }],
  total: 1,
};

describe('SearchOverlay', () => {
  it('G1 一開始不在畫面上;收到 pcm-open-search 才出現(= 監聽器真的掛上了)', () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    render(<SearchOverlay />);
    // 世界 A:沒發事件 ⇒ 疊層不存在
    expect(screen.queryByRole('dialog', { name: '搜尋' })).toBeNull();
    // 世界 B:發了事件 ⇒ 疊層出現。兩個世界印不同的東西。
    openWith('');
    expect(screen.getByRole('dialog', { name: '搜尋' })).toBeTruthy();
  });

  it('G1-b 事件帶的 query 會當種子填進輸入框', () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    expect((screen.getByLabelText('搜尋商品 / 品牌 / 車款') as HTMLInputElement).value).toBe('排氣管');
  });

  it('G2 API 失敗 ⇒ 畫「暫時無法使用」,而**不是**「沒有找到」', async () => {
    mockFetch(async () => new Response('{}', { status: 503 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await waitFor(() => expect(screen.getByText(/搜尋暫時無法使用/)).toBeTruthy());
    // 🔴 這一行是本格的重點:失敗世界【不准】出現空結果的字樣。
    expect(screen.queryByText(/沒有找到/)).toBeNull();
  });

  it('G2-b 成功但零筆 ⇒ 畫「沒有找到」,而**不是**「暫時無法使用」', async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('不存在的東西zzz');
    await waitFor(() => expect(screen.getByText(/沒有找到/)).toBeTruthy());
    expect(screen.queryByText(/暫時無法使用/)).toBeNull();
  });

  it('G3 price=null 印「—」;price=0 印「NT$ 0」(兩者處置相反、不可共用 ?? 0)', async () => {
    mockFetch(async () => new Response(JSON.stringify({
      items: [
        { slug: 'a', brand: 'B', name: '查不到價格的', price: null, image: null },
        { slug: 'b', brand: 'B', name: '零元贈品', price: 0, image: null },
      ],
      total: 2,
    }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('x');
    await waitFor(() => expect(screen.getByText('—')).toBeTruthy());
    expect(screen.getByText('NT$ 0')).toBeTruthy();
  });

  it('G4 「查看所有結果」導到 /search?q=,不是 /products', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    const all = await screen.findByText(/查看「排氣管」的所有結果/);
    fireEvent.click(all);
    expect(push).toHaveBeenCalledWith('/search?q=%E6%8E%92%E6%B0%A3%E7%AE%A1');
    // 🔵 負向斷言:任何一發都不准指向 /products —— 導錯了畫面上完全正常。
    expect(push.mock.calls.every(([url]) => !String(url).startsWith('/products?'))).toBe(true);
  });

  it('G5 Esc 關閉疊層(稿 :20 的行為)', async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('');
    expect(screen.getByRole('dialog', { name: '搜尋' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜尋' })).toBeNull());
  });

  // ── codex 2026-09-02 must-fix 1 / 4 的守門 ─────────────────────────────
  //
  // G6/G7:**舊結果不准套在新查詢上**。這是「兩顆分開的 state 表達不了同一次量測」那個病:
  //   effect 在 render 之後才跑 ⇒ 改字之後的第一次 render,畫面是新的查詢字 + 舊的商品列。
  // G8/G9:`aria-modal="true"` **不會**阻止 Tab 走到背景;關閉也不會把焦點還給觸發者。

  it('G6 🔴 把查詢字改掉 ⇒ 舊結果立刻消失,不會掛在新的查詢字底下', async () => {
    // 第一個查詢正常回;第二個查詢**永遠不回**(模擬「新結果還在路上」的那一瞬間)
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify(ONE_ITEM), { status: 200 });
      return new Promise<Response>(() => {});
    });
    render(<SearchOverlay />);
    openWith('排氣管');
    await screen.findByText('鈦合金全段排氣管');

    fireEvent.change(screen.getByLabelText('搜尋商品 / 品牌 / 車款'), { target: { value: '碳纖維' } });

    // 🔴 這一行是本格的重點:新結果還沒到,而舊商品**不准**還在畫面上。
    await waitFor(() => expect(screen.queryByText('鈦合金全段排氣管')).toBeNull());
    // 🔵 而底下那顆鈕也不准寫成「查看『碳纖維』的所有結果」配著排氣管的列表
    expect(screen.queryByText(/查看「碳纖維」的所有結果/)).toBeNull();
  });

  it('G7 🔴 把查詢字清空 ⇒ 回到熱門搜尋,舊結果不會與它同時出現', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await screen.findByText('鈦合金全段排氣管');

    fireEvent.change(screen.getByLabelText('搜尋商品 / 品牌 / 車款'), { target: { value: '' } });

    await waitFor(() => expect(screen.getByText('熱門搜尋')).toBeTruthy());
    expect(screen.queryByText('鈦合金全段排氣管'), '熱門搜尋與上一次的結果同時出現').toBeNull();
  });

  it('G8 🔴 關閉之後焦點還給打開它的那顆鈕', async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    const opener = document.createElement('button');
    opener.textContent = '搜尋';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    render(<SearchOverlay />);
    openWith('');
    // 🔴 **必須先等疊層真的把焦點搶走** —— 少了這一步,`activeElement` 從頭到尾都是 opener,
    //    而「有還原」與「沒還原」會印同一個東西(2026-09-02 突變實測:拿掉還原,本格照樣綠)。
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('搜尋商品 / 品牌 / 車款')));
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement, '焦點掉回 body ⇒ 鍵盤使用者失去位置').toBe(opener));
    opener.remove();
  });

  it('G9 🔴 Tab 被關在疊層裡(焦點在外面時會被拉回來)', async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    const outside = document.createElement('button');
    outside.textContent = '背景的鈕';
    document.body.appendChild(outside);

    render(<SearchOverlay />);
    openWith('');
    const panel = screen.getByRole('dialog', { name: '搜尋' }).querySelector('.search-overlay-panel')!;

    // 模擬「焦點已經溜到背景」⇒ 下一次 Tab 必須把它拉回疊層內
    outside.focus();
    expect(panel.contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(panel.contains(document.activeElement), 'Tab 之後焦點仍在疊層外 ⇒ trap 沒生效').toBe(true);
    outside.remove();
  });

  // ── G10:直接測 `freshItems`,因為 DOM 那一端摸不到它守的狀態 ──────────
  //
  // 🔴 這一組是 2026-09-02 突變實測逼出來的:G6/G7 從 DOM 斷言,
  //    而拿掉 `result.q === q` 之後**它們照樣全綠** —— 因為改字時 effect 也會把 status 設成
  //    `'loading'`,而 RTL 看到的永遠是 effect 跑完之後的 DOM。
  //    真正出事的那一格是 **render 與 effect 之間**那一次(客人在真瀏覽器看得到那一閃)。
  // 📌 一個殺不掉突變的守門,與寫對的碼印同一個綠。
  describe('freshItems(status, result, q)', () => {
    const A = [{ slug: 'a', brand: 'B', name: '排氣管', price: 1, image: null }];

    it('G10 🔴 結果屬於別的查詢 ⇒ null(這一格就是 must-fix 1)', () => {
      expect(freshItems('ok', { q: '排氣管', items: A }, '碳纖維')).toBeNull();
    });

    it('G10-b 🔵 正對照:屬於同一個查詢 ⇒ 原樣回傳(否則上一格用「永遠回 null」也會過)', () => {
      expect(freshItems('ok', { q: '排氣管', items: A }, '排氣管')).toBe(A);
    });

    it('G10-c status 不是 ok(loading / failed / idle)⇒ 一律 null', () => {
      for (const st of ['idle', 'loading', 'failed'] as const) {
        expect(freshItems(st, { q: '排氣管', items: A }, '排氣管'), st).toBeNull();
      }
    });

    it('G10-d 沒有結果 ⇒ null', () => {
      expect(freshItems('ok', null, '排氣管')).toBeNull();
    });
  });
});
