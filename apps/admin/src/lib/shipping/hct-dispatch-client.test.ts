import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchOrder,
  hctDispatchGateOpen,
  HCT_DISPATCH_MAX_ROWS,
  type HctClientDeps,
} from './hct-client';

// hct-dispatch-client.test.ts — ⟦ship-DISPATCHORDER⟧ 的守門(plan §6①)。
//
// 🛑 **一發真的請求都不打** —— `fetchImpl` 是注入的,而閘另外還要 `HCT_DISPATCH_ENABLED=true`。
//    ⇒ 📌 **兩層** :就算有人把假 fetch 換掉,閘沒開仍然是零 HTTP。
//
// 🔴🔴 **本檔最重要的那一格是「外層形狀不對」** —— plan §5:
//    `TransData_Json` 直接回陣列,而這一支包在 `rtn_data` 裡。
//    照抄會在頂層拿到 `undefined` 而不是錯誤 ⇒ 它會**安靜地判成「沒有一箱成功」**,
//    而那個答案與「真的一箱都沒成功」印出來一模一樣。

const deps = (fetchImpl: typeof fetch): HctClientDeps => ({
  fetchImpl,
  endpoint: 'https://example.invalid/x',
  account: 'acct',
  password: 'pw',
});

function fakeFetch(res: () => Response) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const impl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    bodies.push(String(init?.body ?? ''));
    return Promise.resolve(res());
  }) as unknown as typeof fetch;
  return { impl, calls, bodies };
}

