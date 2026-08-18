// @vitest-environment node
// login-event.test.ts — M-4b 登入紀錄寫入端(plan §7.5 的 #1/#2/#3/#7 四格)。
//
// ⚠️ **本檔【不是】schema 守門**(codex 關卡2 R1 高5 收窄我原本寫的~~「唯一的守門」~~):
//    下面那格比對的是「生產碼的字串」對「測試裡另一份手寫的字串」,**兩邊都是我寫的**
//    ⇒ 我把兩邊一起改成 `requestid`,它照樣全綠,而正式 INSERT 仍然會失敗。
//    ⇒ 它能稱的只有「**防止單邊意外改字**」。真正的 schema 守門是**生成型別**
//      (`admin_sso_login_events` 還不在 `database.types.ts` 裡,因為表還沒 apply)⇒ 見 backlog `#652`。
import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { insertSpy, fromSpy, serviceClientSpy } = vi.hoisted(() => {
  const insertSpy = vi.fn(async (): Promise<{ error: unknown }> => ({ error: null }));
  const fromSpy = vi.fn(() => ({ insert: insertSpy }));
  return { insertSpy, fromSpy, serviceClientSpy: vi.fn(() => ({ from: fromSpy })) };
});

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: serviceClientSpy }));

import { extractClientIp, recordSsoLogin } from './login-event';

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

beforeEach(() => {
  insertSpy.mockClear().mockResolvedValue({ error: null });
  fromSpy.mockClear();
  serviceClientSpy.mockClear();
});

