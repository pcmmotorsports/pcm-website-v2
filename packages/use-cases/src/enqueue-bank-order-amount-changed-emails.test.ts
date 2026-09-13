// enqueue-bank-order-amount-changed-emails.test.ts
//
// 🔵 本檔與它測的那支 use-case 同一天誕生(2026-09-13)——
//    ⚠️ 而隔壁 `enqueue-bank-order-created-emails.test.ts` 的檔頭記著一件事,值得先讀:
//    那條排信線**誕生(09-06)之後四天都一個測試都沒有**(測試檔 09-10 才生),
//    而「它零測試」這件事沒有任何一格會叫。
//    ⛔ 我原本寫「好幾個月」—— 那是假的(Fable 2026-09-13 F7)。**四天已經夠說明問題**,
//       而把它誇大會讓下一個人以為「這種事只發生在放很久的碼上」。
//    ⇒ 📌 所以本檔在**還沒有呼叫端**的時候就先寫,而不是等接線之後。
//
// 🛑 **本檔測得到什麼 / 測不到什麼 —— 這一節是義務不是說明**:
// ```
// ✅ 測得到:掃描列 → enqueue input 的【對應關係】(尤其 cancellationId 有沒有原樣帶過去)、
//            兩個信箱的 fallback、cap 閘的分母、一筆壞掉不倒整批
// ⛔ 測不到:PostgREST 真的撈到什麼(scanner 是替身)、那封信長什麼樣(寄送端是 throw)、
//            dedup_key 與 SQL 那份合不合(那在 order-email-assembly.test.ts 的字面釘樁)
// ```

import { describe, expect, it, vi } from 'vitest';
import type {
  IEmailOutbox,
  IBankOrderAmountChangedScanner,
  BankOrderAmountChangedWithoutEmail,
} from '@pcm/ports';
import { enqueueBankOrderAmountChangedEmails } from './enqueue-bank-order-amount-changed-emails';

// 🔴 **注意沒有 cutoff** —— 那是刻意的(理由在 port 檔頭:對訂單的 created_at 下 cutoff 會安靜漏寄)。
const OPTS = { limit: 25 };

function row(
  over: Partial<BankOrderAmountChangedWithoutEmail> = {},
): BankOrderAmountChangedWithoutEmail {
  return {
    orderId: '11111111-1111-4111-8111-111111111111',
    cancellationId: '00000000-0000-0000-0000-0000000000c1',
    displayId: 'PCM-2026-0001',
    createdAt: '2026-09-09T13:54:00Z',
    total: 900,
    balanceDue: 900,
    notificationEmail: 'staff@example.com',
    customerEmail: 'frozen@example.com',
    orderSource: 'web',
    ...over,
  } as BankOrderAmountChangedWithoutEmail;
}

function deps(rows: BankOrderAmountChangedWithoutEmail[]) {
  const scanner = {
    listBankOrderAmountChangedWithoutEmail: vi.fn(async () => ({
      rows,
      scannedPages: 1,
      truncated: false,
    })),
  } as unknown as IBankOrderAmountChangedScanner;
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })),
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    enqueueManualNoRecipient: vi.fn(async () => ({
      kind: 'skipped_manual_no_recipient',
      id: 'm1',
    })),
  } as unknown as IEmailOutbox;
  return { scanner, outbox };
}

