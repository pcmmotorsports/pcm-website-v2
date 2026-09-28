// SupabaseProductAdapter.fitment.test.ts — listByFitment 兩步查詢(2026-09-28,計畫〈商品頁推薦查詢逾時〉第 5.1 版 §6)。
//
// 🔴 用真的 supabase-js client + 假 fetch:攔下【實際送出的網址】,依資料表分派回應,並依收到的 select 裁掉沒列出的欄位
//    (計畫 R4 必修 1:mock 不看 select 一律回整列的話,漏選欄位不會紅)。
//    ⇒ 斷言看的是 supabase-js 真的組出來的網址,不是我們以為它會組的網址。

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SupabaseProductAdapter } from './SupabaseProductAdapter';
import {
  FITMENT_STEP1_MAX_PAGES,
  FITMENT_STEP1_PAGE_SIZE,
  FITMENT_STEP2_URL_BUDGET,
  buildFitmentYearFilter,
  fitmentStep2Url,
} from './helpers/fitment-queries';

const BASE = 'https://abcdefghijklmnopqrst.supabase.co';
const REST = `${BASE}/rest/v1`;
const DEALER_COLUMNS = ['price_store', 'price_by_tier', 'metadata', 'cost'];

type Fit = { id: number; product_id: string; moto_brand: string; model_code: string; year_start: number | null; year_end: number | null };
type Prod = Record<string, unknown> & { id: string; handle: string };

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function product(id: string, handle: string, extra: Record<string, unknown> = {}): Prod {
  return {
    id,
    external_id: handle,
    title: handle,
    subtitle: null,
    description: null,
    highlights: [],
    manuals: [],
    video_url: null,
    sound_clips: [],
    handle,
    fitments: [],
    images: [],
    availability: 'in-stock',
    brand_id: 'b1',
    category_id: 'c1',
    price_general: 1000,
    original_price: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    card_image_trim: null,
    brands: { id: 'b1', name: 'B', slug: 'b', premium_extra_pct: 0 },
    categories: { raw_path: 'C', segments: ['C'] },
    product_variants_public: [],
    price_store: 999, // 經銷價:只有 select 真的要了才會回(模擬 view 物理排除時,select 不列就拿不到)
    ...extra,
  };
}

/** select 字串的頂層欄名(括號內不看)。 */
function topLevelColumns(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((c) => c.split('!')[0]!.split('(')[0]!.split(':')[0]!.trim());
}

interface Db {
  fits: Fit[];
  products: Map<string, Prod>;
  /** 第二步的車款重驗要把這些 id 濾掉(模擬兩步之間改成不相容)。 */
  incompatibleInStep2?: Set<string>;
  /** 第二步多回的 id(模擬錯誤的回應)。 */
  extraInStep2?: Prod;
  /** 第二步少回的 id。 */
  dropInStep2?: Set<string>;
  failStep1Page?: number;
  failStep2Call?: number;
  /** 第二步從第 N 次呼叫起一直斷線。 */
  rejectStep2Call?: number;
  /** 第一步永遠回滿一頁(測 20 頁上限)。 */
  endlessStep1?: boolean;
  /** 第二步回傳順序倒過來(測依第一步順序排好)。 */
  reverseStep2?: boolean;
  /** 假資料庫的定序;預設 JavaScript 字串比較。給 en-US 那種就能跟 JavaScript 排出不同順序。 */
  collation?: (a: string, b: string) => number;
}

