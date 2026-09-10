// enqueue-bank-order-created-emails.test.ts
//
// 🔴🔴 **這支檔 2026-09-10 才誕生 —— 在此之前, 這一條排信線【一個測試都沒有】。**
//    量法:`grep -rln 'enqueueBankOrderCreatedEmails' --include='*.ts' packages apps`
//    ⇒ 只有 use-case 自己 · `index.ts` 的匯出 · route。**零測試檔。**
//    🟢 正對照:另外六支排信線每一支都有自己的 `.test.ts`。
//    ⇒ 📌 **它不是「測試比較少」, 是【零】** —— 而那件事沒有任何一格會叫。
//
// ⚠️ 本檔**只補 ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b 要的那一格**(這一支有沒有真的送出
//    「不寄的意圖」)。**它不是這條線的完整測試** —— 其餘行為(cutoff / truncated /
//    金額快照 / 分頁)仍然沒有人測。下一個接這條線的人不要把本檔讀成「這支有測試了」。

import { describe, expect, it, vi } from 'vitest';
import type {
  IEmailOutbox,
  IBankOrderCreatedScanner,
  BankOrderCreatedWithoutEmail,
} from '@pcm/ports';
import { enqueueBankOrderCreatedEmails } from './enqueue-bank-order-created-emails';

const OPTS = { cutoff: '2026-01-01T00:00:00Z', limit: 25 };

function row(over: Partial<BankOrderCreatedWithoutEmail> = {}): BankOrderCreatedWithoutEmail {
  return {
    orderId: '11111111-1111-4111-8111-111111111111',
    displayId: 'PCM-2026-0001',
    createdAt: '2026-09-09T13:54:00Z',
    total: 1000,
    balanceDue: 1000,
    notificationEmail: 'staff@example.com',
    customerEmail: 'frozen@example.com',
    orderSource: 'web',
    ...over,
  } as BankOrderCreatedWithoutEmail;
}

function deps(rows: BankOrderCreatedWithoutEmail[]) {
  const scanner = {
    listBankOrderCreatedWithoutEmail: vi.fn(async () => ({
      rows,
      scannedPages: 1,
      truncated: false,
    })),
  } as unknown as IBankOrderCreatedScanner;
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })),
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    // ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b:手動單留白 ⇒ 落一列終態(不寄)。
    enqueueManualNoRecipient: vi.fn(async () => ({
      kind: 'skipped_manual_no_recipient',
      id: 'm1',
    })),
  } as unknown as IEmailOutbox;
  return { scanner, outbox };
}

// ══════════════════════════════════════════════════════════════════════════════
// ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— **這一支**有沒有真的送出「不寄的意圖」。
//
// 🔴 **為什麼一支一格, 而不是一發數數量**(codex 2026-09-10 R1 should-fix ④):
//    七支本來就各有一個 `enqueue()` 呼叫 ⇒ 漏改其中一支, **仍然是七支七種**
//    ⇒ 「呼叫點數 === event_type 種類數」那種斷言**照樣通過**。
// 🛑 突變驗收:把**這一支**的那個分支退回 `continue` ⇒ **必須紅在這一格**。
//
// ⚠️ **而這一支今天走不到那個分支** —— 正式庫的 `pcm_bank_order_still_mailable`
//    是 **web-only**(2026-09-10 唯讀 `pg_get_viewdef` 量到)⇒ 手動單根本進不了掃描面。
//    ⇒ 📌 本格測的是**這一層的行為**, 不是「今天會發生」。它守的是
//      **哪天那張 view 放寬了, 這一層不會靜靜地退回舊行為。**
// ══════════════════════════════════════════════════════════════════════════════
describe('⟦auth-MANUALORDERLIMITBURN⟧ 手動單留白 ⇒ 落一列終態(不寄)', () => {
  it('🔴 呼叫 enqueueManualNoRecipient 一次, 收件人是借來的 customers.email;而 enqueue 零次', async () => {
    const d = deps([
      row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueBankOrderCreatedEmails(d, OPTS);
    const trace = d.outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(1);
    expect(trace.mock.calls[0]![0]).toMatchObject({ recipientEmail: 'frozen@example.com' });
    // 🟢 正對照:同一份 fake 的 enqueue **一次都沒被叫** ⇒ 真的沒寄。
    const sent = d.outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });

  it('🔵 反面:手動單【有填】通知信箱 ⇒ 照舊寄, 不得落終態(少了這格,「手動一律不寄」也全綠)', async () => {
    const d = deps([
      row({ orderSource: 'manual_phone', notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueBankOrderCreatedEmails(d, OPTS);
    const trace = d.outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(0);
    const sent = d.outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(1);
    expect(sent.mock.calls[0]![0]).toMatchObject({ recipientEmail: 'staff@example.com' });
  });

  it('🟢 正對照:一般網路單照舊寄, 而且不落終態(證明上面那兩格不是恆真)', async () => {
    const d = deps([row()]);
    await enqueueBankOrderCreatedEmails(d, OPTS);
    const trace = d.outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    expect(trace.mock.calls).toHaveLength(0);
    const sent = d.outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(1);
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
    await enqueueBankOrderCreatedEmails(d, OPTS);
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
    await expect(enqueueBankOrderCreatedEmails(d, OPTS)).rejects.toThrow();
    const trace = outbox.enqueueManualNoRecipient as unknown as { mock: { calls: unknown[][] } };
    // 🔴 這一格就是全部的意義:閘炸了, 而那一列的終態已經寫下去了。
    //    少了它 ⇒ 下一輪再撈到同一張單, 而那正是本片要修的病。
    expect(trace.mock.calls).toHaveLength(1);
    // 🟢 正對照:那一封真的要寄的**沒有**被寄出去(閘的確擋住了)。
    const sent = outbox.enqueue as unknown as { mock: { calls: unknown[][] } };
    expect(sent.mock.calls).toHaveLength(0);
  });
});
