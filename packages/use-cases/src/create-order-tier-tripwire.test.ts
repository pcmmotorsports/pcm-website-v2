import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 **絆線:顧客站 `create_order` 今天把 `tier_at_checkout` 寫死 `'general'`。**
//    **這一格【現在是對的】,而它會在【我自己】改動的那一刻紅。**
//
// 為什麼要有它(線A 2026-08-29 點出、線D 複量後自願裝):
//   `20260604130000` 逐字把「tier-aware(店家經銷價取價)」**延到【定價階段】**,
//   而「定價階段」就是經銷價接進顧客站那一片 —— **線D 手上那一件。**
//   ⇒ 我改 `create_order` 的那一天,顧客站會開始寫 `tier_at_checkout='store'`
//   ⇒ 而**另一條線的稅算式若拿 `tier_at_checkout` 判單型,那些【含稅】的單會被再加一次 5%**,
//     **而沒有任何東西會紅。**兩邊的 diff 各自都對。
//   📌 **⇒ 這道絆線的用途不是擋我,是【讓我改的那一刻有人聽得到】。**
//
// 🔴🔴 **它必須只問【活的】那一支,不能 grep 全目錄**(線A 的限定,線D 自己重數過):
//   `::public.member_tier` 命中 **11** 支 migration;`create_order` 一共被重定義 **9** 次。
//   ⇒ 掃全目錄會**恆綠或恆紅**(歷史檔永遠在那裡,而它們寫什麼都不影響現在)。
//   📌 **一個把【歷史】與【現況】混在同一個分母裡的檢查,量到的是「這件事發生過嗎」,
//      而不是「它現在是什麼」。**
//   ⇒ 取「**時間戳最大**的那一支有定義 `create_order` 的 migration」= 活的那一份。
//   ⚠️ **射程**:這一招認的是**檔名排序**,不是資料庫現況。
//      **若有人直接在 SQL Editor 改了正式庫而沒有留 migration,本測試看不到。**
//      那一格由 `supabase/APPLIED.tsv` 那條線守,不是這裡。

const MIG_DIR = new URL('../../../supabase/migrations/', import.meta.url);

/** 時間戳最大、且定義了 `create_order` 的那一支 = 活的那一份。 */
function liveCreateOrderMigration(): { name: string; body: string } {
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 檔名前綴是 YYYYMMDDhhmmss ⇒ 字典序 = 時序
  for (let i = files.length - 1; i >= 0; i--) {
    const body = readFileSync(new URL(files[i]!, MIG_DIR), 'utf8');
    if (/FUNCTION\s+public\.create_order\s*\(/.test(body)) return { name: files[i]!, body };
  }
  // 🔴 找不到就 throw,不回空 —— 回空會讓下面每一格【安靜地變成恆真】。
  throw new Error('找不到任何定義 create_order 的 migration —— 這把尺已失效,不是通過');
}

/** 從函式本體切出 `INSERT INTO public.orders (...) VALUES (...)` 那一段。 */
function ordersInsert(body: string): string {
  const i = body.indexOf('tier_at_checkout');
  if (i < 0) throw new Error('活的 create_order 裡找不到 tier_at_checkout —— 欄位改名了?');
  return body.slice(i, i + 1200);
}

describe('🔴 絆線:顧客站 create_order 的 tier_at_checkout', () => {
  it('[T1] 活的那一支【寫死 general】—— 改成別的值,這裡會紅', () => {
    const { name, body } = liveCreateOrderMigration();
    // 🔴 正對照:證明我切到的是一個【非空、而且真的是那一支】的東西。
    expect(name).toMatch(/^\d{14}_/);
    expect(body.length).toBeGreaterThan(1000);
    const seg = ordersInsert(body);
    // 🔴 怎麼會紅:把它改成 `v_tier` 或 `'store'::public.member_tier` ⇒ 這裡紅。
    //    **那正是我們要的鬧鐘** —— 它會把人帶到上面那段,而那段講的是稅算式那條線。
    expect(
      seg,
      `活的 create_order(${name})不再寫死 general ⇒ 稅算式那條線的判準可能已經失效,` +
        '而它不會自己紅。動手前先跟那條線對齊 Q-經銷單判準。',
    ).toContain("'general'::public.member_tier");
  });

  it('[T2] 負對照:那把尺【換一支檔就換答案】—— 證明它在讀,不是在猜', () => {
    // 🔴 沒有這一格,一個永遠回同一份寫死內容的 `liveCreateOrderMigration` 也會讓 T1 全綠。
    //    (今晚在另一支守門上踩過:兩版「檢查答案對不對」的負對照都殺不掉那個突變,
    //     因為**一個猜對的答案與一個讀來的答案長得一樣**。)
    expect(() => ordersInsert('這段裡面沒有那個欄位')).toThrow();
    expect(ordersInsert("xx tier_at_checkout, 'store'::public.member_tier yy")).toContain('store');
  });

  it('[T3] 這把尺量的是【活的那一支】,不是全目錄', () => {
    const { name } = liveCreateOrderMigration();
    const all = readdirSync(MIG_DIR).filter(
      (f) =>
        f.endsWith('.sql') &&
        /FUNCTION\s+public\.create_order\s*\(/.test(readFileSync(new URL(f, MIG_DIR), 'utf8')),
    );
    // 🔴 怎麼會紅:把 liveCreateOrderMigration 改成回第一支(或任何一支歷史檔)⇒ 這裡紅。
    //    📌 而這一格守的是**分母**,不是值 —— 它是本檔唯一擋得住「量錯世界」的那格。
    expect(all.length, '只有一支的話,「取最後一支」這件事沒有判別力').toBeGreaterThan(1);
    expect(name).toBe(all.sort().at(-1));
  });
});