function makeClient(db: Db) {
  const urls: { table: string; url: string }[] = [];
  let step1Calls = 0;
  let step2Calls = 0;
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.replace('/rest/v1/', '');
    urls.push({ table, url: url.toString() });
    const p = url.searchParams;
    if (table === 'product_fitments') {
      step1Calls += 1;
      if (db.failStep1Page === step1Calls) return json({ message: 'step1 boom', code: 'XX000' }, 500);
      const offset = Number(p.get('offset') ?? '0');
      const limit = Number(p.get('limit') ?? '1000');
      if (db.endlessStep1) {
        return json(Array.from({ length: limit }, (_, i) => ({ product_id: uuid(offset + i + 1), id: offset + i + 1, products_public: { handle: `h${offset + i}` } })));
      }
      const brand = p.get('moto_brand')!.replace(/^eq\./, '');
      const model = p.get('model_code')!.replace(/^eq\./, '');
      const rows = db.fits
        .filter((f) => f.moto_brand === brand && f.model_code === model && db.products.has(f.product_id))
        .map((f) => ({ product_id: f.product_id, id: f.id, products_public: { handle: db.products.get(f.product_id)!.handle } }))
        .sort((a, b) => {
          const byHandle = db.collation
            ? db.collation(a.products_public.handle, b.products_public.handle)
            : a.products_public.handle < b.products_public.handle ? -1 : a.products_public.handle > b.products_public.handle ? 1 : 0;
          return byHandle || a.id - b.id;
        });
      return json(rows.slice(offset, offset + limit));
    }
    if (table === 'products_public') {
      step2Calls += 1;
      // supabase-js 對網路錯誤會自動重試 ⇒ 從第 N 次起一直斷,才是「這一批真的拿不到」
      if (db.rejectStep2Call !== undefined && step2Calls >= db.rejectStep2Call) throw new Error('network down');
      if (db.failStep2Call === step2Calls) return json({ message: 'step2 boom', code: 'XX000' }, 500);
      const ids = p.get('id')!.replace(/^in\.\(/, '').replace(/\)$/, '').split(',');
      const brand = p.get('product_fitments.moto_brand')?.replace(/^eq\./, '');
      const model = p.get('product_fitments.model_code')?.replace(/^eq\./, '');
      let rows = ids
        .filter((id) => db.products.has(id))
        .filter((id) => db.fits.some((f) => f.product_id === id && f.moto_brand === brand && f.model_code === model))
        .filter((id) => !db.incompatibleInStep2?.has(id))
        .filter((id) => !db.dropInStep2?.has(id))
        .map((id) => db.products.get(id)!);
      if (db.extraInStep2 && step2Calls === 1) rows = [...rows, db.extraInStep2];
      if (db.reverseStep2) rows = [...rows].reverse();
      const keep = new Set(topLevelColumns(p.get('select')!));
      return json(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k)))));
    }
    return json({ message: `unexpected table ${table}` }, 404);
  };
  const client = createClient(BASE, 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl as typeof fetch },
  });
  return { client, urls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** n 件商品,每件 fitsPer 列車款(同一台車)。handle 依 id 倒序,驗「順序由資料庫的 handle 決定」。 */
function dbWith(n: number, fitsPer = 1): Db {
  const products = new Map<string, Prod>();
  const fits: Fit[] = [];
  let fitId = 1;
  for (let i = 1; i <= n; i += 1) {
    const id = uuid(i);
    products.set(id, product(id, `h-${String(n - i).padStart(5, '0')}`));
    for (let k = 0; k < fitsPer; k += 1) {
      fits.push({ id: fitId++, product_id: id, moto_brand: 'BMW', model_code: 'S 1000 RR', year_start: 2019, year_end: null });
    }
  }
  return { fits, products };
}

const SPEC = { motoBrand: 'BMW', modelCode: 'S 1000 RR', yearStart: 2021, yearEnd: 2021 } as const;

describe('listByFitment 兩步查詢:形狀', () => {
  it('第一步查 product_fitments、只內嵌 products_public(handle)、兩層排序;第二步查 products_public,結果照第一步順序', async () => {
    const db = { ...dbWith(3), reverseStep2: true };
    const { client, urls } = makeClient(db);
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 100);

    const step1 = new URL(urls.find((u) => u.table === 'product_fitments')!.url);
    expect(step1.searchParams.get('select')).toBe('product_id,id,products_public!inner(handle)');
    expect(step1.searchParams.get('order')).toBe('products_public(handle).asc,id.asc');
    const step2 = new URL(urls.find((u) => u.table === 'products_public')!.url);
    expect(step2.searchParams.get('select')).toContain('product_fitments!inner(moto_brand)');
    // 資料庫 handle 升冪:h-00000 是 id 3、h-00001 是 id 2、h-00002 是 id 1;第二步故意倒過來回
    expect(result.map((p) => p.id)).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  // R1 建議 2:上面那格的 handle 用 JavaScript 排也是同一個順序 ⇒ 抓不到「在 JavaScript 重排」。
  //   正式庫定序是 en_US.UTF-8(計畫 §2-4),這裡讓假資料庫用 en-US 排,跟 JavaScript 排出不同順序。
  it('🔴 順序完全照第一步(資料庫定序),不在 JavaScript 重排', async () => {
    const products = new Map<string, Prod>([
      [uuid(1), product(uuid(1), 'B-y')],
      [uuid(2), product(uuid(2), 'a-x')],
      [uuid(3), product(uuid(3), 'b-z')],
    ]);
    const fits = [1, 2, 3].map((i) => ({ id: i, product_id: uuid(i), moto_brand: 'BMW', model_code: 'S 1000 RR', year_start: 2019, year_end: null }));
    const db: Db = { fits, products, reverseStep2: true, collation: (a, b) => a.localeCompare(b, 'en-US') };
    const { client } = makeClient(db);
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 100);
    expect(['B-y', 'a-x', 'b-z'].sort(), '前提:JavaScript 排出來要跟資料庫不同').toEqual(['B-y', 'a-x', 'b-z']);
    expect(result.map((p) => p.handle)).toEqual(['a-x', 'B-y', 'b-z']);
  });

  it('🔴 經銷欄位不在第一步的內嵌、也不在第二步的 select', async () => {
    const { client, urls } = makeClient(dbWith(2));
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 100);
    for (const u of urls) {
      const select = new URL(u.url).searchParams.get('select') ?? '';
      for (const col of DEALER_COLUMNS) expect(select, `${u.table} 的 select 帶了 ${col}`).not.toContain(col);
    }
    expect(JSON.stringify(result)).not.toContain('999');
  });

  it('🔴 特價欄:第二步 select 含 original_price,商品帶 saleOriginalPrice(拿掉那一欄 ⇒ 兩條都紅)', async () => {
    const db = dbWith(1);
    db.products.set(uuid(1), { ...db.products.get(uuid(1))!, price_general: 8000, original_price: 10000 });
    const { client, urls } = makeClient(db);
    const [p] = await new SupabaseProductAdapter(client).listByFitment(SPEC, 100);
    expect(new URL(urls.find((u) => u.table === 'products_public')!.url).searchParams.get('select')).toContain('original_price');
    expect(p!.saleOriginalPrice).toBe(10000);
    expect(p!.priceByTier.general.amount).toBe(8000);
  });
});

