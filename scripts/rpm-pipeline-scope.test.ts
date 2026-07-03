// rpm-pipeline-scope.test.ts — P0-A-2 供應商 scope 參數化的隔離證明(不變式 1)
//
// 管線每支 helper 都須把呼叫端傳入的 supplierSlug 貫穿成 .eq('supplier_slug', slug),
// 絕不跨供應商合併(否則 A 家的下架/對賬會誤動 B 家)。本測試用 recording mock client
// 攔截 .eq('supplier_slug', …) 呼叫,證明:
//   - 傳 'gbracing' → scope gbracing(參數化真的生效)
//   - 🔴 傳 'rpm' → scope rpm(byte 等價錨點,不變式 3:改多家不動 RPM 現況)
// 不連真 DB(mock resolve 空集合);焦點 = source fetch / active-read / delist-write 三條 scope。

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllSupplierProducts } from './rpm-fetch';
import { computeDelist, applyDelist } from './rpm-reconcile';

/** 可鏈式 recording mock:任何 builder 方法回自身、await 時 resolve {data:[],error:null};
 *  記錄所有 .eq('supplier_slug', X) 呼叫供斷言。 */
function makeRecordingClient(): { client: SupabaseClient; supplierScopes: unknown[] } {
  const supplierScopes: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(onFulfilled);
      }
      return (...args: unknown[]) => {
        if (prop === 'eq' && args[0] === 'supplier_slug') supplierScopes.push(args[1]);
        return builder;
      };
    },
  });
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, supplierScopes };
}

describe('pipeline supplier scope isolation (P0-A-2)', () => {
  it('fetchAllSupplierProducts scopes the source view by the given supplierSlug', async () => {
    const gb = makeRecordingClient();
    await fetchAllSupplierProducts(gb.client, 'gbracing');
    expect(gb.supplierScopes).toContain('gbracing');

    const rpm = makeRecordingClient(); // 🔴 byte 等價錨點
    await fetchAllSupplierProducts(rpm.client, 'rpm');
    expect(rpm.supplierScopes).toEqual(['rpm']);
  });

  it('computeDelist scopes the active-read by the given supplierSlug (不越界對賬)', async () => {
    const gb = makeRecordingClient();
    await computeDelist(gb.client, 'gbracing', new Set(['SEED']));
    expect(gb.supplierScopes).toContain('gbracing');
    expect(gb.supplierScopes).not.toContain('rpm'); // 絕不摻入別家 scope

    const rpm = makeRecordingClient();
    await computeDelist(rpm.client, 'rpm', new Set(['SEED']));
    expect(rpm.supplierScopes).toEqual(['rpm']);
  });

  it('🔴 applyDelist scopes the soft-delete UPDATE by the given supplierSlug (不變式 1 護欄)', async () => {
    const gb = makeRecordingClient();
    await applyDelist(gb.client, 'gbracing', ['EXT-1'], '2026-07-03T00:00:00Z');
    expect(gb.supplierScopes).toEqual(['gbracing']); // 下架只能動自己那家

    const rpm = makeRecordingClient();
    await applyDelist(rpm.client, 'rpm', ['EXT-1'], '2026-07-03T00:00:00Z');
    expect(rpm.supplierScopes).toEqual(['rpm']);
  });
});
