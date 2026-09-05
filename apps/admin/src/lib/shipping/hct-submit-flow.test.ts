import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideSubmit, runHctSubmit } from './hct-submit-flow';
import { buildHctTransData } from './hct-trans-data';
import type { HctClientDeps } from './hct-client';

// hct-submit-flow.test.ts — ⟦ship-HCTAPI⟧ 片 C-2 的守門。
//
// 🛑 **本檔一發真的請求都沒打, 也一個 DB 都沒碰** —— `fetchImpl` 注入、流程不寫庫。
// 🔴 **而它守的核心只有一句**:
//    **`unknown` 的箱【絕不】直接重送 —— 先查, 查無就停下來給人看。**
//    而那一句在**兩層**各有一道(TS 這層省一次來回、DB 那層不可繞過),
//    ⇒ 📌 本檔驗的是 TS 那一層, **而 DB 那一層由 C-1 的十格實跑驗過。**

const FIELDS = buildHctTransData({
  displayId: 'PCM-2026-0001',
  recipient: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  itemCount: 1,
}).fields;

function fakeFetch(res: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = ((url: string | URL | Request) => {
    calls.push(String(url));
    return Promise.resolve(res());
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (b: unknown, status = 200): Response =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const deps = (f: typeof fetch): HctClientDeps => ({
  fetchImpl: f,
  endpoint: 'https://example.invalid/x',
  account: 'acct',
  password: 'pw',
});
const run = (current: Parameters<typeof decideSubmit>[0], f: typeof fetch) =>
  runHctSubmit({ deps: deps(f), current, fields: FIELDS, epino: 'PCM-2026-0001' });

afterEach(() => vi.unstubAllEnvs());
function openGates() {
  vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
  vi.stubEnv('HCT_QUERY_ENABLED', 'true');
}

describe('⟦ship-HCTAPI⟧ 片 C-2 · decideSubmit —— 四個狀態, 三種決定', () => {
  it('🔵 draft / failed ⇒ 可以送', () => {
    expect(decideSubmit('draft').action).toBe('submit');
    // 🔴 failed 是三態裡【唯一】安全可重試的 —— 它明確被拒, 那張單沒有進去。
    expect(decideSubmit('failed').action).toBe('submit');
  });

  it('🔴 unknown ⇒ query_first, 而【不是】submit', () => {
    const d = decideSubmit('unknown');
    expect(d.action, 'unknown 直接重送 ⇒ 用一個我們沒有的知識做一個不可回收的動作').toBe(
      'query_first',
    );
  });

  it('🔴 submitted ⇒ 拒, 而理由要說得出「重送在新竹那端是更正」', () => {
    const d = decideSubmit('submitted');
    expect(d.action).toBe('refuse');
    // 🔴 承重:一個只回 refuse 而不說理由的實作, 會讓員工以為是系統壞了而去找別的路。
    expect((d as { reason: string }).reason).toContain('更正');
  });
});

describe('⟦ship-HCTAPI⟧ 片 C-2 · unknown 那條路 —— 先查, 而查無【停下來】', () => {
  it('🔴 unknown + 查到貨號 ⇒ recovered(補記一個已經發生的事實, 不是重送)', async () => {
    openGates();
    const f = fakeFetch(() => json([{ success: 'Y', edelno: '9990001234' }]));
    const r = await run('unknown', f.impl);
    expect(r).toMatchObject({ kind: 'recovered', requestId: '9990001234' });
    // 🔴🔴 承重:只打了【一發】—— 那一發是查, 不是送。
    //    少了這一行, 一個「先查再照送」的實作會通過上面那格, 而它會在新竹那邊建第二張單。
    expect(f.calls.length, '查完又送出去了 ⇒ 那正是這一片在防的事').toBe(1);
  });

  it('🔴 unknown + 查無 ⇒ needs_human, 而【一發送出都沒有】', async () => {
    openGates();
    const f = fakeFetch(() => json([{ success: 'N' }]));
    const r = await run('unknown', f.impl);
    expect(r.kind).toBe('needs_human');
    expect((r as { reason: string }).reason, '訊息要說出「查無有兩個世界」').toContain('兩個世界');
    expect(f.calls.length, '查無之後又送了一發 ⇒ 可能建出第二張單').toBe(1);
  });

  it('🔴 unknown + 查詢本身也失敗 ⇒ 仍然 needs_human(不是回頭去送)', async () => {
    openGates();
    const f = fakeFetch(() => json({}, 500));
    const r = await run('unknown', f.impl);
    expect(r.kind).toBe('needs_human');
    expect(f.calls.length).toBe(1);
  });
});

describe('⟦ship-HCTAPI⟧ 片 C-2 · 送出那條路 —— 三態各自落到對的欄位', () => {
  it('🔵 draft + 新竹回 Y ⇒ recorded/submitted 帶貨號', async () => {
    openGates();
    const f = fakeFetch(() => json([{ success: 'Y', edelno: '1234567890' }]));
    expect(await run('draft', f.impl)).toMatchObject({
      kind: 'recorded',
      status: 'submitted',
      requestId: '1234567890',
    });
  });

  it('🔵 draft + 新竹回 N ⇒ recorded/failed, 而 raw 留著新竹說了什麼', async () => {
    openGates();
    const body = [{ success: 'N', ErrMsg: '公司名稱或密碼錯誤' }];
    const f = fakeFetch(() => json(body));
    const r = await run('draft', f.impl);
    expect(r).toMatchObject({ kind: 'recorded', status: 'failed', requestId: null });
    expect(r).toMatchObject({ raw: body });
  });

  /**
   * 🔴🔴 **這一格是整片的承重。**
   * 逾時 / 斷線 / 5xx ⇒ 必須是 `unknown`, **絕不是 `failed`** ——
   * 因為 `failed` 會讓下一個人重送, 而重送在新竹那端是【更正】,
   * 而更正要帶一個我們**沒有**的貨號。
   */
  it.each([
    ['網路炸掉', () => { throw new Error('boom'); }],
    ['HTTP 500', () => json({}, 500)],
    ['body 不是 JSON', () => new Response('<html>', { status: 200 })],
  ])('🔴 draft + %s ⇒ recorded/unknown(不是 failed)', async (_n, make) => {
    openGates();
    const f = fakeFetch(make as () => Response);
    const r = await run('draft', f.impl);
    expect((r as { status: string }).status, '回 failed 會引導出一個破壞性動作').toBe('unknown');
  });
});

describe('⟦ship-HCTAPI⟧ 片 C-2 · 閘關著 ⇒ 一發請求都沒有', () => {
  it('🔴 未設 env ⇒ disabled, 而 calls 是空的', async () => {
    const f = fakeFetch(() => json({}));
    expect(await run('draft', f.impl)).toEqual({ kind: 'disabled' });
    expect(f.calls, '閘關著而請求已經送出去了 ⇒ 對外不可回收').toEqual([]);
  });

  it('🔴 unknown 那條路也吃閘 —— 只開送出、沒開查詢 ⇒ disabled', async () => {
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
    const f = fakeFetch(() => json({}));
    expect(await run('unknown', f.impl)).toEqual({ kind: 'disabled' });
    expect(f.calls, '唯讀與送出是兩個授權 —— 開了送出不等於可以查').toEqual([]);
  });

  it('🔵 負對照:submitted ⇒ refused, 而它【不看閘】(那是我們自己的規則)', async () => {
    const f = fakeFetch(() => json({}));
    const r = await run('submitted', f.impl);
    expect(r.kind, '已送成功的箱應該在我們這邊就被擋, 不必問新竹').toBe('refused');
    expect(f.calls).toEqual([]);
  });
});
