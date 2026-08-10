import { describe, expect, it } from 'vitest';
import {
  isoBackToTaipeiYmd,
  recentTaipeiMonthsRange,
  taipeiDayEndExclusiveIso,
  taipeiDayStartIso,
  taipeiYmdFromDayEndExclusive,
  taipeiYmdFromInstantIso,
} from './date-range';

// date-range.test.ts — #347-3b 的曆面換算守門。
//
// 🔴 這支的壞法**沒有執行期訊號**:錯 8 小時 = 每天邊界上的單靜默消失,而畫面上那些單的日期
//    看起來明明就在範圍內。員工的結論會是「系統查不到」,不是「篩選算錯了」。

describe('taipeiDayStartIso — 台北午夜,不是 UTC 午夜', () => {
  it('🔴 起點是 +08:00 的午夜(用 UTC 午夜會差 8 小時)', () => {
    // 突變:把 TAIPEI_OFFSET 改成 'Z' ⇒ 這條紅。
    expect(taipeiDayStartIso('2026-08-10')).toBe('2026-08-10T00:00:00+08:00');
  });

  it('🔴🔴 判別力那道:畫面顯示 08/10 的那個瞬間,必須落在 08/10 的範圍**內**', () => {
    // `2026-08-09T16:30Z` 的台北曆面是 08/10 凌晨 0:30 —— migration 檔頭逐字點名的那個例子。
    // 用 UTC 午夜當起點的話,這張單會被排除,而員工在列表上看到的日期就是 08/10。
    const instant = new Date('2026-08-09T16:30:00Z');
    expect(isoBackToTaipeiYmd(instant), '前提:這個瞬間在台北曆面是 08/10').toBe('2026-08-10');
    const from = new Date(taipeiDayStartIso('2026-08-10')!);
    const to = new Date(taipeiDayEndExclusiveIso('2026-08-10')!);
    expect(instant.getTime() >= from.getTime()).toBe(true);
    expect(instant.getTime() < to.getTime()).toBe(true);
  });

  it('🔴 反面:UTC 曆面同一天、台北曆面卻是隔天的瞬間,不得落進來', () => {
    // `2026-08-10T16:30Z` 台北是 08/11 0:30 ⇒ 選 08/10 不該看到它(否則就是多算一天)。
    const instant = new Date('2026-08-10T16:30:00Z');
    expect(isoBackToTaipeiYmd(instant)).toBe('2026-08-11');
    expect(instant.getTime() < new Date(taipeiDayEndExclusiveIso('2026-08-10')!).getTime()).toBe(
      false,
    );
  });

  it.each([
    ['非 YYYY-MM-DD', '2026/08/10'],
    ['帶時間', '2026-08-10T00:00:00Z'],
    ['月份越界', '2026-13-01'],
    ['不存在的日期', '2026-02-30'],
    ['空字串', ''],
    ['垃圾', 'yesterday'],
  ])('%s → null(呼叫端當作沒篩)', (_label, raw) => {
    expect(taipeiDayStartIso(raw)).toBeNull();
    expect(taipeiDayEndExclusiveIso(raw)).toBeNull();
  });

  it('閏日是合法的(2028-02-29 存在;別把它一起擋掉)', () => {
    expect(taipeiDayStartIso('2028-02-29')).toBe('2028-02-29T00:00:00+08:00');
    expect(taipeiDayStartIso('2027-02-29')).toBeNull();
  });
});

