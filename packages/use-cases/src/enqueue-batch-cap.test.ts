// ⟦b4-EMAILTRIAGE⟧ 甲-3:排信批次上限閘的驗收。
//
// 🔴 **這一支守的是「一次寄很多封」這件事**,而它的驗收條件由主視窗 B 2026-09-07 逐字給:
//    ① 單型別 21 封 ⇒ 該型別 **0 排** ② 20 封照排 ③ 突變:閘拿掉 ⇒ ① 紅;N 改 50 ⇒ 另一格紅。
//
// 🛑 **為什麼行為那幾格放在 use-case 這一層**:這一層注得進假 scanner 與假 outbox,
//    問得出「`enqueue` 被叫了幾次」——**那才是「0 排」的讀數**;route 那一層只看得到狀態碼。
// ⚠️ **不是說 route 層測不到**(⛔ ~~原句寫「route 的 deps 本來就沒 mock ⇒ 沒有判別力」~~ ——
//    codex 2026-09-07 指出那說得太廣:route 測試現在已經 mock 了五種)。
//    ⇒ 📌 在 route 明確注入一個「撞閘」的錯誤, 是**做得到**的, 而它問的是另一件事
//      (log 欄位 / 其他型別有沒有照跑 / sweeper 有沒有被叫)。**那一層本片沒補**, 誠實列。
import { describe, it, expect, vi } from 'vitest';
import type { IEmailOutbox, IPaidOrderScanner, PaidOrderWithoutOrderCreatedEmail } from '@pcm/ports';

import { enqueueOrderCreatedEmails } from './enqueue-order-created-emails';
import {
  ENQUEUE_BATCH_CAP,
  EnqueueBatchCapExceededError,
  assertEnqueueBatchWithinCap,
  describeEnqueueBatchCap,
} from './enqueue-batch-cap';

const CUTOFF = '2026-08-18T00:00:00.000Z';

/** 單列樣板 —— 上面那支 `rows(n)` 是它的量產版。 */
function row0(): PaidOrderWithoutOrderCreatedEmail {
  return {
    orderId: 'order-0',
    displayId: 'PCM-9999-0000',
    paidAt: '2026-08-18T10:00:00.000Z',
    notificationEmail: 'm0@example.com',
    customerEmail: null,
    orderSource: 'web',
  } as PaidOrderWithoutOrderCreatedEmail;
}

function rows(n: number): PaidOrderWithoutOrderCreatedEmail[] {
  return Array.from({ length: n }, (_, i) => ({
    orderId: `order-${i}`,
    displayId: `PCM-9999-${String(i).padStart(4, '0')}`,
    paidAt: '2026-08-18T10:00:00.000Z',
    notificationEmail: `m${i}@example.com`,
    customerEmail: null,
    orderSource: 'web',
  })) as PaidOrderWithoutOrderCreatedEmail[];
}

/**
 * @param n     掃描回來幾列
 * @param newN  outbox 說這批裡有幾個是【真的新的】(預設 = 全部)
 *
 * 🔴 **這兩個數要分開餵, 因為病灶就在它們不相等的時候**:掃描面會放回「我們自己 skip 過」
 *    而 `enqueue()` 會回 `duplicate` 的舊列 ⇒ `n` 大而 `newN` 小。
 *    只有一個參數的 fixture 【構造不出】那個世界, 而那正是 codex 打掉第一版的那個世界。
 */
function deps(n: number, newN: number = n) {
  const enqueue = vi.fn(async () => ({ kind: 'enqueued', id: 'e1' }));
  const countNewEvents = vi.fn(async () => newN);
  const scanner = {
    listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({
      rows: rows(n),
      scannedPages: 1,
      truncated: false,
    })),
  } as unknown as IPaidOrderScanner;
  return {
    d: { scanner, outbox: { enqueue, countNewEvents } as unknown as IEmailOutbox },
    enqueue,
    countNewEvents,
  };
}

