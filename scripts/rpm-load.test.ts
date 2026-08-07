// rpm-load.test.ts — #260 groupByKeySignature(保留現值:省 key 列不被混批寫 NULL)
//
// 背景:postgrest-js `.upsert(陣列)` 的 `?columns` 取全批 key 聯集 + defaultToNull=true →
//   同批混「有某 key / 省該 key」→ 省 key 列被寫 NULL(非保留現值)。products.manuals 是 NOT NULL ⇒ 23502 整批全敗。
//   groupByKeySignature 依 own key 集合分成數個 uniform 組,呼叫端逐組 upsert → 省 key 落「該批 columns 不含此 key」
//   的組 → ON CONFLICT DO UPDATE 不覆寫該欄 → 保留現值。
// 2026-08-07:取代原 partitionByKeyPresence(單 key 二分)。條件省 key 欄已達三個(description / manuals /
//   video_url),二分只治一軸、另兩軸仍混批。

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VariantRow } from './rpm-transform';
import * as rpmLoad from './rpm-load';
import { groupByKeySignature } from './rpm-load';

describe('#260 groupByKeySignature(依 own key 集合分 uniform 批)', () => {
  const ids = (groups: { external_id: string }[][]) => groups.map((g) => g.map((r) => r.external_id));

  it('混批 → 依 key 集合分組(組序=首見順序、組內保原順序)', () => {
    const rows = [
      { external_id: 'A', description: 'x' },
      { external_id: 'B' }, // 省 key
      { external_id: 'C', description: 'y' },
    ];
    expect(ids(groupByKeySignature(rows))).toEqual([['A', 'C'], ['B']]);
  });

  it('🔴 rpm 情境:全批省同樣的 key → 只有一組(現行單批 byte 等價)', () => {
    const rpm = [{ external_id: 'R1' }, { external_id: 'R2' }];
    const groups = groupByKeySignature(rpm);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('🔴 三軸各自變動(description × manuals × video_url)→ 每種 key 組合各自成組、無混批', () => {
    // 這是 2026-08-07 換掉單 key 二分的理由:按 description 二分的話,下面 A/B 會落同一批,
    // B 的 manuals 就被 ?columns 聯集 + defaultToNull 寫成 NULL → products.manuals NOT NULL → 23502。
    const rows = [
      { external_id: 'A', description: 'd', manuals: [], video_url: null },
      { external_id: 'B', description: 'd' }, // 來源 pdf/video 皆 null → 兩 key 皆省
      { external_id: 'C', description: 'd', manuals: [] }, // 只有 pdf 有話說
      { external_id: 'D', manuals: [], video_url: null }, // 來源無描述
    ];
    const groups = groupByKeySignature(rows);
    expect(ids(groups)).toEqual([['A'], ['B'], ['C'], ['D']]);
    // 每組內 key 集合必一致(= 該批 ?columns 恰等於組內 key,省 key 欄不進 ON CONFLICT DO UPDATE)
    for (const g of groups) {
      const sigs = new Set(g.map((r) => Object.keys(r).sort().join(' ')));
      expect(sigs.size).toBe(1);
    }
  });

  it('key 集合相同但**宣告順序**不同 → 同一組(?columns 是集合、與順序無關)', () => {
    const rows = [
      { external_id: 'A', description: 'x', manuals: [] },
      { manuals: [], external_id: 'B', description: 'y' },
    ];
    expect(ids(groupByKeySignature(rows))).toEqual([['A', 'B']]);
  });

  it('顯式帶 undefined ≠ 省 key(Object.keys 語意:key 存在即算「有」)', () => {
    // transform 是「省 key」而非「帶 undefined」;此測釘死語意、防未來改成帶 undefined 靜默破功
    // (帶 undefined 的 key 仍會進 ?columns → 仍被寫 NULL,分錯組=防護失效)
    const groups = groupByKeySignature([{ description: undefined }, {}]);
    expect(groups).toHaveLength(2);
  });

  it('不吃原型鏈成員(Object.keys own-only、非 `in`)', () => {
    const inherited = Object.create({ description: 'inherited' }) as { description?: string };
    const plain = {};
    // 繼承的 description 不算 own key → 與空物件同組(postgrest 送出的也只有 own key)
    expect(groupByKeySignature([inherited, plain])).toHaveLength(1);
  });

  it('空輸入 → 空陣列(呼叫端 for-of 自然不跑、不送空 upsert)', () => {
    expect(groupByKeySignature([])).toEqual([]);
  });
});

describe('syncVariantGroupAtomic(hazard group → 單一 RPC)', () => {
  type SyncVariantGroupAtomic = (
    client: SupabaseClient,
    supplierSlug: string,
    externalId: string,
    variants: VariantRow[],
    orphanSkus: string[],
  ) => Promise<number>;
  const syncVariantGroupAtomic = (rpmLoad as unknown as { syncVariantGroupAtomic?: SyncVariantGroupAtomic })
    .syncVariantGroupAtomic;

  const variant: VariantRow = {
    supplier_slug: 'eazigrip',
    sku: 'HOSEYAM005',
    spec: { color: '黑色' },
    price_general: 1000,
    price_store: null,
    availability: 'in-stock',
    images: [],
    sort_order: 0,
    metadata: {},
    updated_at: '2026-07-27T00:00:00.000Z',
  };

  it('提供 atomic RPC helper，避免呼叫端拆成多個 request', () => {
    expect(typeof (rpmLoad as Record<string, unknown>).syncVariantGroupAtomic).toBe('function');
  });

  it('只送 supplier/external_id/完整 variants/orphans，不把 product_id 當可信輸入', async () => {
    expect(syncVariantGroupAtomic).toBeTypeOf('function');
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: 1, error: null });
      },
    } as unknown as SupabaseClient;

    await syncVariantGroupAtomic!(client, 'eazigrip', 'HOSEYAM005', [variant], ['OLD-SKU']);

    expect(calls).toEqual([
      {
        fn: 'sync_product_variant_group',
        args: {
          p_supplier_slug: 'eazigrip',
          p_external_id: 'HOSEYAM005',
          p_variants: [
            {
              sku: 'HOSEYAM005',
              spec: { color: '黑色' },
              price_general: 1000,
              price_store: null,
              availability: 'in-stock',
              images: [],
              sort_order: 0,
              metadata: {},
              updated_at: '2026-07-27T00:00:00.000Z',
            },
          ],
          p_orphan_skus: ['OLD-SKU'],
        },
      },
    ]);
  });

  it('RPC error 會拋出並帶群識別，supplier job 可回傳失敗', async () => {
    expect(syncVariantGroupAtomic).toBeTypeOf('function');
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'rollback' } }),
    } as unknown as SupabaseClient;

    await expect(
      syncVariantGroupAtomic!(client, 'eazigrip', 'HOSEYAM005', [variant], []),
    ).rejects.toThrow(/HOSEYAM005.*rollback/);
  });
});

