import { beforeEach, describe, expect, it, vi } from 'vitest';

// 🔵 這支模組帶 `server-only` 守衛 ⇒ 單元測試要先把它讓開(同 refund-recovery-read.test.ts:3)
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { readOrderManualRefundRailCap, ROW_COLUMNS } from './manual-refund-read';

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

// ═══════════════════════════════════════════════════════════════════════════
// ⟦b4-CAPRACE1⟧ · `ROW_COLUMNS` byte-equal 白名單守門
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴🔴 **這一格是 2026-09-07 突變③ 逼出來的, 不是順手加的**:
//    我把 `over_cap_by, cap_state` 從 `ROW_COLUMNS` 拿掉 ⇒
//      元件測 **31 passed** · 本檔 **10 passed** · 兩邊 rc=0 ⇒ **零紅**。
//    ⇒ 📌 **「畫面會不會標紅」與「資料撈不撈得到」是兩道各自獨立的門, 而只有後者沒人守。**
//    ⇒ 🛑 漏欄的症狀是:PostgREST **回 200**、那兩個欄位是 `undefined` ⇒
//      畫面**永遠印不出「超出」也印不出「未判定」**, 而**每一格測試都是綠的**。
//      (多欄反而安全:PostgREST 回 42703 會炸 ⇒ 一眼看得到。)
//
// 🛑 **不得弱化成 `toContain`** —— 同 `SupabaseOrderAdapter.test.ts:512` 那道的理由逐字:
//    ⛔ ~~**byte-equal 是唯一擋【漏欄】的東西。**~~
//    🔴 **收窄(codex 2026-09-07 nit):它只守【那個常數】。**
//       它擋不到的兩種:①有人繞過常數直接寫 `.select('...')` ②`toRow()` 把欄位錯映
//       (例如把 `cap_state` 映成寫死的 `'within'`)—— **兩種都會讓這兩格照樣綠。**
//    ✅ 正確說法:**在【常數這一層】, byte-equal 是唯一擋得住漏欄的**;
//       而「有沒有人繞過它」與「映對了沒」是**另外兩道題, 目前沒有守門**。
// 🔴 **也不得改成 `*`** —— 這張表是金流帳本, 白名單是承重的。
describe('⟦b4-CAPRACE1⟧ ROW_COLUMNS byte-equal 白名單', () => {
  it('🔴 逐欄比對(改這個字串就要來改這一格, 那是刻意的)', () => {
    expect(ROW_COLUMNS).toBe(
      'id, rail, refund_amount, reason, actor, occurred_at, created_at, voided_at, void_reason, voided_by, over_cap_by, cap_state',
    );
  });

  it('🔴 兩個新欄都在 —— 而這一格與上面那格【不重複】', () => {
    // 上面那格答「整串一字不差嗎」;這一格答「【這兩個特定欄位】在不在」。
    // 📌 有人重排欄序時上面那格會紅而這一格不會 ⇒ 兩個世界印不同的東西 ⇒ 分得出「重排」與「漏欄」。
    expect(ROW_COLUMNS.includes('over_cap_by')).toBe(true);
    expect(ROW_COLUMNS.includes('cap_state')).toBe(true);
    // 🟢 負對照:現造欄名必須不在 ⇒ 證明這把尺不是恆真。
    expect(ROW_COLUMNS.includes('zzz_not_a_column_9137')).toBe(false);
  });
});
