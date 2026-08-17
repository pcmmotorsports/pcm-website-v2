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
  REFUND_STUCK_LIMIT,
  getLedgerUnregisteredAmount,
  listOrderRefunds,
  listRefundExceptions,
} from './refund-read';
import {
  REFUND_EXCEPTION_STALL_MS,
  STUCK_MANUAL_VERDICT_FAILED_REASON,
  isStuckManualVerdict,
} from './refund-ledger-view';

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

  // 🔴 族普查 R3 命中(同 refund-recovery-read 那格,詳細註解在那邊):上一格的期望值
  //    跟著常數走 ⇒ 常數漂移測試照綠,而 .limit(LIMIT+1) ≥ db-max-rows 時伺服器先夾
  //    ⇒ refund-read.ts:93 的 truncated 旗標永假、「有退款沒有列出來」那行警示不再出現。
  //    🔴 2026-08-18 更新:那個「未確認」**已經被量了** —— `db-max-rows` = **2000**
  //    (V 窗 2026-08-18 對正式站實測:`products?select=id&limit=5000` ⇒ HTTP 206、
  //     `content-range 0-1999/19777`;⚠️ **本檔改動者未自驗,轉錄 V 窗**)。
  //    🔴🔴 **而本格【刻意不放寬到 2000】** —— 它守的是「有人把常數調高」這個動作本身,
  //    而 2000 是**設定給的、不是程式保證的**:Dashboard 上改回去,放寬過的門檻就再也擋不住,
  //    而**那一刻不會有任何東西紅**。⇒ `1000` 在這裡是**保守下界**,不是對 `db-max-rows` 的斷言。
  //    (理由全文在 recovery-read 那格。)
  it('🔴 LIMIT+1 必須嚴格小於 1000(保守下界;db-max-rows 實測 2000 但刻意不放寬)—— 否則截斷偵測靜默死亡', () => {
    expect(ORDER_REFUNDS_LIMIT + 1).toBeLessThan(1000);
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

/**
 * `listRefundExceptions` 現在跑**兩支**查詢(#473b-2):①可處理 ②卡住。
 * 兩支的 builder 必須分開,否則兩邊的 calls 會混在一起 ——
 * 混在一起的話「①的述詞跑到②上」這種錯誤會完全看不出來(恆綠)。
 * 呼叫順序 = Promise.all 陣列字面序:先①後②。
 */
function exceptionChains(actionable: ChainResult, stuck: ChainResult) {
  const a = chain(actionable);
  const s = chain(stuck);
  mocks.from.mockReturnValueOnce(a.builder).mockReturnValueOnce(s.builder);
  return { a, s };
}
const emptyData: ChainResult = { data: [], error: null };
const exceptionRaw = (over: Record<string, unknown> = {}) => ({
  ...rawRow(over),
  order_id: ORDER_ID,
  orders: { display_id: 'PCM-2026-0001' },
});

describe('listRefundExceptions', () => {
  it('🔴 ①可處理那支:述詞字面與改動前**完全相同**(這是本片沒有動到的那半)', async () => {
    const before = Date.now();
    const { a } = exceptionChains(emptyData, emptyData);
    await listRefundExceptions();
    expect(mocks.from.mock.calls[0]![0]).toBe('order_refunds');
    // 整串錨定,不是 toContain 片段:多一段、少一段、換順序都會紅。
    expect(a.calls.eq!).toEqual([['status', 'processing']]);
    const orArg = String(a.calls.or![0]![0]);
    const match = orArg.match(
      /^created_at\.lt\.([^,]+),provider_refund_id_evidence\.not\.is\.null$/,
    );
    expect(match, `①的 or() 形狀不符:${orArg}`).not.toBeNull();
    expect(a.calls.or!).toHaveLength(1);
    // cutoff 必須是「現在 - 30 分」(允許測試執行的數秒誤差;30 分常數本身另有專格)
    const cutoff = Date.parse(match![1]!);
    expect(Math.abs(cutoff - (before - REFUND_EXCEPTION_STALL_MS))).toBeLessThan(10_000);
    expect(a.calls.order![0]).toEqual(['created_at', { ascending: true }]);
    expect(a.calls.limit![0]).toEqual([REFUND_EXCEPTIONS_LIMIT + 1]);
  });

  it('🔴 ②卡住那支:兩顆 eq 缺一不可,且**沒有**任何 or()(關卡2 codex:尾巴多接一顆 eq 就會靜默改變集合)', async () => {
    const { s } = exceptionChains(emptyData, emptyData);
    await listRefundExceptions();
    expect(mocks.from.mock.calls[1]![0]).toBe('order_refunds');
    // 🔴 **完整比對整個 eq 清單**(不是 toContain):
    //    少 status → 撈到形狀外的列;少 failed_reason → rejected_out_of_range / not_sent
    //    這兩個**正常的失敗結果**會一起被當成卡住;多一顆 → 靜默縮小集合。
    expect(s.calls.eq!).toEqual([
      ['status', 'failed'],
      ['failed_reason', STUCK_MANUAL_VERDICT_FAILED_REASON],
    ]);
    expect(s.calls.or!).toHaveLength(0);
    expect(s.calls.order![0]).toEqual(['created_at', { ascending: true }]);
    expect(s.calls.limit![0]).toEqual([REFUND_STUCK_LIMIT + 1]);
  });

  it('🔴 兩支各自一個上限:①爆量不得餓死②,②爆量也不得餓死①(關卡2 codex must-fix 本體)', async () => {
    const stuckFlood = Array.from({ length: REFUND_STUCK_LIMIT + 1 }, (_, i) =>
      exceptionRaw({ id: `s-${i}`, status: 'failed', failed_reason: 'manual_failed' }),
    );
    exceptionChains({ data: [exceptionRaw({ id: 'a-1', status: 'processing' })], error: null }, {
      data: stuckFlood,
      error: null,
    });
    const { rows, truncated } = await listRefundExceptions();
    // ②塞爆的情況下,①那一筆**仍然拿得到**(合成一支查詢時它會被擠掉 = 那個 must-fix)。
    expect(rows.map((r) => r.id)).toContain('a-1');
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(REFUND_STUCK_LIMIT);
    expect(truncated).toBe(true);
    // 🔴 **結構釘死**:必須是兩支獨立查詢。上面三條斷言在「合回一支」時**不一定會紅**
    //    (①排在前面,合併後的 slice 未必切到它)⇒ 真正守住「不要合回去」的是這一條。
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it('順序:①可處理在前、②卡住在後(有動作可做的排前面)', async () => {
    exceptionChains(
      { data: [exceptionRaw({ id: 'a-1', status: 'processing' })], error: null },
      {
        data: [exceptionRaw({ id: 's-1', status: 'failed', failed_reason: 'manual_failed' })],
        error: null,
      },
    );
    const { rows } = await listRefundExceptions();
    expect(rows.map((r) => r.id)).toEqual(['a-1', 's-1']);
  });

  it('帶回母單 display_id;orders 缺(防禦)→ 以 order_id 前 8 碼辨認', async () => {
    exceptionChains(
      {
        data: [
          exceptionRaw({ status: 'processing' }),
          { ...rawRow({ id: 'r-2', status: 'processing' }), order_id: ORDER_ID, orders: null },
        ],
        error: null,
      },
      emptyData,
    );
    const { rows } = await listRefundExceptions();
    expect(rows[0]!.orderDisplayId).toBe('PCM-2026-0001');
    expect(rows[1]!.orderDisplayId).toBe(ORDER_ID.slice(0, 8));
  });

  it('🔴 截斷旗標:①的 N+1 筆 → 回 N + truncated=true(爆量必須可見,不得靜默少頁)', async () => {
    const data = Array.from({ length: REFUND_EXCEPTIONS_LIMIT + 1 }, (_, i) =>
      exceptionRaw({ id: `r-${i}`, status: 'processing' }),
    );
    exceptionChains({ data, error: null }, emptyData);
    const { rows, truncated } = await listRefundExceptions();
    expect(rows).toHaveLength(REFUND_EXCEPTIONS_LIMIT);
    expect(truncated).toBe(true);
  });

  // 🔴 兩格都用 `data: []`(**不是** `data: null`)+ `rejects.toBe(boom)` —— 這是突變測出來的:
  //    原本寫 `data: null` + `rejects.toBeTruthy()`,把 `throw stuck.error` 整行刪掉**照樣全綠**,
  //    因為 `null.slice()` 自己會炸。⇒ 那格證的是「有東西丟出來」,不是「那顆 error 被丟出來」。
  it('🔴 ①的 error → 原樣 throw(codex MF6:查詢層吞錯回空=清單顯示「目前沒有異常」的假安全)', async () => {
    const boom = { message: 'boom-actionable' };
    exceptionChains({ data: [], error: boom }, emptyData);
    await expect(listRefundExceptions()).rejects.toBe(boom);
  });

  it('🔴 ②的 error 同樣要原樣 throw(只守①=②靜默消失,而②正是這片要讓人看見的東西)', async () => {
    const boom = { message: 'boom-stuck' };
    exceptionChains(emptyData, { data: [], error: boom });
    await expect(listRefundExceptions()).rejects.toBe(boom);
  });

  it('30 分常數本體(plan §4-1 字面;改值要同時想清單查詢與訂單頁警示兩處)', () => {
    expect(REFUND_EXCEPTION_STALL_MS).toBe(30 * 60 * 1000);
  });
});

describe('isStuckManualVerdict(#473 卡住的人工判定列)', () => {
  it('正:failed + manual_failed', () => {
    expect(isStuckManualVerdict({ status: 'failed', failedReason: 'manual_failed' })).toBe(true);
  });

  it('🔴 負:其他 failed_reason 不算 —— rejected_out_of_range / not_sent 是正常失敗、不是卡住', () => {
    expect(isStuckManualVerdict({ status: 'failed', failedReason: 'rejected_out_of_range' })).toBe(
      false,
    );
    expect(isStuckManualVerdict({ status: 'failed', failedReason: 'not_sent' })).toBe(false);
    expect(isStuckManualVerdict({ status: 'failed', failedReason: null })).toBe(false);
  });

  it('🔴 負:狀態沒到 failed 就不算(processing 那半歸 isRefundException,兩個判準不重疊)', () => {
    expect(isStuckManualVerdict({ status: 'processing', failedReason: 'manual_failed' })).toBe(
      false,
    );
    expect(isStuckManualVerdict({ status: 'confirmed', failedReason: null })).toBe(false);
    expect(isStuckManualVerdict({ status: 'deferred', failedReason: null })).toBe(false);
  });

  it('常數本體 = DB 側 RW4 出口寫的機器碼(20260803150000:760)', () => {
    expect(STUCK_MANUAL_VERDICT_FAILED_REASON).toBe('manual_failed');
  });
});
