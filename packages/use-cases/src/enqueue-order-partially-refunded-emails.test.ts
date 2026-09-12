import { describe, expect, it, vi } from 'vitest';
import type { IEmailOutbox, IPartialRefundOrderScanner } from '@pcm/ports';
import { enqueueOrderPartiallyRefundedEmails } from './enqueue-order-partially-refunded-emails';

const OPTS = { cutoff: '2026-09-08T00:00:00.000Z', limit: 50 };

function row(over: Partial<Parameters<typeof mkRow>[0]> = {}) {
  return mkRow({
    orderId: 'order-1',
    displayId: 'PCM-2026-0001',
    refundId: 'refund-1',
    refundedAmount: 1200,
    refundedAt: '2026-09-08T10:00:00.000Z',
    notificationEmail: 'a@example.com',
    customerEmail: null,
    orderSource: 'web',
    // 🔵 2026-09-12:掃描面新增的兩欄(view `20260912020000` 帶下來)
    orderState: 'active' as const,
    refundSource: 'card' as const,
    ...over,
  });
}
function mkRow(r: {
  orderId: string;
  displayId: string;
  refundId: string;
  refundedAmount: number;
  refundedAt: string;
  notificationEmail: string | null;
  customerEmail: string | null;
  orderSource: string | null;
  orderState: 'active' | 'fully_refunded' | 'cancelled' | null;
  refundSource: 'card' | 'manual' | null;
}) {
  return r;
}

function deps(rows: ReturnType<typeof row>[]) {
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, id: 'outbox-1' })),
    // 🔵 預設「全都是新的」。🛑 少了這一行, `as unknown as` 會讓 typecheck 照樣綠,
    //    而測試在執行期才炸。
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    // ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b:手動單留白 ⇒ 落一列終態(不寄)。
    enqueueManualNoRecipient: vi.fn(async () => ({ kind: 'skipped_manual_no_recipient', id: 'm1' })),
  } as unknown as IEmailOutbox;
  const scanner: IPartialRefundOrderScanner = {
    listPartialRefundsWithoutEmail: vi.fn(async () => ({
      rows,
      scannedPages: 1,
      truncated: false,
    })),
  };
  return { outbox, scanner };
}

