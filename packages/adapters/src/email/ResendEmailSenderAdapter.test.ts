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
    expect(result).toEqual({ kind: 'sent', providerMessageId: null });
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

// ── M-4b S2(2026-08-24):附件欄 ────────────────────────────────────────────────
//
// 🔴 **本組最重要的不是「附件送得出去」,是【不給附件時什麼都沒變】。**
//    這一片對外宣告「客人可見改變 = 零」,而那個零**要被證明**,不是宣稱。
import {
  RESEND_MAX_ATTACHMENTS_BASE64_BYTES,
  EmailAttachmentTooLargeError,
} from './ResendEmailSenderAdapter';

const sendWith = (f: unknown, over: Partial<SendEmailInput> = {}) =>
  new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f as ResendFetchLike).send({
    ...INPUT,
    ...over,
  });

/**
 * 取出這一發真的被送出去的東西。
 * 🔴 走 `as unknown as`(既有格 :37 同款):`vi.fn(async () => …)` 的 mock 參數 tuple 是 `[]`,
 *    直接索引 `[1]` 在型別層取不到 —— 那是 mock 的形狀問題,不是斷言的問題。
 */
type SentInit = { method: string; headers: Record<string, string>; body: string };
const sentInit = (f: unknown): SentInit =>
  (f as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1] as unknown as SentInit;
const sentBody = (f: unknown) => JSON.parse(sentInit(f).body) as Record<string, unknown>;

const PDF = { filename: 'PCM-2026-0001-訂單明細.pdf', contentBase64: 'JVBERi0xLjQK' };

describe('ResendEmailSenderAdapter — 🔴🔴 不給附件 ⇒ 逐位元零改變(既有呼叫端的回歸網)', () => {
  it('🔴 沒給 attachments ⇒ body **不得出現** attachments 這個 key(不是空陣列)', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f);
    const body = sentBody(f);
    expect('attachments' in body).toBe(false);
    // 正對照:鍵集就是既有那四個,多一個都算改變。
    expect(Object.keys(body).sort()).toEqual(['from', 'subject', 'text', 'to']);
  });

  it('🔴 給【空陣列】也一樣不得出現那個 key(空陣列與沒給是同一件事)', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f, { attachments: [] });
    expect('attachments' in sentBody(f)).toBe(false);
  });

  it('🔴 逐位元:給空陣列送出去的 body 字串,與完全不給時**一模一樣**', async () => {
    const f1 = vi.fn(async () => ({ ok: true, status: 200 }));
    const f2 = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f1);
    await sendWith(f2, { attachments: [] });
    const b1 = sentInit(f1).body;
    const b2 = sentInit(f2).body;
    expect(b2).toBe(b1);
  });

  it('🔴🔴 逐位元【對改動前那一版】—— 上一格只比新實作自己,兩邊一起變仍會全綠', async () => {
    // codex R1 MF-4:`b2 === b1` 兩端都出自**同一份新碼** ⇒ 共同欄位的值或序列化順序一起變,
    // 那一格照樣過。⇒ 這裡把改動前送出去的**字面**釘死,它不會跟著實作一起漂。
    // (來源 = 改動前 `JSON.stringify({ from, to, subject, text })` 的四欄與順序。)
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f);
    expect(sentInit(f).body).toBe(
      JSON.stringify({ from: FROM, to: INPUT.to, subject: INPUT.subject, text: INPUT.text }),
    );
  });

  it('🔴🔴 `Object.prototype` 被污染 ⇒ 既有呼叫端仍然零改變(改動前不會讀這一欄)', async () => {
    // codex R1 MF-1:`input.attachments` 走原型鏈 ⇒ 污染值會被讀成「有附件」。
    const proto = Object.prototype as unknown as Record<string, unknown>;
    expect('attachments' in proto).toBe(false); // 負對照:開跑前是乾淨的
    proto['attachments'] = [{ filename: 'evil.pdf', contentBase64: 'RVZJTA==' }];
    try {
      const f = vi.fn(async () => ({ ok: true, status: 200 }));
      await sendWith(f);
      // 🔴 這裡【不能用 `in`】—— 污染的當下 `in` 會走到原型鏈上那一個,
      //    ⇒ 它會對【任何】被解析出來的物件都回 true,而那與 adapter 有沒有送出附件無關。
      //    (我第一版就是這樣寫的, 而它紅了 —— **量具自己被同一個污染騙到**。)
      expect(Object.prototype.hasOwnProperty.call(sentBody(f), 'attachments')).toBe(false);
      expect(sentInit(f).body).not.toContain('evil.pdf');
    } finally {
      delete proto['attachments'];
    }
    expect('attachments' in proto).toBe(false); // 還原驗證:不留痕給別的測試
  });
});

