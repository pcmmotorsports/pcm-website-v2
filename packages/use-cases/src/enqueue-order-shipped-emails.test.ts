// M-4b E4-a 出貨信掃描式 enqueue 的 use-case 測試。
//
// 🔴 **驗收條款照抄 `#633`,而且加嚴一格**:
//   ❌ 不可寫「有列 = 成功」 —— `recipient_email` 是 null 時**照樣有列**。
//   ✅ 斷言 `recipientEmail` 不是 null、**等於某個具體值**。
//   ✅ 🔴 再加一格:斷言**那封信講的是【哪一箱、哪一張單】** ——
//      出貨信與付款信的差別就在這裡:同一張訂單會寄多封,只驗「寄給對的人」分不出哪一封是對的。
import { describe, it, expect, vi } from 'vitest';
import type { IEmailOutbox, IShippedOrderScanner, ShippedOrderWithoutShippedEmail } from '@pcm/ports';

import { enqueueOrderShippedEmails } from './enqueue-order-shipped-emails';

const CUTOFF = '2026-08-22T00:00:00.000Z';

function row(over: Partial<ShippedOrderWithoutShippedEmail> = {}): ShippedOrderWithoutShippedEmail {
  return {
    shipmentId: 'ship-1',
    shipmentReference: 'BCDF23',
    shippedAt: '2026-08-22T10:00:00.000Z',
    orderId: 'order-1',
    displayId: 'PCM-2026-0001',
    notificationEmail: 'member@example.com',
    customerEmail: 'frozen@example.com',
    // 🔴 片 B(⟦f3-MAILFALLBACKVSRULING⟧):型別要求它, 而【本片沒有任何行為讀它】
    //    ⇒ 這裡給 'web' 只是讓 fixture 通過型別;片 C 才會有人問它。
    orderSource: 'web',
    ...over,
  };
}

