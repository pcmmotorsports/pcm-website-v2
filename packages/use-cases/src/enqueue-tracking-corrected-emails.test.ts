// ⟦5b-TRACKNUMGAP1⟧ 片 C:更正單號信的掃描式 enqueue —— use-case 測試。
//
// 🔴🔴 **先講這一檔【碰不到】什麼, 否則下面每一格都會被讀得比它實際上寬。**
//    主視窗要的兩個世界是「剛出貨沒改過 ⇒ 0 封」與「改過一次 ⇒ 1 封」,
//    🛑 **而那兩個世界的分界【住在 SQL】**(`pcm_tracking_corrected_email_pending` 的
//      `tracking_corrected_at IS NOT NULL` 與那道 `sent_at < tracking_corrected_at` 的 EXISTS)。
//    ⇒ 📌 本檔拿到的是 scanner **已經篩過**的列 ⇒ 我在這裡餵 0 列然後斷言 0 封,
//      證明的是「0 列進 ⇒ 0 封出」, **不是「沒改過的箱不會進來」**。
//    ⇒ ✅ 那一半由 **migration 自己的 apply 期釘樁**守:
//      `20260904220000_...sql` 讀 `pg_get_viewdef()` 回核那兩個字面, 少任一個當場 RAISE。
//      🔴 **已用突變證過**:拿掉 `tracking_corrected_at IS NOT NULL` ⇒ 釘樁 ERROR 且訊息說出後果。
//    ⛔ ~~原本這裡寫「由 `tracking-corrected-view-literals.test.ts` 守」~~ —— **那支檔不存在**
//      (codex 對抗審查 must-fix)。📌 我把釘樁搬進 migration 之後**沒有回來改這句話**,
//      而一個指向不存在檔案的「已經有人守了」, 比誠實寫「沒有人守」更貴:
//      **它會關掉下一個人的尋找動作。**
import { describe, it, expect, vi } from 'vitest';
import type {
  IEmailOutbox,
  ITrackingCorrectedScanner,
  ShipmentWithCorrectedTracking,
} from '@pcm/ports';

import { enqueueTrackingCorrectedEmails } from './enqueue-tracking-corrected-emails';

