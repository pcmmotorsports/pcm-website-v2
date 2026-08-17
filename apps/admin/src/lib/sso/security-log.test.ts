import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// #613:security-log.ts 原本零測試檔(`find apps/admin -name 'security-log*test*'` ⇒ 0)。
// 本檔守【函式本體】兩件:①info/warn 分流與輸出形狀 ②檔頭 :6 那條紅線
// 「絕不記 code / secret / session token / cookie 值」—— 原本零機械檢查。
import { logSsoLogin } from './security-log';

function lastJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
}

describe('logSsoLogin', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功 ⇒ 走 console.info(不是 warn),值班撈 warn 的前提', () => {
    logSsoLogin('success', { requestId: 'req-1', amr: ['pwd', 'totp'] });
    expect(warn).not.toHaveBeenCalled();
    // 整包比對:少一欄、欄名改字、outcome 寫死都會紅。
    expect(lastJson(info)).toEqual({
      evt: 'sso.login',
      outcome: 'success',
      request_id: 'req-1',
      source_app: 'quote',
      amr: 'pwd+totp',
    });
  });

  it('失敗 ⇒ 走 console.warn(不是 info),reason 原字進 log', () => {
    logSsoLogin('fail', { requestId: 'req-2', reason: 'state-mismatch' });
    expect(info).not.toHaveBeenCalled();
    expect(lastJson(warn)).toEqual({
      evt: 'sso.login',
      outcome: 'fail',
      request_id: 'req-2',
      source_app: 'quote',
      reason: 'state-mismatch',
    });
  });

  it('reason / amr 皆缺 ⇒ 那兩個 key 不出現(不是出現為 undefined/null)', () => {
    logSsoLogin('fail', { requestId: 'req-3' });
    expect(Object.keys(lastJson(warn)).sort()).toEqual(
      ['evt', 'outcome', 'request_id', 'source_app'],
    );
  });

  it('amr 是 join 出來的,不是寫死的字面:三元素樣本(reviewer 同族 minor:單一樣本分不出)', () => {
    // security-log.ts:28 寫死 'pwd+totp' ⇒ 本格紅;寫死 'a+b+c' ⇒ 上面成功格紅。
    logSsoLogin('success', { requestId: 'req-5', amr: ['a', 'b', 'c'] });
    expect(lastJson(info).amr).toBe('a+b+c');
  });

  it('🔴 紅線(security-log.ts:6):呼叫端多塞敏感欄位,一個字都不得進 log', () => {
    // 明日的呼叫端把 code/token 塞進 fields,或本檔改成 `{...fields}` 展開 ⇒ 本格紅。
    // 這是那條紅線唯一的機械檢查。
    const leaky = {
      requestId: 'req-4',
      reason: 'exchange-failed',
      code: 'SENSITIVE-AUTH-CODE',
      access_token: 'SENSITIVE-TOKEN',
      secret: 'SENSITIVE-SECRET',
      cookie: 'SENSITIVE-COOKIE',
    };
    logSsoLogin('fail', leaky as unknown as Parameters<typeof logSsoLogin>[1]);
    const line = String(warn.mock.calls[0]?.[0]);
    // 正向對照:這把尺量得到東西 —— 該進去的確實在裡面。
    expect(line).toContain('req-4');
    expect(line).toContain('exchange-failed');
    for (const v of ['SENSITIVE-AUTH-CODE', 'SENSITIVE-TOKEN', 'SENSITIVE-SECRET', 'SENSITIVE-COOKIE']) {
      expect(line).not.toContain(v);
    }
    // 值不在 ≠ 欄名不在:key 白名單另外釘,防未來塞空值欄位。
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(
      ['evt', 'outcome', 'reason', 'request_id', 'source_app'],
    );
  });
});
