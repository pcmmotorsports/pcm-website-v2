import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANUAL_ORDER_SOURCES_FOR_EMAIL } from './notification-fallback';

/**
 * 2026-10-01 貼板 260(`20261001150000_m4b_order_source_manual_shopee.sql`)把這些 view 與函式全部重新定義、
 * 清單多了 `manual_shopee` ⇒ 下面三組綁的舊檔變成【歷史層】, 它們寫的是當時的三個值。
 * ⇒ 舊檔那幾格比對「TS 陣列拿掉 260 新增的值」;正式庫現在跑的那一層由檔尾那一組綁(TS 陣列全部)。
 */
const PRE_260 = MANUAL_ORDER_SOURCES_FOR_EMAIL.filter((v) => v !== 'manual_shopee');

/**
 * 🔴🔴 **同一組值域住在兩層,而它們會各自漂。**
 *
 * ```
 * TS  packages/domain/src/order/notification-fallback.ts     ← 四支 use-case 讀它
 * SQL supabase/migrations/20260905210000_..._off_scan_surface.sql ← 四支 view 的收錄述詞
 * ```
 * 🛑 兩份各自為真時**沒有任何東西會紅** —— 而漂開的症狀是:
 * 一種來源在 SQL 那層被排除、在 TS 那層照舊寄(或反過來)⇒ **一封該寄的信沒寄, 或一封不該寄的寄了**。
 * ⇒ 📌 這一格就是那個機械綁定(codex ③ 升成 must-fix 的那一條)。
 *
 * ## ⚠️ 它【證不到】什麼
 * - 它比的是**字面**:SQL 檔裡那一串值域對 TS 的陣列。
 *   🔴 **這段說明【刻意不把那三個值抄出來】**(codex R3 ②)——
 *   抄一次就是第 N 份副本, 而**說明文字沒有任何守門看得到它**
 *   ⇒ 值域改了之後它會靜靜地變成一句錯的話, 而它讀起來像文件所以沒有人會查。
 *   要看值域去讀 `MANUAL_ORDER_SOURCES_FOR_EMAIL` 那一支。
 *   它答得出「兩邊列的值一樣嗎」,**答不出「兩邊的邏輯一樣嗎」**
 *   (例如 SQL 那條 `IS NULL` 的處理 —— 那一格由探針格16 答)。
 * - 它讀的是**那一支 migration 的檔案**;若有人**再開一支新的** migration 改掉那個述詞,
 *   這一格**看不到** —— 它綁的是這一支,不是「正式庫現在跑的那一版」。
 */