describe('listByFitment 兩步查詢:第二步一定重驗車款(計畫 R5 必修)', () => {
  it('🔴 每一批第二步都帶廠牌、車型、年份條件(與第一步相同)', async () => {
    const { client, urls } = makeClient(dbWith(400));
    await new SupabaseProductAdapter(client).listByFitment(SPEC, 400);
    const step2 = urls.filter((u) => u.table === 'products_public');
    expect(step2.length).toBeGreaterThan(1);
    const year = buildFitmentYearFilter(SPEC);
    for (const u of step2) {
      const p = new URL(u.url).searchParams;
      expect(p.get('select')).toContain('product_fitments!inner(');
      expect(p.get('product_fitments.moto_brand')).toBe('eq.BMW');
      expect(p.get('product_fitments.model_code')).toBe('eq.S 1000 RR');
      expect(p.get('product_fitments.or')).toBe(`(${year})`);
    }
  });

  it('🔴 兩步之間商品 X 改成不相容 ⇒ 第二步濾掉,結果沒有 X', async () => {
    const db = { ...dbWith(3), incompatibleInStep2: new Set([uuid(2)]) };
    const { client } = makeClient(db);
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 100);
    expect(result.map((p) => p.id)).toEqual([uuid(3), uuid(1)]);
  });
});

describe('listByFitment 兩步查詢:第一步分頁', () => {
  it('第一頁剛好 1,000 列要繼續讀、最後一頁不足要停;同一商品多列只算一次', async () => {
    // 600 件 × 2 列 = 1,200 列 ⇒ 兩頁
    const { client, urls } = makeClient(dbWith(600, 2));
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 800);
    const step1 = urls.filter((u) => u.table === 'product_fitments');
    expect(step1).toHaveLength(2);
    expect(new URL(step1[0]!.url).searchParams.get('limit')).toBe(String(FITMENT_STEP1_PAGE_SIZE));
    expect(new URL(step1[1]!.url).searchParams.get('offset')).toBe(String(FITMENT_STEP1_PAGE_SIZE));
    expect(result).toHaveLength(600);
    expect(new Set(result.map((p) => p.id)).size).toBe(600);
  });

  it('拿到 poolLimit 個就停,不讀下一頁', async () => {
    const { client, urls } = makeClient(dbWith(1500));
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 800);
    expect(urls.filter((u) => u.table === 'product_fitments')).toHaveLength(1);
    expect(result).toHaveLength(800);
  });

  it(`🔴 讀了 ${FITMENT_STEP1_MAX_PAGES} 頁還沒讀完 ⇒ 丟錯(不回部分結果)`, async () => {
    const { client } = makeClient({ ...dbWith(1), endlessStep1: true });
    await expect(new SupabaseProductAdapter(client).listByFitment(SPEC, 1_000_000)).rejects.toThrow(/還沒讀完/);
  });
});

