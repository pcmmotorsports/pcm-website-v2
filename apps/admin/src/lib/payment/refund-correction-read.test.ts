import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import {
  CORRECTED_TO_VALUES,
  CORRECTION_READ_MAX_IDS,
  CorrectionReadIntegrityError,
  findEffectiveVerdicts,
} from './refund-correction-read';

// refund-correction-read.test.ts — `#890` 片1 的查詢形狀與 Map 語意。
//
// 🔴 **誠實邊界(抄 `refund-recovery-read.test.ts` 同註,不放寬)**:
//    鏈式 mock 只證「**本層送出什麼形狀、拿回來怎麼組**」,
//    **不證 PostgREST / DB 行為**,也不證那張 view 真的存在或 ACL 通得過。
//    ⇒ 真資料路徑那一格**今天沒有人跑過**,不要把本檔全綠讀成「這條讀路是通的」。

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function row(over: Record<string, unknown> = {}) {
  return {
    refund_id: A,
    correction_id: 'cccccccc-3333-4333-8333-cccccccccccc',
    seq: 2,
    corrected_to: 'no_money_moved',
    reason: '對過 TapPay，錢其實沒有動',
    actor: 'staff_01',
    created_at: '2026-08-29T10:00:00+00:00',
    ...over,
  };
}

/** 單段 chain：from → select → in → limit。回傳呼叫紀錄,讓測試可以斷言「送出去的形狀」。 */
function arm(result: { data: unknown; error: unknown }) {
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    in: [] as unknown[][],
    limit: [] as unknown[],
  };
  mocks.from.mockImplementation((table: string) => {
    calls.from.push(table);
    return {
      select: (sel: unknown) => {
        calls.select.push(sel);
        return {
          in: (col: unknown, vals: unknown) => {
            calls.in.push([col, vals]);
            return {
              limit: (n: unknown) => {
                calls.limit.push(n);
                return Promise.resolve(result);
              },
            };
          },
        };
      },
    };
  });
  return calls;
}

beforeEach(() => {
  mocks.from.mockReset();
});

describe('🔴 查無 與 查詢失敗【必須分得開】(plan §1a,R1 must-fix)', () => {
  it('沒有更正過的 id ⇒ **Map 裡沒有那個 key**(不是回一個 null)', async () => {
    arm({ data: [row()], error: null });
    const map = await findEffectiveVerdicts([A, B]);
    expect(map.has(A)).toBe(true);
    // 🔴 這一格是本檔的核心:B 沒被更正過 ⇒ 呼叫端要據此傳 NULL 當初始 CAS。
    expect(map.has(B)).toBe(false);
    expect(map.get(B)).toBeUndefined();
  });

  it('🔴🔴 查詢失敗 ⇒ **throw**,不得退化成空 Map', async () => {
    arm({ data: null, error: { message: 'boom' } });
    // 若這裡改成回空 Map ⇒ 一次 DB 故障會讓【每一列】都被當成「沒更正過」。
    await expect(findEffectiveVerdicts([A])).rejects.toBeTruthy();
  });

  it('🔴 對照:成功而零列 ⇒ 空 Map、**不 throw**(那是「都沒被更正過」,是正常的)', async () => {
    arm({ data: [], error: null });
    const map = await findEffectiveVerdicts([A, B]);
    expect(map.size).toBe(0);
  });
});

