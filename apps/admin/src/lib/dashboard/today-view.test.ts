import { describe, expect, it } from 'vitest';
import { todayTaipeiRange } from './today-view';

// today-view.test.ts — `#16` 今日對帳的形狀層守門。
//
// 🔴 這支釘的兩件事,壞掉時**都沒有執行期訊號**:
//    ① 日界算錯 8 小時 ⇒ 每天邊界上的收款靜默落到隔天,而畫面上那個數字看起來很正常。
//    ② 沖銷列被過濾掉 ⇒ 退掉的錢被算成收入,**數字只會偏大、不會報錯**。
//    員工的結論會是「今天賺比較多」,不是「系統算錯了」。

describe('todayTaipeiRange — 台北午夜,不是 UTC 午夜', () => {
  it('🔴 台北 08/14 23:59 ⇒ 今天仍是 08/14(用 UTC 會變成 08/15)', () => {
    // 台北 2026-08-14 23:59 = UTC 2026-08-14 15:59。
    const range = todayTaipeiRange(new Date('2026-08-14T15:59:00Z'));
    expect(range.fromIso).toBe('2026-08-14T00:00:00+08:00');
    expect(range.toIso).toBe('2026-08-15T00:00:00+08:00');
  });

  it('🔴 台北 08/15 00:00 ⇒ 今天已經是 08/15(區間整個往前一天)', () => {
    // 台北 2026-08-15 00:00 = UTC 2026-08-14 16:00 —— 與上一格只差 1 分鐘。
    const range = todayTaipeiRange(new Date('2026-08-14T16:00:00Z'));
    expect(range.fromIso).toBe('2026-08-15T00:00:00+08:00');
    expect(range.toIso).toBe('2026-08-16T00:00:00+08:00');
  });

  it('結束邊界是「下一個午夜」而不是 23:59:59(半開區間;微秒級不漏單)', () => {
    // 突變:把 taipeiDayEndExclusiveIso 換成當天 23:59:59 ⇒ 這條紅。
    expect(todayTaipeiRange(new Date('2026-08-14T04:00:00Z')).toIso).toBe(
      '2026-08-15T00:00:00+08:00',
    );
    expect(todayTaipeiRange(new Date('2026-08-14T04:00:00Z')).toIso).not.toContain('23:59');
  });
});

// 🪦 `sumRefunded` 的 2 格(加總 / 零筆回 0)隨那支函式於 2026-08-15 一起刪掉。
//    🔴 **這是一個真的損失,不是清理**:退款那格重做時,這兩格要**連同新的口徑一起回來**,
//       而且新的口徑還要多守一件現在守不到的事 —— **「被人工更正掉的退款有沒有被排除」**。
//    完整理由見 `today-view.ts` 的墓碑段。**不要只把 `reduce` 加回來就把測試也照抄回來。**
