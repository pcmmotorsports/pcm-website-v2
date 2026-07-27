// rpm-load.test.ts — #260 partitionByKeyPresence(保留現值:省 key 列不被混批寫 NULL)
//
// 背景:postgrest-js `.upsert(陣列)` 的 `?columns` 取全批 key 聯集 + defaultToNull=true →
//   同批混「有 description / 省 description key」→ 省 key 列被寫 NULL(非保留現值)。
//   partitionByKeyPresence 把兩者分兩 uniform 批,呼叫端各自 upsert → 省 key 落「該批 columns 不含此 key」批 → 保留現值。

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VariantRow } from './rpm-transform';
import * as rpmLoad from './rpm-load';
import { partitionByKeyPresence } from './rpm-load';

describe('#260 partitionByKeyPresence(description key-signature 分批)', () => {
  it('混批 → 分「有 key」與「省 key」兩組(依原順序)', () => {
    const rows = [
      { external_id: 'A', description: 'x' },
      { external_id: 'B' }, // 省 key
      { external_id: 'C', description: 'y' },
    ];
    const { withKey, withoutKey } = partitionByKeyPresence(rows, 'description');
    expect(withKey.map((r) => r.external_id)).toEqual(['A', 'C']);
    expect(withoutKey.map((r) => r.external_id)).toEqual(['B']);
  });

  it('🔴 rpm 情境:全批省 description → withKey 空(現行單批 byte 等價)', () => {
    const rpm = [{ external_id: 'R1' }, { external_id: 'R2' }];
    const { withKey, withoutKey } = partitionByKeyPresence(rpm, 'description');
    expect(withKey).toEqual([]);
    expect(withoutKey).toHaveLength(2);
  });

  it('全批有 description → withoutKey 空', () => {
    const { withKey, withoutKey } = partitionByKeyPresence([{ description: 'a' }, { description: 'b' }], 'description');
    expect(withKey).toHaveLength(2);
    expect(withoutKey).toEqual([]);
  });

  it('顯式帶 undefined ≠ 省 key(Object.hasOwn 語意:key 存在即算「有」)', () => {
    // transform 是「省 key」而非「帶 undefined」;此測釘死 hasOwn 語意、防未來改成帶 undefined 靜默破功
    const { withKey, withoutKey } = partitionByKeyPresence([{ description: undefined }, {}], 'description');
    expect(withKey).toHaveLength(1); // 顯式 undefined key 算存在
    expect(withoutKey).toHaveLength(1); // 真省 key
  });

  it('不吃原型鏈成員(Object.hasOwn、非 `in`)', () => {
    const row = Object.create({ description: 'inherited' }) as { description?: string };
    const { withKey, withoutKey } = partitionByKeyPresence([row], 'description');
    expect(withKey).toEqual([]); // 繼承的 description 不算 own key
    expect(withoutKey).toHaveLength(1);
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