describe('listByFitment 兩步查詢:第二步網址長度', () => {
  it(`🔴 每批實際網址 ≤ ${FITMENT_STEP2_URL_BUDGET} bytes、自己算的長度等於實際網址、800 個 id 切 3 批以上`, async () => {
    const { client, urls } = makeClient(dbWith(800));
    await new SupabaseProductAdapter(client).listByFitment(SPEC, 800);
    const step2 = urls.filter((u) => u.table === 'products_public');
    expect(step2.length).toBeGreaterThanOrEqual(3);
    for (const u of step2) {
      expect(u.url.length).toBeLessThanOrEqual(FITMENT_STEP2_URL_BUDGET);
      const p = new URL(u.url).searchParams;
      const ids = p.get('id')!.replace(/^in\.\(/, '').replace(/\)$/, '').split(',');
      const mine = fitmentStep2Url(REST, p.get('select')!, SPEC, buildFitmentYearFilter(SPEC), ids);
      expect(mine).toBe(u.url);
    }
  });
});

describe('listByFitment 兩步查詢:失敗一律整批失敗,少回不算錯', () => {
  it.each([
    ['第一步回 error', { failStep1Page: 1 }, 3],
    ['第一步第二頁回 error', { failStep1Page: 2 }, 600],
    ['第二步某一批回 error', { failStep2Call: 2 }, 800],
    ['第二步某一批 reject', { rejectStep2Call: 2 }, 800],
  ] as const)('🔴 %s ⇒ 丟錯', async (_label, extra, n) => {
    const base = n === 600 ? dbWith(600, 2) : dbWith(n);
    const { client } = makeClient({ ...base, ...extra });
    await expect(new SupabaseProductAdapter(client).listByFitment(SPEC, 800)).rejects.toThrow();
  });

  it('🔴 第二步回了不在清單內的 id ⇒ 丟錯', async () => {
    const { client } = makeClient({ ...dbWith(2), extraInStep2: product(uuid(999), 'zz-extra') });
    await expect(new SupabaseProductAdapter(client).listByFitment(SPEC, 100)).rejects.toThrow(/清單以外/);
  });

  it('第二步少回一筆 ⇒ 不丟錯,其餘照第一步順序', async () => {
    const { client } = makeClient({ ...dbWith(3), dropInStep2: new Set([uuid(3)]) });
    const result = await new SupabaseProductAdapter(client).listByFitment(SPEC, 100);
    expect(result.map((p) => p.id)).toEqual([uuid(2), uuid(1)]);
  });

  it('查無相容商品 ⇒ 回 [],不查第二步', async () => {
    const { client, urls } = makeClient({ fits: [], products: new Map() });
    expect(await new SupabaseProductAdapter(client).listByFitment(SPEC, 100)).toEqual([]);
    expect(urls.filter((u) => u.table === 'products_public')).toHaveLength(0);
  });
});

describe('listByFitment 兩步查詢:年份四種(第一步直接套在車款表,第二步套在內嵌車款表)', () => {
  it.each([
    ['沒選年份', { motoBrand: 'BMW', modelCode: 'S 1000 RR' }, null],
    ['年份落在範圍內', { motoBrand: 'BMW', modelCode: 'S 1000 RR', yearStart: 2021, yearEnd: 2021 }, 'year_start.is.null,and(year_start.lte.2021,or(year_end.is.null,year_end.gte.2021))'],
    ['year_end 空(到現在)', { motoBrand: 'BMW', modelCode: 'S 1000 RR', yearStart: 2020, yearEnd: null }, 'year_start.is.null,or(year_end.is.null,year_end.gte.2020)'],
    ['year_start 空的商品(通用年份)也要能中', { motoBrand: 'BMW', modelCode: 'S 1000 RR', yearStart: 2018, yearEnd: 2018 }, 'year_start.is.null,and(year_start.lte.2018,or(year_end.is.null,year_end.gte.2018))'],
  ] as const)('%s', async (_label, spec, expected) => {
    const { client, urls } = makeClient(dbWith(2));
    await new SupabaseProductAdapter(client).listByFitment(spec, 100);
    const s1 = new URL(urls.find((u) => u.table === 'product_fitments')!.url).searchParams;
    const s2 = new URL(urls.find((u) => u.table === 'products_public')!.url).searchParams;
    expect(s1.get('or')).toBe(expected === null ? null : `(${expected})`);
    expect(s2.get('product_fitments.or')).toBe(expected === null ? null : `(${expected})`);
    if (expected !== null) expect(expected.startsWith('year_start.is.null,')).toBe(true);
  });
});
