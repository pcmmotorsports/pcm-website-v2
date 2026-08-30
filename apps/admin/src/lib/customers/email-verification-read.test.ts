// email-verification-read.test.ts — 取數那一半(板 :437)。
//
// 🔴 **這支釘的是「失敗一律回 null」,而 null 的下游是 `unknown`(讀不到)不是 `unverified`。**
//    supabase-js 這一支失敗時**回 `{ error }`、不 reject**(同 `login-event.ts:107` 的坑)
//    ⇒ 只靠 catch 抓不到主要失敗路徑,所以兩種失敗形狀都要各演一次。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => {
    throw new Error('本測試一律注入 client,不該走到真身');
  },
}));

import { readEmailVerification } from './email-verification-read';
import { classifyEmailVerification } from './email-verification';

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const client = (res: unknown) =>
  ({ auth: { admin: { getUserById: () => Promise.resolve(res) } } }) as never;

describe('readEmailVerification', () => {
  it('一般帳號:取回 confirmedAt 與 undefined provider', async () => {
    const r = await readEmailVerification(
      'u1',
      client({ data: { user: { email_confirmed_at: '2026-08-30T00:00:00Z', app_metadata: {} } }, error: null }),
    );
    expect(r).toEqual({
      confirmedAt: '2026-08-30T00:00:00Z',
      provider: undefined,
      syntheticAddress: false,
    });
  });

  it('LINE 帳號:provider 帶回來', async () => {
    const r = await readEmailVerification(
      'u2',
      client({ data: { user: { email_confirmed_at: 'x', app_metadata: { pcm_provider: 'line' } } }, error: null }),
    );
    expect(r?.provider).toBe('line');
  });

  it('沒驗證:confirmedAt 是 null(而【不是】整個回 null)', async () => {
    const r = await readEmailVerification(
      'u3',
      client({ data: { user: { email_confirmed_at: null, app_metadata: {} } }, error: null }),
    );
    // 🔴 這一格分得開「沒驗證」與「讀不到」—— 前者是物件、後者是 null。
    expect(r).not.toBeNull();
    expect(r?.confirmedAt).toBeNull();
    expect(classifyEmailVerification(r).kind).toBe('unverified');
  });

  // 🔴 兩種失敗形狀各一發。
  it('回 { error } ⇒ null ⇒ 下游是 unknown,不是 unverified', async () => {
    const r = await readEmailVerification('u4', client({ data: { user: null }, error: { code: 'x' } }));
    expect(r).toBeNull();
    expect(classifyEmailVerification(r).kind).toBe('unknown');
  });

  it('throw ⇒ null(不外洩、不 throw 出去)', async () => {
    const boom = { auth: { admin: { getUserById: () => Promise.reject(new Error('boom')) } } } as never;
    await expect(readEmailVerification('u5', boom)).resolves.toBeNull();
  });

  it('user 是 null ⇒ null(查無此 user 也是「讀不到」,不是「沒驗證」)', async () => {
    const r = await readEmailVerification('u6', client({ data: { user: null }, error: null }));
    expect(classifyEmailVerification(r).kind).toBe('unknown');
  });

  it('provider 不是字串 ⇒ 當成沒有(不要把一個物件塞進 provider)', async () => {
    const r = await readEmailVerification(
      'u7',
      client({ data: { user: { email_confirmed_at: null, app_metadata: { pcm_provider: { a: 1 } } } }, error: null }),
    );
    expect(r?.provider).toBeUndefined();
    expect(classifyEmailVerification(r).kind).toBe('unverified');
  });

  // ══ code-reviewer 那一輪補的三格 ══════════════════════════════════
  //
  // 🔵 **must-fix 2:失敗必須【出聲】,而出聲的責任在本檔。**
  //    我原本以為上游 `load-customer-detail` 的 `settle()` 會印 —— 而本函式從不 reject
  //    ⇒ 那一路恆為 fulfilled ⇒ 那行 `console.error` 是死碼 ⇒ **GoTrue 掛掉時全站零 log**。
  // 🔵 **codex must-fix(2026-08-30):~~原本這一格只驗「參數個數 + 前綴」~~**
  //    ⇒ 一個把 error 物件 `JSON.stringify` 串進**同一個字串**的實作,
  //      參數仍然是 1、前綴仍然在 ⇒ **測試全綠而 PII 進了 log**。
  //    ⇒ 所以 error 物件裡塞可辨識的內容,並釘住它**不出現在那一行字裡**。
  it('must-fix 2:回 { error } ⇒ 出聲,而 error 的內容【不得】進那一行', async () => {
    await readEmailVerification(
      'u8',
      client({
        data: { user: null },
        error: {
          code: 'x',
          message: 'zq7f3x9-leaky@example.com not found',
          details: { app_metadata: { pcm_line_user_id: 'zq7f3x9-sub' } },
        },
      }),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    const line = String(warnSpy.mock.calls[0]?.[0]);
    expect(line).toContain('[admin/customers]');
    // 🔴 三發負對照:email、app_metadata 的值、以及整包序列化的痕跡,一個都不准在。
    expect(line).not.toContain('zq7f3x9-leaky@example.com');
    expect(line).not.toContain('zq7f3x9-sub');
    expect(line).not.toContain('app_metadata');
  });

  it('must-fix 2:throw ⇒ 也出聲,而不夾帶 error 的內容', async () => {
    const boom = {
      auth: { admin: { getUserById: () => Promise.reject(new Error('boom zq7f3x9secret')) } },
    } as never;
    await readEmailVerification('u9', boom);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('zq7f3x9secret');
  });

  it('正對照:成功那一路【不出聲】(否則 log 會被灌爆而沒有人再看它)', async () => {
    await readEmailVerification(
      'u10',
      client({ data: { user: { email_confirmed_at: null, app_metadata: {} } }, error: null }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // 🔵 **must-fix 4:掛住 ⇒ 1.5 秒之後自己回來,不把整張客人卡拖住。**
  //    ⚠️ 沒有這一格,`getUserById` 不回 ⇒ `allSettled` 無限等 ⇒ 客人卡與訂單面板一起白,
  //    而【永遠不出現】比錯誤頁差一級。
  // 🔵 **codex nit 訂正:這一格原本的失敗形狀是【掛住】,不是【紅】。**
  //    ~~原版直接 `await expect(pending).resolves.toBeNull()`~~ ⇒ 拿掉正式碼的逾時之後,
  //    這一發會**永遠不回來** ⇒ 只能靠外層 90 秒把整個 vitest 砍掉。
  //    📌 **一個「擋得住」但印不出紅格的守門,在 CI 上是一個逾時,不是一個 finding**
  //       —— 而值班看到逾時的第一個念頭是「機器慢」。
  //    ⇒ 加一個**測試側的 sentinel**:同一輪假時鐘推到 1601ms,
  //      誰先回來就決定結果 ⇒ 正式碼沒有逾時的話,這一格變成一個**普通的斷言失敗**。
  it('must-fix 4:掛住 ⇒ 硬逾時之後回 null(而失敗時是紅格,不是掛住)', async () => {
    vi.useFakeTimers();
    try {
      const hang = { auth: { admin: { getUserById: () => new Promise(() => {}) } } } as never;
      const sentinel = new Promise((resolve) => setTimeout(() => resolve('SENTINEL'), 1_601));
      const race = Promise.race([readEmailVerification('u11', hang), sentinel]);
      await vi.advanceTimersByTimeAsync(1_700);
      // 正式碼有逾時 ⇒ 它先回(1500ms)⇒ null;沒有逾時 ⇒ sentinel 先回 ⇒ 這一行紅。
      await expect(race).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 🔵 **nit 5:欄位【缺席】≠ 欄位是 null。**
  it('nit 5:回應裡沒有 email_confirmed_at 這一欄 ⇒ unknown,不是 unverified', async () => {
    const r = await readEmailVerification('u12', client({ data: { user: { app_metadata: {} } }, error: null }));
    expect(r).toBeNull();
    expect(classifyEmailVerification(r).kind).toBe('unknown');
    // 負對照:顯式 null 那一格仍然是 unverified(證明上面不是「什麼都回 unknown」)
    const r2 = await readEmailVerification(
      'u13',
      client({ data: { user: { email_confirmed_at: null, app_metadata: {} } }, error: null }),
    );
    expect(classifyEmailVerification(r2).kind).toBe('unverified');
  });

  // 🔵 **codex must-fix:合成信箱的布林要在這一側算好。**
  it('合成信箱 ⇒ syntheticAddress 是 true(而 email 本身不往下傳)', async () => {
    const r = await readEmailVerification(
      'u14',
      client({
        data: {
          user: {
            email: 'line_U0123@line.pcmmotorsports.local',
            email_confirmed_at: 'x',
            app_metadata: {},
          },
        },
        error: null,
      }),
    );
    expect(r?.syntheticAddress).toBe(true);
    expect(classifyEmailVerification(r).kind).toBe('synthetic');
    // 🔴 email 本身不得出現在往下傳的物件裡(判讀不需要看到 PII)。
    expect(JSON.stringify(r)).not.toContain('line_U0123');
  });

  it('負對照:真實信箱 ⇒ syntheticAddress 是 false', async () => {
    const r = await readEmailVerification(
      'u15',
      client({
        data: { user: { email: 'someone@example.com', email_confirmed_at: null, app_metadata: {} } },
        error: null,
      }),
    );
    expect(r?.syntheticAddress).toBe(false);
    expect(classifyEmailVerification(r).kind).toBe('unverified');
  });
});