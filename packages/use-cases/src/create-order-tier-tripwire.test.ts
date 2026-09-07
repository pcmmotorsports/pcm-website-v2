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

/**
 * 從函式本體切出 `INSERT INTO public.orders (...) VALUES (...)` 那一段。
 *
 * 🔴🔴 **codex 2026-09-07 nit ③ 打死了第一版**:它是 `body.indexOf('tier_at_checkout')`
 *   ⇒ **第一個命中是【檔頭註解】**(那支 migration 的檔頭逐字寫著「tier_at_checkout 由寫死 general 改成 v_tier」)
 *   ⇒ 📌 **切出來的是我自己寫的說明文字, 不是碼** ⇒ 下面那幾個 `toContain` 全部**空真**。
 *   🛑 codex 的實證:把兩支完整 body 整個拿掉, T1 的四個判準**仍然全部成立**。
 *
 * ✅ 修法兩步, 缺一不可:
 *   ① **先把 `--` 註解整行剝掉** —— 註解與碼在 grep 底下長得一樣, 這是本 repo 記過很多次的病。
 *   ② 再找**真的那一句** `INSERT INTO public.orders`(不是找欄位名)。
 */
function ordersInsert(body: string): string {
  const code = body
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
  const i = code.indexOf('INSERT INTO public.orders');
  if (i < 0) throw new Error('剝掉註解之後找不到 INSERT INTO public.orders —— 這把尺已失效, 不是通過');
  const seg = code.slice(i, i + 1600);
  if (!seg.includes('tier_at_checkout')) {
    throw new Error('那一句 INSERT 裡沒有 tier_at_checkout —— 欄位改名或切窗太短, 是尺的問題');
  }
  return seg;
}

describe('🔴 絆線:顧客站 create_order 的 tier_at_checkout', () => {
  // ══ 🔔 **這個鬧鐘響了 —— 2026-09-07 `-auth` B2c** ═══════════════════════════
  //   ⛔ ~~[T1] 活的那一支【寫死 general】—— 改成別的值,這裡會紅~~
  //   ✅ 它**照設計紅了**, 而紅的那一刻要做的事(檔頭逐字)是:
  //      「另一條線的稅算式若拿 `tier_at_checkout` 判單型 ⇒ 那些含稅的單會被再加一次 5%」
  //
  //   🔬 **去量了, 而它今天【不成立】**(2026-09-07, 帶正負對照):
  //     全 repo 只有 **3 處**在算稅(grep `0.05` / `VAT_RATE`, 排除測試):
  //       ① `packages/domain/src/order/tax.ts:82` `computeTax` —— 輸入是 **`paymentMethod`**
  //       ② `20260905360000:443` 後台手動單 —— `v_price_tax_mode` 是 **constant 'exclusive'**
  //       ③ 本次新增的 `20260907040000` —— 判準是 **同一個函式裡的 `v_price_tax_mode`**
  //     ⇒ 📌 **沒有任何一處讀 `tier_at_checkout`。** 前台 B2b 的判準也不是 tier,
  //       是 **`ResolvedCartLine.priceUntaxed`**(旗標跟著那個價一起回來)。
  //     🟢 正對照:那把 grep 撈得到 ①②(所以它在讀)· 🔵 負對照:現造欄名 ⇒ 0。
  //
  //   🔴 **所以斷言【翻面】而不是【拿掉】** —— 鬧鐘換一個要守的東西:
  //     舊:寫死 general ⇒ 新:**寫 `v_tier`(他真正的等級)**。
  //     下一個把它改回寫死的人, 這一格照樣紅。
  it('[T1] 活的那一支寫【他真正的等級】—— 改回寫死 general 會紅', () => {
    const { name, body } = liveCreateOrderMigration();
    // 🔴 正對照:證明我切到的是一個【非空、而且真的是那一支】的東西。
    expect(name).toMatch(/^\d{14}_/);
    expect(body.length).toBeGreaterThan(1000);
    const seg = ordersInsert(body);
    expect(
      seg,
      `活的 create_order(${name})的 tier_at_checkout 不是 v_tier ⇒ 經銷單會被記成一般單,` +
        '而退款/發票/對帳都照它走。改回寫死之前, 先問「這張單當時用哪一層價」還記在哪裡。',
    ).toContain('v_tier');
    expect(
      seg,
      `活的 create_order(${name})又寫死 general 了 ⇒ 這是 2026-09-07 B2c 之前的舊行為。`,
    ).not.toContain("'general'::public.member_tier");
    // 🔴 而【價與稅要一起在那張單上】—— 只改 tier 不寫稅欄, 那張單會自稱一般單而收未稅價。
    expect(seg, '同一段 INSERT 要寫 price_tax_mode').toContain('price_tax_mode');
    expect(seg, '同一段 INSERT 要寫 tax_total').toContain('tax_total');
  });

  it('[T2b] 🔴 負對照:【只有註解提到】的 body ⇒ 尺要說「找不到」, 不得當成命中', () => {
    // 🛑 這一格就是 codex nit ③ 那個世界:整支 body 只有一行註解寫著那些字。
    //    第一版的尺會把這段註解切出來然後說「通過」。
    const commentOnly = [
      '-- ⑥INSERT 補 tax_total / price_tax_mode, tier_at_checkout 由寫死 general 改成 v_tier',
      'BEGIN',
      'END',
    ].join('\n');
    expect(() => ordersInsert(commentOnly)).toThrow(/找不到 INSERT INTO public.orders/);
  });

  it('[T2] 負對照:那把尺【換一支檔就換答案】—— 證明它在讀,不是在猜', () => {
    // 🔴 沒有這一格,一個永遠回同一份寫死內容的 `liveCreateOrderMigration` 也會讓 T1 全綠。
    //    (今晚在另一支守門上踩過:兩版「檢查答案對不對」的負對照都殺不掉那個突變,
    //     因為**一個猜對的答案與一個讀來的答案長得一樣**。)
    expect(() => ordersInsert('這段裡面沒有那個欄位')).toThrow();
    expect(
      ordersInsert("INSERT INTO public.orders (tier_at_checkout) VALUES ('store'::public.member_tier)"),
    ).toContain('store');
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
