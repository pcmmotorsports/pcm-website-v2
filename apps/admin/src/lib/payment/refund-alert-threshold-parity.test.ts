import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFUND_EXCEPTION_STALL_MS, STUCK_MANUAL_VERDICT_FAILED_REASON } from './refund-ledger-view';

/**
 * F-004 跨檔門檻守門 —— 畫面的 30 分鐘與那封信的 30 分鐘**必須是同一個 30**。
 *
 * ── 這一格為什麼存在(它擋的是一個【已經差點發生】的錯)────────────────
 * 告警那支 RPC 原本打算沿用既有參數 `p_refunding_stuck_seconds`,而 route 餵給它的是
 * `ALERT_REFUNDING_STUCK_SECONDS = 86400`(24 小時)—— 與 Sean 裁的 30 分鐘**差 48 倍**。
 * 🔴 兩個東西都叫「卡住門檻」,而沿用它會安靜地把 30 分變成 24 小時:
 *    **編得過、三綠全綠、信照常寄,沒有任何東西會紅**,而信上的數字會小於畫面
 *    —— 那正好就是 Sean 選 30 分【要避免的那個東西】。
 *
 * ── 🔴 期望值是【算出來的】,不是又寫一個 30 ─────────────────────────
 * 兩邊各寫一個 `30`,與「它們接上了」印同一個東西。
 * 這一格把 SQL 的字面**解析出來**,和 `REFUND_EXCEPTION_STALL_MS` **換算後**比對
 * ⇒ 改了 app 常數而沒改 migration(或反過來)⇒ 這一格會紅。
 *
 * ── ⚠️ 射程(不要讀得比它大)────────────────────────────────────────
 * · 它比對的是 **migration 檔的字面**,不是**正式庫裡那支函式現在的樣子**。
 *   有人在 DB 直接改函式 ⇒ 這一格照樣綠。那要 apply 後查 `prosrc`,不在本格。
 * · 它只認 `INTERVAL '<n> minutes'` / `INTERVAL '<n> hours'` 這兩種寫法。
 *   改成 `make_interval(mins => 30)` ⇒ **零命中 ⇒ 本格會紅**(這是刻意的:
 *   看不懂的寫法要當場停下來,不要安靜放行)。
 */

const MIGRATION = path.join(
  __dirname,
  '../../../../../supabase/migrations/20260824040000_m3_250_order_refunds_stuck_summary.sql',
);

/**
 * 🔴 **只取 `$fn$ … $fn$` 之間的函式本體,不掃整支檔。**
 * 掃整支的話註解裡的字面會被當成真的 ——
 * 實測(code-reviewer 2026-08-24):檔頭插一行 `-- 舊值曾是 INTERVAL '60 minutes'`
 * ⇒ 這一格會紅,**而紅的理由指向一句註解**。那是紅錯地方,和沒守到一樣浪費一個晚上。
 */
function sql(): string {
  const whole = readFileSync(MIGRATION, 'utf8');
  const body = whole.match(/\$fn\$([\s\S]*?)\$fn\$/);
  if (!body) throw new Error('找不到 $fn$ … $fn$ 函式本體 —— migration 的寫法換了,回來重看這一格');
  return body[1]!;
}

describe('F-004 退款告警門檻:migration 字面 vs app 常數', () => {
  /**
   * 🔴🔴 **`/g` 不是風格選擇,它是這一格的判別力。**
   * 我第一版用不帶 `/g` 的 `.match()` ⇒ **只拿到第一個** `INTERVAL '<n> minutes'`。
   * 而函式體裡有**兩個**(總數那顆、過夜那顆的基底述詞)。
   * code-reviewer 2026-08-24 實測:把**第二個**改成 `INTERVAL '4320 minutes'`
   * ⇒ **三格全綠**,而「卡超過一天」會少報(建立 30 小時的那列不再進 overnight)。
   * ⇒ migration 檔頭當時逐字宣稱「兩個字面各配一格跨檔守門」—— **那句話當時是假的。**
   * ⇒ 改成取全部、斷言**集合恰好是 {30}**:少一個、多一個、值不同,三種都會紅。
   */
  it('🔴 函式體裡【每一個】分鐘門檻都 === REFUND_EXCEPTION_STALL_MS(取全部,不是第一個)', () => {
    const all = [...sql().matchAll(/INTERVAL '(\d+) minutes'/g)].map((m) => Number(m[1]));
    expect(all.length, 'migration 函式體裡找不到 INTERVAL <n> minutes —— 寫法換了就要重看這一格')
      .toBeGreaterThan(0);
    // 期望值算出來,不是打上去的。
    const expected = REFUND_EXCEPTION_STALL_MS / 60_000;
    expect(new Set(all)).toEqual(new Set([expected]));
    // 數量也釘住:總數那顆 + 過夜那顆的基底述詞 = 2。少一顆代表述詞被改寫了,要回來重看。
    expect(all.length).toBe(2);
  });

  it('🔴 過夜門檻必須【嚴格大於】卡住門檻(否則子集語意不成立)', () => {
    const hours = sql().match(/INTERVAL '(\d+) hours'/);
    expect(hours, 'migration 裡找不到 INTERVAL <n> hours').not.toBeNull();
    const overnightMs = Number(hours![1]) * 60 * 60 * 1000;
    // 「過夜」是「卡住」的子集 ⇒ 它的門檻若不比卡住門檻大,那個子集就沒有意義
    // (兩者相等 ⇒ 兩個數字永遠一樣;較小 ⇒ overnight 會大於 total,信上自相矛盾)。
    expect(overnightMs).toBeGreaterThan(REFUND_EXCEPTION_STALL_MS);
  });

  /**
   * 🔴 ②終態半的 `failed_reason` 字面,權威在 app 端的 `STUCK_MANUAL_VERDICT_FAILED_REASON`。
   * migration 裡寫死一份 ⇒ 兩處會漂,而漂掉之後信尾那行會**永遠印 0 筆**
   * —— 那與「真的沒有終態半」印同一句話(其實正式庫 2026-08-24 量到 4)。
   */
  it('🔴 migration 的 failed_reason 字面 === STUCK_MANUAL_VERDICT_FAILED_REASON', () => {
    const all = [...sql().matchAll(/failed_reason = '([^']+)'/g)].map((m) => m[1]);
    expect(all.length, 'migration 函式體裡找不到 failed_reason = <字面>').toBeGreaterThan(0);
    expect(new Set(all)).toEqual(new Set([STUCK_MANUAL_VERDICT_FAILED_REASON]));
  });

  it('述詞兩處一致:兩個計數都收「逾時 或 有受理證據」,過夜那個多一條 AND', () => {
    const body = sql();
    // 兩個計數各出現一次同樣的 or 分支 ⇒ 過夜是子集而非另一套述詞。
    const evidenceBranches = body.match(/provider_refund_id_evidence IS NOT NULL/g) ?? [];
    expect(evidenceBranches.length).toBe(2);
    const processingFilters = body.match(/status = 'processing'/g) ?? [];
    expect(processingFilters.length).toBe(2);
  });
});
