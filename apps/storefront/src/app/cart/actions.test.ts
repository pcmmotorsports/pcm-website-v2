// actions.test.ts — resolveCartLines server action unit test(M-3-S2-b2-d)
//
// 驗:① 變體 line → unitPrice = 該變體 general 價 + variantLabel = spec 值合併
//     ② 無變體 line → unitPrice = product.price(群 general)
//     ③ 商品不存在 / 變體 stale → found:false
//     ④ 🔴 經銷零洩漏:回傳僅 unitPrice、無 priceByTier/price_store/store/cost
//     ⑤ input fail-closed:非陣列 → []、非法 entry 略過、超量截斷 200
// node env(server 邏輯);mock '@/lib/products'(避免載 server-only / @pcm/adapters)fetchProductByHandle。

import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/lib/products', () => ({ fetchProductByHandle: fetchMock }));

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