describe('甲-3 排信批次上限閘', () => {
  // ── 常數本身 ────────────────────────────────────────────────
  it('🔴 N = 20(改成 50 這一格就紅)—— N 不是從正式庫的資料推的, 依據在檔頭', () => {
    // 🛑 這一格看起來像廢話, 而它是【突變 ③ 的另外那一半】:
    //    把 N 改成 50 ⇒ 上游 `ENQUEUE_LIMIT = 50` 已經把單輪列數壓在 50
    //    ⇒ 「一次超過 50」**永遠不成立** ⇒ 那道閘會變成恆真,
    //    而下面那兩格行為測【照樣全綠】(它們的輸入跟著常數走)。
    //    ⇒ 📌 會紅的是**寫死 20 的那兩格**:這一格, 與下面斷言 `cap: 20` 那一格。
    //      (⛔ ~~原句寫「只有這一格會紅」~~ —— 不實, 是兩格;codex 2026-09-07 訂正。)
    expect(ENQUEUE_BATCH_CAP).toBe(20);
  });

  // ── ① 21 封 ⇒ 0 排 ──────────────────────────────────────────
  it('🔴 ① 同一種信一輪 21 封 ⇒ throw, 而 enqueue **一次都沒被叫**(不是「少排幾封」是「一封都不排」)', async () => {
    const { d, enqueue } = deps(ENQUEUE_BATCH_CAP + 1);
    await expect(enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 })).rejects.toThrow(
      EnqueueBatchCapExceededError,
    );
    // 🔴 這一行才是「0 排」的讀數 —— 只斷言 throw 的話,
    //    一個「先排了 20 封才 throw」的實作照樣會綠。
    expect(enqueue).not.toHaveBeenCalled();
  });

  // ── ② 20 封 ⇒ 照排(正對照)──────────────────────────────────
  it('🟢 ② 剛好 20 封 ⇒ 照排 20 封(正對照:證明這道閘【不是恆真】、也證明邊界是「超過」不是「達到」)', async () => {
    const { d, enqueue } = deps(ENQUEUE_BATCH_CAP);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledTimes(ENQUEUE_BATCH_CAP);
    expect(res.enqueued).toBe(ENQUEUE_BATCH_CAP);
  });

  // ── 🔴🔴 ③ 病灶本身:掃到 21 而其中 20 是舊的 ⇒ 【照排】那 1 封 ────────
  it('🔴 掃到 21 列而 outbox 說只有 1 個是新的 ⇒ 不擋, 照排(第一版就是在這裡把該寄的信擋掉的)', async () => {
    const { d, enqueue, countNewEvents } = deps(ENQUEUE_BATCH_CAP + 1, 1);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    // 🔵 21 個 input 都送去問(去重與比對是 DB 那一支的事)
    expect(countNewEvents).toHaveBeenCalledTimes(1);
    // 🔴 而閘看的是【回來的那個數】不是掃描列數 ⇒ 1 ≤ 20 ⇒ 放行 ⇒ 21 封照排
    expect(enqueue).toHaveBeenCalledTimes(ENQUEUE_BATCH_CAP + 1);
    expect(res.enqueued).toBe(ENQUEUE_BATCH_CAP + 1);
  });

  it('🔴 閘看的是 countNewEvents 的回傳, 不是 rows.length(掃到 5 而它說 21 ⇒ 擋)', async () => {
    // 🛑 這一格與上一格是【一組, 方向相反】:
    //    上一格證「掃描列數大而新的少 ⇒ 不擋」, 這一格證「掃描列數小而新的多 ⇒ 擋」。
    //    只有一格的話, 一個「兩個數取小」的實作也會綠。
    // ⚠️ **誠實標記**:`newN > n` 這個組合**真實世界構造不出來**
    //    (`countNewEvents` 回的數不可能大於候選鍵數;codex 2026-09-07 指出)。
    //    ⇒ 它是一個**刻意的不可能輸入**, 用途只有一個:釘住「閘讀的是哪一個數」。
    //      它證不到任何真實情境, 而它證得到那件事。
    const { d, enqueue } = deps(5, ENQUEUE_BATCH_CAP + 1);
    await expect(enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 })).rejects.toThrow(
      EnqueueBatchCapExceededError,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  // ── 🔴 一筆壞資料不得把整批倒掉(主視窗 B 2026-09-07;今晚第三次「永久少寄」形狀)──
  it('🔴 一筆組裝不出鍵 + 兩筆好的 ⇒ 排 2、errors 1(不是整批 0 排)', async () => {
    const enqueue = vi.fn(async (input: { orderId: string }) => {
      if (input.orderId === 'bad') throw new Error('組裝失敗:displayId 不得為空');
      return { kind: 'enqueued', id: 'e1' };
    });
    // 🔵 假 outbox 模仿 adapter 的行為:組不出鍵的那一筆**不進分母**(所以是 2 不是 3)。
    const countNewEvents = vi.fn(async (i: readonly { orderId: string }[]) =>
      i.filter((x) => x.orderId !== 'bad').length,
    );
    const three = [
      { ...row0(), orderId: 'ok-1' },
      { ...row0(), orderId: 'bad' },
      { ...row0(), orderId: 'ok-2' },
    ];
    const scanner = {
      listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({
        rows: three,
        scannedPages: 1,
        truncated: false,
      })),
    } as unknown as IPaidOrderScanner;
    const d = { scanner, outbox: { enqueue, countNewEvents } as unknown as IEmailOutbox };

    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
    expect(enqueue).toHaveBeenCalledTimes(3); // 壞的那筆也照樣送去, 在那裡才炸
    expect(res.enqueued).toBe(2);
    expect(res.errors).toBe(1);
  });

  // ── 🔴 撞閘那一輪的 noRecipient 要跟著錯誤出去 ────────────────────────
  it('🔴 撞閘時 log 帶得出 scanned 與 noRecipient(否則那一輪那兩個數【沒有讀數】)', async () => {
    // 22 列, 其中 1 列沒有收件人 ⇒ inputs 21 ⇒ 撞閘;而 noRecipient=1 只剩錯誤物件裡有。
    const rs = [
      ...Array.from({ length: 21 }, (_, i) => ({ ...row0(), orderId: `ok-${i}` })),
      { ...row0(), orderId: 'no-mail', notificationEmail: null, customerEmail: null },
    ];
    const enqueue = vi.fn(async () => ({ kind: 'enqueued', id: 'e1' }));
    const countNewEvents = vi.fn(async (i: readonly unknown[]) => i.length);
    const scanner = {
      listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({
        rows: rs,
        scannedPages: 1,
        truncated: false,
      })),
    } as unknown as IPaidOrderScanner;
    const d = { scanner, outbox: { enqueue, countNewEvents } as unknown as IEmailOutbox };

    let caught: unknown;
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 }).catch((e) => {
      caught = e;
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(describeEnqueueBatchCap(caught)).toEqual({
      reason_detail: 'enqueue_batch_cap_exceeded',
      eventType: 'order_created',
      count: 21,
      cap: 20,
      scanned: 22,
      noRecipient: 1,
    });
  });

  // ── 錯誤本身帶得出型別與數量 ────────────────────────────────
  it('🔴 撞閘的錯誤帶得出【型別與數量】—— log 那一行靠它, 少了就分不出「貼錯年份」與「權限壞掉」', () => {
    let caught: unknown;
    try {
      assertEnqueueBatchWithinCap('order_shipped', 999);
    } catch (err) {
      caught = err;
    }
    expect(describeEnqueueBatchCap(caught)).toEqual({
      reason_detail: 'enqueue_batch_cap_exceeded',
      eventType: 'order_shipped',
      count: 999,
      cap: 20,
      // 🔵 沒帶 context 就是 null —— **不得印成 0**。「沒有讀數」與「讀數是 0」是兩件事。
      scanned: null,
      noRecipient: null,
    });
  });

  it('🔵 負對照:不是撞閘的錯誤 ⇒ describe 回空物件(它不會把別的錯誤誤標成「大量寄信」)', () => {
    expect(describeEnqueueBatchCap(new Error('權限壞掉'))).toEqual({});
    expect(describeEnqueueBatchCap(undefined)).toEqual({});
  });

  it('🔵 訊息零 PII:只有型別名與兩個數字', () => {
    const err = new EnqueueBatchCapExceededError('order_created', 21, 20);
    expect(err.message).toContain('order_created');
    expect(err.message).toContain('21');
    expect(err.message).not.toMatch(/@|order-|PCM-/);
  });
});