describe('ResendEmailSenderAdapter — 附件送得出去', () => {
  it('給附件 ⇒ body 含 attachments,filename 與 content 逐欄相符', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const r = await sendWith(f, { attachments: [PDF] });
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
    expect(sentBody(f).attachments).toEqual([
      { filename: PDF.filename, content: PDF.contentBase64 },
    ]);
  });

  it('🔴 附件逐欄具名:原始物件多帶欄位,送出去的**只有 filename 與 content**', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const dirty = { ...PDF, path: '/etc/passwd', content_id: 'x', cost: 999 } as never;
    await sendWith(f, { attachments: [dirty] });
    const sent = (sentBody(f).attachments as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(sent).sort()).toEqual(['content', 'filename']);
    expect(JSON.stringify(sent)).not.toContain('999');
  });

  it('多個附件照順序全帶上', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f, { attachments: [PDF, { filename: 'b.pdf', contentBase64: 'QQ==' }] });
    expect((sentBody(f).attachments as unknown[]).length).toBe(2);
  });

  it('其餘欄位不受影響(附件不得改動 from/to/subject/text 與 Idempotency-Key)', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f, { attachments: [PDF] });
    const body = sentBody(f);
    expect(body.text).toBe(INPUT.text);
    expect(body.subject).toBe(INPUT.subject);
    expect(sentInit(f).headers['Idempotency-Key']).toBe('order_created/11111111-2222-3333-4444-555555555555');
  });
});

describe('ResendEmailSenderAdapter — 🔴🔴 附件超量:擋在送出去【之前】', () => {
  const oversized = () => ({
    filename: 'huge.pdf',
    contentBase64: 'A'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES + 1),
  });

  it('🔴 單一附件超過上限 ⇒ throw,而且**一次 fetch 都沒發生**', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(sendWith(f, { attachments: [oversized()] })).rejects.toThrow(
      EmailAttachmentTooLargeError,
    );
    // 🔴 這一格才是重點:超量的信**沒有送出去**,所以不會被退、不會傷寄件信譽。
    expect(f).not.toHaveBeenCalled();
  });

  it('🔴 多個附件【加起來】超過上限 ⇒ 一樣 throw(量的是總和,不是單顆)', async () => {
    const half = 'A'.repeat(Math.ceil(RESEND_MAX_ATTACHMENTS_BASE64_BYTES / 2) + 1);
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(
      sendWith(f, {
        attachments: [
          { filename: 'a.pdf', contentBase64: half },
          { filename: 'b.pdf', contentBase64: half },
        ],
      }),
    ).rejects.toThrow(EmailAttachmentTooLargeError);
    expect(f).not.toHaveBeenCalled();
  });

  it('🟢 邊界正對照:剛好等於上限 ⇒ **照送**(上限是「超過才擋」,不是「接近就擋」)', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const r = await sendWith(f, {
      attachments: [
        { filename: 'edge.pdf', contentBase64: 'A'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES) },
      ],
    });
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('🔴 錯誤訊息不得帶附件內容(它可能是客人的訂單明細)', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const err: unknown = await sendWith(f, { attachments: [oversized()] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailAttachmentTooLargeError);
    const msg = (err as Error).message;
    // 🔴 附件內容可能是客人的訂單明細 ⇒ 一個字都不得進錯誤訊息。
    expect(msg).not.toContain('AAAA');
    // codex R1 nit-1:只找 'AAAA' ⇒ 洩漏【檔名】或少於四個字元仍會假綠。
    //    ⇒ 補上檔名那一半,並用一個獨特到不會意外出現的字面當探針。
    expect(msg).not.toContain('PCM-2026-0001');
    expect(msg).not.toContain('.pdf');
    expect(msg).toContain('一封都沒有送出去');
  });
});

describe('#876 codex R1 —— 量法與快照(兩條 must-fix 各自的證人)', () => {
  it('🔴 量的是 byte 不是 `.length`:非 ASCII 內容 `.length` 過關而 UTF-8 bytes 超量 ⇒ 仍要 throw', async () => {
    // 每個 '中' 的 UTF-8 是 3 bytes、UTF-16 `.length` 是 1
    //    ⇒ 只要 .length 略低於門檻,byte 就是它的三倍 ⇒ 舊量法會放它出去發一發超量請求。
    const n = RESEND_MAX_ATTACHMENTS_BASE64_BYTES - 1;
    const cjk = { filename: 'x.pdf', contentBase64: '中'.repeat(Math.floor(n / 2)) };
    expect(cjk.contentBase64.length).toBeLessThan(RESEND_MAX_ATTACHMENTS_BASE64_BYTES); // 負對照:舊量法會過
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(sendWith(f, { attachments: [cjk] })).rejects.toThrow(EmailAttachmentTooLargeError);
    expect(f, '一次 fetch 都不該發生').not.toHaveBeenCalled();
  });

  it('🔴🔴 getter 二讀:第一次回短的、第二次回超量的 ⇒ 快照擋住,送出去的是【量過的那一份】', async () => {
    // codex R1 MF-3:原本量一次、送出時再讀一次 ⇒ 這個 getter 可以繞過前面那道 throw。
    let reads = 0;
    const sneaky = {
      filename: 'x.pdf',
      get contentBase64() {
        reads += 1;
        return reads === 1 ? 'SHORT' : 'A'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES + 1);
      },
    };
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendWith(f, { attachments: [sneaky] });
    expect(reads, '這一欄只可以被讀一次 —— 讀第二次就是給了它換內容的機會').toBe(1);
    const sent = (sentBody(f).attachments as Array<{ content: string }>)[0]!;
    expect(sent.content).toBe('SHORT');
    expect(sent.content.length).toBeLessThan(RESEND_MAX_ATTACHMENTS_BASE64_BYTES);
  });
});

