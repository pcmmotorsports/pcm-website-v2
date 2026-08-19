import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// M-4b `#20` plan §1⑤ 的那一格突變守門:**拿掉 `listing_set_by` 那半 ⇒ 必須有一格紅**。
//
// 🔴 **它守的不是今天的可達性 —— 今天那個壞世界【構造不出來】**:
//    `listing_set_by` 全樹只有這一支寫入者,而它在**單一 UPDATE** 裡兩欄一起寫(原子)
//    ⇒ 「`delisted_at` 變了而 `listing_set_by` 沒變」今天不可能發生。
//    ⇒ **本格守的是【未來有人把那半拿掉】** —— 而那件事發生時,
//      同步管線不會壞、稽核照樣寫、三綠照樣全綠、畫面照樣正常,
//      **只有「這個狀態是誰決定的」這個資訊靜靜地消失**,而它正是 Sean 2026-08-15 拍板的載體。
//
// ⚠️ **本格是文字層斷言,它的天花板要講明**:它讀 migration 的 SQL 原文,
//    ⇒ 它**證不到**「正式庫那支函式現在真的兩欄一起寫」(那要對 DB 查 `pg_get_functiondef`)。
//    ⇒ 它擋得住的是【有人改這份原始碼】,擋不住【有人在 DB 上手動 REPLACE 掉它】。

const MIGRATION = join(
  __dirname,
  '../../../../../supabase/migrations/20260819040000_m4b_20_admin_set_product_listing.sql',
);

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** 抽出那個目的 UPDATE 的整段(從 `UPDATE public.products` 到它的 `WHERE`)。 */
function updateBlock(text: string): string {
  const start = text.indexOf('UPDATE public.products');
  expect(start, '找不到 UPDATE public.products —— 這支 migration 的形狀變了').toBeGreaterThan(-1);
  const end = text.indexOf('WHERE id = p_product_id', start);
  expect(end, '找不到那個 UPDATE 的 WHERE —— 形狀變了').toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('#20 上下架 migration:兩欄必須在同一個 UPDATE 裡一起寫', () => {
  it('🔴 那個 UPDATE 同時 SET `delisted_at` 與 `listing_set_by`', () => {
    const block = updateBlock(sql());
    expect(block, 'delisted_at 不在那個 UPDATE 裡').toContain('delisted_at');
    // 🔴 這一行就是突變靶:把 migration 裡的 `listing_set_by = 'staff'` 拿掉 ⇒ 本格紅。
    expect(block, "🔴 listing_set_by = 'staff' 不見了 —— 那是 Sean 拍板的載體,不是附帶欄位").toContain(
      "listing_set_by = 'staff'",
    );
  });

  it('🔴 全檔只有一個寫 `products` 的 UPDATE(兩欄不得被拆成兩句)', () => {
    // 拆成兩句 UPDATE 的話,上面那格照樣綠(兩個字面都還在檔裡)——
    // 而那會讓「兩欄原子一起寫」這個保證消失。所以要另外釘住**只有一個**。
    const n = sql().split('UPDATE public.products').length - 1;
    expect(n, '寫 products 的 UPDATE 不是恰好一個 ⇒ 原子性保證可能已經被拆掉').toBe(1);
  });

  it('🔴 `listing_set_by` 的寫入者仍然只有這一支(而這一格是它的分母)', () => {
    // 這一格記的是「本支是唯一寫入者」這個前提還成不成立 —— 前提沒了,
    // 上面兩格守的東西就不再等於「這個資訊不會消失」。
    // ⚠️ 只掃 migrations 目錄(app 層若哪天直寫這一欄,那是另一個問題、由 code review 擋)。
    const dir = join(__dirname, '../../../../../supabase/migrations');
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const writers = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => {
        const t = readFileSync(join(dir, f), 'utf8');
        return /\blisting_set_by\s*=/.test(t);
      });
    expect(writers, `listing_set_by 的寫入者不只一支:${writers.join(' / ')}`).toEqual([
      '20260819040000_m4b_20_admin_set_product_listing.sql',
    ]);
  });
});
