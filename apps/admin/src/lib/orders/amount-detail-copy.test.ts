// amount-detail-copy.test.ts — 🔴 **釘住「函式本體是逐行照抄,只多了七行 DETAIL」**
// (M-4b E10 `#518`;codex 關卡2 R1 must-fix 6)。
//
// ══ 為什麼需要這一格 ═════════════════════════════════════════════════════════
//
// `20260816040000` 的檔頭逐字宣稱:
//   「函式本體**逐行照抄**前一支的 325-484,只在七處 `USING …` 加 `DETAIL`」
// 🔴 **那是一句沒有任何東西在守的宣稱。** 而它承重 ——
//    前一支**已經 apply 到正式庫**,新的這支會 `CREATE OR REPLACE` 蓋過去。
//    本體若在複製時漂移了一行(改到金額計算、改到權限檢查、少了一段 IF),
//    **apply 當下就是靜默換掉正式庫的業務邏輯**,而 migration 自己的 DO 斷言看不到
//    (它只驗 DETAIL 配對、SECURITY DEFINER、search_path)。
//
// ⚠️ **它守不住什麼**:
//   ① 只比對這兩支檔的**字面**。前一支若被別人改過,這一格會紅 —— 那是對的,要人去看。
//   ② 不驗「正式庫裡現在跑的那份等於 repo 這份」——那要連正式庫,不在本格範圍。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../supabase/migrations');
const OLD = resolve(MIGRATIONS, '20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql');
const NEW = resolve(MIGRATIONS, '20260816040000_m4b_e10_13_518_p2c13_detail.sql');

const FN_START = 'FUNCTION public.admin_update_order_item_amount(';
const FN_END = '$fn$;';

/** 抽出函式定義那一段(從 `CREATE …FUNCTION …(` 到 `$fn$;`,含頭尾) */
function functionBody(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes(FN_START));
  if (start < 0) throw new Error(`抓不到函式起點:${path}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === FN_END);
  if (end < 0) throw new Error(`抓不到函式終點:${path}`);
  return lines.slice(start, end + 1);
}

describe('🔴 #518:新 migration 的函式本體 = 舊的逐行照抄 + 七行 DETAIL', () => {
  it('正向對照:兩邊都真的抽到函式(抽空的話下面每一條都恆真)', () => {
    expect(functionBody(OLD).length).toBeGreaterThan(100);
    expect(functionBody(NEW).length).toBeGreaterThan(100);
  });

  it('🔴 新的比舊的【恰好多七行】,而且多出來的每一行都是 DETAIL', () => {
    const oldBody = functionBody(OLD);
    const newBody = functionBody(NEW);
    const added = newBody.filter((l) => l.trim().startsWith("DETAIL = '"));
    expect(added).toHaveLength(7);
    expect(newBody.length - oldBody.length).toBe(7);
  });

  it('🔴🔴 把那七行 DETAIL 拿掉、CREATE OR REPLACE 還原成 CREATE 之後,兩份【逐字相同】', () => {
    const oldBody = functionBody(OLD).join('\n');
    const normalised = functionBody(NEW)
      .filter((l) => !l.trim().startsWith("DETAIL = '"))
      .join('\n')
      // 前一行的結尾在加 DETAIL 時從 `';` 變成 `',`,還原它
      .replace(/CONSTRAINT = '([a-z0-9_]+)',$/gm, "CONSTRAINT = '$1';")
      .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
    // 🔴 這一行紅的時候要做的是**開兩份檔比對**,不是把期望值改成新的字串。
    //    它紅 = 有人在複製時改動了業務邏輯,而那會靜默蓋掉正式庫裡跑的那份。
    expect(normalised).toBe(oldBody);
  });

  it('🔴 新版函式內的 P2C13 恰為七條 —— 多冒出第八條就紅(DO 斷言的正規式綁不住這件事)', () => {
    const body = functionBody(NEW).join('\n');
    expect([...body.matchAll(/ERRCODE = 'P2C13'/g)]).toHaveLength(7);
  });
});
