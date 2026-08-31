// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COUPON_REJECT_REASONS, type CouponRejectReason } from './coupon';

// 這一支守的是**一個沒有任何編譯器在看的接縫**:
//   TS 的 `CouponRejectReason` ←→ SQL 的 `public.coupon_reject_reason` ENUM
//
// 🔴 **為什麼需要它**:那兩邊各自都是合法的,而它們分岔的時候:
//   · `typecheck` 不會紅(TS 不認識 SQL)
//   · `lint` / `build` 不會紅
//   · 而 RPC 回一個 TS 不認得的 reason ⇒ 前端會走到「沒有對應文案」那一條路
//     ⇒ **客人看到的是一個空白或代碼, 而不是「還差 NT$50」。**
//
// ⚠️ **射程(照實寫)**:它比的是**那支 migration 檔的字面**,
//   **不是正式庫裡那個型別現在有哪幾個值** —— 後者要連正式庫讀 `pg_enum`。
//   ⇒ 而 `ALTER TYPE … ADD VALUE` 分兩種, **只有一種擋得到**:
//     ✅ **寫進 repo 的 migration** ⇒ 下面 `alterAddValueHits()` 會讓它紅(codex must-fix 補的)
//     🔴 **有人在 SQL Editor 手貼而沒進 repo** ⇒ **本檔看不到, 而它會安靜地全綠**
//        (本 repo 有前例:`APPLIED.tsv` 上就有「Sean 本人貼」的紀錄)

const MIGRATION = join(
  __dirname,
  '../../../../supabase/migrations/20260829150000_m4b_coupon_p1_tables.sql',
);

/**
 * 從 migration 裡把那個 ENUM 的值逐個抽出來。抽不到 ⇒ throw(**不 skip**)。
 *
 * 🔴 **先剝掉 `--` 行註解才做比對**(codex must-fix):那一段每個值後面都有中文註解,
 *    而**註解裡只要出現 `);`,非貪婪的 `\)\s*;` 就會提早收尾**
 *    ⇒ 之後新增的第八個值會落在括號外 ⇒ **抽到 7 個、全綠, 而 SQL 有 8 個。**
 */
function sqlEnumValues(): string[] {
  const raw = readFileSync(MIGRATION, 'utf8');
  const sql = raw.replace(/--[^\n]*/g, '');
  const m = /CREATE TYPE public\.coupon_reject_reason AS ENUM\s*\(([\s\S]*?)\)\s*;/.exec(sql);
  if (m === null) {
    throw new Error(
      `在 ${MIGRATION} 裡找不到 coupon_reject_reason 的 CREATE TYPE ⇒ 量具失效(不是產品壞了)`,
    );
  }
  return [...(m[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] as string);
}

/**
 * 🔴 **全 repo 掃 `ALTER TYPE … ADD VALUE`**(codex must-fix)。
 *
 * 上面那支只讀**一支** migration ⇒ 之後有人用另一支 migration 加值, 它**永遠讀舊檔、安靜全綠**。
 * ⇒ 這裡把那條路變成**會紅**:掃到就丟出去, 逼下一個人回來把這道守門改對。
 * 🛑 而它仍然**答不出正式庫現在有哪幾個值** —— 那要連正式庫讀 `pg_enum`。
 */
function alterAddValueHits(): string[] {
  const dir = join(__dirname, '../../../../supabase/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) =>
      /ALTER\s+TYPE\s+public\.coupon_reject_reason\s+ADD\s+VALUE/i.test(
        readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, ''),
      ),
    );
}

describe('CouponRejectReason 與 SQL 的 ENUM 不准漂', () => {
  const sqlValues = sqlEnumValues();

  it('量具自檢:真的從 SQL 抽到東西(空陣列會讓下面每一格恆真)', () => {
    expect(sqlValues.length).toBeGreaterThan(3);
  });

  it('🔴🔴 兩邊【逐字、同序】相同', () => {
    // 同序不是潔癖:比集合的話, diff 上看不出是哪一個被換掉。
    expect([...COUPON_REJECT_REASONS]).toEqual(sqlValues);
  });

  // 🛑 **下面兩格的射程**(codex must-fix 要求寫明):它們比的是**現造的陣列**,
  //    **沒有真的突變 SQL parser、也沒有突變 TS 的 union** ——
  //    它們證的只有一件事:上面那個 `toEqual` **不是兩個空陣列在互相通過**。
  //    ⇒ 真正守「union 多長一個而清單沒加」的是 `coupon.ts` 裡那個型別層 `_ExhaustiveCheck`
  //      (少一個值時 **tsc 會紅**, 不用等這支測試)。
  it('判別力演示:待比清單多一個 ⇒ toEqual 必須不成立', () => {
    expect([...COUPON_REJECT_REASONS]).not.toEqual([...sqlValues, 'zzq_eighth_reason']);
  });

  it('判別力演示:待比清單少一個 ⇒ toEqual 必須不成立(反方向)', () => {
    expect([...COUPON_REJECT_REASONS].slice(0, -1)).not.toEqual(sqlValues);
  });

  it('🔴 沒有任何 migration 在用 `ALTER TYPE … ADD VALUE` 加值', () => {
    // 有的話,上面那支只讀一支檔的 parser 就開始說謊了 ⇒ 讓它在這裡紅, 而不是安靜。
    expect(alterAddValueHits()).toEqual([]);
  });

  it('負對照:一個現造的值不在任何一邊', () => {
    expect(sqlValues).not.toContain('qx4m7-negctl-20260831');
    expect(COUPON_REJECT_REASONS as readonly string[]).not.toContain('qx4m7-negctl-20260831');
  });

  it('型別層:每一個執行期值都是合法的 CouponRejectReason', () => {
    // 這一格由 tsc 保證(`satisfies`),這裡只是把它變成一個看得見的斷言。
    const all: readonly CouponRejectReason[] = COUPON_REJECT_REASONS;
    expect(all).toHaveLength(7);
  });
});
