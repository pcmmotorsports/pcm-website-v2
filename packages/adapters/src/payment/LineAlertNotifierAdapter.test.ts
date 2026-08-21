// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { LineAlertNotifierAdapter, type FetchLike } from './LineAlertNotifierAdapter';
import type { AnomalyAlertMessage } from '@pcm/domain';

const TOKEN = 'line-secret-token-xyz';
const TO = 'U線用戶id';
const MSG: AnomalyAlertMessage = { subject: '⚠️ PCM 付款異常告警', text: '• 雙扣候選(open,待查證)1 筆' };

function fetchOk(): FetchLike & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok: true, status: 200 })) as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

describe('LineAlertNotifierAdapter.notify(LINE Messaging API push)', () => {
  it('POST LINE push endpoint、Bearer token、body 含 to + 純文字訊息(subject+text)', async () => {
    const f = fetchOk();
    await new LineAlertNotifierAdapter({ accessToken: TOKEN, to: TO }, f).notify(MSG);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.to).toBe(TO);
    expect(body.messages[0].type).toBe('text');
    expect(body.messages[0].text).toContain('雙扣候選');
    expect(body.messages[0].text).toContain(MSG.subject);
  });

  it('🔴 非 2xx → throw 通用訊息 + status,**不含 token / 對象 id**', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as FetchLike;
    const adapter = new LineAlertNotifierAdapter({ accessToken: TOKEN, to: TO }, f);
    await expect(adapter.notify(MSG)).rejects.toThrow('status 401');
    try {
      await adapter.notify(MSG);
    } catch (e) {
      const m = (e as Error).message;
      expect(m).not.toContain(TOKEN);
      expect(m).not.toContain(TO);
    }
  });

  it('transport 失敗(fetch reject)→ 上拋', async () => {
    const f = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as FetchLike;
    await expect(new LineAlertNotifierAdapter({ accessToken: TOKEN, to: TO }, f).notify(MSG)).rejects.toThrow();
  });

  // 🔴 管道標記(2026-08-21,窗 G)。它要解的不是「Sean 分不出這封在哪個 App」——
  //    是**那段文字被複製出來之後,來源就掉了**(他 08-21 早上貼回內文當證據,而那段文字
  //    不會說明它從哪個管道來 ⇒ 我們量到「兩管道都回 2xx」卻推不出「兩個收件對象都正確」)。
  // ⇒ 所以標記必須跟著【文字】走。這一格守的就是「它有沒有跟著文字出去」。
  it('🔴 訊息文字裡帶【LINE】的管道標記,而且不是 Email 那一個', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as FetchLike;
    await new LineAlertNotifierAdapter({ accessToken: TOKEN, to: TO }, f).notify(MSG);
    const [, init] = (f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]!;
    const text = JSON.parse(init.body).messages[0].text as string;
    expect(text).toContain('這封是從 LINE 送出的');
    // 🔴 負向那一半:兩個標記必須【互斥】—— 否則收件人拿到兩句話一樣分不出來
    expect(text).not.toContain('這封是從 Email 送出的');
  });
});
