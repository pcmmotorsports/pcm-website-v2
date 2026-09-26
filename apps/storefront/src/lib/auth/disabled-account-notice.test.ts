import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { handleForgotForDisabledAccount, verifyTurnstileToken, type DisabledNoticeDeps } from './disabled-account-notice';

// 停用帳號按忘記密碼(Sean 2026-09-26 Q30 / Q31 / Q32 甲)
function deps(over: Partial<DisabledNoticeDeps> = {}): DisabledNoticeDeps {
  return {
    findDisabledUserId: vi.fn(async () => 'u-off'),
    isSyntheticEmail: () => false,
    verifyCaptcha: vi.fn(async () => 'ok' as const),
    send: vi.fn(async () => ({ kind: 'sent' as const, providerMessageId: 'm1' })),
    now: () => new Date('2026-09-26T04:37:12Z'),
    ...over,
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('handleForgotForDisabledAccount', () => {
  it('不是停用帳號 ⇒ 交給 Supabase, 不驗驗證碼、不寄信', async () => {
    const d = deps({ findDisabledUserId: vi.fn(async () => null) });
    expect(await handleForgotForDisabledAccount(d, 'a@x.tw', 'tok')).toEqual({ kind: 'use_supabase', reason: 'not_disabled' });
    expect(d.verifyCaptcha).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('🔴 驗證碼通過 ⇒ 寄一封;防重複鍵 = 會員 id + UTC 小時(每小時最多一封)', async () => {
    const d = deps();
    expect(await handleForgotForDisabledAccount(d, 'a@x.tw', 'tok')).toEqual({ kind: 'done', reason: 'sent' });
    expect(vi.mocked(d.send).mock.calls[0]?.[0].idempotency).toEqual({
      eventType: 'account_disabled_notice',
      outboxId: 'u-off:2026-09-26T04',
    });
  });

  it('🔴 驗證碼沒帶或不對 ⇒ 交回 Supabase(不寄停用通知)', async () => {
    const d = deps({ verifyCaptcha: vi.fn(async () => 'invalid' as const) });
    expect(await handleForgotForDisabledAccount(d, 'a@x.tw', 'bad')).toEqual({ kind: 'use_supabase', reason: 'captcha_invalid' });
    expect(await handleForgotForDisabledAccount(deps(), 'a@x.tw', undefined)).toEqual({ kind: 'use_supabase', reason: 'captcha_missing' });
    expect(d.send).not.toHaveBeenCalled();
  });

  it('沒設金鑰、Cloudflare 連不上、假信箱、寄送失敗 ⇒ 都不再往下, 回一般畫面', async () => {
    expect((await handleForgotForDisabledAccount(deps({ verifyCaptcha: vi.fn(async () => 'unconfigured' as const) }), 'a@x.tw', 't')).reason).toBe('captcha_unconfigured');
    expect((await handleForgotForDisabledAccount(deps({ verifyCaptcha: vi.fn(async () => { throw new Error('x'); }) }), 'a@x.tw', 't')).reason).toBe('captcha_error');
    const syn = deps({ isSyntheticEmail: () => true });
    expect((await handleForgotForDisabledAccount(syn, 'a@x.tw', 't')).reason).toBe('synthetic');
    expect(syn.send).not.toHaveBeenCalled();
    expect(syn.verifyCaptcha).not.toHaveBeenCalled();
    expect((await handleForgotForDisabledAccount(deps({ send: vi.fn(async () => ({ kind: 'failed' as const, errorCode: 'http_500' as const })) }), 'a@x.tw', 't')).reason).toBe('send_failed');
    expect((await handleForgotForDisabledAccount(deps({ send: vi.fn(async () => { throw new Error('x'); }) }), 'a@x.tw', 't')).reason).toBe('send_failed');
  });

  it('查帳號丟例外 ⇒ 交給 Supabase', async () => {
    const d = deps({ findDisabledUserId: vi.fn(async () => { throw new Error('db'); }) });
    expect(await handleForgotForDisabledAccount(d, 'a@x.tw', 't')).toEqual({ kind: 'use_supabase', reason: 'lookup_failed' });
  });
});

describe('verifyTurnstileToken', () => {
  it('沒設 TURNSTILE_SECRET_KEY ⇒ unconfigured, 不打 Cloudflare', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await verifyTurnstileToken('t')).toBe('unconfigured');
    expect(f).not.toHaveBeenCalled();
  });

  it('🔴 金鑰填錯(invalid-input-secret)⇒ error, 不當成客人的驗證碼不對', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'wrong');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }))));
    expect(await verifyTurnstileToken('t')).toBe('error');
  });

  it('success=true ⇒ ok;false ⇒ invalid;非 2xx 或連不上 ⇒ error', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    expect(await verifyTurnstileToken('t')).toBe('ok');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    expect(await verifyTurnstileToken('t')).toBe('invalid');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    expect(await verifyTurnstileToken('t')).toBe('error');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await verifyTurnstileToken('t')).toBe('error');
  });
});
