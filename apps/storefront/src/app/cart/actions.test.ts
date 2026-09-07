// actions.test.ts — resolveCartLines server action unit test(M-3-S2-b2-d)
//
// 驗:① 變體 line → unitPrice = 該變體 general 價 + variantLabel = spec 值合併
//     ② 無變體 line → unitPrice = product.price(群 general)
//     ③ 商品不存在 / 變體 stale → found:false
//     ④ 🔴 經銷零洩漏:回傳僅 unitPrice、無 priceByTier/price_store/store/cost
//     ⑤ input fail-closed:非陣列 → []、非法 entry 略過、超量截斷 200
// node env(server 邏輯);mock '@/lib/products'(避免載 server-only / @pcm/adapters)fetchProductByHandle。

import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, idsMock, tierMock, pricesMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  // ⟦auth-DEALERTIERPRICING⟧ M-2-08 B2a:三支新相依。
  // 🔴 **預設值刻意選在「這一段不會跑」那一側** —— tier 回 general ⇒ 既有 5 項一個字都不用改,
  //    而那正是本片「general 走原路、零改動」的形狀。要驗經銷那條的案例自己覆寫。
  idsMock: vi.fn(async () => new Map<string, string>()),
  // 🔴 codex R1 must-fix ① 折疊後:呼叫端改叫 `resolveAuthenticatedTierStrict()`,
  //    回的是 `{ok, tier}` —— `ok:false` 代表【查不出來】, 與「他就是 general」是兩件事。
  tierMock: vi.fn(async () => ({ ok: true, tier: 'general' }) as const),
  pricesMock: vi.fn(async () => new Map<string, number>()),
}));
vi.mock('@/lib/products', () => ({
  fetchProductByHandle: fetchMock,
  fetchProductIdsByHandles: idsMock,
}));
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTierStrict: tierMock }));
vi.mock('@/lib/tier-prices', () => ({
  fetchEffectivePrices: pricesMock,
  priceKey: (kind: string, id: string) => `${kind}:${id}`,
}));

import { resolveCartLines, type ResolvedCartLine } from './actions';

type FakeProduct = {
  id: number;
  slug: string;
  brand: string;
  name: string;
  fits: string;
  price: number;
  image: string | null;
  variants: { id: string; sku: string; spec: Record<string, string>; price: number; images: string[] }[];
  /** V-2e:白名單投影測試用(容多餘欄、驗剝除) */
  fitments?: { motoBrand: string; modelCode: string; yearStart?: number; yearEnd?: number | null; [k: string]: unknown }[];
};

function makeProduct(over: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id: 1,
    slug: 'rpm-1',
    brand: 'RPM',
    name: '碳纖維車台護蓋',
    fits: 'Aprilia RSV4',
    price: 14600,
    image: 'https://cdn.example/img.jpg',
    variants: [
      { id: 'v1', sku: 'DCC01-G-F', spec: { weave: 'Forged', finish: 'Glossy' }, price: 15200, images: [] },
      { id: 'v2', sku: 'DCC01-P', spec: { weave: 'Plain' }, price: 14600, images: [] },
    ],
    ...over,
  };
}

/** 取第一行並收斂型別(strict:陣列索引為 T|undefined);無則 throw。 */
function first(lines: ResolvedCartLine[]): ResolvedCartLine {
  const line = lines[0];
  if (!line) throw new Error('expected at least one resolved line');
  return line;
}

afterEach(() => {
  fetchMock.mockReset();
  // 🔴 **只 reset `fetchMock` 是不夠的**:另外三支的【呼叫紀錄】會跨格累積
  //   ⇒ 「這一格不得叫 RPC」在後面的格子裡**恆假**(它看到的是前面某一格叫過的那一次)。
  //   ✅ `mockClear` 只清紀錄、保留 hoisted 時設的預設實作(`mockReset` 會把實作也清掉)。
  idsMock.mockClear();
  tierMock.mockClear();
  pricesMock.mockClear();
});

