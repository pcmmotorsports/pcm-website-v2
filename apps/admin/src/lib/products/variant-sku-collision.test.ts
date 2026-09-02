import { describe, expect, it, vi, beforeEach } from 'vitest';

// 🔴 這支檔守的不是「函式會不會動」, 是**四件會靜默出錯的事**:
//   ① 少掉「它自己沒有變體」那個條件 ⇒ 對 26 支正常商品開火(正式庫實量, 誤報 76%)
//   ② 少掉 `neq(product_id)` ⇒ 一支「料號 = 自己第一個變體 sku」的正常商品會命中自己
//      (全站有 15,060 支是那個形狀 —— 那完全正常)
//   ③ 查不到時應該回 `null`(不打擾), 而不是丟例外把上架整個擋住
//   ④ 回傳要說得出【是誰的規格】—— 一句「這支怪怪的」在畫面上會被一路按過去
//
// 🛑 而本檔【驗不到】的一格, 明寫:那兩個 `.eq()` 送出去的**欄名對不對**,
//    這裡是假的 client, 欄名打錯它照樣過。那一格只有真的 DB 撞得出來。

// 受測檔頂層 `import 'server-only'`(它是 server-only 模組, 那是對的)⇒ 測試裡 stub 掉。
//   (照 `product-repository.test.ts:9` 既有做法, 不是新發明的。)
vi.mock('server-only', () => ({}));

const from = vi.fn();
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: () => ({ from }) }));

const { findVariantSkuCollision, findVariantSkuCollisionOrUnavailable } = await import('./variant-sku-collision');

const PID = '11111111-2222-3333-4444-555555555555';

/**
 * 🔴🔴 **這個假 client 會【記下每一次篩選用的欄名與值】**(codex 2026-08-31 R1 #4 must-fix)。
 * ⛔ ~~我第一版的 mock 忽略所有參數~~ ⇒ 把 `eq('sku', …)` 改成任何錯欄位, 測試照樣全綠
 *    ⇒ 📌 它證明的是**呼叫鏈的形狀**, 不是判準。
 * ✅ 現在:`ops` 記下 `表.方法(欄, 值)`, 而下面有一格【逐字釘住那三次篩選】。
 * 🛑 而它仍然**驗不到**:那些欄名在真的 DB 上存不存在。那一格只有真 DB 撞得出來。
 */
type Op = string;
function wire(opts: {
  self?: { external_id: string } | null;
  owner?: { sku: string; product_id: string; products: { external_id: string } } | null;
  mine?: unknown[];
  selfError?: boolean;
  ownerError?: boolean;
  mineError?: boolean;
  throwOn?: 'products' | 'variants1' | 'variants2';
}) {
  const ops: Op[] = [];
  let variantCalls = 0;
  from.mockReset();
  from.mockImplementation((table: string) => {
    if (table === 'products') {
      if (opts.throwOn === 'products') throw new Error('boom');
      return {
        select: (cols: string) => {
          ops.push(`products.select(${cols})`);
          return {
            eq: (col: string, val: unknown) => {
              ops.push(`products.eq(${col},${String(val)})`);
              return {
                maybeSingle: async () => ({ data: opts.self ?? null, error: opts.selfError ? new Error('x') : null }),
              };
            },
          };
        },
      };
    }
    variantCalls += 1;
    if (variantCalls === 1) {
      if (opts.throwOn === 'variants1') throw new Error('boom');
      return {
        select: (cols: string) => {
          ops.push(`v1.select(${cols})`);
          return {
            eq: (col: string, val: unknown) => {
              ops.push(`v1.eq(${col},${String(val)})`);
              return {
                neq: (col2: string, val2: unknown) => {
                  ops.push(`v1.neq(${col2},${String(val2)})`);
                  return {
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: opts.owner ?? null,
                        error: opts.ownerError ? new Error('x') : null,
                      }),
                    }),
                  };
                },
              };
            },
          };
        },
      };
    }
    if (opts.throwOn === 'variants2') throw new Error('boom');
    return {
      select: (cols: string) => {
        ops.push(`v2.select(${cols})`);
        return {
          eq: (col: string, val: unknown) => {
            ops.push(`v2.eq(${col},${String(val)})`);
            return { limit: async () => ({ data: opts.mine ?? [], error: opts.mineError ? new Error('x') : null }) };
          },
        };
      },
    };
  });
  return ops;
}

const OWNER = { sku: 'ARSV421-08-G-F', product_id: 'other-id', products: { external_id: 'ARSV421-08' } };