describe('#876 cf 審查 —— 🔴 常數的【名字】要與 adapter 真正的量法一致', () => {
  // cf MF-1:名字叫 CHARS 而內部量 byte ⇒ 呼叫端照名字寫 `myBase64.length > 上限`,
  //   非 ASCII 時他判「沒超過」而 adapter 照樣 throw ⇒ **他重現了剛被修掉的那個 bug**。
  //   ⇒ 這一格釘住「名字說 BYTES」與「真的量 byte」是同一件事。
  it('🔴 名字說 BYTES,而餵一份【bytes 超量但 .length 沒超量】的內容 ⇒ 真的會 throw', async () => {
    const cjk = { filename: 'x.pdf', contentBase64: '中'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES) };
    // 這一份的 .length 恰好【等於】上限 ⇒ 照 `.length` 判是「沒超過」
    expect(cjk.contentBase64.length).toBe(RESEND_MAX_ATTACHMENTS_BASE64_BYTES);
    expect(Buffer.byteLength(cjk.contentBase64, 'utf8')).toBeGreaterThan(
      RESEND_MAX_ATTACHMENTS_BASE64_BYTES,
    );
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(sendWith(f, { attachments: [cjk] })).rejects.toThrow(EmailAttachmentTooLargeError);
  });

  it('🔴 錯誤訊息說的單位也要是【位元組】(訊息是給人看的那一半)', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const err = await sendWith(f, {
      attachments: [{ filename: 'x.pdf', contentBase64: 'A'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES + 1) }],
    }).catch((e: unknown) => e);
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).toContain('位元組');
    expect(msg, '訊息若還說「字元」, 它會教下一個人用 .length').not.toContain('字元');
  });

  it('🟢 邊界正對照:剛好等於上限(ASCII)⇒ 照送,不 throw', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const exact = { filename: 'x.pdf', contentBase64: 'A'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES) };
    await expect(sendWith(f, { attachments: [exact] })).resolves.toEqual({ kind: 'sent', providerMessageId: null });
  });
});

describe('#876 codex R2 —— 🔴 用【字串鍵】釘住公開名稱,不是釘住行為', () => {
  // codex R2 MF-3:我上一輪加的三格斷言的是【行為】(量 byte / 邊界)——
  //   而把常數連同測試一起改回 …CHARS,那三格**仍然全綠**。
  //   🔴 **而 MF-1 的病因就是名字。** ⇒ 名字要用字串鍵釘,才擋得住「連測試一起改」。
  it('🔴 出口的公開名稱必須叫 …_BYTES,而【不得】再出現 …_CHARS', async () => {
    const mod = (await import('../server')) as Record<string, unknown>;
    const keys = Object.keys(mod);
    expect(keys).toContain('RESEND_MAX_ATTACHMENTS_BASE64_BYTES');
    expect(
      keys.filter((k) => k.includes('BASE64_CHARS')),
      '舊名字回來了 ⇒ 它會再教一次呼叫端用 .length',
    ).toEqual([]);
  });

  it('🔴 錯誤物件的公開欄位也要叫 …Bytes(它跨 package 可見)', async () => {
    const mod = await import('../server');
    const err = new mod.EmailAttachmentTooLargeError(9, 1);
    expect(Object.keys(err)).toContain('totalBase64Bytes');
    expect(Object.keys(err).filter((k) => /Chars$/.test(k))).toEqual([]);
  });
});