function deps(
  rows: ShippedOrderWithoutShippedEmail[],
  enqueue: ReturnType<typeof vi.fn> = vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })),
  truncated = false,
) {
  const scanner = {
    listShippedWithoutShippedEmail: vi.fn(async () => ({ rows, truncated })),
  } as unknown as IShippedOrderScanner;
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

describe('enqueueOrderShippedEmails', () => {
  it('世界A:一箱一單、客人有真信箱 ⇒ 排 1 封,而且【收件人與箱號都是具體的值】', async () => {
    const { deps: d, enqueue } = deps([row()]);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ scanned: 1, enqueued: 1, noRecipient: 0, errors: 0 });
    // 🔴 這一格才是驗收:不是「有沒有呼叫 enqueue」,是「呼叫時帶著什麼」。
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'order_shipped',
      recipientEmail: 'member@example.com', // ← 不是 null,是這個具體的值
      displayId: 'PCM-2026-0001',
      shipmentId: 'ship-1',
      shipmentReference: 'BCDF23',
      shippedAt: '2026-08-22T10:00:00.000Z',
    });
  });

  it('🔴 世界B:同一箱裝兩張訂單 ⇒ 排【兩封】,而且兩封各講一張單', async () => {
    // Sean 2026-08-17 逐字「一箱兩單就兩封,一封講一張訂單」。
    // ⚠️ 2026-08-22 量測:正式庫「裝超過一張單的箱」= 0 ⇒ 這條路沒有真實流量會走到。
    //
    // 🔴 ~~「本格是唯一會碰到它的東西」~~ **那句話是錯的,codex R1 抓到(2026-08-22)**:
    //    本格只呼叫 **mocked outbox**,`dedup_key` 與那支 SQL view **一行都沒執行到**
    //    ⇒ 把 SQL 側的 dedup 改成別的格式,本格**照樣全綠**。
    // ⇒ 真正碰得到那條路的有三處,**都不在這裡**:
    //    · TS 側 dedup 字面 → `SupabaseEmailOutboxAdapter.test.ts`「dedup_key = {shipment}:{order}」那兩格
    //    · SQL 側 dedup 字面 → migration §4b 的 apply 期釘樁
    //    · view 真的把一箱兩單攤成兩列 → 2026-08-22 拋棄式 PG 實跑(BCDF23 ⇒ 2 列,交件單有輸出)
    // 📌 本格驗的是**這一層**:scanner 給兩列時,use-case 會不會各排一封、不會不會併成一封。
    const { deps: d, enqueue } = deps([
      row({ orderId: 'order-A', displayId: 'PCM-2026-0001' }),
      row({ orderId: 'order-B', displayId: 'PCM-2026-0002' }),
    ]);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ scanned: 2, enqueued: 2, errors: 0 });
    const sent = enqueue.mock.calls.map((c) => c[0] as { orderId: string; displayId: string; shipmentId: string });
    expect(sent.map((s) => s.orderId)).toEqual(['order-A', 'order-B']);
    // 兩封的訂單編號必須不同 —— 相同就代表兩封在講同一張單。
    expect(new Set(sent.map((s) => s.displayId)).size).toBe(2);
    // 而箱是同一個(這正是「一箱兩單」的定義)。
    expect(new Set(sent.map((s) => s.shipmentId)).size).toBe(1);
  });

  it('世界C:adapter 判為合成假信箱 ⇒ 記 skippedNoRealEmail、不記 enqueued', async () => {
    // 🔴 判合成域的是 adapter(單一常數來源),本層只數它回來的那個 kind。
    //    本層若自己先判一次,repo 裡就會有第二套 LINE 判準。
    const enqueue = vi.fn(async () => ({ kind: 'skipped_no_real_email', id: 'e9' }));
    const { deps: d } = deps([row()], enqueue);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ scanned: 1, enqueued: 0, skippedNoRealEmail: 1, errors: 0 });
  });

  it('兩個信箱都沒有 ⇒ noRecipient,而且【完全不呼叫 enqueue】', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null, customerEmail: null })]);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ scanned: 1, noRecipient: 1, enqueued: 0, errors: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('空字串信箱要當成沒有(不是丟給 enqueue 讓它 throw 成 errors)', async () => {
    const { deps: d } = deps([row({ notificationEmail: '   ', customerEmail: '' })]);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ noRecipient: 1, errors: 0 });
  });

  it('訂單欄空 ⇒ 退回 customers.email(與 order_created 同一條 fallback)', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null })]);
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({ recipientEmail: 'frozen@example.com' });
  });

  it('單筆 throw ⇒ 記 errors、**不中斷整輪**(下一筆照排)', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e2' });
    const { deps: d } = deps([row({ orderId: 'order-A' }), row({ orderId: 'order-B' })], enqueue);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ scanned: 2, enqueued: 1, errors: 1 });
  });

  it('🔴 cutoff 與 limit 要**原樣**交給 scanner —— 少了 cutoff 就是把歷史上每一箱都排進去', async () => {
    const { deps: d, scanner } = deps([]);
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 7 });

    expect(scanner.listShippedWithoutShippedEmail).toHaveBeenCalledWith({ cutoff: CUTOFF, limit: 7 });
  });

  it('truncated 要原樣傳出去(「掃完了」與「還有沒掃到」不可混為一談)', async () => {
    const { deps: d } = deps([row()], vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })), true);
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r.truncated).toBe(true);
  });

  it('duplicate 是冪等成功,不是錯誤(同一輪重跑不該把 errors 衝高)', async () => {
    const { deps: d } = deps([row()], vi.fn(async () => ({ kind: 'duplicate' })));
    const r = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });

    expect(r).toMatchObject({ duplicate: 1, enqueued: 0, errors: 0 });
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
      const res = await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 50 });
      expect(enqueue).not.toHaveBeenCalled();
      expect(res).toMatchObject({ noRecipient: 1, enqueued: 0, errors: 0 });
    });

    it(`② ${src} + 有值 ⇒ 照樣寄到那個值(少了這格,「手動一律不寄」也全綠)`, async () => {
      const { deps: d, enqueue } = deps([
        row({ orderSource: src, notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' }),
      ]);
      await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 50 });
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'staff@example.com' }),
      );
    });
  }

  it('③ 🟢 顧客站 + 留白 ⇒ 仍退回 customers.email(現狀不得變)', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: 'web', notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
  });

  it('④ 顧客站 + 有值 ⇒ 寄到那個值', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: 'web', notificationEmail: 'buyer@example.com', customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'buyer@example.com' }),
    );
  });

  it('🔴 orderSource 為 null(view 沒給)⇒ 照舊寄 —— 少寄一封看不見', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: null, notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 50 });
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
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });
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
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });
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
    await enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 });
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
    await expect(enqueueOrderShippedEmails(d, { cutoff: CUTOFF, limit: 25 })).rejects.toThrow();
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    // 🔴 這一格就是全部的意義:閘炸了, 而那一列的終態已經寫下去了。
    //    少了它 ⇒ 下一輪再撈到同一張單, 而那正是本片要修的病。
    expect(trace.mock.calls).toHaveLength(1);
    // 🟢 正對照:那一封真的要寄的**沒有**被寄出去(閘的確擋住了)。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });
});
