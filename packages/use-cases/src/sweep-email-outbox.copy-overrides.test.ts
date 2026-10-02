import { describe, expect, it, vi } from 'vitest';
import type { ClaimedEmailJob, EmailCopyVersionRow, IEmailCopyVersionsReader, IEmailOutbox } from '@pcm/ports';
import { sweepEmailOutbox, type SweepEmailOutboxOptions } from './sweep-email-outbox';

// 信件文字第 2 片(2b):寄信時用員工改的字。
// 計畫 ~/pcm-mailbox/計畫-信件文字第2片-資料庫與寄信接線-20261002.md(Fable R1/R2 審過)。
// 🔴 刻意放在獨立的檔:sweep-email-outbox.test.ts 檔尾的逐字快照收集那支檔寄出的每一封信,
//    這裡寄出的是改過字的信, 放進去會讓快照紅。

const NOW = new Date('2026-10-02T10:00:00.000Z');
const OPTS: SweepEmailOutboxOptions = {
  siteUrl: 'https://shop.pcmmotorsports.com',
  allowOrderShipped: true,
  allowOrderCancelled: true,
  allowOrderUnpaidCancelled: true,
  allowBankOrderCreated: true,
  allowBankOrderAmountChanged: true,
  allowPartialRefund: true,
  allowPartiallyCancelled: true,
  allowReturnReceived: true,
  claimLimit: 20,
  runStartedAtMs: NOW.getTime(),
  maxRunSeconds: 60,
  leaseSeconds: 3600,
  now: () => NOW,
  random: () => 0,
};

function cancelJob(over: Partial<ClaimedEmailJob> = {}): ClaimedEmailJob {
  return {
    id: 'outbox-1',
    eventType: 'order_unpaid_cancelled',
    orderId: 'order-1',
    dedupKey: 'order-1',
    recipientEmail: 'customer@example.com',
    subject: 'PCM 訂單 PCM-2026-0001 已取消',
    payload: { display_id: 'PCM-2026-0001', cancelled_reason: '依您要求取消' },
    attempts: 1,
    maxAttempts: 5,
    requestId: null,
    handedToProviderAt: null,
    channel: 'email',
    createdAt: '2026-10-02T09:00:00.000Z',
    ...over,
  };
}

/** 只實作這幾格會用到的方法;其他方法被呼叫就大聲炸(不安靜地過)。 */
function outboxFake(jobs: ClaimedEmailJob[]) {
  const known = {
    reclaimStaleLeases: vi.fn().mockResolvedValue(0),
    claimDue: vi.fn().mockResolvedValue(jobs),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    markHandedToProvider: vi.fn().mockResolvedValue(true),
    releaseClaimForCutoffUnknown: vi.fn().mockResolvedValue(true),
  };
  return new Proxy(known, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof typeof target];
      if (prop === 'then') return undefined;
      return vi.fn().mockRejectedValue(new Error(`未預期地呼叫了 ${prop}`));
    },
  }) as unknown as IEmailOutbox & typeof known;
}

function sender() {
  return { send: vi.fn().mockResolvedValue({ kind: 'sent', providerMessageId: null }) };
}
const eligibleAll = { listDueIneligible: async () => [], listIneligibleAmong: async () => [] };

function versions(rows: EmailCopyVersionRow[] | 'throw'): IEmailCopyVersionsReader {
  return {
    listAll: rows === 'throw' ? vi.fn().mockRejectedValue(new Error('down')) : vi.fn().mockResolvedValue(rows),
  };
}
const row = (over: Partial<EmailCopyVersionRow>): EmailCopyVersionRow => ({
  id: 'v-1',
  copyKey: 'unpaidCancelledNoCharge',
  text: '這張訂單還沒付款，不會向您收取任何費用。',
  savedAt: '2026-10-02T08:00:00.000Z',
  ...over,
});

async function run(jobs: ClaimedEmailJob[], copy?: IEmailCopyVersionsReader) {
  const outbox = outboxFake(jobs);
  const s = sender();
  const result = await sweepEmailOutbox(
    { ineligibleScanner: eligibleAll, outbox, sender: s, ...(copy === undefined ? {} : { copyVersions: copy }) },
    OPTS,
  );
  const texts = s.send.mock.calls.map((c) => (c[0] as { text: string; html?: string }));
  return { outbox, result, texts };
}

const DEFAULT_SENTENCE = '這張訂單尚未付款，不會有任何款項產生。';

