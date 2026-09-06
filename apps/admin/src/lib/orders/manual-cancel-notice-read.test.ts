import { beforeEach, describe, expect, it, vi } from 'vitest';

// manual-cancel-notice-read.test.ts — ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B ①②③
//
// 🔴 **這支守的是一件【三綠看不見】的事**:那五條述詞與片 A 的 SQL 是**兩份字面**,
//    而收窄其中任何一條, typecheck / lint / build **全部照樣綠**。
//    ⇒ 每一條述詞各一格「不符合」+ 一格「符合」⇒ **兩個世界要印不同的東西**。
//
// 🛑 **這支測試證不到什麼(寫出來, 不假裝)**:
//    · 它餵的是**我自己造的假 Supabase client** ⇒ 證不到「PostgREST 真的會這樣回」。
//    · 它證不到本檔的述詞與片 A 的 SQL **對得上** —— 那兩份字面沒有任何東西在比對它們。
//      ⇒ 📌 那是一個**已知缺口**, 不是這支測試的疏忽。

const svc = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: () => svc }));

const { readManualCancelNoticeEligibility } = await import('./manual-cancel-notice-read');

/** 一張**符合**的單:刷卡 · 已退款 · 已取消 · 有未作廢人工退款 · 無 order_cancelled 列。 */
const OK_ORDER = {
  payment_method: 'tappay',
  payment_status: 'refunded',
  cancelled_at: '2026-09-01T02:00:00Z',
  notification_email: 'someone@example.com',
  customer_user_id: 'u-1',
};

/**
 * 假 client:照本檔實際用的四種鏈路回答。
 * 🔴 **它必須對【沒教過的表】丟例外, 不可以回空** —— 回空的話, 我日後多查一張表
 *    這支測試會**安靜地照樣綠**(而那正是本 repo 記過的「fixture 供給真實世界不會給的東西」)。
 *
 * 🔴🔴 **而它【也必須驗 `.eq()` 的參數與 `.select()` 的欄位】**
 *    (code-reviewer 2026-09-06 must-fix ③ —— 我第一版全部忽略):
 *    · 忽略 `.eq()` 的參數 ⇒ 把 `.eq('event_type', 'order_cancelled')` 換成**任何**別的字面,
 *      14/14 照樣綠 ⇒ 📌 **那道 anti-join 等於沒有被測。**
 *    · 忽略 `.select()` 的欄位 ⇒ 把 `cancelled_at` 從 select 拿掉, 真的 PostgREST **不會回那個鍵**
 *      ⇒ `undefined === null` 是 **false** ⇒ 🛑 **沒取消的單被判成已取消**, 而測試全綠。
 *    ⇒ ✅ 下面每一格都對參數與欄位做斷言, **對不上就丟** —— 丟出來會讓那一格紅, 而不是靜靜通過。
 */
function expectEq(actual: unknown, want: unknown, what: string) {
  if (actual !== want) {
    throw new Error(`fixture 斷言失敗:${what} 應該是 ${String(want)}, 實際是 ${String(actual)}`);
  }
}

function expectSelects(cols: string, must: readonly string[], table: string) {
  for (const c of must) {
    if (!cols.includes(c)) {
      throw new Error(`fixture 斷言失敗:查 ${table} 的 select 少了欄位 ${c}(實際:${cols})`);
    }
  }
}
function mockDb(opts: {
  order?: Record<string, unknown> | null;
  orderError?: boolean;
  manualRefunds?: unknown[];
  manualRefundsError?: boolean;
  outbox?: unknown[];
  outboxError?: boolean;
  customerEmail?: string | null;
}) {
  svc.from.mockImplementation((table: string) => {
    if (table === 'orders') {
      return {
        select: (cols: string) => {
          // 🔴 少一欄 ⇒ 真的 PostgREST 不會回那個鍵 ⇒ `undefined === null` 為 false。
          expectSelects(cols, ['payment_method', 'payment_status', 'cancelled_at'], 'orders');
          return {
          eq: (col: string) => {
            expectEq(col, 'id', 'orders 的 eq 欄名');
            return ({
            maybeSingle: async () =>
              opts.orderError
                ? { error: { message: 'boom' }, data: null }
                : { error: null, data: opts.order === undefined ? OK_ORDER : opts.order },
          });
          },
          };
        },
      };
    }
    if (table === 'order_manual_refunds') {
      return {
        select: () => ({
          eq: (col: string) => {
            expectEq(col, 'order_id', 'order_manual_refunds 的 eq 欄名');
            return ({
            is: (col2: string) => {
              // 🔴 `voided_at IS NULL` = 「未作廢」。換成別的欄就不是混合軌那個判準了。
              expectEq(col2, 'voided_at', 'order_manual_refunds 的 is 欄名');
              return ({
              limit: async () =>
                opts.manualRefundsError
                  ? { error: { message: 'boom' }, data: null }
                  : { error: null, data: opts.manualRefunds ?? [{ id: 'mr-1' }] },
              });
            },
            });
          },
        }),
      };
    }
    if (table === 'email_outbox') {
      return {
        select: () => ({
          eq: (col: string) => {
            expectEq(col, 'order_id', 'email_outbox 第一個 eq 欄名');
            return ({
            eq: (col2: string, val2: string) => {
              // 🔴🔴 **這兩個字面就是 anti-join 本身** —— 換掉任一個, 那道閘就不再是它。
              expectEq(col2, 'event_type', 'email_outbox 第二個 eq 欄名');
              expectEq(val2, 'order_cancelled', 'email_outbox anti-join 的事件字面');
              return ({
              limit: async () =>
                opts.outboxError
                  ? { error: { message: 'boom' }, data: null }
                  : { error: null, data: opts.outbox ?? [] },
              });
            },
            });
          },
        }),
      };
    }
    if (table === 'customers') {
      return {
        select: () => ({
          // 🔴 R2 nit:這一條鏈原本不驗 eq —— 查錯欄(例如拿 `id` 而不是 `user_id`)
          //    會靜靜回同一個東西 ⇒ 預填拿到別人的信箱而測試全綠。
          eq: (col: string, val: string) => {
            expectEq(col, 'user_id', 'customers 的 eq 欄名');
            expectEq(val, 'u-1', 'customers 的 eq 值(要是那張單的 customer_user_id)');
            return ({
            maybeSingle: async () => ({
              error: null,
              data: opts.customerEmail === undefined ? null : { email: opts.customerEmail },
            }),
            });
          },
        }),
      };
    }
    throw new Error(`fixture 沒有教過這張表:${table} —— 有人多查了一張表而測試沒跟上`);
  });
}