describe('resolveCartLines(M-3-S2-b2-d 購物車 line 解析)', () => {
  it('變體 line → unitPrice = 該變體 general 價 + variantLabel = spec 值合併', async () => {
    fetchMock.mockResolvedValue(makeProduct());
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }]));
    expect(line.found).toBe(true);
    expect(line.unitPrice).toBe(15200);
    expect(line.variantLabel).toBe('Forged · Glossy');
    expect(line.sku).toBe('DCC01-G-F'); // V-2a2:料號獨立欄恆顯
    expect(line.brand).toBe('RPM');
    expect(line.name).toBe('碳纖維車台護蓋');
    expect(line.fits).toBe('Aprilia RSV4');
    expect(line.slug).toBe('rpm-1');
    expect(line.image).toBe('https://cdn.example/img.jpg');
  });

  it('無變體 line → unitPrice = product.price(群 general)、variantLabel = null、sku = null', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [] }));
    const line = first(await resolveCartLines([{ productId: 'rpm-1' }]));
    expect(line.found).toBe(true);
    expect(line.unitPrice).toBe(14600);
    expect(line.variantLabel).toBeNull();
    expect(line.sku).toBeNull(); // 無變體商品無料號欄
  });

  it('V-2a2:spec 全空 → variantLabel null(不再 fallback)、sku 獨立恆顯料號', async () => {
    fetchMock.mockResolvedValue(
      makeProduct({ variants: [{ id: 'v1', sku: 'DCC01-X', spec: {}, price: 9000, images: [] }] }),
    );
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }]));
    expect(line.variantLabel).toBeNull();
    expect(line.sku).toBe('DCC01-X');
  });

  it('商品不存在 → found:false', async () => {
    fetchMock.mockResolvedValue(null);
    const line = first(await resolveCartLines([{ productId: 'gone' }]));
    expect(line.found).toBe(false);
    expect(line.productId).toBe('gone');
  });

  it('變體 stale(id 不存在)→ found:false', async () => {
    fetchMock.mockResolvedValue(makeProduct());
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'ghost' }]));
    expect(line.found).toBe(false);
    expect(line.variantId).toBe('ghost');
  });

  it('🔴 經銷零洩漏:回傳僅 unitPrice、無 priceByTier/price_store/store/cost 欄', async () => {
    fetchMock.mockResolvedValue(makeProduct());
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }]));
    const keys = Object.keys(line);
    for (const banned of [
      'priceByTier',
      'price_by_tier',
      'price_store',
      'priceStore',
      'store',
      'premiumStore',
      'cost',
    ]) {
      expect(keys).not.toContain(banned);
    }
    expect(JSON.stringify(line)).not.toMatch(/price_store|price_by_tier|priceByTier/);
  });

  it('🔴 poisoned fixture:上游若夾帶經銷欄/值 → 逐欄白名單輸出仍零複製(codex k2 #7)', async () => {
    // 故意污染 product + variant 帶經銷結構 + sentinel 金額;驗 resolveCartLines 逐欄白名單
    // 不 spread、輸出絕不含經銷欄名 / 經銷金額(防「未來上游洩」靜默穿透)。
    // 注:poisoned 故意帶 FakeProduct 型別外欄 → 用 untyped const 避 excess-property check(fetchMock 收 any)。
    const poisoned = {
      ...makeProduct({ variants: [] }),
      // poisoned:商品層經銷結構 + sentinel
      priceByTier: { general: { amount: 14600 }, store: { amount: 9999 }, premiumStore: { amount: 8888 } },
      price_store: 9999,
      cost: 5000,
      variants: [
        {
          id: 'v1',
          sku: 'DCC01-G-F',
          spec: { weave: 'Forged', finish: 'Glossy' },
          price: 15200,
          images: [] as string[],
          // poisoned:變體層經銷結構 + sentinel
          priceByTier: { general: { amount: 15200 }, store: { amount: 7777 }, premiumStore: { amount: 6666 } },
          price_store: 7777,
          cost: 4000,
        },
      ],
    };
    fetchMock.mockResolvedValue(poisoned);
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }]));
    expect(line.unitPrice).toBe(15200); // 仍取 general
    const json = JSON.stringify(line);
    // 經銷欄名零洩
    expect(json).not.toMatch(/price_store|price_by_tier|priceByTier|premiumStore|cost/);
    expect(json).not.toContain('"store"');
    // 經銷 sentinel 金額零洩
    for (const sentinel of ['7777', '6666', '9999', '8888', '4000', '5000']) {
      expect(json).not.toContain(sentinel);
    }
    expect(Object.keys(line)).not.toContain('priceByTier');
  });

  it('input fail-closed:非陣列 → []、非法 entry 略過、超量截斷 200', async () => {
    expect(await resolveCartLines(null)).toEqual([]);
    expect(await resolveCartLines('x')).toEqual([]);
    expect(await resolveCartLines(undefined)).toEqual([]);

    fetchMock.mockResolvedValue(makeProduct({ variants: [] }));
    const mixed = await resolveCartLines([
      { productId: 'rpm-1' },
      { productId: '   ' }, // trim 後空 → 略過
      { productId: '' }, // 空 productId 略過
      { foo: 1 }, // 無 productId 略過
      null, // 非物件略過
      { productId: 'x'.repeat(300) }, // 超長 productId → 略過
      { productId: 'rpm-1', variantId: 'v'.repeat(100) }, // 超長 variantId → 整行略過
    ]);
    expect(mixed.length).toBe(1);

    const many = Array.from({ length: 250 }, () => ({ productId: 'rpm-1' }));
    const res = await resolveCartLines(many);
    expect(res.length).toBe(200);
  });

  it('🔴 非-string variantId(竄改:number/object/null)→ 整行 fail-closed 跳、不退化成群價(審查側 finding)', async () => {
    // 有變體商品(群價 product.price=14600);三行 variantId 皆竄改成非-string。
    fetchMock.mockResolvedValue(makeProduct());
    // 🔴 **好料與壞料【同一批】餵進去**(2026-08-29:線G 先寫成兩次獨立呼叫,線F 用突變打穿、線G 複驗)。
    //    三行竄改 + 一行合法,而合法那行**放在最後** —— 前面的壞料不得把它一起毒掉。
    const res = await resolveCartLines([
      { productId: 'rpm-1', variantId: 123 }, // number
      { productId: 'rpm-1', variantId: { id: 'v1' } }, // object
      { productId: 'rpm-1', variantId: null }, // null
      { productId: 'rpm-1', variantId: 'v1' }, // ✅ 合法:它必須活著回來
    ]);
    // 三行竄改被跳掉、合法那行留下 ⇒ 恰好 1 行。
    // (若退化成群價會回 4 行 unitPrice=14600〔群內最低〕= 錯價洩漏。)
    expect(res.length, '不是 1 ⇒ 要嘛壞料沒被擋、要嘛好料被一起毒掉').toBe(1);
    expect(first(res)).toMatchObject({ found: true, unitPrice: 15200 });
    // 🔴 **為什麼不是「三行竄改 ⇒ 0」加一次獨立的合法呼叫**(那是本行的上一版,已被打穿):
    //    分開餵時,「一顆壞的毒死整鍋」在第一批印 0(看起來對)、在第二批根本不觸發
    //    ⇒ **兩邊都綠**。實測靶 `apps/storefront/src/app/cart/actions.ts:112`
    //    的 `continue` 改成 `return []` ⇒ 分開餵那版 13/13 全過,混合批這版必紅。
    //    📌 **把好料與壞料分開餵,量不到「一顆壞的會不會毀掉整鍋」。**
  });

  it('🔴 round3:有變體商品 + line 無有效 variantId(省略/空/空白)→ found:false(不退化群價)', async () => {
    fetchMock.mockResolvedValue(makeProduct()); // 有 v1/v2 變體、群價 product.price=14600
    // ① 省略 variantId
    expect(first(await resolveCartLines([{ productId: 'rpm-1' }])).found).toBe(false);
    // ② 空字串 / 空白 variantId
    expect(first(await resolveCartLines([{ productId: 'rpm-1', variantId: '' }])).found).toBe(false);
    expect(first(await resolveCartLines([{ productId: 'rpm-1', variantId: '   ' }])).found).toBe(false);
    // 不退化群價:unitPrice=0(非群內最低 14600)
    expect(first(await resolveCartLines([{ productId: 'rpm-1' }])).unitPrice).toBe(0);
  });

  // 🔴🔴 **`0` 是【合法價格】,不是「沒有價格」**(Sean 2026-08-25 拍板 —— 逐字紀錄在
  //    `components/account/tabs/FavoritesTab.test.tsx` 錨 `0 是合法價格`;
  //    落地證據 `supabase/migrations/20260825120000_m4b_zero_price_allowed_in_variant_sync.sql`
  //    與 `20260825130000_m4b_zero_price_checkout_and_cart_total_gate.sql` 兩支)。
  //
  // 🔴 **這一格是量出來的, 不是想出來的**(2026-08-29 線F,接線G 交的問句「做錯的另外四種」):
  //    對 `cart/actions.ts` 的單價路徑跑四種「做錯」突變, 本檔基準 13/13:
  //      少算 `variant.price - 1`            ⇒ 3 紅  ✅ 擋得住
  //      多算 `variant.price + 1`            ⇒ 3 紅  ✅ 擋得住
  //      順序 `.find(...)` ⇒ `[0]`(拿錯變體)⇒ 1 紅  ✅ 擋得住
  //      🔴 邊界 `variant.price || product.price` ⇒ **13/13 全過** ⇒ **完全擋不住**
  //    成因:**fixture 裡一個 0 元都沒有** ⇒ 那條 `||` 永遠不觸發。
  //    🔴 **那個數要綁 baseline**(codex 關卡2 R1 nit):`grep -c 'price: 0' <本檔>`
  //    **在本片之前** ⇒ **0**;**本片之後同一條命令 ⇒ 3**(兩個 fixture + **這一段註解自己**)。
  //    ⚠️ 不標 baseline 的話,下一個人重跑會得到相反的數,然後以為這段註解在說謊。
  //
  // 🔴🔴 **而「3 不是 2」這一格值得留下來,它比前面那句更尖**(codex 關卡2 R2 nit 抓的):
  //    我第一次寫「本片之後 ⇒ 2」—— 我數的是**我加的兩個 fixture**,
  //    而那條命令數的是**檔案裡的命中次數**,**而我這段解釋自己就含著那個字面。**
  //    📌 **一段【解釋某個數怎麼來】的註解,把那個數改掉了。**
  //    ⇒ 本片作者今天在同一個形狀上踩了**四次**(:247 的 `requireRealIdentity ⇒ 0`、
  //      `995204ab` 的墓碑行被自己的 grep 命中、這裡的 0⇒3,以及兩次行號憑印象)——
  //      **四次的共同點都是:我報的是【我心裡那份清單】,而命令數的是【檔案裡的命中】。**
  //
  // 📌 **而它不是「少守一種」, 它是【最貴的那一種】**:`||` 把 0 當成 falsy ⇒ 退化成群代表價
  //    ⇒ **一件贈品 / 買一送一的「送」/ 試用品, 會被算成 14600 跟客人收。**
  //
  // 🛑🛑 **而上面那句講的是【突變世界】—— `|| product.price` 不是現行程式碼。**
  //    (2026-08-29 補;`2b5af691` 落筆時漏了這一句, 而它差一點讓一個不存在的 bug 上到 Sean 桌上。)
  //    **現行是素的賦值**:`cart/actions.ts` 的 `unitPrice = variant.price;` 與 `unitPrice = product.price;`
  //    (錨字串 `unitPrice = `, 兩處;**不引行號 —— 行號會漂**)。
  //    **全 repo 掃 `price ||`**(`apps/storefront/src` + `apps/admin/src` + `packages`, 排除測試)
  //    ⇒ **3 處, 而【零處在算錢】**:`FilterTop.tsx` 兩處是篩選列的 UI 標籤;
  //    第三處 `packages/domain/src/catalog/pricing.ts` 是**一句註解**, 而它的內容剛好相反 ——
  //    逐字「design L29 `if (!pbt) return product.price || 0; // legacy fallback` **不採**」。
  //    負對照:**現場現造一個不存在的字面, 跑之前先確認它回 0**。
  //    🔴 **這裡刻意【不寫死】那個字面, 而理由是我當場踩到的**:我第一版寫死了它,
  //    而**寫進本檔的那一刻它就回 1 了 —— 命中的是這一行註解自己。**
  //    📌 **一個負對照字面, 在被寫進正文的那一刻就死了 —— 而它死掉的時候不會出聲。**
  //    (`docs/launch-todo.md` 維護紀律早就立了這一條, 2026-08-28;我今天才親手證明它。)
  //    ⇒ 📌 **那個坑在 design 稿裡, 而我們這一側刻意沒有採用它。**
  //
  // 🔴🔴 **所以下面這兩格【不是在修 bug, 是在裝引信】** —— 兩者在標題上長得很像, 這裡寫死:
  //    今天沒有任何一條路會踩到那個坑;而**在這兩格之前, 有人哪天寫成 `||`, 不會有任何東西叫**。
  // 📌 **判別句(這一格的來源)**:**一個突變的後果, 與一個 bug 的後果, 寫出來是同一句話** ——
  //    差別只在「它現在存不存在」, **而那一格如果不寫, 讀的人會補上【最急的那個讀法】。**
  //    ⇒ 修法不是「寫清楚一點」, 是:**突變的後果句旁邊【必須】有一句「這不是現行程式碼」。**
  //    ⚠️ 而少算多算那兩種**改的是數字**、這一種**改的是「哪個值算數」** ——
  //    前三種在 diff 上看得出來是在動價格, 而 `|| product.price` 讀起來像一句防呆。
  it('🔴 0 元是合法價格:變體價 0 ⇒ unitPrice 0(不得退化成群代表價)', async () => {
    fetchMock.mockResolvedValue(
      makeProduct({
        variants: [
          // 🔴 **`v0` 刻意【不放第一個】**(codex 關卡2 must-fix):放第一個的話,
          //    「`.find()` 只用來確認存在、取價卻誤拿 `variants[0].price`」那種做錯
          //    在本格會是**綠的** —— 而那正是會跟客人收錯錢的其中一種。
          { id: 'v2', sku: 'DCC01-P', spec: { weave: 'Plain' }, price: 14600, images: [] },
          { id: 'v0', sku: 'GIFT-01', spec: { weave: 'Forged' }, price: 0, images: [] },
        ],
      }),
    );
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v0' }]));
    // 正向同伴先跑:這張卡真的解析出來了(否則下面那個 0 只是「什麼都沒有」)。
    expect(line.found, '這一行根本沒解析出來 ⇒ 下面那個 0 不算「守住了」').toBe(true);
    expect(line.unitPrice, '0 被當成 falsy ⇒ 退化成群價 = 跟客人多收一整件的錢').toBe(0);
  });

  it('🔴 0 元是合法價格:無變體商品群價 0 ⇒ unitPrice 0(同一個 falsy 坑的另一半)', async () => {
    fetchMock.mockResolvedValue(makeProduct({ price: 0, variants: [] }));
    const line = first(await resolveCartLines([{ productId: 'rpm-1' }]));
    expect(line.found).toBe(true);
    expect(line.unitPrice).toBe(0);
  });

  it('round3 防回歸:genuine 無變體商品(variants 空)+ 無 variantId → 仍回群代表價', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [] }));
    const line = first(await resolveCartLines([{ productId: 'rpm-1' }]));
    expect(line.found).toBe(true);
    expect(line.unitPrice).toBe(14600);
  });

  it('V-2e:fitments 白名單投影(逐欄重建、多餘欄剝除、yearEnd null 開放式保留不塌)', async () => {
    fetchMock.mockResolvedValue(
      makeProduct({
        fitments: [
          { motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2021, yearEnd: null, internal: 'x' },
          { motoBrand: 'Honda', modelCode: 'CB650R' }, // 無年份=不限
        ],
      }),
    );
    const line = first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }]));
    expect(line.fitments).toEqual([
      { motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2021, yearEnd: null },
      { motoBrand: 'Honda', modelCode: 'CB650R' },
    ]);
    // 多餘欄確實被剝(toEqual 對 undefined 欄寬鬆、需顯式驗 key 不存在)
    expect(Object.keys(line.fitments[0]!)).not.toContain('internal');
  });

  it('V-2e:無 fitments 商品 → fitments=[](found:false 各分支亦 [])', async () => {
    fetchMock.mockResolvedValue(makeProduct());
    expect(first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }])).fitments).toEqual([]);
    fetchMock.mockResolvedValue(null);
    expect(first(await resolveCartLines([{ productId: 'gone' }])).fitments).toEqual([]);
  });
});

