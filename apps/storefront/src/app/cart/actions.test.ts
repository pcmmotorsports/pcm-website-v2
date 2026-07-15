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
    const res = await resolveCartLines([
      { productId: 'rpm-1', variantId: 123 }, // number
      { productId: 'rpm-1', variantId: { id: 'v1' } }, // object
      { productId: 'rpm-1', variantId: null }, // null
    ]);
    // 全跳 → 不回任何行(若退化成群價會回 3 行 unitPrice=14600〔群內最低〕= 錯價洩漏)。
    expect(res.length).toBe(0);
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

  it('round3 防回歸:genuine 無變體商品(variants 空)+ 無 variantId → 仍回群代表價', async () => {
    fetchMock.mockResolvedValue(makeProduct({ variants: [] }));
    const line = first(await resolveCartLines([{ productId: 'rpm-1' }]));
    expect(line.found).toBe(true);
    expect(line.unitPrice).toBe(14600);
  });
});
