/**
 * ⟦db-ZEROTOTALSPLIT⟧ · P5 的 0 元分支【沒有檢查 att.uncovered_n】—— **這是一個已知而且刻意保留的缺口**。
 *
 * 🔴 為什麼要有這支測試(codex 關卡1 R2 #5 抓到, 我開檔驗過成立):
 *   `admin_compute_order_settlement` 的 P5 有兩個分支:
 *     ① `pay.rows_n > 0 AND att.uncovered_n = 0`      ← **有**檢查 uncovered_n
 *     ② `o.total = 0 AND pay.rows_n = 0 AND o.ps = 'paid' AND o.payment_method = 'zero_total'`
 *                                                     ← **沒有**檢查 uncovered_n
 *   ⇒ 一張 `total=0 · paid · zero_total · 零收款列` 而**存在未入帳 charged attempt** 的單,
 *     其餘 P 值皆真時會被判 `settled`;**舊一代會要求人工處理。**
 *
 * 🛑 **本支【不是在說那樣是對的】** —— 它把那個缺口**釘住**:
 *   `20260907170000` 是逐字抄過來的(body md5 與來源相同), 動它就不是「逐字抄」
 *   ⇒ 缺口跟著搬進來了。**而一個沒有人看著的已知缺口, 與一個沒有人知道的 bug 沒有差別。**
 *   ⇒ 有人哪天補上 `uncovered_n`(那是好事)⇒ **本測試會紅** ⇒ 那個人會被帶到這段字, 然後更新它。
 *
 * 🔬 **可達性(2026-09-07 量到的)**:寫 `payment_method = 'zero_total'` 的只有
 *   `settle_zero_total_order`, 而**那一支還沒貼進正式庫**(它在 76, 而 Sean `Q54` 甲 = 76 不再貼)
 *   ⇒ **今天走不到這個分支**。⚠️ 而那不是「不可達」的證明 ——
 *   排除不了正式庫既有值或人工寫入(codex 關卡2 ⑤ 同一條)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = join(
  __dirname, '../../../../supabase/migrations',
  '20260907170000_m4b_settlement_split_from_zero_total.sql',
);

describe('⟦db-ZEROTOTALSPLIT⟧ P5 0 元分支的已知缺口', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('🟢 正對照:P5 的【第一】分支確實有檢查 uncovered_n(證明這把尺看得到 uncovered_n)', () => {
    expect(sql).toContain('att.uncovered_n = 0');
  });

  it('🔴 負測:P5 的【0 元】分支仍然沒有檢查 uncovered_n —— 紅了代表有人補上了, 去更新本檔檔頭', () => {
    const i = sql.indexOf("o.payment_method = 'zero_total'");
    expect(i, "找不到 0 元分支的字面 —— migration 被改過, 本測試的座標失效了").toBeGreaterThan(-1);
    // 取那一行往前 400 字元:0 元分支自己那一段
    const seg = sql.slice(Math.max(0, i - 400), i + 80);
    expect(
      seg.includes('uncovered_n'),
      '0 元分支現在【有】uncovered_n 了 ⇒ 這是好事, 而本檔檔頭那段說明已經過期, 請一起更新',
    ).toBe(false);
  });

  it('🔵 這支測試釘的是【那一版】—— body 指紋變了就該重看一次', () => {
    expect(sql).toContain('f134e95d24e768a84fd53d26f29aed70');
  });
});
