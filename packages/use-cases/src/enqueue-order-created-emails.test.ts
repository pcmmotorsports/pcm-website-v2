// M-4a B-5 掃描式 enqueue 的 use-case 測試(plan §6 的 #1/#2/#3/#4/#6;#5 在 adapter、#7/#8 在 route)。
//
// 🔴 `#633` 驗收條款照抄:❌ 不可寫「有列 = 成功」;✅ 斷言 `recipientEmail` **不是 null 且等於某個具體值**。
import { describe, it, expect, vi } from 'vitest';
import type {
  IEmailOutbox,
  IPaidEmailContext,
  IPaidOrderScanner,
  LoadPaidContextResult,
  PaidEmailContext,
  PaidOrderWithoutOrderCreatedEmail,
} from '@pcm/ports';

import { enqueueOrderCreatedEmails } from './enqueue-order-created-emails';

const CUTOFF = '2026-08-18T00:00:00.000Z';

function row(over: Partial<PaidOrderWithoutOrderCreatedEmail> = {}): PaidOrderWithoutOrderCreatedEmail {
  return {
    orderId: 'order-1',
    displayId: 'ABC123',
    paidAt: '2026-08-18T10:00:00.000Z',
    notificationEmail: 'member@example.com',
    customerEmail: 'frozen@example.com',
    // 🔴 片 B(⟦f3-MAILFALLBACKVSRULING⟧):型別要求它, 而【本片沒有任何行為讀它】
    //    ⇒ 這裡給 'web' 只是讓 fixture 通過型別;片 C 才會有人問它。
    orderSource: 'web',
    ...over,
  };
}

function deps(
  rows: PaidOrderWithoutOrderCreatedEmail[],
  enqueue: ReturnType<typeof vi.fn> = vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })),
) {
  const scanner = {
    listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({ rows, scannedPages: 1, truncated: false })),
  } as unknown as IPaidOrderScanner;
  const outbox = {
    enqueue,
    // 🔵 甲-3:預設「全都是新的」⇒ 既有測項的行為與改版前逐格相同(它們的批量都遠小於 20)。
  //    那正是主視窗要的【正對照】:三段式是機械重排, 不是新邏輯。
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    // ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b:手動單留白 ⇒ 落一列終態(不寄)。
    enqueueManualNoRecipient: vi.fn(async () => ({ kind: 'skipped_manual_no_recipient', id: 'm1' })),
  } as unknown as IEmailOutbox;
  return { deps: { scanner, outbox }, enqueue, scanner };
}

