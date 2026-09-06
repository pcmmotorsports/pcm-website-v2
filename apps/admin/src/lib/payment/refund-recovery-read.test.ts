import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import {
  RECOVERY_SIBLINGS_LIMIT,
  RecoveryReadIntegrityError,
  TERMINAL_REFUND_STATUSES,
  findRefundForRecovery,
} from './refund-recovery-read';

// refund-recovery-read.test.ts — RW4 對帳窄讀的查詢形狀與讀數計算。
// 🔴 誠實邊界(RW3 同註;codex R1 nit 修詞):鏈式 mock 只證「本層送出什麼形狀」,
//    不證 PostgREST/DB 行為;真資料路徑證據不在本檔 —— 在真機 E2E 段
//    (handoff `2026-08-03-day-refund-wire.md` §3i:local 真 PostgREST + 真 Record 三鏈)。

const REFUND_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';

function rowData(over: Record<string, unknown> = {}) {
  return {
    id: REFUND_ID,
    order_id: ORDER_ID,
    status: 'processing',
    refund_amount: 250,
    rec_trade_id: 'D20260803TESTrec',
    record_refunded_before: 100,
    provider_refund_id_evidence: null,
    created_at: '2026-08-03T12:00:00+00:00',
    orders: { display_id: 'PCM-2026-0087' },
    ...over,
  };
}

/** 兩段式 chain mock:第一段 eq→maybeSingle(本列)、第二段 eq→neq→limit(兄弟列)。 */
function arm(row: unknown, siblings: { data: unknown; error: unknown }) {
  const calls = {
    rowSelect: [] as unknown[][],
    rowEq: [] as unknown[][],
    sibSelect: [] as unknown[][],
    sibEq: [] as unknown[][],
    sibNeq: [] as unknown[][],
    sibLimit: [] as unknown[][],
  };
  mocks.from
    .mockImplementationOnce((table: string) => ({
      select: (...selectArgs: unknown[]) => {
        calls.rowSelect.push([table, ...selectArgs]);
        return {
          eq: (...eqArgs: unknown[]) => {
            calls.rowEq.push(eqArgs);
            return { maybeSingle: () => Promise.resolve({ data: row, error: null }) };
          },
        };
      },
    }))
    .mockImplementationOnce((table: string) => ({
      select: (...selectArgs: unknown[]) => {
        calls.sibSelect.push([table, ...selectArgs]);
        return {
          eq: (...eqArgs: unknown[]) => {
            calls.sibEq.push(eqArgs);
            return {
              neq: (...neqArgs: unknown[]) => {
                calls.sibNeq.push(neqArgs);
                return {
                  limit: (...limitArgs: unknown[]) => {
                    calls.sibLimit.push(limitArgs);
                    return Promise.resolve(siblings);
                  },
                };
              },
            };
          },
        };
      },
    }));
  return calls;
}

beforeEach(() => {
  mocks.from.mockReset();
});

describe('findRefundForRecovery — 查詢形狀', () => {
  it('本列:order_refunds、對帳材料欄齊(rec/baseline/證據)+ 母單編號 embed(確認碼閘用)', async () => {
    const calls = arm(rowData(), { data: [], error: null });
    await findRefundForRecovery(REFUND_ID);
    expect(calls.rowSelect[0]![0]).toBe('order_refunds');
    const columns = String(calls.rowSelect[0]![1]);
    const tokens = columns.split(',').map((s) => s.trim());
    // 逗號切詞精確比對(RW3 教訓:子字串 toContain 對 id 恆真)。
    for (const column of [
      'id',
      'order_id',
      'status',
      'refund_amount',
      'rec_trade_id',
      'record_refunded_before',
      'provider_refund_id_evidence',
      'created_at',
      'orders(display_id)',
    ]) {
      expect(tokens, `本列 select 缺 ${column}`).toContain(column);
    }
    // 死欄不留(opus nit):kind 零消費、不進投影。
    expect(tokens).not.toContain('kind');
    expect(calls.rowEq[0]).toEqual(['id', REFUND_ID]);
  });

  it('兄弟列:同單、排除本列、顯式上限 N+1(截斷讀數不可信=寧可 throw)', async () => {
    const calls = arm(rowData(), { data: [], error: null });
    await findRefundForRecovery(REFUND_ID);
    expect(calls.sibEq[0]).toEqual(['order_id', ORDER_ID]);
    expect(calls.sibNeq[0]).toEqual(['id', REFUND_ID]);
    expect(calls.sibLimit[0]).toEqual([RECOVERY_SIBLINGS_LIMIT + 1]);
  });

  it('查無 → null(不打兄弟查詢);orders embed 缺(防禦)→ orderDisplayId=null', async () => {
    arm(null, { data: [], error: null });
    await expect(findRefundForRecovery(REFUND_ID)).resolves.toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);

    mocks.from.mockReset();
    arm(rowData({ orders: null }), { data: [], error: null });
    await expect(findRefundForRecovery(REFUND_ID)).resolves.toMatchObject({
      orderDisplayId: null,
    });
  });
});