beforeEach(() => {
  svc.from.mockReset();
});

describe('登錄人工寄出取消通知:資格', () => {
  it('🟢 正對照:五條都符合 ⇒ eligible,且預填訂單上的信箱', async () => {
    mockDb({});
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible).toBe(true);
    expect(r.eligible === true ? r.suggestedEmail : null).toBe('someone@example.com');
  });

  // 🔴 五條述詞各一格 —— 每一格都是「把那一條弄不成立, 答案要變」。
  it('🔴 payment_method 不是 tappay ⇒ not_card_refunded', async () => {
    mockDb({ order: { ...OK_ORDER, payment_method: 'bank_transfer' } });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_card_refunded');
  });

  it('🔴 payment_method 是 NULL(舊單)⇒ 也是 not_card_refunded,而這是【已知會漏掉的一類】', async () => {
    mockDb({ order: { ...OK_ORDER, payment_method: null } });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_card_refunded');
  });

  it('🔴 payment_status 不是 refunded ⇒ not_card_refunded', async () => {
    mockDb({ order: { ...OK_ORDER, payment_status: 'partiallyRefunded' } });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_card_refunded');
  });

  it('🔴 還沒取消 ⇒ not_cancelled', async () => {
    mockDb({ order: { ...OK_ORDER, cancelled_at: null } });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_cancelled');
  });

  it('🔴 沒有未作廢的人工退款 ⇒ not_mixed_rail(系統自己會寄)', async () => {
    mockDb({ manualRefunds: [] });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_mixed_rail');
  });

  it('🔴 已經有 order_cancelled 的列 ⇒ already_recorded', async () => {
    mockDb({ outbox: [{ id: 'e-1' }] });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('already_recorded');
  });

  it('🔴 找不到那張單 ⇒ not_found(不是 unreadable)', async () => {
    mockDb({ order: null });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_found');
  });

  // 🔴🔴 這三格守的是同一件事:**讀不到 ≠ 不符合**。
  //    折成「不符合」⇒ 鈕消失 ⇒ DB 抖一下那張單就沒有人救得了它。
  it('🔴 orders 讀失敗 ⇒ unreadable', async () => {
    mockDb({ orderError: true });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('unreadable');
  });

  it('🔴 order_manual_refunds 讀失敗 ⇒ unreadable', async () => {
    mockDb({ manualRefundsError: true });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('unreadable');
  });

  it('🔴 email_outbox 讀失敗 ⇒ unreadable', async () => {
    mockDb({ outboxError: true });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('unreadable');
  });

  it('🔵 兩個信箱都空 ⇒ 仍然 eligible,而 suggestedEmail 是 null(不編佔位字串)', async () => {
    mockDb({ order: { ...OK_ORDER, notification_email: null }, customerEmail: null });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible).toBe(true);
    expect(r.eligible === true ? r.suggestedEmail : 'x').toBeNull();
  });

  it('🔵 訂單沒信箱而客人有 ⇒ 用客人的', async () => {
    mockDb({ order: { ...OK_ORDER, notification_email: '  ' }, customerEmail: 'c@example.com' });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === true ? r.suggestedEmail : null).toBe('c@example.com');
  });

  it('🔴 順序:不是這一類的單, 要回 not_card_refunded 而不是 already_recorded', async () => {
    // 一張既不是刷卡、又已經有 outbox 列的單 —— 回錯的那一句會讓人以為「處理過了」。
    mockDb({ order: { ...OK_ORDER, payment_method: 'cash' }, outbox: [{ id: 'e-1' }] });
    const r = await readManualCancelNoticeEligibility('o-1');
    expect(r.eligible === false ? r.blocker : null).toBe('not_card_refunded');
  });
});