describe('enqueueBankOrderAmountChangedEmails', () => {
  it('🔴🔴 cancellationId 原樣帶進 enqueue input —— 少了它, 同一張單只寄得出第一封', async () => {
    // 🛑 這是本檔最承重的一格。`cancellationId` 是 `dedupKey` 的前半,
    //    而唯一鍵 `(event_type, dedup_key)` 不含 order_id
    //    ⇒ 帶錯 / 沒帶 ⇒ **同一張單的每一次取消撞同一把鍵** ⇒ 只寄得出第一封,
    //      而那正是 Sean 2026-09-13 A1 甲禁止的事,且**三綠與測試都不會紅**(除了這一格)。
    const d = deps([row({ cancellationId: '00000000-0000-0000-0000-0000000000c9' })]);
    await enqueueBankOrderAmountChangedEmails(d, OPTS);
    const input = vi.mocked(d.outbox.enqueue).mock.calls[0]![0] as Record<string, unknown>;
    expect(input.cancellationId).toBe('00000000-0000-0000-0000-0000000000c9');
    expect(input.eventType).toBe('bank_order_amount_changed');
  });

  it('🔴 同一張單的兩次取消 ⇒ 排成【兩筆】, 各帶自己的 cancellationId', async () => {
    // 🛑 粒度的行為證人:掃描面一列 = 一次取消 ⇒ 這一支不可以把它們併成一筆。
    const order = '11111111-1111-4111-8111-111111111111';
    const d = deps([
      row({ orderId: order, cancellationId: 'c-1' }),
      row({ orderId: order, cancellationId: 'c-2' }),
    ]);
    const res = await enqueueBankOrderAmountChangedEmails(d, OPTS);
    expect(res.enqueued).toBe(2);
    const ids = vi
      .mocked(d.outbox.enqueue)
      .mock.calls.map((c) => (c[0] as Record<string, unknown>).cancellationId);
    expect(ids).toEqual(['c-1', 'c-2']);
  });

  it('🔴 金額與 createdAt 原樣帶(不重算)—— 重算 = 第二個來源, 而兩份會漂', async () => {
    const d = deps([row({ total: 4900, balanceDue: 4900, createdAt: '2026-09-01T00:00:00Z' })]);
    await enqueueBankOrderAmountChangedEmails(d, OPTS);
    const input = vi.mocked(d.outbox.enqueue).mock.calls[0]![0] as Record<string, unknown>;
    expect(input.total).toBe(4900);
    expect(input.balanceDue).toBe(4900);
    // 🔵 期限句吃的是**訂單的** created_at ⇒ 期限不因取消延後。
    expect(input.createdAt).toBe('2026-09-01T00:00:00Z');
  });

  it('🔵 收件人 fallback:通知信箱優先, 空的才退到會員信箱', async () => {
    const d = deps([row({ notificationEmail: '  ', customerEmail: 'member@example.com' })]);
    await enqueueBankOrderAmountChangedEmails(d, OPTS);
    const input = vi.mocked(d.outbox.enqueue).mock.calls[0]![0] as Record<string, unknown>;
    expect(input.recipientEmail).toBe('member@example.com');
  });

  it('🔴 兩個信箱都空 ⇒ 計 noRecipient、不排、**不計 errors**(它不是故障, 而它要看得見)', async () => {
    const d = deps([row({ notificationEmail: '  ', customerEmail: null })]);
    const res = await enqueueBankOrderAmountChangedEmails(d, OPTS);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
    expect(res.noRecipient).toBe(1);
    expect(res.errors).toBe(0);
    expect(res.enqueued).toBe(0);
  });

  it('🔴 一筆 enqueue 炸掉不倒整批:計 errors, 其餘照排', async () => {
    const d = deps([row({ cancellationId: 'c-1' }), row({ cancellationId: 'c-2' })]);
    vi.mocked(d.outbox.enqueue)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e2' });
    const res = await enqueueBankOrderAmountChangedEmails(d, OPTS);
    expect(res.errors).toBe(1);
    expect(res.enqueued).toBe(1);
  });

  // ══ cap 閘的分母 —— 🔬 **我第一版這兩格寫成一格, 而那一格守不到東西**(Fable 2026-09-13 F3):
  //    我用 2 列 + cap 20 + mock 回 1 ⇒ **分母是 1 還是 2 對結果零影響**
  //    ⇒ 📌 把碼改成 `assertEnqueueBatchWithinCap(type, inputs.length)`(不呼 countNewEvents)
  //      那一格**照樣綠**。⇒ 要守分母,列數必須**跨過 cap**。
  //    ✅ 改成兩格,各站在 cap 的一邊。
  it('🔴 分母用 countNewEvents(1)⇒ 21 列照樣全排 —— 防多寄的閘不可以變成永久少寄', async () => {
    // 🛑 具體病灶:掃描面會放回「我們自己 skip 過」而 enqueue 會回 duplicate 的舊列
    //    ⇒ 拿**掃描列數**當分母, 20 筆撞鍵的舊列會把 1 封真的該寄的信一起擋掉。
    const d = deps(Array.from({ length: 21 }, (_, i) => row({ cancellationId: `c-${i}` })));
    // 🔵 只有 1 筆是真的新的 ⇒ 閘應該放行。
    vi.mocked(d.outbox.countNewEvents).mockResolvedValueOnce(1);
    const res = await enqueueBankOrderAmountChangedEmails(d, OPTS);
    expect(res.enqueued).toBe(21);
    // 🔴 而它問的是 inputs 本身(21 筆), 由 outbox 那一側去算有幾筆是真的新的。
    expect(vi.mocked(d.outbox.countNewEvents).mock.calls[0]![0]).toHaveLength(21);
  });

  it('🔴 負對照:同樣 21 列而【真的有 21 筆新的】⇒ 閘要炸, 一封都不排', async () => {
    // 🟢 少了這一格,上面那格會在「閘根本沒接上」的世界裡照樣綠。
    const d = deps(Array.from({ length: 21 }, (_, i) => row({ cancellationId: `c-${i}` })));
    vi.mocked(d.outbox.countNewEvents).mockResolvedValueOnce(21);
    await expect(enqueueBankOrderAmountChangedEmails(d, OPTS)).rejects.toThrow();
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 「刻意不寄」的列【不進分母】, 而痕跡在閘【之前】就落下去', async () => {
    // 🛑 兩件事各自承重:
    //    ① 不寄的列進了分母 ⇒ 20 筆不寄 + 1 筆正常 = 21 > cap ⇒ 閘 throw
    //       ⇒ **痕跡留不下、正常信也排不進去**(本片要防的病換一個地方發作)。
    //    ② 痕跡若落在閘【之後】⇒ throw 時什麼都沒寫 ⇒ 下一輪再撈到同一批, 永遠。
    // 🔵 手動單 + 通知信箱留白 ⇒ 走「刻意不寄」那條路。
    const d = deps([
      ...Array.from({ length: 21 }, (_, i) =>
        row({
          cancellationId: `m-${i}`,
          orderSource: 'manual_phone',
          notificationEmail: '  ',
          customerEmail: 'trace@example.com',
        }),
      ),
    ]);
    // 🔴 分母只算 inputs ⇒ 那 21 筆都不在裡面 ⇒ 分母 0 ⇒ 閘不炸。
    const res = await enqueueBankOrderAmountChangedEmails(d, OPTS);
    expect(res.noRecipient).toBe(21);
    expect(d.outbox.enqueueManualNoRecipient).toHaveBeenCalledTimes(21);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
    expect(vi.mocked(d.outbox.countNewEvents).mock.calls[0]![0]).toHaveLength(0);
  });

  it('🔵 truncated 原樣回報 —— 呼叫端要據此決定要不要告警, 不是靜靜只寄前 N 封', async () => {
    const d = deps([]);
    vi.mocked(d.scanner.listBankOrderAmountChangedWithoutEmail).mockResolvedValueOnce({
      rows: [row()],
      scannedPages: 1,
      truncated: true,
    });
    const res = await enqueueBankOrderAmountChangedEmails(d, OPTS);
    expect(res.truncated).toBe(true);
  });

  it('🔴 scanner 收到的 input 只有 limit —— **沒有 cutoff**(有的話就是安靜漏寄那條路)', async () => {
    const d = deps([]);
    await enqueueBankOrderAmountChangedEmails(d, { limit: 25 });
    const arg = vi.mocked(d.scanner.listBankOrderAmountChangedWithoutEmail).mock
      .calls[0]![0] as Record<string, unknown>;
    // 🛑 這一格守的是**將來有人「順手」加回 cutoff**:本 view 的 created_at 是訂單的下單時刻,
    //    對它下 cutoff 會把「很久以前下單、今天才被部分取消」的單濾掉 ⇒ 沒有任何東西會叫。
    // 🔴 **用 `toStrictEqual` 不是 `toEqual`**(Fable 2026-09-13 F7):
    //    `toEqual` **忽略值為 `undefined` 的屬性** ⇒ 一個明寫 `cutoff: undefined` 的世界照樣綠,
    //    而那個世界裡「有人開始傳 cutoff 了」這件事已經發生, 只差還沒填值。
    //    ⛔ 我原本補了一句 `expect(arg.cutoff).toBeUndefined()` —— **那是死碼**:
    //       toEqual 對任何【有值】的 cutoff 已經會紅, 而對 `undefined` 兩句都綠。
    expect(arg).toStrictEqual({ limit: 25 });
  });
});
