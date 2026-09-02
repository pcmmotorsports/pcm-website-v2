import { describe, expect, it, vi } from 'vitest';
import type {
  ClaimedEmailJob,
  IEmailOutbox,
  IEmailSender,
  IIneligibleOrderEmailScanner,
  IPaidEmailContext,
  LoadPaidContextResult,
  PaidEmailContext,
  SendEmailResult,
} from '@pcm/ports';
import { computeEmailBackoff, LEASE_RECLAIM_RETRY_DELAY_MS } from './email-backoff';
import { sweepEmailOutbox, type SweepEmailOutboxOptions } from './sweep-email-outbox';

const NOW = new Date('2026-07-17T10:00:00.000Z');

const OPTS: SweepEmailOutboxOptions = {
  // 🔴 預設 `true` = 「出貨線已上膛」的那個世界 —— 絕大多數測項跑的是它。
  //    ⚠️ 而**那是一個世界,不是一個中性預設** ⇒ 另一個世界(線關著)必須有專屬的一節,
  //       否則這道閘在測試層等於沒有被量過(同 `eligibleAll()` 那一格的理由)。
  allowOrderShipped: true,
  claimLimit: 20,
  // 🔴 與 `now` 同一個時鐘 ⇒ 本輪已用時間恆為 0 ⇒ 這組預設仍是「預算滿滿」的那個世界
  //    (`⟦b4-SWEEPBUDGET1⟧`)。預算相關的測項自己覆寫這一欄,不改這裡。
  runStartedAtMs: NOW.getTime(),
  maxRunSeconds: 60,
  leaseSeconds: 3600,
  now: () => NOW,
  random: () => 0,
};

/** 依序回傳指定時點的假時鐘(超出序列後重覆最後一個;鎖「單一快照」類斷言用)。 */
function tickingClock(offsetsMs: number[]): () => Date {
  let i = 0;
  return () => new Date(NOW.getTime() + offsetsMs[Math.min(i++, offsetsMs.length - 1)]!);
}

function job(overrides: Partial<ClaimedEmailJob> = {}): ClaimedEmailJob {
  return {
    id: 'outbox-1',
    eventType: 'order_created',
    orderId: 'order-1',
    dedupKey: 'order-1',
    recipientEmail: 'customer@example.com',
    subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
    payload: { event_version: 1, display_id: 'PCM-2026-0001', paid_at: '2026-07-17T09:00:00.000Z' },
    attempts: 1,
    maxAttempts: 5,
    requestId: null,
    ...overrides,
  };
}

type OutboxFake = IEmailOutbox & {
  reclaimStaleLeases: ReturnType<typeof vi.fn>;
  claimDue: ReturnType<typeof vi.fn>;
  markSent: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  markSkippedOrderIneligible: ReturnType<typeof vi.fn>;
  // 🔴 ⟦b4-MAILCANCEL1⟧(2026-09-02):付款信在寄送當下發現單已取消 ⇒ 標終態、不寄、**不計 error**。
  //    它與上一行【只差 `last_error_code`】,而那個差是承重的(全文在 `IEmailOutbox` 的 docstring)。
  markSkippedOrderCancelled: ReturnType<typeof vi.fn>;
  markSkippedShipmentVoided: ReturnType<typeof vi.fn>;
};

function outboxFake(jobs: ClaimedEmailJob[], overrides: Partial<Record<keyof IEmailOutbox, unknown>> = {}): OutboxFake {
  return {
    enqueue: vi.fn().mockRejectedValue(new Error('sweeper 不應呼叫 enqueue')),
    claimById: vi.fn().mockRejectedValue(new Error('sweeper 不應呼叫 claimById')),
    reclaimStaleLeases: vi.fn().mockResolvedValue(0),
    claimDue: vi.fn().mockResolvedValue(jobs),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    // 🔴 **預設 reject 是刻意的,而它的理由在 2026-08-30 換了一個**:
    //    ~~原本:「ineligible gate = E2a-2、本片不呼」~~ —— Sean 拍「Q2 取消信縫 = 甲 搬」之後
    //    sweeper **會**呼它(不合格時)。⇒ 預設 reject 現在的意思是
    //    「**在沒有明講不合格的那些測項裡**,呼到它就是錯的」⇒ 呼到會大聲炸,不會安靜地過。
    //    要測「不合格 ⇒ 有呼」的那一格自己 `mockResolvedValue(true)`(見下面那一格)。
    markSkippedOrderIneligible: vi.fn().mockRejectedValue(new Error('未預期地呼叫了 markSkippedOrderIneligible(本測項的世界是【全部合格】)')),
    // 🔴 M-4b E4 片3a 新增。預設 reject 同上:在沒有明講「箱被作廢」的測項裡呼到它就是錯的
    //    ⇒ 大聲炸, 不會安靜地過。要測那條路的測項自己 mockResolvedValue(true)。
    markSkippedShipmentVoided: vi.fn().mockRejectedValue(new Error('未預期地呼叫了 markSkippedShipmentVoided(本測項的世界沒有作廢的箱)')),
    // 🔴 ⟦b4-MAILCANCEL1⟧ 新增。預設 reject 同上兩支:在沒有明講「單已取消」的測項裡呼到它就是錯的。
    //    ⇒ 📌 而這個預設**同時是一道守門**:一個「把 cancelled 併進 ineligible」的重構
    //      會讓那些測項呼到【另一支】⇒ 而那一支的預設也是 reject ⇒ 兩邊都炸得出來。
    markSkippedOrderCancelled: vi.fn().mockRejectedValue(new Error('未預期地呼叫了 markSkippedOrderCancelled(本測項的世界沒有被取消的單)')),
    ...(overrides as object),
  } as OutboxFake;
}

function senderFake(results: SendEmailResult[]): IEmailSender & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  for (const r of results) send.mockResolvedValueOnce(r);
  return { send };
}

/**
 * 合格性 scanner 的預設替身 = **全部合格**(回空陣列)。
 * 🔴 而「全部合格」是一個【世界】,不是一個中性預設 —— 底下絕大多數測項跑的都是那個世界,
 *    所以另一個世界(有單被取消)必須有專屬的一節,否則這道閘在測試層等於沒有被量過。
 */
function eligibleAll(): IIneligibleOrderEmailScanner {
  return { listDueIneligible: async () => [], listIneligibleAmong: async () => [] };
}

describe('sweepEmailOutbox — lease/maxRunSeconds 物理擋', () => {
  it.each([[3599], [0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'leaseSeconds=%s(< 3600 或非有限)→ throw、零副作用',
    async (leaseSeconds) => {
      const outbox = outboxFake([]);
      await expect(
        sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) }, { ...OPTS, leaseSeconds: leaseSeconds as number }),
      ).rejects.toThrow(/leaseSeconds/);
      expect(outbox.reclaimStaleLeases).not.toHaveBeenCalled();
      expect(outbox.claimDue).not.toHaveBeenCalled();
    },
  );

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'maxRunSeconds=%s(非 ≥1 有限數)→ throw、零副作用',
    async (maxRunSeconds) => {
      const outbox = outboxFake([]);
      await expect(
        sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) }, { ...OPTS, maxRunSeconds: maxRunSeconds as number }),
      ).rejects.toThrow(/maxRunSeconds/);
      expect(outbox.reclaimStaleLeases).not.toHaveBeenCalled();
    },
  );

  it('lease 必須 ≥ maxRunSeconds + 偏差餘裕 300:maxRunSeconds=3500、lease=3600 → throw(3600 < 3800)', async () => {
    const outbox = outboxFake([]);
    await expect(
      sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) }, { ...OPTS, maxRunSeconds: 3500, leaseSeconds: 3600 }),
    ).rejects.toThrow(/leaseSeconds/);
    await expect(
      sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) }, { ...OPTS, maxRunSeconds: 3500, leaseSeconds: 3800 }),
    ).resolves.toBeDefined();
  });
});

describe('sweepEmailOutbox — ① lease 回收', () => {
  it('claim 前必呼、staleBefore = now - lease、nextRetryAt = now + 5min(§⑩)', async () => {
    const outbox = outboxFake([]);
    outbox.reclaimStaleLeases.mockResolvedValue(2);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) }, OPTS);
    expect(outbox.reclaimStaleLeases).toHaveBeenCalledExactlyOnceWith(
      new Date(NOW.getTime() - 3600 * 1000),
      new Date(NOW.getTime() + LEASE_RECLAIM_RETRY_DELAY_MS),
    );
    // 回收先於 claim(claim 前必跑的順序合約)
    expect(outbox.reclaimStaleLeases.mock.invocationCallOrder[0]!).toBeLessThan(
      outbox.claimDue.mock.invocationCallOrder[0]!,
    );
    expect(res.reclaimed).toBe(2);
  });

  it('回收 throw → errors+1、不阻斷 claim 與寄送(fail-closed 續跑)', async () => {
    const outbox = outboxFake([job()]);
    outbox.reclaimStaleLeases.mockRejectedValue(new Error('db down'));
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    expect(res.errors).toBe(1);
    expect(res.reclaimed).toBe(0);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
  });
});