describe('送出去的查詢形狀', () => {
  it('打的是那張 view、用 in()、而且 limit 是【問幾筆 + 1】的哨兵', async () => {
    const calls = arm({ data: [], error: null });
    await findEffectiveVerdicts([A, B]);
    expect(calls.from).toEqual(['order_refund_effective_verdict']);
    expect(calls.in).toEqual([['refund_id', [A, B]]]);
    // +1 是哨兵：view 是 DISTINCT ON (refund_id) ⇒ 正常最多 2 列，拿到 3 列代表唯一性壞了。
    expect(calls.limit).toEqual([3]);
  });

  it('🔴 重複的 id 先去重才送查(否則上限與「回太多列」那個判準都會誤報)', async () => {
    const calls = arm({ data: [], error: null });
    await findEffectiveVerdicts([A, A, B, A]);
    expect(calls.in).toEqual([['refund_id', [A, B]]]);
    expect(calls.limit).toEqual([3]);
  });

  it('🔴 空陣列 ⇒ **一發查詢都不送**(不要去試 PostgREST 的 in.() 邊界)', async () => {
    arm({ data: [], error: null });
    const map = await findEffectiveVerdicts([]);
    expect(map.size).toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('🔴 fail-closed:壞掉的資料要在這裡紅,不要流進 UI', () => {
  it('id 數超過上限 ⇒ CorrectionReadIntegrityError,而且【沒送查詢】', async () => {
    arm({ data: [], error: null });
    const tooMany = Array.from({ length: CORRECTION_READ_MAX_IDS + 1 }, (_, i) =>
      `${i}`.padStart(36, '0'),
    );
    await expect(findEffectiveVerdicts(tooMany)).rejects.toBeInstanceOf(
      CorrectionReadIntegrityError,
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('🔴 正對照:恰好等於上限 ⇒ **通過**(證明上面那格不是「一律拒」)', async () => {
    arm({ data: [], error: null });
    const exactly = Array.from({ length: CORRECTION_READ_MAX_IDS }, (_, i) =>
      `${i}`.padStart(36, '0'),
    );
    await expect(findEffectiveVerdicts(exactly)).resolves.toBeInstanceOf(Map);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('回來的列數 > 問的 id 數 ⇒ 那張 view 的唯一性不成立了 ⇒ throw', async () => {
    arm({ data: [row(), row({ correction_id: 'x' }), row({ refund_id: B })], error: null });
    await expect(findEffectiveVerdicts([A, B])).rejects.toBeInstanceOf(
      CorrectionReadIntegrityError,
    );
  });

  it('🔴 總列數沒變、而同一個 id 佔了兩列 ⇒ 也要 throw(與上一格是兩種不同的破法)', async () => {
    // 問 2 筆、回 2 列 ⇒ 上一格的哨兵**抓不到**；而 B 被吃掉了。
    arm({ data: [row(), row({ correction_id: 'dup' })], error: null });
    await expect(findEffectiveVerdicts([A, B])).rejects.toBeInstanceOf(
      CorrectionReadIntegrityError,
    );
  });

  it('corrected_to 是非預期值 ⇒ throw(不要讓沒有文案的狀態流進畫面)', async () => {
    arm({ data: [row({ corrected_to: 'maybe_moved' })], error: null });
    await expect(findEffectiveVerdicts([A])).rejects.toBeInstanceOf(CorrectionReadIntegrityError);
  });

  it('🔴 正對照:兩個合法值都必須通得過(證明上面那格不是「一律拒」)', async () => {
    for (const value of CORRECTED_TO_VALUES) {
      arm({ data: [row({ corrected_to: value })], error: null });
      const map = await findEffectiveVerdicts([A]);
      expect(map.get(A)?.correctedTo).toBe(value);
    }
    // 值域清單本身也釘住：多一個值而畫面沒跟上 ⇒ 這一格會叫。
    expect([...CORRECTED_TO_VALUES]).toEqual(['money_moved', 'no_money_moved']);
  });
});

describe('畫面要顯示的欄位(plan §1b:零額外查詢)', () => {
  it('六個欄位逐格對上,不是只有 correctionId', async () => {
    arm({ data: [row()], error: null });
    const v = (await findEffectiveVerdicts([A])).get(A);
    expect(v).toEqual({
      refundId: A,
      correctionId: 'cccccccc-3333-4333-8333-cccccccccccc',
      seq: 2,
      correctedTo: 'no_money_moved',
      reason: '對過 TapPay，錢其實沒有動',
      actor: 'staff_01',
      createdAt: '2026-08-29T10:00:00+00:00',
    });
  });
});
