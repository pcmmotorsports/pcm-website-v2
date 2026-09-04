// @vitest-environment node
//
// search-log 守門 — **這支的失敗不得弄壞搜尋, 而它也不得安靜地什麼都沒記。**
//
// 🔴 plan v5 §6 列了三個「六格全綠而語料永久為零」的世界。本檔顧得到其中一個
//    (**RPC 名/參數與 migration 對不上**);另外兩個(anon 的 EXECUTE 被收掉 · `after()`
//    在 Vercel 沒執行)**沒有任何測試顧得到** —— 它們要一格線上告警, 板列 `⟦search-LOGSILENTZERO⟧`。
//    ⇒ 📌 **寫出來, 不要讓本檔全綠被讀成「這條路有人在看」。**

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const afterMock = vi.fn();
vi.mock('next/server', () => ({ after: (cb: () => unknown) => afterMock(cb) }));

const rpc = vi.fn();
// 🔴 mock 的**路徑要與被測檔 import 的那個一模一樣** —— 打錯了它照樣「全綠」,
//    因為 `vi.mock` 一個沒人 import 的模組**不會報錯**, 而真正的模組會被載入。
//    ⇒ 下面最後一格用 `readFileSync` 讀被測檔的字面, 把這兩邊釘在一起。
vi.mock('@pcm/adapters', () => ({ createSupabaseAnonClient: () => ({ rpc }) }));

const { logSearchQuery } = await import('./search-log');

beforeEach(() => {
  afterMock.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

/** 把 `after()` 收到的那個 callback 真的跑一遍 —— 否則本檔驗不到背景那半。 */
async function runAfter(): Promise<void> {
  const cb = afterMock.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
  if (cb) await cb();
}

describe('logSearchQuery', () => {
  it('🔴 一般情況:排進 after(), 而背景那發帶著對的參數名去叫 RPC', async () => {
    logSearchQuery({ query: '排氣管', path: 'keyword', resultCount: 7 });
    expect(afterMock).toHaveBeenCalledTimes(1);
    await runAfter();
    expect(rpc).toHaveBeenCalledWith('log_search_query', {
      p_query_raw: '排氣管',
      p_path: 'keyword',
      p_unmatched: null,
      p_result_count: 7,
    });
  });

  it('🔴 空字串 / 純空白 ⇒ 一發都不送(DB 那邊有 CHECK, 送過去只會換來一次被吞掉的失敗)', () => {
    logSearchQuery({ query: '', path: 'keyword' });
    logSearchQuery({ query: '   ', path: 'keyword' });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it('🔴 after() 自己 throw(不在請求作用域)⇒ 不得往外丟, 而【要留痕】', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    afterMock.mockImplementation(() => {
      throw new Error('no request scope');
    });
    expect(() => logSearchQuery({ query: '排氣管', path: 'keyword' })).not.toThrow();
    // 🛑 「不 throw」與「留了痕」是兩個宣稱 —— 只驗前者的話, 一個 `catch {}` 也會過。
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 RPC 回 error ⇒ 不得往外丟, 而要留痕', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ error: { message: 'permission denied' } });
    logSearchQuery({ query: '排氣管', path: 'keyword' });
    await expect(runAfter()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 RPC 直接 throw ⇒ 同上', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValue(new Error('boom'));
    logSearchQuery({ query: '排氣管', path: 'keyword' });
    await expect(runAfter()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 **這一格顧的是 plan §6 的第一個安靜世界:TS 送的參數名與 migration 對不上**
  //    兩邊各自完全正常、三綠全綠, 而**每一發都被 PostgREST 拒絕、語料永遠是零**。
  //    ⇒ 它把兩個檔案綁在一起 —— 改任一邊而沒改另一邊, 這一格紅。
  // ══════════════════════════════════════════════════════════════════════
  it('🔴 送出去的參數名, 必須逐字等於 migration 裡那支函式的參數名', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      new URL('../../../../supabase/migrations/20260904200000_m4b_search_queries_log.sql', import.meta.url),
      'utf8',
    );
    const decl = sql.slice(
      sql.indexOf('CREATE FUNCTION public.log_search_query('),
      sql.indexOf(') RETURNS void'),
    );
    // 🔵 正對照:抓不到宣告的話下面會拿到空陣列, 而空陣列與「兩邊剛好都空」印同一個綠。
    expect(decl.length, 'migration 裡找不到 log_search_query 的宣告 ⇒ 這一格沒有判別力').toBeGreaterThan(50);
    const sqlParams = [...decl.matchAll(/\bp_[a-z_]+/g)].map((m) => m[0]).sort();
    expect(sqlParams.length).toBe(4);

    logSearchQuery({ query: '排氣管', path: 'keyword' });
    await runAfter();
    const sentFn = rpc.mock.calls[0]![0] as string;
    const sentParams = Object.keys(rpc.mock.calls[0]![1] as Record<string, unknown>).sort();
    expect(sentParams, `TS 送 ${sentParams.join(',')} 而 SQL 收 ${sqlParams.join(',')}`).toEqual(sqlParams);
    expect(sql, 'TS 叫的函式名不在 migration 裡').toContain(`public.${sentFn}(`);
  });

  // 🔴🔴 **把 mock 的路徑與被測檔 import 的路徑釘在一起。**
  //    `vi.mock('打錯的路徑')` **不會報錯** ⇒ 真正的模組會被載入,
  //    而它 `import 'server-only'` + 讀 env ⇒ 這一支的失敗會長成別的樣子(或剛好還是綠)。
  //    🔬 而這一格不是假想的:本片第一版 import 的是 barrel `@pcm/adapters`,
  //       而 barrel **沒有 export 這支** ⇒ **vitest 全綠、typecheck 紅、build 紅**。
  it('🔴 mock 的模組路徑必須就是被測檔 import 的那一個', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./search-log.ts', import.meta.url), 'utf8');
    const self = readFileSync(new URL('./search-log.test.ts', import.meta.url), 'utf8');
    const imported = /import \{ createSupabaseAnonClient \} from '([^']+)'/.exec(src)?.[1];
    expect(imported, '被測檔沒有 import createSupabaseAnonClient ⇒ 這一格沒有判別力').toBeTruthy();
    expect(
      self.includes(`vi.mock('${imported}'`),
      `被測檔 import 的是 ${imported}, 而本檔 mock 的不是同一個 ⇒ 上面每一格都在測【沒被 mock 的真模組】`,
    ).toBe(true);
  });
});