describe('#876 codex R2 —— 🔴 畸形輸入不得被猜成附件', () => {
  // codex R2 MF-2:`Array.from('AB')` 不是 [] ⇒ 舊版會送出兩個內容為 "undefined" 的附件。
  it('🔴 attachments 是字串(型別禁止但 runtime 擋不住)⇒ throw,而不是寄出兩個 "undefined"', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(
      sendWith(f, { attachments: 'AB' as unknown as SendEmailInput['attachments'] }),
    ).rejects.toThrow(TypeError);
    expect(f, '一次 fetch 都不該發生').not.toHaveBeenCalled();
  });

  it('🔴 元素的欄位不是字串 ⇒ throw,不得轉型成 "undefined" 寄出去', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(
      sendWith(f, { attachments: [{} as unknown as { filename: string; contentBase64: string }] }),
    ).rejects.toThrow(TypeError);
    expect(f).not.toHaveBeenCalled();
  });

  it('🔴🔴 非陣列的【可迭代物】(元素合法)也要 throw —— 不然 isArray 那道是死碼', async () => {
    // 🔴 這一格是我跑突變才補的:把 `Array.isArray` 那道拿掉之後,上面兩格【仍然全綠】——
    //    因為字串 'AB' 的元素本來就通不過「欄位必須是字串」那道。
    //    ⇒ isArray 那道當時**沒有任何獨立判別力**,而它看起來裝好了。
    //    ⇒ 要證明它在做事,得餵一個【元素合法而容器不是陣列】的東西。
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const notAnArray = new Set([PDF]) as unknown as SendEmailInput['attachments'];
    await expect(sendWith(f, { attachments: notAnArray })).rejects.toThrow(TypeError);
    expect(f).not.toHaveBeenCalled();
  });

  it('🟢 負對照:合法的附件不可以被這道檢查誤擋', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(sendWith(f, { attachments: [PDF] })).resolves.toEqual({ kind: 'sent', providerMessageId: null });
  });
});