describe('寄信用員工改的字', () => {
  it('沒接版本表 ⇒ 用程式預設(= 今天的行為)', async () => {
    const { texts } = await run([cancelJob()]);
    expect(texts[0]?.text).toContain(DEFAULT_SENTENCE);
  });

  it('排隊之前存的新字 ⇒ 信裡是新字;純文字與 HTML 都是', async () => {
    const { texts, result } = await run([cancelJob()], versions([row({})]));
    expect(texts[0]?.text).toContain('這張訂單還沒付款，不會向您收取任何費用。');
    expect(texts[0]?.text).not.toContain(DEFAULT_SENTENCE);
    expect(texts[0]?.html).toContain('這張訂單還沒付款，不會向您收取任何費用。');
    expect(result.errors).toBe(0);
  });

  it('排隊之後才存的字 ⇒ 這封信仍用排隊當時的版本(重試時文字不變)', async () => {
    const { texts } = await run([cancelJob()], versions([row({ savedAt: '2026-10-02T09:30:00.000Z' })]));
    expect(texts[0]?.text).toContain(DEFAULT_SENTENCE);
  });

  it('最新一版是「還原成預設」(text = null) ⇒ 用預設', async () => {
    const { texts } = await run(
      [cancelJob()],
      versions([row({ id: 'a', savedAt: '2026-10-02T07:00:00.000Z' }), row({ id: 'b', text: null })]),
    );
    expect(texts[0]?.text).toContain(DEFAULT_SENTENCE);
  });

  it('同一時間兩版 ⇒ 用 id 決定先後(結果固定)', async () => {
    const { texts } = await run(
      [cancelJob()],
      versions([row({ id: 'b', text: '版本 B，不會有任何款項產生。' }), row({ id: 'a', text: '版本 A，不會有任何款項產生。' })]),
    );
    expect(texts[0]?.text).toContain('版本 B，不會有任何款項產生。');
  });

  it('檢查不過的字(少了必填代號)⇒ 那一句用預設, 不寄出 {訂單編號} 這種字', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { texts } = await run(
      [cancelJob()],
      versions([row({ copyKey: 'cancelledHeadlineWithId', text: '您的訂單已經取消了。' })]),
    );
    expect(texts[0]?.text).toContain('您的訂單 PCM-2026-0001 已取消。');
    expect(texts[0]?.text).not.toMatch(/[{}]/);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('帶代號的句子 ⇒ 代號換成這張單的資料', async () => {
    const { texts } = await run(
      [cancelJob()],
      versions([row({ copyKey: 'cancelledHeadlineWithId', text: '訂單 {訂單編號} 已為您取消。' })]),
    );
    expect(texts[0]?.text).toContain('訂單 PCM-2026-0001 已為您取消。');
  });

  it('鎖住的句子(半形「您好,」)就算表裡有字也不採用', async () => {
    const { texts } = await run([cancelJob()], versions([row({ copyKey: 'greetingHalfwidth', text: '哈囉,' })]));
    expect(texts[0]?.text).not.toContain('哈囉');
  });

  it('員工的字有 & ⇒ HTML 版被逃逸, 純文字照原樣', async () => {
    const { texts } = await run([cancelJob()], versions([row({ text: '尚未付款 & 不會收費。' })]));
    expect(texts[0]?.text).toContain('尚未付款 & 不會收費。');
    expect(texts[0]?.html).toContain('尚未付款 &amp; 不會收費。');
  });
});

describe('讀不到版本表', () => {
  it('還沒交給 Resend 的信 ⇒ 用預設照寄;errors 只加 1、copyTableUnreadable = 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { texts, result } = await run(
      [cancelJob({ id: 'a', orderId: 'o-a' }), cancelJob({ id: 'b', orderId: 'o-b' })],
      versions('throw'),
    );
    expect(texts).toHaveLength(2);
    expect(texts[0]?.text).toContain(DEFAULT_SENTENCE);
    expect(result.errors).toBe(1);
    expect(result.copyTableUnreadable).toBe(1);
    err.mockRestore();
  });

  it('交給過 Resend 的信 ⇒ 這一輪不寄, 放回佇列且不算一次嘗試', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const j = cancelJob({ handedToProviderAt: '2026-10-02T09:01:00.000Z', attempts: 2 });
    const { texts, outbox, result } = await run([j], versions('throw'));
    expect(texts).toHaveLength(0);
    expect(outbox.releaseClaimForCutoffUnknown).toHaveBeenCalledWith('outbox-1', 2, expect.any(String));
    expect(outbox.markHandedToProvider).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    err.mockRestore();
  });

  it('沒有認領到任何信 ⇒ 不讀版本表(省一次查詢)', async () => {
    const copy = versions([row({})]);
    await run([], copy);
    expect(copy.listAll).not.toHaveBeenCalled();
  });
});
