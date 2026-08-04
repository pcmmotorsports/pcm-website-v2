import { beforeEach, describe, expect, it, vi } from 'vitest';

// `import 'server-only'` 在 vitest 的 node 環境解析不到(procurement-repository.test.ts:4 同處置)
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import {
  ORDER_REFUNDS_LIMIT,
  REFUND_EXCEPTIONS_LIMIT,
  getLedgerUnregisteredAmount,
  listOrderRefunds,
  listRefundExceptions,
} from './refund-read';
import { REFUND_EXCEPTION_STALL_MS } from './refund-ledger-view';

// M-3 A7c RW3:唯讀查詢的投影與過濾形狀。
// 🔴 誠實邊界(memory reference_supabase-update-needs-select-and-chain-mock-fake-green):
//    鏈式 mock 證明的是「本層送出什麼形狀」,不是 PostgREST/DB 行為;
//    真資料路徑由真機驗證段覆蓋(local 基建 + 帳本真列)。mock **不依 select 裁切資料**
//    ⇒ 「投影缺欄」的守法=下面的正向欄位釘死格(codex R1 MF4),不是資料層。

type ChainResult = { data: unknown; error: unknown };

function chain(result: ChainResult) {
  const calls: Record<string, unknown[][]> = { select: [], eq: [], or: [], order: [], limit: [] };
  // 鏈式 builder:每個方法記參數、回自身;await 時以 then 交出結果。
  const builder = {
    select: (...args: unknown[]) => {
      calls.select!.push(args);
      return builder;
    },
    eq: (...args: unknown[]) => {
      calls.eq!.push(args);
      return builder;
    },
    or: (...args: unknown[]) => {
      calls.or!.push(args);
      return builder;
    },
    order: (...args: unknown[]) => {
      calls.order!.push(args);
      return builder;
    },
    limit: (...args: unknown[]) => {
      calls.limit!.push(args);
      return builder;
    },
    then: (resolve: (value: ChainResult) => unknown) => resolve(result),
  };
  return { builder, calls };
}

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

/** 畫面消費的欄位全集(codex R1 MF4:正向釘死 —— 從 ROW_COLUMNS 拿掉任一欄這格就紅)。 */
const REQUIRED_COLUMNS = [
  'id',
  'kind',
  'status',
  'refund_amount',
  'reason',
  'actor',
  'created_at',
  'failed_reason',
  'failed_detail',
  'provider_refund_id_evidence',
] as const;

function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    kind: 'partial',
    status: 'confirmed',
    refund_amount: 100,
    reason: '缺貨退款',
    actor: 'sean',
    created_at: '2026-08-04T03:00:00+00:00',
    failed_reason: null,
    failed_detail: null,
    provider_refund_id_evidence: null,
    ...over,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

describe('listOrderRefunds', () => {
  it('形狀:order_refunds + order_id 過濾 + created_at 新到舊 + 顯式上限 N+1(codex MF1)', async () => {
    const { builder, calls } = chain({ data: [rawRow()], error: null });
    mocks.from.mockReturnValue(builder);
    await listOrderRefunds(ORDER_ID);
    expect(mocks.from.mock.calls[0]![0]).toBe('order_refunds');
    expect(calls.eq![0]).toEqual(['order_id', ORDER_ID]);
    expect(calls.order![0]).toEqual(['created_at', { ascending: false }]);
    expect(calls.limit![0]).toEqual([ORDER_REFUNDS_LIMIT + 1]);
  });

  it('🔴 投影欄位正向釘死(codex MF4)+ 禁入欄負向(RW2b 投影紀律)', async () => {
    const { builder, calls } = chain({ data: [], error: null });
    mocks.from.mockReturnValue(builder);
    await listOrderRefunds(ORDER_ID);
    const select = String(calls.select![0]![0]);
    // 🔴 逗號切詞後精確比對(codex R2/opus R2b 同抓):子字串 toContain 對 'id'/'reason'
    //    恆真('provider_refund_id_evidence' 含 id、'failed_reason' 含 reason)。
    const tokens = select.split(',').map((s) => s.trim());
    for (const column of REQUIRED_COLUMNS) {
      expect(tokens, `select 缺畫面必需欄 ${column}`).toContain(column);
    }
    expect(select).not.toContain('rec_trade_id');
    expect(select).not.toContain('request_id');
    expect(select).not.toContain('bank_refund_id');
    expect(select).not.toContain('tappay_refund_id');
    expect(select).not.toContain('confirmed_at');
  });

  it('投影映射:snake→camel', async () => {
    const { builder } = chain({ data: [rawRow()], error: null });
    mocks.from.mockReturnValue(builder);
    const { rows, truncated } = await listOrderRefunds(ORDER_ID);
    expect(rows[0]).toMatchObject({ id: 'r-1', refundAmount: 100, providerEvidence: null });
    expect(truncated).toBe(false);
  });

  it('🔴 截斷旗標:N+1 筆 → 回 N 筆 + truncated=true(平台 max-rows 靜默截斷的可見化)', async () => {
    const data = Array.from({ length: ORDER_REFUNDS_LIMIT + 1 }, (_, i) =>
      rawRow({ id: `r-${i}` }),
    );
    const { builder } = chain({ data, error: null });
    mocks.from.mockReturnValue(builder);
    const { rows, truncated } = await listOrderRefunds(ORDER_ID);
    expect(rows).toHaveLength(ORDER_REFUNDS_LIMIT);
    expect(truncated).toBe(true);
  });

  it('error → throw(不得靜默回空清單 —— 空清單長得跟「沒退過款」一樣)', async () => {
    const { builder } = chain({ data: null, error: { message: 'boom' } });
    mocks.from.mockReturnValue(builder);
    await expect(listOrderRefunds(ORDER_ID)).rejects.toBeTruthy();
  });
});

