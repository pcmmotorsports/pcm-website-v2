// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
//
// M-4a E2a-2(W3-G 拆出)寄送前 ineligible gate 的 adapter 測試。只驗查詢字面(mock 不執行
// PostgREST 過濾語意,效度限定見本檔對應的 adapter 檔頭)。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  SupabaseIneligibleOrderEmailScannerAdapter,
  type IneligibleOrderEmailScannerClient,
} from './SupabaseIneligibleOrderEmailScannerAdapter';

type Resp = { data: unknown; error: { message: string; code?: string } | null };

/** 鏈式 thenable builder mock(鏡像 SupabasePaidOrderScannerAdapter.test.ts,加 `.lte`/`.or`)。 */
function makeBuilder(result: Resp) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = { calls };
  let limit: number | null = null;
  for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'limit']) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      if (m === 'limit' && typeof args[0] === 'number') limit = args[0];
      return b;
    });
  }
  b.then = (resolve: (v: Resp) => unknown) => {
    const data = limit !== null && Array.isArray(result.data) ? result.data.slice(0, limit) : result.data;
    return Promise.resolve({ ...result, data }).then(resolve);
  };
  return b as unknown as { calls: Array<[string, unknown[]]> };
}

function makeClient(...builders: Array<{ calls: Array<[string, unknown[]]> }>) {
  const from = vi.fn();
  for (const b of builders) from.mockReturnValueOnce(b);
  return { client: { from } as unknown as IneligibleOrderEmailScannerClient, from };
}

function argsOf(b: { calls: Array<[string, unknown[]]> }, method: string): unknown[][] {
  return b.calls.filter(([m]) => m === method).map(([, args]) => args);
}

// 🔴 **`event_type` 是必填的** —— 少了它,`SUPPRESS[undefined]` 會讓**每一列都被濾掉**
//    ⇒ `scanned=0 / errors=0 / ok:true` ⇒ **整道閘安靜死掉而儀表全綠**
//    (= 本片要修的那個病, 原封搬到隔壁;code-reviewer C1 + codex must-fix 3)。
const DUE_ROW = {
  id: 'outbox-1',
  order_id: 'order-1',
  attempts: 1,
  max_attempts: 5,
  event_type: 'order_created' as const,
};