/** 🔴 外層照 V15 §8.2 的範例形狀:`{ rtn_code, rtn_msg, rtn_data:[ … ] }`。 */
const soap = (body: unknown): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TransDispatchOrder_JsonResponse xmlns="http://tempuri.org/"><TransDispatchOrder_JsonResult>${JSON.stringify(body)}</TransDispatchOrder_JsonResult></TransDispatchOrder_JsonResponse></soap:Body></soap:Envelope>`,
    { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  );

const envelope = (rows: unknown, over: Record<string, unknown> = {}) => ({
  rtn_code: 1,
  rtn_msg: '派遣收貨成功建檔',
  rtn_data: rows,
  ...over,
});
const row = (o: Record<string, unknown>) => ({ ErrMsg: '', ...o });

/** 一箱。🔴 V15 §8 p.31:`edelno` 與 `epino` **都是必要欄位** ⇒ 型別上就要求兩個都給。 */
const B = (epino: string, edelno = `894700${epino}`) => ({ epino, edelno });

afterEach(() => {
  vi.unstubAllEnvs();
});
const openGate = () => vi.stubEnv('HCT_DISPATCH_ENABLED', 'true');

describe('⟦ship-DISPATCHORDER⟧ 那道閘 —— 而它【不共用】送單那一顆', () => {
  it('🔴🔴 `HCT_SUBMIT_ENABLED` 開著【不會】把派遣打開', async () => {
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
    vi.stubEnv('HCT_QUERY_ENABLED', 'true');
    const f = fakeFetch(() => soap(envelope([])));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], '派達有限公司')).toEqual({ kind: 'disabled' });
    // 🔴 承重:少了這一行,「先打出去再判斷要不要用結果」也會通過上一行。
    expect(f.calls, '閘關著就不准有任何一發 HTTP').toEqual([]);
    expect(hctDispatchGateOpen()).toBe(false);
  });

  it('🔴 只認字面 `true`;而 development 一律當關, 不看值', async () => {
    for (const v of ['1', 'TRUE', 'True', 'false', 'yes', '']) {
      vi.stubEnv('HCT_DISPATCH_ENABLED', v);
      expect(hctDispatchGateOpen(), `值 ${JSON.stringify(v)} 不該開`).toBe(false);
    }
    vi.stubEnv('NODE_ENV', 'development');
    openGate();
    const f = fakeFetch(() => soap(envelope([])));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], 'x')).toEqual({ kind: 'disabled' });
    expect(f.calls).toEqual([]);
  });
});

describe('⟦ship-DISPATCHORDER⟧ 逐箱各自結算', () => {
  it('🟢 全成功 ⇒ 每一箱各自帶回自己的貨號, 而順序與送出去的一樣', async () => {
    openGate();
    const f = fakeFetch(() =>
      soap(envelope([
        row({ epino: 'E1', success: 'Y', edelno: '8947081964' }),
        row({ epino: 'E2', success: 'Y', edelno: '8947081965' }),
      ])),
    );
    // 🔵 送出去的貨號要與回應一致 —— 不一致是 `edelno_mismatch` 那一格在管的事。
    const out = await dispatchOrder(deps(f.impl), [B('E1', '8947081964'), B('E2', '8947081965')], '派達有限公司');
    expect(out).toMatchObject({
      kind: 'answered',
      rows: [
        { kind: 'dispatched', epino: 'E1', edelno: '8947081964' },
        { kind: 'dispatched', epino: 'E2', edelno: '8947081965' },
      ],
    });
  });

  it('🔴🔴 **部分成功** —— 一箱成功一箱失敗 ⇒ 兩箱【各自】有結果, 不是一個是非題', async () => {
    openGate();
    const f = fakeFetch(() =>
      soap(envelope([
        row({ epino: 'E1', success: 'Y', edelno: '8947081964' }),
        row({ epino: 'E2', success: 'N', ErrMsg: '查無此筆託運單' }),
      ])),
    );
    const out = await dispatchOrder(deps(f.impl), [B('E1', '8947081964'), B('E2')], 'x');
    expect(out).toMatchObject({
      kind: 'answered',
      rows: [
        { kind: 'dispatched', epino: 'E1' },
        { kind: 'rejected', epino: 'E2', errMsg: '查無此筆託運單' },
      ],
    });
  });

  it('🔴 全失敗 ⇒ 仍然是 `answered`(我們【看懂了】那個回答), 每一箱 rejected', async () => {
    openGate();
    const f = fakeFetch(() =>
      soap(envelope([row({ epino: 'E1', success: 'N', ErrMsg: '超過 30 天' })])),
    );
    const out = await dispatchOrder(deps(f.impl), [B('E1')], 'x');
    // 🔴 承重:全失敗與「看不懂」是兩件事。混在一起 ⇒ 員工分不出「新竹拒絕」與「我們包錯」。
    expect(out).toMatchObject({ kind: 'answered', rows: [{ kind: 'rejected', errMsg: '超過 30 天' }] });
  });

  it('🔴 `success=Y` 而【沒有貨號】⇒ unknown, 不當成功 —— 車可能已經在路上了', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: 'E1', success: 'Y', edelno: '' })])));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], 'x')).toMatchObject({
      kind: 'answered',
      rows: [{ kind: 'unknown', epino: 'E1', reason: 'unrecognised_success_Y' }],
    });
  });

  it('🔴 回錯箱(`epino` 對不上)⇒ 那一箱 unknown —— 別人的成功不記在我們頭上', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: '別人的單', success: 'Y', edelno: '9' })])));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], 'x')).toMatchObject({
      rows: [{ kind: 'unknown', epino: 'E1', reason: 'epino_mismatch' }],
    });
  });
});

describe('⟦ship-DISPATCHORDER⟧ 身分 —— 位置【不是】身分(codex R1 must-fix 二)', () => {
  it('🔴🔴 回應缺 `epino` 而 `Num` 顛倒 ⇒ 兩箱都 unknown —— B 的成功不准記在 A 頭上', async () => {
    openGate();
    // 這就是 codex 重現出來的那一包:B 先回、A 後回, 而兩列都沒有 epino。
    const f = fakeFetch(() =>
      soap(envelope([
        row({ Num: '2', success: 'Y', edelno: '2222222222' }),
        row({ Num: '1', success: 'N', ErrMsg: 'A rejected' }),
      ])),
    );
    const out = await dispatchOrder(deps(f.impl), [B('A'), B('B')], 'x');
    // 🔴 承重:舊版會回 A→dispatched(拿 B 的貨號)、B→rejected(拿 A 的理由)。
    expect(out).toMatchObject({
      kind: 'answered',
      rows: [
        { kind: 'unknown', epino: 'A', reason: 'num_mismatch_2' },
        { kind: 'unknown', epino: 'B', reason: 'num_mismatch_1' },
      ],
    });
  });

  it('🔴🔴 **兩把識別鍵都沒有 ⇒ unknown** —— 不確定是誰就不准判成敗', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ success: 'Y', edelno: '9999999999' })])));
    expect(await dispatchOrder(deps(f.impl), [B('A')], 'x')).toMatchObject({
      rows: [{ kind: 'unknown', epino: 'A', reason: 'unidentifiable_row' }],
    });
  });

  it('🔵 `Num` 對得上 ⇒ 認;而大小寫兩種都要收(§8.2 寫 `Num`, §8.3 範例印 `num`)', async () => {
    openGate();
    for (const key of ['Num', 'num']) {
      const f = fakeFetch(() => soap(envelope([row({ [key]: '1', success: 'Y', edelno: '8947081964' })])));
      expect(await dispatchOrder(deps(f.impl), [B('A', '8947081964')], 'x'), key).toMatchObject({
        rows: [{ kind: 'dispatched', epino: 'A', edelno: '8947081964' }],
      });
    }
  });
});

describe('⟦ship-DISPATCHORDER⟧ 回來的貨號要對得上(codex R2 must-fix)', () => {
  it('🔴🔴 **A 的位置回了 B 的貨號 ⇒ A 是 unknown, 不准標出貨**', async () => {
    openGate();
    const f = fakeFetch(() =>
      soap(envelope([
        row({ epino: 'AAAAAA', success: 'Y', edelno: '2222222222' }),
        row({ epino: 'BBBBBB', success: 'Y', edelno: '2222222222' }),
      ])),
    );
    const out = await dispatchOrder(
      deps(f.impl),
      [{ epino: 'AAAAAA', edelno: '1111111111' }, { epino: 'BBBBBB', edelno: '2222222222' }],
      'x',
    );
    // 🔴 承重:舊版會回 A→dispatched 而 edelno 是 B 的 ⇒ 出貨信印別人的單號。
    expect(out).toMatchObject({
      kind: 'answered',
      rows: [
        { kind: 'unknown', epino: 'AAAAAA', reason: 'edelno_mismatch' },
        { kind: 'dispatched', epino: 'BBBBBB', edelno: '2222222222' },
      ],
    });
  });

  it('🔴 靠 `Num` 認的那條路也要比貨號 —— 兩條路不能只擋一條', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ Num: '1', success: 'Y', edelno: '9999999999' })])));
    expect(await dispatchOrder(deps(f.impl), [{ epino: 'A', edelno: '1111111111' }], 'x')).toMatchObject({
      rows: [{ kind: 'unknown', epino: 'A', reason: 'edelno_mismatch' }],
    });
  });

  it('🔵 正對照:貨號一樣就認 —— 否則上面兩格可能只是「永遠 unknown」', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: 'A', success: 'Y', edelno: '1111111111' })])));
    expect(await dispatchOrder(deps(f.impl), [{ epino: 'A', edelno: '1111111111' }], 'x')).toMatchObject({
      rows: [{ kind: 'dispatched', epino: 'A', edelno: '1111111111' }],
    });
  });
});

describe('⟦ship-DISPATCHORDER⟧ 三個必要欄位(V15 §8 p.31)', () => {
  it('🔴🔴 **送出去的那一包要有 `edelno`** —— 缺了會回一個長得像「新竹拒絕」的錯', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: 'E1', success: 'Y', edelno: '1' })])));
    await dispatchOrder(deps(f.impl), [{ epino: 'E1', edelno: '8947081964' }], '派達有限公司');
    const sent = f.bodies[0] ?? '';
    expect(sent).toContain('&quot;edelno&quot;:&quot;8947081964&quot;');
  });

  it('🔴 缺 `edelno` 或 `epino` 或 `emark` ⇒ throw, 而【零 HTTP】', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([])));
    await expect(dispatchOrder(deps(f.impl), [{ epino: 'E1', edelno: '' }], 'x')).rejects.toThrow(/缺必要欄位/);
    await expect(dispatchOrder(deps(f.impl), [{ epino: '', edelno: '1' }], 'x')).rejects.toThrow(/缺必要欄位/);
    await expect(dispatchOrder(deps(f.impl), [B('E1')], '  ')).rejects.toThrow(/不得為空白/);
    expect(f.calls, '缺欄位不准送出去').toEqual([]);
  });
});

describe('⟦ship-DISPATCHORDER⟧ 外層形狀 —— plan §5 那一格', () => {
  it('🔴🔴 **照抄 `TransData_Json` 的形狀(直接回陣列)⇒ 必須 unknown, 不准是「零箱成功」**', async () => {
    openGate();
    // 這就是「照抄」會收到的東西:一個沒有 rtn_code 外層的裸陣列。
    const f = fakeFetch(() => soap([row({ epino: 'E1', success: 'Y', edelno: '1' })]));
    const out = await dispatchOrder(deps(f.impl), [B('E1')], 'x');
    // 🔴 承重:它若回 `answered` 且 rows 全 unknown, 呼叫端會以為「新竹回答了、沒成功」。
    expect(out).toEqual({ kind: 'unknown', reason: 'rtn_envelope_not_object' });
  });

  it('🔴 `rtn_code` 不是 1 ⇒ unknown, 而 reason 帶著那個值', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: 'E1', success: 'Y', edelno: '1' })], { rtn_code: 0 })));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], 'x')).toEqual({ kind: 'unknown', reason: 'rtn_code_0' });
  });

  it('🔴 `rtn_code` 整格缺 ⇒ unknown 且說得出是「缺」, 不是某個值', async () => {
    openGate();
    const f = fakeFetch(() => soap({ rtn_msg: 'x', rtn_data: [] }));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], 'x')).toEqual({ kind: 'unknown', reason: 'rtn_code_missing' });
  });

  it('🔴 `rtn_data` 不是陣列 ⇒ unknown', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope({ epino: 'E1' })));
    expect(await dispatchOrder(deps(f.impl), [B('E1')], 'x')).toEqual({ kind: 'unknown', reason: 'rtn_data_not_array' });
  });

  it('🔴🔴 **筆數對不上 ⇒ 整包 unknown** —— 位置對錯 = 把 A 箱的成功記在 B 箱頭上', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: 'E1', success: 'Y', edelno: '1' })])));
    expect(await dispatchOrder(deps(f.impl), [B('E1'), B('E2')], 'x')).toEqual({
      kind: 'unknown',
      reason: 'rtn_data_len_1_want_2',
    });
  });

  it('🔴 網路炸掉 ⇒ unknown, 而【不是】「沒有一箱叫到車」', async () => {
    openGate();
    const impl = (() => Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' }))) as unknown as typeof fetch;
    const out = await dispatchOrder(deps(impl), [B('E1')], 'x');
    expect(out.kind).toBe('unknown');
  });
});

describe('⟦ship-DISPATCHORDER⟧ 送出去的那一包', () => {
  it('🔴 每一箱都帶 `epino` 與 `emark`, 而 `emark` 是 Sean 給的那個字', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([row({ epino: 'E1', success: 'Y', edelno: '1' })])));
    await dispatchOrder(deps(f.impl), [B('E1')], '派達有限公司');
    const sent = f.bodies[0] ?? '';
    // 🔵 SOAP 信封裡那段 JSON 是被 XML 跳脫過的 ⇒ 用跳脫後的形狀比對。
    expect(sent).toContain('&quot;epino&quot;:&quot;E1&quot;');
    expect(sent, 'emark 是中文, 而它走的是與收件人姓名同一個信封同一套跳脫').toContain('派達有限公司');
    expect(sent).toContain('TransDispatchOrder_Json');
  });

  it('🔴 空批次 ⇒ throw(空批次等於一個沒有受詞的請求), 而【零 HTTP】', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([])));
    await expect(dispatchOrder(deps(f.impl), [], 'x')).rejects.toThrow(/不得為空/);
    expect(f.calls).toEqual([]);
  });

  it('🔴🔴 **超過 20 箱 ⇒ throw, 【不自動分批】** —— 分批會讓按鈕的人不知道自己叫了幾台車', async () => {
    openGate();
    const f = fakeFetch(() => soap(envelope([])));
    const many = Array.from({ length: HCT_DISPATCH_MAX_ROWS + 1 }, (_v, i) => B(`E${String(i)}`));
    await expect(dispatchOrder(deps(f.impl), many, 'x')).rejects.toThrow(/不自動分批/);
    expect(f.calls).toEqual([]);
    // 🔵 正對照:剛好 20 箱要過得去 —— 否則上面那格可能只是「永遠都 throw」。
    const ok = Array.from({ length: HCT_DISPATCH_MAX_ROWS }, (_v, i) => B(`E${String(i)}`));
    const g = fakeFetch(() => soap(envelope(ok.map((e) => row({ epino: e, success: 'Y', edelno: '1' })))));
    expect((await dispatchOrder(deps(g.impl), ok, 'x')).kind).toBe('answered');
  });
});