describe('sweepEmailOutbox — ② claim', () => {
  it('claimDue 帶 claimLimit;throw → errors+1、本輪零寄送', async () => {
    const outbox = outboxFake([]);
    outbox.claimDue.mockRejectedValue(new Error('db down'));
    const sender = senderFake([]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    // 🔵 ⟦b4-SHIPGATE1⟧ 2026-09-01:第二個參數是新加的。
    //    這一格的 `OPTS` 是 `allowOrderShipped: true`(線開著)⇒ 第二個參數是 `undefined`。
    //    🛑 **不是空陣列** —— 空陣列會讓 adapter 送出空的 `not in ()`(PostgREST 語法錯)。
    //    ✅ 而這一格【本來就會紅】正是它存在的理由:它釘的是呼叫形狀, 而我改了呼叫形狀。
    expect(outbox.claimDue).toHaveBeenCalledExactlyOnceWith(20, undefined);
    expect(res.errors).toBe(1);
    expect(res.claimed).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('sweepEmailOutbox — ③ 寄送與標記', () => {
  it('sent → markSent(id, attempts 世代柵欄原樣帶回);send 入參座標正確、text 含 display_id 零 PII', async () => {
    const j = job({ attempts: 3 });
    const outbox = outboxFake([j]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    expect(sender.send).toHaveBeenCalledExactlyOnceWith({
      to: 'customer@example.com',
      subject: j.subject,
      text: expect.stringContaining('PCM-2026-0001') as string,
      idempotency: { eventType: 'order_created', outboxId: 'outbox-1' },
    });
    // 內文不含收件者 email(PII 不進模板)
    const sentText = (sender.send.mock.calls[0]![0] as { text: string }).text;
    expect(sentText).not.toContain('customer@example.com');
    // 🔴 body 契約 = exact-match(2026-08-18 突變普查):對外不可回收的信,契約是【只能有這些】
    //    不是【至少要有這些】。stringContaining 只保「有編號+沒收件信箱」⇒ 把整包 payload JSON
    //    塞進 orderLine 時三條 contains 斷言全過(display_id 在 JSON 裡、收件 email 不在 payload 裡)。
    //    ⚠️ 血半徑:當前 code 安全 —— buildOrderCreatedText 只讀 display_id、不渲染任意 payload。
    //    本格釘的是【body 內容契約】,不是修一個現存的洩漏。靶用具名 fixture(job() 的 display_id
    //    'PCM-2026-0001'),不對真實 payload 做 exact(那會恆紅)。
    const EXPECTED_ORDER_CREATED_BODY = [
      '您好,',
      '',
      '您的訂單 PCM-2026-0001 已付款成功。',
      '我們將盡快為您安排出貨;訂單明細與最新狀態請至 PCM 會員中心查看。',
      '',
      'PCM重機零件販售',
    ].join('\n');
    expect(sentText).toBe(EXPECTED_ORDER_CREATED_BODY);
    expect(outbox.markSent).toHaveBeenCalledExactlyOnceWith('outbox-1', 3);
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(res).toEqual({
      reclaimed: 0, claimed: 1, sent: 1, failed: 0, budgetExhaustedBeforeClaim: 0,
      deferred: 0, staleMarks: 0, errors: 0, skippedIneligible: 0, eligibilityUnknown: 0, quotaFailed: 0,
      skippedShipmentVoided: 0,
    });
  });

  it('failed → markFailed(errorCode + email-backoff 算的 nextRetryAt)', async () => {
    const j = job({ attempts: 2 });
    const outbox = outboxFake([j]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'quota_daily_exceeded' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    expect(outbox.markFailed).toHaveBeenCalledExactlyOnceWith(
      'outbox-1',
      2,
      'quota_daily_exceeded',
      computeEmailBackoff('quota_daily_exceeded', 2, NOW, () => 0),
    );
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    expect(res.errors).toBe(0);
  });

  // 🔴 **`quotaFailed` 的兩格必須並排讀**(2026-08-29 線D)——
  //    只有正對照的話,一個「每次 failed 都 ++」的實作也會全綠,而那正是我們**不要**的「甲」。
  it('🔴 額度用盡的碼 ⇒ quotaFailed 跟著 ++(與 failed 分開計)', async () => {
    const outbox = outboxFake([job({ attempts: 1 })]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'quota_monthly_exceeded' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    // 🔴 怎麼會紅:拿掉 use-case 裡那個 errorCode 判斷 ⇒ 這裡 1 變 0。
    expect(res.quotaFailed).toBe(1);
    expect(res.failed).toBe(1);
  });

  it('🔴 F1:`http_429` 也算額度用盡(分母由 POLICY_BY_CODE 推導,不是手寫兩碼)', async () => {
    const outbox = outboxFake([job({ attempts: 1 })]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'http_429' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    // 🔴 怎麼會紅:改回手寫 `=== 'quota_daily_exceeded' || === 'quota_monthly_exceeded'` ⇒ 1 變 0。
    // 📌 這一格釘的是【有意納入】,不是巧合 —— 沒有它,「納入」與「忘了排除」在測試上長一樣。
    //    理由:`IEmailOutbox.ts` 的 `http_429` JSDoc 逐字「若實際不含 `name` → 所有 429 都落本格」
    //    ⇒ 那個世界裡額度爆掉就是回這個碼。
    expect(res.quotaFailed).toBe(1);
  });

  it('🔴 [負對照] 一般失敗碼 ⇒ failed++ 而 quotaFailed 保持 0', async () => {
    const outbox = outboxFake([job({ attempts: 1 })]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'http_500' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    // 🔴 怎麼會紅:改成無條件 `result.quotaFailed++` ⇒ 這裡 0 變 1。
    //    📌 沒有這一格,新欄位就只是 `failed` 的複本,而 route 的判定會退回「甲」的行為。
    // ⚠️ 而 `rate_limited`(短暫節流)同樣**不算**額度用盡 —— 它會自己好,額度用盡不會。
    expect(res.quotaFailed, 'quotaFailed 變成 failed 的複本 ⇒ 告警天天叫').toBe(0);
    expect(res.failed).toBe(1);
  });

  it('failed(指數碼)→ nextRetryAt 隨 attempts 翻倍(鎖 attempts→退避 wiring;R1 must-fix 2)', async () => {
    const j = job({ attempts: 3 });
    const outbox = outboxFake([j]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'http_500' }]);
    await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    // attempts=3 → 5min×2^2 = 20min;sweeper 若寫死 attempts(如恆 1 → 5min)此斷言必紅
    expect(outbox.markFailed).toHaveBeenCalledExactlyOnceWith(
      'outbox-1',
      3,
      'http_500',
      new Date(NOW.getTime() + 20 * 60_000),
    );
  });

  it('markSent 回 false(所有權已失)→ staleMarks+1、非 error、不重標', async () => {
    const outbox = outboxFake([job()]);
    outbox.markSent.mockResolvedValue(false);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([{ kind: 'sent' }]) }, OPTS);
    expect(res.staleMarks).toBe(1);
    expect(res.sent).toBe(1);
    expect(res.errors).toBe(0);
    expect(outbox.markSent).toHaveBeenCalledTimes(1);
  });

  it('markFailed 回 false → staleMarks+1、非 error', async () => {
    const outbox = outboxFake([job()]);
    outbox.markFailed.mockResolvedValue(false);
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([{ kind: 'failed', errorCode: 'http_500' }]) },
      OPTS,
    );
    expect(res.staleMarks).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toBe(0);
  });

  it('sender throw(合約違反)→ errors+1、零 mark(列留 sending 待下輪回收)、不中斷後續封', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2', dedupKey: 'order-2', orderId: 'order-2' });
    const outbox = outboxFake([j1, j2]);
    const sender = { send: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ kind: 'sent' }) };
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    expect(res.errors).toBe(1);
    expect(outbox.markSent).toHaveBeenCalledExactlyOnceWith('outbox-2', 1);
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(res.sent).toBe(1);
  });

  it('mark* throw(DB 錯)→ errors+1、續處理後續封;sent 仍記 provider 裁決數 2(codex R1 must-fix 3)', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2' });
    const outbox = outboxFake([j1, j2]);
    outbox.markSent.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(true);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([{ kind: 'sent' }, { kind: 'sent' }]) }, OPTS);
    expect(res.errors).toBe(1);
    expect(res.sent).toBe(2);
    expect(outbox.markSent).toHaveBeenCalledTimes(2);
  });

  it('markFailed throw → errors+1、failed 仍記 provider 裁決數(同上、失敗側)', async () => {
    const outbox = outboxFake([job()]);
    outbox.markFailed.mockRejectedValue(new Error('db down'));
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([{ kind: 'failed', errorCode: 'http_500' }]) },
      OPTS,
    );
    expect(res.errors).toBe(1);
    expect(res.failed).toBe(1);
  });

  it('order_shipped 列(DB 合法可造)→ 寄送前 fail-closed:sender 零呼叫、errors+1、零 mark(codex R1 must-fix 2)', async () => {
    const outbox = outboxFake([job({ eventType: 'order_shipped', dedupKey: 'order-1/batch-1' })]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    expect(sender.send).not.toHaveBeenCalled();
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(res.errors).toBe(1);
    expect(res.sent).toBe(0);
  });

  /**
   * 🔴 codex R2 must-fix 的證人:**合格性那一發 `await` 自己會穿越 deadline。**
   *    迴圈頭問預算時還沒到 60 秒,而那一發 DB 讀在 59.9 秒開始、60 秒之後才回來
   *    ⇒ 舊寫法會在**已經超時**的情況下呼叫 Resend ⇒ 平台 kill 在 send 途中
   *    ⇒ 列留 sending + 白燒一次 attempt,而**外觀與正常的 deferred 分不出來**。
   * 📌 判別句:**每一個會等的 await,都可能讓它前面那一次時間檢查過期。**
   * ⚠️ 這一格若把「讀完再問一次」拿掉就會紅 —— 它是那個修法的證人,不是裝飾。
   */
  it('🔴 合格性讀取【穿越】deadline ⇒ 這一封不得寄出(不是「已經檢查過了」)', async () => {
    const outbox = outboxFake([job({ id: 'outbox-1' }), job({ id: 'outbox-2' })]);
    const sender = senderFake([{ kind: 'sent' }, { kind: 'sent' }]);
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender },
      // ①t0 ②**認領前**問一次 t0(⟦b4-SWEEPBUDGET1⟧ 新增)③job1 迴圈頭 t0+1s(過)
      // ④job1 讀完之後 t0+61s(超)⇒ 一封都不寄
      // 🔴🔴 **這一格【綠著漂走過】** —— 沒補上 ② 的話,超時會提前在「job1 迴圈頭」發生,
      //    斷言(不寄 / deferred=2 / errors=0)**三條全部照樣成立**,
      //    而這支測試就不再是「合格性讀取穿越 deadline」的證人了。
      //    📌 一支測試可以在【它證明的東西已經換人】之後,繼續印綠。
      { ...OPTS, now: tickingClock([0, 0, 1000, 61_000]) },
    );
    expect(sender.send).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
    expect(res.deferred).toBe(2);
    expect(res.errors).toBe(0); // 逾時不是錯誤
  });

  it('時間預算耗盡 → 停寄、剩餘列計 deferred(codex R1 must-fix 1 縱深)', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2' });
    const j3 = job({ id: 'outbox-3' });
    const outbox = outboxFake([j1, j2, j3]);
    const sender = senderFake([{ kind: 'sent' }, { kind: 'sent' }, { kind: 'sent' }]);
    // 🔴 now 呼叫序在 2026-08-30 變了(codex R2 must-fix:合格性讀取【之後】要再問一次預算)——
    //    每一封現在問兩次:迴圈頭一次、`listIneligibleAmong` 回來之後一次。
    //    ①sweepStartedAt t0
    //    ②**認領前**問一次 t0(⟦b4-SWEEPBUDGET1⟧ 2026-08-30 新增的那一次)
    //    ③job1 迴圈頭 t0+1s(過)④job1 讀完之後 t0+1s(過)⇒ job1 寄出
    //    ⑤job2 迴圈頭 t0+61s(超 60s)⇒ 停,剩 2 封計 deferred
    //    📌 這個 fixture 是【硬編碼的呼叫序】⇒ 迴圈裡多一次 now() 就會位移。
    //       它紅過一次,而那個紅是【對的】—— 它在說「你改變了時間被問幾次」。
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender },
      { ...OPTS, now: tickingClock([0, 0, 1000, 1000, 61_000]) },
    );
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(res.deferred).toBe(2);
    expect(res.sent).toBe(1);
    expect(res.claimed).toBe(3);
    expect(res.errors).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⟦b4-SWEEPBUDGET1⟧(2026-08-30):預算基準 = **route 進來那一刻**,不是本函式的起點
  // ══════════════════════════════════════════════════════════════════════
  it('預算從 runStartedAtMs 起算:route 已經吃掉 59s ⇒ 這一輪很快就用盡(對照組:吃掉 1s ⇒ 照寄)', async () => {
    // 🔴 這一格是本片的核心,而它需要**兩個世界**才有判別力 ——
    //    只演「沒預算」的話,一個永遠回 0 的 outOfBudget 也會過。
    const late = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox: outboxFake([job()]), sender: senderFake([{ kind: 'sent' }]) },
      { ...OPTS, runStartedAtMs: NOW.getTime() - 59_000, maxRunSeconds: 60, now: tickingClock([0, 1500]) },
    );
    // 進來時已用 59s(> 預算 55s = 60 − 5 收尾餘裕)⇒ 認領前那一問就超出 ⇒ 連認領都不做
    // ⚠️ 標題原本寫「一進來就沒有預算」—— codex nit:那對【當時的】60s 預算不成立,已改。
    expect(late.claimed).toBe(0);
    expect(late.sent).toBe(0);
    expect(late.errors).toBe(1);

    const early = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox: outboxFake([job()]), sender: senderFake([{ kind: 'sent' }]) },
      { ...OPTS, runStartedAtMs: NOW.getTime() - 1_000, maxRunSeconds: 60, now: tickingClock([0, 1500]) },
    );
    expect(early.claimed).toBe(1);
    expect(early.sent).toBe(1);
    expect(early.errors).toBe(0);
  });

  it('預算已用盡 ⇒ 【不認領】(不白燒 attempts)、計 error 而不是 deferred', async () => {
    const outbox = outboxFake([job(), job({ id: 'outbox-2' })]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender },
      { ...OPTS, runStartedAtMs: NOW.getTime() - 120_000, now: tickingClock([0, 0]) },
    );
    // 🔴 這一條是本片的重點:`claimDue` 一次都不該被呼叫 ——
    //    認領當下 attempts 就 +1,而這一輪一封都寄不出去。
    expect(outbox.claimDue).not.toHaveBeenCalled();
    expect(res.claimed).toBe(0);
    expect(res.deferred).toBe(0); // 「已認領而來不及寄」才算 deferred,這裡一列都沒認領
    expect(res.errors).toBe(1); // 一輪連認領都排不進去 = 要吵(route 503 ⇒ 心跳掉)
    // 🔴 codex R3 must-fix 的證人:這一欄是**唯一**分得出「預算被吃光」與「claimDue 掛了」的字。
    expect(res.budgetExhaustedBeforeClaim).toBe(1);
    // 🔴 對照:回收仍然跑(它在認領之前、且不受預算管)⇒ 證明不是整個函式被短路掉
    expect(outbox.reclaimStaleLeases).toHaveBeenCalledTimes(1);
  });

  it('🔴 對照組:claimDue 掛了 ⇒ errors/claimed/sent 與「預算用盡」完全相同,只有那一欄不同', async () => {
    // 🔴 這一支才是 codex R3 must-fix 的**負對照** —— 上一支只證明「有那個字」,
    //    要證明它**分得開**,得把另一個世界擺在旁邊看它印出不同的值。
    const outbox = outboxFake([]);
    outbox.claimDue.mockRejectedValueOnce(new Error('DB 掛了'));
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) },
      { ...OPTS }, // 預算滿滿
    );
    expect(res.errors).toBe(1); // ← 與預算用盡那一輪相同
    expect(res.claimed).toBe(0); // ← 相同
    expect(res.sent).toBe(0); // ← 相同
    expect(res.budgetExhaustedBeforeClaim).toBe(0); // ← 🔴 只有這一格不同
  });

  it('runStartedAtMs 非有限數 ⇒ throw(那是呼叫端明確的 bug,不吞)', async () => {
    const deps = { ineligibleScanner: eligibleAll(), outbox: outboxFake([job()]), sender: senderFake([]) };
    await expect(
      sweepEmailOutbox(deps, { ...OPTS, runStartedAtMs: Number.NaN }),
    ).rejects.toThrow(/runStartedAtMs/);
  });

  // ── codex 2026-08-30 R1 三條 must-fix 的證人 ──────────────────────────────
  it('🔴 MF-2:runStartedAtMs 晚於本輪時鐘(校時回撥)⇒ 【不 throw】,降級回舊基準照常跑完', async () => {
    // 🔴 這一條原本是 throw,而 codex 指出:一次 1ms 的正常校時就會讓回收/認領/寄送全不跑、
    //    route 503 ⇒ **比它要防的問題嚴重**。⇒ 改成取較早的起點,自動退回本片之前的行為。
    const outbox = outboxFake([job()]);
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([{ kind: 'sent' }]) },
      { ...OPTS, runStartedAtMs: NOW.getTime() + 60_000 },
    );
    expect(res.sent).toBe(1); // 照常寄完,沒有炸
    expect(res.errors).toBe(0);
    expect(outbox.reclaimStaleLeases).toHaveBeenCalledTimes(1); // 回收也沒被跳過

    // 🔴🔴 **上面三條【殺不掉突變】** —— 把 `Math.min(...)` 換成直接用 `runStartedAtMs`,
    //    它們一樣全綠(未來值 ⇒ elapsed 為負 ⇒ 也不會炸、也照樣寄)。
    //    ⇒ 要有判別力,得讓兩個世界**印出不同的字**:時鐘往前走到超過預算那一刻 ——
    //      取 min(正確)⇒ 基準是 t0 ⇒ 56s > 55s ⇒ 停;
    //      直接用未來值(突變)⇒ 基準是 t0+60s ⇒ elapsed = −4s ⇒ 照寄。
    const outbox2 = outboxFake([job(), job({ id: 'outbox-2' })]);
    const res2 = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox: outbox2, sender: senderFake([{ kind: 'sent' }, { kind: 'sent' }]) },
      { ...OPTS, runStartedAtMs: NOW.getTime() + 60_000, now: tickingClock([0, 0, 56_000]) },
    );
    expect(res2.sent).toBe(0);
    expect(res2.deferred).toBe(2);
  });

  // 🛑 **這裡【沒有】MF-1(時鐘回撥)的測試,那是刻意的。**
  //    我寫過一支,而它是假的:對應的那段碼是**不可達的死碼**(四個問點每個超出都 `break`
  //    ⇒ 這道閘不會被問第二次)。把那段碼拿掉,測試照樣全綠。
  //    ⇒ 碼與測試都刪了,界線改寫在 `sweep-email-outbox.ts` 的 `budgetBaseMs` 那段。
  //    📌 一段防不到東西的碼 + 一支殺不掉突變的測試 = **兩份看起來有在防的證據,而缺口沒變。**

  it('🔴 MF-3:停止線【正好】釘在 maxRunSeconds − 5s(55.000 停 / 54.999 照寄)', async () => {
    // 🔴 為什麼要餘裕:59.999s 通過的那一發 `send`,Resend 可能在 60.01s 才收下,
    //    而平台當場 kill ⇒ markSent 沒寫 ⇒ 回收 ⇒ 重寄。⇒ 停止線要早於 kill 線。
    // 🔴🔴 **兩端【貼著那條線】,不是隨便取 56 / 54**(codex R2 must-fix):
    //    56/54 那組在「餘裕改成 4 秒」的世界裡**兩格都還是綠的** ⇒ 它釘得住「有餘裕」,
    //    釘不住「餘裕是多少」。⇒ 一支只證明得出「某個地方有條線」的測試,
    //    不會在那條線被搬動時出聲。
    const stopped = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox: outboxFake([job()]), sender: senderFake([{ kind: 'sent' }]) },
      { ...OPTS, runStartedAtMs: NOW.getTime() - 55_000, maxRunSeconds: 60, now: tickingClock([0, 0]) },
    );
    expect(stopped.claimed).toBe(0); // 55.000s >= 55s 預算 ⇒ 停(邊界是 `>=`)
    const ok = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox: outboxFake([job()]), sender: senderFake([{ kind: 'sent' }]) },
      { ...OPTS, runStartedAtMs: NOW.getTime() - 54_999, maxRunSeconds: 60, now: tickingClock([0, 0]) },
    );
    expect(ok.sent).toBe(1); // 差 1 毫秒 ⇒ 照寄
  });

  it('🔴 maxRunSeconds 小於收尾餘裕 ⇒ 預算落到 1 秒地板,不得變成 0 或負(那會是「永遠不寄而且安靜」)', async () => {
    // codex R2 must-fix:`Math.max(1000, …)` 那道防呆先前**零測項**,
    // 拿掉它一格都不會紅 ⇒ 一道沒有證人的防呆,與沒有裝是同一件事。
    const res = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox: outboxFake([job()]), sender: senderFake([{ kind: 'sent' }]) },
      // maxRunSeconds=3 < 餘裕 5 ⇒ 沒有地板的話預算 = −2000ms ⇒ elapsed 0 也算超出 ⇒ 一封都不寄
      { ...OPTS, runStartedAtMs: NOW.getTime(), maxRunSeconds: 3, now: tickingClock([0, 0]) },
    );
    expect(res.sent).toBe(1);
    expect(res.claimed).toBe(1);
  });

  it('回收參數出自單一時鐘快照:前進時鐘下 nextRetryAt-staleBefore 恆 = lease+5min(codex R1 must-fix 4)', async () => {
    const outbox = outboxFake([]);
    await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) },
      { ...OPTS, now: tickingClock([0, 1000, 2000, 3000]) },
    );
    const [staleBefore, nextRetryAt] = outbox.reclaimStaleLeases.mock.calls[0]! as [Date, Date];
    expect(nextRetryAt.getTime() - staleBefore.getTime()).toBe(3600 * 1000 + LEASE_RECLAIM_RETRY_DELAY_MS);
  });

  it('省略 now/random(production 預設路徑)→ 正常執行、回收參數與退避皆在真時鐘合理界內', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'quota_daily_exceeded' }]);
    const before = Date.now();
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, { allowOrderShipped: true, claimLimit: 20, runStartedAtMs: Date.now(), maxRunSeconds: 60, leaseSeconds: 3600 });
    const after = Date.now();
    const [staleBefore, nextRetryAt] = outbox.reclaimStaleLeases.mock.calls[0]! as [Date, Date];
    expect(nextRetryAt.getTime() - staleBefore.getTime()).toBe(3600 * 1000 + LEASE_RECLAIM_RETRY_DELAY_MS);
    expect(staleBefore.getTime()).toBeGreaterThanOrEqual(before - 3600 * 1000);
    expect(staleBefore.getTime()).toBeLessThanOrEqual(after - 3600 * 1000);
    const retryArg = (outbox.markFailed.mock.calls[0]! as [string, number, string, Date])[3];
    // 真 Math.random:quota 列 = [失敗時點+24h, +24h30m)
    expect(retryArg.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000);
    expect(retryArg.getTime()).toBeLessThan(after + 24 * 3600 * 1000 + 30 * 60_000);
    expect(res.failed).toBe(1);
  });

  it('逐封順序寄送(前一封 mark 完才寄下一封;無並發)', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2' });
    const outbox = outboxFake([j1, j2]);
    const sender = senderFake([{ kind: 'sent' }, { kind: 'sent' }]);
    await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    const firstMark = outbox.markSent.mock.invocationCallOrder[0]!;
    const secondSend = sender.send.mock.invocationCallOrder[1]!;
    expect(firstMark).toBeLessThan(secondSend);
  });

  it('payload 形狀異常 → 仍寄(通用文案、不含編號)、不因文案缺欄擋信', async () => {
    const outbox = outboxFake([job({ payload: 'not-an-object' })]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    const text = (sender.send.mock.calls[0]![0] as { text: string }).text;
    expect(text).toContain('已付款成功');
    expect(res.sent).toBe(1);
  });
});