function row(over: Partial<ShipmentWithCorrectedTracking> = {}): ShipmentWithCorrectedTracking {
  return {
    shipmentId: 'ship-1',
    shipmentReference: 'BCDF23',
    trackingNumber: 'HCT-99887766',
    carrierCode: 'hct',
    trackingCorrectedAt: '2026-09-04T10:00:00.000Z',
    trackingCorrectedKey: '20260904100000000000',
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
  rows: ShipmentWithCorrectedTracking[],
  enqueue: ReturnType<typeof vi.fn> = vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })),
  truncated = false,
) {
  const scanner = {
    listTrackingCorrectedWithoutEmail: vi.fn(async () => ({ rows, truncated })),
  } as unknown as ITrackingCorrectedScanner;
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

describe('enqueueTrackingCorrectedEmails', () => {
  it('🔴 世界B:改過一次 ⇒ 排 1 封, 而且【號碼與箱號都是具體的值】', async () => {
    const { deps: d, enqueue } = deps([row()]);
    const r = await enqueueTrackingCorrectedEmails(d, { limit: 25 });

    expect(r).toMatchObject({ scanned: 1, enqueued: 1, noRecipient: 0, errors: 0 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    // 🔴 承重:只驗「寄給對的人」分不出哪一封是對的 —— 同一箱改兩次會寄兩封。
    //    所以**號碼**必須被斷言成一個具體值。
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      eventType: 'shipment_tracking_corrected',
      shipmentId: 'ship-1',
      shipmentReference: 'BCDF23',
      trackingNumber: 'HCT-99887766',
      recipientEmail: 'member@example.com',
    });
  });

  it('🔵 世界A:scanner 回 0 列 ⇒ 一封都不排, 而且【一次都沒呼叫 outbox】', async () => {
    const { deps: d, enqueue } = deps([]);
    const r = await enqueueTrackingCorrectedEmails(d, { limit: 25 });

    expect(r).toMatchObject({ scanned: 0, enqueued: 0, errors: 0, truncated: false });
    // 🔴 承重:少了這一行, 一個「不管三七二十一先 enqueue 再說」的實作照樣通過上一行。
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('🔴 同一箱改兩次 ⇒ 兩列**不同鑰匙** ⇒ 兩封, 而且兩封的號碼不一樣', async () => {
    // 🔴 **兩列的 `trackingCorrectedKey` 必須不同**(codex R2 must-fix #7):
    //    上一版兩列共用預設的同一把鑰匙, 而 mock 硬回兩次 `enqueued`
    //    ⇒ 📌 **真實世界那兩列會撞唯一鍵**(第二列回 `duplicate`)⇒ 這一格演的是一個
    //      **不存在的世界**, 而它照樣綠。⇒ 假設要跟著鍵的形狀走。
    const { deps: d, enqueue } = deps([
      row({ trackingNumber: 'AAA-111', trackingCorrectedKey: '20260904100000000000' }),
      row({ trackingNumber: 'BBB-222', trackingCorrectedKey: '20260904110000000000' }),
    ]);
    const r = await enqueueTrackingCorrectedEmails(d, { limit: 25 });

    expect(r).toMatchObject({ scanned: 2, enqueued: 2 });
    const nums = enqueue.mock.calls.map((c) => (c[0] as { trackingNumber: string }).trackingNumber);
    // 🔴 承重:一個把號碼寫死成第一列的實作, 只有這一行殺得死它。
    expect(nums).toEqual(['AAA-111', 'BBB-222']);
  });

  it('🔵 notificationEmail 空 ⇒ 退到 customerEmail(與出貨線同一條 fallback)', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null })]);
    await enqueueTrackingCorrectedEmails(d, { limit: 25 });
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ recipientEmail: 'frozen@example.com' });
  });

  it('🔵 兩個信箱都空 ⇒ 計 noRecipient, 不呼叫 outbox, 不算 errors', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null, customerEmail: null })]);
    const r = await enqueueTrackingCorrectedEmails(d, { limit: 25 });
    expect(r).toMatchObject({ scanned: 1, enqueued: 0, noRecipient: 1, errors: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['skipped_no_real_email', 'skippedNoRealEmail'],
    ['duplicate', 'duplicate'],
  ])('🔵 outbox 回 %s ⇒ 落在 %s 這一堆, 不算 enqueued', async (kind, bucket) => {
    const { deps: d } = deps([row()], vi.fn(async () => ({ kind, id: 'e1' })));
    const r = await enqueueTrackingCorrectedEmails(d, { limit: 25 });
    expect(r.enqueued).toBe(0);
    expect(r[bucket as keyof typeof r]).toBe(1);
  });

  it('🔴 一列 throw ⇒ 計 errors 而【其餘照排】—— 一顆壞的不擋整輪', async () => {
    let n = 0;
    const enqueue = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return { kind: 'enqueued', id: 'e2' };
    });
    const { deps: d } = deps([row({ trackingNumber: 'X1' }), row({ trackingNumber: 'X2' })], enqueue);
    const r = await enqueueTrackingCorrectedEmails(d, { limit: 25 });
    // 🔴 承重:errors 沒被數起來 ⇒ route 回 200 ⇒ 心跳記成功 ⇒ 那正是這條線在修的病。
    expect(r).toMatchObject({ scanned: 2, enqueued: 1, errors: 1 });
  });

  it('🔵 truncated 原樣傳出去 —— 它是「這輪沒撈完」的唯一訊號', async () => {
    const { deps: d } = deps([row()], undefined, true);
    expect((await enqueueTrackingCorrectedEmails(d, { limit: 1 })).truncated).toBe(true);
  });

  it('🔵 limit 原樣交給 scanner(不被本檔改寫)', async () => {
    const { deps: d, scanner } = deps([]);
    await enqueueTrackingCorrectedEmails(d, { limit: 7 });
    expect(
      (scanner.listTrackingCorrectedWithoutEmail as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0],
    ).toEqual({ limit: 7 });
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
      const res = await enqueueTrackingCorrectedEmails(d, { limit: 50 });
      expect(enqueue).not.toHaveBeenCalled();
      expect(res).toMatchObject({ noRecipient: 1, enqueued: 0, errors: 0 });
    });

    it(`② ${src} + 有值 ⇒ 照樣寄到那個值(少了這格,「手動一律不寄」也全綠)`, async () => {
      const { deps: d, enqueue } = deps([
        row({ orderSource: src, notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' }),
      ]);
      await enqueueTrackingCorrectedEmails(d, { limit: 50 });
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'staff@example.com' }),
      );
    });
  }

  it('③ 🟢 顧客站 + 留白 ⇒ 仍退回 customers.email(現狀不得變)', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: 'web', notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueTrackingCorrectedEmails(d, { limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
  });

  it('④ 顧客站 + 有值 ⇒ 寄到那個值', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: 'web', notificationEmail: 'buyer@example.com', customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueTrackingCorrectedEmails(d, { limit: 50 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'buyer@example.com' }),
    );
  });

  it('🔴 orderSource 為 null(view 沒給)⇒ 照舊寄 —— 少寄一封看不見', async () => {
    const { deps: d, enqueue } = deps([
      row({ orderSource: null, notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueTrackingCorrectedEmails(d, { limit: 50 });
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
    await enqueueTrackingCorrectedEmails(d, { limit: 25 });
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
    await enqueueTrackingCorrectedEmails(d, { limit: 25 });
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
    await enqueueTrackingCorrectedEmails(d, { limit: 25 });
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
    await expect(enqueueTrackingCorrectedEmails(d, { limit: 25 })).rejects.toThrow();
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    // 🔴 這一格就是全部的意義:閘炸了, 而那一列的終態已經寫下去了。
    //    少了它 ⇒ 下一輪再撈到同一張單, 而那正是本片要修的病。
    expect(trace.mock.calls).toHaveLength(1);
    // 🟢 正對照:那一封真的要寄的**沒有**被寄出去(閘的確擋住了)。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });
});