describe('enqueueOrderCreatedEmails — 掃描 → 排信', () => {
  it('🔴 #1 掃到的單 ⇒ enqueue 被呼叫,recipientEmail = orders 那個【具體值】(不是「非 null」)', async () => {
    const { deps: d, enqueue } = deps([row()]);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      eventType: 'order_created',
      orderId: 'order-1',
      displayId: 'ABC123',
      paidAt: '2026-08-18T10:00:00.000Z',
      recipientEmail: 'member@example.com',
      requestId: null,
    });
    expect(res).toEqual({
      scanned: 1, scannedPages: 1, truncated: false,
      enqueued: 1, skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 0,
    });
  });

  it('🔴 #2 掃不到的(差集已在 scanner 算掉)⇒ 零呼叫;cutoff/limit 原樣傳進 scanner', async () => {
    // 差集本身在 adapter 的查詢裡(plan §4 ②③),use-case 這一層看到的就已經是「該排的」。
    // 這格釘的是:use-case **不會自己多撈**,而且不吞掉 route 給的兩個參數。
    const { deps: d, enqueue, scanner } = deps([]);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 7 });

    expect(enqueue).not.toHaveBeenCalled();
    expect(scanner.listPaidWithoutOrderCreatedEmail).toHaveBeenCalledWith({ cutoff: CUTOFF, limit: 7 });
    expect(res.scanned).toBe(0);
  });

  it('🔴 #3 notification_email 為 NULL ⇒ 用 customers.email(PRD §3.2 fallback)', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null })]);
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'frozen@example.com' }));
  });

  it('🔴 notification_email 是空字串 / 全空白 ⇒ 一樣落到 fallback(不是把空字串送進 enqueue)', async () => {
    for (const empty of ['', '   ']) {
      const { deps: d, enqueue } = deps([row({ notificationEmail: empty })]);
      await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
      expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'frozen@example.com' }));
    }
  });

  it('🔴 #4 合成假信箱 ⇒ 【照樣呼 enqueue】,由 adapter 落一列 skipped_no_real_email —— 不是靜默跳過', async () => {
    // 前一版寫「不 enqueue + 一行 log」= 對 PRD §3.2 的未申報偏離(V2/F13)。
    // 落一列才有查得到的痕跡;一行沒有人在看的 log 不是痕跡。
    // 🔴 本層**不判合成域**(那會長出第二套 LINE 判準)⇒ 這格同時釘住「有呼叫」與「回值被歸到正確的桶」。
    const enqueue = vi.fn(async () => ({ kind: 'skipped_no_real_email', id: 'e2' }));
    const { deps: d } = deps([row({ notificationEmail: 'line_x@line.pcmmotorsports.local' })], enqueue);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'line_x@line.pcmmotorsports.local' }),
    );
    expect(res).toMatchObject({ scanned: 1, enqueued: 0, skippedNoRealEmail: 1 });
  });

  it('兩個候選都沒有 ⇒ 不 enqueue、計 noRecipient(不是 errors)', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null, customerEmail: null })]);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).not.toHaveBeenCalled();
    expect(res).toMatchObject({ scanned: 1, noRecipient: 1, errors: 0 });
  });

  it('duplicate ⇒ 歸 duplicate 桶(冪等成功,不是錯誤)', async () => {
    const enqueue = vi.fn(async () => ({ kind: 'duplicate' }));
    const { deps: d } = deps([row()], enqueue);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(res).toMatchObject({ duplicate: 1, enqueued: 0, errors: 0 });
  });

  it('🔴 #6 單筆 throw ⇒ 其餘照跑、errors +1(整輪不中斷;下一輪會再撈到它)', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e3' })
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e4' });
    const { deps: d } = deps(
      [row({ orderId: 'o1' }), row({ orderId: 'o2' }), row({ orderId: 'o3' })],
      enqueue,
    );
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledTimes(3); // 沒有在第一筆就停
    expect(res).toEqual({
      scanned: 3, scannedPages: 1, truncated: false,
      enqueued: 2, skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 1,
    });
  });

  it('🔴 MF3:單筆失敗時【一行 log 都不准寫】—— 錯誤物件裡就裝著收件信箱', async () => {
    // codex 關卡2 R1 must-fix 3:把 catch 改成 `catch (e) { console.error(e); errors++ }`
    // 現有測試會全綠,而客人的 email 就進了 log(PRD §7 明文禁止)。⇒ 這格直接盯 console。
    const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const enqueue = vi.fn().mockRejectedValue(new Error('boom member@example.com'));
      const { deps: d } = deps([row()], enqueue);
      const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

      expect(res).toMatchObject({ errors: 1 });
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('🔴 scanner 的 scannedPages / truncated 原樣透出(不得靜默截斷)', async () => {
    const scanner = {
      listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({ rows: [row()], scannedPages: 25, truncated: true })),
    } as unknown as IPaidOrderScanner;
    const outbox = {
      enqueue: vi.fn(async () => ({ kind: 'enqueued', id: 'e9' })),
      countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
      // ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b:手動單留白 ⇒ 落一列終態(不寄)。
      enqueueManualNoRecipient: vi.fn(async () => ({ kind: 'skipped_manual_no_recipient', id: 'm1' })),
    } as unknown as IEmailOutbox;

    const res = await enqueueOrderCreatedEmails({ scanner, outbox }, { cutoff: CUTOFF, limit: 50 });

    expect(res).toMatchObject({ scannedPages: 25, truncated: true });
  });

  it('🔴 #7 的一半:result 只有數字,零 email 字面(PRD §7)', async () => {
    const enqueue = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e5' })
      .mockRejectedValueOnce(Object.assign(new Error('leak: member@example.com'), { detail: 'member@example.com' }));
    const { deps: d } = deps(
      [row({ orderId: 'o1' }), row({ orderId: 'o2' })],
      enqueue,
    );
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    // 連「錯誤訊息裡帶著 email」這種情況都不得漏出去 —— 所以 catch 連 error 物件都不留。
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('@');
    // truncated 是 boolean、其餘全是數字 —— 重點是**沒有任何字串欄**(字串才裝得下 email)。
    expect(Object.values(res).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);
    expect(res).toMatchObject({ errors: 1 });
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
      const { deps: d, enqueue } = deps([
        row({ orderSource: src, notificationEmail: null, customerEmail: 'frozen@example.com' }),
      ]);
      const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
      expect(enqueue).not.toHaveBeenCalled();
      expect(res).toMatchObject({ noRecipient: 1, enqueued: 0, errors: 0 });
    });

    it(`② ${src} + 有值 ⇒ 照樣寄到那個值(少了這格,「手動一律不寄」也全綠)`, async () => {
      const { deps: d, enqueue } = deps([
        row({ orderSource: src, notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' }),
      ]);
      await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'staff@example.com' }),
      );
    });
  }

  it('③ 🟢 顧客站 + 留白 ⇒ 仍退回 customers.email(現狀不得變)', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: 'web', notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
  });

  it('④ 顧客站 + 有值 ⇒ 寄到那個值', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: 'web', notificationEmail: 'buyer@example.com', customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'buyer@example.com' }),
    );
  });

  it('🔴 orderSource 為 null(view 沒給)⇒ 照舊寄 —— 少寄一封看不見', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: null, notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
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
      const r = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' })]);
      const d = r.deps;
      const outbox = d.outbox;
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(1);
    expect(trace.mock.calls[0]![0]).toMatchObject({ recipientEmail: 'frozen@example.com' });
    // 🟢 正對照:同一份 fake 的 enqueue **一次都沒被叫** ⇒ 真的沒寄。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });

  it('🔵 反面:手動單【有填】通知信箱 ⇒ 照舊寄, 不得落終態(少了這格,「手動一律不寄」也全綠)', async () => {
      const r = deps([row({ orderSource: 'manual_phone', notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' })]);
      const d = r.deps;
      const outbox = d.outbox;
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
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
      const r = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' }), row({ orderSource: 'web', notificationEmail: 'ok@example.com' })]);
      const d = r.deps;
      const outbox = d.outbox;
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
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
      const r = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' }), row({ orderSource: 'web', notificationEmail: 'ok@example.com' })]);
      const d = r.deps;
      const outbox = d.outbox;
    // 讓那道閘一定 throw(ENQUEUE_BATCH_CAP = 20)。
    (outbox.countNewEvents as unknown as { mockResolvedValue(v: number): void }).mockResolvedValue(999);
    await expect(enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 })).rejects.toThrow();
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    // 🔴 這一格就是全部的意義:閘炸了, 而那一列的終態已經寫下去了。
    //    少了它 ⇒ 下一輪再撈到同一張單, 而那正是本片要修的病。
    expect(trace.mock.calls).toHaveLength(1);
    // 🟢 正對照:那一封真的要寄的**沒有**被寄出去(閘的確擋住了)。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });
});

// ── 2026-09-11 凍-C:入列當下凍金額(plan-paid-amount-frozen;Sean 拍「甲、甲」)────────
describe('enqueueOrderCreatedEmails — 付款信金額凍結快照', () => {
  const m = (n: number) => n as PaidEmailContext['total'];
  const snap: PaidEmailContext = {
    orderDisplayId: 'ABC123',
    lines: [{ title: '排氣管', variantSku: 'SKU-1', quantity: 1, lineTotal: m(940) }],
    linesTruncated: false,
    subtotal: m(940),
    shippingFee: m(160),
    discountTotal: m(0),
    taxTotal: m(0),
    total: m(1100),
  };
  const withPaid = (result: LoadPaidContextResult | Error) => {
    const r = deps([row()]);
    const loadPaidContext = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    return { ...r, d: { ...r.deps, paidContext: { loadPaidContext } as IPaidEmailContext }, loadPaidContext };
  };

  it('🟢 讀得到 ⇒ 帶 paidSnapshot 入列(同一支 loadPaidContext、問的是那張單)', async () => {
    const { d, enqueue, loadPaidContext } = withPaid({ kind: 'ok', context: snap });
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(loadPaidContext).toHaveBeenCalledWith({ orderId: 'order-1' });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', paidSnapshot: snap }));
    expect(res.enqueued).toBe(1);
    expect(res.errors).toBe(0);
  });

  it.each([
    ['unavailable', { kind: 'unavailable' } as LoadPaidContextResult],
    ['cancelled', { kind: 'cancelled' } as LoadPaidContextResult],
    ['截斷', { kind: 'ok', context: { ...snap, linesTruncated: true } } as LoadPaidContextResult],
    ['throw', new Error('boom')],
  ])('🔵 %s ⇒ 照今天入列 v1(不帶 paidSnapshot、不計 error)', async (_l, result) => {
    const { d, enqueue } = withPaid(result);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    const input = (enqueue.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(input, 'paidSnapshot')).toBe(false);
    expect(res.enqueued).toBe(1);
    expect(res.errors).toBe(0);
  });

  it('🔵 手動單留白(不寄)那一列不讀金額', async () => {
    const r = deps([row({ orderSource: 'manual_phone', notificationEmail: null })]);
    const loadPaidContext = vi.fn();
    await enqueueOrderCreatedEmails({ ...r.deps, paidContext: { loadPaidContext } }, { cutoff: CUTOFF, limit: 50 });
    expect(loadPaidContext).not.toHaveBeenCalled();
  });
});