describe('enqueueOrderPartiallyRefundedEmails(QB-16 真正的部分退款)', () => {
  it('🔴 正常一筆 ⇒ 排一封, 而 input 帶 refundId / 金額 / 時點', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.scanned).toBe(1);
    expect(r.enqueued).toBe(1);
    expect(r.unusableAmount).toBe(0);
    const sent = vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      eventType: 'order_partially_refunded',
      refundId: 'refund-1',
      refundedAmount: 1200,
      refundedAt: '2026-09-08T10:00:00.000Z',
      orderState: 'active',
      refundSource: 'card',
      recipientEmail: 'a@example.com',
    });
  });

  /**
   * 🔴🔴 **本檔最承重的一格 —— 它釘的是「每次都寄」。**
   * 同一張單的**兩筆**退款 ⇒ **兩個 input, 而 `refundId` 必須不同**。
   * 🛑 如果哪天有人把落表邊界的 `dedupKey` 從 `refundId` 改回 `orderId`,
   *    行為會退化成「只寄第一次」而**這一格不會紅**(它看的是 use-case 這一層)
   *    ⇒ 📌 那一層由 `SupabaseEmailOutboxAdapter` 的 dedup 分派與 view 的**事後閘④**守。
   *    **三層各守一段, 而它們守不到彼此。**
   */
  it('🔴 分批退:同一張單兩筆退款 ⇒ 排兩封, 而兩個 refundId 不同', async () => {
    const d = deps([
      row({ refundId: 'refund-1', refundedAmount: 1200 }),
      row({ refundId: 'refund-2', refundedAmount: 800 }),
    ]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.scanned).toBe(2);
    expect(r.enqueued).toBe(2);
    const ids = vi.mocked(d.outbox.enqueue).mock.calls.map((c) => (c[0] as { refundId: string }).refundId);
    expect(ids).toEqual(['refund-1', 'refund-2']);
    // 🔵 而金額也要各自帶自己那一筆 —— 不是和(2000), 也不是同一個值兩次
    const amounts = vi
      .mocked(d.outbox.enqueue)
      .mock.calls.map((c) => (c[0] as { refundedAmount: number }).refundedAmount);
    expect(amounts).toEqual([1200, 800]);
  });

  /**
   * 🔴 **金額讀不到 ⇒ 不排, 而且【不是】計成 error。**
   * A 2026-09-08 收 plan §④:本封信存在的唯一理由就是那個金額
   * ⇒ 說不出金額的信比不寄糟。而分開計數, 是為了讓「資料不完整」與「系統出錯」
   *   在報表上分得開(兩者的處置不同)。
   */
  it.each([
    ['0 元', { refundedAmount: 0 }],
    ['負數', { refundedAmount: -1 }],
    ['小數', { refundedAmount: 12.5 }],
    ['NaN', { refundedAmount: Number.NaN }],
    ['時點空字串', { refundedAt: '' }],
    ['時點只有空白', { refundedAt: '   ' }],
  ])('🔴 %s ⇒ 不排, 計 unusableAmount 而不是 errors', async (_label, over) => {
    const d = deps([row(over)]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.enqueued).toBe(0);
    expect(r.unusableAmount).toBe(1);
    expect(r.errors).toBe(0);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🟢 正對照:壞的那筆不會把好的那筆一起擋掉', async () => {
    const d = deps([row({ refundId: 'bad', refundedAmount: 0 }), row({ refundId: 'good' })]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.unusableAmount).toBe(1);
    expect(r.enqueued).toBe(1);
    const ids = vi.mocked(d.outbox.enqueue).mock.calls.map((c) => (c[0] as { refundId: string }).refundId);
    expect(ids).toEqual(['good']);
  });

  it('🔴 兩個信箱都空 ⇒ 不排, 計 noRecipient', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: null })]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.noRecipient).toBe(1);
    expect(r.enqueued).toBe(0);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔵 notificationEmail 空 ⇒ 退化用 customerEmail(web 單)', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: 'b@example.com' })]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.enqueued).toBe(1);
    expect(vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0]).toMatchObject({
      recipientEmail: 'b@example.com',
    });
  });

  /**
   * 🔴 **手動建單留白 = 不寄**(Sean 拍板;⟦f3-MAILFALLBACKVSRULING⟧)。
   * 判準是【兩個條件】:`manual_*` **而且** `notification_email` 為空。
   */
  it('🔴 手動建單 + notificationEmail 空 ⇒ 不退化到 customerEmail ⇒ 不排', async () => {
    const d = deps([
      row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'b@example.com' }),
    ]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.noRecipient).toBe(1);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🟢 正對照:手動建單而 notificationEmail 有值 ⇒ 照排', async () => {
    const d = deps([
      row({ orderSource: 'manual_phone', notificationEmail: 'c@example.com', customerEmail: null }),
    ]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.enqueued).toBe(1);
    expect(vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0]).toMatchObject({
      recipientEmail: 'c@example.com',
    });
  });

  it('🔴 單筆 enqueue 炸掉 ⇒ 計 errors, 不擋下一筆', async () => {
    const d = deps([row({ refundId: 'r1' }), row({ refundId: 'r2' })]);
    vi.mocked(d.outbox.enqueue)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'x' });
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.errors).toBe(1);
    expect(r.enqueued).toBe(1);
  });

  it('🔵 duplicate / skipped_no_real_email 各自計數', async () => {
    const d = deps([row({ refundId: 'r1' }), row({ refundId: 'r2' })]);
    vi.mocked(d.outbox.enqueue)
      .mockResolvedValueOnce({ kind: 'duplicate' })
      .mockResolvedValueOnce({ kind: 'skipped_no_real_email', id: 'y' });
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.duplicate).toBe(1);
    expect(r.skippedNoRealEmail).toBe(1);
    expect(r.enqueued).toBe(0);
  });

  /**
   * 🔴 **批次上限的分母是 `countNewEvents`, 不是 `rows.length`。**
   * 掃描面會放回「我們自己 skip 過」而 `enqueue()` 會回 `duplicate` 的舊列
   * ⇒ 拿掃描列數當分母, 撞鍵的舊列會把真的該寄的信一起擋掉
   * ⇒ 📌 **防止多寄的閘變成永久少寄。**
   */
  it('🔴 countNewEvents 回 0 ⇒ 就算掃到很多列也不撞閘', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ refundId: `r${i}` }));
    const d = deps(many);
    vi.mocked((d.outbox as unknown as { countNewEvents: ReturnType<typeof vi.fn> }).countNewEvents)
      .mockResolvedValueOnce(0);
    await expect(enqueueOrderPartiallyRefundedEmails(d, OPTS)).resolves.toBeDefined();
  });

  it('🔵 cutoff 與 limit 原樣傳給 scanner', async () => {
    const d = deps([]);
    await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(d.scanner.listPartialRefundsWithoutEmail).toHaveBeenCalledWith({
      cutoff: '2026-09-08T00:00:00.000Z',
      limit: 50,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— **這一支**有沒有真的送出「不寄的意圖」。
//
// 🔴 **為什麼一支一格, 而不是一發數數量**(codex 2026-09-10 R1 should-fix ④):
//    七支本來就各有一個 `enqueue()` 呼叫 ⇒ 漏改其中一支, **仍然是七支七種**
//    ⇒ 「呼叫點數 === event_type 種類數」那種斷言**照樣通過**。
//    ⇒ 📌 它守的是「有沒有第八種事件出生」, **不是**「七支都改到了」——兩件事。
// 🛑 突變驗收:把**這一支**的那個分支退回 `continue` ⇒ **必須紅在這一格**, 不是別支那一格。
// ══════════════════════════════════════════════════════════════════════════════
describe('⟦auth-MANUALORDERLIMITBURN⟧ 手動單留白 ⇒ 落一列終態(不寄)', () => {
  it('🔴 呼叫 enqueueManualNoRecipient 一次, 收件人是借來的 customers.email;而 enqueue 零次', async () => {
      const d = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' })]);
      const outbox = d.outbox;
    await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(1);
    expect(trace.mock.calls[0]![0]).toMatchObject({ recipientEmail: 'frozen@example.com' });
    // 🟢 正對照:同一份 fake 的 enqueue **一次都沒被叫** ⇒ 真的沒寄。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });

  it('🔵 反面:手動單【有填】通知信箱 ⇒ 照舊寄, 不得落終態(少了這格,「手動一律不寄」也全綠)', async () => {
      const d = deps([row({ orderSource: 'manual_phone', notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' })]);
      const outbox = d.outbox;
    await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(0);
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(1);
    expect(sent.mock.calls[0]![0]).toMatchObject({ recipientEmail: 'staff@example.com' });
  });
});

// ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— codex 2026-09-10 R2 should-fix ①:
// **R1② 的兩個承重條件, 先前【兩個世界都會過】。** 它實測突變過:
//   · 把 suppressedInputs 加回 countNewEvents 的分母 ⇒ 121 格全過
//   · 把落痕迴圈移到 cap 之後            ⇒ 121 格全過
// 📌 兩個都是我宣稱「解掉了」的東西, 而**沒有任何一格在守它們**。下面兩格就是。
describe('⟦auth-MANUALORDERLIMITBURN⟧ 那兩個承重條件的守門', () => {
  it('🔴 不寄的列【不得】進 countNewEvents 的分母(進去 ⇒ 20 筆不寄會把 1 封真的該寄的擋掉)', async () => {
      const d = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' }), row({ orderSource: 'web', notificationEmail: 'ok@example.com' })]);
      const outbox = d.outbox;
    await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    const counted = outbox.countNewEvents as unknown as { mock: { calls: unknown[][] } };
    expect(counted.mock.calls).toHaveLength(1);
    const batch = counted.mock.calls[0]![0] as readonly { recipientEmail: string }[];
    // 🔴 分母裡只能有那一封真的要寄的。
    expect(batch).toHaveLength(1);
    expect(batch[0]!.recipientEmail).toBe('ok@example.com');
    // 🟢 正對照:那一列不寄的**確實被處理過**(否則上面那個 1 也可能只是「它整批沒進來」)。
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(1);
  });

  it('🔴 cap 擋下整批時, 痕跡【已經落下去了】(落痕迴圈必須排在 cap 之前)', async () => {
      const d = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' }), row({ orderSource: 'web', notificationEmail: 'ok@example.com' })]);
      const outbox = d.outbox;
    // 讓那道閘一定 throw(ENQUEUE_BATCH_CAP = 20)。
    (outbox.countNewEvents as unknown as { mockResolvedValue(v: number): void }).mockResolvedValue(999);
    await expect(enqueueOrderPartiallyRefundedEmails(d, OPTS)).rejects.toThrow();
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    // 🔴 這一格就是全部的意義:閘炸了, 而那一列的終態已經寫下去了。
    //    少了它 ⇒ 下一輪再撈到同一張單, 而那正是本片要修的病。
    expect(trace.mock.calls).toHaveLength(1);
    // 🟢 正對照:那一封真的要寄的**沒有**被寄出去(閘的確擋住了)。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });
});

// ── 2026-09-12 ⟦auth-PARTIALREFUNDCANCELGAP⟧ 完整版:兩欄缺 ⇒ 不排 ────────────
describe('order_state / refund_source 缺 ⇒ 不排(碼先上而 DB 後貼的那個時間窗)', () => {
  it.each([
    ['order_state 缺', { orderState: null }],
    ['refund_source 缺', { refundSource: null }],
  ])('🔴 %s ⇒ 一封都不排, 計在 unusableAmount(不猜成 active)', async (_label, over) => {
    const d = deps([row(over as Parameters<typeof row>[0])]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
    expect(r.unusableAmount).toBe(1);
  });

  it('🟢 正對照:兩欄都有 ⇒ 照排, 而且原樣帶進 enqueue(非卡那一筆)', async () => {
    const d = deps([row({ orderState: 'cancelled', refundSource: 'manual' })]);
    await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0]).toMatchObject({
      orderState: 'cancelled',
      refundSource: 'manual',
    });
  });
});
