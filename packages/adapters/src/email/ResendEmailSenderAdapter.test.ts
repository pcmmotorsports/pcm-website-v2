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
    expect(r).toEqual({ kind: 'sent' });
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
    expect(r).toEqual({ kind: 'sent' });
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
    await expect(sendWith(f, { attachments: [exact] })).resolves.toEqual({ kind: 'sent' });
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
    await expect(sendWith(f, { attachments: [PDF] })).resolves.toEqual({ kind: 'sent' });
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