describe('sweepEmailOutbox — 結果形狀(零 PII 合約)', () => {
  it('result 鍵恰為 counts allowlist(堵日後多塞 recipient/payload 等 PII 欄;欄數會長 ⇒ 標題不寫死數字)', async () => {
    const res = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox: outboxFake([]), sender: senderFake([]) }, OPTS);
    expect(Object.keys(res).sort()).toEqual([
      'budgetExhaustedBeforeClaim',
      'claimed',
      'deferred',
      'eligibilityUnknown',
      'errors',
      'failed',
      'quotaFailed',
      'reclaimed',
      'sent',
      'skippedIneligible',
      'skippedShipmentVoided',
      'staleMarks',
    ]);
  });

  /**
   * 🔴 **這一格的宣稱在 2026-08-30 縮窄了,而縮窄的理由要寫在這裡不是寫在 commit 裡:**
   *    原標題逐字「不呼 enqueue/claimById/**markSkippedOrderIneligible**」。
   *    Sean 拍「Q2 取消信縫 = 甲 搬」之後,sweeper **會**呼 `markSkippedOrderIneligible`
   *    —— 但只在【訂單真的不合格】的那條路上。
   *    ⚠️ 而底下這一發餵的是「全部合格」的世界 ⇒ 它照樣綠。
   *       **⇒ 所以只改斷言不改標題的話,這一格會變成一句過期的宣稱而永遠不紅。**
   *    ⇒ 標題改成它現在真正證得到的東西;「不合格時會呼」由另一組(整合測試)證。
   */
  it('本 use-case 零告警(Q13=A):不呼 enqueue/claimById、無 notifier 依賴;【全部合格】時也不呼 markSkippedOrderIneligible', async () => {
    const outbox = outboxFake([job()]);
    await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender: senderFake([{ kind: 'sent' }]) }, OPTS);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(outbox.claimById).not.toHaveBeenCalled();
    expect(outbox.markSkippedOrderIneligible).not.toHaveBeenCalled();
  });

  it('🔴 對照:同一份輸入,scanner 說那張單不合格 ⇒ 這一格必須翻(證明上一格的綠是輸入造成的,不是碼裡沒那條路)', async () => {
    const outbox = outboxFake([job()]);
    // 柵欄回 true = 這一列仍是我的(fake 預設回 undefined ⇒ 會走 staleMarks 那條)
    outbox.markSkippedOrderIneligible.mockResolvedValue(true);
    const res = await sweepEmailOutbox(
      {
        ineligibleScanner: { listDueIneligible: async () => [], listIneligibleAmong: async () => ['order-1'] },
        outbox,
        sender: senderFake([{ kind: 'sent' }]),
      },
      OPTS,
    );
    expect(outbox.markSkippedOrderIneligible).toHaveBeenCalledTimes(1);
    expect(res.skippedIneligible).toBe(1);
    expect(res.sent).toBe(0);
  });
});

