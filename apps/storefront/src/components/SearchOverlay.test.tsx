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
// G4:**「查看所有結果」導到 `/products?search=`** —— ⟦搜尋-落點換 /products⟧ 2026-09-03。
//     ⛔ ~~原本這一格釘的是 `/search?q=`,不是 `/products`~~
//     🔴 **2026-09-03 Sean 本人推翻了那個落點**,而它其實是**對回稿**:
//        `design-reference/components/SearchOverlay.jsx:67` 逐字
//        `onNav('products', { search: query.trim() })`,而稿裡**沒有 `/search` 這個頁**。
//        Sean 逐字:「我以為搜尋會直接在我們商品目錄顯示誒」⇒ 他以為的就是稿說的。
//     🟢 而舊拍板的**判準**沒有被推翻(逐字「一個看得見的缺,永遠優於一個安靜的錯」)——
//        新落點靠 `SearchKeywordChip` 把「facet 沒生效」畫出來,判準換了一種活法。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SearchOverlay, viewFor } from './SearchOverlay';

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

  // 🔴🔴 **G1-c:等結果的那段時間畫「搜尋中…」**(2026-09-03 線 `-front`)。
  //   在本片之前 render 端**沒有 `pending` 分支** ⇒ 中文查詢那 ~2 秒疊層是空的
  //   (線上實測五格取樣全部只有「取消」兩個字;而中文 1934ms vs ASCII 455ms)。
  //   🎯 **兩個世界印不同的東西**:請求還沒回 ⇒ 有「搜尋中…」;回來了 ⇒ 沒有「搜尋中…」而有結果。
  //   🧬 **突變**:把 `SearchOverlay.tsx` 的 `view.kind === 'pending'` 那一格拿掉 ⇒ 本格必須紅。
  it('G1-c 有查詢字而結果還沒到 ⇒ 畫「搜尋中…」;回來之後那句消失、結果出現', async () => {
    // 一個「我來決定它什麼時候回」的 fetch ⇒ 才拿得到中間那個狀態。
    // 🔴 deferred 要建在 **mockFetch 之外** —— 建在 executor 裡的話,
    //    `release` 只有在 fetch【真的被呼叫】之後才存在;而下面第一個 waitFor
    //    在 debounce 還沒發出請求時就會過(`result === null` 也是 pending)
    //    ⇒ 那時 `release` 還是 undefined ⇒ TypeError。**這一格我自己踩過一次。**
    let release!: (r: Response) => void;
    const deferred = new Promise<Response>((res) => { release = res; });
    // 🔴 `.clone()`(R1 F7):`() => deferred` 每次回**同一個 Response 實例** ⇒ 將來若真有第二發請求,
    //    `res.json()` 會 body-already-read ⇒ 走 catch ⇒ **靜靜變 `failed`,而本格照樣綠**。
    mockFetch(() => deferred.then((r) => r.clone()));
    render(<SearchOverlay />);
    openWith('貼');

    // 世界 A:還在等 ⇒ 那句在,而結果與「沒有找到」都不在
    await waitFor(() => expect(screen.getByText('搜尋中…')).toBeTruthy());
    expect(screen.queryByText(/沒有找到/)).toBeNull();
    expect(screen.queryByText(/暫時無法使用/)).toBeNull();

    // 世界 B:回來了 ⇒ 那句消失、**而且結果真的出現**
    // 🔴 「結果出現」那半是 R1 F6 補的:原本只斷言「那句消失」⇒
    //    一個「回來之後什麼都不畫」的世界也會過。
    release(new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    await waitFor(() => expect(screen.queryByText('搜尋中…')).toBeNull());
    expect(screen.getByText('鈦合金全段排氣管')).toBeTruthy();
  });

  // 🔴🔴 **G1-d:空查詢【不准】出現「搜尋中…」**(2026-09-03 R1 F1 —— 而那是我自己弄出來的)。
  //   `q === ''` 時 effect 早退並 `setResult(null)` ⇒ `viewFor` 恆回 `pending`,
  //   **而那時根本沒有請求在飛** ⇒ 我第一版只判 `view.kind === 'pending'`
  //   ⇒ 「熱門搜尋」與「搜尋中…」**同時**畫,而且是**穩態不是一幀**。
  //   🎯 而本檔 `codex R2 must-fix 1` 修過的正是同一個病(訊息與熱門搜尋同框)——
  //      **我把它用另一支 kind 復刻了一次。**
  //   🧬 突變:把 `SearchOverlay.tsx` 那格的 `q !== '' &&` 拿掉 ⇒ 本格必須紅。
  it('G1-d 空查詢 ⇒ 畫「熱門搜尋」而【不】畫「搜尋中…」(兩者不同框)', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('');
    // 🟢 正對照:熱門搜尋在(否則下一行對「整片空白」也會過)
    expect(screen.getByText('熱門搜尋')).toBeTruthy();
    expect(screen.queryByText('搜尋中…')).toBeNull();
  });

  it('G1-e 查完之後把輸入框清空 ⇒ 回到熱門搜尋, 不是「搜尋中…」', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await waitFor(() => expect(screen.getByText('鈦合金全段排氣管')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('搜尋商品 / 品牌 / 車款'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('熱門搜尋')).toBeTruthy());
    expect(screen.queryByText('搜尋中…')).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔴🔴 **G1-f/G1-g:把守門綁在【不變式】上,而不是綁在【某一支 kind】上**
  //   (2026-09-03,主視窗-87 指定;起因是我自己弄出來的 R1 F1)
  //
  //   **為什麼要換一種綁法**:F1 那次,本檔既有 23 格**全綠而零守門** ——
  //   因為那些格子問的是「`failed` 畫對了嗎」「`ok` 畫對了嗎」,
  //   ⇒ 🎯 **它們綁在【已知的那幾支 kind】上;而我加的是【第三支】** ⇒ 結構上碰不到。
  //   📌 **⇒ 一個綁在列舉上的守門,對【列舉多一項】永遠是瞎的。**
  //   ⇒ 所以下面兩格:一格釘住**列舉本身**(多一支 kind 就紅),一格掃**每一個世界**。
  // ═══════════════════════════════════════════════════════════════════════════

  it('🔴 G1-f 元件裡 render 的 kind 集合必須就是這三支 —— 多一支就紅,而那時請把它加進 G1-g', () => {
    // 🎯 這一格【不是】在測行為,是在測「G1-g 的分母有沒有過期」。
    //    照 `showcase-dispatch-coverage.test.ts` 的先例:掃原始碼字面、不執行元件。
    // 🔴 這裡不用 `import.meta.url` —— 本 project 的 `import.meta.url` **不是 file: scheme**
    //    (實測 `fileURLToPath` 丟 `TypeError: The URL must be of scheme file`)。
    //    改用 vitest 的 root(= repo 根)拼相對路徑,而下面那個 `size > 0` 自檢會抓到讀錯檔。
    const src = readFileSync(
      resolve(process.cwd(), 'apps/storefront/src/components/SearchOverlay.tsx'),
      'utf-8',
    );
    const kinds = new Set(
      [...src.matchAll(/view\.kind === '(\w+)'/g)].map((m) => m[1]!),
    );
    // 🟢 自檢:抽取邏輯要先證明它抓得到東西,否則下面那個 toEqual 對空集合也會過
    expect(kinds.size, '抽取結果是空的 ⇒ 正規式與檔案對不上,本格會恆真').toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(['failed', 'ok', 'pending']);
  });

  it('🔴 G1-g 不變式:任何一個世界裡,「熱門搜尋」與狀態訊息都不得同框', async () => {
    // 🛑 這是 F1 真正違反的那條 —— 而它與「pending 有沒有畫」是兩件事。
    const bothShowing = () =>
      screen.queryByText('熱門搜尋') !== null &&
      (screen.queryByText('搜尋中…') !== null ||
        screen.queryByText(/暫時無法使用/) !== null ||
        screen.queryByText(/沒有找到/) !== null);

    // 世界①:空查詢 ⇒ 只有熱門搜尋
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('');
    expect(screen.getByText('熱門搜尋')).toBeTruthy(); // 🟢 正對照:這個世界真的畫了 chips
    expect(bothShowing()).toBe(false);
    cleanup();

    // 世界②:有字而還沒回 ⇒ 只有「搜尋中…」
    let release!: (r: Response) => void;
    const deferred = new Promise<Response>((res) => { release = res; });
    mockFetch(() => deferred.then((r) => r.clone()));
    render(<SearchOverlay />);
    openWith('貼');
    await waitFor(() => expect(screen.getByText('搜尋中…')).toBeTruthy());
    expect(bothShowing()).toBe(false);
    release(new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    cleanup();

    // 世界③:失敗 ⇒ 只有「暫時無法使用」
    mockFetch(async () => new Response('{}', { status: 503 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await waitFor(() => expect(screen.getByText(/暫時無法使用/)).toBeTruthy());
    expect(bothShowing()).toBe(false);
    cleanup();

    // 世界④:成功零筆 ⇒ 只有「沒有找到」
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('不存在的東西zzz');
    await waitFor(() => expect(screen.getByText(/沒有找到/)).toBeTruthy());
    expect(bothShowing()).toBe(false);
  });

  // ═══ ⟦搜尋-第2刀⟧ 品牌 / 分類兩區(2026-09-03;車款那一區刻意不畫, 見 SearchOverlayFacets 檔頭)═══

  const withFacets = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      ...ONE_ITEM,
      brands: [{ id: 'akrapovic', name: 'AKRAPOVIČ', count: 648 }],
      categories: [{ id: 'cat-1', name: '排氣系統', count: 740 }],
      vehicles: [{ brandId: 'honda', brandName: 'Honda', modelId: 'cbr600', modelName: 'CBR600' }],
      failed: { brands: false, categories: false, vehicles: false },
      ...over,
    });

  it('🔴 G3-a 有品牌/分類 ⇒ 兩區都畫, 標題字面照稿(只有商品那一區帶數字)', async () => {
    mockFetch(async () => new Response(withFacets(), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣');
    await waitFor(() => expect(screen.getByText('AKRAPOVIČ')).toBeTruthy());
    expect(screen.getByText('品牌')).toBeTruthy();   // 稿 :149 —— 不帶數字
    expect(screen.getByText('分類')).toBeTruthy();   // 稿 :163 —— 不帶數字
    expect(screen.getByText('排氣系統')).toBeTruthy();
  });

  it('🔴🔴 G3-b 車款【刻意不畫】—— 它守的是【一條拍板】(Sean 2026-09-04 重出版甲: 全部不改)', async () => {
    // 🎯 這一格釘的不是「還沒做」, 是一個【決定】:
    //    打 R6 會比中 Honda CBR600(`cbr600` 含 `r6`)⇒ 畫出來客人會以為網站壞了。
    //    🛑 而它與「空區不畫」在畫面上長得一樣 ⇒ 只有這一格與那段註解分得出來。
    //    ✅ 題 21 若拍乙(改比對規則)⇒ 這一格要改成「車款區要出現」, 不要直接刪掉它。
    mockFetch(async () => new Response(withFacets(), { status: 200 }));
    render(<SearchOverlay />);
    openWith('R6');
    await waitFor(() => expect(screen.getByText('AKRAPOVIČ')).toBeTruthy()); // 先確認資料真的到了
    expect(screen.queryByText('車款')).toBeNull();
    expect(screen.queryByText(/CBR600/)).toBeNull();
  });

  it('🔵 G3-c 空區不畫(稿 :147/:161 逐字 length > 0 &&)', async () => {
    mockFetch(async () => new Response(withFacets({ brands: [], categories: [] }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣');
    await waitFor(() => expect(screen.getByText('鈦合金全段排氣管')).toBeTruthy());
    expect(screen.queryByText('品牌')).toBeNull();
    expect(screen.queryByText('分類')).toBeNull();
  });

  it('🔴 G3-d failed=true 與「沒有符合的」要畫成兩種東西', async () => {
    // 🛑 少了這一格, 一次讀取失敗會告訴客人「沒有這個品牌」——
    //    而資料層早就把兩者分開了(`search-facets.ts:35-39` 三旗標各自一格)。
    // 🔴 **fixture 刻意讓 `brands` 【非空】而 `failed.brands` 為 true。**
    //    第一版我寫 `brands: []` ⇒ 而那讓兩個世界印同一個東西:
    //    拿掉 `!facets.failed.brands` 那道判斷之後,`brands.length > 0` 照樣是 false
    //    ⇒ **突變全綠,而我以為這一格守住了。**(2026-09-03 實跑那一發突變才發現。)
    //    ⇒ 🎯 非空 + failed ⇒ 少了那道判斷就會【同時】畫「讀不到」與品牌標籤 ⇒ 抓得到。
    mockFetch(async () =>
      new Response(withFacets({ failed: { brands: true, categories: false, vehicles: false } }), { status: 200 }),
    );
    render(<SearchOverlay />);
    openWith('排氣');
    await waitFor(() => expect(screen.getByText('鈦合金全段排氣管')).toBeTruthy());
    // 世界:品牌讀不到 ⇒ 那一區要出現且說「讀不到」,而**不得同時畫出品牌標籤**
    expect(screen.getByText('品牌')).toBeTruthy();
    expect(screen.getByText('這一區暫時讀不到')).toBeTruthy();
    expect(screen.queryByText('AKRAPOVIČ')).toBeNull(); // 🔴 這一行才是殺得掉突變的那一行
    expect(screen.getByText('排氣系統')).toBeTruthy();  // 🟢 正對照:分類沒壞 ⇒ 照舊畫
  });

  it('🔴🔴 G3-e 商品 0 筆而分類有命中 ⇒ 畫分類, 【不准】說「沒有找到」(R1 must-fix 1)', async () => {
    // 🎯 稿的外閘是**四區聯集**(`SearchOverlay.jsx:60` total = products+brands+categories+vehicles),
    //    而我第一版寫成只看商品 ⇒ 這個世界會對客人說「沒有找到」。
    // 🔴 **這不是假想的**:production 打「服務與其他」⇒ items 0 / categories 1(2026-09-03 實測)。
    // 🧬 突變:把外閘改回 `view.items.length > 0` ⇒ 本格必須紅。
    mockFetch(async () =>
      new Response(withFacets({ items: [], brands: [] }), { status: 200 }),
    );
    render(<SearchOverlay />);
    openWith('服務與其他');
    await waitFor(() => expect(screen.getByText('排氣系統')).toBeTruthy());
    expect(screen.queryByText(/沒有找到/)).toBeNull();
  });

  it('🔴 G3-f 商品 0 筆而品牌【讀不到】⇒ 說「讀不到」, 不准說「沒有找到」(R1 must-fix 2)', async () => {
    // 🛑 plan §5 逐字:不畫 = 告訴客人「沒有這個品牌」。而「沒有找到」比不畫更糟 —— 它是一句斷言。
    mockFetch(async () =>
      new Response(withFacets({ items: [], brands: [], categories: [], failed: { brands: true, categories: false, vehicles: false } }), { status: 200 }),
    );
    render(<SearchOverlay />);
    openWith('排氣');
    await waitFor(() => expect(screen.getByText('這一區暫時讀不到')).toBeTruthy());
    expect(screen.queryByText(/沒有找到/)).toBeNull();
  });

  it('🔴 G3-g 分類讀不到時【不得】同時畫出分類標籤(R1 must-fix 5:那道判斷原本零守門)', async () => {
    // 🎯 這一格與 G3-d 是鏡像 —— G3-d 守品牌那半, 而分類那半當時【沒有任何測試殺得掉】:
    //    每個 fixture 的 `failed.categories` 都是 false ⇒ 拿掉 `!facets.failed.categories` 全綠。
    // 🧬 突變:拿掉 `SearchOverlayFacets.tsx` 的 `!facets.failed.categories &&` ⇒ 本格必須紅。
    mockFetch(async () =>
      new Response(withFacets({ failed: { brands: false, categories: true, vehicles: false } }), { status: 200 }),
    );
    render(<SearchOverlay />);
    openWith('排氣');
    await waitFor(() => expect(screen.getByText('AKRAPOVIČ')).toBeTruthy()); // 🟢 正對照:品牌沒壞 ⇒ 照舊畫
    expect(screen.getByText('這一區暫時讀不到')).toBeTruthy();
    expect(screen.queryByText('排氣系統')).toBeNull(); // 🔴 殺得掉突變的那一行
  });

  it('🔴 G3-h 點分類 ⇒ 導頁用【名稱】不是 id(授權偏離, R1 must-fix 6)', async () => {
    // 🛑 稿 `:167` 用 `c.id`,而我們的 `?category=` 吃名稱(`lib/brand-products.test.ts:20-22`)。
    //    沒有這一格,下一個人「照稿修回 c.id」時零訊號 —— 而導錯的下場是靜默的。
    mockFetch(async () => new Response(withFacets(), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣');
    await waitFor(() => expect(screen.getByText('排氣系統')).toBeTruthy());
    fireEvent.click(screen.getByText('排氣系統'));
    expect(push).toHaveBeenCalledWith(`/products?category=${encodeURIComponent('排氣系統')}`);
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

  it('G4 「查看所有結果」導到 /products?search=(2026-09-03 落點對回稿)', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    const all = await screen.findByText(/查看「排氣管」的所有結果/);
    fireEvent.click(all);
    expect(push).toHaveBeenCalledWith('/products?search=%E6%8E%92%E6%B0%A3%E7%AE%A1');
    // 🔴🔴 **負向斷言【換邊了】,而它仍然要在** —— 現在不准掉回舊落點。
    //    ⚠️ 少了這一行,一個「兩邊都 push」的實作照樣全綠,而客人會看到兩次導覽。
    expect(
      push.mock.calls.every(([url]) => !String(url).startsWith('/search?')),
      '掉回舊落點 /search ⇒ 客人拿到一個沒有左側分類與排序的頁',
    ).toBe(true);
    // 🔵 而參數名是 `search` 不是 `q` —— 稿用的是 `{ search: … }`,
    //    而 `/products` 那頁認的也是 `search`(`lib/catalog-query.ts`)。打錯名字 ⇒ 靜靜給全站。
    expect(String(push.mock.calls[0]?.[0])).toContain('?search=');
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
  describe('viewFor(result, q) — DOM 摸不到的那個狀態組合', () => {
    const A = [{ slug: 'a', brand: 'B', name: '排氣管', price: 1, image: null }];

    it('G10 🔴 結果屬於【別的】查詢 ⇒ pending(R1 must-fix 1)', () => {
      expect(viewFor({ q: '排氣管', items: A }, '碳纖維')).toEqual({ kind: 'pending' });
    });

    it('G10-b 🔵 正對照:屬於同一個查詢 ⇒ ok + 原樣的 items(否則「永遠回 pending」也會過)', () => {
      expect(viewFor({ q: '排氣管', items: A }, '排氣管')).toEqual({ kind: 'ok', items: A });
    });

    it('G11 🔴 **失敗**也綁查詢:別的查詢失敗過 ⇒ pending,不是 failed(R2 must-fix 1)', () => {
      // 這一格就是 R1 只修一半的那一半:失敗那條路原本脫離了查詢字。
      expect(viewFor({ q: '排氣管', items: null }, '碳纖維')).toEqual({ kind: 'pending' });
    });

    it('G11-b 🔵 正對照:同一個查詢失敗 ⇒ failed(否則上一格用「永遠 pending」也會過)', () => {
      expect(viewFor({ q: '排氣管', items: null }, '排氣管')).toEqual({ kind: 'failed' });
    });

    it('G10-d 還沒有任何結果 ⇒ pending', () => {
      expect(viewFor(null, '排氣管')).toEqual({ kind: 'pending' });
    });

    it('G11-c 🔴 空字串查詢時,舊的失敗不准跟著 —— 清空輸入框必須回到熱門搜尋', () => {
      expect(viewFor({ q: '排氣管', items: null }, '')).toEqual({ kind: 'pending' });
      expect(viewFor({ q: '排氣管', items: A }, '')).toEqual({ kind: 'pending' });
    });
  });

  // ── G9 的補強:R2 must-fix 4 —— 原本的 G9 是【假綠】 ───────────────────
  //
  // 🔴 舊的 G9 只測「焦點原本在疊層外面 ⇒ 被拉回來」,而那條分支與**首尾循環**是
  //    兩段不同的碼 ⇒ 把 first/last 那兩段刪掉,G9 照樣全綠。
  //    ⇒ 這是同一片裡的**第三格假綠**(前兩格是 result.q===q 與焦點還原)。
  // 📌 一道守門守住的是它【走過的那一條分支】,不是那個功能。

  it('G9-b 🔴 焦點在最後一個可聚焦元素時按 Tab ⇒ 回到第一個(不准離開疊層)', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await screen.findByText('鈦合金全段排氣管');
    const panel = screen.getByRole('dialog', { name: '搜尋' }).querySelector('.search-overlay-panel')!;
    const f = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(f.length, '疊層裡至少要有頭尾兩個不同的可聚焦元素,否則本格零判別力').toBeGreaterThan(1);
    f[f.length - 1]!.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement, '從最後一個往後 Tab 應該回到第一個').toBe(f[0]);
  });

  it('G9-c 🔴 焦點在第一個時按 Shift+Tab ⇒ 跳到最後一個', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await screen.findByText('鈦合金全段排氣管');
    const panel = screen.getByRole('dialog', { name: '搜尋' }).querySelector('.search-overlay-panel')!;
    const f = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    f[0]!.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement, '從第一個往前 Tab 應該跳到最後一個').toBe(f[f.length - 1]);
  });

  it('G9-d 🔵 負對照:焦點在【中間】時 Tab 不被攔截(否則上兩格用「永遠攔」也會過)', async () => {
    mockFetch(async () => new Response(JSON.stringify(ONE_ITEM), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await screen.findByText('鈦合金全段排氣管');
    const panel = screen.getByRole('dialog', { name: '搜尋' }).querySelector('.search-overlay-panel')!;
    const f = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(f.length).toBeGreaterThan(2);
    const middle = f[1]!;
    middle.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    // 沒被 preventDefault ⇒ 瀏覽器自己會移動焦點;jsdom 不移動 ⇒ 焦點仍在原處。
    // 這一格證的是「我們沒有插手」,不是「焦點跑到哪」。
    expect(document.activeElement, '中間的 Tab 被我們攔了 ⇒ trap 太寬').toBe(middle);
  });

  // ── G12:鎖背景捲動不准去搶別人的 inline style(R2 must-fix 3)────────────
  it('G12 🔴 疊層的鎖【不碰】別的 modal 的 body inline style', async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    // 世界:另一支 modal 先開著(本 repo 有 5 支元件在寫這個 inline style)
    document.body.style.overflow = 'hidden';

    render(<SearchOverlay />);
    openWith('');
    expect(document.body.hasAttribute('data-pcm-search-lock'), '疊層沒有上鎖').toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.body.hasAttribute('data-pcm-search-lock')).toBe(false));
    // 🔴 這一行是本格的重點:疊層關掉之後,**別人的鎖必須原封不動**。
    //    舊寫法(存值/寫回 '')在這裡會把它變成 '' ⇒ 頁面提早解鎖而另一個 modal 還開著。
    expect(document.body.style.overflow, '疊層關閉時把別人的 body 鎖一起解掉了').toBe('hidden');
    document.body.style.overflow = '';
  });

  it('G12-b 🔵 正對照:沒有別人時,疊層自己的鎖確實會加上又拿掉', async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    expect(document.body.hasAttribute('data-pcm-search-lock')).toBe(false);
    render(<SearchOverlay />);
    openWith('');
    expect(document.body.hasAttribute('data-pcm-search-lock')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.body.hasAttribute('data-pcm-search-lock')).toBe(false));
    // 🔵 而它從頭到尾沒有碰 inline style
    expect(document.body.style.overflow).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 🔴🔴 「你是不是要找 X?」(`⟦search-BRANDTYPOTRGM⟧` · Sean 2026-09-04 拍甲)
//   原話三個限定詞都要守:**只在 0 筆時** · **客人自己點** · **不自動改字**。
// ══════════════════════════════════════════════════════════════════════
describe('SearchOverlay 的品牌候選', () => {
  const EMPTY_WITH_SUGGESTION = {
    items: [], total: 0, brands: [], categories: [], vehicles: [],
    failed: { brands: false, categories: false, vehicles: false },
    suggestion: { name: 'AKRAPOVIČ', slug: 'akrapovic' },
  };

  it('🔴 零結果 + 有候選 ⇒ 畫那一行, 而且是【可以點的】', async () => {
    mockFetch(async () => new Response(JSON.stringify(EMPTY_WITH_SUGGESTION), { status: 200 }));
    render(<SearchOverlay />);
    openWith('akrpovic');
    await waitFor(() => expect(screen.getByText(/你是不是要找/)).toBeTruthy());
    const btn = screen.getByRole('button', { name: 'AKRAPOVIČ' });
    expect(btn).toBeTruthy();
  });

  it('🔴 零結果而【沒有】候選 ⇒ 那一行不能出現(空的建議比亂猜好)', async () => {
    mockFetch(async () => new Response(
      JSON.stringify({ ...EMPTY_WITH_SUGGESTION, suggestion: null }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('zzzzzqqqqq');
    await waitFor(() => expect(screen.getByText(/沒有找到/)).toBeTruthy());
    expect(screen.queryByText(/你是不是要找/)).toBeNull();
  });

  it('🔴🔴 **有結果的時候不准出現** —— 而 route 那邊照樣會送 suggestion', async () => {
    // 🛑 這一格是承重的:判準只有一份(這個元件的 `hasAnyResult`), 而 route 永遠送。
    //    ⇒ 若有人把那一行搬出零結果那個 block, 這一格會紅。
    mockFetch(async () => new Response(JSON.stringify({
      ...ONE_ITEM,
      suggestion: { name: 'AKRAPOVIČ', slug: 'akrapovic' },
    }), { status: 200 }));
    render(<SearchOverlay />);
    openWith('排氣管');
    await waitFor(() => expect(screen.getByText('鈦合金全段排氣管')).toBeTruthy());
    expect(screen.queryByText(/你是不是要找/)).toBeNull();
  });

  it('🔴 點下去 ⇒ 導到那個品牌', async () => {
    mockFetch(async () => new Response(JSON.stringify(EMPTY_WITH_SUGGESTION), { status: 200 }));
    render(<SearchOverlay />);
    openWith('akrpovic');
    const btn = await waitFor(() => screen.getByRole('button', { name: 'AKRAPOVIČ' }));
    (btn as HTMLButtonElement).click();
    await waitFor(() => expect(push).toHaveBeenCalled());
    const href = push.mock.calls.at(-1)?.[0] as string;
    expect(href).toContain('pbrand=akrapovic');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 **「不自動改字」那一格 —— 而它【不能】寫在點下去之後**
  //   (code-reviewer R1 抓到:我原本的標題寫「輸入框的字不變」而斷言從頭到尾沒讀過 input;
  //    存活突變 = 在 onClick 加一行 `setQuery(建議的名字)` ⇒ 四格全綠。)
  //   🛑 而**點下去之後結構上量不到** —— `onClick` 會 `close()`, 疊層 unmount, input 不存在了。
  //   ✅ 所以改成量【它還在畫面上的時候】的兩件事:
  //      ① 輸入框仍然是客人打的那個字(建議出現**不會**改寫它)
  //      ② 沒有第二發請求(建議出現**不會**偷偷重送一次查詢)
  //
  // 🛑🛑 **而這一格【證不到】「點下去之後也不改字」—— 實測過, 不是推的**:
  //    突變「在 `onClick` 加一行 `setQuery(建議的名字)`」⇒ **本檔 40 格全綠**。
  //    🔬 成因:`onClick` 先 `close()` ⇒ 疊層 unmount ⇒ input 不存在、component state 也重置
  //       ⇒ **那個世界在這一層結構上量不到。**
  //    ⇒ 📌 **所以不要把本格讀成「③不自動改字 有測試守著」** —— 它守的是【出現時】那一半。
  //       點下去那一半今天**沒有東西在守**, 而那要一發真的瀏覽器(或把 close 拆出來注入)才量得到。
  // ══════════════════════════════════════════════════════════════════════
  it('🔴 建議出現時:輸入框的字不變, 而且沒有偷偷重送查詢(不自動改字)', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response(JSON.stringify(EMPTY_WITH_SUGGESTION), { status: 200 });
    });
    render(<SearchOverlay />);
    openWith('akrpovic');
    await waitFor(() => expect(screen.getByText(/你是不是要找/)).toBeTruthy());
    // 🔵 用 placeholder 找 —— 那個 input 有 `type="search"` ⇒ role 是 `searchbox` 不是 `textbox`,
    //    而我第一版寫 `getByRole('textbox')` **當場紅**(這一格是測試自己抓到的)。
    const input = screen.getByPlaceholderText('搜尋商品 / 品牌 / 車款...') as HTMLInputElement;
    expect(input.value).toBe('akrpovic');
    // 🔵 一次查詢 = 一發請求。變成 2 就代表有人「順手」把建議送出去了。
    expect(calls).toBe(1);
  });
});