describe('getLedgerUnregisteredAmount', () => {
  it('走 pcm_order_refundable_remaining(S6 allowlist 單一真相在 DB 函式,app 不重算)', async () => {
    mocks.rpc.mockResolvedValue({ data: 4500, error: null });
    await expect(getLedgerUnregisteredAmount(ORDER_ID)).resolves.toBe(4500);
    expect(mocks.rpc.mock.calls[0]).toEqual([
      'pcm_order_refundable_remaining',
      { p_order_id: ORDER_ID },
    ]);
  });

  it('🔴 0 是合法值必須原樣回(codex nit:`|| null` 會把 0 翻成「查無」而 0 正是不准再退的訊號)', async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    await expect(getLedgerUnregisteredAmount(ORDER_ID)).resolves.toBe(0);
  });

  it('查無訂單(函式回 NULL)→ null;error → throw', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getLedgerUnregisteredAmount(ORDER_ID)).resolves.toBeNull();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getLedgerUnregisteredAmount(ORDER_ID)).rejects.toBeTruthy();
  });
});

describe('listRefundExceptions', () => {
  it('🔴 §4-1 判準形狀:processing + (滯留 30 分 OR 證據非空);舊的排前;上限 N+1', async () => {
    const before = Date.now();
    const { builder, calls } = chain({ data: [], error: null });
    mocks.from.mockReturnValue(builder);
    await listRefundExceptions();
    expect(calls.eq![0]).toEqual(['status', 'processing']);
    const orArg = String(calls.or![0]![0]);
    const match = orArg.match(
      /^created_at\.lt\.([^,]+),provider_refund_id_evidence\.not\.is\.null$/,
    );
    expect(match, `or() 形狀不符:${orArg}`).not.toBeNull();
    // cutoff 必須是「現在 - 30 分」(允許測試執行的數秒誤差;30 分常數本身另有專格)
    const cutoff = Date.parse(match![1]!);
    const expected = before - REFUND_EXCEPTION_STALL_MS;
    expect(Math.abs(cutoff - expected)).toBeLessThan(10_000);
    expect(calls.order![0]).toEqual(['created_at', { ascending: true }]);
    expect(calls.limit![0]).toEqual([REFUND_EXCEPTIONS_LIMIT + 1]);
  });

  it('帶回母單 display_id;orders 缺(防禦)→ 以 order_id 前 8 碼辨認', async () => {
    const { builder } = chain({
      data: [
        { ...rawRow({ status: 'processing' }), order_id: ORDER_ID, orders: { display_id: 'PCM-2026-0001' } },
        { ...rawRow({ id: 'r-2', status: 'processing' }), order_id: ORDER_ID, orders: null },
      ],
      error: null,
    });
    mocks.from.mockReturnValue(builder);
    const { rows } = await listRefundExceptions();
    expect(rows[0]!.orderDisplayId).toBe('PCM-2026-0001');
    expect(rows[1]!.orderDisplayId).toBe(ORDER_ID.slice(0, 8));
  });

  it('🔴 截斷旗標:N+1 筆 → 回 N + truncated=true(清單爆量必須可見,不得靜默少頁)', async () => {
    const data = Array.from({ length: REFUND_EXCEPTIONS_LIMIT + 1 }, (_, i) => ({
      ...rawRow({ id: `r-${i}`, status: 'processing' }),
      order_id: ORDER_ID,
      orders: { display_id: 'PCM-2026-0001' },
    }));
    const { builder } = chain({ data, error: null });
    mocks.from.mockReturnValue(builder);
    const { rows, truncated } = await listRefundExceptions();
    expect(rows).toHaveLength(REFUND_EXCEPTIONS_LIMIT);
    expect(truncated).toBe(true);
  });

  it('🔴 error → throw(codex MF6:查詢層吞錯回空=清單顯示「目前沒有異常」的假安全)', async () => {
    const { builder } = chain({ data: null, error: { message: 'boom' } });
    mocks.from.mockReturnValue(builder);
    await expect(listRefundExceptions()).rejects.toBeTruthy();
  });

  it('30 分常數本體(plan §4-1 字面;改值要同時想清單查詢與訂單頁警示兩處)', () => {
    expect(REFUND_EXCEPTION_STALL_MS).toBe(30 * 60 * 1000);
  });
});
