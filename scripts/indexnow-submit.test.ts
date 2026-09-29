// scripts/indexnow-submit.ts —— 每日同步後通知 IndexNow(計畫 ~/pcm-mailbox/計畫-IndexNow-20260929.md, Fable R2 PASS)。
import { describe, expect, it, vi } from 'vitest';
import {
  BATCH_SIZE,
  buildUrls,
  chunk,
  collectHandles,
  fetchAllPages,
  isValidKey,
  LARGE_BATCH_WARN,
  productIdsFromAuditTargets,
  submitBatch,
  summarize,
} from './indexnow-submit';

describe('組網址', () => {
  it('只用 www、去重、跳過空 handle', () => {
    expect(buildUrls(['a', 'b', 'a', '', '  '], 'https://www.pcmmotorsports.com')).toEqual([
      'https://www.pcmmotorsports.com/products/a',
      'https://www.pcmmotorsports.com/products/b',
    ]);
  });

  it('handle 含特殊字元 ⇒ 編碼成合法網址', () => {
    expect(buildUrls(['cncracing-kv394_ti_03', 'a b'], 'https://www.pcmmotorsports.com')).toEqual([
      'https://www.pcmmotorsports.com/products/cncracing-kv394_ti_03',
      'https://www.pcmmotorsports.com/products/a%20b',
    ]);
  });
});

describe('分批', () => {
  it('每批最多 10,000 筆(IndexNow 單次上限)', () => {
    const urls = Array.from({ length: 25_001 }, (_, i) => `u${i}`);
    expect(chunk(urls, BATCH_SIZE).map((c) => c.length)).toEqual([10_000, 10_000, 5_001]);
  });
});

describe('分頁撈(R1 必修 1:PostgREST 一次最多回 2000 列)', () => {
  it('一頁撈滿就繼續撈, 直到不滿一頁為止, 2000 列以上不漏', async () => {
    const all = Array.from({ length: 2_345 }, (_, i) => ({ id: i }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }));
    const rows = await fetchAllPages(fetchPage);
    expect(rows).toHaveLength(2_345);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 1000, 2000]);
  });

  it('🔵 任一頁出錯 ⇒ 丟出錯誤(不是靜靜回傳一半)', async () => {
    const fetchPage = async (from: number) =>
      from === 0 ? { data: Array.from({ length: 1000 }, () => ({})), error: null } : { data: null, error: { message: 'boom' } };
    await expect(fetchAllPages(fetchPage)).rejects.toThrow('boom');
  });
});

describe('稽核紀錄的 target(R2 nit:格式是 product:<uuid>)', () => {
  it('去掉 product: 前綴, 其他種類的 target 不收', () => {
    expect(
      productIdsFromAuditTargets(['product:11111111-1111-1111-1111-111111111111', 'order:x', 'product:', null, 'product:22222222-2222-2222-2222-222222222222']),
    ).toEqual(['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']);
  });
});

describe('金鑰格式', () => {
  it('8–128 字元、英數與連字號', () => {
    expect(isValidKey('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidKey('short')).toBe(false);
    expect(isValidKey('has space in key')).toBe(false);
    expect(isValidKey(undefined)).toBe(false);
  });
});

describe('送出一批', () => {
  const args = { host: 'www.pcmmotorsports.com', key: 'k'.repeat(32), keyLocation: 'https://www.pcmmotorsports.com/indexnow-key.txt' };

  it('POST JSON 到 api.indexnow.org, 200 / 202 算成功', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const r = await submitBatch(['https://www.pcmmotorsports.com/products/a'], args, fetchImpl);
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(String(init.body))).toEqual({ ...args, urlList: ['https://www.pcmmotorsports.com/products/a'] });
  });

  it('🔵 403 / 422 / 429 ⇒ 失敗, 帶狀態碼', async () => {
    for (const status of [403, 422, 429]) {
      const r = await submitBatch(['x'], args, async () => new Response(null, { status }));
      expect(r).toEqual({ ok: false, status });
    }
  });

  it('🔵 網路錯誤 ⇒ 失敗, 狀態碼 0, 不丟例外', async () => {
    const r = await submitBatch(['x'], args, async () => {
      throw new Error('ECONNRESET');
    });
    expect(r).toEqual({ ok: false, status: 0 });
  });
});

