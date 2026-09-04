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
  const outbox = { enqueue } as unknown as IEmailOutbox;
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