// ── 每一支都要接上 + route 每一個 catch 都要帶那一行(source contract)────────
// ⛔ ~~六支 / 六個~~ 🔴 **2026-09-08:七支**(QB-16 加了 order_partially_refunded)——
//    而**量詞不再寫死**:下面兩格都跟著 `FILES.length` 走。
//    📌 理由是量到的:原本 `expect(caps).toBe(6)` 在第七支加進來時**會自己打自己**,
//      而紅的訊息是「expected 7 to be 6」—— 它讀起來像**我把碼寫壞了**,
//      而實際上碼是對的、那個 6 才是過期的。⇒ 一個寫死的量詞會把「正確的新增」報成缺陷。
describe('甲-3 接線 —— 每一支 enqueue 與 route 對應的 catch', () => {
  const FILES = [
    'enqueue-order-created-emails.ts',
    'enqueue-order-unpaid-cancelled-emails.ts',
    'enqueue-order-shipped-emails.ts',
    'enqueue-tracking-corrected-emails.ts',
    'enqueue-order-cancelled-emails.ts',
    'enqueue-bank-order-created-emails.ts',
    'enqueue-order-partially-refunded-emails.ts',
  ];

  it('🔴 每一支 enqueue-*.ts 都叫了 assertEnqueueBatchWithinCap(拿掉任何一支 ⇒ 這格紅)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const hit = FILES.filter((f) =>
      readFileSync(dir + f, 'utf8').includes('assertEnqueueBatchWithinCap('),
    );
    // 🔵 分母寫出來:少一支就看得見是少了哪一支(比集合不比數量 ⇒ 它本來就不會過期)
    expect(hit).toEqual(FILES);
  });

  it('🔴 route 每一個 catch 都 spread 了 describeEnqueueBatchCap(err)(少一個 ⇒ 那一種信撞閘時 log 沒有型別與數量)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const routePath = fileURLToPath(
      new URL('../../../apps/storefront/src/app/api/cron/email-sweep/route.ts', import.meta.url),
    );
    const src = readFileSync(routePath, 'utf8');
    // 🟢 正對照同時量:每個 catch 本來就有一處 `...scan,` ⇒ 兩個數要相等,
    //    只數一邊的話, 有人日後加了一段 enqueue 而忘了帶這一行, 這格不會叫。
    const caps = src.split('...describeEnqueueBatchCap(err),').length - 1;
    const scans = src.split('...scan,').length - 1;
    // ⛔ ~~expect(caps).toBe(6)~~ 🔴 改成跟著 `FILES` 走 —— 加第 N 支時只要改**一個地方**,
    //    而那個地方(FILES)上面那一格也在用 ⇒ 📌 漏改會在**兩格**同時紅, 藏不住。
    expect(caps).toBe(FILES.length);
    expect(caps).toBe(scans);
  });
});