describe('taipeiDayEndExclusiveIso — 結束日含當天 ⇒ 送下一個午夜', () => {
  it('🔴 選 8/10 ⇒ to = 8/11 午夜(不是 8/10 23:59:59)', () => {
    // 突變:改成回當天 23:59:59 ⇒ 這條紅。半開區間是 migration 檔頭寫死的。
    expect(taipeiDayEndExclusiveIso('2026-08-10')).toBe('2026-08-11T00:00:00+08:00');
  });

  it.each([
    ['跨月', '2026-08-31', '2026-09-01T00:00:00+08:00'],
    ['跨年', '2026-12-31', '2027-01-01T00:00:00+08:00'],
    ['閏日隔天', '2028-02-29', '2028-03-01T00:00:00+08:00'],
  ])('%s:%s → %s', (_label, ymd, expected) => {
    expect(taipeiDayEndExclusiveIso(ymd)).toBe(expected);
  });

  it('🔴 同一天的 from/to 是「整天」而不是零長度區間', () => {
    const from = new Date(taipeiDayStartIso('2026-08-10')!).getTime();
    const to = new Date(taipeiDayEndExclusiveIso('2026-08-10')!).getTime();
    expect(to - from).toBe(24 * 60 * 60 * 1000);
  });
});

describe('TAIPEI_OFFSET 這個假設本身', () => {
  it('🔴 寫死的 +08:00 與 Intl 在 Asia/Taipei 的實際 offset 對帳(夏天與冬天各一次)', () => {
    // 🔴 這格守的是**假設**,不是程式碼:台灣沒有 DST,所以整年 offset 固定。
    //    哪天真的恢復 DST(或有人把這支拿去算別的時區),這格會紅 —— 那時要改的是實作方式
    //    (改用 Intl 反推 offset),不是把常數換個數字。
    // 🔴 **要問 Intl 真正的 offset,不能只做 roundtrip**(R1 must-fix 3,實測):
    //    `endsWith('T16:00:00.000Z')` 是由常數自我推導出來的 ⇒ **恆真**;
    //    而 roundtrip 那半在「真實 Asia/Taipei 變成 +09:00、常數留 +08:00」下**仍然綠**
    //    (+08 建的午夜在 +09 曆面是同一天的 01:00)⇒ 它只擋得住反方向。
    //    改成直接讀時區資料庫的 offset,兩個方向都紅得了。
    for (const ymd of ['2026-01-15', '2026-07-15']) {
      const midnight = new Date(taipeiDayStartIso(ymd)!);
      const offset = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        timeZoneName: 'longOffset',
      })
        .formatToParts(midnight)
        .find((p) => p.type === 'timeZoneName')?.value;
      expect(offset, `${ymd}:Asia/Taipei 的實際 offset 與寫死的 +08:00 不符`).toBe('GMT+08:00');
      expect(isoBackToTaipeiYmd(midnight), `${ymd} 的台北午夜應該還在同一天`).toBe(ymd);
    }
  });
});

