// callback-event.test.ts — 板 :395 顧客站登入回呼紀錄。
//
// 🔴 **這支測的是【fail-open 真的成立】,不是「有呼叫」。**
//    `route.test.ts` 把本模組整個 mock 掉了 ⇒ 那邊一格都沒碰到這裡的邏輯。
//    ⇒ 沒有這支檔的話,「RPC 回 error 會不會炸掉登入」在全 repo **零覆蓋**。
//
// 🔴 **兩個世界都要演**:該安靜的要安靜(成功)、該出聲的要出聲(失敗)——
//    一組「全部不 throw」的斷言,在函式被改成永遠 no-op 時**照樣全綠**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { recordSpy, clientSpy } = vi.hoisted(() => ({
  recordSpy: vi.fn(),
  clientSpy: vi.fn(),
}));
// 🔵 mock 的是【那道門】(`line-admin`),不是 `@pcm/adapters/server` ——
//    本模組刻意不直接 import 後者(理由見 callback-event.ts 檔頭:那會多開一道 service_role 門)。
vi.mock('./line-admin', () => ({ createAuthCallbackEventClient: clientSpy }));

import { recordLineCallbackEvent } from './callback-event';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  recordSpy.mockReset().mockResolvedValue({ error: null });
  clientSpy.mockReset().mockImplementation(() => ({ record: recordSpy }));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('recordLineCallbackEvent', () => {
  it('成功:只送三個欄位、不出聲', async () => {
    await recordLineCallbackEvent('success', null);
    // 🔵 codex R2-5:門那一側只收參數,函式名寫死在 line-admin ⇒ 這裡不再出現名稱。
    // 🔵 fable R3:`p_state` 整個不存在了 —— 那一欄連同它的攻擊面一起被拿掉
    //    (理由見 migration 檔頭:它買不到「重放看得見」,卻讓攻擊者鑄得出無限多把合法的鍵)。
    expect(recordSpy).toHaveBeenCalledWith({
      p_provider: 'line',
      p_outcome: 'success',
      p_reason_code: null,
    });
    // 🔴 釘住【恰好三個鍵】:少了這一格,有人把 state 加回來不會有任何東西紅。
    expect(Object.keys(recordSpy.mock.calls[0]?.[0] ?? {})).toHaveLength(3);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('失敗路徑照樣送 reason code', async () => {
    await recordLineCallbackEvent('failure', 'state_mismatch');
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      p_outcome: 'failure',
      p_reason_code: 'state_mismatch',
    });
  });

  // 🔴 supabase-js 的 .rpc() 失敗時【回 { error }、不 reject】—— 只靠 catch 抓不到這條路。
  it('RPC 回 { error } ⇒ 出聲(固定前綴)但不 throw', async () => {
    recordSpy.mockResolvedValue({ error: { code: '42883', message: 'function does not exist' } });
    await expect(recordLineCallbackEvent('success', null)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('[auth.callback]');
  });

  // 🔴 零 PII:出聲的那一行**只帶固定句**,不得夾帶 DB 的 error 物件(它會帶回呼叫參數)。
  it('出聲時只送一個字串參數、且不含 rpc 的原始訊息', async () => {
    recordSpy.mockResolvedValue({ error: { code: '42501', message: 'permission denied for zzz-secret' } });
    await recordLineCallbackEvent('failure', 'upstream_error');
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('permission denied');
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('zzz-secret');
  });

  // 🔵 **codex R1-11**:這兩格原本只斷言 warn 的【次數】。
  //    ⇒ 實作若改成 `console.warn(句子, err)`,次數照樣是 1 ⇒ **測試全綠而上游 error
  //      (可能夾帶 credential / 上游 body)被印進 log。**
  //    ⇒ 加釘【參數恰好一個】與【不含丟進去的敏感字串】。家法:`login-event.ts:275` 同一條紀律。
  it('client 建不起來(同步 throw)⇒ 出聲但不 throw、且只送一個字串', async () => {
    clientSpy.mockImplementation(() => {
      throw new Error('no service key zzz-secret');
    });
    await expect(recordLineCallbackEvent('success', null)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('zzz-secret');
  });

  it('RPC reject ⇒ 出聲但不 throw、且只送一個字串', async () => {
    recordSpy.mockRejectedValue(new Error('network down zzz-secret'));
    await expect(recordLineCallbackEvent('success', null)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('network down');
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('zzz-secret');
  });

  // 🔴 逾時那一路:RPC 永遠不 settle ⇒ 1.5s 之後本函式必須自己回來。
  //    ⚠️ 用假時鐘,不然這一格要真的等 1.5 秒。
  it('RPC 掛住 ⇒ 硬逾時之後回來,不把登入拖住', async () => {
    vi.useFakeTimers();
    try {
      recordSpy.mockReturnValue(new Promise(() => {}));
      const pending = recordLineCallbackEvent('success', null);
      await vi.advanceTimersByTimeAsync(1_600);
      await expect(pending).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