describe('findRefundForRecovery — 讀數計算', () => {
  it('快照映射 + 三讀數:非終態計數 / confirmed SUM / 缺對帳碼筆數(混合狀態 fixture)', async () => {
    arm(rowData(), {
      data: [
        { id: 's1', status: 'processing', refund_amount: 30, tappay_refund_id: null },
        { id: 's2', status: 'confirmed', refund_amount: 70, tappay_refund_id: 'DR1' },
        { id: 's3', status: 'confirmed', refund_amount: 50, tappay_refund_id: null },
        { id: 's4', status: 'failed', refund_amount: 999, tappay_refund_id: null },
        { id: 's5', status: 'deferred', refund_amount: 888, tappay_refund_id: null },
      ],
      error: null,
    });
    const snapshot = await findRefundForRecovery(REFUND_ID);
    expect(snapshot).toMatchObject({
      id: REFUND_ID,
      orderId: ORDER_ID,
      orderDisplayId: 'PCM-2026-0087',
      status: 'processing',
      refundAmount: 250,
      recTradeId: 'D20260803TESTrec',
      recordRefundedBefore: 100,
      providerEvidence: null,
      // failed/deferred 不進任何讀數(999/888 是誘餌:混進 SUM 這格就紅)。
      otherInFlightCount: 1,
      ledgerConfirmedSum: 120,
      confirmedMissingRefundId: 1,
    });
  });

  it('🔴 在途計數=非終態反面數(opus C4):未知新狀態被當在途(fail-closed),不會靜默歸 0', async () => {
    arm(rowData(), {
      data: [
        { id: 's1', status: 'weird_new_status', refund_amount: 10, tappay_refund_id: null },
        { id: 's2', status: 'confirmed', refund_amount: 70, tappay_refund_id: 'DR1' },
      ],
      error: null,
    });
    await expect(findRefundForRecovery(REFUND_ID)).resolves.toMatchObject({
      otherInFlightCount: 1,
    });
    // 終態 allowlist 字面釘死(新增狀態必回訪 refund-recovery-read.ts)。
    // 🔴 **2026-09-07 ⟦b4-TAPPAYDIRECT⟧ 加第四態 `voided` —— 而這一格【咬到了】。**
    //    ⛔ ~~`['confirmed', 'failed', 'deferred']`~~(S6 三終態)
    //    🎯 那正是這一行存在的意義:它逼我回到這支檔來。**而它做到了。**
    //    ⚠️ 我一度以為「加了 voided 之後沒有任何東西會叫」——**那是我還沒重跑測試就講的**,
    //       而重跑第一發它就紅了。📌 **「沒有東西會叫」是一個要【跑過】才說得出口的句子。**
    expect([...TERMINAL_REFUND_STATUSES]).toEqual(['confirmed', 'failed', 'deferred', 'voided']);
  });

  // 🔴 族普查 R3 命中:本檔所有斷言都跟著 RECOVERY_SIBLINGS_LIMIT 走(toEqual([LIMIT+1])、
  //    造 LIMIT+1 列)⇒ 常數改了測試全跟著綠。而它有一道外部牆:.limit(LIMIT+1) 若
  //    ≥ PostgREST db-max-rows,伺服器先夾 ⇒ refund-recovery-read.ts:100 的溢位偵測永假、
  //    對帳讀數靜默截斷。
  //    🔴 2026-08-18 更新:~~max-rows=1000 來源=memory、dashboard 值未確認~~ ——
  //    **那道缺的檢查已經有人做了**:`db-max-rows` = **2000**,V 窗 2026-08-18 對正式站實測
  //    (`products?select=id&limit=5000` ⇒ HTTP 206、`content-range 0-1999/19777`;
  //     分母 19,777 > 2000 ⇒ 量到的是**天花板本人**。⚠️ **本檔改動者未自驗,轉錄 V 窗**)。
  //    🔴🔴 **而下面那格【刻意不跟著放寬】** —— 見該格與 refund-read.test.ts 的說明:
  //    2000 是**設定給的**,不是程式保證的;把門檻放寬到 2000 之後,那個設定被改回去時
  //    **不會有任何東西紅**。⇒ 保留 1000 當保守下界。
  //    🔴 即使 1000 是錯的,本格仍有價值:它擋的是「有人把常數調高」這個動作本身——
  //    常數在 500 安全,而安全的原因不在 code 裡,在一個 repo 外的設定值;守門與牆之間
  //    那段沒人守的區間,只有本格在看。模式=SupabaseOrderAdapter.test.ts「必須是字面 100」
  //    的上界版。改這顆常數 ≥999 ⇒ 本格紅,先去確認 max-rows 再動。
  it('🔴 LIMIT+1 必須嚴格小於 1000(保守下界;db-max-rows 實測 2000 但刻意不放寬)—— 否則溢位偵測靜默死亡', () => {
    expect(RECOVERY_SIBLINGS_LIMIT + 1).toBeLessThan(1000);
  });

  it('🔴 兄弟列超上限 → RecoveryReadIntegrityError(重試不會好;呼叫端映停手不映重試)', async () => {
    const over = Array.from({ length: RECOVERY_SIBLINGS_LIMIT + 1 }, (_, i) => ({
      id: `s${i}`,
      status: 'confirmed',
      refund_amount: 1,
      tappay_refund_id: 'DR',
    }));
    arm(rowData(), { data: over, error: null });
    await expect(findRefundForRecovery(REFUND_ID)).rejects.toBeInstanceOf(
      RecoveryReadIntegrityError,
    );
  });

  it('本列/兄弟列查詢 error → throw(不得靜默;讀數缺席≠讀數為零)', async () => {
    mocks.from.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    }));
    await expect(findRefundForRecovery(REFUND_ID)).rejects.toBeTruthy();

    arm(rowData(), { data: null, error: { message: 'boom' } });
    await expect(findRefundForRecovery(REFUND_ID)).rejects.toBeTruthy();
  });
});

