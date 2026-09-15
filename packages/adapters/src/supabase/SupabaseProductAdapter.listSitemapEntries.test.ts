/**
 * SupabaseProductAdapter.listSitemapEntries —— sitemap lastmod 那一支(2026-09-15, migration 20260915220000)。
 *
 * 守三件事:
 *  ① 投影只多 content_changed_at 一欄,不准帶價格欄或重欄位回來
 *  ② content_changed_at 原樣帶出、null 維持 null(不補假日期)
 *  ③ 與 listAllHandles() 對同一批列給出逐字相同的 handle 順序(只多一欄, 不改列集合)
 * 假 client 形狀抄同目錄 `SupabaseProductAdapter.listAllHandles.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseProductAdapter } from './SupabaseProductAdapter';

function makeClient(pageSizes: number[], rowFor: (i: number) => Record<string, unknown>) {
  const selectCalls: string[] = [];
  let idx = 0;
  const t = {
    select(cols: string) {
      selectCalls.push(cols);
      return t;
    },
    order() {
      return t;
    },
    range(from: number) {
      const n = pageSizes[idx] ?? 0;
      idx += 1;
      return Promise.resolve({ data: Array.from({ length: n }, (_, j) => rowFor(from + j)), error: null });
    },
  };
  const client = {
    from(name: string) {
      if (name !== 'products_public') throw new Error(`listSitemapEntries 只該讀 products_public, 收到 ${name}`);
      return t;
    },
  };
  return { client: client as unknown as SupabaseClient, selectCalls };
}

describe('SupabaseProductAdapter.listSitemapEntries', () => {
  it('🔴 投影 = id, handle, content_changed_at —— 價格欄與重欄位一個都不准', async () => {
    const { client, selectCalls } = makeClient([0], () => ({}));
    await new SupabaseProductAdapter(client).listSitemapEntries();
    expect(selectCalls.length, '一次 select 都沒發生 ⇒ 下面的斷言在空集合上恆真').toBeGreaterThan(0);
    for (const cols of selectCalls) {
      expect(cols.replace(/\s/g, '')).toBe('id,handle,content_changed_at');
      for (const banned of ['price', 'images', 'fitments', 'description', 'product_variants_public']) {
        expect(cols).not.toContain(banned);
      }
    }
  });

  it('🔴 content_changed_at 原樣帶出;null 維持 null;順序 = DB 回的順序', async () => {
    const rows = [
      { id: 'id-0', handle: 'b', content_changed_at: '2026-09-01T00:00:00+00:00' },
      { id: 'id-1', handle: 'a', content_changed_at: null },
    ];
    const { client } = makeClient([rows.length], (i) => rows[i]!);
    expect(await new SupabaseProductAdapter(client).listSitemapEntries()).toEqual([
      { handle: 'b', contentChangedAt: '2026-09-01T00:00:00+00:00' },
      { handle: 'a', contentChangedAt: null },
    ]);
  });

  it('🔴 與 listAllHandles() 對同一批列:handle 逐字相同(跨頁)', async () => {
    const pages = [1000, 3];
    const row = (i: number) => ({ id: `id-${String(i).padStart(6, '0')}`, handle: `h-${i}`, content_changed_at: null });
    const a = makeClient([...pages], row);
    const b = makeClient([...pages], row);
    const handles = await new SupabaseProductAdapter(a.client).listAllHandles();
    const entries = await new SupabaseProductAdapter(b.client).listSitemapEntries();
    expect(handles.length, '前提:真的有列(0 的話下面恆真)').toBe(1003);
    expect(entries.map((e) => e.handle)).toEqual(handles);
  });
});