describe('recentTaipeiMonthsRange — 3c 的下拉預設值來源(3b 不套用)', () => {
  it('近 6 個月:to 是今天的台北曆面日、from 是 6 個月前', () => {
    const now = new Date('2026-08-10T03:00:00Z'); // 台北 8/10 11:00
    expect(recentTaipeiMonthsRange(now, 6)).toEqual({
      fromYmd: '2026-02-10',
      toYmd: '2026-08-10',
    });
  });

  it('🔴 `now` 落在台北的隔天凌晨時,用的是**台北**那一天(不是 UTC 那一天)', () => {
    // 2026-08-09T16:30Z = 台北 8/10 00:30 ⇒ toYmd 必須是 08-10。
    expect(recentTaipeiMonthsRange(new Date('2026-08-09T16:30:00Z'), 6).toYmd).toBe('2026-08-10');
  });

  it('🔴🔴 不得少一天 —— 月運算要跑在**台北**曆面上(R1 實跑抓到的 off-by-one)', () => {
    // 🔴 舊實作用 `setUTCMonth()`,而台北午夜 = 前一天 16:00Z ⇒ 是在**前一天**上減月份,
    //    月長不同時會漂:`2026-01-01` 往回 6 個月得 `2025-07-02` = **漏掉 07-01 整天**,
    //    而檔頭當時寫的是「方向是多給而不是漏掉」—— 那句被實跑證偽(測試名大於斷言的同族)。
    //    突變:把月運算改回 `setUTCMonth` ⇒ 下面兩條紅。
    expect(recentTaipeiMonthsRange(new Date('2026-01-01T03:00:00Z'), 6).fromYmd).toBe('2025-07-01');
    expect(recentTaipeiMonthsRange(new Date('2026-08-01T03:00:00Z'), 1).fromYmd).toBe('2026-07-01');
  });

  it('🔴 日超出目標月 ⇒ 夾到該月最後一天(方向是多給,不是溢位到下個月)', () => {
    // 8/31 往回 6 個月:2/31 不存在 ⇒ 夾成 2/28(閏年 2/29)。
    // 舊實作溢位成 3/3 = **窄**了三天;夾到月底才是 date-fns 的慣例、也是寬的那一邊。
    expect(recentTaipeiMonthsRange(new Date('2026-08-31T03:00:00Z'), 6).fromYmd).toBe('2026-02-28');
    expect(recentTaipeiMonthsRange(new Date('2028-08-31T03:00:00Z'), 6).fromYmd).toBe('2028-02-29');
  });

  it('跨年往回(負數月序要用 floor 除法,不是 `%`)', () => {
    expect(recentTaipeiMonthsRange(new Date('2026-03-15T03:00:00Z'), 6).fromYmd).toBe('2025-09-15');
    expect(recentTaipeiMonthsRange(new Date('2026-01-15T03:00:00Z'), 12).fromYmd).toBe('2025-01-15');
    expect(recentTaipeiMonthsRange(new Date('2026-01-15T03:00:00Z'), 24).fromYmd).toBe('2024-01-15');
  });
});

describe('taipeiYmdFromDayEndExclusive / taipeiYmdFromInstantIso — 上界與下界換回曆面日', () => {
  it('🔴 上界 → 員工當初挑的那個結束日(往返回得去,不是隔天)', () => {
    // 突變:改成直接 `isoBackToTaipeiYmd(上界)` ⇒ 回 08-11 ⇒ 紅。症狀 = 每翻一頁結束日往後跑一天。
    expect(taipeiYmdFromDayEndExclusive('2026-08-11T00:00:00+08:00')).toBe('2026-08-10');
    expect(taipeiYmdFromDayEndExclusive(taipeiDayEndExclusiveIso('2026-12-31')!)).toBe('2026-12-31');
  });

  it('🔴 上界不是整午夜時也對(這才是 `-1ms` 勝過 `-1天` 的地方)', () => {
    // 🔴 R1 nit:整午夜的輸入下,`-1ms` 與 `-1天` 輸出**完全相同** ⇒ 上面那格分不出兩種實作。
    //    餵一個非午夜的上界才有判別力:`-1天` 會位移成 08-09。
    expect(taipeiYmdFromDayEndExclusive('2026-08-10T12:00:00+08:00')).toBe('2026-08-10');
  });

  it.each([
    ['空字串', ''],
    ['垃圾', 'not-a-date'],
  ])('%s → null(而不是擲 RangeError 把整頁打成 500)', (_label, raw) => {
    // 🔴 `Intl.formatToParts(Invalid Date)` 會**擲 RangeError**(實測)⇒ 兩支都要有 NaN 閘。
    //    R1 must-fix:下界那支原本沒有,而型別上 `createdFrom: ''` 是合法值。
    expect(taipeiYmdFromDayEndExclusive(raw)).toBeNull();
    expect(taipeiYmdFromInstantIso(raw)).toBeNull();
  });

  it('下界 → 曆面日(合法輸入照常回值,證明上面那條不是恆 null)', () => {
    expect(taipeiYmdFromInstantIso('2026-02-10T00:00:00+08:00')).toBe('2026-02-10');
    // 台北曆面的隔天凌晨:UTC 曆面是 08-09,台北是 08-10。
    expect(taipeiYmdFromInstantIso('2026-08-09T16:30:00Z')).toBe('2026-08-10');
  });
});
