// @vitest-environment node
// login-event.test.ts — M-4b 登入紀錄寫入端(plan §7.5 的 #1/#2/#3/#7 四格)。
//
// 🔴 **本檔是目前【表名與欄名】唯一的守門** —— `admin_sso_login_events` 還不在 `database.types.ts` 裡
//    (那份型別從正式庫生成,而這張表還沒 apply)⇒ 生產碼用了窄 cast ⇒ **編譯器看不到打錯的欄名**。
//    ⇒ apply + 重生成型別、拆掉那個 cast 之後,這一格的角色才會退回「輔助」。
import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { insertSpy, fromSpy, serviceClientSpy } = vi.hoisted(() => {
  const insertSpy = vi.fn(async () => ({ error: null }));
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

  it('🔴 形狀不對 ⇒ null(寧可少一個欄位,不要少一整列)', () => {
    // `ip` 欄是 inet,PG 解析失敗會讓【整個 INSERT 失敗】⇒ 連 outcome 都沒了。
    for (const bad of ['not-an-ip', "1.1.1.1'; DROP TABLE x;--", '', '   ', 'x'.repeat(50)]) {
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
    // ⇒ 收成一個入口之後,這一格盯住「入口沒有被繞過」。
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
  it('🔴 #1 成功 ⇒ 落一列 outcome=success,而且【表名與每個欄名逐字】對(型別看不到,只有這格看得到)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordSsoLogin(
      'success',
      { requestId: 'req-1', amr: ['pwd', 'totp'] },
      headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' }),
    );

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
    // 🔴 `occurred_at` 不得出現 —— 它由 DB 的 BEFORE INSERT trigger 決定
    const [row] = insertSpy.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Object.keys(row)).not.toContain('occurred_at');
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

  it('🔴🔴 #3 DB 掛掉 ⇒ 不 throw(best-effort、絕不擋登入),而且 console 那半照樣寫了', async () => {
    // 突變:把 try/catch 拿掉 ⇒ 這格必紅。
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    insertSpy.mockRejectedValue(new Error('db down'));

    await expect(
      recordSsoLogin('success', { requestId: 'req-3' }, headers()),
    ).resolves.toBeUndefined();
    expect(infoSpy).toHaveBeenCalled(); // 🔴 DB 那半死了,一小時軌跡那半仍然要有
    infoSpy.mockRestore();
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

  it('🔴 DB 寫入失敗時【一行 log 都不准寫】—— 錯誤訊息會夾帶那一行的 IP 與 UA', async () => {
    const spies = (['error', 'warn', 'log', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      insertSpy.mockRejectedValue(new Error('row 203.0.113.7 SecretAgent/9 failed'));
      await recordSsoLogin('success', { requestId: 'req-5' }, headers({ 'x-forwarded-for': '203.0.113.7' }));

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('203.0.113.7');
    } finally {
      for (const spy of spies) spy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});