// ⛔ ~~`sweepEmailOutbox — 🔴 order_shipped 仍然 fail-closed(M-4b E4-b 零對外的【可跑證明】)`~~
//    **2026-08-30 片3b:模板落地了,`order_shipped` 不再無條件 fail-closed。**
//    ⇒ 本組現在量的是**它【什麼時候仍然】不寄** —— 而那四格全部還成立,一格都沒有被刪。
describe('sweepEmailOutbox — 🔴 order_shipped:【拿不到脈絡】時仍然 fail-closed(片3b 之後)', () => {
  // 🔴 這一組存在的理由:片2 交件時我要說「一封信都不會多」,
  //    而**「我沒有寫寄信的 code」不是證明** —— 那是宣稱。
  //    真正的證明是:餵一份 order_shipped 的工作單進去,看它**有沒有呼叫 sender**。
  const shippedJob = () =>
    job({
      id: 'outbox-shipped-1',
      eventType: 'order_shipped',
      dedupKey: 'shp-1:order-1',
      subject: 'PCM 訂單 PCM-2026-0001 出貨通知(包裹 BCDF23)',
      payload: {
        event_version: 1,
        display_id: 'PCM-2026-0001',
        shipment_reference: 'BCDF23',
        shipped_at: '2026-08-22T02:00:00.000Z',
      },
    });

  it('🔴 order_shipped 進來 ⇒ 計 error,而且**一次都沒有呼叫 sender**', async () => {
    const outbox = outboxFake([shippedJob()]);
    const sender = senderFake([]);

    const r = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);

    // ⬇️ 這一行是「零對外」的真正證據 —— 不是 counts,是那支 spy。
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.errors).toBe(1);
    // 列留在 sending 由下輪回收 ⇒ **不得**被標成 sent。
    expect(outbox.markSent).not.toHaveBeenCalled();
  });

  /**
   * ⛔ ~~`🔴 給了 shippedContext 也一樣不寄 —— 那一欄【不是】打開閘的東西`~~
   *    **2026-08-30 片3b 之後那個宣稱不成立了** —— 模板落地,給了 context 就會寄。
   *
   * 🔴🔴 **而最危險的一格是:那一格【不改也會綠】。**
   *    因為 `shippedJob()` 的 payload **沒有 `shipment_id`** ⇒ 走的是「撈不到鍵」那條
   *    fail-closed ⇒ `sender` 仍然零呼叫、`errors` 仍然是 1、`loadShippedContext` 仍然沒被呼叫。
   *    ⇒ 📌 **它會繼續印綠,而它印的綠講的是另一件事** —— 一個標題寫著「閘是關的」的恆綠格。
   *    ⇒ 所以這裡不是「順手更新測試名字」,是**把一個已經失去標的的量具換掉**。
   *
   * ✅ 換成:**payload 缺 `shipment_id` ⇒ fail-closed,而且【連讀都不讀】。**
   *    那才是它現在真正量得到的東西,而它有判別力(補上鍵就會走到讀取,見下面那一組)。
   */
  it('🔴 payload 缺 shipment_id ⇒ fail-closed:不寄、不讀、errors+1', async () => {
    const outbox = outboxFake([shippedJob()]);
    const sender = senderFake([]);
    const loadShippedContext = vi.fn();

    const r = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender, shippedContext: { loadShippedContext } }, OPTS);

    expect(sender.send).not.toHaveBeenCalled();
    expect(loadShippedContext).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  it('🔴🔴 未知的 event_type ⇒ **不寄**,而不是把型別字串當內文寄給客人', async () => {
    // 🔴 這一格是 Fable 2026-08-22 R2 F7。原本那行是 `return job.eventType satisfies never;`
    //    —— `satisfies` **編譯後整個消失** ⇒ 執行期它就是 `return job.eventType`
    //    ⇒ 客人會收到一封**內容只有一個型別字串**的信(例:`order_refunded`)。
    // ⚠️ 今天它不可達,是**因為 DB CHECK 擋著**,不是因為那行安全 ——
    //    而 `EmailOutboxEventType` 是**手抄的 union**,「DB 先加值、code 後上」是預期會發生的順序。
    // 🔴 而我第一次改完【沒有補這一格】 —— 突變(把 throw 改回 return)當時一格都沒紅。
    //    ⇒ **改了行為而沒有留下量具,等於沒改**:下一個人可以原路改回去。
    const rogue = job({ id: 'outbox-rogue' }) as unknown as Record<string, unknown>;
    rogue.eventType = 'order_refunded'; // ← 型別上不存在,而 DB 有一天可能先有它
    const outbox = outboxFake([rogue as never]);
    const sender = senderFake([]);

    const r = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);

    expect(sender.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.errors).toBe(1);
  });

  it('同一輪混著 order_created 與 order_shipped ⇒ 前者照寄、後者擋下(fail-closed 不中斷整批)', async () => {
    const outbox = outboxFake([job(), shippedJob()]);
    const sender = senderFake([{ kind: 'sent' }]);

    const r = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);

    expect(sender.send).toHaveBeenCalledTimes(1); // 只有 order_created 那一封
    expect(r.sent).toBe(1);
    expect(r.errors).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 M-4b E4 片3b:出貨通知信的【模板】與【寄送時讀取】
// ══════════════════════════════════════════════════════════════════════════
//
// 🔴 **這一組是 Sean `q3: C` 那一板的量具。** 而他拍的是「放哪三段」,
//    不是「那三段怎麼寫」⇒ 下面第一格把**信件全文逐字**釘住,
//    交件時貼給他看的就是這一格裡的字面(不是我另外重打一份)。
//
// ⚠️ **條件才是這一片的內容**:他讀到的理由逐字是
//    「那兩句只在該出現的那一批出現, 不是每封信都變長」
//    ⇒ 所以真值表那四格(②on/off × ③on/off)是承重的,不是湊數。
describe('sweepEmailOutbox — 🔴 order_shipped 模板(Sean 2026-08-30 `q3: C`)', () => {
  /** 一份**有 `shipment_id`** 的出貨工作單(上一組那份刻意沒有,用來量另一條路)。 */
  const shippedJobWithId = () =>
    job({
      id: 'outbox-shipped-1',
      eventType: 'order_shipped',
      dedupKey: 'shp-1:order-1',
      subject: 'PCM 訂單 PCM-2026-0001 出貨通知(包裹 BCDF23)',
      payload: {
        event_version: 1,
        display_id: 'PCM-2026-0001',
        shipment_id: '11111111-2222-3333-4444-555555555555',
        shipment_reference: 'BCDF23',
        shipped_at: '2026-08-30T02:00:00.000Z',
      },
    });

  const CTX = {
    orderDisplayId: 'PCM-2026-0001',
    shipmentReference: 'BCDF23',
    carrierName: '黑貓宅急便',
    trackingNumber: '1234567890',
    lines: [
      { title: '前煞車來令片', quantity: 2 },
      { title: null, quantity: 1 },
    ],
    linesTruncated: false,
    orderHasUnshippedItems: true,
  };

  /** 跑一輪、回 `{ r, sender, outbox, load }`(所有測項共用,少一份重複的組裝碼)。 */
  async function run(loadResult: unknown, ctxOverrides: Record<string, unknown> = {}, outboxOverrides = {}) {
    const outbox = outboxFake([shippedJobWithId()], outboxOverrides);
    const sender = senderFake([{ kind: 'sent' }]);
    const resolved =
      loadResult === 'ok' ? { kind: 'ok', context: { ...CTX, ...ctxOverrides } } : loadResult;
    const load = vi.fn().mockResolvedValue(resolved);
    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender, shippedContext: { loadShippedContext: load } },
      OPTS,
    );
    return { r, sender, outbox, load };
  }

  /** 那一封信的內文(只有真的寄了才拿得到)。 */
  function sentText(sender: { send: ReturnType<typeof vi.fn> }): string {
    expect(sender.send).toHaveBeenCalledTimes(1);
    return sender.send.mock.calls[0]![0].text as string;
  }

  it('🔴🔴 信件全文逐字(三段全開)—— **這一格就是交件時貼給 Sean 看的那份**', async () => {
    const { r, sender } = await run('ok', { trackingNumber: null });
    expect(sentText(sender)).toBe(
      [
        '您好,',
        '',
        '您的訂單 PCM-2026-0001 有一批商品已出貨。',
        '',
        '箱號:BCDF23',
        '本批為自取／自送,無追蹤碼。',
        '',
        '本批出貨內容:',
        '· 前煞車來令片 × 2',
        '· (品名從缺) × 1',
        '',
        '這張訂單可能分批出貨,其餘商品出貨時會另外通知您。',
        '',
        '訂單明細與最新狀態請至 PCM 會員中心查看。',
        '',
        'PCM重機零件販售',
      ].join('\n'),
    );
    expect(r.sent).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('🔴 有追蹤碼那一版的全文(③ 那句不在、改印貨運與碼)', async () => {
    const { sender } = await run('ok');
    expect(sentText(sender)).toBe(
      [
        '您好,',
        '',
        '您的訂單 PCM-2026-0001 有一批商品已出貨。',
        '',
        '箱號:BCDF23',
        '貨運:黑貓宅急便',
        '追蹤碼:1234567890',
        '',
        '本批出貨內容:',
        '· 前煞車來令片 × 2',
        '· (品名從缺) × 1',
        '',
        '這張訂單可能分批出貨,其餘商品出貨時會另外通知您。',
        '',
        '訂單明細與最新狀態請至 PCM 會員中心查看。',
        '',
        'PCM重機零件販售',
      ].join('\n'),
    );
  });

  /**
   * 🔴 **真值表 —— 兩句話 × 兩個世界,四格都要各自表演一次。**
   *    少了「不該出現時真的不出現」那兩格,一個把條件寫成 `if (true)` 的實作會全綠,
   *    而那正是**沒有照拍板做**的那個版本(字面全在、條件沒接)。
   */
  it.each([
    [true, null, true, true],
    [true, 'T1', true, false],
    [false, null, false, true],
    [false, 'T1', false, false],
  ])(
    '真值表:orderHasUnshippedItems=%s / trackingNumber=%s ⇒ ②=%s ③=%s',
    async (hasUnshipped, tracking, expectPartial, expectNoTracking) => {
      const { sender } = await run('ok', {
        orderHasUnshippedItems: hasUnshipped,
        trackingNumber: tracking,
      });
      const text = sentText(sender);
      expect(text.includes('這張訂單可能分批出貨,其餘商品出貨時會另外通知您。')).toBe(expectPartial);
      expect(text.includes('本批為自取／自送,無追蹤碼。')).toBe(expectNoTracking);
    },
  );

  /**
   * 🔴 **傳出去的那一發查詢要釘住形狀** —— 少了這一格,
   *    一個「把 orderId 與 shipmentId 對調」或「根本沒把 shipmentId 傳下去」的改動
   *    在上面每一格底下都是綠的(替身照樣回 ok)。
   */
  it('🔴 讀取那一發:orderId 與 shipmentId 都要從 job/payload 正確帶下去', async () => {
    const { load } = await run('ok');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({
      orderId: 'order-1',
      shipmentId: '11111111-2222-3333-4444-555555555555',
    });
  });

  it('🔴 箱被作廢(voided)⇒ 不寄、落 skipped_shipment_voided 痕跡、**不計 error**', async () => {
    const { r, sender, outbox } = await run({ kind: 'voided' }, {}, {
      markSkippedShipmentVoided: vi.fn().mockResolvedValue(true),
    });
    expect(sender.send).not.toHaveBeenCalled();
    expect(outbox.markSkippedShipmentVoided).toHaveBeenCalledWith(
      'outbox-shipped-1',
      1,
      // 🔴 **第三個參數是承重的**(⟦b4-SHIPUNVOID1⟧ 2026-08-31):實作要拿它去退休那把去重鍵。
      //    少了它 ⇒ 那一列永久佔住鍵 ⇒ **那位客人的出貨信永遠不會排,而沒有任何東西會叫。**
      //    ⇒ 這裡釘的是【值】不是【有沒有帶】—— 兩者是兩個宣稱,而只有前者關得掉那個病。
      'shp-1:order-1',
    );
    expect(r.skippedShipmentVoided).toBe(1);
    // 🔴 這一行才是這一格的重點:作廢是正常業務動作,不可以讓 route 回 503。
    expect(r.errors).toBe(0);
  });

  it('🔴 voided 的世代柵欄沒對上 ⇒ 記 staleMarks、不記 skippedShipmentVoided', async () => {
    const { r, outbox } = await run({ kind: 'voided' }, {}, {
      markSkippedShipmentVoided: vi.fn().mockResolvedValue(false),
    });
    expect(outbox.markSkippedShipmentVoided).toHaveBeenCalled();
    expect(r.skippedShipmentVoided).toBe(0);
    expect(r.staleMarks).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('🔴 讀不到(unavailable)⇒ 不寄、計 error、零 mark —— **這一態應該吵**', async () => {
    const { r, sender, outbox } = await run({ kind: 'unavailable' });
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
    expect(r.skippedShipmentVoided).toBe(0);
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('🔴 loadShippedContext throw ⇒ 不寄、計 error(不得吞成「沒有脈絡就寄通用信」)', async () => {
    const outbox = outboxFake([shippedJobWithId()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const load = vi.fn().mockRejectedValue(new Error('db down'));
    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender, shippedContext: { loadShippedContext: load } },
      OPTS,
    );
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  /**
   * 🔴 `linesTruncated` 是 port 檔頭指名要 fail-closed 的那一格:
   *    **少列幾項的信與正常的信長得一模一樣** —— 客人照著清單對,少的那一項他不會知道要問。
   */
  it('🔴 linesTruncated ⇒ 不寄、計 error', async () => {
    const { r, sender } = await run('ok', { linesTruncated: true });
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  it('🔴 品項空的 ⇒ 不寄(否則客人收到一封「本批出貨內容:」底下什麼都沒有的信)', async () => {
    const { r, sender } = await run('ok', { lines: [] });
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  /**
   * 🔴 同 codex R2 那一格的理由,而這是**第二發**會等的 await:
   *    合格性讀完時還沒超時,而**脈絡那一發**在 59.9 秒開始、60 秒之後才回來
   *    ⇒ 少了讀完再問一次,就會在已經超時的情況下呼叫 Resend。
   * ⚠️ 把那一格拿掉這一條會紅 —— 它是那個修法的證人,不是裝飾。
   */
  it('🔴 脈絡讀取【穿越】deadline ⇒ 這一封不得寄出', async () => {
    const outbox = outboxFake([shippedJobWithId()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const load = vi.fn().mockResolvedValue({ kind: 'ok', context: CTX });
    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender, shippedContext: { loadShippedContext: load } },
      // 迴圈頭 0ms(過)→ 合格性讀完 0ms(過)→ 脈絡讀完 61s(超)
      { ...OPTS, now: tickingClock([0, 0, 0, 0, 61_000]) },
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.deferred).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 codex 2026-08-30 R1 must-fix 1 的證人:**線沒上膛的時候,佇列裡的列不准被寄出去**
// ══════════════════════════════════════════════════════════════════════════
//
// 🔴 **它擋的那個世界怎麼發生的**:Sean 設了 `SHIPPED_EMAIL_CUTOFF` ⇒ 信排進 outbox
//    ⇒ 他看到不對、把 env 拿掉 ⇒ **而那個動作在這一格之前【不會讓寄信停下來】**,
//    因為 cutoff 只擋得住排信那一半,已經排好的列每五分鐘照樣被寄出去。
//
// 🛑🛑 **而「把 env 拿掉」這句話自己漏了一步**(Fable 2026-08-30 R3 must-fix 2)——
//    Vercel **刪掉** env 與**設定** env 一樣,只對**新的 deployment** 生效
//    ⇒ 刪完不 redeploy ⇒ **現行 deployment 讀到的還是舊值 ⇒ 這道閘在它眼裡仍然是開的**
//    ⇒ 📌 **出事那天他刪了、以為停了,而信每五分鐘照樣寄。**
//    ✅ 停下來的完整動作 = **刪 env ⇒ redeploy ⇒ 看下一輪 `shippedEnqueueStatus`
//       是不是 `skipped_no_cutoff`** —— 那一格才是「真的停了」的證據,不是「我刪過了」。
//    ⚠️ **這一節量得到的是「旗標 false ⇒ 不寄」,量不到「他刪了 env 之後旗標會變 false」**
//       —— 後者要經過一次 redeploy,而那不在任何測試的射程裡。**寫出來,不留白。**
//
// 🔴🔴 **而這道保護在片3b【之前】是存在的 —— 它是「模板還沒做」的副產品**
//    (那時 `buildEmailText` 對 `order_shipped` 無條件 throw)。
//    ⇒ 📌 **沒有人「裝」過它,所以它不在任何清單上;而做完那件功能本身,就是拆掉它。**
//    ⇒ ⇒ **這一節就是把它變成一個【有名字、有守門】的東西。**
describe('sweepEmailOutbox — 🔴 allowOrderShipped=false ⇒ 佇列裡的出貨信一封都不寄', () => {
  const shippedReady = () =>
    job({
      id: 'outbox-armed-1',
      eventType: 'order_shipped',
      dedupKey: 'shp-9:order-1',
      subject: 'PCM 訂單 PCM-2026-0001 出貨通知(包裹 BCDF23)',
      payload: {
        event_version: 1,
        display_id: 'PCM-2026-0001',
        shipment_id: '99999999-8888-7777-6666-555555555555',
        shipment_reference: 'BCDF23',
        shipped_at: '2026-08-30T02:00:00.000Z',
      },
    });

  /** 一份**完全健康、拿得到脈絡**的 context —— 讓「不寄」只可能來自那個旗標。 */
  const okCtx = {
    kind: 'ok',
    context: {
      orderDisplayId: 'PCM-2026-0001',
      shipmentReference: 'BCDF23',
      carrierName: '新竹物流',
      trackingNumber: 'T1',
      lines: [{ title: '前煞車來令片', quantity: 1 }],
      linesTruncated: false,
      orderHasUnshippedItems: false,
    },
  };

  /**
   * 🔴🔴 **2026-09-01 `⟦b4-SHIPGATE1⟧` 之後,這一格的【意思換了】**(codex R2 consider):
   *
   * ⛔ ~~它原本模擬的是「線關著的正常流程」~~ —— 而**修法之後那個流程不會走到這裡**:
   *    `claimDue` 現在收 `excludeEventTypes` ⇒ 正式 adapter **根本不會回這一列**。
   * ✅ **而這一格的 `outboxFake` 忽略那個 opts、照樣回 `order_shipped`**
   *    ⇒ **⇒ 它現在演的是【實作違約】那個世界**(adapter 沒實作 / 換了一個別的 port)。
   * 🛑 **⇒ 所以它證的是「第二道閘在 port 違約時仍然擋得住」, 不是「關線時會計 error」。**
   *    而在正式 adapter 底下,關線時**一列都不會被認領** ⇒ `errors` 是 0、不是 1。
   * 📌 **⇒ 名字沒改會讓下一個人把它讀成正常路徑, 然後以為關線每輪都在計 error。**
   */
  it('🔴🔴 **實作違約時**(adapter 忽略 excludeEventTypes)⇒ 第二道閘仍不寄、計 error(列留 sending)', async () => {
    const outbox = outboxFake([shippedReady()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const load = vi.fn().mockResolvedValue(okCtx);

    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender, shippedContext: { loadShippedContext: load } },
      { ...OPTS, allowOrderShipped: false },
    );

    // ⬇️ 這一行是「線關著就真的不寄」的證據 —— 不是 counts,是那支 spy。
    expect(sender.send).not.toHaveBeenCalled();
    // 🔴 線關著的時候連查主表都不該發生(擋在讀取【之前】)。
    expect(load).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.errors).toBe(1); // 線關著而佇列裡有列 = 有事情不對,應該吵
    expect(outbox.markSent).not.toHaveBeenCalled();
  });

  it('🔵 正對照:同一份工作單、同一份 context,只把旗標翻成 true ⇒ **它就寄了**', async () => {
    // 🔴 沒有這一格,上面那格在「這支 use-case 整個壞掉、什麼都不寄」的世界裡也會綠。
    const outbox = outboxFake([shippedReady()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const load = vi.fn().mockResolvedValue(okCtx);

    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender, shippedContext: { loadShippedContext: load } },
      { ...OPTS, allowOrderShipped: true },
    );

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('🔴 線關著【不影響】訂單成立信 —— 它擋的是一種信,不是整個 sweeper', async () => {
    const outbox = outboxFake([job(), shippedReady()]);
    const sender = senderFake([{ kind: 'sent' }]);

    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender },
      { ...OPTS, allowOrderShipped: false },
    );

    expect(sender.send).toHaveBeenCalledTimes(1); // 只有 order_created 那一封
    expect(r.sent).toBe(1);
    expect(r.errors).toBe(1);
  });
});

// ══ 片2(2026-09-01):付款信接上 `IPaidEmailContext` + HTML 模板 ══════════════
//
// 🔴 **這一組守的是兩件相反的事,而它們必須同時成立**:
//    ① 沒注入 `paidContext` ⇒ 寄出去的東西**逐位元與今天相同**(既有 62 格就是那個世界)
//    ② 注入了 ⇒ 三態各走各的路,而 `unavailable` **會讓今天收得到信的單收不到**
//       —— 那是 port 明文要的,而它是本片最貴的那個改變。
function paidCtx(over: Partial<PaidEmailContext> = {}): PaidEmailContext {
  // 🔴 `MoneyAmount` 是 **branded number**(`packages/domain/src/shared/types.ts:17`),
  //    不是 `{amount,currency}` 物件。⛔ ~~我第一版寫成物件~~ ⇒ **vitest 全綠而 typecheck 紅**。
  //    📌 **vitest 不做型別檢查** ⇒ 型別錯的替身照樣跑過,而它「跑過」會讓人以為型別也對。
  // 🔴🔴 而本 fixture **不用 `as` 包整個物件**(code-reviewer must-fix):第一版兩層 `as` +
  //    一個 port 上不存在的 `unitPrice` ⇒ 那等於把上面那句話吹的守門關掉。
  const m = (n: number) => n as PaidEmailContext['total'];
  return {
    orderDisplayId: 'PCM-2026-0001',
    lines: [{ title: '排氣管', variantSku: 'SKU-1', quantity: 1, lineTotal: m(1000) }],
    linesTruncated: false,
    subtotal: m(1000),
    shippingFee: m(100),
    discountTotal: m(0),
    total: m(1100),
    ...over,
  };
}
const paidFake = (r: LoadPaidContextResult): IPaidEmailContext => ({
  loadPaidContext: async () => r,
});
const paidDeps = (r: LoadPaidContextResult, outbox: OutboxFake, sender: IEmailSender) => ({
  ineligibleScanner: eligibleAll(),
  outbox,
  sender,
  paidContext: paidFake(r),
});

describe('sweepEmailOutbox — 付款信接金額與 HTML(片2)', () => {
  it('🔵 沒注入 paidContext ⇒ 完全是今天的行為:送出去的東西**沒有 html 這個 key**', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox({ ineligibleScanner: eligibleAll(), outbox, sender }, OPTS);
    expect(r.sent).toBe(1);
    const input = (sender.send.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    // 🔴 用 hasOwnProperty 不用 `in` —— 片1 那組已經寫過為什麼(`in` 走原型鏈)。
    expect(Object.prototype.hasOwnProperty.call(input, 'html')).toBe(false);
    expect(input.subject).toBe(job().subject);
  });

  it('🟢 注入且 ok ⇒ 帶 html,而 subject 與 text 一個字都沒變', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(paidDeps({ kind: 'ok', context: paidCtx() }, outbox, sender), OPTS);
    expect(r.sent).toBe(1);
    const input = (sender.send.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(input, 'html')).toBe(true);
    expect(String(input.html)).toContain('PCM-2026-0001');
    // 🔴 主旨與純文字是【退化路徑】⇒ 原樣才是「同一封信多了排版」而不是另一封信。
    expect(input.subject).toBe(job().subject);
    expect(String(input.text)).toContain('已付款成功');
  });

  // ══ 🔴🔴 **驗【呼叫點的產物】—— 而這一格是 2026-09-01 一次跨檔假設失守補的** ══════
  //   成因不是任何一個人做錯:
  //     `-a0` 把 chrome 三格全部不給, 讓第一次上線【只有一個變數】(內文變 HTML)——對。
  //     `-7a` 後來給 `logoUrl` 加預設值, 讓呼叫端不必知道那個網址 ——也對。
  //   🛑 而兩個對的決定合起來 ⇒ **不給 chrome 會拿到預設 ⇒ 圖被印進信裡** ⇒ 變數變成兩個。
  //   🔴 **而兩邊的測試各自全綠**:
  //     這一支驗「html 欄有沒有送出去」⇒ **不驗 html 裡面有什麼**
  //     模板那一支驗「不給 logoUrl ⇒ 用預設」⇒ **那正是它要的行為, 不會紅**
  //   ⇒ ⇒ 📌 **一個跨檔的假設, 沒有任何一支測試守得住它 —— 因為每一支的分母都是自己那支檔。**
  //   ✅ 所以這一格的分母刻意是【呼叫點吐出來的那份 html】, 不是任何一邊的內部行為。
  it('🔴 送出去的 html **不含 `<img>`** —— 第一次上線刻意只讓變數有一個', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    await sweepEmailOutbox(paidDeps({ kind: 'ok', context: paidCtx() }, outbox, sender), OPTS);
    const input = (sender.send.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    const html = String(input.html);
    // 🔵 先證這把尺【量得到東西】—— 否則 html 是空字串時下面兩格恆過。
    expect(html.length).toBeGreaterThan(1000);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('pcm-logo.png');
    // 🔴 而【付款時間 / CTA】那兩格也一起釘 —— 它們今天不印的理由各自不同
    //    (付款時間:沒查那個欄位, 而 Sean 拍過「沒有就不要印」;CTA:多一個對外連結他還沒點頭),
    //    而**兩個理由都不是「模板做不到」** ⇒ 哪天有人給了值, 這幾格會一起變, 要有人看過。
    expect(html).not.toContain('付款時間');
    expect(html).not.toContain('到會員中心查看訂單');
  });

  it('🔴 unavailable ⇒ **不寄**、計 error(port 明文;這會讓今天收得到信的單收不到)', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(paidDeps({ kind: 'unavailable' }, outbox, sender), OPTS);
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.errors).toBe(1);
  });

  // ⛔ ~~it('🔴 cancelled ⇒ 不寄、計 error,而【不呼叫 markSkippedOrderIneligible】')~~
  //    **2026-09-02 ⟦b4-MAILCANCEL1⟧ 落地 ⇒ 期望值翻轉**(舊標題留著加刪除線, 不刪):
  //    舊的釘的是「已知偏離 port 合約」那個現況 —— 而那個偏離的理由是【還沒有批准】,
  //    而 Sean 2026-09-02 拍【乙 = 現在做 HTML 付款信】⇒ 那個批准有了 ⇒ 本格改成合約要的樣子。
  //    🔴 而它從「計 error」翻成「**不計 error**」—— 一張被取消的單不寄信是正常的業務動作。
  it('🟢 cancelled ⇒ 不寄、標終態、**不計 error**,而落的是 markSkippedOrderCancelled', async () => {
    const outbox = outboxFake([job()], { markSkippedOrderCancelled: vi.fn().mockResolvedValue(true) });
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(paidDeps({ kind: 'cancelled' }, outbox, sender), OPTS);
    expect(sender.send).not.toHaveBeenCalled();
    // 🔴 **這一格是本片的核心**:計 error ⇒ route 回 503 ⇒ 有人半夜起來查一件正常的事。
    expect(r.errors).toBe(0);
    // 🔴🔴 **驗【傳了什麼】不只驗【呼了幾次】**(codex 2026-09-02 must-fix):
    //    只驗次數的話, 一個誤傳舊世代(例如寫成 `job.attempts - 1`)的改動【兩層測試都綠】,
    //    而正式庫的 CAS 述詞 `.eq('attempts', claimedAttempts)` 永遠對不上 ⇒ 回 false
    //    ⇒ 那一列每輪被回收、每輪燒一次 attempt ⇒ **正是這一片要修掉的那個病, 換一個入口回來**。
    expect(outbox.markSkippedOrderCancelled).toHaveBeenCalledWith(job().id, job().attempts);
    expect(outbox.markSkippedOrderCancelled).toHaveBeenCalledTimes(1);
    // 🛑 **而【不可以】落到那一支** —— 兩層落同一個碼 ⇒ 上游那道閘變成看不見的
    //    (主視窗 2026-08-24 拍乙)。而 outboxFake 對它的預設替身是 reject ⇒ 兩道都會叫。
    expect(outbox.markSkippedOrderIneligible).not.toHaveBeenCalled();
    expect(r.skippedIneligible).toBe(1);
  });

  it('🔵 cancelled 的 CAS 世代柵欄:標記回 false ⇒ 算 staleMarks,**不是 error**', async () => {
    // 🔴 柵欄沒對上 = 別人接手了 ⇒ 那不是錯誤。少了這一格,
    //    一個把 `else result.staleMarks++` 寫成 `else result.errors++` 的改動不會紅。
    const outbox = outboxFake([job()], { markSkippedOrderCancelled: vi.fn().mockResolvedValue(false) });
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(paidDeps({ kind: 'cancelled' }, outbox, sender), OPTS);
    expect(r.errors).toBe(0);
    expect(r.staleMarks).toBe(1);
    expect(r.skippedIneligible).toBe(0);
  });

  it('🔴 cancelled 的標記本身失敗(throw)⇒ 那才計 error', async () => {
    // 🔵 兩個世界:標記成功 ⇒ 0 error(上面那格)· 標記 throw ⇒ 1 error(本格)
    //    ⇒ 少了本格,一個「把 try/catch 拿掉」的改動不會紅。
    const outbox = outboxFake([job()], {
      markSkippedOrderCancelled: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(paidDeps({ kind: 'cancelled' }, outbox, sender), OPTS);
    expect(r.errors).toBe(1);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('🔴 linesTruncated ⇒ 不寄(少兩項的信與正常的信長得一模一樣)', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(
      paidDeps({ kind: 'ok', context: paidCtx({ linesTruncated: true }) }, outbox, sender),
      OPTS,
    );
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  it('🔴 空品項 ⇒ 不寄(port 說它會走 unavailable,而那是【它的】保證不是我們的)', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(
      paidDeps({ kind: 'ok', context: paidCtx({ lines: [] }) }, outbox, sender),
      OPTS,
    );
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  it('🔴 loadPaidContext 自己 throw ⇒ 計 error 不寄(不得讓它變成程式錯誤逃出去)', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'sent' }]);
    const r = await sweepEmailOutbox(
      {
        ineligibleScanner: eligibleAll(),
        outbox,
        sender,
        paidContext: { loadPaidContext: async () => { throw new Error('boom'); } },
      },
      OPTS,
    );
    expect(sender.send).not.toHaveBeenCalled();
    expect(r.errors).toBe(1);
  });

  it('🔵 `order_shipped` 不受影響:注入了 paidContext 也不會被呼叫', async () => {
    // 🔴 少了這一格,一個「對每一種 event 都去查付款金額」的改法會全綠 ——
    //    而它會對出貨信多打一次 DB, 並在 unavailable 時把出貨信也擋掉。
    const load = vi.fn(async () => ({ kind: 'unavailable' }) as LoadPaidContextResult);
    const outbox = outboxFake([job({ eventType: 'order_shipped' })]);
    const sender = senderFake([{ kind: 'sent' }]);
    await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender, paidContext: { loadPaidContext: load } },
      OPTS,
    );
    expect(load).not.toHaveBeenCalled();
  });
});

// ⟦b4-SHIPGATE1⟧ 2026-09-01:出貨信線關著時,**連認領都不要認領**。
//
// 🔴 舊行為的代價(碼裡 `:757` 原本寫「約 25 分鐘」而那是錯的):
//    認領當下 attempts +1、狀態落 `sending` ⇒ 被 `:750` 那道閘擋下、`continue`(不呼叫 mark*)
//    ⇒ 留在 `sending`, 而 `sending` **不在** CLAIMABLE_STATUSES ⇒ 下一輪撿不到
//    ⇒ 唯一出路是租約回收(route 端 LEASE_SECONDS=3600)⇒ **每燒一次 ≈ 一小時**。
describe('⟦b4-SHIPGATE1⟧ 線關著時不認領 order_shipped', () => {
  // 🔴🔴 **R3 F5:我在別處註解裡寫「正式 adapter 底下關線時 errors 是 0 不是 1」,
  //    而【沒有任何一格測試量它】—— 而 F1/F3 的推論整個掛在那句話上。**
  //    ⇒ 補一個**會遵守 opts** 的 fake(= 正式 adapter 的行為), 斷言 errors/claimed 都是 0。
  //    📌 **⇒ 一句只寫在註解裡的行為宣稱, 與一句被測到的, 在讀的人眼裡長得一樣。**
  it('🔴 會遵守 opts 的 fake(= 正式 adapter)⇒ 關線時 errors 0 / claimed 0(不是計 error)', async () => {
    const shipped = job({ eventType: 'order_shipped', dedupKey: 'order-9/batch-9' });
    const outbox = outboxFake([shipped]);
    // 遵守 opts:被排除的型別就不回它
    outbox.claimDue.mockImplementation(
      async (_limit: number, opts?: { excludeEventTypes?: readonly string[] }) =>
        (opts?.excludeEventTypes ?? []).includes(shipped.eventType) ? [] : [shipped],
    );
    const sender = senderFake([]);
    const r = await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender },
      { ...OPTS, allowOrderShipped: false },
    );
    expect(r.errors, '關線時不該計 error —— 那一列根本沒被認領').toBe(0);
    expect(r.claimed).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('🔴 旗標關 ⇒ claimDue 收到 excludeEventTypes(突變:拿掉那個參數 ⇒ 這一格必須紅)', async () => {
    const outbox = outboxFake([]);
    await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) },
      { ...OPTS, allowOrderShipped: false },
    );
    expect(outbox.claimDue).toHaveBeenCalledExactlyOnceWith(OPTS.claimLimit, {
      excludeEventTypes: ['order_shipped'],
    });
  });

  it('🟢 正對照:旗標開 ⇒ 第二個參數是 undefined(既有查詢逐位元不變)', async () => {
    const outbox = outboxFake([]);
    await sweepEmailOutbox(
      { ineligibleScanner: eligibleAll(), outbox, sender: senderFake([]) },
      { ...OPTS, allowOrderShipped: true },
    );
    // 🛑 **不是空陣列**。而理由要寫精確(codex 2026-09-01 nit):
    //    adapter **現在**對空陣列與未給是**同一條路**(`exclude.length > 0` 才加 `.not`)
    //    ⇒ 空陣列今天**不會**送出空的 `not in ()` —— **只有那道守門被拿掉時才會**(codex R2 nit)。
    //    ✅ 這一格釘的是**呼叫端的意圖**:線開著時傳 `undefined`(= 不排除任何東西),
    //       而不是傳一個「排除空集合」—— 兩者語意不同, 而**只有 adapter 那道守門讓它們今天等價**。
    //    🔴 ⇒ 那道守門哪天被拿掉, 這裡的 `undefined` 仍然是對的;而空陣列會變成語法錯。
    expect(outbox.claimDue).toHaveBeenCalledExactlyOnceWith(OPTS.claimLimit, undefined);
  });
});
