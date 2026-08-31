import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), builder: {} as Record<string, unknown> }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: mocks.createClient }));

import { stripComments } from '../test-support/strip-comments';
import {
  MANUAL_ORDER_CATALOG_COLUMNS,
  MANUAL_ORDER_CATALOG_LIMIT,
  searchManualOrderCatalog,
} from './manual-order-catalog';

// M12-A3-a:品項選擇器讀取端。
// 🔴 誠實邊界:本檔全是 mock ⇒ 證的是「這支檔問了什麼、怎麼翻譯回來」,
//    **不是** PostgREST 真的會回什麼。真的打一發要 DB(線C 沒有)。

const SRC_FILE = join(__dirname, 'manual-order-catalog.ts');

/** 記錄整條 builder 鏈的呼叫,最後回 `result`。 */
function stubClient(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'ilike', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      // `limit` 是鏈尾 ⇒ 回 thenable, 讓 `await` 拿到結果
      return m === 'limit' ? Promise.resolve(result) : chain;
    };
  }
  mocks.createClient.mockReturnValue(chain);
  return calls;
}

function arg(calls: Array<[string, unknown[]]>, method: string): unknown[] {
  return calls.find(([m]) => m === method)?.[1] ?? [];
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'PCM-001',
    price_general: 12000,
    products: { title: '排氣管' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('🔴🔴 防洩漏:select 逐欄指名,零經銷價 / 成本 / metadata', () => {
  it('前提斷言:那支檔真的讀得到(少了這條,路徑一漂就掃空字串 ⇒ 下面全部恆綠)', () => {
    expect(readFileSync(SRC_FILE, 'utf8').length).toBeGreaterThan(500);
  });

  it('🔴 逐字釘住整串欄名 —— 加一欄就要撞紅,被迫回來想一次「這欄該不該進建單表單」', () => {
    // ⛔ ~~'id, sku, price_general, products(title)'~~
    // 🔵 **2026-08-31 Sean 批 price_store 進來**(⟦b4-SKULOOKUP⟧ Q2 逐字「甲 標未稅」)。
    //    🛑 **這一格紅過, 而它紅得對** —— 它逼我回來想一次, 而想完的結論是「該進」。
    //    ⇒ 舊字面留著加刪除線:會來搜舊那串的人, 是讀過舊版的人。
    expect(MANUAL_ORDER_CATALOG_COLUMNS).toBe(
      'id, sku, price_general, price_store, products(title)',
    );
  });

  it('🔴 釘的是傳進 select() 的【值】,不是 `.select(\'*\')` 那個呼叫字面', async () => {
    // 只禁呼叫字面的話, 把常數改成 `'*' as const` 照樣全綠 = 恆綠格
    // (前例逐字:product-repository.test.ts 的 code-reviewer MF2)。
    const calls = stubClient({ data: [], error: null });
    await searchManualOrderCatalog('PCM');
    expect(arg(calls, 'select')[0]).toBe(MANUAL_ORDER_CATALOG_COLUMNS);
    expect(String(arg(calls, 'select')[0])).not.toContain('*');
  });

  // ⛔ ~~it.each(['price_store', 'price_by_tier', 'metadata'])~~
  // 🔵 **`price_store` 2026-08-31 移出這張黑名單**(Sean 批了它進欄位表)。
  // 🛑🛑 **而我【沒有只是把它刪掉】** —— 那會讓這支檔對它從此零約束。
  //    下面另立一格:它只能出現在【該出現的兩個地方】, 不得散在別處。
  //    📌 **一道守門要放寬時, 換掉判準比刪掉判準安全** —— 刪掉之後沒有東西會記得它曾經被守過。
  // ⚠️ 而 `cost` **本來就不在這張清單裡**, 而本 describe 的標題寫著「零經銷價 / 成本 / metadata」
  //    ⇒ **標題比清單寬**(那是本 repo 記過的形狀)。我**沒有**順手補它 —— 那是另一個決定, 已回報。
  it.each(['price_by_tier', 'metadata'])(
    '🔴 整支檔(剝掉註解之後)不得出現 %s',
    (token) => {
      // 🔴 **一定要剝註解** —— 本檔頭那段【逐字寫著】price_store 三次(在講為什麼不讀它)
      //    ⇒ 不剝的話這格會被自己的說明文字命中 = 假紅, 而修法會是「把說明刪掉」。
      const code = stripComments(readFileSync(SRC_FILE, 'utf8'));
      // 🔴 **分母守門(2026-08-28 量到本格恆綠)**:剝完註解是空的(檔改名 / 剝過頭)
      //    ⇒ `not.toContain` 恆真。⚠️ `:61` 有一格在守「檔案長度 > 500」, **而那是【隔壁格】** ——
      //    刪掉它時本格會安靜地變恆真, 所以這裡自己再釘一次結構。
      expect(code, '剝完註解的內容裡連 export 都不在 ⇒ 下面那條什麼都沒證明').toContain('export');
      expect(code).not.toContain(token);
    },
  );

  // 🔵 **取代上面那條被移出黑名單的守門** —— `price_store` 現在合法, 而它**只能在兩個地方**:
  //    ① `MANUAL_ORDER_CATALOG_COLUMNS` 那串 select 欄名
  //    ② 把它翻成 `dealerPriceUntaxed` 的那一行 map
  //    ⇒ 散到別處(例如有人拿它去算價、去比較、去當預設值)⇒ 這一格紅。
  //    📌 而那正是 `:6-70` 那道凍結守的東西:**顯示可以, 生效不行。**
  it('🔴 price_store 只能出現在【欄名字串】與【map 那一行】, 不得散在別處', () => {
    const code = stripComments(readFileSync(SRC_FILE, 'utf8'));
    expect(code, '剝完註解連 export 都不在 ⇒ 下面什麼都沒證明').toContain('export');
    const hits = code.split('price_store').length - 1;
    // 🔵 正對照:同一把尺量一個【確定出現且已知次數】的字面, 證明它數得到東西。
    expect(code.split('price_general').length - 1, '正對照:price_general 至少要有 2 處').toBeGreaterThanOrEqual(2);
    // 🔵 負對照:現造字面必須是 0(不然這把尺對任何字串都回非零)。
    expect(code.split('zzq_no_such_column_20260831').length - 1).toBe(0);
    expect(hits, 'price_store 出現次數超過 2 ⇒ 有人把它用在欄名與 map 之外').toBe(2);
  });

  it('🔴 剝註解的負對照:**沒剝的原文確實含 price_store**(否則上一格是恆綠)', () => {
    expect(readFileSync(SRC_FILE, 'utf8')).toContain('price_store');
  });

  it('🔴 剝註解不得把碼一起吃掉:剝完仍找得到 price_general', () => {
    expect(stripComments(readFileSync(SRC_FILE, 'utf8'))).toContain('price_general');
  });
});

describe('查詢形狀', () => {
  it('查 product_variants、依 sku 排序、帶上限', async () => {
    const calls = stubClient({ data: [], error: null });
    await searchManualOrderCatalog('PCM-0');
    expect(arg(calls, 'from')[0]).toBe('product_variants');
    expect(arg(calls, 'order')).toEqual(['sku', { ascending: true }]);
    expect(arg(calls, 'limit')[0]).toBe(MANUAL_ORDER_CATALOG_LIMIT);
  });

  it('🔴 空關鍵字 ⇒ 直接回空、**一次 DB 都沒打**(ilike \'%%\' 是掃全表,不是查無)', async () => {
    stubClient({ data: [row()], error: null });
    await expect(searchManualOrderCatalog('   ')).resolves.toEqual([]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('關鍵字前後空白會被 trim', async () => {
    const calls = stubClient({ data: [], error: null });
    await searchManualOrderCatalog('  PCM-1  ');
    expect(arg(calls, 'ilike')[1]).toBe('%PCM-1%');
  });

  it.each([
    ['%', '%\\%%'],
    ['_', '%\\_%'],
    ['\\', '%\\\\%'],
    ['a%b_c', '%a\\%b\\_c%'],
  ])('🔴 ilike 萬用字元被逃脫:%s(否則員工打一個 %% 就變成「全部」)', async (input, expected) => {
    const calls = stubClient({ data: [], error: null });
    await searchManualOrderCatalog(input);
    expect(arg(calls, 'ilike')[1]).toBe(expected);
  });
});

describe('翻譯回來的形狀', () => {
  it('正常一列', async () => {
    stubClient({ data: [row()], error: null });
    await expect(searchManualOrderCatalog('PCM')).resolves.toEqual([
      {
        variantId: '11111111-1111-4111-8111-111111111111',
        sku: 'PCM-001',
        title: '排氣管',
        unitPrice: 12000,
      },
    ]);
  });

  it('🔴🔴 沒定價的變體 ⇒ **回傳但 unitPrice = null**,不得靜默跳過', async () => {
    // 跳過它會讓員工以為「這個料號不存在」, 而它存在、只是沒定價
    // ⇒ 兩個不同的世界不得印同一個畫面。
    stubClient({ data: [row({ price_general: null })], error: null });
    const out = await searchManualOrderCatalog('PCM');
    expect(out).toHaveLength(1);
    expect(out[0]!.unitPrice).toBeNull();
  });

  it('關聯讀不到商品名 ⇒ title 給空字串,那一列仍在', async () => {
    stubClient({ data: [row({ products: null })], error: null });
    const out = await searchManualOrderCatalog('PCM');
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('');
  });

  it('data 是 null ⇒ 回空陣列', async () => {
    stubClient({ data: null, error: null });
    await expect(searchManualOrderCatalog('PCM')).resolves.toEqual([]);
  });

  it('🔴 負對照:查無**就是**空陣列(而它與「查詢失敗」是兩件事,見下一組)', async () => {
    stubClient({ data: [], error: null });
    await expect(searchManualOrderCatalog('PCM')).resolves.toEqual([]);
  });
});

describe('🔴 查詢失敗【不得】回空陣列 —— 那會把「壞掉」顯示成「查無此料號」', () => {
  it('error 有值 ⇒ 往上丟,訊息帶得出來', async () => {
    stubClient({ data: null, error: { message: 'connection refused' } });
    await expect(searchManualOrderCatalog('PCM')).rejects.toThrow(
      /searchManualOrderCatalog 失敗.*connection refused/,
    );
  });

  it('🔴 error 有值而 data 也有值 ⇒ 仍然丟(不得因為「有資料」就當成功)', async () => {
    stubClient({ data: [row()], error: { message: 'partial' } });
    await expect(searchManualOrderCatalog('PCM')).rejects.toThrow(/partial/);
  });
});
