import { describe, expect, it, vi } from 'vitest';
import type { IEmailOutbox, IUnpaidCancelledOrderScanner } from '@pcm/ports';
import { enqueueOrderUnpaidCancelledEmails } from './enqueue-order-unpaid-cancelled-emails';

const OPTS = { cutoff: '2026-09-03T00:00:00.000Z', limit: 50 };

function row(over: Partial<Parameters<typeof mkRow>[0]> = {}) {
  return mkRow({
    orderId: 'order-1',
    displayId: 'PCM-2026-0001',
    cancelledAt: '2026-09-03T10:00:00.000Z',
    cancelledReason: 'out_of_stock',
    notificationEmail: 'a@example.com',
    customerEmail: null,
    // 🔴 片 B(⟦f3-MAILFALLBACKVSRULING⟧):型別要求它, 而【本片沒有任何行為讀它】
    //    ⇒ 這裡給 'web' 只是讓 fixture 通過型別;片 C 才會有人問它。
    orderSource: 'web',
    ...over,
  });
}
function mkRow(r: {
  orderId: string;
  displayId: string;
  cancelledAt: string;
  cancelledReason: string | null;
  notificationEmail: string | null;
  customerEmail: string | null;
  orderSource: string | null;
}) {
  return r;
}

function deps(rows: ReturnType<typeof row>[]) {
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, id: 'outbox-1' })),
    // 🔵 甲-3:預設「全都是新的」⇒ 既有測項的行為與改版前逐格相同(批量都遠小於 20)。
    //    🛑 少了這一行, `as unknown as` 會讓 typecheck 照樣綠, 而測試在執行期才炸。
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    // ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b:手動單留白 ⇒ 落一列終態(不寄)。
    enqueueManualNoRecipient: vi.fn(async () => ({ kind: 'skipped_manual_no_recipient', id: 'm1' })),
  } as unknown as IEmailOutbox;
  const scanner: IUnpaidCancelledOrderScanner = {
    listUnpaidCancelledWithoutEmail: vi.fn(async () => ({
      rows,
      scannedPages: 1,
      truncated: false,
    })),
  };
  return { outbox, scanner };
}

describe('enqueueOrderUnpaidCancelledEmails', () => {
  it('🔴 正常一筆 ⇒ 排一封, 而 payload 帶取消時刻與理由', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(r.enqueued).toBe(1);
    expect(d.outbox.enqueue).toHaveBeenCalledExactlyOnceWith({
      eventType: 'order_unpaid_cancelled',
      orderId: 'order-1',
      displayId: 'PCM-2026-0001',
      cancelledAt: '2026-09-03T10:00:00.000Z',
      cancelledReason: 'out_of_stock',
      recipientEmail: 'a@example.com',
      requestId: null,
    });
  });

  it('🔴 兩個信箱都空 ⇒ 不 enqueue, 計 noRecipient(空字串也算空)', async () => {
    const d = deps([row({ notificationEmail: '   ', customerEmail: null })]);
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(r.noRecipient).toBe(1);
    expect(r.enqueued).toBe(0);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 notification 空 ⇒ 退化到 customerEmail', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: 'b@example.com' })]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    const arg = (d.outbox.enqueue as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as {
      recipientEmail: string;
    };
    expect(arg.recipientEmail).toBe('b@example.com');
  });

  it('🔴 單筆 enqueue 炸掉 ⇒ 不擋整批, 計 errors', async () => {
    const d = deps([row({ orderId: 'a' }), row({ orderId: 'b' })]);
    (d.outbox.enqueue as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error('boom'),
    );
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(r.errors).toBe(1);
    expect(r.enqueued).toBe(1);
  });

  it('🔴 result 只有數字 —— 沒有任何一欄帶得出 email(PII)', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(JSON.stringify(r)).not.toContain('@');
  });
});

/**
 * 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;板列 `⟦f3-MAILFALLBACKVSRULING⟧` 片 C)。
 *
 * ## 四個世界都要有格 —— 少一個就分不出「修對了」與「全部關掉了」
 * ```
 * ① 手動 + 留白   ⇒ 🔴 不寄(而不是退回 customers.email)
 * ② 手動 + 有值   ⇒ ✅ 寄到那個值   ← 少了它, 一個「手動一律不寄」的實作也全綠
 * ③ 顧客站 + 留白 ⇒ ✅ 寄到 customers.email(現狀不得變)
 * ④ 顧客站 + 有值 ⇒ ✅ 寄到那個值
 * ```
 * 🔵 **負對照:`manual_line` / `manual_other` 各跑一發** ——
 *    只測 `manual_phone` 的話,一個寫死 `=== 'manual_phone'` 的實作**每一格都綠**。
 *
 * ## ⚠️ 這一組【證不到】什麼
 * 它驗的是**這一層的分流**,不驗「view 真的把 `order_source` 帶出來了」(那是 adapter 那層),
 * 也不驗「信真的沒寄出去」(那要真跑)。
 */
describe('片 C:手動建單留白 = 不寄', () => {
  const MANUALS = ['manual_phone', 'manual_line', 'manual_other'] as const;

  for (const src of MANUALS) {
    it(`① ${src} + 留白 ⇒ 不寄、計 noRecipient(不得退回 customers.email)`, async () => {
      const d = deps([
        row({ orderSource: src, notificationEmail: null, customerEmail: 'frozen@example.com' }),
      ]);
      const res = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
      expect(d.outbox.enqueue).not.toHaveBeenCalled();
      expect(res).toMatchObject({ noRecipient: 1, enqueued: 0, errors: 0 });
    });

    it(`② ${src} + 有值 ⇒ 照樣寄到那個值(少了這格,「手動一律不寄」也全綠)`, async () => {
      const d = deps([
        row({ orderSource: src, notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' }),
      ]);
      await enqueueOrderUnpaidCancelledEmails(d, OPTS);
      expect(d.outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'staff@example.com' }),
      );
    });
  }

  it('③ 🟢 顧客站 + 留白 ⇒ 仍退回 customers.email(現狀不得變)', async () => {
    const d = deps([
      row({ orderSource: 'web', notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
  });

  it('④ 顧客站 + 有值 ⇒ 寄到那個值', async () => {
    const d = deps([
      row({ orderSource: 'web', notificationEmail: 'buyer@example.com', customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'buyer@example.com' }),
    );
  });

  it('🔴 orderSource 為 null(view 沒給)⇒ 照舊寄 —— 少寄一封看不見', async () => {
    const d = deps([
      row({ orderSource: null, notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
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
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
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
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
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
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
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
    await expect(enqueueOrderUnpaidCancelledEmails(d, OPTS)).rejects.toThrow();
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    // 🔴 這一格就是全部的意義:閘炸了, 而那一列的終態已經寫下去了。
    //    少了它 ⇒ 下一輪再撈到同一張單, 而那正是本片要修的病。
    expect(trace.mock.calls).toHaveLength(1);
    // 🟢 正對照:那一封真的要寄的**沒有**被寄出去(閘的確擋住了)。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });
});