describe('splitVariantSyncWork(hazard 群不得再進一般 delete/upsert)', () => {
  type SplitVariantSyncWork = (
    variantsByExternalId: Map<string, VariantRow[]>,
    orphans: { sku: string; externalId: string }[],
    hazardExternalIds: Set<string>,
  ) => {
    regularVariants: VariantRow[];
    regularOrphanSkus: string[];
    atomicGroups: { externalId: string; variants: VariantRow[]; orphanSkus: string[] }[];
  };
  const splitVariantSyncWork = (rpmLoad as unknown as { splitVariantSyncWork?: SplitVariantSyncWork })
    .splitVariantSyncWork;
  const makeVariant = (sku: string): VariantRow => ({
    supplier_slug: 'eazigrip',
    sku,
    spec: { color: sku },
    price_general: 1000,
    price_store: null,
    availability: 'in-stock',
    images: [],
    sort_order: 0,
    metadata: {},
    updated_at: '2026-07-27T00:00:00.000Z',
  });

  it('hazard 群完整移入 atomicGroups；一般路徑看不到該群變體與孤兒', () => {
    expect(splitVariantSyncWork).toBeTypeOf('function');
    const hose = [makeVariant('HOSEYAM005'), makeVariant('HOSEYAM005BL')];
    const normal = [makeVariant('NORMAL-A')];
    const work = splitVariantSyncWork!(
      new Map([
        ['HOSEYAM005', hose],
        ['NORMAL', normal],
      ]),
      [
        { sku: 'HOSE-OLD', externalId: 'HOSEYAM005' },
        { sku: 'NORMAL-OLD', externalId: 'NORMAL' },
      ],
      new Set(['HOSEYAM005']),
    );

    expect(work.regularVariants.map((v) => v.sku)).toEqual(['NORMAL-A']);
    expect(work.regularOrphanSkus).toEqual(['NORMAL-OLD']);
    expect(work.atomicGroups).toEqual([
      { externalId: 'HOSEYAM005', variants: hose, orphanSkus: ['HOSE-OLD'] },
    ]);
  });

  it('hazard external_id 不在本次完整 source 群 → fail-closed', () => {
    expect(splitVariantSyncWork).toBeTypeOf('function');
    expect(() => splitVariantSyncWork!(new Map(), [], new Set(['MISSING']))).toThrow(/MISSING/);
  });
});