describe('結果訊息(R1 建議 6、7;R2 nit:::warning:: 要單行)', () => {
  it('全部成功 ⇒ 沒有警告', () => {
    expect(summarize({ urls: 120, results: [{ ok: true, status: 202 }] }).warnings).toEqual([]);
  });

  it('有一批失敗 ⇒ 一行 ::warning::, 寫狀態碼與明天會再送', () => {
    const { warnings } = summarize({ urls: 120, results: [{ ok: false, status: 403 }] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^::warning::IndexNow 送出失敗/);
    expect(warnings[0]).toContain('403');
    expect(warnings[0]).toContain('48 小時');
    expect(warnings[0]).not.toContain('\n');
  });

  it(`件數超過 ${LARGE_BATCH_WARN} ⇒ 照送, 但多一行警告`, () => {
    const { warnings } = summarize({ urls: LARGE_BATCH_WARN + 1, results: [{ ok: true, status: 200 }] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^::warning::/);
    expect(warnings[0]).not.toContain('\n');
  });
});

describe('三組查詢的條件(計畫驗收:48 小時窗)', () => {
  /** 假的 PostgREST 鏈:記下每一條查詢用了哪些過濾;range() 與 await(.in 那條)回傳指定的列。 */
  function fakeDb(rows: { changed?: object[]; delisted?: object[]; audit?: object[]; relisted?: object[] }) {
    const calls: string[] = [];
    const from = (table: string) => {
      const ops: string[] = [table];
      const q: Record<string, unknown> = {};
      for (const op of ['select', 'is', 'gte', 'eq', 'order', 'in']) {
        q[op] = (...a: unknown[]) => {
          ops.push(`${op}(${a.map((x) => JSON.stringify(x)).join(',')})`);
          return q;
        };
      }
      const pick = () => {
        const s = ops.join(' ');
        calls.push(s);
        if (s.startsWith('admin_audit_log')) return rows.audit ?? [];
        if (s.includes('in("id"')) return rows.relisted ?? [];
        if (s.includes('content_changed_at')) return rows.changed ?? [];
        return rows.delisted ?? [];
      };
      q.range = async () => ({ data: pick(), error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: pick(), error: null });
      return q;
    };
    return { db: { from } as never, calls };
  }

  it('三組都用同一個起點:上架中且內容有變 / 下架 / 上下架稽核紀錄(去掉 product: 前綴再查 handle)', async () => {
    const since = '2026-09-27T00:00:00.000Z';
    const { db, calls } = fakeDb({
      changed: [{ handle: 'changed-1' }],
      audit: [{ target: 'product:11111111-1111-1111-1111-111111111111' }],
      relisted: [{ handle: 'relisted-1' }],
    });
    const handles = await collectHandles(db, since);
    expect(calls[0]).toContain('is("delisted_at",null)');
    expect(calls[0]).toContain(`gte("content_changed_at","${since}")`);
    expect(calls[1]).toContain('select("handle, delisted_at, created_at")');
    expect(calls[1]).toContain(`gte("delisted_at","${since}")`);
    expect(calls[2]).toContain('eq("action","product.listing.change")');
    expect(calls[2]).toContain(`gte("created_at","${since}")`);
    expect(calls[3]).toContain('in("id",["11111111-1111-1111-1111-111111111111"])');
    expect(handles).toEqual(['changed-1', 'relisted-1']);
  });

  it('🔵 下架時間等於建立時間(後台手動建立、從未公開)⇒ 不送;晚於建立時間 ⇒ 送', async () => {
    const t = '2026-09-28T10:00:00.000Z';
    const { db } = fakeDb({
      delisted: [
        { handle: 'never-public', delisted_at: t, created_at: t },
        { handle: 'was-public', delisted_at: '2026-09-28T12:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(await collectHandles(db, 'x')).toEqual(['was-public']);
  });
});