describe('SupabaseIneligibleOrderEmailScannerAdapter — 查詢字面', () => {
  it('🔴 orders 述詞照 plan 拍板原文:payment_status.eq.refunded,cancelled_at.not.is.null(不含 partiallyRefunded)', async () => {
    const dueRows = makeBuilder({ data: [DUE_ROW], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }], error: null });
    const { client, from } = makeClient(dueRows, orders);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(from.mock.calls.map(([t]) => t)).toEqual(['email_outbox', 'orders']);
    expect(argsOf(orders, 'or')).toEqual([['payment_status.eq.refunded,cancelled_at.not.is.null']]);
    expect(argsOf(orders, 'in')).toEqual([['id', ['order-1']]]);
  });

  it('email_outbox due 述詞:status in pending/failed,next_retry_at <= now', async () => {
    const dueRows = makeBuilder({ data: [], error: null });
    const { client } = makeClient(dueRows);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(argsOf(dueRows, 'in')).toEqual([['status', ['pending', 'failed']]]);
    expect(argsOf(dueRows, 'lte')[0]![0]).toBe('next_retry_at');
  });

  it('🔴 codex 關卡2 must-fix:due 掃描帶 order(next_retry_at asc)—— 最舊(最可能死透)的列先進窗口', async () => {
    const dueRows = makeBuilder({ data: [], error: null });
    const { client } = makeClient(dueRows);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(argsOf(dueRows, 'order')).toEqual([['next_retry_at', { ascending: true }]]);
  });

  it('零 due 列 ⇒ 不去查 orders(沒有候選需要核對合格性)', async () => {
    const dueRows = makeBuilder({ data: [], error: null });
    const { client, from } = makeClient(dueRows);

    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(res).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('🔴 due 列的 attempts >= max_attempts(死列)⇒ app 層濾掉,不進 orders 候選集', async () => {
    const deadRow = { id: 'outbox-dead', order_id: 'order-2', attempts: 5, max_attempts: 5 };
    const dueRows = makeBuilder({ data: [DUE_ROW, deadRow], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }, { id: 'order-2' }], error: null });
    const { client } = makeClient(dueRows, orders);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    // order-2 只掛在死列上 ⇒ 不該被拿去問 orders 合格性(即使真的不合格也不該回,因為那封信本來就不會被送)。
    expect(argsOf(orders, 'in')).toEqual([['id', ['order-1']]]);
  });

  it('orders 回傳的合格性結果過濾候選:只有出現在 orders 結果裡的 order_id 才算不合格', async () => {
    const rowA = { id: 'outbox-a', order_id: 'order-a', attempts: 1, max_attempts: 5, event_type: 'order_created' as const };
    const rowB = { id: 'outbox-b', order_id: 'order-b', attempts: 1, max_attempts: 5, event_type: 'order_created' as const };
    const dueRows = makeBuilder({ data: [rowA, rowB], error: null });
    // orders 只回 order-a ⇒ order-b 是合格的(不該出現在結果裡)。
    const orders = makeBuilder({ data: [{ id: 'order-a' }], error: null });
    const { client } = makeClient(dueRows, orders);

    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    // 🔴 `toStrictEqual` 不是 `toEqual` —— 我實測 `toEqual` 對 `eventType: undefined` **會過**
    //    ⇒ 那正是「漏掉 .select(event_type)」時唯一會叫的地方, 而它原本不叫。
    expect(res).toStrictEqual([{ id: 'outbox-a', orderId: 'order-a', eventType: 'order_created' }]);
  });

  it('limit 在候選數超過時裁切(DUE_SCAN_CAP 大窗、回傳前才裁 limit)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      event_type: 'order_created' as const,
      id: `outbox-${i}`,
      order_id: `order-${i}`,
      attempts: 1,
      max_attempts: 5,
    }));
    const dueRows = makeBuilder({ data: rows, error: null });
    const orders = makeBuilder({ data: rows.map((r) => ({ id: r.order_id })), error: null });
    const { client } = makeClient(dueRows, orders);

    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(3);

    expect(res).toHaveLength(3);
  });

  it.each([0, -1, 1.5])('limit=%s ⇒ throw(契約由 adapter 強制)', async (bad) => {
    const { client } = makeClient(makeBuilder({ data: [], error: null }));
    await expect(
      new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(bad),
    ).rejects.toThrow(/limit 必須是 ≥1 的整數/);
  });

  it('email_outbox 查詢 error ⇒ throw', async () => {
    const dueRows = makeBuilder({ data: null, error: { message: 'boom', code: 'PGRST500' } });
    const { client } = makeClient(dueRows);

    await expect(
      new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30),
    ).rejects.toThrow(/PGRST500/);
  });

  it('orders 查詢 error ⇒ throw', async () => {
    const dueRows = makeBuilder({ data: [DUE_ROW], error: null });
    const orders = makeBuilder({ data: null, error: { message: 'boom', code: 'PGRST502' } });
    const { client } = makeClient(dueRows, orders);

    await expect(
      new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30),
    ).rejects.toThrow(/PGRST502/);
  });
});
describe('取消信在 .slice() 【之前】就被濾掉(而位置就是這一格的全部)', () => {
  // 🔴🔴 **這一族抓的是我自己寫過的一個 bug**(code-reviewer N5 + codex must-fix 1/2):
  //    我第一版把那道 filter 放在 **use-case**(`.slice()` 之後)⇒ **starvation**:
  //    前 N 筆若都是取消信 ⇒ 它們先吃掉 `limit` 名額、再被全部濾掉
  //    ⇒ `scanned: 0 / errors: 0 / ok: true` ⇒ **既有兩封信被餓死, 而儀表全綠。**
  //    🎯 而那正是我宣稱「既有行為逐字不變」的那一格。
  it('🔴 前面全是取消信也不會吃掉名額 —— 後面的 order_created 照樣拿得到', async () => {
    const cancels = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${String(i)}`, order_id: 'order-1', attempts: 1, max_attempts: 5,
      event_type: 'order_cancelled' as const,
    }));
    const real = { id: 'real-1', order_id: 'order-1', attempts: 1, max_attempts: 5, event_type: 'order_created' as const };
    const dueRows = makeBuilder({ data: [...cancels, real], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }], error: null });
    const { client } = makeClient(dueRows, orders);

    // limit = 3:若濾在 slice 之後 ⇒ 拿到的 3 筆全是取消信 ⇒ 濾完 0 筆 ⇒ real-1 被餓死
    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(3);

    expect(res.map((r) => r.id)).toStrictEqual(['real-1']);
  });

  it('🔴 未知 event_type ⇒ 【留下】(fail-closed) —— 不是靜靜濾掉', async () => {
    // 🎯 DB 先加值而 code 還沒跟上, 是本 repo 明文預期的順序
    //    ⇒ 那一刻不該讓它悄悄溜過這道閘, 也不該讓它把整批濾成空的。
    const row = { id: 'x-1', order_id: 'order-1', attempts: 1, max_attempts: 5, event_type: 'zzq_未來的值' as never };
    const dueRows = makeBuilder({ data: [row], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }], error: null });
    const { client } = makeClient(dueRows, orders);
    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);
    expect(res.map((r) => r.id)).toStrictEqual(['x-1']);
  });

  it('🔴 select 真的有帶 event_type(漏了它 ⇒ 整道閘安靜死掉)', async () => {
    const dueRows = makeBuilder({ data: [DUE_ROW], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }], error: null });
    const { client } = makeClient(dueRows, orders);
    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);
    expect(String(argsOf(dueRows, 'select')[0]?.[0])).toContain('event_type');
  });
});

