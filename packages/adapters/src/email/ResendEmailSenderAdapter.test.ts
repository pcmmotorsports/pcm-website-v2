// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ResendEmailSenderAdapter } from './ResendEmailSenderAdapter';
import type { ResendFetchLike } from './ResendEmailSenderAdapter';
import type { SendEmailInput } from '@pcm/ports';

const KEY = 're_secret_key_e1b';
const FROM = 'orders@pcmmotorsports.com';
const INPUT: SendEmailInput = {
  to: 'customer@example.com',
  subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
  text: '您的訂單已完成付款。',
  idempotency: {
    eventType: 'order_created',
    outboxId: '11111111-2222-3333-4444-555555555555',
  },
};

/** 🔴 真實 `Response`(codex 關卡1 must-fix:假物件證明不了 body 消耗語意/二讀 TypeError)。 */
const realResponse = (body: unknown, status: number) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const send = (f: unknown) =>
  new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f as ResendFetchLike).send(INPUT);

describe('ResendEmailSenderAdapter.send(Resend emails)', () => {
  it('POST Resend endpoint、Bearer key、🔴 Idempotency-Key 由座標組字面、body 含 from/to/subject/text', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await send(f);
    expect(result).toEqual({ kind: 'sent' });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    // codex R1:port 收結構化座標、adapter 組 <event_type>/<outbox_id>,呼叫端無法誤餵自由字串。
    expect(init.headers['Idempotency-Key']).toBe(
      'order_created/11111111-2222-3333-4444-555555555555',
    );
    const body = JSON.parse(init.body);
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(INPUT.to);
    expect(body.subject).toBe(INPUT.subject);
    expect(body.text).toBe(INPUT.text);
  });

  it('🔴 畸形回應 fail-closed(codex R1 nit):null / 缺 ok/status / getter 拋錯 → 不外洩為 throw', async () => {
    await expect(send(vi.fn(async () => null))).resolves.toEqual({
      kind: 'failed',
      errorCode: 'provider_error',
    });

    await expect(send(vi.fn(async () => ({ ok: false })))).resolves.toEqual({
      kind: 'failed',
      errorCode: 'provider_error',
    });

    const fThrowingGetter = vi.fn(async () => ({
      get ok(): boolean {
        throw new Error('broken response');
      },
    }));
    await expect(send(fThrowingGetter)).resolves.toEqual({
      kind: 'failed',
      errorCode: 'network_error',
    });
  });

  it('allowlist 內狀態碼 → 對應 http_* 錯誤碼(422/429;429 無 json → 兜底不變)', async () => {
    for (const [status, code] of [
      [422, 'http_422'],
      [429, 'http_429'],
    ] as const) {
      const result = await send(vi.fn(async () => ({ ok: false, status })));
      expect(result).toEqual({ kind: 'failed', errorCode: code });
    }
  });

  it('🔴 非 allowlist 狀態碼 → provider_error 兜底(禁動態產碼)', async () => {
    const result = await send(vi.fn(async () => ({ ok: false, status: 418 })));
    expect(result).toEqual({ kind: 'failed', errorCode: 'provider_error' });
  });

  it('🔴 transport 失敗 → network_error,且錯誤碼不含 provider message 內容(禁由 .message 轉碼)', async () => {
    const f = vi.fn(async () => {
      throw new Error(`connect failed while sending to ${INPUT.to}`);
    });
    const result = await send(f);
    expect(result).toEqual({ kind: 'failed', errorCode: 'network_error' });
  });

  it('可預期失敗不 throw(outbox 需錯誤碼落表退避、不混流程式錯誤)', async () => {
    await expect(send(vi.fn(async () => ({ ok: false, status: 500 })))).resolves.toEqual({
      kind: 'failed',
      errorCode: 'http_500',
    });
  });

  it('🔴 錯誤碼恆符合 DB CHECK 格式 ^[a-z0-9_]{1,64}$(格式 backstop 對齊)', async () => {
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504, 418, 599]) {
      const result = await send(vi.fn(async () => ({ ok: false, status })));
      if (result.kind === 'failed') {
        expect(result.errorCode).toMatch(/^[a-z0-9_]{1,64}$/);
      }
    }
  });

  // ── E1c(Sean Q6=A):§窄幅破例 — 429 讀 body 頂層 name 三分 ──

  it('🔴 E1c 本體:429 + 官方 name 三字面 → 三個內部碼(真實 Response)', async () => {
    for (const [name, code] of [
      ['rate_limit_exceeded', 'rate_limited'],
      ['daily_quota_exceeded', 'quota_daily_exceeded'],
      ['monthly_quota_exceeded', 'quota_monthly_exceeded'],
    ] as const) {
      const f = vi.fn(async () => realResponse({ name, message: 'You have reached your quota.' }, 429));
      const result = await send(f);
      expect(result).toEqual({ kind: 'failed', errorCode: code });
    }
  });

  it('🔴 429 兜底:其他 name / 無 name / name 非字串 / body 非 JSON / body 陣列 → 全 http_429(零回歸)', async () => {
    const cases: Array<[string, unknown]> = [
      ['其他 name(21 碼之一、非 429 家族)', realResponse({ name: 'internal_server_error' }, 429)],
      ['無 name 欄', realResponse({ message: 'x' }, 429)],
      ['name 非字串(wire 不可信)', realResponse({ name: 42 }, 429)],
      ['body 非 JSON(邊緣層 CDN/WAF 限流)', realResponse('<html>429 Too Many Requests</html>', 429)],
      ['body 為陣列(typeof [] === object,.name undefined)', realResponse([], 429)],
    ];
    for (const [label, res] of cases) {
      const result = await send(vi.fn(async () => res));
      expect(result, label).toEqual({ kind: 'failed', errorCode: 'http_429' });
    }
  });

  it('🔴🔴 原型鏈名稱 → http_429(關卡2 code-reviewer Critical + codex must-fix 雙命中)', async () => {
    // 物件字面量查表時,`{"name":"toString"}` 會查到繼承來的 Object.prototype.toString(function)
    // → `?? 'http_429'` 不觸發 → errorCode 執行期違反 union(TS 索引簽章不紅)
    // → 下游 allowlist 改寫成 provider_error(**非 http_429**)→ 走非保守退避 → 燒完 attempts
    // → 死信 = 重開 E1c 要關的洞。修法 = Map.get(不查原型鏈)。
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf']) {
      const result = await send(vi.fn(async () => realResponse({ name }, 429)));
      expect(result, `name=${name}`).toEqual({ kind: 'failed', errorCode: 'http_429' });
    }
  });

  it('🔴 錯誤碼恆為 union 成員字串(原型鏈回傳 function/object 的回歸釘)', async () => {
    const ALLOWED = new Set([
      'http_400', 'http_401', 'http_403', 'http_404', 'http_408', 'http_409', 'http_422',
      'http_429', 'http_500', 'http_502', 'http_503', 'http_504',
      'rate_limited', 'quota_daily_exceeded', 'quota_monthly_exceeded',
      'network_error', 'provider_error',
    ]);
    for (const name of ['toString', '__proto__', 'constructor', 'daily_quota_exceeded', 'unknown_x']) {
      const result = await send(vi.fn(async () => realResponse({ name }, 429)));
      if (result.kind === 'failed') {
        expect(typeof result.errorCode, `name=${name} 的 errorCode 型別`).toBe('string');
        expect(ALLOWED.has(result.errorCode), `name=${name} → ${String(result.errorCode)}`).toBe(true);
      }
    }
  });

  it('🔴 429 但 json 非 function(wire 不保證存在)→ http_429', async () => {
    const result = await send(vi.fn(async () => ({ ok: false, status: 429, json: 'not-a-function' })));
    expect(result).toEqual({ kind: 'failed', errorCode: 'http_429' });
  });

  it('🔴 body 已消耗 → http_429(**不是** network_error;內層 try 的存在證明)', async () => {
    // codex 關卡1 實測:真實 Response body 二讀 → TypeError。若 json() reject 被 send 的外層 try
    // 吸走,會誤回 network_error → E2a 對 429 的保守長退避被誤導成 transport 短退避。
    const res = realResponse({ name: 'daily_quota_exceeded' }, 429);
    await res.json(); // 先消耗
    const result = await send(vi.fn(async () => res));
    expect(result).toEqual({ kind: 'failed', errorCode: 'http_429' });
  });

  it('🔴 非 429 → json 零呼叫(§窄幅破例只開 429 這一道門)', async () => {
    for (const status of [422, 500, 418]) {
      const jsonSpy = vi.fn(async () => ({ name: 'daily_quota_exceeded' }));
      await send(vi.fn(async () => ({ ok: false, status, json: jsonSpy })));
      expect(jsonSpy, `status ${status}`).not.toHaveBeenCalled();
    }
    // 成功路徑同樣不碰 body。
    const jsonSpyOk = vi.fn(async () => ({ name: 'x' }));
    await send(vi.fn(async () => ({ ok: true, status: 200, json: jsonSpyOk })));
    expect(jsonSpyOk).not.toHaveBeenCalled();
  });

  it('🔴 429 → json 恰被呼叫一次(不重複讀 body)', async () => {
    const jsonSpy = vi.fn(async () => ({ name: 'rate_limit_exceeded' }));
    const result = await send(vi.fn(async () => ({ ok: false, status: 429, json: jsonSpy })));
    expect(result).toEqual({ kind: 'failed', errorCode: 'rate_limited' });
    expect(jsonSpy).toHaveBeenCalledTimes(1);
  });

  it('🔴 message getter 零觸碰(REQUIRED-E1b「message 永不參與轉碼」無例外條的實證)', async () => {
    // grep `.message` 證明不了這條(codex 關卡1 打臉 v1 驗收條件)→ 用 getter 埋 spy 實證。
    const messageSpy = vi.fn(() => `寄給 ${INPUT.to} 失敗`); // 內含 PII,被碰到就會被抓出來
    const body = {
      name: 'daily_quota_exceeded',
      get message() {
        return messageSpy();
      },
    };
    const result = await send(vi.fn(async () => ({ ok: false, status: 429, json: async () => body })));
    expect(result).toEqual({ kind: 'failed', errorCode: 'quota_daily_exceeded' });
    expect(messageSpy).not.toHaveBeenCalled();
  });

  it('🔴 json() 自己 throw(getter 壞掉)→ http_429 兜底、不外洩為程式錯誤', async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error('malformed body');
      },
    }));
    await expect(send(f)).resolves.toEqual({ kind: 'failed', errorCode: 'http_429' });
  });
});