/**
 * ⟦auth-DEALERTIERPRICING⟧ M-2-08 B2a —— **經銷會員換成自己那個 tier 的價**。
 *
 * 🔴 這一族守的是【誰拿到哪個價】, 不是【價算得對不對】(後者在 RPC 那一層與 `computeTax`)。
 * 🛑 **效度上限**:fixture 驗;**正式庫零判別力** —— 2026-09-07 兩表讀數
 *   (25,769 件商品 + 59,841 個變體, **全無差價**)⇒ 這一段上線後**畫面零改動**。
 *   📌 **那是 fail-safe 的方向, 不是沒生效。**
 */
describe('B2a 經銷 tier 價', () => {
  it('🟢 一般會員 ⇒ 【根本不叫】RPC(那是安全邊界不是效能)', async () => {
    // 🔴 貼板 68 之前正式庫沒有那支 RPC ⇒ 若每個人都叫, 全站購物車壞掉。
    fetchMock.mockResolvedValue(makeProduct({ variants: [] }));
    await resolveCartLines([{ productId: 'rpm-1' }]);
    expect(pricesMock, '一般會員不得叫 RPC').not.toHaveBeenCalled();
    expect(idsMock, '連 uuid 都不用查').not.toHaveBeenCalled();
  });

  it('🔴 經銷會員 · 無變體商品 ⇒ 單價換成 RPC 回的那個', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    idsMock.mockResolvedValueOnce(new Map([['rpm-1', 'uuid-p1']]) as never);
    pricesMock.mockResolvedValueOnce(new Map([['product:uuid-p1', 800]]) as never);
    expect(first(await resolveCartLines([{ productId: 'rpm-1' }])).unitPrice).toBe(800);
  });

  it('🔴 經銷會員 · 變體 ⇒ 用【變體那一半】的價(不是商品層的)', async () => {
    fetchMock.mockResolvedValue(makeProduct());
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    pricesMock.mockResolvedValueOnce(new Map([['variant:v1', 900]]) as never);
    expect(
      first(await resolveCartLines([{ productId: 'rpm-1', variantId: 'v1' }])).unitPrice,
    ).toBe(900);
  });

  it('🔴🔴 `(kind, id)` 配對 —— 同一個 id 同時是商品與變體時【不得互相覆蓋】', async () => {
    // 🛑 codex 2026-09-07 指出:單用 `id` 建 Map 會讓一行拿到另一行的價,
    //    而兩邊都是合法的整數 ⇒ **看不出來**。這一格就是那個世界。
    // 🔵 兩個【不同商品】:一個無變體(handle `plain`)、一個有變體(handle `withvar`),
    //    而讓「無變體那個的 uuid」與「變體 id」**是同一個字串** `same` ⇒ 那正是會互蓋的世界。
    //    (同一個商品既無變體又帶變體不成立 —— 那條路是 fail-closed `found:false`。)
    fetchMock.mockImplementation(async (h: string) =>
      h === 'plain'
        ? makeProduct({ slug: 'plain', price: 1000, variants: [] })
        : makeProduct({ slug: 'withvar', variants: [{ id: 'same', sku: 'S', spec: {}, price: 1000, images: [] }] }),
    );
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    idsMock.mockResolvedValueOnce(new Map([['plain', 'same']]) as never);
    pricesMock.mockResolvedValueOnce(
      new Map([['product:same', 700], ['variant:same', 900]]) as never,
    );
    const lines = await resolveCartLines([
      { productId: 'plain' },
      { productId: 'withvar', variantId: 'same' },
    ]);
    expect(lines[0]?.unitPrice, '無變體那行要拿【商品】那個價').toBe(700);
    expect(lines[1]?.unitPrice, '變體那行要拿【變體】那個價').toBe(900);
  });

  it('🛑 RPC 失敗 ⇒ 往上拋, 【不】靜默退回 general', async () => {
    // 🔴 退回 general 會讓經銷商用一般價結帳而畫面上完全正常 —— 那是錢錯而它不會紅。
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    idsMock.mockResolvedValueOnce(new Map([['rpm-1', 'uuid-p1']]) as never);
    pricesMock.mockRejectedValueOnce(new Error('rpc missing') as never);
    await expect(resolveCartLines([{ productId: 'rpm-1' }])).rejects.toThrow();
  });

  // ⛔ ~~原本這一格叫「RPC 沒回那一行 ⇒ 維持 general(不猜、不寫 null)」而斷言 unitPrice 仍是 1000。~~
  //    🔴 **codex R1 must-fix ② 判它是錯的, 而它是對的** —— 「不猜」我做到了,
  //    「維持 general」卻正是**用一般價賣給經銷商**, 而那條路上每一把尺都是綠的。
  //    ⇒ 這一族三條縫(身分查不出 / uuid 查不到 / RPC 少回一列)全部改成【拋】。
  //    舊字面留刪除線, 讓下一個搜「維持 general」的人同一發撞到訂正。
  it('🛑 RPC 少回那一列 ⇒ 拋(【不】拿一般價賣給經銷商)', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    idsMock.mockResolvedValueOnce(new Map([['rpm-1', 'uuid-p1']]) as never);
    pricesMock.mockResolvedValueOnce(new Map() as never);
    await expect(resolveCartLines([{ productId: 'rpm-1' }])).rejects.toThrow(/沒回/);
  });

  it('🛑 uuid 查不到 ⇒ 拋(handle→uuid 那一段斷掉也是同一個錢錯)', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    idsMock.mockResolvedValueOnce(new Map() as never);
    await expect(resolveCartLines([{ productId: 'rpm-1' }])).rejects.toThrow(/uuid/);
  });

  it('🛑 已登入而 tier 讀不到(reason:tier)⇒ 拋(那與「他就是 general」不是同一件事)', async () => {
    // 🔴 codex R1 must-fix ① 的正身:tier 查詢失敗舊碼回 general ⇒ 經銷商靜默用一般價。
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: false, reason: 'tier', tier: 'general' } as never);
    await expect(resolveCartLines([{ productId: 'rpm-1' }])).rejects.toThrow();
  });

  it('🔴🔴 認證層抖動(reason:auth)⇒ 【要】拋 —— B2c 之後不擋就是多收', async () => {
    // 🛑 **R3 must-fix ③**:我原本的 `if (!ok) throw` 在 `tier === 'store'` 上面
    //    ⇒ Supabase 認證一抖, **全站購物車與結帳頁一起掛掉**, 而改動前這條路根本不碰 auth。
    //    📌 我的註解宣稱「射程收窄到經銷商」, 而碼沒有收窄 —— **這一格就是那個宣稱的證人**。
    //    ⚠️ 殘餘風險(不自宣接受):此時一位經銷商會走 general —— 與改動前相同, 已進 QB 佇列給 Sean。
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: false, reason: 'auth', tier: 'general' } as never);
    await expect(resolveCartLines([{ productId: 'rpm-1' }])).rejects.toThrow(/身分查不出來/);
    expect(pricesMock, '身分不明時不得叫 RPC').not.toHaveBeenCalled();
  });

  it('🟢 正對照:訪客(未登入)不受影響 —— 他是 ok:true, 不走那條擋門', async () => {
    // 🔴 這一格是上一格的**射程限定**:擋的是【認證層故障】, 不是【沒登入】。
    //    未登入的正常形狀是 user:null + AuthSessionMissingError ⇒ `resolveAuthenticatedTierStrict`
    //    回 `{ok:true, tier:'general'}`(`lib/tier.ts` 那段註解逐字記著這個坑)。
    //    ⇒ 少了這一格, 上一格看起來像「一抖全站就掛」, 而實際射程窄得多。
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'general' } as never);
    expect(first(await resolveCartLines([{ productId: 'rpm-1' }])).unitPrice).toBe(1000);
  });

  it('🔴🔴 換成經銷價的【同一個動作】要標 `priceUntaxed: true`', async () => {
    // 🛑 這一格補的是一個**分母缺口**:旗標是在本檔設的, 而結帳頁那支測試
    //    把 `resolveCartLines` 整支 mock 掉 ⇒ 我在那邊做「不標未稅」的突變**印全綠**。
    //    📌 **一道守門有兩個分母:它會不會錯, 與【有沒有人在看那個地方】。**
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'store' } as never);
    idsMock.mockResolvedValueOnce(new Map([['rpm-1', 'uuid-p1']]) as never);
    pricesMock.mockResolvedValueOnce(new Map([['product:uuid-p1', 800]]) as never);
    const line = first(await resolveCartLines([{ productId: 'rpm-1' }]));
    expect(line.unitPrice, '價換了').toBe(800);
    expect(line.priceUntaxed, '而旗標也要跟著 —— 少了它, 結帳頁不會加 5%').toBe(true);
  });

  it('🟢 正對照:一般會員那一列【不帶】旗標(含稅, 再加就是重複課稅)', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'general' } as never);
    const line = first(await resolveCartLines([{ productId: 'rpm-1' }]));
    expect(line.unitPrice).toBe(1000);
    expect(line.priceUntaxed ?? false, '一般價是含稅的').toBe(false);
  });

  it('🟢 正對照:身分查得出來而他就是 general ⇒ 照走原路不拋', async () => {
    // 🛑 少了這一格, 上面三格「會拋」只證明我很會拋。
    fetchMock.mockResolvedValue(makeProduct({ variants: [], price: 1000 }));
    tierMock.mockResolvedValueOnce({ ok: true, tier: 'general' } as never);
    expect(first(await resolveCartLines([{ productId: 'rpm-1' }])).unitPrice).toBe(1000);
  });
});