// ── ⟦b4-TAPPAYDIRECT⟧ 2026-09-07:TERMINAL 集合要跟得上 DB 的值域 ──────────────────
//  🔴🔴 **這一格存在的理由是一件真的發生過的事**:
//    我在 A2 加了新狀態 `voided`,而 `TERMINAL_REFUND_STATUSES` 沒跟著加。
//    三綠全綠、6826 格零紅 —— **沒有任何東西會叫**,而後果是作廢的兄弟列被當成「在途」
//    ⇒ 另一筆退款差額正確時仍被判 `other_in_flight` ⇒ **恢復結案這條路走不完**。
//  🎯 而本檔 `:25-28` 的註解**早就寫著**反面數是為了「**逼新增狀態的人回訪本檔**」——
//    那個機制**真的生效了**,而**逼我回來的是 codex R2,不是任何一格測試**。
//  ⇒ 📌 **一句寫在註解裡的「請回訪本檔」,守不住一個不讀那支檔的人。** 這一格把它換成會紅的東西。
//
//  🔵 **分母【從 migration 的 CHECK 當場長出來】, 不是我手打一份清單** ——
//     手打的話,下一個人在 DB 加第六個狀態時,這一格會拿著我 2026-09-07 的舊清單說「全過」。
describe('🔴🔴 TERMINAL_REFUND_STATUSES 要涵蓋 DB 值域裡的每一個終態', () => {
  /** 從 migration 檔案裡把 `order_refunds_status_check` 現行允許的值撈出來。 */
  function statusValuesFromMigrations(): string[] {
    const dir = join(__dirname, '../../../../../supabase/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let latest: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      // 只認「加在 order_refunds 上、名為 order_refunds_status_check」的那道
      const m = src.match(
        /ADD\s+CONSTRAINT\s+order_refunds_status_check\s*\n?\s*CHECK\s*\(status\s+IN\s*\(([^)]*)\)/i,
      );
      const inline = src.match(/status\s+text\s+NOT NULL CHECK \(status IN \(([^)]*)\)/i);
      const hit = m?.[1] ?? inline?.[1];
      if (hit) latest = [...hit.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    }
    return latest;
  }

  it('🔵 前提:那把尺撈得到東西(撈不到 ⇒ 下面兩格恆綠)', () => {
    const vals = statusValuesFromMigrations();
    expect(vals.length).toBeGreaterThanOrEqual(4);
    expect(vals).toContain('processing');
    expect(vals).toContain('confirmed');
  });

  it('🔴 DB 允許的每一個【非 processing】狀態, 都要在 TERMINAL 集合裡', () => {
    // 判準:`processing` 是唯一的「在途」態;其餘全部是終態。
    // ⇒ DB 加了新值而這裡沒加 ⇒ 那個新值會被當成在途 ⇒ 這一格紅。
    const missing = statusValuesFromMigrations()
      .filter((v) => v !== 'processing')
      .filter((v) => !TERMINAL_REFUND_STATUSES.includes(v));
    expect(missing, `DB 允許而 TERMINAL 沒收的狀態:${missing.join(', ')}`).toEqual([]);
  });

  it('🔵 反過來也要:TERMINAL 裡不得有 DB 不允許的值(拼錯字會在這裡紅)', () => {
    const allowed = statusValuesFromMigrations();
    const bogus = TERMINAL_REFUND_STATUSES.filter((v) => !allowed.includes(v));
    expect(bogus, `TERMINAL 有而 DB 不允許:${bogus.join(', ')}`).toEqual([]);
  });
});
