import { afterEach, describe, expect, it, vi } from 'vitest';
import { hctMode, queryEdelno, submitTransData, type HctClientDeps } from './hct-client';
import { buildHctTransData } from './hct-trans-data';

// hct-client.test.ts — ⟦ship-HCTAPI⟧ 片 B 的守門。
//
// 🔴🔴 **這一片交付時那條路是【關著】的** ⇒ 而「關著」不是一個 if, 是**四個性質**,
//    所以下面每一個都各有一發突變殺得死它(清單在 plan §4)。
//
// 🛑 **本檔一發真的請求都不打** —— `fetchImpl` 是注入的。
//    ⇒ 而那不只是為了測試方便:📌 **一支會在測試裡打對方端點的 client, 它的測試本身就是一個對外動作。**

const FIELDS = buildHctTransData({
  displayId: 'PCM-2026-0001',
  recipient: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  itemCount: 1,
}).fields;

/** 一支會記錄「被叫了幾次」的假 fetch —— 那個次數是本檔好幾格的承重。 */
function fakeFetch(res: () => Promise<Response> | Response) {
  const calls: string[] = [];
  const impl = ((url: string | URL | Request) => {
    calls.push(String(url));
    return Promise.resolve(res());
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deps(fetchImpl: typeof fetch): HctClientDeps {
  return { fetchImpl, endpoint: 'https://example.invalid/x', account: 'acct', password: 'pw' };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** 把閘打開(測試環境預設 `NODE_ENV=test`,而 gate 只擋 development)。 */
function openGates() {
  vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
  vi.stubEnv('HCT_QUERY_ENABLED', 'true');
}

describe('⟦ship-HCTAPI⟧ 片 B · 那道閘 —— 「關著」是四個性質, 不是一個 if', () => {
  it('🔴 未設 ⇒ disabled, 而【一發請求都沒打】', async () => {
    const f = fakeFetch(() => json({}));
    expect(await submitTransData(deps(f.impl), FIELDS)).toEqual({ kind: 'disabled' });
    // 🔴 承重:少了這一行,「先打出去再判斷要不要用結果」也會通過上一行。
    expect(f.calls, '閘關著而請求已經送出去了 ⇒ 對外不可回收(鐵則 12⑤)').toEqual([]);
  });

  it.each(['false', '1', 'TRUE', 'True', 'yes', ''])(
    '🔴 嚴格 opt-in:值是 %o ⇒ 仍然關著(一個打錯的值不會變成開)',
    async (v) => {
      vi.stubEnv('HCT_SUBMIT_ENABLED', v);
      const f = fakeFetch(() => json({}));
      expect(await submitTransData(deps(f.impl), FIELDS)).toEqual({ kind: 'disabled' });
      expect(f.calls).toEqual([]);
    },
  );

  it('🔴 development 一律當關 —— 就算值是字面 true', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
    const f = fakeFetch(() => json({}));
    expect(
      await submitTransData(deps(f.impl), FIELDS),
      '本機不該有能力送出真的託運單 —— 而這一格不靠「本機剛好沒設值」',
    ).toEqual({ kind: 'disabled' });
    expect(f.calls).toEqual([]);
  });

  it('🔴 兩顆 env 不共用:只開送出 ⇒ 查詢仍然關著(唯讀與送出是兩個授權)', async () => {
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
    const f = fakeFetch(() => json({}));
    expect(await queryEdelno(deps(f.impl), 'PCM-2026-0001')).toEqual({ kind: 'disabled' });
    expect(f.calls, '開了送出就順便可以查 ⇒ 那正是共用一顆 env 的病').toEqual([]);
  });

  it('🔵 負對照:閘開著 ⇒ 真的走完(證明上面那些 disabled 不是因為它永遠失敗)', async () => {
    openGates();
    const f = fakeFetch(() => json([{ success: 'Y', edelno: '1234567890' }]));
    expect(await submitTransData(deps(f.impl), FIELDS)).toMatchObject({
      kind: 'submitted',
      edelno: '1234567890',
    });
    expect(f.calls.length).toBe(1);
  });
});

describe('⟦ship-HCTAPI⟧ 片 B · 第三態 —— 不確定時【絕不】說 failed', () => {
  /**
   * 🔴🔴 **這一族是整片的承重。**
   * `failed` 會讓下一個人**重送**, 而規格第 8 頁逐字「同日重複上傳 ⇒ **視同更正**」
   * ⇒ 🎯 **重送不是重送。** 而更正要帶新竹貨號, 那只有第一次送成功才拿得到。
   */
  it.each([
    ['網路炸掉', () => { throw new Error('boom'); }],
    ['HTTP 500', () => json({}, 500)],
    ['HTTP 200 而 body 不是 JSON', () => new Response('<html>', { status: 200 })],
    ['認不得的 success 值', () => json([{ success: 'Z' }])],
  ])('🔴 %s ⇒ unknown(不是 failed / rejected)', async (_name, make) => {
    openGates();
    const f = fakeFetch(make as () => Response);
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind, '回 failed 會引導出一個破壞性動作(重送 = 更正)').toBe('unknown');
  });

  it('🔵 而【明確的】業務失敗仍然是 rejected —— unknown 不得吃掉它', async () => {
    openGates();
    const f = fakeFetch(() => json([{ success: 'N', ErrMsg: '公司名稱或密碼錯誤' }]));
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind, '把 N 也讀成 unknown ⇒ 一個真的被拒的單會被當成「可能成功」').toBe('rejected');
    expect(out).toMatchObject({ errMsg: '公司名稱或密碼錯誤' });
  });

  it('🔴 raw 整包留著 —— 出錯那一刻它是唯一能回頭看的東西', async () => {
    openGates();
    const body = [{ success: 'N', ErrMsg: '貨號重複', 我們沒解析的欄: '值' }];
    const f = fakeFetch(() => json(body));
    const out = await submitTransData(deps(f.impl), FIELDS);
    // 🔴 承重:規格只有錯誤【文字】沒有數字碼 ⇒ 字串會被對方改, 而 raw 是唯一的退路。
    expect(out).toMatchObject({ raw: body });
  });
});

describe('⟦ship-HCTAPI⟧ 片 B · queryEdelno —— fail-closed', () => {
  it.each(['', '   ', '\t'])('🔴 訂單編號是 %o ⇒ 丟例外, 而【請求沒送出去】', async (bad) => {
    openGates();
    const f = fakeFetch(() => json({}));
    await expect(queryEdelno(deps(f.impl), bad)).rejects.toThrow(/不得為空/);
    expect(f.calls, '空的識別鍵等於問新竹「隨便給我一張單」').toEqual([]);
  });

  it('🔵 正對照:有訂單編號且閘開著 ⇒ 找得到(證明上面那幾格不是因為它永遠丟例外)', async () => {
    openGates();
    const f = fakeFetch(() => json([{ success: 'Y', edelno: '9990001234' }]));
    expect(await queryEdelno(deps(f.impl), 'PCM-2026-0001')).toMatchObject({
      kind: 'found',
      edelno: '9990001234',
    });
  });
});

describe('⟦ship-HCTAPI⟧ 片 B · 打錯環境 —— 網址分不出來, 帳號分得出來', () => {
  it('🔴 帳號是 test ⇒ test 模式;其餘一律 live', () => {
    // 規格第 10 頁逐字給了測試帳密「公司名稱[test] 密碼[test1]」。
    expect(hctMode('test')).toBe('test');
    // 🔴 承重:一個「看起來像測試」的帳號【不是】測試帳號 —— 只有字面 test 是。
    expect(hctMode('test2'), '模糊比對會把一個正式帳號讀成測試 ⇒ 員工以為沒送出去').toBe('live');
    expect(hctMode('TEST')).toBe('live');
    expect(hctMode('pcm-live')).toBe('live');
  });
});