describe('SQL 與 TS 的 manual_* 值域要一致(兩份會各自漂)', () => {
  const MIG = resolve(
    __dirname,
    '../../../../supabase/migrations/20260905210000_m4b_manual_no_email_off_scan_surface.sql',
  );
  const sql = readFileSync(MIG, 'utf8');

  it('🔴 SQL 那串值域逐字等於 TS 的陣列', () => {
    // 只認【碼那一行】(行首八個空白),不認註解裡提到的 —— 註解會提到它而不是宣告它。
    const lines = sql
      .split('\n')
      .filter((l) => /^ {5}OR o\.order_source NOT IN \(/.test(l));
    expect(lines.length, '🔴 SQL 裡找不到那條 NOT IN(或它的形狀被改了)⇒ 這一格量不到東西').toBe(4);

    const expected = `OR o.order_source NOT IN (${PRE_260.map(
      (v) => `'${v}'`,
    ).join(', ')})`;
    for (const l of lines) {
      expect(
        l.trim(),
        '🔴 SQL 那串與 TS 的陣列不一樣了 ⇒ 兩層對同一種來源會給不同答案',
      ).toBe(expected);
    }
  });

  it('🔴 伴生 view 那【第五份】值域也要逐字等於 TS 的陣列', () => {
    // 🔴🔴 codex R2 ②:上面那格只釘四支 pending view 的 `NOT IN`。
    //    `pcm_manual_no_email_excluded` 的 CTE 用的是**反向的 `IN`** ——
    //    形狀不同 ⇒ 上面那把尺**結構上撈不到它** ⇒ 它可以自己漂而全綠。
    //    ⚠️ 漂掉的症狀與上面那格**不同**:它不會讓信寄錯,
    //       它會讓「我們排除掉幾張單」這個數字**說錯話**。
    const lines = sql
      .split('\n')
      .filter((l) => /^ {3}WHERE o\.order_source IN \(/.test(l));
    expect(lines.length, '🔴 SQL 裡找不到伴生 view 那條 IN(或它的形狀被改了)⇒ 這一格量不到東西').toBe(1);

    const expected = `WHERE o.order_source IN (${PRE_260.map(
      (v) => `'${v}'`,
    ).join(', ')})`;
    expect(
      lines[0]!.trim(),
      '🔴 伴生 view 的值域與 TS 的陣列不一樣了 ⇒ 被排除的數字算的不是同一群單',
    ).toBe(expected);
  });

  it('🟢 正對照:同一把尺餵一個 SQL 裡一定有的形狀 ⇒ 找得到', () => {
    expect(sql).toContain('pcm_manual_no_email_excluded');
  });

  it('🔵 負對照:一個現造的來源值不得出現在 SQL 裡', () => {
    expect(sql).not.toContain('zzz_never_a_source_xyz');
  });
});

/**
 * ⟦b4-MANUALBLANKSTUCK⟧ 20260928235000:每日告警那兩支函式(`get_order_created_stuck_count`、
 * `get_order_created_gap_counts`)也排除「manual_* 且 notification_email 空白」—— 同一組值域的【第三個家】。
 * 🔴 怎麼會紅:任一個子查詢少了那一段(數量不是 4)、值域與 TS 不同、或拿掉 `order_source IS NULL`
 *    那一格(來源不明的單會被靜靜排除,與 TS「照舊寄」相反)。
 * ⚠️ 它比的是那一支檔案的字面,不是正式庫現在跑的版本(同檔上面那段的限制)。
 */
describe('告警函式那一支 migration 的 manual_* 值域也要與 TS 一致', () => {
  const MIG = resolve(
    __dirname,
    '../../../../supabase/migrations/20260928235000_m4b_order_created_alert_skip_manual_blank.sql',
  );
  const sql = readFileSync(MIG, 'utf8');
  const list = PRE_260.map((v) => `'${v}'`).join(', ');

  it('🔴 四個子查詢(stuck_count、oldest_stuck_minutes、paid_no_email_count、no_recipient_count)都有那一段,值域逐字等於 TS', () => {
    const lines = sql.split('\n').filter((l) => /^ {13}OR o\.order_source NOT IN \(/.test(l));
    expect(lines.length, '少了一處 ⇒ 那個數字照樣把手動留白的單算成誤報').toBe(4);
    for (const l of lines) expect(l.trim()).toBe(`OR o.order_source NOT IN (${list})`);
  });

  it('🔴 四處都保留 `order_source IS NULL`(來源不明照舊算,與 TS 同方向)', () => {
    const lines = sql.split('\n').filter((l) => /^ {16}o\.order_source IS NULL$/.test(l));
    expect(lines.length).toBe(4);
  });

  it('🔴 後置閘裡那一份(引號加倍的字串)也與 TS 一致', () => {
    const doubled = PRE_260.map((v) => `''${v}''`).join(', ');
    expect(sql).toContain(`'OR o.order_source NOT IN (${doubled})'`);
  });
});

/**
 * ⟦b4-MANUALBLANKSTUCK⟧ 20260928235500:未付款取消信的告警函式也排除 manual 留白
 * (更正單號那支的底面 view 早已排除,不動)。
 * 🔴 怎麼會紅:少一處(數量不是 2)、值域漂、拿掉 `order_source IS NULL`、或後置閘那份字串漂。
 */
describe('未付款取消信告警那一支 migration 的 manual_* 值域也要與 TS 一致', () => {
  const MIG = resolve(
    __dirname,
    '../../../../supabase/migrations/20260928235500_m4b_other_alerts_skip_manual_blank.sql',
  );
  const sql = readFileSync(MIG, 'utf8');
  const list = PRE_260.map((v) => `'${v}'`).join(', ');

  it('🔴 pending_count、no_recipient_count 兩處都有那一段,值域逐字等於 TS', () => {
    const lines = sql.split('\n').filter((l) => /^ {13}OR o\.order_source NOT IN \(/.test(l));
    expect(lines.map((l) => l.trim())).toEqual([
      `OR o.order_source NOT IN (${list})`,
      `OR o.order_source NOT IN (${list})`,
    ]);
  });

  it('🔴 兩處都保留 `order_source IS NULL`', () => {
    const lines = sql.split('\n').filter((l) => /^ {16}o\.order_source IS NULL$/.test(l));
    expect(lines.length).toBe(2);
  });

  it('🔴 後置閘那一份(引號加倍的字串)也與 TS 一致', () => {
    const doubled = PRE_260.map((v) => `''${v}''`).join(', ');
    expect(sql).toContain(`'OR o.order_source NOT IN (${doubled})'`);
  });
});

/**
 * 貼板 260:8 支寄信 view 與 4 支函式的【現行那一層】(本體取自正式庫 pg_get_viewdef / pg_get_functiondef)。
 * 🔴 怎麼會紅:有人把 TS 清單改了而沒有出新的 migration(或反過來);或 260 那支檔少改了一處。
 *    view 的寫法是正式庫正規化過的 `ARRAY['x'::text, ...]`, 函式保留原始碼的 `NOT IN ('x', ...)`。
 */
describe('貼板 260(現行那一層)的 manual_* 值域與 TS 一致', () => {
  const MIG = resolve(
    __dirname,
    '../../../../supabase/migrations/20261001150000_m4b_order_source_manual_shopee.sql',
  );
  const sql = readFileSync(MIG, 'utf8');
  const count = (needle: string) => sql.split(needle).length - 1;
  const arr = `ARRAY[${MANUAL_ORDER_SOURCES_FOR_EMAIL.map((v) => `'${v}'::text`).join(', ')}]`;
  const list = MANUAL_ORDER_SOURCES_FOR_EMAIL.map((v) => `'${v}'`).join(', ');

  it('🔴 8 支 view 的清單逐字等於 TS 的陣列, 而且沒有殘留舊的三值清單', () => {
    expect(count(arr)).toBe(8);
    expect(count(`ARRAY[${PRE_260.map((v) => `'${v}'::text`).join(', ')}]`)).toBe(0);
  });

  it('🔴 三支告警函式 6 處 + 建單函式 1 處, 值域逐字等於 TS', () => {
    expect(count(`o.order_source NOT IN (${list})`)).toBe(6);
    expect(count(`p_order_source NOT IN (${list})`)).toBe(1);
  });

  it('🔴 告警函式 6 處都保留 `order_source IS NULL`(來源不明照舊算)', () => {
    expect(sql.split('\n').filter((l) => /^ {16}o\.order_source IS NULL$/.test(l)).length).toBe(6);
  });

  it('🔴 蝦皮單不得有通知信箱的約束在(少了它, 蝦皮單會寄到員工填的信箱)', () => {
    expect(sql).toContain("CHECK (order_source <> 'manual_shopee' OR notification_email IS NULL)");
  });
});
