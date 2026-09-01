import { beforeEach, describe, expect, it, vi } from 'vitest';

// 🔵 這支模組帶 `server-only` 守衛 ⇒ 單元測試要先把它讓開(同 refund-recovery-read.test.ts:3)
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { readOrderManualRefundRailCap } from './manual-refund-read';

// manual-refund-read.test.ts — ⟦b4-PCM01RECORD⟧ 的讀取那一半。
//
// 🔴 **這支檔在 2026-09-02 之前不存在** —— 而 `readOrderManualRefundRailCap` 是本片新加的。
//
// ══ 這一支釘的是什麼 ══════════════════════════════════════════════════════════
// 那個數字是【要不要在畫面上標紅】的唯一依據。而它有一個**很安靜**的失效方式:
//   `bigint` 經 PostgREST 可能回**字串**;而 `Number('')` 是 `0`、`Number(null)` 也是 `0`
//   ⇒ 📌 **一個「算不出來」會靜靜變成「零元可退」** —— 而那兩件事在畫面上意思相反:
//      `0`    = 一毛都不能再退(而那是一個**確定的事實**)
//      `null` = 我不知道(而那時候**不該**宣稱任何事)
// ⇒ ⇒ 所以下面每一格都在問同一件事:**它有沒有把「不知道」講成「0」。**

const ORDER = '11111111-1111-1111-1111-111111111111';

describe('⟦b4-PCM01RECORD⟧ readOrderManualRefundRailCap', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it('🔴 呼叫的是【DB 那一支同名函式】, 不是自己算 —— 參數名也要對', async () => {
    mocks.rpc.mockResolvedValue({ data: 700, error: null });
    await readOrderManualRefundRailCap(ORDER);
    // 🔵 參數名打錯 ⇒ PostgREST 會回錯而不是回 0 ⇒ 但那要跑真的 DB 才看得到
    //    ⇒ 這一格用【呼叫形狀】把它釘在單元層
    expect(mocks.rpc).toHaveBeenCalledWith('pcm_manual_refund_rail_cap', { p_order_id: ORDER });
  });

  it('🔴 正常數字原樣帶回(含負數 —— 負數正是「超收了」那個訊號)', async () => {
    mocks.rpc.mockResolvedValue({ data: 700, error: null });
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(700);
    mocks.rpc.mockResolvedValue({ data: -500, error: null });
    // 🛑 **不得夾底成 0** —— `pcm_manual_refund_rail_cap` 沒有 `GREATEST`,
    //    而「-500」就是畫面要標紅的那個依據。夾底 = 把訊號丟掉。
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(-500);
  });

  it('🔴 bigint 回字串時要轉成數字(PostgREST 對 bigint 的形狀不保證)', async () => {
    mocks.rpc.mockResolvedValue({ data: '700', error: null });
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(700);
    mocks.rpc.mockResolvedValue({ data: '-500', error: null });
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(-500);
  });

  it('🟢 負對照:「不知道」的每一種形狀都要回 null, 一種都不准變成 0', async () => {
    // 🔴 這一格是本檔的重點 —— 下面每一個值餵給 `Number()` 都會得到 `0`,
    //    而 `0` 在畫面上是一個【確定的宣稱】。
    for (const data of [null, undefined, '', '   ', [], {}, false] as const) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(
        readOrderManualRefundRailCap(ORDER),
        `data=${JSON.stringify(data)} 應該回 null`,
      ).resolves.toBeNull();
    }
  });

  it('🟢 負對照:轉不出數字的字串也回 null(不是 NaN, 也不是 0)', async () => {
    for (const data of ['abc', '12abc', 'NaN', 'Infinity']) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(readOrderManualRefundRailCap(ORDER), `data=${data}`).resolves.toBeNull();
    }
  });

  it('🔵 正對照:0 真的是 0 —— 它與「不知道」不得合流', async () => {
    // 🔴 沒有這一格, 一個「什麼都回 null」的實作會通過上面每一格負對照。
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(0);
    mocks.rpc.mockResolvedValue({ data: '0', error: null });
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(0);
  });

  // 🔴🔴 **codex 2026-09-02 must-fix ①:上面那兩格負對照【太窄】** ——
  //    它們演的是「轉不出數字」, 而漏掉了一整族:**轉得出數字, 而那個數字不可信。**
  //    ⇒ 下面兩格演的就是那一族, 兩個輸入都是 codex 給的實證值。
  it('🔴 `-1e-400` ⇒ 必須是 null。它會變成 `-0`, 而 `-0 < 0` 是 false ⇒ 超額完全不標紅', async () => {
    // 📌 這是本片最貴的一個世界:一個**真的超額**的單, 一路全綠而畫面上一條紅都沒有。
    for (const data of ['-1e-400', '-0.0', '1e5', '1.0', '0x10', ' 12 34', '+5', '- 5']) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(readOrderManualRefundRailCap(ORDER), `data=${data}`).resolves.toBeNull();
    }
    // 🔵 而 `'-0'` **不在上面那串裡, 這是刻意的**:它是一個合法的整數字面, 而 `-0` 與 `0`
    //    是同一筆錢 ⇒ 正確答案是 `0`、不是 null。⇒ 讀取端把它正規化掉, 出口只給一種零。
    mocks.rpc.mockResolvedValue({ data: '-0', error: null });
    await expect(readOrderManualRefundRailCap(ORDER)).resolves.toBe(0);
    // 🔴 而「是 0」與「是 -0」在 `toBe` 底下**分得開**(Object.is)⇒ 這一格真的在量正規化。
    expect(Object.is(await readOrderManualRefundRailCap(ORDER), -0)).toBe(false);
  });

  it('🔴 超出安全整數 ⇒ null, 不得回一個【看起來很精確】的近似值', async () => {
    // `-9223372036854775808`(bigint 下界)⇒ `Number()` 給的是失真值, 印出來會是
    // `9,223,372,036,854,776,000` —— **那個數字不是任何人退的錢, 而它看起來完全像真的。**
    // ⇒ 回 null(=算不出上限, 標紅找工程)比回一個假數字好, 因為只有前者有人會去查。
    for (const data of ['-9223372036854775808', '9007199254740993', '-9007199254740992']) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(readOrderManualRefundRailCap(ORDER), `data=${data}`).resolves.toBeNull();
    }
  });

  it('🔵 正對照:安全範圍內的負整數要原樣過(否則上面兩格對「一律 null」也綠)', async () => {
    for (const [data, want] of [['-800', -800], [-800, -800], ['9007199254740991', 9007199254740991]] as const) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(readOrderManualRefundRailCap(ORDER), `data=${data}`).resolves.toBe(want);
    }
  });

  it('🔴 讀失敗要 throw —— 而【呼叫端把它收斂成 null】是刻意的, 兩句話不衝突', async () => {
    // ⚠️ **codex nit ⑧ 的更正**:~~原本這一格的理由寫「throw 才不會被畫面讀成『算不出來』」~~
    //    ——**那句話是假的**:`order-detail-route.tsx` 的 `allSettled` 就是把它收斂成 `null`,
    //    畫面照樣顯示「算不出這張單的可退上限」。
    // ✅ 真正的理由是**分層**:本層 throw ⇒ **錯誤物件送得到 `console.error`**;
    //    如果本層自己吞成 null, 那個 reason 就永遠不會被印出來, 而線上出事時沒有東西可查。
    //    ⇒ 📌 「畫面顯示什麼」與「log 裡留下什麼」是兩件事, 而只有後者答得出【為什麼】。
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(readOrderManualRefundRailCap(ORDER)).rejects.toBeTruthy();
  });
});