describe('extractClientIp — 取哪一段是 app 層的決定', () => {
  it('優先序 x-vercel-forwarded-for > x-forwarded-for > x-real-ip', () => {
    expect(
      extractClientIp(
        headers({
          'x-vercel-forwarded-for': '1.1.1.1',
          'x-forwarded-for': '2.2.2.2',
          'x-real-ip': '3.3.3.3',
        }),
      ),
    ).toBe('1.1.1.1');
    expect(extractClientIp(headers({ 'x-forwarded-for': '2.2.2.2', 'x-real-ip': '3.3.3.3' }))).toBe('2.2.2.2');
    expect(extractClientIp(headers({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('一串的話取【第一段】並 trim(proxy 後面常常是 `client, proxy1, proxy2`)', () => {
    expect(extractClientIp(headers({ 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1 ' }))).toBe('9.9.9.9');
  });

  it('🔴 不是合法 IP ⇒ null(寧可少一個欄位,不要少一整列)', () => {
    // `ip` 欄是 inet,PG 解析失敗會讓【整個 INSERT 失敗】⇒ 連 outcome 都沒了。
    // 🔴 前三個是【字元全合法而語法錯】的 —— 舊版只檢查字元集合,它們會通過(codex 關卡2 R1 高3)。
    for (const bad of [
      '999.999.999.999',
      '::::',
      '1.2.3',
      'not-an-ip',
      "1.1.1.1'; DROP TABLE x;--",
      '',
      '   ',
      'x'.repeat(50),
    ]) {
      expect(extractClientIp(headers({ 'x-forwarded-for': bad }))).toBeNull();
    }
    expect(extractClientIp(headers())).toBeNull(); // 一個標頭都沒有
  });

  it('負對照:合法的 IPv4 / IPv6 必須放行(證明上一格不是「全部擋掉」)', () => {
    expect(extractClientIp(headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(extractClientIp(headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});

describe('🔴 source-contract:callback route 只准走這一個入口', () => {
  it('route 不得【直接】import `logSsoLogin` —— 那條路只寫 console、不寫 DB', () => {
    // 病的形狀:下一個人加第六條失敗路徑,照舊寫法叫 `logSsoLogin`
    // ⇒ Vercel log 有那一筆、DB 沒有那一列,而**不會有任何東西紅**(那一小時之後就查不到了)。
    //
    // ⚠️ **這一格的天花板要先講**(codex 關卡2 R1 高4):它**只算原始碼字串**,
    //    證不了「五個控制流分支各自都會呼叫一次」—— 死程式碼、註解裡的字面、
    //    集中在同一分支、`import * as` 繞過,它全部看不出來。
    // ✅ **而那件事已經有人守了**:`app/api/sso/callback/route.test.ts` 逐一驅動
    //    五條路徑(success / state-mismatch×3 / exchange-failed / config-missing / sign-failed-config)
    //    並對**每一條**斷言它印出的結構化 log(`:122,141,179,216,239,259`)。
    // ⇒ **本格與那支是分工**:那支證「五條路徑都有寫紀錄」,本格證「入口沒有被繞過」。
    //    兩者都不是單獨足夠的。
    const source = readFileSync(
      new URL('../../app/api/sso/callback/route.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("import { recordSsoLogin } from '@/lib/sso/login-event'");
    expect(source).not.toMatch(/^import \{[^}]*logSsoLogin[^}]*\} from/m);
    // 每一條路徑都要 await(不 await 的話 serverless 可能在寫入完成前就結束了)
    const calls = source.match(/recordSsoLogin\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5); // 4 條失敗 + 1 條成功
    expect(source.match(/await recordSsoLogin\(/g) ?? []).toHaveLength(calls.length);
  });
});

describe('recordSsoLogin — 兩半一起做', () => {
  it('#1 成功 ⇒ 落一列 outcome=success,欄名逐字對(⚠️ 只防單邊改字,不是 schema 守門,見檔頭)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordSsoLogin(
      'success',
      { requestId: 'req-1', amr: ['pwd', 'totp'] },
      headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' }),
    );

    // 負對照:成功那一發必須回 'ok' —— 否則上面那些 'log_only' 斷言可能只是「永遠 log_only」
    expect(await recordSsoLogin('success', { requestId: 'req-ok' }, headers())).toBe('ok');
    expect(fromSpy).toHaveBeenCalledWith('admin_sso_login_events');
    expect(insertSpy).toHaveBeenCalledWith({
      outcome: 'success',
      reason: null,
      amr: 'pwd+totp',
      request_id: 'req-1',
      source_app: 'quote',
      ip: '203.0.113.7',
      user_agent: 'Mozilla/5.0',
    });
    // ⚠️ ~~另一格單獨檢查 `occurred_at` 不存在~~ 已刪:上面的**完整物件比對**通過之後它必然通過,
    //    那是一格「不可能紅」的冗餘守門(codex 關卡2 R1 指出)。
    infoSpy.mockRestore();
  });

  it('🔴 #2 失敗 ⇒ outcome=fail 且 reason 非空', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordSsoLogin('fail', { requestId: 'req-2', reason: 'state-mismatch' }, headers());

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'fail', reason: 'state-mismatch', amr: null }),
    );
    warnSpy.mockRestore();
  });

  it.each([
    ['reject(連線層炸了)', () => insertSpy.mockRejectedValue(new Error('db down'))],
    // 🔴🔴 **這一格才是主要失敗路徑**(codex 關卡2 R1 高2):supabase-js 的 `.insert()`
    //    失敗時**回傳 `{ error }`、不會 reject** ⇒ 表不存在 / 權限不對 / PostgREST 回錯,
    //    `await` 全部正常完成、`catch` 一次都不會跑。舊版完全沒檢查回傳值 ⇒ 那條路是無聲的。
    ['🔴 resolve 成 { error }(表不存在 / 權限不對 —— 主要失敗路徑)', () =>
      insertSpy.mockResolvedValue({ error: { message: 'relation does not exist' } })],
  ])('🔴 #3 DB 失敗(%s)⇒ 不 throw,而且 console 那半照樣寫了', async (_label, arrange) => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    arrange();

    // 🔴 斷言**回傳值**,不是「沒 throw」——「有檢查 `{ error }`」與「沒檢查」在外部
    //    看起來一模一樣(實測:把那道檢查拿掉,整份測試全綠)⇒ 沒有可觀測差異的檢查,測試必然恆綠。
    await expect(recordSsoLogin('success', { requestId: 'req-3' }, headers())).resolves.toBe('log_only');
    expect(infoSpy).toHaveBeenCalled(); // 🔴 DB 那半死了,一小時軌跡那半仍然要有
    infoSpy.mockRestore();
  });

  it('🔴 DB 永遠不 settle ⇒ 逾時放行(不讓寫紀錄把登入卡到平台殺掉)', async () => {
    // 失敗情境:連線一直不結束 ⇒ 五條路徑全卡在 await ⇒ 成功路徑即使 session cookie 已簽好,
    // response 也送不出去(codex 關卡2 R1 高1)。
    vi.useFakeTimers();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    insertSpy.mockImplementation(() => new Promise(() => {})); // 永不 settle
    try {
      const pending = recordSsoLogin('success', { requestId: 'req-t' }, headers());
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toBe('log_only');
    } finally {
      vi.useRealTimers();
      infoSpy.mockRestore();
    }
  });

  it('🔴 console 那半自己 throw ⇒ 也不得中斷登入(它原本在 try 外)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('stdout gone');
    });
    try {
      await expect(recordSsoLogin('success', { requestId: 'req-c' }, headers())).resolves.toBe('ok');
      expect(insertSpy).toHaveBeenCalled(); // console 死了,DB 那半仍然要試
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('🔴 #7 console 那半【不得】出現 IP 或 UA 原值(PII 只進 DB 那一列)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordSsoLogin(
      'success',
      { requestId: 'req-4' },
      headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'SecretAgent/9' }),
    );

    const printed = JSON.stringify(infoSpy.mock.calls);
    expect(printed).not.toContain('203.0.113.7');
    expect(printed).not.toContain('SecretAgent/9');
    expect(printed).toContain('sso.login'); // 正向對照:它真的印了東西,不是「什麼都沒印所以不含」
    infoSpy.mockRestore();
  });

  it('🔴 DB 寫入失敗【不得多印任何一行】,而且 IP 與 UA 都不得出現在任何 console 方法裡', async () => {
    // ⚠️ 舊版有兩個洞(codex 關卡2 R1 中6):①它容許 `console.info` ⇒ catch 裡加一行 info 不會紅
    //    ②失敗情境只查了 IP、**沒查 UA**。
    // ⇒ 現在:先量「正常那一發」印了幾次當基準,再斷言失敗那一發**一次都沒有多印**,且兩個值都掃。
    const ALL = ['error', 'warn', 'log', 'info', 'debug'] as const;
    const spies = ALL.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const h = headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'SecretAgent/9' });

      // 基準:成功寫入時 console 被叫幾次
      insertSpy.mockResolvedValue({ error: null });
      await recordSsoLogin('success', { requestId: 'req-base' }, h);
      const baseline = spies.reduce((n, s) => n + s.mock.calls.length, 0);
      expect(baseline).toBeGreaterThan(0); // 正向對照:它真的會印東西

      // 失敗:不得比基準多印任何一行
      insertSpy.mockRejectedValue(new Error('row 203.0.113.7 SecretAgent/9 failed'));
      await recordSsoLogin('success', { requestId: 'req-5' }, h);
      const after = spies.reduce((n, s) => n + s.mock.calls.length, 0);
      expect(after).toBe(baseline * 2); // 只多了第二次的那一份基準,沒有多出錯誤 log

      const printed = JSON.stringify(spies.map((s) => s.mock.calls));
      expect(printed).not.toContain('203.0.113.7');
      expect(printed).not.toContain('SecretAgent/9');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