describe('findVariantSkuCollision — 它是誰的規格', () => {
  beforeEach(() => from.mockReset());

  it('🔴 命中:料號是別支商品的變體 sku、而自己沒有變體 ⇒ 說得出【是誰的】', async () => {
    wire({ self: { external_id: 'ARSV421-08-G-F' }, owner: OWNER, mine: [] });
    const r = await findVariantSkuCollision(PID);
    // 🔴 不只驗「有命中」—— 驗它**講得出對方是誰**。少了這一格,
    //    一個回 `{externalId, belongsToExternalId: ''}` 的實作會全綠, 而畫面上那句話會是空的。
    expect(r).toEqual({ externalId: 'ARSV421-08-G-F', belongsToExternalId: 'ARSV421-08' });
  });

  it('🟢 不命中(它自己有變體)⇒ null —— 這一格擋的是【誤報 76%】那個世界', async () => {
    // 正式庫實量:少了這個條件 ⇒ 全站命中 34 支, 其中 26 支是正常商品。
    wire({ self: { external_id: 'ARSV421-08-G-F' }, owner: OWNER, mine: [{ id: 'v1' }] });
    expect(await findVariantSkuCollision(PID)).toBeNull();
  });

  it('🟢 不命中(沒有別支商品用這個 sku)⇒ null(證明它不是恆命中)', async () => {
    wire({ self: { external_id: 'NORMAL-001' }, owner: null, mine: [] });
    expect(await findVariantSkuCollision(PID)).toBeNull();
  });

  it('🛑 查不到自己的料號 ⇒ null(不打擾), 而不是丟例外把上架擋住', async () => {
    wire({ self: null, mine: [] });
    expect(await findVariantSkuCollision(PID)).toBeNull();
  });

  it('🛑 三張表任一出錯 ⇒ null —— 失敗方向朝【不打擾】, 而那是刻意的', async () => {
    wire({ selfError: true });
    expect(await findVariantSkuCollision(PID)).toBeNull();
    wire({ self: { external_id: 'X' }, ownerError: true, mine: [] });
    expect(await findVariantSkuCollision(PID)).toBeNull();
    wire({ self: { external_id: 'X' }, owner: OWNER, mineError: true });
    expect(await findVariantSkuCollision(PID)).toBeNull();
  });

  it('🔴 對方的料號是空字串 ⇒ null(否則畫面會顯示「是「」的一個規格」)', async () => {
    wire({ self: { external_id: 'X' }, owner: { ...OWNER, products: { external_id: '' } }, mine: [] });
    expect(await findVariantSkuCollision(PID)).toBeNull();
  });
});

describe('🔴 那三次篩選的【欄名與值】—— codex R1 #4:不釘住它, 欄位改錯照樣全綠', () => {
  it('逐字釘住:products.eq(id) → v1.eq(sku)+neq(product_id) → v2.eq(product_id)', async () => {
    const ops = wire({ self: { external_id: 'ARSV421-08-G-F' }, owner: OWNER, mine: [] });
    await findVariantSkuCollision(PID);
    // 🔴 **比集合不比長度** —— 而這裡連【值】都比:
    //    `v1.eq(sku, 我的料號)` 若被改成 `eq(sku, productId)`, 長度不變而這一格會紅。
    expect(ops).toEqual([
      'products.select(external_id)',
      `products.eq(id,${PID})`,
      'v1.select(sku, product_id, products!inner(external_id))',
      'v1.eq(sku,ARSV421-08-G-F)',
      `v1.neq(product_id,${PID})`,
      'v2.select(id)',
      `v2.eq(product_id,${PID})`,
    ]);
  });
});

describe('🔴 查不出來 vs 沒撞名 —— codex R1 #2/#3:它們【不是同一件事】', () => {
  it('🛑 三個地方任一 throw ⇒ strict 版回 `unavailable`(而不是靜靜地說「沒問題」)', async () => {
    for (const where of ['products', 'variants1', 'variants2'] as const) {
      wire({ self: { external_id: 'X' }, owner: OWNER, mine: [], throwOn: where });
      // 🔴 我第一版的檔頭寫「錯誤一律回 null」—— **那句是假的**:throw 根本沒被接住。
      //    而測試只演了 `{error}`, 沒演 throw ⇒ 那句話沒有任何東西在守。
      expect(await findVariantSkuCollisionOrUnavailable(PID)).toBe('unavailable');
    }
  });

  it('🛑 DB 回 error(不是 throw)⇒ strict 版也是 `unavailable`', async () => {
    wire({ selfError: true });
    expect(await findVariantSkuCollisionOrUnavailable(PID)).toBe('unavailable');
  });

  it('🟢 正對照:一切正常時 strict 版回的是【命中結果】, 不是 unavailable', async () => {
    wire({ self: { external_id: 'ARSV421-08-G-F' }, owner: OWNER, mine: [] });
    expect(await findVariantSkuCollisionOrUnavailable(PID)).toEqual({
      externalId: 'ARSV421-08-G-F',
      belongsToExternalId: 'ARSV421-08',
    });
  });

  it('🟢 正對照:真的沒撞名時 strict 版回 `null` —— 而 null 與 unavailable 必須分得開', async () => {
    wire({ self: { external_id: 'NORMAL-001' }, owner: null, mine: [] });
    expect(await findVariantSkuCollisionOrUnavailable(PID)).toBeNull();
  });

  it('🔵 而【不打擾】那一版仍然吞錯誤回 null(頁面用它, 不該因為 DB 抖一下就跳警告)', async () => {
    wire({ selfError: true });
    expect(await findVariantSkuCollision(PID)).toBeNull();
  });
});