describe('#876 出口面 —— 🔴 呼叫端【拿得到】那個 class,不然它 throw 的意義歸零', () => {
  // 🔴 為什麼是【真的 import】而不是 grep server.ts 的字面:
  //    字面在、而 barrel 少了一層轉出 / 型別出不去 / 檔案改名 —— 三種情況下 grep 都是綠的,
  //    而呼叫端仍然拿不到。**這一格要用呼叫端的方式問,不是用讀原始碼的方式問。**
  it('從 @pcm/adapters/server 拿得到 EmailAttachmentTooLargeError,而且 instanceof 成立', async () => {
    const mod = await import('../server');
    expect(typeof mod.EmailAttachmentTooLargeError).toBe('function');
    const err = new mod.EmailAttachmentTooLargeError(999, 100);
    expect(err).toBeInstanceOf(Error);
    // 🔴🔴 **要用 adapter【真的 throw 出來的那一顆】去問**(codex R1 MF-5):
    //    上面那個 `err` 是我自己 new 的 ⇒ 出口若誤接成一個 subclass / wrapper,
    //    `new mod.X() instanceof X` 仍然成立,而**呼叫端接到的那顆不會被認得**。
    //    ⇒ 這才是這一格要保護的東西:**呼叫端 catch 到的那顆,instanceof 出口那個 class**。
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    const tooBig = {
      filename: 'x.pdf',
      contentBase64: 'A'.repeat(RESEND_MAX_ATTACHMENTS_BASE64_BYTES + 1),
    };
    const thrown = await sendWith(f, { attachments: [tooBig] }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(mod.EmailAttachmentTooLargeError);
    expect(f).not.toHaveBeenCalled();
  });

  it('上限常數也出得去(呼叫端要在【組附件之前】自己先判就得拿得到它)', async () => {
    const mod = await import('../server');
    expect(mod.RESEND_MAX_ATTACHMENTS_BASE64_BYTES).toBe(RESEND_MAX_ATTACHMENTS_BASE64_BYTES);
    expect(mod.RESEND_MAX_ATTACHMENTS_BASE64_BYTES).toBe(40 * 1024 * 1024);
  });

  it('🔴 負對照:一個不存在的名字拿不到(不然上面兩格對【任何】名字都會過)', async () => {
    const mod = (await import('../server')) as Record<string, unknown>;
    expect(mod['ZzzThisExportDoesNotExist']).toBeUndefined();
  });
});

// ══ 片1(2026-09-01):`html` 選填欄 —— 只開管道,呼叫端一個字都沒改 ══════════
//
// 🔴 **這一組守的不是「html 會被送出去」,是【不給 html 的那封信逐位元不變】。**
//    訂單確認信寄出去收不回來(鐵則 12⑤)⇒ 這一片刻意只動管道,
//    而「管道動了而內容沒動」這句話**要有證據,不是宣稱**。
// 🔵 用同檔既有的 `sendWith` / `sentBody` / `sentInit`,**不另造量具** ——
//    ⛔ ~~第一版我自己寫了一個 `bodyOf`~~ (code-reviewer:兩把量具,而以後只有一把會被修)。
describe('ResendEmailSenderAdapter.send —— html 選填欄(片1)', () => {
  it('🔴 不給 html ⇒ body 裡【沒有 html 這個 key】(不是 html:null、不是空字串)', async () => {
    const f = vi.fn(async () => realResponse({ id: 'e1' }, 200));
    await sendWith(f);
    // 🔴 一律用 `hasOwnProperty.call`,不用 `in` —— 同檔 attachments 那組已經寫過為什麼:
    //    `in` 走原型鏈 ⇒ 在污染的世界裡對任何物件都回 true。統一成一種,免得下一個人挑錯。
    expect(Object.prototype.hasOwnProperty.call(sentBody(f), 'html')).toBe(false);
    expect(sentBody(f).text).toBe(INPUT.text); // 純文字那一欄原樣
  });

  it('🔴 逐位元:不給 html 的那封信,body 與【本片之前】的期望值逐字相同', async () => {
    // 🛑 上一格只證明「沒有 html 這個 key」。而把 `text` 改名、或多塞一個欄位仍會讓它全綠
    //    ⇒ 這一格釘的是**整份 body**,那才是「寄出去的東西沒變」。
    const f = vi.fn(async () => realResponse({ id: 'e2' }, 200));
    await sendWith(f);
    expect(sentInit(f).body).toBe(
      JSON.stringify({ from: FROM, to: INPUT.to, subject: INPUT.subject, text: INPUT.text }),
    );
  });

  it('🟢 給了 html ⇒ 整份 body 也釘死(不得順手多送一個欄位給 provider)', async () => {
    // 🔴 只驗 `body.html` 的話,`...(html!==null ? { html, reply_to:'x' } : {})` 會全綠
    //    ⇒ 多一個欄位送給 provider 而沒有人看得出來(code-reviewer nit)。
    const f = vi.fn(async () => realResponse({ id: 'e3' }, 200));
    const html = '<table><tr><td>PCM</td></tr></table>';
    await sendWith(f, { html });
    expect(sentInit(f).body).toBe(
      JSON.stringify({ from: FROM, to: INPUT.to, subject: INPUT.subject, text: INPUT.text, html }),
    );
  });

  it('🔴 空字串當作沒給 ⇒ body 裡仍然沒有 html 這個 key', async () => {
    const f = vi.fn(async () => realResponse({ id: 'e4' }, 200));
    await sendWith(f, { html: '' });
    expect(Object.prototype.hasOwnProperty.call(sentBody(f), 'html')).toBe(false);
  });

  it('🔴 非字串一律丟掉,**不轉型** —— 一個有 toString 的物件不得被送出去', async () => {
    // 🔴🔴 這一格是 code-reviewer 逼出來的:`typeof rawHtml === 'string'` 那道門原本**零測試**,
    //    而註解逐字稱它是「實際的門」⇒ 宣稱有門而沒有殺得掉突變的格。
    //    突變 `String(rawHtml)` ⇒ 這一格必紅(其餘五格全綠)。
    const f = vi.fn(async () => realResponse({ id: 'e5' }, 200));
    const evil = { toString: () => '<b>轉型來的</b>' } as unknown as string;
    await sendWith(f, { html: evil });
    expect(Object.prototype.hasOwnProperty.call(sentBody(f), 'html')).toBe(false);
    expect(sentInit(f).body).not.toContain('轉型來的');
  });

  it('🔴🔴 `Object.prototype` 被污染 ⇒ 既有呼叫端仍然零改變(改動前不會讀這一欄)', async () => {
    // 🔵 兩道還原守門逐字照抄同檔 attachments 那格(污染前負對照 + finally 後還原驗證)——
    //    ⛔ ~~第一版我兩道都沒寫~~,而「還原乾淨」當時只是宣稱(code-reviewer 抓到)。
    const proto = Object.prototype as unknown as Record<string, unknown>;
    expect('html' in proto).toBe(false); // 負對照:開跑前是乾淨的
    proto['html'] = '<b>污染</b>';
    try {
      const f = vi.fn(async () => realResponse({ id: 'e6' }, 200));
      await sendWith(f);
      // 🔴 這裡【不能用 `in`】—— 我第一版就是這樣寫的,而它紅了:**量具自己被同一個污染騙到**。
      expect(Object.prototype.hasOwnProperty.call(sentBody(f), 'html')).toBe(false);
      expect(sentInit(f).body).not.toContain('污染');
    } finally {
      delete proto['html'];
    }
    expect('html' in proto).toBe(false); // 還原驗證:不留痕給別的測試
  });

  it('🟢 而上一格不是恆真:呼叫端明給時,html 必須真的被送出去', async () => {
    // 🔴 少了這一格,把 adapter 改成「永遠不送 html」也會全綠 ⇒ 那道守門變成「功能沒接上」。
    // 🔵 而字面**刻意與污染值不同**(code-reviewer:同字面 + 走原型鏈取值 ⇒ 還原一失效這格就恆真)。
    const f = vi.fn(async () => realResponse({ id: 'e7' }, 200));
    await sendWith(f, { html: '<b>乾淨</b>' });
    expect(Object.prototype.hasOwnProperty.call(sentBody(f), 'html')).toBe(true);
    expect(sentBody(f).html).toBe('<b>乾淨</b>');
  });
});

// ══════════════════════════════════════════════════════════════════
// ⟦b4-NOSENTBODY⟧ 成功路徑讀 provider 訊息 id —— §窄幅破例的第二個入口
// ══════════════════════════════════════════════════════════════════
// 🔴 **四條約束各一格 + 兩個對照**:少了對照, 一個「永遠回 null」的實作每一格都綠。
describe('成功回應的 provider 訊息 id', () => {
  // 🔴🔴 **本組已隨設計改寫**(opus R2 · MF1 + C1;主視窗 2026-09-06 裁「用設計讓它消失」)——
  //    ⛔ ~~替身餵 `content-length` 標頭 + `text()`~~ **整組作廢**:碼不再看任何宣告。
  //    ✅ 現在餵的是一條**可以逐塊讀的 body**, 而測試量的是「它讀了幾塊、有沒有 cancel」。
  //    📌 **舊的那幾格(缺標頭 / Infinity / 宣告超標 ⇒ 不叫 text())連【題目】都不存在了** ——
  //      它們問的是「你怎麼採信那個宣告」, 而現在沒有宣告可採信。
  const OK_BODY = JSON.stringify({ id: 'resend-abc-123' });

  /** 把一段字串做成一條**分塊**的 body 替身, 並把「讀了幾塊 / cancel 了沒」量出來。 */
  const streamOf = (raw: string, chunkSize = 512) => {
    const bytes = new TextEncoder().encode(raw);
    const stats = { reads: 0, cancelled: 0, consumed: 0 };
    return {
      stats,
      body: {
        getReader: () => ({
          read: async () => {
            stats.reads += 1;
            if (stats.consumed >= bytes.length) return { done: true };
            const value = bytes.slice(stats.consumed, stats.consumed + chunkSize);
            stats.consumed += value.byteLength;
            return { done: false, value };
          },
          cancel: async () => {
            stats.cancelled += 1;
          },
        }),
      },
    };
  };

  const okRes = (over: Record<string, unknown> = {}) => ({
    ok: true,
    status: 200,
    // 🛑 **替身【故意不帶 headers】** —— 那本身就是一格斷言:
    //    判準若還偷看 `content-length`, 正對照當場變 null。
    body: streamOf(OK_BODY).body,
    ...over,
  });

  const sendWith = async (res: unknown) =>
    new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, (async () => res) as never).send(INPUT);

  it('🟢 正對照:正常成功回應 ⇒ 拿到那個 id(沒有它, 下面每個 null 都證不到事)', async () => {
    expect(await sendWith(okRes())).toEqual({ kind: 'sent', providerMessageId: 'resend-abc-123' });
  });

  it('🟢🔴 **判準不再依賴宣告**:回應【完全沒有 headers】也照樣拿得到 id(opus R2-C1)', async () => {
    // 🔴 這一格是 C1 的直接反證:HTTP/2 與 chunked 合法地不帶 content-length,
    //    而舊設計在那個世界【每一列都是 null 且零訊號】—— 與「一切正常」在儀表上同形。
    const r = await sendWith({ ok: true, status: 200, body: streamOf(OK_BODY).body });
    expect(r).toEqual({ kind: 'sent', providerMessageId: 'resend-abc-123' });
  });

  it('🔴 id 不是 string ⇒ null, 而【仍然是 sent】(信真的寄出去了)', async () => {
    const r = await sendWith(okRes({ body: streamOf(JSON.stringify({ id: 12345 })).body }));
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
  });

  it('🔴 body 不是 JSON ⇒ null, 仍然 sent', async () => {
    expect(await sendWith(okRes({ body: streamOf('not json').body }))).toEqual({
      kind: 'sent',
      providerMessageId: null,
    });
  });

  it('🔴🔴 超標的 body:【讀到上限就放棄】—— 沒讀完、有 cancel、而且沒有 parse', async () => {
    // 🔬 `{"id":"中".repeat(1500)}` ⇒ 字元 1509 而 **位元組 4509** ⇒ 超過 4096 上限。
    //    🔴 **這一格取代舊的「宣告騙人 ⇒ 第二道擋下」** —— 那時是先讀完整份再量;
    //      現在是**邊讀邊數**, 所以多了兩個舊測試量不到的讀數:
    //      ① 它有沒有讀完整份 ② 它有沒有把連線收掉。
    const huge = JSON.stringify({ id: '中'.repeat(1500) });
    const src = streamOf(huge);
    // 🔵 這一格量的是**邊界**(剛好超過);「有沒有提早停」由下一格量 ——
    //    ⚠️ **兩件事要分兩格量**:這份 body 只超標 413 bytes, 讀到超標的那一塊時它本來就讀完了
    //    ⇒ 在這一格斷言「沒讀完」會**因為 body 太小而必紅**, 那不是碼的問題。
    //    📌 我第一版把兩個宣稱寫在同一格 ⇒ 期望 `4509 < 4509` ⇒ 它當場告訴我這格量不到那件事。
    const parseSpy = vi.spyOn(JSON, 'parse');
    try {
      const r = await sendWith(okRes({ body: src.body }));
      expect(r).toEqual({ kind: 'sent', providerMessageId: null });
      expect(parseSpy, '🔴 超標的 body 不可以被 JSON.parse 碰到').not.toHaveBeenCalled();
      expect(src.stats.cancelled, '🔴 提早放棄要把連線收掉').toBe(1);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('🔴🔴 body 遠遠超標 ⇒ 【讀到上限就停】, 沒有把整份讀完(這才是「有上界」那句話的本體)', async () => {
    // 🔬 60,000 bytes 的 body ⇒ 上限 4096、每塊 512 ⇒ 最多讀到 4608 就該放棄。
    //    🔴 一個「先讀完再量」的實作在這一格會把 60,000 全部讀進來 ⇒ 紅。
    //    📌 而舊設計在【標頭說謊說很小】的世界正是那樣 —— **無上界**。
    const monster = JSON.stringify({ id: '中'.repeat(20000) });
    const src = streamOf(monster);
    const total = new TextEncoder().encode(monster).byteLength;
    const r = await sendWith(okRes({ body: src.body }));
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
    expect(src.stats.consumed, '🔴 不可以把整份讀完').toBeLessThan(total);
    expect(src.stats.consumed, '🔴 上界 = 上限 4096 + 最後一塊 512').toBeLessThanOrEqual(4096 + 512);
    expect(src.stats.cancelled).toBe(1);
  });

  it('🔴 原型污染:Object.prototype.id 不得被當成 provider id(codex R1-#4)', async () => {
    const proto = Object.prototype as unknown as { id?: unknown };
    proto.id = 'not-a-provider-id';
    try {
      const r = await sendWith(okRes({ body: streamOf('{}').body }));
      expect(r).toEqual({ kind: 'sent', providerMessageId: null });
    } finally {
      delete proto.id;
    }
  });

  it('🔴 格式白名單:id 是一個信箱 / 含空白的字串 ⇒ 不落庫(codex R1-#5)', async () => {
    for (const bad of ['leak@example.com', 'a b', '中文', 'x'.repeat(65), '']) {
      const r = await sendWith(okRes({ body: streamOf(JSON.stringify({ id: bad })).body }));
      expect(r, `🔴 [${bad.slice(0, 12)}] 不該被當成 provider id`).toEqual({
        kind: 'sent',
        providerMessageId: null,
      });
    }
  });

  it('🟢 正對照:合法形狀的 id ⇒ 落庫(否則上面那幾格的 null 證不到事)', async () => {
    const body = JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    const r = await sendWith(okRes({ body: streamOf(body).body }));
    expect(r).toEqual({ kind: 'sent', providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
  });

  it('🛑 其餘欄位【一個都不讀】—— 回應多帶東西也只拿 id', async () => {
    const multi = JSON.stringify({ id: 'ok-1', to: 'leak@example.com', html: '<b>x</b>' });
    const r = await sendWith(okRes({ body: streamOf(multi).body }));
    // 🔴 結果物件裡不可以出現那兩個值 —— 用整串 JSON 找, 不靠列舉欄名。
    expect(JSON.stringify(r)).not.toContain('leak@example.com');
    expect(JSON.stringify(r)).not.toContain('<b>x</b>');
    expect(r).toEqual({ kind: 'sent', providerMessageId: 'ok-1' });
  });

  it('🔵 沒有 body 的替身 ⇒ null 而不是 throw(拿不到 id 不可以讓已寄出的信變失敗)', async () => {
    expect(await sendWith({ ok: true, status: 200 })).toEqual({ kind: 'sent', providerMessageId: null });
  });

  it('🔵 body 在, 而 getReader 不是函式 ⇒ null, 而且【不退回 text()】', async () => {
    // 🔴 **退回 `text()` 會把剛拆掉的無上界緩衝裝回來, 而且只在某些 runtime 上裝回來。**
    let textCalled = 0;
    const r = await sendWith({
      ok: true,
      status: 200,
      body: {},
      text: async () => {
        textCalled += 1;
        return OK_BODY;
      },
    });
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
    expect(textCalled, '🔴 不可以有 text() 這條後路').toBe(0);
  });

  it('🔵 讀到一半 throw ⇒ null 而不是 throw(已寄出的信不可以變失敗)', async () => {
    const r = await sendWith({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            throw new Error('socket died');
          },
          cancel: async () => undefined,
        }),
      },
    });
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
  });
});

// ══════════════════════════════════════════════════════════════════
// ⟦mail-FETCHTIMEOUT⟧ 送出的 fetch 有逾時上界(opus R2 · C2;主視窗 2026-09-06 裁三題)
// ══════════════════════════════════════════════════════════════════
describe('送出的 fetch 有逾時上界', () => {
  it('🔴 每一發都帶 signal, 而它是【真的】AbortSignal(拿掉那一行 ⇒ undefined ⇒ 紅)', async () => {
    const seen: unknown[] = [];
    const f = async (_u: string, init: { signal?: unknown }) => {
      seen.push(init.signal);
      return { ok: true, status: 200 };
    };
    await sendWith(f);
    expect(seen).toHaveLength(1);
    expect(seen[0], '🔴 沒有 signal ⇒ 這個 await 沒有上界').toBeInstanceOf(AbortSignal);
    expect((seen[0] as AbortSignal).aborted, '🟢 才剛送出, 還沒到期').toBe(false);
  });

  it('🔴🔴 ② header 已回來、讀 body 時才到期 ⇒ 【sent / id=null】, 不是 failed(codex R1 #4)', async () => {
    // 🔴 **這一格是本組最重要的一格, 而我原本【沒有】它** —— 我當時寫「逾時 ⇒ network_error」,
    //    而那句只對①(header 都還沒回來)。②這條路 fetch 的 promise **已經 resolve 了**,
    //    abort 只打在 body 的 stream 上 ⇒ `readSentId` 收成 null ⇒ 結果是 `sent`。
    // ✅ 而②標 `sent` 是**對的**:200 回來了 = provider 收下了那封信。
    //    📌 兩條路都不會讓那一列卡在 `sending` —— 那才是這個 signal 買到的東西。
    const r = await sendWith(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            throw new DOMException('The operation was aborted', 'AbortError');
          },
          cancel: async () => undefined,
        }),
      },
    }));
    expect(r).toEqual({ kind: 'sent', providerMessageId: null });
  });

  it('🔴 ① header 都還沒回來就到期 ⇒ kind failed / errorCode network_error(而【不是】丟例外出去)', async () => {
    // 🛑 **這一格【模擬】abort 的 rejection, 而不是真的等 10 秒** —— 那個拆法是刻意的:
    //    ① `AbortSignal.timeout` 用的是 runtime 內部的計時器, **假時鐘推不動它**;
    //    ② 而這一格要問的是**我們怎麼處理那個 rejection**, 不是「計時器準不準」。
    //    ⇒ 📌 「signal 有沒有接上」由上一格答, 「接上之後怎麼收」由這一格答 ——
    //      **兩個宣稱拆兩格, 否則其中一個會借另一個的名字綠。**
    const f = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const r = await sendWith(f);
    expect(r).toEqual({ kind: 'failed', errorCode: 'network_error' });
  });

  it('🔴 重試不會變成兩封:同一個 outbox 的第二發帶【同一把】冪等鍵', async () => {
    // 🔴 這一格是「標 failed 可重排」那個裁定的**前提**(主視窗 2026-09-06 `Q-逾時後那一列 = 乙`)——
    //    📌 前提不成立的話, 那個裁定會讓客人收到兩封。
    const keys: unknown[] = [];
    const f = async (_u: string, init: { headers: Record<string, string> }) => {
      keys.push(init.headers['Idempotency-Key']);
      return { ok: true, status: 200 };
    };
    await sendWith(f);
    await sendWith(f);
    // 🔴 期望值**從 INPUT 推導**, 不硬寫字面 —— 我第一版硬寫 `order_created/outbox-1`
    //    而 fixture 的 outboxId 是一個 UUID ⇒ 那一格紅在**我寫錯期望值**, 不是碼。
    //    📌 一個硬寫的期望值, 綁的是【我以為的 fixture】而不是那個 fixture。
    expect(keys[0]).toBe(`${INPUT.idempotency.eventType}/${INPUT.idempotency.outboxId}`);
    expect(keys[1], '🔴 第二發要與第一發【逐字相同】, 否則 Resend 的 24h 去重接不住').toBe(keys[0]);
    // 🛑 **射程明寫(codex R1 #11 說得對)**:這一格證的是**這個字串是決定性的**,
    //    它**證不到** DB 回收 / 死信重排 / Resend 那一側真的去重 —— 那三件事各在別的層。
    //    ⚠️ 而已知的缺口是:`attempts` 燒完進死信後**人手重排若超過 24 小時**,
    //      去重窗已過期 ⇒ **客人會收到第二封**(見 adapter 那段註解)。
  });

  it('🟢 正對照:`AbortSignal.timeout` 在這個 runtime 上真的存在(plan 裡標「未量」的那一項)', () => {
    expect(typeof AbortSignal.timeout).toBe('function');
    const s = AbortSignal.timeout(10_000);
    expect(s).toBeInstanceOf(AbortSignal);
    expect(s.aborted).toBe(false);
  });
});
